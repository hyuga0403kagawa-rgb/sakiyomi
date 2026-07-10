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
  /** プロフィール */
  nickname?: string
  university?: string
  faculty?: string
  department?: string
  grade?: string
  /** 'icon:1'〜'icon:5' または 'photo' */
  avatar?: string
  avatarUrl?: string
  /** 時間割に表示する曜日の範囲 */
  timetableDays?: TimetableDays
  /** 現在表示している学期(時間割の切り替え単位) */
  currentSemester?: string
}

/** 時間割の表示曜日: 平日のみ / 平日+土 / 平日+土日 */
export type TimetableDays = 'weekday' | 'sat' | 'satsun'

export const DEFAULT_SETTINGS: Settings = {
  moodleUrl: 'https://kadai-moodle.kagawa-u.ac.jp',
  moodleToken: '',
  minutesPerDay: 120,
  notifyTime: '18:00',
  timetableDays: 'sat',
  // currentSemester は未設定なら「今日の年度・学期」を自動採用する(semester.ts)
}

/** 時間割の1コマ(day: 0=月〜5=土, 6=オンデマンド, 7=日) */
export interface TimetableSlot {
  id: string
  day: number
  period: number
  course: string
  room?: string
  /** 所属する学期。既存データは '前期' */
  semester: string
}

/** 講義ごとの情報(シラバスから読み取った評価割合など) */
export interface CourseInfo {
  course: string
  attendancePct?: number
  reportPct?: number
  examPct?: number
  textbook?: string
  bringIn?: string
  notes?: string
}

export type AttendanceStatus = 'present' | 'absent' | 'late'

export interface AttendanceRecord {
  id: string
  course: string
  date: string
  status: AttendanceStatus
}

/** 就活: エントリー締切 */
export interface JobEntry {
  id: string
  company: string
  entryType: string
  deadline?: string
  memo?: string
  done: boolean
}

/** 就活: 学生側プロフィール(マッチング用) */
export interface JobProfile {
  interests?: string
  location?: string
  industries?: string
  jobType?: string
  startPeriod?: string
}

/** 就活: 企業情報。isSponsored=trueは有料掲載(PR枠)で、
 *  AIおすすめ枠には絶対に混ぜない(景表法ステマ規制対応) */
export interface Company {
  id: string
  name: string
  industry?: string
  location?: string
  startingSalary?: string
  avgSalary?: string
  employees?: string
  benefits?: string
  positions?: string
  internInfo?: string
  seminarInfo?: string
  website?: string
  isSponsored: boolean
  matchTags?: string
}
