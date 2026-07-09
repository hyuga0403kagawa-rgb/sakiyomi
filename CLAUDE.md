# CLAUDE.md — UniPort開発メモ(Claude Code向け)

学生向けタスク管理PWA「UniPort」(旧称サキヨミ)。オーナーはひゅーちん(菅原彪雅、
香川大学の非プロ開発者。手順は具体的に案内すること)。詳しい経緯・意思決定の履歴は
moodle-notifierプロジェクトのメモリ(project_task_app_moodle_idea.md)にある。

## 重要な不変条件

- **URLパス `/sakiyomi/`・リポジトリ名・SupabaseプロジェクトIDは変えない**
  (既存ユーザーのホーム画面インストールと認証設定が壊れる)。表示名のみUniPort
- **Moodleのパスワードは絶対に保存・ログ出力しない**。連携はmoodle-connectで
  トークン交換のみ。プライバシーポリシー(public/privacy.html)と実装を常に一致させる
- **できないことは正直に断る文化**。データ源のない数値(成績など)は捏造しない

## 構成の要点

- フロント: Vite+React+TS+Tailwind。base='/sakiyomi/'。GitHub Pagesへ
  pushで自動デプロイ(.github/workflows/deploy.yml)
- Supabase: プロジェクト kdyffkcowdkbgtbledbc(東京)
  - テーブル: tasks / user_settings / push_subscriptions / timetable_slots /
    course_info / attendance_records(すべてRLS: 本人のみ、user_id default auth.uid())
  - Edge Functions(コードはsupabase/functions/、verify_jwt=false、コード内で認証):
    moodle-sync(毎時cron+ユーザーJWT)、push-notify(リマインダー+日次まとめ、
    moodle-syncから連鎖起動)、moodle-connect(ID/PW→トークン交換)、
    moodle-materials(講義資料)、delete-account
  - デプロイ: `npx supabase functions deploy <name> --project-ref kdyffkcowdkbgtbledbc`
    (ダッシュボードのSQLエディタ/関数エディタは障害が多く信用しない)
  - DDLが必要なとき: 一時的なmigrate関数(npm:postgres + SUPABASE_DB_URL)を
    デプロイ→実行→即削除、という手順が実績あり
  - Secrets: SYNC_SECRET / VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
- 認証: メール+パスワード(確認メールはrate limit対策で無効化済み)。
  パスワード再設定メールのみ標準SMTP(制限あり。恒久対策はResend等の外部SMTP)

## 既知の運用タスク

- 年度URL更新(毎年4月頃): src/universities.ts の山梨/高知/島根/大阪教育の
  /2026 部分を新年度に
- 未対応のまま保留: 教科書仲介(要ユーザー規模)、ウィジェット(PWA不可、
  ネイティブ版で)、外部カレンダー連携(プレミアム予定)、Stripe
- ユーザー側の宿題: サービス専用メールアドレス、香川大EISCへの確認メール
