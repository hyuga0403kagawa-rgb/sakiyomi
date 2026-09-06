// UniPort カレンダー購読フィード Edge Function
// - POST(ユーザーJWT): 本人の購読URL(秘密トークン付き)を発行して返す。
//   { regenerate: true } で再発行(前のURLは無効になる)。
// - GET ?token=...: そのユーザーの予定を iCalendar(ICS) 形式で返す。
//   Googleカレンダー/iPhoneカレンダーの「URLで追加(照会)」から購読する。
// 内容: 未提出課題の提出期限 / 現在の学期の時間割(毎週繰り返し) / 就活の予定。
// トークンを知っている人は予定を読めるため、URLは本人だけが扱う前提(再発行で無効化可)。
// デプロイ: npx supabase functions deploy calendar-feed --project-ref kdyffkcowdkbgtbledbc
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const HOUR = 3600 * 1000

// 標準的な時限時刻(JST)。src/periods.ts と同じ値
const PERIOD_TIMES: Record<number, [string, string]> = {
  1: ['08:50', '10:20'],
  2: ['10:30', '12:00'],
  3: ['13:00', '14:30'],
  4: ['14:40', '16:10'],
  5: ['16:20', '17:50'],
  6: ['18:00', '19:30'],
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/** 学年度(4月始まり・JST) */
function defaultSemester(jst: Date): string {
  const m = jst.getUTCMonth() + 1
  const year = m >= 4 ? jst.getUTCFullYear() : jst.getUTCFullYear() - 1
  const term = m >= 4 && m <= 9 ? '1学期' : '2学期'
  return `${year} ${term}`
}

/** 学期の開始日・終了日(JSTの日付文字列)。授業の繰り返し予定の範囲を区切る。
 *  クォーター(3/4学期)は大学ごとに幅があるため概算で区切る */
function termRange(semester: string): { start: string; end: string } {
  const idx = semester.indexOf(' ')
  const year = idx === -1 ? new Date().getUTCFullYear() : parseInt(semester.slice(0, idx))
  const term = idx === -1 ? semester : semester.slice(idx + 1)
  switch (term) {
    case '1学期':
      return { start: `${year}-04-01`, end: `${year}-09-30` }
    case '2学期':
      return { start: `${year}-10-01`, end: `${year + 1}-03-31` }
    case '3学期':
      return { start: `${year}-10-01`, end: `${year}-12-31` }
    case '4学期':
      return { start: `${year}-12-01`, end: `${year + 1}-03-31` }
    default: // 通年など
      return { start: `${year}-04-01`, end: `${year + 1}-03-31` }
  }
}

/** ICSのテキスト値エスケープ */
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

/** DateをICSのUTC日時(例 20260722T030000Z)に */
function icsUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
}

interface Vevent {
  uid: string
  summary: string
  start: string // ICS形式の日時 or 日付
  end?: string
  allDay?: boolean
  rrule?: string
  location?: string
}

function buildIcs(events: Vevent[], stamp: Date): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//UniPort//calendar-feed//JA',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:UniPort',
    'X-WR-TIMEZONE:Asia/Tokyo',
  ]
  for (const e of events) {
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${e.uid}@uniport`)
    lines.push(`DTSTAMP:${icsUtc(stamp)}`)
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${e.start}`)
      if (e.end) lines.push(`DTEND;VALUE=DATE:${e.end}`)
    } else {
      lines.push(`DTSTART:${e.start}`)
      if (e.end) lines.push(`DTEND:${e.end}`)
    }
    if (e.rrule) lines.push(`RRULE:${e.rrule}`)
    lines.push(`SUMMARY:${esc(e.summary)}`)
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

/** カレンダーに含める種類のオン/オフ */
interface FeedOptions {
  tasks: boolean
  exams: boolean
  timetable: boolean
  jobs: boolean
}

