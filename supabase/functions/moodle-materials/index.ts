// サキヨミ(仮) 講義資料取得 Edge Function
//
// POST(ユーザー本人のJWTで呼ぶ):
//   - courseId なし → 履修中の講義一覧
//   - courseId あり → その講義の資料ファイル一覧
//
// GET(資料を開くリンク。アプリの <a href> から新しいタブで開かれる):
//   ?dl=<MoodleのファイルURL>&u=<利用者ID>&e=<期限(Unix秒)>&s=<署名>
//   署名と期限を確かめてから、サーバーが合鍵を付けてMoodleからファイルを取り、そのまま流す。
//
// 2026-09-24 まではファイルURLに合鍵を付けて(?token=…)アプリに渡していた。
// 学生が資料のリンクを人に送ると合鍵ごと渡ってしまうため、合鍵を含まない
// 「期限つき・署名つき」のリンクに変えた。リンクが漏れても、渡るのはその資料1つを
// 期限まで開ける権利だけで、合鍵は渡らない。
// デプロイ: npx supabase functions deploy moodle-materials --project-ref kdyffkcowdkbgtbledbc
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { loadMoodleCredential } from '../_shared/moodleCredential.ts'
import { keysFromEnv, signMaterialLink, verifyMaterialLink } from '../_shared/secret.ts'

/** 資料リンクの有効期限(秒)。講義の詳細を開いてから、この時間内なら開ける */
const LINK_TTL_SEC = 30 * 60

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

/** 資料リンクで失敗したときの案内(ブラウザの新しいタブに表示される) */
function plain(message: string, status: number) {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })
}

async function callMoodle(
  moodleUrl: string,
  token: string,
  wsfunction: string,
  params: Record<string, string> = {},
) {
  const query = new URLSearchParams({
    wstoken: token,
    wsfunction,
    moodlewsrestformat: 'json',
    ...params,
  })
  const res = await fetch(`${moodleUrl}/webservice/rest/server.php?${query}`)
  if (!res.ok) throw new Error(`moodle http ${res.status}`)
  const data = await res.json()
  if (data?.exception || data?.errorcode) throw new Error(data.errorcode ?? 'moodle error')
  return data
}

function withToken(fileurl: string, token: string): string {
  return fileurl + (fileurl.includes('?') ? '&' : '?') + 'token=' + token
}

/** 合鍵を含まない、期限つき・署名つきの資料リンクを作る */
async function materialLink(userId: string, fileUrl: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + LINK_TTL_SEC
  const sig = await signMaterialLink(await keysFromEnv(), userId, exp, fileUrl)
  const q = new URLSearchParams({ dl: fileUrl, u: userId, e: String(exp), s: sig })
  return `${Deno.env.get('SUPABASE_URL')}/functions/v1/moodle-materials?${q}`
}

/** GET: 署名つきリンクから資料を取り出して流す */
async function download(req: Request, admin: SupabaseClient): Promise<Response> {
  const q = new URL(req.url).searchParams
  const fileUrl = q.get('dl') ?? ''
  const userId = q.get('u') ?? ''
  const exp = Number(q.get('e'))
  const sig = q.get('s') ?? ''
  if (!fileUrl || !userId || !sig) return plain('リンクが正しくありません。', 400)

  const ok = await verifyMaterialLink(await keysFromEnv(), userId, exp, fileUrl, sig)
  if (!ok) {
    return plain(
      'この資料のリンクは有効期限が切れたか、正しくありません。\nUniPortのアプリで講義資料を開き直してください。',
      403,
    )
  }

  const cred = await loadMoodleCredential(admin, userId)
  if (!cred) return plain('Moodleとの連携が見つかりません。UniPortで連携をやり直してください。', 403)

  // その人の大学のMoodleの、ファイル配信の入り口だけを許す(他のサイトの取得に使わせない)
  let target: URL
  try {
    target = new URL(fileUrl)
  } catch {
    return plain('リンクが正しくありません。', 400)
  }
  if (target.origin !== new URL(cred.moodleUrl).origin || !target.pathname.includes('/pluginfile.php/')) {
    return plain('このリンクは開けません。', 403)
  }

  const res = await fetch(withToken(fileUrl, cred.token))
  const type = res.headers.get('content-type') ?? 'application/octet-stream'
  // Moodleがエラーページ(HTML)を返したときは、中身を流さずに案内だけ出す
  if (!res.ok || type.startsWith('text/html')) {
    return plain('Moodleから資料を取得できませんでした。時間をおいて開き直してください。', 502)
  }

  const headers = new Headers({
    'Content-Type': type,
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  })
  for (const h of ['content-disposition', 'content-length', 'last-modified']) {
    const v = res.headers.get(h)
    if (v) headers.set(h, v)
  }
  return new Response(res.body, { status: 200, headers })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  if (req.method === 'GET') {
    try {
      return await download(req, admin)
    } catch {
      return plain('資料を開けませんでした。UniPortのアプリで開き直してください。', 500)
    }
  }

  const jwt = (req.headers.get('authorization') ?? '').replace('Bearer ', '')
  const { data: userData } = await admin.auth.getUser(jwt)
  if (!userData?.user) return json({ error: 'ログインしてから操作してください' }, 401)
  const userId = userData.user.id

  let cred
  try {
    cred = await loadMoodleCredential(admin, userId)
  } catch {
    return json({ error: 'Moodleとの連携を読み込めませんでした。設定画面で連携をやり直してください' })
  }
  if (!cred) return json({ error: '先にMoodleと連携してください' })

  let courseId: number | undefined
  try {
    const body = await req.json()
    if (body.courseId) courseId = Number(body.courseId)
  } catch {
    courseId = undefined
  }

  try {
    if (!courseId) {
      const site = await callMoodle(cred.moodleUrl, cred.token, 'core_webservice_get_site_info')
      const courses = await callMoodle(cred.moodleUrl, cred.token, 'core_enrol_get_users_courses', {
        userid: String(site.userid),
      })
      return json({
        // enddate/visible も返す(時間割の講義候補で「終了済み」を除外するため)。
        // enddate は Unix秒。0 のときは終了日なし。visible=0 は非表示コース。
        // deno-lint-ignore no-explicit-any
        courses: (courses as any[]).map((c) => ({
          id: c.id,
          name: c.fullname,
          enddate: c.enddate ?? 0,
          visible: c.visible ?? 1,
        })),
      })
    }

    const sections = await callMoodle(cred.moodleUrl, cred.token, 'core_course_get_contents', {
      courseid: String(courseId),
    })
    const files: unknown[] = []
    // deno-lint-ignore no-explicit-any
    for (const section of sections as any[]) {
      for (const mod of section.modules ?? []) {
        for (const c of mod.contents ?? []) {
          if (!c.fileurl) continue
          const isExternalUrl = mod.modname === 'url'
          files.push({
            section: section.name ?? '',
            module: mod.name ?? '',
            modname: mod.modname ?? '',
            filename: isExternalUrl ? mod.name : (c.filename ?? ''),
            // 外部サイトへのリンクはそのまま。Moodle上のファイルは合鍵を含まない署名つきリンクにする
            url: isExternalUrl ? c.fileurl : await materialLink(userId, c.fileurl),
            mimetype: c.mimetype ?? '',
            filesize: c.filesize ?? 0,
            timemodified: c.timemodified ?? 0,
          })
        }
      }
    }
    return json({ files })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    if (msg === 'invalidtoken') return json({ error: 'トークンが無効です。設定画面で連携をやり直してください' })
    return json({ error: `Moodleから取得できませんでした (${msg})` })
  }
})
