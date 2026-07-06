export type TaskSource = 'manual' | 'moodle'

export interface Task {
  id: string
  title: string
  course?: string
  /** 期限 (ISO 8601)。手動タスクは未設定の場合もある */
  due?: string
  /** 見積もり作業時間(分) */
  estimatedMinutes: number
  done: boolean
  source: TaskSource
  /** Moodle由来のタスクはイベントIDで同期時に照合する */
  moodleEventId?: number
  createdAt: string
}

export interface Settings {
  moodleUrl: string
  moodleToken: string
  /** 1日に課題へ使える時間(分) */
  minutesPerDay: number
  /** プッシュ通知を送る時刻 (HH:MM) */
  notifyTime: string
  lastSyncedAt?: string
}

export const DEFAULT_SETTINGS: Settings = {
  moodleUrl: 'https://kadai-moodle.kagawa-u.ac.jp',
  moodleToken: '',
  minutesPerDay: 120,
  notifyTime: '18:00',
}
