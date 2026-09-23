-- 協賛企業(有料掲載)の表示回数・タップ数の集計
-- 2026-09-23 追加。Supabase の SQL Editor に貼り付けて1回実行する。
-- 何度実行しても同じ結果になる(作り直しても既存の集計は消えない)。
--
-- 方針(意思決定ログ 2026-09-23):
--   企業ごと・日ごと・置き場所ごとの「合計」だけを持つ。
--   誰が見たか・誰がタップしたかは記録しない(user_id の列を作らない)。
--   学生のアプリからは表を直接読めない・書けない。書き込みは下の関数だけ。
--   読むのは運営者(SQL Editor)だけ。

create table if not exists public.sponsor_stats (
  company_id  uuid    not null references public.companies(id) on delete cascade,
  day         date    not null,                        -- 日本時間の日付
  placement   text    not null check (placement in ('open', 'job_tab')),
                                                       -- open=開いた最初の案内 / job_tab=就活タブの協賛枠
  impressions integer not null default 0,              -- 表示された回数(1端末1日1回まで)
  taps        integer not null default 0,              -- タップされた回数(1端末1日1回まで)
  primary key (company_id, day, placement)
);

-- RLSを有効にしてポリシーを作らない = 学生のアプリからは読めない・書けない
alter table public.sponsor_stats enable row level security;

create or replace function public.record_sponsor_event(
  p_company_id uuid,
  p_placement  text,
  p_kind       text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- ログインしていない呼び出しは数えない
  if auth.uid() is null then
    return;
  end if;
  if p_placement not in ('open', 'job_tab') or p_kind not in ('impression', 'tap') then
    return;
  end if;
  -- 有料の協賛企業だけを数える
  if not exists (select 1 from public.companies where id = p_company_id and is_sponsored) then
    return;
  end if;

  insert into public.sponsor_stats as s (company_id, day, placement, impressions, taps)
  values (
    p_company_id,
    (now() at time zone 'Asia/Tokyo')::date,
    p_placement,
    case when p_kind = 'impression' then 1 else 0 end,
    case when p_kind = 'tap' then 1 else 0 end
  )
  on conflict (company_id, day, placement) do update set
    impressions = s.impressions + excluded.impressions,
    taps        = s.taps + excluded.taps;
end;
$$;

-- 呼べるのはログイン中の利用者だけ
revoke all on function public.record_sponsor_event(uuid, text, text) from public, anon;
grant execute on function public.record_sponsor_event(uuid, text, text) to authenticated;


-- ─────────────────────────────────────────────
-- 月次報告用(実行するのはここまで。下は報告のときにコピーして使う)
-- ─────────────────────────────────────────────
--
-- ある月の、企業ごと・置き場所ごとの合計:
--
-- select c.name as 企業, s.placement as 置き場所,
--        sum(s.impressions) as 表示, sum(s.taps) as タップ
-- from public.sponsor_stats s
-- join public.companies c on c.id = s.company_id
-- where s.day >= date '2026-10-01' and s.day < date '2026-11-01'
-- group by c.name, s.placement
-- order by c.name, s.placement;
