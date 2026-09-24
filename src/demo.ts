// デモモード。QRコードから ?demo=1 で入ると、ログインなしで
// 見学用のデータが入った状態のアプリを触れる。
//
// 本物のアカウントは作らない:
//  - 複数人が同じアカウントに入ると、お互いの操作が見えてしまう
//  - 「アカウントを削除」で見学中にデータを消されうる
//  - 登録者数の統計に見学者が混ざる
// そのため、データは端末のメモリ上だけに持ち、Supabaseには一切書き込まない。
// 再読み込みすれば元の状態に戻る。
import type {
  AttendanceRecord,
  CourseInfo,
  Grade,
  JobEntry,
  JobNote,
  JobProfile,
  Settings,
  Task,
  TimetableSlot,
} from './types'
import { defaultSemester } from './semester'

const KEY = 'uniport-demo'

function detect(): boolean {
  if (typeof window === 'undefined') return false
  const p = new URLSearchParams(window.location.search)
  const v = p.get('demo')
  try {
    if (v === '1') {
      sessionStorage.setItem(KEY, '1')
      return true
    }
    if (v === '0') {
      sessionStorage.removeItem(KEY)
      return false
    }
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    // プライベートモード等で sessionStorage が使えない場合はURLだけで判定する
    return v === '1'
  }
}

const DEMO = detect()

/** デモモードで動いているか */
export function isDemo(): boolean {
  return DEMO
}

/** 今日を基準にした日時(ISO)。days日後の hh:mm */
function at(days: number, hh = 23, mm = 59): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(hh, mm, 0, 0)
  return d.toISOString()
}

