// 時間割の曜日定義。時間割タブとウィジェットのプレビューで共用する。
// day の値: 月〜土=0〜5, 6=オンデマンド(グリッド外), 7=日
import type { TimetableDays } from './types'

export const ON_DEMAND_DAY = 6

export const WEEKDAY_DEFS = [
  { label: '月', day: 0 },
  { label: '火', day: 1 },
  { label: '水', day: 2 },
  { label: '木', day: 3 },
  { label: '金', day: 4 },
]
export const SAT_DEF = { label: '土', day: 5 }
export const SUN_DEF = { label: '日', day: 7 }
export const DAY_LABEL: Record<number, string> = {
  0: '月',
  1: '火',
  2: '水',
  3: '木',
  4: '金',
  5: '土',
  7: '日',
}

/** 表示設定に応じた曜日カラムの定義 */
export function visibleDayDefs(mode: TimetableDays): { label: string; day: number }[] {
  if (mode === 'weekday') return WEEKDAY_DEFS
  if (mode === 'satsun') return [...WEEKDAY_DEFS, SAT_DEF, SUN_DEF]
  return [...WEEKDAY_DEFS, SAT_DEF]
}

/** 今日の day 値(日曜=7, 月〜土=0〜5) */
export function todayDayValue(d: Date = new Date()): number {
  const j = d.getDay()
  return j === 0 ? 7 : j - 1
}
