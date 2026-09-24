import { supabase } from './supabase'
import type {
  AttendanceRecord,
  AttendanceStatus,
  Company,
  CourseInfo,
  Grade,
  JobEntry,
  JobNote,
  JobProfile,
  Settings,
  Task,
  TaskSource,
  TimetableSlot,
} from './types'
import { DEFAULT_SETTINGS } from './types'
import { demoId, demoStore, isDemo } from './demo'

// Supabaseとのやり取りをここに集約する(App側はTask/Settings型だけを扱う)
// デモモード(?demo=1)のときは、Supabaseを一切使わず端末のメモリ上のデータを返す。

interface TaskRow {
  id: string
  title: string
  course: string | null
  due: string | null
  estimated_minutes: number
  done: boolean
  source: TaskSource
  moodle_event_id: number | null
  created_at: string
}

function toTask(r: TaskRow): Task {
  return {
    id: r.id,
    title: r.title,
    course: r.course ?? undefined,
    due: r.due ?? undefined,
    estimatedMinutes: r.estimated_minutes,
    done: r.done,
    source: r.source,
    moodleEventId: r.moodle_event_id ?? undefined,
    createdAt: r.created_at,
  }
}

function toRow(t: Omit<Task, 'id' | 'createdAt'>): Omit<TaskRow, 'id' | 'created_at'> {
  return {
    title: t.title,
    course: t.course ?? null,
    due: t.due ?? null,
    estimated_minutes: t.estimatedMinutes,
    done: t.done,
    source: t.source,
    moodle_event_id: t.moodleEventId ?? null,
  }
}

export async function fetchTasks(): Promise<Task[]> {
  if (isDemo()) return [...demoStore().tasks]
  const { data, error } = await supabase.from('tasks').select('*')
  if (error) throw error
  return (data as TaskRow[]).map(toTask)
}

export async function insertTask(t: Omit<Task, 'id' | 'createdAt'>): Promise<Task> {
  if (isDemo()) {
    const created: Task = { ...t, id: demoId(), createdAt: new Date().toISOString() }
    demoStore().tasks.push(created)
    return created
  }
  const { data, error } = await supabase.from('tasks').insert(toRow(t)).select().single()
  if (error) throw error
  return toTask(data as TaskRow)
}

export async function updateTask(t: Task): Promise<void> {
  if (isDemo()) {
    const s = demoStore()
    s.tasks = s.tasks.map((x) => (x.id === t.id ? t : x))
    return
  }
  const { error } = await supabase.from('tasks').update(toRow(t)).eq('id', t.id)
  if (error) throw error
}

export async function deleteTask(id: string): Promise<void> {
  if (isDemo()) {
    const s = demoStore()
    s.tasks = s.tasks.filter((x) => x.id !== id)
    return
  }
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw error
}

// ---------- 時間割 ----------

export async function fetchTimetable(): Promise<TimetableSlot[]> {
  if (isDemo()) return [...demoStore().slots]
  const { data, error } = await supabase.from('timetable_slots').select('*')
  if (error) throw error
  return data.map((r) => ({
    id: r.id,
    day: r.day,
    period: r.period,
    course: r.course,
    room: r.room ?? undefined,
    semester: r.semester ?? '前期',
  }))
}

export async function addTimetableSlot(
  day: number,
  period: number,
  course: string,
  semester: string,
  room?: string,
): Promise<TimetableSlot> {
  if (isDemo()) {
    const s = demoStore()
    const found = s.slots.find(
      (x) => x.day === day && x.period === period && x.semester === semester,
    )
    if (found) {
      found.course = course
      found.room = room || undefined
      return { ...found }
    }
    const created: TimetableSlot = { id: demoId(), day, period, course, room: room || undefined, semester }
    s.slots.push(created)
    return created
  }
  const { data, error } = await supabase
    .from('timetable_slots')
    .upsert(
      { day, period, course, room: room || null, semester },
      { onConflict: 'user_id,semester,day,period' },
    )
    .select()
    .single()
  if (error) throw error
  return {
    id: data.id,
    day: data.day,
    period: data.period,
    course: data.course,
    room: data.room ?? undefined,
    semester: data.semester ?? semester,
  }
}

export async function deleteTimetableSlot(id: string): Promise<void> {
  if (isDemo()) {
    const s = demoStore()
    s.slots = s.slots.filter((x) => x.id !== id)
    return
  }
  const { error } = await supabase.from('timetable_slots').delete().eq('id', id)
  if (error) throw error
}

// ---------- 講義情報(シラバス) ----------

