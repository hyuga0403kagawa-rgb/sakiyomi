-- 時間割の編集: 講義ごとの教員名と、時間割に出す略称
-- 2026-10-06 追加。何度実行しても同じ結果になる。既存の列・データには触らない(NULL可の列を2つ足すだけ)。
-- 講義名(course)は Moodle の課題・資料とつながる名前なので変えず、見せる名前は short_name で持つ。

alter table public.course_info add column if not exists teacher    text; -- 教員名
alter table public.course_info add column if not exists short_name text; -- 時間割に出す略称(空なら講義名)
