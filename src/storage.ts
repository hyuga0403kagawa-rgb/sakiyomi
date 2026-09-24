import type { Settings, Task } from './types'
import { DEFAULT_SETTINGS } from './types'

// MVPではlocalStorageに保存する。Supabase導入時にこのモジュールだけ差し替える。
const TASKS_KEY = 'taskapp.tasks.v1'
const SETTINGS_KEY = 'taskapp.settings.v1'

export function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(TASKS_KEY)
    return raw ? (JSON.parse(raw) as Task[]) : []
  } catch {
    return []
  }
}

export function saveTasks(tasks: Task[]): void {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks))
}

/** 端末保存の時代(旧版)の設定。当時はMoodleの合鍵も端末に保存していた */
export type LegacySettings = Settings & { moodleToken?: string }

export function loadSettings(): LegacySettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as LegacySettings) } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

/** 旧版が端末に残した合鍵を消す(合鍵はサーバーだけが暗号化して持つ) */
export function forgetLegacyMoodleToken(): void {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return
    const s = JSON.parse(raw) as LegacySettings
    if (!s.moodleToken) return
    delete s.moodleToken
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    // 読み書きできない環境では何もしない
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}
