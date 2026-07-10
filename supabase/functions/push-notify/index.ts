// サキヨミ(仮) プッシュ通知 Edge Function
// 毎時cron(moodle-sync経由、x-sync-secret)で呼ばれ、ユーザーごとに:
// 1. 期限リマインダー: 直近1時間あまりの間に「しきい値」をまたいだ課題を通知
//    (新しい課題 / 締切3日前 / 明日 / 今日 / 期限切れ)。状態を持たない設計なので
//    追加のテーブルは不要。cronが1時間ごとに動くことが前提。
// 2. 毎日のまとめ: notify_time を過ぎていて今日まだ送っていなければ、未提出一覧を送る。
// force=true で時刻・通知済み判定を無視してまとめを即送信(テスト用)。
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push'

const HOUR = 3600 * 1000
const WINDOW = 65 * 60 * 1000 // cronの毎時実行+ズレ吸収ぶん

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

interface TaskLite {
  title: string
  due: string | null
  done: boolean
  source: string
  created_at: string
}

/** t(ミリ秒)を直近のcron実行ウィンドウ内にまたいだか */
function crossed(thresholdMs: number, nowMs: number): boolean {
  return thresholdMs <= nowMs && thresholdMs > nowMs - WINDOW
}

interface JobEntryLite {
  company: string
  entry_type: string
  deadline: string | null
  done: boolean
}

/** 就活の予定(説明会・締切など)の前日18時・当日8時にまたいだものを通知する */
function buildJobReminderLines(entries: JobEntryLite[], nowMs: number): string[] {
  const lines: string[] = []
  for (const e of entries) {
    if (e.done || !e.deadline) continue
    // deadline は YYYY-MM-DD。その日のJST 0時をミリ秒に変換
    const midnightJst = Date.parse(`${e.deadline}T00:00:00+09:00`)
    if (Number.isNaN(midnightJst)) continue
    const sameDay = midnightJst + 8 * HOUR // 当日 8:00 JST
    const dayBefore = midnightJst - 6 * HOUR // 前日 18:00 JST
    if (crossed(sameDay, nowMs)) lines.push(`🔔 今日: ${e.company}(${e.entry_type})`)
    else if (crossed(dayBefore, nowMs)) lines.push(`📌 明日: ${e.company}(${e.entry_type})`)
  }
  return lines
}

function buildReminderLines(tasks: TaskLite[], nowMs: number): string[] {
  const lines: string[] = []
  for (const t of tasks) {
    if (t.done) continue
    if (
      t.source === 'moodle' &&
      t.created_at &&
      nowMs - new Date(t.created_at).getTime() <= WINDOW
    ) {
      lines.push(`🆕 新しい課題: ${t.title}`)
      continue
    }
    if (!t.due) continue
    const dueMs = new Date(t.due).getTime()
    if (crossed(dueMs, nowMs)) lines.push(`🚨 期限切れ(未提出): ${t.title}`)
    else if (crossed(dueMs - 6 * HOUR, nowMs)) lines.push(`🔥 今日締切(あと6時間): ${t.title}`)
    else if (crossed(dueMs - 24 * HOUR, nowMs)) lines.push(`⏰ 明日が締切: ${t.title}`)
    else if (crossed(dueMs - 72 * HOUR, nowMs)) lines.push(`📅 締切まで3日: ${t.title}`)
  }
  return lines
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

Deno.serve(async (req) => {
  if (req.headers.get('x-sync-secret') !== Deno.env.get('SYNC_SECRET')) {
    return json({ error: 'unauthorized' }, 401)
  }
  let force = false
  try {
    force = (await req.json())?.force === true
  } catch {
    force = false
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
  const today = jst.toISOString().slice(0, 10)
  const hm = jst.toISOString().slice(11, 16)

  const { data: users } = await admin.from('user_settings').select('*')
  const results = []
  for (const s of users ?? []) {
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', s.user_id)
    if (!subs || subs.length === 0) continue

    const { data: taskRows } = await admin
      .from('tasks')
      .select('title, due, done, source, created_at')
      .eq('user_id', s.user_id)
    const tasks = (taskRows ?? []) as TaskLite[]

    // --- 1. 期限リマインダー(毎時・ステートレス) ---
    const lines = buildReminderLines(tasks, nowMs)
    let reminded = 0
    if (lines.length > 0) {
      let body = lines.slice(0, 5).join('\n')
      if (lines.length > 5) body += `\nほか${lines.length - 5}件`
      reminded = await sendToSubs(admin, subs, {
        title: '📢 課題アラート',
        body,
        url: './',
      })
    }

    // --- 1.5 就活の予定リマインダー(前日・当日) ---
    const { data: jobRows } = await admin
      .from('job_entries')
      .select('company, entry_type, deadline, done')
      .eq('user_id', s.user_id)
    const jobLines = buildJobReminderLines((jobRows ?? []) as JobEntryLite[], nowMs)
    let jobReminded = 0
    if (jobLines.length > 0) {
      jobReminded = await sendToSubs(admin, subs, {
        title: '💼 就活の予定',
        body: jobLines.slice(0, 5).join('\n'),
        url: './',
      })
    }

    // --- 2. 毎日のまとめ(notify_time以降・1日1回) ---
    let summarized = 0
    const summaryDue = force || ((s.notified_date ?? '') !== today && hm >= (s.notify_time || '18:00'))
    if (summaryDue) {
      const pending = tasks
        .filter((t) => !t.done && t.due)
        .sort((a, b) => new Date(a.due!).getTime() - new Date(b.due!).getTime())
      let title: string, body: string
      if (pending.length === 0) {
        title = '✅ 未提出の課題はありません'
        body = '今日もおつかれさま!'
      } else {
        title = `📚 未提出の課題が${pending.length}件`
        body = pending
          .slice(0, 3)
          .map((t) => {
            const d = new Date(new Date(t.due!).getTime() + 9 * HOUR)
            return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${t.title}`
          })
          .join('\n')
        if (pending.length > 3) body += `\nほか${pending.length - 3}件`
      }
      summarized = await sendToSubs(admin, subs, { title, body, url: './' })
      if (!force) {
        await admin.from('user_settings').update({ notified_date: today }).eq('user_id', s.user_id)
      }
    }

    results.push({
      userId: s.user_id,
      reminded,
      reminderLines: lines.length,
      jobReminded,
      jobReminderLines: jobLines.length,
      summarized,
    })
  }
  return json({ results })
})
