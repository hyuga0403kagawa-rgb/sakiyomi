# Supabase側の構成メモ

プロジェクト: `sakiyomi` (kdyffkcowdkbgtbledbc, Tokyo)

## テーブル

- `tasks` — タスク本体(RLS: 自分の行のみ)。`(user_id, moodle_event_id)` にユニーク制約
- `user_settings` — Moodle URL・トークン・1日の使える時間・`notify_time`・`notified_date`
- `push_subscriptions` — Web Pushの宛先(endpoint / p256dh / auth)

## Edge Functions(いずれも Verify JWT: OFF)

- `moodle-sync` — Moodle課題の同期。cron(x-sync-secret)= 全ユーザー、ユーザーJWT = 本人のみ
- `push-notify` — notify_time を過ぎたユーザーへ未提出課題まとめをWeb Push送信

Secrets: `SYNC_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`

## cronジョブ(pg_cron + pg_net)

```sql
-- 毎時0分: Moodle同期(設定済み)
select cron.schedule('moodle-sync-hourly','0 * * * *', $$select net.http_post(
  url:='https://kdyffkcowdkbgtbledbc.supabase.co/functions/v1/moodle-sync',
  headers:='{"Content-Type":"application/json","x-sync-secret":"<SYNC_SECRET>"}'::jsonb,
  body:='{}'::jsonb)$$);

-- 毎時5分: プッシュ通知判定(push-notifyデプロイ後に設定する)
select cron.schedule('push-notify-hourly','5 * * * *', $$select net.http_post(
  url:='https://kdyffkcowdkbgtbledbc.supabase.co/functions/v1/push-notify',
  headers:='{"Content-Type":"application/json","x-sync-secret":"<SYNC_SECRET>"}'::jsonb,
  body:='{}'::jsonb)$$);
```

`<SYNC_SECRET>` の実際の値はSupabaseのEdge Function Secretsにのみ保存してある
(このリポジトリは公開なので書かないこと)。
