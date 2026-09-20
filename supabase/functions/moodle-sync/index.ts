// サキヨミ(仮) Moodle同期 Edge Function(デプロイ済みコードの控え)
// - cron(x-sync-secretヘッダー)で呼ばれると全ユーザーを同期
// - アプリ(ユーザーのJWT)で呼ばれるとそのユーザーだけ同期
// - アプリから { icalUrl } つきで呼ばれると、カレンダーURL方式の連携を登録/解除してから同期
// デプロイ先: Supabase Edge Functions (関数名: moodle-sync, Verify JWT: OFF)
//
// 取り込み元は2つある(片方だけでも動く):
//  A. API方式      … moodle_token があるとき。提出済みの自動判定までできる
//  B. カレンダーURL方式 … ical_import_url があるとき(知プラe など、APIが使えないMoodle向け)。
//                      期限は取れるが、提出済みかどうかは分からない
import { createClient } from 'npm:@supabase/supabase-js@2'
import { ICAL_ID_OFFSET, guessModule, isDeadline, normalizeIcalUrl, parseIcs } from './ical.ts'

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
  // 空白は詰めずに1つにそろえる(「レポート3 過渡応答」の区切りが消えると読みにくいため)
  return (m ? m[1] : name).replace(/\s+/g, ' ').trim()
}

/** Moodleの説明文(HTML)を、アプリでそのまま表示できるテキストにする */
function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null
  const text = html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '・')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text ? text.slice(0, 2000) : null
}

const LOOKBACK_DAYS = 14
const LIMIT = 50 // Moodle側の1回あたりの上限
const MAX_PAGES = 6 // 50件 × 6 = 300件まで取りに行く

/**
 * 予定を最後のページまで取得する。
 * 以前は先頭の50件だけを取っていたため、予定が50件を超えると後ろの課題が
 * アプリに出てこなかった。aftereventid で続きを取りに行く。
 */
// deno-lint-ignore no-explicit-any
async function fetchAllEvents(s: any, timesortfromSec: number): Promise<{ events?: any[]; truncated?: boolean; error?: string }> {
  // deno-lint-ignore no-explicit-any
  const events: any[] = []
  const seen = new Set<number>()
  let after: number | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      wstoken: s.moodle_token,
      wsfunction: 'core_calendar_get_action_events_by_timesort',
      moodlewsrestformat: 'json',
      timesortfrom: String(timesortfromSec),
      limitnum: String(LIMIT),
    })
    if (after !== undefined) params.set('aftereventid', String(after))
    const res = await fetch(s.moodle_url + '/webservice/rest/server.php?' + params.toString())
    if (!res.ok) return { error: 'moodle http ' + res.status }
    const data = await res.json()
    if (data.errorcode || data.exception) return { error: data.errorcode ?? 'moodle error' }
    // deno-lint-ignore no-explicit-any
    const batch: any[] = data.events ?? []
    for (const ev of batch) {
      if (!seen.has(ev.id)) {
        seen.add(ev.id)
        events.push(ev)
      }
    }
    if (batch.length < LIMIT) return { events, truncated: false }
    after = batch[batch.length - 1].id
  }
  // 上限ページまで取っても続きがある = まだ取りこぼしがあり得る
  return { events, truncated: true }
}

/** 同期の失敗を記録する(アプリの警告表示と、続いたときのプッシュ通知に使う) */
// deno-lint-ignore no-explicit-any
async function recordSyncError(admin: any, userId: string, prevCount: number, message: string) {
  await admin
    .from('user_settings')
    .update({ last_sync_error: message.slice(0, 200), sync_error_count: prevCount + 1 })
    .eq('user_id', userId)
}

