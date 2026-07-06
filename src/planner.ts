import type { Task } from './types'

export interface PlanItem {
  task: Task
  minutes: number
  /** 期限までに収まりきらず、期限日に詰め込んだ分 */
  crammed?: boolean
}

export interface TodayPlan {
  items: PlanItem[]
  totalMinutes: number
  overloaded: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 「今日やること」の自動提案(v1: 貪欲法)。
 *
 * 期限が近いタスクから順に、今日から期限日までの空き時間へ
 * 1日の上限(minutesPerDay)を守りながら割り振っていく。
 * 期限までに収まりきらない分は期限日に詰め込み、overloaded として警告する。
 * 期限のないタスクは、日程が埋まったあとの今日の残り時間に入れる。
 */
export function buildTodayPlan(tasks: Task[], minutesPerDay: number): TodayPlan {
  const today = startOfDay(new Date())
  const todayKey = dayKey(today)
  const used = new Map<string, number>()
  const todayItems = new Map<string, PlanItem>() // taskId → item
  let overloaded = false

  const addToDay = (key: string, task: Task, minutes: number, crammed: boolean) => {
    used.set(key, (used.get(key) ?? 0) + minutes)
    if (key !== todayKey) return
    const prev = todayItems.get(task.id)
    todayItems.set(task.id, {
      task,
      minutes: (prev?.minutes ?? 0) + minutes,
      crammed: prev?.crammed || crammed,
    })
  }

  const active = tasks.filter((t) => !t.done)
  const dated = active
    .filter((t) => t.due)
    .sort((a, b) => new Date(a.due!).getTime() - new Date(b.due!).getTime())

  for (const task of dated) {
    let remaining = task.estimatedMinutes
    let dueDay = startOfDay(new Date(task.due!))
    if (dueDay < today) dueDay = today // 期限切れは今日やるしかない

    let day = new Date(today)
    while (remaining > 0) {
      if (day > dueDay) {
        // 期限までの空きに収まらなかった → 期限日に詰め込んで警告
        addToDay(dayKey(dueDay), task, remaining, true)
        overloaded = true
        break
      }
      const key = dayKey(day)
      const free = minutesPerDay - (used.get(key) ?? 0)
      if (free > 0) {
        const take = Math.min(free, remaining)
        addToDay(key, task, take, false)
        remaining -= take
      }
      if (remaining > 0) day = new Date(day.getTime() + DAY_MS)
    }
  }

  // 期限なしタスクは今日の残り時間に入るだけ入れる
  const undated = active.filter((t) => !t.due)
  for (const task of undated) {
    const free = minutesPerDay - (used.get(todayKey) ?? 0)
    if (free <= 0) break
    addToDay(todayKey, task, Math.min(free, task.estimatedMinutes), false)
  }

  const items = [...todayItems.values()].sort((a, b) => {
    const ad = a.task.due ? new Date(a.task.due).getTime() : Infinity
    const bd = b.task.due ? new Date(b.task.due).getTime() : Infinity
    return ad - bd
  })

  return {
    items,
    totalMinutes: items.reduce((sum, it) => sum + it.minutes, 0),
    overloaded,
  }
}
