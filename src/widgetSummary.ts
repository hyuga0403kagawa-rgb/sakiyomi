// ウィジェット(ネイティブ版のホーム画面ウィジェット)が表示する要約データを作る。
// 今はアプリ内のプレビューで使い、将来ネイティブ版のウィジェットが同じ内容を描画する。
import type { JobEntry, Settings, Task, TimetableSlot } from './types'
import { PERIOD_TIMES } from './periods'
import { defaultSemester } from './semester'

export interface WidgetSummary {
  nextClass: { period: number; course: string; room?: string; start: string } | null
  nextTask: { title: string; course?: string; label: string; urgent: boolean } | null
  nextJob: { company: string; entryType: string; label: string; urgent: boolean } | null
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 日曜=7, 月〜土=0〜5(時間割の day 値に合わせる) */
function todayDayValue(d: Date): number {
  const j = d.getDay()
  return j === 0 ? 7 : j - 1
}

/** 日付文字列(YYYY-MM-DD)の残り日数(その日を含む) */
function daysLeftFromDate(dateStr: string, now: Date): number {
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const [y, m, d] = dateStr.split('-').map(Number)
  return Math.round((new Date(y, m - 1, d).getTime() - d0.getTime()) / 86400_000)
}

export function buildWidgetSummary(
  tasks: Task[],
  slots: TimetableSlot[],
  jobEntries: JobEntry[],
  settings: Settings,
  now: Date = new Date(),
): WidgetSummary {
  // 次の授業: 今日・現在の学期で、まだ終わっていない最初のコマ
  const semester = settings.currentSemester ?? defaultSemester()
  const dv = todayDayValue(now)
  const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  const todays = slots
    .filter((s) => s.day === dv && s.semester === semester)
    .filter((s) => PERIOD_TIMES[s.period] && PERIOD_TIMES[s.period][1] > hm)
    .sort((a, b) => a.period - b.period)
  const nc = todays[0]
  const nextClass = nc
    ? { period: nc.period, course: nc.course, room: nc.room, start: PERIOD_TIMES[nc.period]?.[0] ?? '' }
    : null

  // 直近の未提出課題
  const pending = tasks
    .filter((t) => !t.done && t.due)
    .sort((a, b) => new Date(a.due!).getTime() - new Date(b.due!).getTime())
  const nt = pending[0]
  let nextTask: WidgetSummary['nextTask'] = null
  if (nt) {
    const hours = (new Date(nt.due!).getTime() - now.getTime()) / 3600_000
    const label =
      hours < 0
        ? '期限切れ'
        : hours < 24
          ? `あと${Math.max(1, Math.round(hours))}時間`
          : `あと${Math.round(hours / 24)}日`
    nextTask = { title: nt.title, course: nt.course, label, urgent: hours < 48 }
  }

  // 直近の就活予定
  const jobs = jobEntries
    .filter((j) => !j.done && j.deadline)
    .sort((a, b) => a.deadline!.localeCompare(b.deadline!))
  const nj = jobs[0]
  let nextJob: WidgetSummary['nextJob'] = null
  if (nj) {
    const dleft = daysLeftFromDate(nj.deadline!, now)
    const label = dleft < 0 ? '期限切れ' : dleft === 0 ? '今日' : `あと${dleft}日`
    nextJob = { company: nj.company, entryType: nj.entryType, label, urgent: dleft <= 1 }
  }

  return { nextClass, nextTask, nextJob }
}
