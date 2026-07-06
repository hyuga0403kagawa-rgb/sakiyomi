import { supabase } from './supabase'
import type { Settings, Task, TaskSource } from './types'
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

/** Moodle同期の結果(moodle由来のタスクだけ)をまとめて保存する。
 *  (user_id, moodle_event_id) のユニーク制約を使って新規は追加・既存は更新。 */
export async function upsertMoodleTasks(tasks: Task[]): Promise<void> {
  const rows = tasks.filter((t) => t.source === 'moodle').map(toRow)
  if (rows.length === 0) return
  const { error } = await supabase
    .from('tasks')
    .upsert(rows, { onConflict: 'user_id,moodle_event_id' })
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
    lastSyncedAt: data.last_synced_at ?? undefined,
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
    last_synced_at: s.lastSyncedAt ?? null,
  })
  if (error) throw error
}
