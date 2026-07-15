// UniPort 授業開始前の通知 Edge Function
// 5分おきのpg_cron(class-notify-5min)で呼ばれ、ユーザーごとに:
//   設定した「◯分前」に、今日・現在の学期の授業の開始が近づいたらプッシュ通知する。
// ステートレス設計(直近5分の実行ウィンドウをまたいだ授業を通知)なので追加テーブル不要。
// デプロイ: npx supabase functions deploy class-notify --project-ref kdyffkcowdkbgtbledbc
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push'

const HOUR = 3600 * 1000
const WINDOW = 5 * 60 * 1000 // cronが5分おきなので、しきい値は各回で一度だけまたぐ

// 標準的な時限の開始時刻(JST)。時間割タブの表示と一致
const PERIOD_START: Record<number, string> = {
  1: '08:50',
  2: '10:30',
  3: '13:00',
  4: '14:40',
  5: '16:20',
  6: '18:00',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 日本の学年度(4月始まり) */
function academicYear(jst: Date): number {
  const m = jst.getUTCMonth() + 1
  return m >= 4 ? jst.getUTCFullYear() : jst.getUTCFullYear() - 1
}
function currentTerm(jst: Date): string {
  const m = jst.getUTCMonth() + 1
  return m >= 4 && m <= 9 ? '1学期' : '2学期'
}
function defaultSemester(jst: Date): string {
  return `${academicYear(jst)} ${currentTerm(jst)}`
}

function crossed(thresholdMs: number, nowMs: number): boolean {
  return thresholdMs <= nowMs && thresholdMs > nowMs - WINDOW
}

async function sendToSubs(
  admin: SupabaseClient,
  subs: { id: string; endpoint: string; p256dh: string; auth: string }[],
  payload: { title: string; body: string; url: string },
): Promise<number> {
  let sent = 0
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      )
      sent++
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        await admin.from('push_subscriptions').delete().eq('id', sub.id)
      }
    }
  }
  return sent
}

interface SlotLite {
  day: number
  period: number
  course: string
  room: string | null
  semester: string
}

Deno.serve(async (req) => {
  if (req.headers.get('x-sync-secret') !== Deno.env.get('SYNC_SECRET')) {
    return json({ error: 'unauthorized' }, 401)
  }
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT')!,
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  )
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const nowMs = Date.now()
  const jst = new Date(nowMs + 9 * HOUR)
  const todayStr = jst.toISOString().slice(0, 10) // JSTの日付(YYYY-MM-DD)
  const jsDay = jst.getUTCDay() // 0=日〜6=土(JST)
  const todayDayValue = jsDay === 0 ? 7 : jsDay - 1 // 月〜土=0〜5, 日=7

  const { data: users } = await admin
    .from('user_settings')
    .select('user_id, class_reminder_minutes, current_semester')
  const results = []
  for (const s of users ?? []) {
    const minutes = s.class_reminder_minutes
    if (!minutes || minutes <= 0) continue

    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', s.user_id)
    if (!subs || subs.length === 0) continue

    const semester = s.current_semester ?? defaultSemester(jst)
    const { data: slotRows } = await admin
      .from('timetable_slots')
      .select('day, period, course, room, semester')
      .eq('user_id', s.user_id)
      .eq('day', todayDayValue)
      .eq('semester', semester)
    const slots = (slotRows ?? []) as SlotLite[]

    const lines: string[] = []
    for (const slot of slots) {
      const start = PERIOD_START[slot.period]
      if (!start) continue
      const startMs = Date.parse(`${todayStr}T${start}:00+09:00`)
      if (Number.isNaN(startMs)) continue
      const remindMs = startMs - minutes * 60 * 1000
      if (crossed(remindMs, nowMs)) {
        lines.push(slot.room ? `${slot.course}(${slot.room})` : slot.course)
      }
    }

    let sent = 0
    if (lines.length > 0) {
      sent = await sendToSubs(admin, subs, {
        title: `🔔 まもなく授業(${minutes}分前)`,
        body: lines.join('\n'),
        url: './',
      })
    }
    results.push({ userId: s.user_id, matched: lines.length, sent })
  }
  return json({ results })
})
