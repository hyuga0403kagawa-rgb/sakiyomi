// サキヨミ(仮) プッシュ通知 Edge Function
// cron(x-sync-secret)で毎時呼ばれ、各ユーザーの notify_time を過ぎていて
// 今日まだ通知していなければ、未提出課題のまとめをWeb Pushで送る。
// デプロイ先: Supabase Edge Functions (関数名: push-notify, Verify JWT: OFF)
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
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

  const jst = new Date(Date.now() + 9 * 3600 * 1000)
  const today = jst.toISOString().slice(0, 10)
  const hm = jst.toISOString().slice(11, 16)

  const { data: users } = await admin.from('user_settings').select('*')
  const results = []
  for (const s of users ?? []) {
    if ((s.notified_date ?? '') === today) continue
    if (hm < (s.notify_time || '18:00')) continue

    const { data: tasks } = await admin
      .from('tasks')
      .select('title, due')
      .eq('user_id', s.user_id)
      .eq('done', false)
      .not('due', 'is', null)
      .order('due', { ascending: true })

    const pending = tasks ?? []
    let title: string, body: string
    if (pending.length === 0) {
      title = '✅ 未提出の課題はありません'
      body = '今日もおつかれさま!'
    } else {
      title = `📚 未提出の課題が${pending.length}件`
      body = pending
        .slice(0, 3)
        .map((t) => {
          const d = new Date(new Date(t.due).getTime() + 9 * 3600 * 1000)
          return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${t.title}`
        })
        .join('\n')
      if (pending.length > 3) body += `\nほか${pending.length - 3}件`
    }

    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', s.user_id)
    let sent = 0
    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title, body, url: './' }),
        )
        sent++
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          await admin.from('push_subscriptions').delete().eq('id', sub.id)
        }
      }
    }
    await admin.from('user_settings').update({ notified_date: today }).eq('user_id', s.user_id)
    results.push({ userId: s.user_id, sent, pending: pending.length })
  }
  return json({ results })
})
