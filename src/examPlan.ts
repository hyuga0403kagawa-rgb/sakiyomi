// テスト対策の勉強計画。仕様は docs/テスト対策_仕様.md(2026-10-03 社長と決定)。
//
// 考え方:
//  - 勉強する日は「始める日」から「テストの前日」まで。テスト当日は入れない
//  - 合計時間は守る。やった分(doneLog)を引いた残りを、まだ来ていない日に配る
//  - 自分で直した日(overrides)はその値で固定し、残りを直していない日に型の比率で配る
//    (休みにした日の分は、ほかの日に上乗せされる)
//  - 過ぎた日にやらなかった分も、残りの日に配り直される
import type { Exam, ExamPattern, ExamWeight } from './types'
import { dayKey } from './format'

/** 重みごとの目安(数字は仮。社長の感覚で置いたもので根拠はない) */
export const WEIGHT_DEFAULTS: Record<ExamWeight, { label: string; leadDays: number; leadLabel: string; minutes: number }> = {
  light: { label: '軽い', leadDays: 7, leadLabel: '1週間前', minutes: 3 * 60 },
  normal: { label: '普通', leadDays: 14, leadLabel: '2週間前', minutes: 8 * 60 },
  heavy: { label: '重い', leadDays: 30, leadLabel: '1か月前', minutes: 20 * 60 },
}

export const PATTERN_LABELS: Record<ExamPattern, string> = {
  late: '直前ほど多く',
  even: '毎日均等',
  early: '前半から多め',
}

/**
 * 前半(最初の1/2)・中盤(次の1/4)・直前(最後の1/4)の、1日あたりの濃さ。
 * 期間ごとの割合(例 30/30/40%)で決めると、日数の少ない期間の1日あたりが大きくなり、
 * 直前より中盤が多くなる・前半から多めの前半が少なくなる、と逆転したため、1日あたりで決める(2026-10-04)。
 * 「直前ほど多く」の 1:2:3 は、重い・20時間・1か月で 約25/50/70分 になる(仕様の例と同じ見え方)
 */
const PATTERN_INTENSITY: Record<ExamPattern, [number, number, number]> = {
  late: [1, 2, 3],
  even: [1, 1, 1],
  early: [2, 1.5, 1],
}

/** 1日の勉強時間の刻み(分) */
const STEP = 5

/** シラバスの「試験◯%」から重みの初期値を決める(境目は仮) */
export function weightFromExamPct(pct?: number): ExamWeight {
  if (pct == null) return 'normal'
  if (pct >= 50) return 'heavy'
  if (pct < 20) return 'light'
  return 'normal'
}

/** 'YYYY-MM-DD' に日数を足す */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number)
  return dayKey(new Date(y, m - 1, d + days))
}

/** b - a の日数 */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** 重みの目安どおりの始める日 */
export function defaultStartDate(examDate: string, weight: ExamWeight): string {
  return addDays(examDate, -WEIGHT_DEFAULTS[weight].leadDays)
}

/** 勉強する日の一覧(始める日〜テストの前日) */
export function studyDays(exam: Pick<Exam, 'startDate' | 'examDate'>): string[] {
  const days: string[] = []
  for (let d = exam.startDate; d < exam.examDate; d = addDays(d, 1)) days.push(d)
  return days
}

/** 型に沿った、日ごとの比率(合計1) */
function patternWeights(n: number, pattern: ExamPattern): number[] {
  if (n === 0) return []
  const phaseOf = (i: number) => {
    const pos = (i + 0.5) / n
    return pos < 0.5 ? 0 : pos < 0.75 ? 1 : 2
  }
  const intensity = PATTERN_INTENSITY[pattern]
  const raw = Array.from({ length: n }, (_, i) => intensity[phaseOf(i)])
  const sum = raw.reduce((a, b) => a + b, 0)
  return raw.map((w) => w / sum)
}

/** total(分)を比率どおりに STEP 分刻みで配る。合計はぴったり合わせる */
function distribute(total: number, weights: number[]): number[] {
  if (weights.length === 0) return []
  const units = Math.round(total / STEP)
  const wsum = weights.reduce((a, b) => a + b, 0) || 1
  const exact = weights.map((w) => (units * w) / wsum)
  const out = exact.map(Math.floor)
  let left = units - out.reduce((a, b) => a + b, 0)
  // 端数の大きい日から1刻みずつ足す(同じなら後ろの日=テストに近い日を優先)
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || b.i - a.i)
  for (const { i } of order) {
    if (left <= 0) break
    out[i]++
    left--
  }
  return out.map((u) => u * STEP)
}

