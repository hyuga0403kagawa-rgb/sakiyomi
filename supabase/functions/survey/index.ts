// UniPort 学生アンケート Edge Function
// - POST: 回答を1件保存する(匿名。ログイン不要)
// - GET ?token=...: 集計結果を返す(SURVEY_TOKENを知っている本人だけ)
//
// survey_responses は RLS 有効・ポリシーなしなので、anonキーからは直接読み書きできない。
// 書き込みも集計もこの関数(service_role)経由に限定している。
// 選択肢は下の ALLOWED で検証し、想定外の値は保存しない。
// デプロイ: npx supabase functions deploy survey --project-ref kdyffkcowdkbgtbledbc
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/** 単一選択の設問と、その選択肢 */
const ALLOWED: Record<string, string[]> = {
  grade: ['1年', '2年', '3年', '4年', '大学院', 'その他'],
  system_count: ['1つ', '2つ', '3つ', '4つ以上'],
  near_miss: ['よくある', 'たまにある', 'ほとんどない'],
  missed: ['ある', 'ない'],
  moodle_usability: ['使いやすい', 'ふつう', '使いにくい'],
  want_notify: ['使いたい', '内容による', '必要ない'],
}

/** 複数選択の設問の選択肢 */
const MANAGE_WHERE = [
  'Moodleを都度見る',
  'スマホのカレンダー',
  'メモアプリ',
  '紙の手帳・ノート',
  '特に管理していない',
  'その他',
]

/** 集計に出す順番(選択肢の並び順を固定するため) */
const ORDER: Record<string, string[]> = { ...ALLOWED, manage_where: MANAGE_WHERE }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // --- 集計の取得 ---
  if (req.method === 'GET') {
    const token = new URL(req.url).searchParams.get('token') ?? ''
    const expected = Deno.env.get('SURVEY_TOKEN') ?? ''
    if (!expected || token !== expected) return json({ error: 'unauthorized' }, 401)

    const { data, error } = await admin
      .from('survey_responses')
      .select('*')
      .order('created_at', { ascending: true })
    if (error) return json({ error: error.message }, 500)
    const rows = data ?? []

    // deno-lint-ignore no-explicit-any
    const counts: Record<string, Record<string, number>> = {}
    for (const key of Object.keys(ORDER)) {
      counts[key] = {}
      for (const opt of ORDER[key]) counts[key][opt] = 0
    }
    const comments: string[] = []
    for (const r of rows) {
      for (const key of Object.keys(ALLOWED)) {
        // deno-lint-ignore no-explicit-any
        const v = (r as any)[key]
        if (v && counts[key][v] !== undefined) counts[key][v] += 1
      }
      // deno-lint-ignore no-explicit-any
      for (const v of ((r as any).manage_where ?? []) as string[]) {
        if (counts.manage_where[v] !== undefined) counts.manage_where[v] += 1
      }
      // deno-lint-ignore no-explicit-any
      const c = ((r as any).comment ?? '').trim()
      if (c) comments.push(c)
    }

    // 発表で使いやすい形にまとめた数字
    const total = rows.length
    const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10)
    const highlights = {
      '3つ以上のシステムを使う':
        pct(counts.system_count['3つ'] + counts.system_count['4つ以上']),
      '締め切りを忘れそうになる(よくある+たまにある)':
        pct(counts.near_miss['よくある'] + counts.near_miss['たまにある']),
      '実際に間に合わなかったことがある': pct(counts.missed['ある']),
      'Moodleが使いにくい': pct(counts.moodle_usability['使いにくい']),
      '自動通知を使いたい': pct(counts.want_notify['使いたい']),
    }

    return json({ total, counts, highlights, comments })
  }

  // --- 回答の保存 ---
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  // deno-lint-ignore no-explicit-any
  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad json' }, 400)
  }

  // 選択肢にない値は捨てる(nullで保存する)
  // deno-lint-ignore no-explicit-any
  const row: Record<string, any> = {}
  for (const key of Object.keys(ALLOWED)) {
    const v = body?.[key]
    row[key] = typeof v === 'string' && ALLOWED[key].includes(v) ? v : null
  }
  const where = Array.isArray(body?.manage_where) ? body.manage_where : []
  row.manage_where = where.filter((v: unknown) => typeof v === 'string' && MANAGE_WHERE.includes(v))
  const comment = typeof body?.comment === 'string' ? body.comment.trim().slice(0, 500) : ''
  row.comment = comment || null

  // 全部空の送信は受け付けない(誤操作・いたずら対策)
  const answered =
    Object.keys(ALLOWED).some((k) => row[k] !== null) || row.manage_where.length > 0
  if (!answered) return json({ error: 'empty' }, 400)

  const { error } = await admin.from('survey_responses').insert(row)
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true })
})