export async function fetchCourseInfo(course: string): Promise<CourseInfo | null> {
  if (isDemo()) return demoStore().courseInfo.find((c) => c.course === course) ?? null
  const { data, error } = await supabase
    .from('course_info')
    .select('*')
    .eq('course', course)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    course: data.course,
    attendancePct: data.attendance_pct ?? undefined,
    reportPct: data.report_pct ?? undefined,
    examPct: data.exam_pct ?? undefined,
    textbook: data.textbook ?? undefined,
    bringIn: data.bring_in ?? undefined,
    notes: data.notes ?? undefined,
    color: data.color ?? undefined,
  }
}

/** 全講義の色を { 講義名: 色キー } でまとめて取得(時間割の色付け用) */
export async function fetchCourseColors(): Promise<Record<string, string>> {
  if (isDemo()) {
    const map: Record<string, string> = {}
    for (const c of demoStore().courseInfo) if (c.color) map[c.course] = c.color
    return map
  }
  const { data, error } = await supabase.from('course_info').select('course, color')
  if (error) throw error
  const map: Record<string, string> = {}
  for (const r of data) if (r.color) map[r.course] = r.color
  return map
}

export async function upsertCourseInfo(info: CourseInfo): Promise<void> {
  if (isDemo()) {
    const s = demoStore()
    const i = s.courseInfo.findIndex((c) => c.course === info.course)
    if (i >= 0) s.courseInfo[i] = info
    else s.courseInfo.push(info)
    return
  }
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) throw new Error('ログインしていません')
  const { error } = await supabase.from('course_info').upsert(
    {
      user_id: userId,
      course: info.course,
      attendance_pct: info.attendancePct ?? null,
      report_pct: info.reportPct ?? null,
      exam_pct: info.examPct ?? null,
      textbook: info.textbook ?? null,
      bring_in: info.bringIn ?? null,
      notes: info.notes ?? null,
      color: info.color ?? null,
    },
    { onConflict: 'user_id,course' },
  )
  if (error) throw error
}

// ---------- 出席管理 ----------

export async function fetchAttendance(course: string): Promise<AttendanceRecord[]> {
  if (isDemo()) {
    return demoStore()
      .attendance.filter((a) => a.course === course)
      .sort((a, b) => b.date.localeCompare(a.date))
  }
  const { data, error } = await supabase
    .from('attendance_records')
    .select('*')
    .eq('course', course)
    .order('date', { ascending: false })
  if (error) throw error
  return data.map((r) => ({ id: r.id, course: r.course, date: r.date, status: r.status }))
}

