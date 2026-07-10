import { useEffect, useMemo, useState } from 'react'
import type { JobEntry, Settings, Task, TimetableSlot } from './types'
import * as repo from './repo'
import { buildWidgetSummary } from './widgetSummary'

/**
 * ホーム画面ウィジェットの完成イメージ(プレビュー)。実データで描画する。
 * 実物のウィジェットはネイティブ(アプリ)版でのみ動作するため、ここは「準備中」の見本。
 * ネイティブ版は buildWidgetSummary() の同じ内容を描画する。
 */
export default function WidgetPreview(props: {
  tasks: Task[]
  slots: TimetableSlot[]
  settings: Settings
}) {
  const { tasks, slots, settings } = props
  const [jobEntries, setJobEntries] = useState<JobEntry[]>([])

  useEffect(() => {
    repo.fetchJobEntries().then(setJobEntries).catch(() => {})
  }, [])

  const s = useMemo(
    () => buildWidgetSummary(tasks, slots, jobEntries, settings),
    [tasks, slots, jobEntries, settings],
  )

  const Row = (p: { icon: string; label: string; main: string; sub?: string; urgent?: boolean }) => (
    <div className="flex items-center gap-2">
      <span className="text-sm">{p.icon}</span>
      <span className="w-9 shrink-0 text-[10px] text-white/60">{p.label}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-white">{p.main}</span>
      {p.sub && (
        <span className={`shrink-0 text-[11px] font-bold ${p.urgent ? 'text-rose-300' : 'text-white/70'}`}>
          {p.sub}
        </span>
      )}
    </div>
  )

  return (
    <div className="mt-3">
      {/* ホーム画面っぽい背景の上にウィジェットを載せる */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-200 to-slate-300 p-4">
        <div className="mx-auto max-w-xs rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 p-3 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-white/90">UniPort</span>
            <span className="text-[9px] text-white/50">今日</span>
          </div>
          <div className="mt-2 space-y-1.5">
            <Row
              icon="📚"
              label="授業"
              main={s.nextClass ? `${s.nextClass.period}限 ${s.nextClass.course}` : '今日の授業なし'}
              sub={s.nextClass ? s.nextClass.start : undefined}
            />
            <Row
              icon="📝"
              label="課題"
              main={s.nextTask ? s.nextTask.title : '未提出なし'}
              sub={s.nextTask?.label}
              urgent={s.nextTask?.urgent}
            />
            <Row
              icon="💼"
              label="就活"
              main={s.nextJob ? `${s.nextJob.company}` : '予定なし'}
              sub={s.nextJob?.label}
              urgent={s.nextJob?.urgent}
            />
          </div>
        </div>
        <p className="mt-2 text-center text-[10px] text-slate-500">
          ↑ ホーム画面ウィジェットの完成イメージ(あなたのデータで表示中)
        </p>
      </div>
    </div>
  )
}
