import { supabase } from './supabase'
import type {
  AttendanceRecord,
  AttendanceStatus,
  CourseInfo,
  Settings,
  Task,
  TaskSource,
  TimetableSlot,
} from './types'
import { DEFAULT_SETTINGS } from './types'

// Supabaseとのやり取りをここに集約する(App側はTask/Settings型だけを扱う)

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
  const { data, error } = await supabase.from('tasks').select('*')
  if (error) throw error
  return (data as TaskRow[]).map(toTask)
}

export async function insertTask(t: Omit<Task, 'id' | 'createdAt'>): Promise<Task> {
  const { data, error } = await supabase.from('tasks').insert(toRow(t)).select().single()
  if (error) throw error
  return toTask(data as TaskRow)
}

export async function updateTask(t: Task): Promise<void> {
  const { error } = await supabase.from('tasks').update(toRow(t)).eq('id', t.id)
  if (error) throw error
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw error
}

// ---------- 時間割 ----------

export async function fetchTimetable(): Promise<TimetableSlot[]> {
  const { data, error } = await supabase.from('timetable_slots').select('*')
  if (error) throw error
  return data.map((r) => ({
    id: r.id,
    day: r.day,
    period: r.period,
    course: r.course,
    room: r.room ?? undefined,
  }))
}

export async function addTimetableSlot(
  day: number,
  period: number,
  course: string,
  room?: string,
): Promise<TimetableSlot> {
  const { data, error } = await supabase
    .from('timetable_slots')
    .upsert(
      { day, period, course, room: room || null },
      { onConflict: 'user_id,day,period' },
    )
    .select()
    .single()
  if (error) throw error
  return { id: data.id, day: data.day, period: data.period, course: data.course, room: data.room ?? undefined }
}

export async function deleteTimetableSlot(id: string): Promise<void> {
  const { error } = await supabase.from('timetable_slots').delete().eq('id', id)
  if (error) throw error
}

// ---------- 講義情報(シラバス) ----------

export async function fetchCourseInfo(course: string): Promise<CourseInfo | null> {
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
  }
}

export async function upsertCourseInfo(info: CourseInfo): Promise<void> {
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
    },
    { onConflict: 'user_id,course' },
  )
  if (error) throw error
}

// ---------- 出席管理 ----------

export async function fetchAttendance(course: string): Promise<AttendanceRecord[]> {
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
  const { data, error } = await supabase
    .from('attendance_records')
    .insert({ course, status })
    .select()
    .single()
  if (error) throw error
  return { id: data.id, course: data.course, date: data.date, status: data.status }
}

export async function deleteAttendance(id: string): Promise<void> {
  const { error } = await supabase.from('attendance_records').delete().eq('id', id)
  if (error) throw error
}

export async function fetchSettings(): Promise<Settings> {
  const { data, error } = await supabase.from('user_settings').select('*').maybeSingle()
  if (error) throw error
  if (!data) return DEFAULT_SETTINGS
  return {
    moodleUrl: data.moodle_url,
    moodleToken: data.moodle_token,
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
  }
}

export async function saveSettingsCloud(s: Settings): Promise<void> {
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id
  if (!userId) throw new Error('ログインしていません')
  const { error } = await supabase.from('user_settings').upsert({
    user_id: userId,
    moodle_url: s.moodleUrl,
    moodle_token: s.moodleToken,
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
  })
  if (error) throw error
}