// deno-lint-ignore no-explicit-any
async function buildFeed(
  // deno-lint-ignore no-explicit-any
  admin: any,
  userId: string,
  currentSemester: string | null,
  opts: FeedOptions,
): Promise<string> {
  const now = new Date()
  const jst = new Date(now.getTime() + 9 * HOUR)
  const events: Vevent[] = []

  // --- 1. 課題の提出期限 / テスト(小テスト・試験)の日程(過去30日〜) ---
  // Moodleの 'quiz' はテスト、それ以外(assign など)と手動タスクは課題として扱い、
  // それぞれ別々にオン/オフできるようにする。
  if (opts.tasks || opts.exams) {
    const { data: tasks } = await admin
      .from('tasks')
      .select('id, title, course, due, done, moodle_module')
      .eq('user_id', userId)
      .eq('done', false)
      .not('due', 'is', null)
      .gte('due', new Date(now.getTime() - 30 * 24 * HOUR).toISOString())
    // deno-lint-ignore no-explicit-any
    for (const t of tasks ?? []) {
      const isExam = t.moodle_module === 'quiz'
      if (isExam && !opts.exams) continue
      if (!isExam && !opts.tasks) continue
      const due = new Date(t.due)
      events.push({
        uid: `task-${t.id}`,
        summary: isExam ? `📝 ${t.title} 終了` : `🔔 ${t.title} 提出期限`,
        start: icsUtc(due),
        end: icsUtc(due),
        location: t.course ?? undefined,
      })
    }
  }

  // --- 2. 現在の学期の時間割(毎週繰り返し) ---
  if (opts.timetable) {
    const semester = currentSemester ?? defaultSemester(jst)
    const range = termRange(semester)
    const { data: slots } = await admin
      .from('timetable_slots')
      .select('id, day, period, course, room')
      .eq('user_id', userId)
      .eq('semester', semester)
    // deno-lint-ignore no-explicit-any
    for (const s of slots ?? []) {
      if (s.day === 6) continue // オンデマンドは時刻がないので出さない
      const times = PERIOD_TIMES[s.period]
      if (!times) continue
      // day: 0=月〜5=土, 7=日 → JSの曜日(0=日〜6=土)
      const targetDow = s.day === 7 ? 0 : s.day + 1
      // 初回: 「学期開始日」と「1週間前」の遅い方から、対象曜日まで進める(JSTで計算)
      const weekAgo = new Date(now.getTime() - 7 * 24 * HOUR)
      const baseMs = Math.max(Date.parse(`${range.start}T00:00:00+09:00`), weekAgo.getTime())
      const base = new Date(baseMs + 9 * HOUR) // JST壁時計
      const add = (targetDow - base.getUTCDay() + 7) % 7
      const firstDate = new Date(baseMs + add * 24 * HOUR + 9 * HOUR)
        .toISOString()
        .slice(0, 10)
      const startMs = Date.parse(`${firstDate}T${times[0]}:00+09:00`)
      const endMs = Date.parse(`${firstDate}T${times[1]}:00+09:00`)
      const untilMs = Date.parse(`${range.end}T23:59:59+09:00`)
      if (startMs > untilMs) continue // 学期が終わっている
      events.push({
        uid: `slot-${s.id}`,
        summary: `${s.course}(${s.period}限)`,
        start: icsUtc(new Date(startMs)),
        end: icsUtc(new Date(endMs)),
        rrule: `FREQ=WEEKLY;UNTIL=${icsUtc(new Date(untilMs))}`,
        location: s.room ?? undefined,
      })
    }
  }

  // --- 3. 就活の予定(終日) ---
  if (opts.jobs) {
    const { data: jobs } = await admin
      .from('job_entries')
      .select('id, company, entry_type, deadline, done')
      .eq('user_id', userId)
      .eq('done', false)
      .not('deadline', 'is', null)
    // deno-lint-ignore no-explicit-any
    for (const j of jobs ?? []) {
      const d = String(j.deadline) // YYYY-MM-DD
      const next = new Date(Date.parse(`${d}T00:00:00Z`) + 24 * HOUR).toISOString().slice(0, 10)
      events.push({
        uid: `job-${j.id}`,
        summary: `💼 ${j.company}(${j.entry_type})`,
        start: d.replaceAll('-', ''),
        end: next.replaceAll('-', ''),
        allDay: true,
      })
    }
  }

  return buildIcs(events, now)
}

function newToken(): string {
  return crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // --- GET: トークンでICSを返す(カレンダーアプリからの定期取得) ---
  if (req.method === 'GET') {
    const token = new URL(req.url).searchParams.get('token') ?? ''
    if (token.length < 32) return json({ error: 'bad token' }, 400)
    const { data: s } = await admin
      .from('user_settings')
      .select(
        'user_id, current_semester, calendar_tasks, calendar_exams, calendar_timetable, calendar_jobs',
      )
      .eq('ical_token', token)
      .maybeSingle()
    if (!s) return json({ error: 'not found' }, 404)
    const ics = await buildFeed(admin, s.user_id, s.current_semester, {
      // 列が無い/未設定の場合は「オン」に倒す(既定はすべてオン)
      tasks: s.calendar_tasks !== false,
      exams: s.calendar_exams !== false,
      timetable: s.calendar_timetable !== false,
      jobs: s.calendar_jobs !== false,
    })
    return new Response(ics, {
      headers: { ...CORS, 'Content-Type': 'text/calendar; charset=utf-8' },
    })
  }

  // --- POST(ユーザーJWT): 購読URLを発行 ---
  const jwt = (req.headers.get('authorization') ?? '').replace('Bearer ', '')
  const { data: userData } = await admin.auth.getUser(jwt)
  if (!userData?.user) return json({ error: 'unauthorized' }, 401)
  const userId = userData.user.id

  let regenerate = false
  try {
    regenerate = (await req.json())?.regenerate === true
  } catch {
    regenerate = false
  }

  const { data: s } = await admin
    .from('user_settings')
    .select('ical_token')
    .eq('user_id', userId)
    .maybeSingle()

  let token = s?.ical_token as string | null
  if (!token || regenerate) {
    token = newToken()
    const { error } = await admin
      .from('user_settings')
      .upsert({ user_id: userId, ical_token: token }, { onConflict: 'user_id' })
    if (error) return json({ error: error.message }, 500)
  }

  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/calendar-feed?token=${token}`
  return json({ url })
})
