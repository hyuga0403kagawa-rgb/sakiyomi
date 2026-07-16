import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Task } from './types'
import TaskRow from './TaskRow'
import { WEEKDAY_JA, dayKey } from './format'

/** 締切を月表示で確認するカレンダー(「すべて」タブの📅から開くサブ画面)。
 *  将来的にはGoogle/Apple/Outlookカレンダー連携(プレミアム)をここに載せる予定 */
export default function CalendarTab(props: {
  tasks: Task[]
  onToggle: (id: string) => void
  onBack: () => void
}) {
  const { tasks, onToggle, onBack } = props
  const today = new Date()
  const todayKey = dayKey(today)
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selected, setSelected] = useState(todayKey)

  const byDay = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of tasks) {
      if (!t.due) continue
      const k = dayKey(new Date(t.due))
      m.set(k, [...(m.get(k) ?? []), t])
    }
    return m
  }, [tasks])

  const firstWeekday = new Date(month.getFullYear(), month.getMonth(), 1).getDay()
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells: (Date | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from(
      { length: daysInMonth },
      (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1),
    ),
  ]

  const moveMonth = (delta: number) =>
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1))

  const selectedTasks = (byDay.get(selected) ?? [])
    .slice()
    .sort((a, b) => new Date(a.due!).getTime() - new Date(b.due!).getTime())
  const [selY, selM, selD] = selected.split('-').map(Number)

  return (
    <main className="px-4 py-4">
      <button onClick={onBack} className="text-sm text-primary">
        ← すべてに戻る
      </button>
      <div className="mt-2 flex items-center justify-between">
        <button
          onClick={() => moveMonth(-1)}
          className="rounded-lg px-3 py-1 text-lg text-gray-500 hover:bg-gray-100"
          aria-label="前の月"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h2 className="text-base font-semibold text-gray-800">
          {month.getFullYear()}年{month.getMonth() + 1}月
        </h2>
        <button
          onClick={() => moveMonth(1)}
          className="rounded-lg px-3 py-1 text-lg text-gray-500 hover:bg-gray-100"
          aria-label="次の月"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 text-center text-xs text-gray-400">
        {WEEKDAY_JA.map((w, i) => (
          <div
            key={w}
            className={`py-1 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : ''}`}
          >
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={`empty-${i}`} />
          const k = dayKey(d)
          const dayTasks = byDay.get(k) ?? []
          const undone = dayTasks.filter((t) => !t.done).length
          const isSelected = k === selected
          const isToday = k === todayKey
          return (
            <button
              key={k}
              onClick={() => setSelected(k)}
              className={`flex aspect-square flex-col items-center justify-center rounded-lg text-sm ${
                isSelected
                  ? 'bg-primary text-white'
                  : isToday
                    ? 'bg-primary-soft text-primary-dark font-semibold'
                    : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <span>{d.getDate()}</span>
              {dayTasks.length > 0 && (
                <span
                  className={`mt-0.5 h-4 min-w-4 rounded-full px-1 text-[10px] leading-4 ${
                    isSelected
                      ? 'bg-white text-primary'
                      : undone > 0
                        ? 'bg-primary text-white'
                        : 'bg-gray-300 text-white'
                  }`}
                >
                  {undone > 0 ? undone : '✓'}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <h3 className="mt-5 text-sm font-semibold text-gray-700">
        {selM}月{selD}日({WEEKDAY_JA[new Date(selY, selM - 1, selD).getDay()]})の課題
      </h3>
      {selectedTasks.length === 0 ? (
        <p className="mt-2 text-sm text-gray-400">この日の課題はありません</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {selectedTasks.map((t) => (
            <TaskRow key={t.id} task={t} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </main>
  )
}