export type ExamDayKind = 'done' | 'missed' | 'today' | 'planned'

export interface ExamDay {
  date: string
  minutes: number
  kind: ExamDayKind
  /** 自分で直した日か */
  overridden: boolean
}

export interface ExamSchedule {
  days: ExamDay[]
  /** やった合計(分) */
  doneMinutes: number
  /** 残りの日に入りきらない(直していない日が残っていない)分 */
  shortfall: number
}

/**
 * 日ごとの計画。過ぎた日はやった分(なければ0)、今日以降は残りを配った値。
 * 今日すでにチェック済みなら、今日は 'done' として固定する。
 */
export function buildExamSchedule(exam: Exam, today: string = dayKey(new Date())): ExamSchedule {
  const all = studyDays(exam)
  const weights = patternWeights(all.length, exam.pattern)
  const doneMinutes = Object.values(exam.doneLog).reduce((a, b) => a + b, 0)
  const remaining = Math.max(0, exam.totalMinutes - doneMinutes)

  // これから配る日(今日でまだやっていない日と、明日以降)
  const future = all
    .map((date, i) => ({ date, w: weights[i] }))
    .filter(({ date }) => date > today || (date === today && exam.doneLog[date] == null))
  const fixed = future.filter(({ date }) => exam.overrides[date] != null)
  const flex = future.filter(({ date }) => exam.overrides[date] == null)
  const fixedSum = fixed.reduce((a, { date }) => a + exam.overrides[date], 0)
  const flexTotal = Math.max(0, remaining - fixedSum)
  const flexMinutes = distribute(flexTotal, flex.map((f) => f.w))
  const planned = new Map<string, number>()
  flex.forEach((f, i) => planned.set(f.date, flexMinutes[i]))
  fixed.forEach(({ date }) => planned.set(date, exam.overrides[date]))

  const days: ExamDay[] = all.map((date) => {
    const overridden = exam.overrides[date] != null
    if (exam.doneLog[date] != null) return { date, minutes: exam.doneLog[date], kind: 'done', overridden }
    if (date < today) return { date, minutes: 0, kind: 'missed', overridden }
    return { date, minutes: planned.get(date) ?? 0, kind: date === today ? 'today' : 'planned', overridden }
  })

  return {
    days,
    doneMinutes,
    shortfall: flex.length === 0 ? Math.max(0, remaining - fixedSum) : 0,
  }
}

/** 今日このテストに割り当てる時間(分)。今日が勉強期間外、またはチェック済みなら0 */
export function todayExamMinutes(exam: Exam, today: string = dayKey(new Date())): number {
  const day = buildExamSchedule(exam, today).days.find((d) => d.date === today)
  return day && day.kind === 'today' ? day.minutes : 0
}

/** やることリストのうち、まだ終わっていない一番上の項目 */
export function nextTodo(exam: Exam): string | undefined {
  return exam.todos.find((t) => !t.done)?.text
}

/** 終わっていない(テストの日が今日以降の)テストを近い順に */
export function upcomingExams(exams: Exam[], today: string = dayKey(new Date())): Exam[] {
  return exams.filter((e) => e.examDate >= today).sort((a, b) => a.examDate.localeCompare(b.examDate))
}

/** 「今日」「明日」「あと12日」 */
export function examCountdown(exam: Exam, today: string = dayKey(new Date())): string {
  const d = daysBetween(today, exam.examDate)
  if (d <= 0) return '今日'
  if (d === 1) return '明日'
  return `あと${d}日`
}

/** 仮の日付の「日程は決まりましたか?」を出すか(テストの1週間前から、1回だけ) */
export function shouldAskTentative(exam: Exam, today: string = dayKey(new Date())): boolean {
  if (!exam.tentative || exam.tentativeAsked) return false
  const d = daysBetween(today, exam.examDate)
  return d >= 0 && d <= 7
}

/** 新しいテストの初期値 */
export function newExamDraft(examDate: string, weight: ExamWeight, course?: string): Omit<Exam, 'id'> {
  return {
    course,
    title: '期末試験',
    examDate,
    tentative: false,
    weight,
    startDate: defaultStartDate(examDate, weight),
    totalMinutes: WEIGHT_DEFAULTS[weight].minutes,
    pattern: 'late',
    overrides: {},
    doneLog: {},
    todos: [],
    tentativeAsked: false,
  }
}
