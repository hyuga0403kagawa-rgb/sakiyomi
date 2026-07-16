import type { Task } from './types'
import type { TodayPlan } from './planner'
import { fmtCountdown, fmtMinutes } from './format'

export interface Recommendation {
  text: string
  /** 警告(赤系)として表示すべきか */
  warning: boolean
}

/**
 * ホーム画面の「AIおすすめ」。
 * 自動プランニングの結果と期限状況から、今日の一言アドバイスを組み立てる。
 */
export function buildRecommendation(tasks: Task[], plan: TodayPlan): Recommendation {
  const active = tasks.filter((t) => !t.done)
  const overdue = active.filter((t) => t.due && new Date(t.due).getTime() < Date.now())

  if (overdue.length > 0) {
    return {
      text: `期限切れの未提出が${overdue.length}件あります。まず「${overdue[0].title}」から片付けましょう。`,
      warning: true,
    }
  }
  if (active.length === 0) {
    return {
      text: '未提出の課題はゼロです!新しい課題が来たら自動でお知らせします',
      warning: false,
    }
  }
  if (plan.items.length === 0) {
    const next = active
      .filter((t) => t.due)
      .sort((a, b) => new Date(a.due!).getTime() - new Date(b.due!).getTime())[0]
    return {
      text: next
        ? `今日やる分はありません。余裕があれば「${next.title}」(${fmtCountdown(next.due!)})を先取りしましょう。`
        : '今日やる分はありません。ゆっくり休みましょう!',
      warning: false,
    }
  }

  const names = plan.items
    .slice(0, 2)
    .map((i) => `「${i.task.title}」`)
    .join('と')
  let text = `今日は${fmtMinutes(plan.totalMinutes)}。${names}を進めれば予定どおりです。`
  let warning = false
  if (plan.overloaded) {
    text += ' このペースだと間に合わない課題があるので、多めに進めるのがおすすめです。'
    warning = true
  }
  return { text, warning }
}
