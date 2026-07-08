// サキヨミ(仮) 講義資料取得 Edge Function
// ユーザー本人のJWTで呼ばれ、保存済みのMoodleトークンで
// - courseId なし → 履修中の講義一覧
// - courseId あり → その講義の資料ファイル一覧(ダウンロードURLはトークン付与済み)
// を返す。
// デプロイ: npx supabase functions deploy moodle-materials --project-ref kdyffkcowdkbgtbledbc
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const jwt = (req.headers.get('authorization') ?? '').replace('Bearer ', '')
  const { data: userData } = await admin.auth.getUser(jwt)
  if (!userData?.user) return json({ error: 'ログインしてから操作してください' }, 401)

  const { data: s } = await admin
    .from('user_settings')
    .select('moodle_url, moodle_token')
    .eq('user_id', userData.user.id)
    .maybeSingle()
  if (!s?.moodle_token) return json({ error: '先にMoodleと連携してください' })

  let courseId: number | undefined
  try {
    const body = await req.json()
    if (body.courseId) courseId = Number(body.courseId)
  } catch {
    courseId = undefined
  }

  try {
    if (!courseId) {
      const site = await callMoodle(s.moodle_url, s.moodle_token, 'core_webservice_get_site_info')
      const courses = await callMoodle(s.moodle_url, s.moodle_token, 'core_enrol_get_users_courses', {
        userid: String(site.userid),
      })
      return json({
        // deno-lint-ignore no-explicit-any
        courses: (courses as any[]).map((c) => ({ id: c.id, name: c.fullname })),
      })
    }

    const sections = await callMoodle(s.moodle_url, s.moodle_token, 'core_course_get_contents', {
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
            url: isExternalUrl ? c.fileurl : withToken(c.fileurl, s.moodle_token),
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
