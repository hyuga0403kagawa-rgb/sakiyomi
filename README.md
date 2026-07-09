# UniPort

大学のMoodleとつないで、課題・時間割・出席・成績見込みをひとつに。
「大学のポータルが見づらいなら、全部UniPortに繋いでおけば一発」を目指す学生向けPWAです。

📱 **アプリ**: https://hyuga0403kagawa-rgb.github.io/sakiyomi/
(SafariやChromeで開いて「ホーム画面に追加」するとアプリとして使えます)

## 主な機能

- 🔗 **Moodle自動連携** — 大学を選んでMoodleのID/パスワードを1回入れるだけ。パスワードは保存されず、公式アプリと同じトークン方式で毎時自動同期
- 🏠 **今日やること** — 課題の期限と見積もり時間から、今日やる分だけをAIが自動配分
- 🗓️ **時間割** — 曜日×時限で手入力。講義をタップすると課題・資料・出席・成績見込みへ
- 📈 **成績見込み** — シラバスの評価割合×実際の出席率・課題提出率から見込み点を計算
- 🙋 **出席管理** — 出席/遅刻/欠席をワンタップ記録、出席率を自動計算
- 📚 **講義資料** — Moodle上のPDFやスライドをアプリからすぐ開ける
- 🔔 **プッシュ通知** — 新しい課題/締切3日前/前日/当日/期限切れ + 毎日のまとめ

## 対応大学

香川・岡山・大阪教育・京都工芸繊維・京都産業・九州工業・高知・島根・千葉・
名古屋工業・弘前・北海道・山梨・早稲田(2026年7月時点、順次拡大中)。
その他の大学もMoodleのURLを入力すれば試せます(モバイルWebサービスAPIが有効な大学のみ)。

## 技術構成

- フロントエンド: React + TypeScript + Tailwind CSS(Vite)、PWA
- バックエンド: Supabase(認証 / PostgreSQL+RLS / Edge Functions / pg_cron)
- 通知: Web Push(VAPID)
- ホスティング: GitHub Pages(このリポジトリからActionsで自動デプロイ)

Moodleとの通信はすべてEdge Function経由で、公式モバイルアプリと同一の
Webサービス API(`core_calendar_get_action_events_by_timesort` 等)のみを使用しています。
スクレイピングは行いません。

## プライバシー

[プライバシーポリシー](https://hyuga0403kagawa-rgb.github.io/sakiyomi/privacy.html) を参照してください。
Moodleのパスワードは保存されず、AIおすすめ等の処理は端末内で完結します。

## 開発

```bash
npm install
npm run dev   # http://localhost:5173/sakiyomi/
npm run build
```

Supabase側の構成は [supabase/README.md](supabase/README.md) を参照。
Edge Functionsのデプロイ:

```bash
npx supabase functions deploy <name> --project-ref kdyffkcowdkbgtbledbc
```

## ライセンス・注意

学生個人が運営する非公式アプリであり、各大学およびMoodle公式とは関係ありません。
提出期限は必ずMoodle本体でも確認してください。
