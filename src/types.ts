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
  /** 授業開始の何分前に通知するか(分)。0/未設定はオフ */
  classReminderMinutes?: number
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
  /** 時間割での表示色(courseColors.ts の色キー) */
  color?: string
}

export type AttendanceStatus = 'present' | 'absent' | 'late'

export interface AttendanceRecord {
  id: string
  course: string
  date: string
  status: AttendanceStatus
}

/** 就活: エントリー締切・予定 */
export interface JobEntry {
  id: string
  company: string
  entryType: string
  deadline?: string
  memo?: string
  done: boolean
  /** 選考ステータス(JOB_STATUSES のいずれか)。未設定可 */
  status?: string
}

/** 選考ステータスの選択肢と色 */
export const JOB_STATUSES = [
  { key: '気になる', color: 'bg-gray-100 text-gray-600' },
  { key: 'エントリー済', color: 'bg-blue-50 text-blue-700' },
  { key: '選考中', color: 'bg-amber-50 text-amber-700' },
  { key: '内定', color: 'bg-green-50 text-green-700' },
  { key: 'お見送り', color: 'bg-red-50 text-red-600' },
] as const

/** 就活: 自己分析・ガクチカなどのメモ */
export interface JobNote {
  id: string
  category: string
  title?: string
  body: string
}

/** 自己分析メモのカテゴリ */
export const JOB_NOTE_CATEGORIES = ['ガクチカ', '自己PR', '強み・弱み', '志望動機', 'その他'] as const

/** 成績(手入力・GPA計算用) */
export interface Grade {
  id: string
  course: string
  /** 学期 "2026 1学期" 形式(任意) */
  term?: string
  /** 秀/優/良/可/不可 のいずれか */
  grade: string
  credits: number
}

/** 成績段階とGP。不可以外を「取得(合格)」とみなす */
export const GRADE_SCALE = [
  { key: '秀', gp: 4 },
  { key: '優', gp: 3 },
  { key: '良', gp: 2 },
  { key: '可', gp: 1 },
  { key: '不可', gp: 0 },
] as const

export function gradeGp(grade: string): number {
  return GRADE_SCALE.find((g) => g.key === grade)?.gp ?? 0
}
/** GPA計算の対象(秀優良可不可)か。合格/認定などの合否科目は対象外 */
export function gradeInGpa(grade: string): boolean {
  return GRADE_SCALE.some((g) => g.key === grade)
}
/** 単位を取得(合格)したか。不可/不 のみ不合格 */
export function gradePassed(grade: string): boolean {
  return grade !== '不可' && grade !== '不'
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
