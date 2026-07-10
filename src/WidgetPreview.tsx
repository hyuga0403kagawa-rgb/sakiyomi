import { useEffect, useMemo, useState } from 'react'
import type { JobEntry, Settings, Task, TimetableSlot } from './types'
import * as repo from './repo'
import { buildWidgetSummary } from './widgetSummary'
import { colorClass } from './courseColors'
import { PERIOD_TIMES } from './periods'
import { ON_DEMAND_DAY, todayDayValue, visibleDayDefs } from './timetableDays'
import { defaultSemester, parseSemester } from './semester'

type WidgetKind = 'todo' | 'today' | 'week' | 'summary'
const KINDS: { key: WidgetKind; label: string }[] = [
  { key: 'todo', label: 'やること' },
  { key: 'today', label: '今日の時間割' },
  { key: 'week', label: '週間の時間割' },
  { key: 'summary', label: 'まとめ' },
]

function fmtDue(due?: string): string {
  if (!due) return ''
  const d = new Date(due)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** チェックボックスで完了できる「やること」ウィジェット */
function TodoWidget(props: { tasks: Task[]; onToggle: (id: string) => void }) {
  const active = props.tasks
    .filter((t) => !t.done)
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'))
  return (
    <div className="mx-auto max-w-xs rounded-2xl bg-neutral-800 p-3 shadow-lg">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-teal-300">
          やること <span className="text-white/60">{active.length}</span>
        </span>
        <span className="text-lg text-white/40">+</span>
      </div>
      <ul className="mt-2 space-y-2">
        {active.slice(0, 6).map((t) => (
          <li key={t.id} className="flex items-center gap-2">
            <button
              onClick={() => props.onToggle(t.id)}
              aria-label="完了にする"
              className="h-4 w-4 shrink-0 rounded-full border border-white/40"
            />
            <span className="min-w-0 flex-1 truncate text-[13px] text-white">{t.title}</span>
            {t.due && <span className="shrink-0 text-[11px] text-white/40">{fmtDue(t.due)}</span>}
          </li>
        ))}
        {active.length === 0 && (
          <li className="py-4 text-center text-xs text-white/40">やることはありません 🎉</li>
        )}
      </ul>
    </div>
  )
}

/** 今日の時間割ウィジェット(授業がなければ休日表示) */
function TodayWidget(props: { slots: TimetableSlot[]; settings: Settings; colors: Record<string, string> }) {
  const semester = props.settings.currentSemester ?? defaultSemester()
  const dv = todayDayValue()
  const todays = props.slots
    .filter((s) => s.day === dv && s.semester === semester)
    .sort((a, b) => a.period - b.period)
  return (
    <div className="mx-auto flex min-h-40 max-w-xs flex-col rounded-2xl bg-white p-3 shadow-lg">
      {todays.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-xl font-black text-white">
            U
          </div>
          <p className="mt-2 text-base font-bold text-gray-800">休日</p>
          <p className="mt-0.5 text-xs text-gray-500">今日は授業がありません📣</p>
        </div>
      ) : (
        <>
          <p className="text-[11px] font-bold text-indigo-500">今日の時間割</p>
          <ul className="mt-1.5 space-y-1.5">
            {todays.map((s) => {
              const c = colorClass(props.colors[s.course])
              return (
                <li key={s.id} className="flex items-center gap-2">
                  <span className={`h-7 w-1 shrink-0 rounded-full ${c.swatch}`} />
                  <span className="w-6 shrink-0 text-center text-xs font-bold text-gray-500">{s.period}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-gray-800">{s.course}</span>
                    <span className="block text-[10px] text-gray-400">
                      {PERIOD_TIMES[s.period]?.join('〜') ?? ''}
                      {s.room && ` · ${s.room}`}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

/** 一週間の時間割ウィジェット(ミニグリッド) */
function WeekWidget(props: { slots: TimetableSlot[]; settings: Settings; colors: Record<string, string> }) {
  const semester = props.settings.currentSemester ?? defaultSemester()
  const dayDefs = visibleDayDefs(props.settings.timetableDays ?? 'sat')
  const weekSlots = props.slots.filter((s) => s.semester === semester && s.day !== ON_DEMAND_DAY)
  const maxPeriod = Math.max(5, ...weekSlots.map((s) => s.period))
  const periods = Array.from({ length: maxPeriod }, (_, i) => i + 1)
  const dv = todayDayValue()
  const at = (day: number, period: number) =>
    weekSlots.find((s) => s.day === day && s.period === period)
  const { year, term } = parseSemester(semester)

  return (
    <div className="mx-auto max-w-xs rounded-2xl bg-white p-2.5 shadow-lg">
      <p className="mb-1 px-0.5 text-[10px] font-bold text-gray-500">
        {year}年 {term}
      </p>
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `0.7rem repeat(${dayDefs.length}, 1fr)` }}
      >
        <div />
        {dayDefs.map((d) => (
          <div
            key={d.day}
            className={`text-center text-[9px] font-medium ${
              d.day === dv ? 'text-indigo-600' : 'text-gray-400'
            }`}
          >
            {d.label}
          </div>
        ))}
        {periods.map((p) => (
          <div key={p} className="contents">
            <div className="flex items-center justify-center text-[8px] text-gray-300">{p}</div>
            {dayDefs.map(({ day }) => {
              const s = at(day, p)
              const c = s ? colorClass(props.colors[s.course]) : null
              return (
                <div
                  key={`${day}-${p}`}
                  className={`min-h-6 rounded-sm p-0.5 ${s ? c!.cell : 'bg-gray-50'}`}
                >
                  {s && (
                    <span className={`block break-all text-[7px] leading-tight ${c!.text}`}>
                      {s.course.length > 6 ? s.course.slice(0, 6) : s.course}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

/** まとめウィジェット(次の授業・課題・就活をひと目で) */
function SummaryWidget(props: {
  tasks: Task[]
  slots: TimetableSlot[]
  jobEntries: JobEntry[]
  settings: Settings
}) {
  const s = buildWidgetSummary(props.tasks, props.slots, props.jobEntries, props.settings)
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
          main={s.nextJob ? s.nextJob.company : '予定なし'}
          sub={s.nextJob?.label}
          urgent={s.nextJob?.urgent}
        />
      </div>
    </div>
  )
}

/**
 * ホーム画面ウィジェットの完成イメージ(プレビュー)。実データで描画する。
 * 実物のウィジェットはネイティブ(アプリ)版でのみ動作するため、ここは「準備中」の見本。
 */
export default function WidgetPreview(props: {
  tasks: Task[]
  slots: TimetableSlot[]
  settings: Settings
  onToggle: (id: string) => void
}) {
  const { tasks, slots, settings, onToggle } = props
  const [kind, setKind] = useState<WidgetKind>('todo')
  const [jobEntries, setJobEntries] = useState<JobEntry[]>([])
  const [colors, setColors] = useState<Record<string, string>>({})

  useEffect(() => {
    repo.fetchJobEntries().then(setJobEntries).catch(() => {})
    repo.fetchCourseColors().then(setColors).catch(() => {})
  }, [])

  const widget = useMemo(() => {
    switch (kind) {
      case 'todo':
        return <TodoWidget tasks={tasks} onToggle={onToggle} />
      case 'today':
        return <TodayWidget slots={slots} settings={settings} colors={colors} />
      case 'week':
        return <WeekWidget slots={slots} settings={settings} colors={colors} />
      case 'summary':
        return <SummaryWidget tasks={tasks} slots={slots} jobEntries={jobEntries} settings={settings} />
    }
  }, [kind, tasks, slots, settings, colors, jobEntries, onToggle])

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-1.5">
        {KINDS.map((k) => (
          <button
            key={k.key}
            onClick={() => setKind(k.key)}
            className={`rounded-full px-2.5 py-1 text-xs ${
              kind === k.key ? 'bg-violet-600 text-white' : 'bg-white text-violet-600'
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div className="mt-2 rounded-2xl bg-gradient-to-br from-slate-200 to-slate-300 p-4">
        {widget}
        <p className="mt-2 text-center text-[10px] text-slate-500">
          あなたのデータで表示中(完成イメージ)
        </p>
      </div>
    </div>
  )
}