export async function addAttendance(
  course: string,
  status: AttendanceStatus,
): Promise<AttendanceRecord> {
  if (isDemo()) {
    const now = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const created: AttendanceRecord = {
      id: demoId(),
      course,
      date: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`,
      status,
    }
    demoStore().attendance.push(created)
    return created
  }
  const { data, error } = await supabase
    .from('attendance_records')
    .insert({ course, status })
    .select()
    .single()
  if (error) throw error
  return { id: data.id, course: data.course, date: data.date, status: data.status }
}

export async function deleteAttendance(id: string): Promise<void> {
  if (isDemo()) {
    const s = demoStore()
    s.attendance = s.attendance.filter((a) => a.id !== id)
    return
  }
  const { error } = await supabase.from('attendance_records').delete().eq('id', id)
  if (error) throw error
}

// ---------- 就活: エントリー締切 ----------

export async function fetchJobEntries(): Promise<JobEntry[]> {
  if (isDemo()) return [...demoStore().jobEntries]
  const { data, error } = await supabase.from('job_entries').select('*')
  if (error) throw error
  return data.map((r) => ({
    id: r.id,
    company: r.company,
    entryType: r.entry_type,
    deadline: r.deadline ?? undefined,
    memo: r.memo ?? undefined,
    done: r.done,
    status: r.status ?? undefined,
  }))
}

export async function addJobEntry(e: Omit<JobEntry, 'id' | 'done'>): Promise<JobEntry> {
  if (isDemo()) {
    const created: JobEntry = { ...e, id: demoId(), done: false }
    demoStore().jobEntries.push(created)
    return created
  }
  const { data, error } = await supabase
    .from('job_entries')
    .insert({
      company: e.company,
      entry_type: e.entryType,
      deadline: e.deadline ?? null,
      memo: e.memo ?? null,
      status: e.status ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return {
    id: data.id,
    company: data.company,
    entryType: data.entry_type,
    deadline: data.deadline ?? undefined,
    memo: data.memo ?? undefined,
    done: data.done,
    status: data.status ?? undefined,
  }
}

export async function updateJobEntryDone(id: string, done: boolean): Promise<void> {
  if (isDemo()) {
    const e = demoStore().jobEntries.find((x) => x.id === id)
    if (e) e.done = done
    return
  }
  const { error } = await supabase.from('job_entries').update({ done }).eq('id', id)
  if (error) throw error
}

export async function updateJobEntryStatus(id: string, status: string | null): Promise<void> {
  if (isDemo()) {
    const e = demoStore().jobEntries.find((x) => x.id === id)
    if (e) e.status = status ?? undefined
    return
  }
  const { error } = await supabase.from('job_entries').update({ status }).eq('id', id)
  if (error) throw error
}

export async function deleteJobEntry(id: string): Promise<void> {
  if (isDemo()) {
    const s = demoStore()
    s.jobEntries = s.jobEntries.filter((x) => x.id !== id)
    return
  }
  const { error } = await supabase.from('job_entries').delete().eq('id', id)
  if (error) throw error
}

// ---------- 就活: 自己分析メモ ----------

export async function fetchJobNotes(): Promise<JobNote[]> {
  if (isDemo()) return [...demoStore().jobNotes]
  const { data, error } = await supabase
    .from('job_notes')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data.map((r) => ({
    id: r.id,
    category: r.category,
    title: r.title ?? undefined,
    body: r.body,
  }))
}

export async function addJobNote(n: Omit<JobNote, 'id'>): Promise<JobNote> {
  if (isDemo()) {
    const created: JobNote = { ...n, id: demoId() }
    demoStore().jobNotes.unshift(created)
    return created
  }
  const { data, error } = await supabase
    .from('job_notes')
    .insert({ category: n.category, title: n.title ?? null, body: n.body })
    .select()
    .single()
  if (error) throw error
  return { id: data.id, category: data.category, title: data.title ?? undefined, body: data.body }
}

export async function updateJobNote(n: JobNote): Promise<void> {
  if (isDemo()) {
    const s = demoStore()
    s.jobNotes = s.jobNotes.map((x) => (x.id === n.id ? n : x))
    return
  }
  const { error } = await supabase
    .from('job_notes')
    .update({ category: n.category, title: n.title ?? null, body: n.body, updated_at: new Date().toISOString() })
    .eq('id', n.id)
  if (error) throw error
}

export async function deleteJobNote(id: string): Promise<void> {
  if (isDemo()) {
    const s = demoStore()
    s.jobNotes = s.jobNotes.filter((x) => x.id !== id)
    return
  }
  const { error } = await supabase.from('job_notes').delete().eq('id', id)
  if (error) throw error
}

// ---------- 就活: プロフィール ----------

export async function fetchJobProfile(): Promise<JobProfile | null> {
  if (isDemo()) return demoStore().jobProfile
  const { data, error } = await supabase.from('job_profile').select('*').maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    interests: data.interests ?? undefined,
    location: data.location ?? undefined,
    industries: data.industries ?? undefined,
    jobType: data.job_type ?? undefined,
    startPeriod: data.start_period ?? undefined,
  }
}

export async function upsertJobProfile(p: JobProfile): Promise<void> {
  if (isDemo()) {
    demoStore().jobProfile = p
    return
  }
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) throw new Error('ログインしていません')
  const { error } = await supabase.from('job_profile').upsert({
    user_id: userId,
    interests: p.interests ?? null,
    location: p.location ?? null,
    industries: p.industries ?? null,
    job_type: p.jobType ?? null,
    start_period: p.startPeriod ?? null,
    updated_at: new Date().toISOString(),
  })
  if (error) throw error
}

// ---------- 就活: 企業情報 ----------

export async function fetchCompanies(): Promise<Company[]> {
  if (isDemo()) return []
  const { data, error } = await supabase.from('companies').select('*')
  if (error) throw error
  return data.map((r) => ({
    id: r.id,
    name: r.name,
    industry: r.industry ?? undefined,
    location: r.location ?? undefined,
    startingSalary: r.starting_salary ?? undefined,
    avgSalary: r.avg_salary ?? undefined,
    employees: r.employees ?? undefined,
    benefits: r.benefits ?? undefined,
    positions: r.positions ?? undefined,
    internInfo: r.intern_info ?? undefined,
    seminarInfo: r.seminar_info ?? undefined,
    website: r.website ?? undefined,
    isSponsored: r.is_sponsored,
    matchTags: r.match_tags ?? undefined,
  }))
}

// ---------- 成績 ----------

export async function fetchGrades(): Promise<Grade[]> {
  if (isDemo()) return [...demoStore().grades]
  const { data, error } = await supabase
    .from('grades')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data.map((r) => ({
    id: r.id,
    course: r.course,
    term: r.term ?? undefined,
    grade: r.grade,
    credits: Number(r.credits),
  }))
}

export async function addGrade(g: Omit<Grade, 'id'>): Promise<Grade> {
  if (isDemo()) {
    const created: Grade = { ...g, id: demoId() }
    demoStore().grades.push(created)
    return created
  }
  const { data, error } = await supabase
    .from('grades')
    .insert({ course: g.course, term: g.term ?? null, grade: g.grade, credits: g.credits })
    .select()
    .single()
  if (error) throw error
  return {
    id: data.id,
    course: data.course,
    term: data.term ?? undefined,
    grade: data.grade,
    credits: Number(data.credits),
  }
}

export async function updateGrade(g: Grade): Promise<void> {
  if (isDemo()) {
    const s = demoStore()
    s.grades = s.grades.map((x) => (x.id === g.id ? g : x))
    return
  }
  const { error } = await supabase
    .from('grades')
    .update({ course: g.course, term: g.term ?? null, grade: g.grade, credits: g.credits })
    .eq('id', g.id)
  if (error) throw error
}

export async function deleteGrade(id: string): Promise<void> {
  if (isDemo()) {
    const s = demoStore()
    s.grades = s.grades.filter((x) => x.id !== id)
    return
  }
  const { error } = await supabase.from('grades').delete().eq('id', id)
  if (error) throw error
}

/** アプリが読む user_settings の列。合鍵の列(moodle_token)は含めない */
// 1本の文字列のまま書く(つなげると supabase-js が列の型を読み取れなくなる)
const SETTINGS_COLUMNS = 'moodle_url, moodle_connected, minutes_per_day, notify_time, last_synced_at, nickname, university, faculty, department, grade, avatar, avatar_url, timetable_days, current_semester, calendar_tasks, calendar_exams, calendar_timetable, calendar_jobs'

export async function fetchSettings(): Promise<Settings> {
  if (isDemo()) return { ...demoStore().settings }
  // 合鍵(moodle_token)は読まない。連携済みかどうか(moodle_connected)だけを受け取る
  const { data, error } = await supabase.from('user_settings').select(SETTINGS_COLUMNS).maybeSingle()
  if (error) throw error
  if (!data) return DEFAULT_SETTINGS
  return {
    moodleUrl: data.moodle_url,
    moodleConnected: data.moodle_connected ?? false,
    minutesPerDay: data.minutes_per_day,
    notifyTime: data.notify_time ?? '18:00',
    lastSyncedAt: data.last_synced_at ?? undefined,
    nickname: data.nickname ?? undefined,
    university: data.university ?? undefined,
    faculty: data.faculty ?? undefined,
    department: data.department ?? undefined,
    grade: data.grade ?? undefined,
    avatar: data.avatar ?? undefined,
    avatarUrl: data.avatar_url ?? undefined,
    timetableDays: data.timetable_days ?? undefined,
    currentSemester: data.current_semester ?? undefined,
    calendarTasks: data.calendar_tasks ?? undefined,
    calendarExams: data.calendar_exams ?? undefined,
    calendarTimetable: data.calendar_timetable ?? undefined,
    calendarJobs: data.calendar_jobs ?? undefined,
  }
}

export async function saveSettingsCloud(s: Settings): Promise<void> {
  if (isDemo()) {
    demoStore().settings = s
    return
  }
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) throw new Error('ログインしていません')
  const { error } = await supabase.from('user_settings').upsert({
    user_id: userId,
    moodle_url: s.moodleUrl,
    // 合鍵(moodle_token)と連携状態(moodle_connected)は送らない。書くのはサーバーの moodle-connect だけ
    minutes_per_day: s.minutesPerDay,
    notify_time: s.notifyTime,
    last_synced_at: s.lastSyncedAt ?? null,
    nickname: s.nickname ?? null,
    university: s.university ?? null,
    faculty: s.faculty ?? null,
    department: s.department ?? null,
    grade: s.grade ?? null,
    avatar: s.avatar ?? null,
    avatar_url: s.avatarUrl ?? null,
    timetable_days: s.timetableDays ?? null,
    current_semester: s.currentSemester ?? null,
    calendar_tasks: s.calendarTasks ?? true,
    calendar_exams: s.calendarExams ?? true,
    calendar_timetable: s.calendarTimetable ?? true,
    calendar_jobs: s.calendarJobs ?? true,
  })
  if (error) throw error
}
