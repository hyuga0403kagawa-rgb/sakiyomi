-- テスト対策(期末・中間のテストの日程と勉強計画)
-- 2026-10-03 追加。Supabase の SQL Editor に貼り付けて1回実行する。
-- 何度実行しても同じ結果になる(既にあれば作らない)。
-- 仕様は docs/テスト対策_仕様.md。既存の表には触らない(新しい表を1つ足すだけ)。
--
-- 日ごとの直し・やった記録・やることリストは、テスト1件の中に jsonb で持つ。
-- (表を分けると、1回の保存で何か所も書くことになり、途中で失敗したときに食い違うため)

create table if not exists public.exams (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  course           text,                                   -- 講義名(時間割と同じ文字列)。なしも可
  title            text        not null default '期末試験',
  exam_date        date        not null,                   -- テストの日
  tentative        boolean     not null default false,     -- 日付が仮か
  weight           text        not null default 'normal' check (weight in ('light', 'normal', 'heavy')),
  start_date       date        not null,                   -- 勉強を始める日
  total_minutes    integer     not null default 480 check (total_minutes >= 0),
  pattern          text        not null default 'late' check (pattern in ('late', 'even', 'early')),
  overrides        jsonb       not null default '{}'::jsonb, -- 自分で直した日 {"2026-10-05": 0, ...}(0=休み)
  done_log         jsonb       not null default '{}'::jsonb, -- やった記録 {"2026-10-04": 25, ...}
  todos            jsonb       not null default '[]'::jsonb, -- やることリスト [{"id","text","done"}]
  tentative_asked  boolean     not null default false,     -- 「日程は決まりましたか?」を聞いたか
  created_at       timestamptz not null default now()
);

create index if not exists exams_user_id_idx on public.exams (user_id);

alter table public.exams enable row level security;

-- 本人の行だけ読み書きできる(ほかの表と同じ)
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'exams' and policyname = 'own exams'
  ) then
    create policy "own exams" on public.exams
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;