/** A. API方式の同期。成功なら件数、失敗なら error を返す(記録は呼び出し側でまとめて行う) */
// deno-lint-ignore no-explicit-any
async function syncViaApi(admin: any, userId: string, s: any) {
  const timesortfromSec = Math.floor(Date.now() / 1000) - LOOKBACK_DAYS * 86400
  // deno-lint-ignore no-explicit-any
  let fetched: { events?: any[]; truncated?: boolean; error?: string }
  try {
    fetched = await fetchAllEvents(s, timesortfromSec)
  } catch (e) {
    fetched = { error: 'fetch failed: ' + String(e).slice(0, 120) }
  }
  if (fetched.error) return { error: fetched.error }
  const events = fetched.events ?? []

  const { data: existing } = await admin
    .from('tasks')
    .select('id, moodle_event_id, done, due')
    .eq('user_id', userId)
    .eq('source', 'moodle')
    // カレンダーURL方式で入った課題はAPIの一覧に出てこないので、提出済みの判定対象から外す
    .lt('moodle_event_id', ICAL_ID_OFFSET)
  // deno-lint-ignore no-explicit-any
  const eventIds = new Set(events.map((e: any) => e.id))
  // 「イベント一覧から消えた = 提出した」とみなして done 化する。ただし、取得しきれなかった
  // だけの未提出課題を「提出済み」にしてしまわないよう、確実に取得範囲内にあるはずの
  // 課題だけを対象にする:
  //  - 最後のページまで取りきれなかった回は取りこぼしがあり得るので、一切 done 化しない
  //  - 期限が lookback より古い課題は範囲外に落ちた可能性があるので触らない
  //  - 期限不明の課題も安全側に倒して触らない(手動で完了にはできる)
  const submitted = fetched.truncated
    ? []
    : (existing ?? [])
        // deno-lint-ignore no-explicit-any
        .filter((t: any) => !eventIds.has(t.moodle_event_id) && !t.done && t.due)
        // deno-lint-ignore no-explicit-any
        .filter((t: any) => new Date(t.due).getTime() / 1000 >= timesortfromSec)
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
      // 'quiz'(小テスト・試験)と 'assign'(課題)などを区別する。
      // カレンダー連携で「テスト」と「課題」を別々にオン/オフするために保存する。
      moodle_module: ev.modulename ?? null,
      // 課題の詳細画面用: 提出ページへの直接リンクと、Moodleに書かれている説明文
      moodle_url: ev.action?.url ?? ev.url ?? null,
      description: htmlToText(ev.description),
    }))
    const { error } = await admin.from('tasks').upsert(rows, { onConflict: 'user_id,moodle_event_id' })
    if (error) return { error: 'db: ' + error.message }
  }
  return { pending: events.length, submitted: submitted.length, truncated: fetched.truncated }
}

/** B. カレンダーURL方式の取り込み。成功なら件数、失敗なら error を返す */
// deno-lint-ignore no-explicit-any
async function syncViaIcal(admin: any, userId: string, icalUrl: string) {
  // 保存済みのURLでも、読みに行く直前にもう一度行き先を検証する
  const checked = normalizeIcalUrl(icalUrl)
  if ('error' in checked) return { error: 'ical: invalid url' }

  let text: string
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15_000)
    const res = await fetch(checked.url, { signal: ctrl.signal, redirect: 'error' })
    clearTimeout(timer)
    if (!res.ok) return { error: 'ical: http ' + res.status }
    text = (await res.text()).slice(0, 2_000_000)
  } catch (e) {
    return { error: 'ical: fetch failed: ' + String(e).slice(0, 80) }
  }
  // URLの鍵が無効になるとMoodleは本文だけのエラーを返す(年度の切り替わりで起きる)
  if (!text.includes('BEGIN:VCALENDAR')) {
    return { error: /invalid authentication/i.test(text) ? 'ical: invalid authentication' : 'ical: not a calendar' }
  }

  const deadlines = parseIcs(text).filter((ev) => isDeadline(ev.summary))
  if (deadlines.length > 0) {
    const rows = deadlines.map((ev) => ({
      user_id: userId,
      title: cleanTitle(ev.summary),
      course: ev.course,
      due: ev.start.toISOString(),
      source: 'moodle',
      moodle_event_id: ICAL_ID_OFFSET + ev.id,
      moodle_module: guessModule(ev.summary),
      // カレンダーには提出ページのURLが入っていないので、サイトのトップを入れておく
      moodle_url: new URL(checked.url).origin + new URL(checked.url).pathname.replace(/\/calendar\/export_execute\.php$/, '/'),
      description: ev.description ? ev.description.slice(0, 2000) : null,
    }))
    const { error } = await admin.from('tasks').upsert(rows, { onConflict: 'user_id,moodle_event_id' })
    if (error) return { error: 'ical: db: ' + error.message }
  }
  return { imported: deadlines.length }
}