/** 今日を基準にした日付(YYYY-MM-DD) */
function day(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export interface DemoStore {
  settings: Settings
  tasks: Task[]
  slots: TimetableSlot[]
  courseInfo: CourseInfo[]
  attendance: AttendanceRecord[]
  grades: Grade[]
  jobEntries: JobEntry[]
  jobNotes: JobNote[]
  jobProfile: JobProfile | null
}

const SEM = defaultSemester()

function seed(): DemoStore {
  return {
    settings: {
      moodleUrl: 'https://kadai-moodle.kagawa-u.ac.jp',
      // 連携済みの見た目にするためのダミー。実際の通信には使わない
      moodleToken: 'demo',
      minutesPerDay: 120,
      notifyTime: '18:00',
      lastSyncedAt: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
      nickname: '見学用アカウント',
      university: '香川大学',
      faculty: '創造工学部',
      department: '創造工学科',
      grade: '2年',
      avatar: 'icon:2',
      timetableDays: 'sat',
      currentSemester: SEM,
    },
    tasks: [
      {
        id: 'd-t1',
        title: '第5回小テスト',
        course: 'データ構造とアルゴリズム',
        due: at(0, 23, 59),
        estimatedMinutes: 30,
        done: false,
        source: 'moodle',
        moodleEventId: 90001,
        createdAt: at(-5, 9, 0),
      },
      {
        id: 'd-t2',
        title: 'レポート3 過渡応答の測定',
        course: '電気回路学',
        due: at(1, 23, 59),
        estimatedMinutes: 90,
        done: false,
        source: 'moodle',
        moodleEventId: 90002,
        createdAt: at(-7, 9, 0),
      },
      {
        id: 'd-t3',
        title: '英単語テストの勉強',
        course: '英語コミュニケーション',
        due: at(2, 9, 0),
        estimatedMinutes: 40,
        done: false,
        source: 'manual',
        createdAt: at(-2, 20, 0),
      },
      {
        id: 'd-t4',
        title: '課題2 線形写像の証明',
        course: '線形代数II',
        due: at(3, 23, 59),
        estimatedMinutes: 60,
        done: false,
        source: 'moodle',
        moodleEventId: 90003,
        createdAt: at(-3, 9, 0),
      },
      {
        id: 'd-t5',
        title: '演習課題4 探索アルゴリズムの実装',
        course: 'プログラミング演習',
        due: at(6, 23, 59),
        estimatedMinutes: 120,
        done: false,
        source: 'moodle',
        moodleEventId: 90004,
        createdAt: at(-1, 9, 0),
      },
      {
        id: 'd-t6',
        title: 'ふりかえりシート',
        course: '技術者倫理',
        due: at(9, 23, 59),
        estimatedMinutes: 30,
        done: false,
        source: 'moodle',
        moodleEventId: 90005,
        createdAt: at(-1, 9, 0),
      },
      {
        id: 'd-t7',
        title: '第3回課題の提出',
        course: '情報リテラシー',
        due: at(-1, 23, 59),
        estimatedMinutes: 30,
        done: false,
        source: 'moodle',
        moodleEventId: 90006,
        createdAt: at(-8, 9, 0),
      },
      {
        id: 'd-t8',
        title: 'レポート2 直流回路の解析',
        course: '電気回路学',
        due: at(-4, 23, 59),
        estimatedMinutes: 90,
        done: true,
        source: 'moodle',
        moodleEventId: 90007,
        createdAt: at(-14, 9, 0),
      },
      {
        id: 'd-t9',
        title: '課題1 行列の基本変形',
        course: '線形代数II',
        due: at(-6, 23, 59),
        estimatedMinutes: 60,
        done: true,
        source: 'moodle',
        moodleEventId: 90008,
        createdAt: at(-16, 9, 0),
      },
    ],
    // day: 0=月〜5=土, 6=オンデマンド, 7=日
    slots: [
      { id: 'd-s1', day: 0, period: 1, course: '線形代数II', room: '3201', semester: SEM },
      { id: 'd-s2', day: 0, period: 2, course: '情報システム基礎', room: '4102', semester: SEM },
      { id: 'd-s3', day: 0, period: 4, course: 'プログラミング演習', room: '演習室1', semester: SEM },
      { id: 'd-s4', day: 1, period: 2, course: '電気回路学', room: '3305', semester: SEM },
      { id: 'd-s5', day: 1, period: 3, course: '技術者倫理', room: '2201', semester: SEM },
      { id: 'd-s6', day: 2, period: 1, course: '情報システム基礎', room: '4102', semester: SEM },
      { id: 'd-s7', day: 2, period: 3, course: 'データ構造とアルゴリズム', room: '4103', semester: SEM },
      { id: 'd-s8', day: 3, period: 2, course: '線形代数II', room: '3201', semester: SEM },
      { id: 'd-s9', day: 3, period: 4, course: '学生実験I', room: '実験棟A', semester: SEM },
      { id: 'd-s10', day: 4, period: 1, course: '英語コミュニケーション', room: '1301', semester: SEM },
      { id: 'd-s11', day: 4, period: 3, course: 'データ構造とアルゴリズム', room: '4103', semester: SEM },
      { id: 'd-s12', day: 6, period: 1, course: '情報リテラシー', semester: SEM },
    ],
    courseInfo: [
      {
        course: '電気回路学',
        color: 'amber',
        attendancePct: 20,
        reportPct: 30,
        examPct: 50,
        textbook: '電気回路の基礎（第3版）',
        bringIn: '電卓のみ可',
        notes: '毎回の小テストが平常点に入る',
      },
      { course: '線形代数II', color: 'blue', attendancePct: 10, reportPct: 30, examPct: 60 },
      { course: 'データ構造とアルゴリズム', color: 'red', attendancePct: 10, reportPct: 40, examPct: 50 },
      { course: '情報システム基礎', color: 'teal', attendancePct: 20, reportPct: 40, examPct: 40 },
      { course: 'プログラミング演習', color: 'green', attendancePct: 30, reportPct: 70 },
      { course: '技術者倫理', color: 'purple', attendancePct: 40, reportPct: 60 },
      { course: '学生実験I', color: 'pink', attendancePct: 50, reportPct: 50 },
      { course: '英語コミュニケーション', color: 'gray', attendancePct: 30, reportPct: 30, examPct: 40 },
      { course: '情報リテラシー', color: 'gray', reportPct: 100 },
    ],
    attendance: [
      { id: 'd-a1', course: '電気回路学', date: day(-14), status: 'present' },
      { id: 'd-a2', course: '電気回路学', date: day(-7), status: 'late' },
      { id: 'd-a3', course: '電気回路学', date: day(-1), status: 'present' },
      { id: 'd-a4', course: '線形代数II', date: day(-10), status: 'present' },
      { id: 'd-a5', course: '線形代数II', date: day(-3), status: 'absent' },
    ],
    grades: [
      { id: 'd-g1', course: '微分積分I', term: '2025 1学期', grade: '優', credits: 2 },
      { id: 'd-g2', course: '物理学基礎', term: '2025 1学期', grade: '良', credits: 2 },
      { id: 'd-g3', course: '情報科学概論', term: '2025 1学期', grade: '秀', credits: 2 },
      { id: 'd-g4', course: 'プログラミング入門', term: '2025 2学期', grade: '優', credits: 2 },
      { id: 'd-g5', course: '化学基礎', term: '2025 2学期', grade: '可', credits: 2 },
      { id: 'd-g6', course: '英語I', term: '2025 2学期', grade: '良', credits: 1 },
      { id: 'd-g7', course: '線形代数I', term: '2025 2学期', grade: '優', credits: 2 },
    ],
    jobEntries: [
      {
        id: 'd-j1',
        company: '株式会社サンプルテック',
        entryType: '会社説明会',
        deadline: day(12),
        memo: 'オンライン開催',
        done: false,
        status: 'エントリー済',
      },
      {
        id: 'd-j2',
        company: 'サンプルシステムズ株式会社',
        entryType: 'エントリーシート提出',
        deadline: day(20),
        done: false,
        status: '気になる',
      },
      {
        // 「今日やること」の就活の予定(3日以内)に出る見本
        id: 'd-j4',
        company: 'サンプル工業株式会社',
        entryType: 'エントリーシート提出',
        deadline: day(2),
        done: false,
        status: '気になる',
      },
      {
        id: 'd-j3',
        company: '株式会社サンプル情報',
        entryType: '夏季インターン',
        deadline: day(-5),
        done: true,
        status: '選考中',
      },
    ],
    jobNotes: [
      {
        id: 'd-n1',
        category: 'ガクチカ',
        title: '学園祭の実行委員',
        body: '広報担当として、SNSでの告知を担当した。前年より来場者が増えた。',
      },
      {
        id: 'd-n2',
        category: '自己PR',
        title: '手を動かして確かめる',
        body: '分からないことは、まず小さく作って動かしてから考えるようにしている。',
      },
    ],
    jobProfile: {
      interests: 'Webアプリの開発',
      location: '香川県・関西',
      industries: 'IT・情報通信',
      jobType: 'エンジニア',
      startPeriod: '2028年4月',
    },
  }
}

let store: DemoStore | null = null

/** デモ用のデータ置き場(このタブのメモリ上だけ。再読み込みで初期状態に戻る) */
export function demoStore(): DemoStore {
  if (!store) store = seed()
  return store
}

let seq = 0
/** デモ中に追加されたデータ用のID */
export function demoId(): string {
  seq += 1
  return `d-new-${seq}`
}
