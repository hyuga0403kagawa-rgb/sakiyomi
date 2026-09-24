# Supabase側の構成メモ

プロジェクト: `sakiyomi` (kdyffkcowdkbgtbledbc, Tokyo)

## テーブル

- `tasks` — タスク本体(RLS: 自分の行のみ)。`(user_id, moodle_event_id)` にユニーク制約
- `user_settings` — Moodle URL・`moodle_connected`(連携済みか)・1日の使える時間・`notify_time`・`notified_date`。
  旧列 `moodle_token` は2026-09-24から使わない(アプリからは書き込めないようトリガーで防ぐ。移行後は常に空)
- `moodle_credentials` — Moodleの合鍵(トークン)を**暗号化して**保存(`token_enc`)。アプリからは読めない・書けない。
  暗号化・復号はEdge Functionだけが行う(`functions/_shared/moodleCredential.ts`)。作成SQLは `sql/2026-09-24_moodle_credentials.sql`
- `push_subscriptions` — Web Pushの宛先(endpoint / p256dh / auth)
- `sponsor_stats` — 協賛企業の表示回数・タップ数(企業×日×置き場所の合計のみ。誰が見たかは持たない)。
  RLS有効・ポリシーなし=アプリから直接は読み書き不可。書き込みは関数 `record_sponsor_event` 経由のみ。
  作成SQLと月次報告用のクエリは `sql/2026-09-23_sponsor_stats.sql`

## Edge Functions(いずれも Verify JWT: OFF)

- `moodle-sync` — Moodle課題の同期。cron(x-sync-secret)= 全ユーザー、ユーザーJWT = 本人のみ
- `push-notify` — notify_time を過ぎたユーザーへ未提出課題まとめをWeb Push送信

Secrets: `SYNC_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `MOODLE_TOKEN_KEY`

`MOODLE_TOKEN_KEY` はMoodleの合鍵の暗号化と、講義資料リンクの署名に使う32バイトの乱数(base64)。
**失う・変えると保存済みの合鍵が復号できなくなり、全員がMoodle連携のやり直しになる。**
値はSupabaseのSecretsにだけ置き、このリポジトリやログには書かない。

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