// deno-lint-ignore no-explicit-any
async function syncUser(admin: any, userId: string) {
  const { data: s } = await admin.from('user_settings').select('*').eq('user_id', userId).maybeSingle()
  const hasApi = Boolean(s?.moodle_token)
  const hasIcal = Boolean(s?.ical_import_url)
  if (!s || (!hasApi && !hasIcal)) return { userId, skipped: 'no source' }
  const prevErrors = Number(s.sync_error_count ?? 0)

  // 2つの取り込み元は独立に動かす(片方の失敗で、もう片方の課題まで止めない)
  const api = hasApi ? await syncViaApi(admin, userId, s) : null
  const ical = hasIcal ? await syncViaIcal(admin, userId, s.ical_import_url) : null

  const errors = [api?.error, ical?.error].filter(Boolean) as string[]
  const anySuccess = (api && !api.error) || (ical && !ical.error)

  if (anySuccess) {
    await admin
      .from('user_settings')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('user_id', userId)
  }
  if (errors.length > 0) {
    await recordSyncError(admin, userId, prevErrors, errors.join(' / '))
  } else if (s.last_sync_error || prevErrors > 0 || s.sync_error_notified) {
    // 失敗の記録を消す(別の更新にしてあるのは、こちらが万一失敗しても同期時刻の更新を巻き込まないため)
    await admin
      .from('user_settings')
      .update({ last_sync_error: null, sync_error_count: 0, sync_error_notified: false })
      .eq('user_id', userId)
  }
  return { userId, api, ical, error: errors.length > 0 ? errors.join(' / ') : undefined }
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
    const { data: withToken } = await admin.from('user_settings').select('user_id').neq('moodle_token', '')
    const { data: withIcal } = await admin
      .from('user_settings')
      .select('user_id')
      .not('ical_import_url', 'is', null)
    // deno-lint-ignore no-explicit-any
    const ids = [...new Set([...(withToken ?? []), ...(withIcal ?? [])].map((r: any) => r.user_id as string))]
    const results = []
    for (const id of ids) results.push(await syncUser(admin, id))
    // 同期のあとに通知チェックも走らせる(専用cronを増やさずに毎時通知を回すため)
    try {
      await fetch(Deno.env.get('SUPABASE_URL')! + '/functions/v1/push-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sync-secret': secret },
        body: JSON.stringify({}),
      })
    } catch (_) {
      // 通知チェックの失敗は同期結果に影響させない
    }
    return json({ mode: 'cron', results })
  }

  const jwt = (req.headers.get('authorization') ?? '').replace('Bearer ', '')
  const { data: userData } = await admin.auth.getUser(jwt)
  if (!userData?.user) return json({ error: 'unauthorized' }, 401)
  const userId = userData.user.id

  // deno-lint-ignore no-explicit-any
  let body: any = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  // カレンダーURL方式の登録・解除。URLの検証はサーバー側で行い、通ったものだけを保存する
  if (typeof body?.icalUrl === 'string') {
    if (body.icalUrl.trim() === '') {
      // 解除: URLを消し、この方式で取り込んだ課題も消す
      await admin.from('user_settings').update({ ical_import_url: null }).eq('user_id', userId)
      await admin.from('tasks').delete().eq('user_id', userId).gte('moodle_event_id', ICAL_ID_OFFSET)
      return json({ mode: 'ical-disconnect', ok: true })
    }
    const checked = normalizeIcalUrl(body.icalUrl)
    if ('error' in checked) return json({ error: checked.error }, 400)
    // 保存する前に、実際に読めるか試す(読めないURLを登録させない)
    const trial = await syncViaIcal(admin, userId, checked.url)
    if (trial.error) {
      const msg = /invalid authentication/.test(trial.error)
        ? 'このURLではカレンダーを読めませんでした。URLが古いか、途中で切れている可能性があります。もう一度「カレンダーURLを取得」からコピーしてください。'
        : 'カレンダーを読み込めませんでした。URLを確認して、もう一度お試しください。'
      return json({ error: msg }, 400)
    }
    const { error } = await admin
      .from('user_settings')
      .upsert({ user_id: userId, ical_import_url: checked.url }, { onConflict: 'user_id' })
    if (error) return json({ error: '保存に失敗しました' }, 500)
    return json({ mode: 'ical-connect', ok: true, imported: trial.imported })
  }

  const result = await syncUser(admin, userId)
  return json({ mode: 'user', result })
})
