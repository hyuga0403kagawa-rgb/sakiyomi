// 就活の予定を、課題と同じように「今日やること」で見せるための選び方と表示。
// 通知(push-notify)も同じく「3日前・前日・当日」に揃えている。
import type { JobEntry } from './types'
import { WEEKDAY_JA, dayKey } from './format'

/** 今日やることに出す範囲(今日から何日後まで) */
export const JOB_LOOKAHEAD_DAYS = 3

/** YYYY-MM-DD 同士の日数差(b - a)。端末のタイムゾーンに依存しないよう日付だけで数える */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/**
 * 未完了で、期限が今日から JOB_LOOKAHEAD_DAYS 日後までの予定を、近い順に返す。
 * 期限を過ぎたものは出さない(説明会など「済んだが完了にし忘れた」ものが残り続けるため)
 */
export function upcomingJobEntries(entries: JobEntry[], today: string = dayKey(new Date())): JobEntry[] {
  return entries
    .filter((e) => {
      if (e.done || !e.deadline) return false
      const d = daysBetween(today, e.deadline)
      return d >= 0 && d <= JOB_LOOKAHEAD_DAYS
    })
    .sort((a, b) => a.deadline!.localeCompare(b.deadline!))
}

/** 「今日」「明日」「あと2日」と、その色 */
export function jobCountdown(deadline: string, today: string = dayKey(new Date())): { label: string; color: string } {
  const d = daysBetween(today, deadline)
  if (d <= 0) return { label: '今日', color: 'text-red-600' }
  if (d === 1) return { label: '明日', color: 'text-orange-600' }
  return { label: `あと${d}日`, color: 'text-gray-600' }
}

/** "2026-09-25" → "9/25(金)" */
export function fmtJobDate(deadline: string): string {
  const [y, m, d] = deadline.split('-').map(Number)
  return `${m}/${d}(${WEEKDAY_JA[new Date(y, m - 1, d).getDay()]})`
}
