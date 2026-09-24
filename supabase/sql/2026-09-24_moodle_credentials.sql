-- Moodleの合鍵(トークン)を、暗号化して、アプリ(ブラウザ)から見えない場所に移す
-- 2026-09-24 追加。Supabase の SQL Editor に貼り付けて1回実行する。
-- 何度実行しても同じ結果になる。
--
-- これまで: user_settings.moodle_token に平文。学生本人のブラウザにも毎回送っていた。
-- これから:
--   - 合鍵は moodle_credentials.token_enc に暗号化して入れる(暗号化は Edge Function が行う。
--     鍵は関数の秘密設定 MOODLE_TOKEN_KEY にだけあり、データベースには無い)
--   - moodle_credentials はアプリから読めない・書けない。触れるのはサーバーの関数だけ
--   - アプリが見るのは user_settings.moodle_connected(連携済みかどうか)だけ
--   - 平文の合鍵は、関数が次に使ったときに暗号化して移し、消す(毎時の同期で1時間以内に全員分)
--   - アプリからは user_settings.moodle_token に書き込めないようにする(古いアプリが書き戻しても無視)

-- 1. 暗号化した合鍵の置き場所
create table if not exists public.moodle_credentials (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  token_enc  text        not null,   -- "v1.<iv>.<暗号文>"(復号できるのはサーバーの関数だけ)
  updated_at timestamptz not null default now()
);
alter table public.moodle_credentials enable row level security;
-- ポリシーを作らない + 権限も外す = アプリ(anon / authenticated)からは一切触れない
revoke all on table public.moodle_credentials from anon, authenticated;

-- 2. 連携済みかどうか(アプリはこれだけを見る)
alter table public.user_settings
  add column if not exists moodle_connected boolean not null default false;
-- 今いる連携済みの人(平文の合鍵がある人)は、移行が終わるまでの間も「連携済み」に見えるようにする
update public.user_settings
   set moodle_connected = true
 where coalesce(moodle_token, '') <> '' and not moodle_connected;

-- 3. アプリからは合鍵の列を書き換えられないようにする
--    (サーバーの関数 = service_role と、SQL Editor = postgres は対象外)
--    moodle_token は「not null default ''」の列なので、空は NULL ではなく '' で表す
--    (2026-09-24 初版は NULL を入れていて、全員の設定保存が失敗した。同日修正)
create or replace function public.user_settings_guard_moodle_token()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.moodle_token := '';
    else
      new.moodle_token := old.moodle_token;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists user_settings_guard_moodle_token on public.user_settings;
create trigger user_settings_guard_moodle_token
  before insert or update on public.user_settings
  for each row execute function public.user_settings_guard_moodle_token();


-- ─────────────────────────────────────────────
-- 移行の確認用(実行するのはここまで。下は確認のときにコピーして使う)
-- ─────────────────────────────────────────────
--
-- 平文のまま残っている人数が 0 になれば移行完了:
--
-- select
--   count(*) filter (where coalesce(moodle_token, '') <> '')    as 平文のまま,
--   count(*) filter (where moodle_connected)                    as 連携済み,
--   (select count(*) from public.moodle_credentials)            as 暗号化済み
-- from public.user_settings;
