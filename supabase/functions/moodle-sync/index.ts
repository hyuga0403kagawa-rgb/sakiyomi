// サキヨミ(仮) Moodle同期 Edge Function(デプロイ済みコードの控え)
// - cron(x-sync-secretヘッダー)で呼ばれると全ユーザーを同期
// - アプリ(ユーザーのJWT)で呼ばれるとそのユーザーだけ同期
// デプロイ先: Supabase Edge Functions (関数名: moodle-sync, Verify JWT: OFF)
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function cleanTitle(name: string) {
  const m = name.match(/^「(.+)」の(提出期限|受験終了日時|期限)$/)
  return (m ? m[1] : name).split(/\s+/).join('')
}

// deno-lint-ignore no-explicit-any
async function syncUser(admin: any, userId: string) {
  const { data: s } = await admin.from('user_settings').select('*').eq('user_id', userId).maybeSingle()
  if (!s || !s.moodle_token) return { userId, skipped: 'no token' }

  const params = new URLSearchParams({
    wstoken: s.moodle_token,
    wsfunction: 'core_calendar_get_action_events_by_timesort',
    moodlewsrestformat: 'json',
    timesortfrom: String(Math.floor(Date.now() / 1000) - 14 * 86400),
    limitnum: '50',
  })
  const res = await fetch(s.moodle_url + '/webservice/rest/server.php?' + params.toString())
  if (!res.ok) return { userId, error: 'moodle http ' + res.status }
  const data = await res.json()
  if (data.errorcode || data.exception) return { userId, error: data.errorcode ?? 'moodle error' }
  const events = data.events ?? []

  const { data: existing } = await admin
    .from('tasks')
    .select('id, moodle_event_id, done')
    .eq('user_id', userId)
    .eq('source', 'moodle')
  // deno-lint-ignore no-explicit-any
  const eventIds = new Set(events.map((e: any) => e.id))
  const submitted = (existing ?? [])
    // deno-lint-ignore no-explicit-any
    .filter((t: any) => !eventIds.has(t.moodle_event_id) && !t.done)
    // deno-lint-ignore no-explicit-any
    .map((t: any) => t.id)
  if (submitted.length > 0) {
    await admin.from('tasks').update({ done: true }).in('id', submitted)
  }

  if (events.length > 0) {
    // deno-lint-ignore no-explicit-any
    const rows = events.map((ev: any) => ({
      user_id: userId,
      title: cleanTitle(ev.activityname || ev.name || ''),
      course: ev.course?.fullname ?? null,
      due: new Date(ev.timesort * 1000).toISOString(),
      source: 'moodle',
      moodle_event_id: ev.id,
    }))
    const { error } = await admin.from('tasks').upsert(rows, { onConflict: 'user_id,moodle_event_id' })
    if (error) return { userId, error: error.message }
  }

  await admin
    .from('user_settings')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('user_id', userId)
  return { userId, pending: events.length, submitted: submitted.length }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const secret = req.headers.get('x-sync-secret')
  if (secret) {
    if (secret !== Deno.env.get('SYNC_SECRET')) return json({ error: 'bad secret' }, 401)
    const { data } = await admin.from('user_settings').select('user_id').neq('moodle_token', '')
    const results = []
    for (const row of data ?? []) results.push(await syncUser(admin, row.user_id))
    return json({ mode: 'cron', results })
  }

  const jwt = (req.headers.get('authorization') ?? '').replace('Bearer ', '')
  const { data: userData } = await admin.auth.getUser(jwt)
  if (!userData?.user) return json({ error: 'unauthorized' }, 401)
  const result = await syncUser(admin, userData.user.id)
  return json({ mode: 'user', result })
})
