// テスト対策の画面(一覧と、1件の編集)。仕様は docs/テスト対策_仕様.md
import { useEffect, useMemo, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import type { Exam, ExamPattern, ExamWeight } from './types'
import * as repo from './repo'
import { WEEKDAY_JA, dayKey, fmtMinutes } from './format'
import {
  PATTERN_LABELS,
  WEIGHT_DEFAULTS,
  addDays,
  buildExamSchedule,
  defaultStartDate,
  examCountdown,
  newExamDraft,
  studyDays,
  upcomingExams,
  weightFromExamPct,
} from './examPlan'

/** "2026-10-05" → "10/5(月)" */
export function fmtExamDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return `${m}/${d}(${WEEKDAY_JA[new Date(y, m - 1, d).getDay()]})`
}

const WEIGHTS: ExamWeight[] = ['light', 'normal', 'heavy']
const PATTERNS: ExamPattern[] = ['late', 'even', 'early']
/** 1日分を直すときの候補(分)。0は休み */
const DAY_CHOICES = [0, 15, 30, 45, 60, 90, 120]

export default function ExamScreen(props: {
  exams: Exam[]
  onChange: (exams: Exam[]) => void
  /** 開いたときに直接編集するテスト('new' なら新規) */
  initialOpen?: string | null
  onBack: () => void
  onFlash: (text: string) => void
  courseSuggestions: string[]
}) {
  const { exams, onChange, initialOpen, onBack, onFlash, courseSuggestions } = props
  const [open, setOpen] = useState<string | null>(initialOpen ?? null)
  const [showPast, setShowPast] = useState(false)
  const today = dayKey(new Date())
  // 一覧と編集を切り替えたら先頭から見せる(前の画面のスクロール位置が残るため)
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [open])

  const upcoming = useMemo(() => upcomingExams(exams, today), [exams, today])
  const past = useMemo(
    () => exams.filter((e) => e.examDate < today).sort((a, b) => b.examDate.localeCompare(a.examDate)),
    [exams, today],
  )

  if (open) {
    const target = open === 'new' ? null : exams.find((e) => e.id === open) ?? null
    return (
      <ExamEditor
        key={open}
        exam={target}
        courseSuggestions={courseSuggestions}
        onFlash={onFlash}
        onClose={() => (initialOpen && initialOpen === open ? onBack() : setOpen(null))}
        onSaved={(saved) => {
          const exists = exams.some((e) => e.id === saved.id)
          onChange(exists ? exams.map((e) => (e.id === saved.id ? saved : e)) : [...exams, saved])
        }}
        onDeleted={(id) => onChange(exams.filter((e) => e.id !== id))}
      />
    )
  }

  return (
    <main className="px-4 py-4">
      <button onClick={onBack} className="text-sm text-primary">
        ← 今日に戻る
      </button>
      <h2 className="mt-3 text-base font-semibold text-gray-800">テスト対策</h2>
      <p className="mt-0.5 text-[11px] text-gray-400">
        期末・中間のテストを登録すると、始める日から「今日やること」に勉強時間が出ます(締切の近い課題が優先)。
      </p>

      <button
        onClick={() => setOpen('new')}
        className="mt-3 w-full rounded-lg bg-primary py-2 text-sm font-semibold text-white"
      >
        + テストを追加
      </button>

      {upcoming.length === 0 ? (
        <p className="mt-6 text-center text-sm text-gray-400">これからのテストはありません</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {upcoming.map((e) => (
            <ExamCard key={e.id} exam={e} today={today} onOpen={() => setOpen(e.id)} />
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <div className="mt-5">
          <button onClick={() => setShowPast(!showPast)} className="text-xs text-gray-500 underline">
            {showPast ? '終わったテストを隠す' : `終わったテスト(${past.length})`}
          </button>
          {showPast && (
            <ul className="mt-2 space-y-2">
              {past.map((e) => (
                <li key={e.id} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-500">
                    {fmtExamDate(e.examDate)} {e.course} {e.title}
                  </span>
                  <button
                    onClick={async () => {
                      if (!window.confirm('このテストを削除しますか?')) return
                      try {
                        await repo.deleteExam(e.id)
                        onChange(exams.filter((x) => x.id !== e.id))
                      } catch {
                        onFlash('削除に失敗しました')
                      }
                    }}
                    className="text-gray-300 hover:text-red-500"
                    aria-label="削除"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  )
}

function ExamCard(props: { exam: Exam; today: string; onOpen: () => void }) {
  const { exam, today, onOpen } = props
  const s = buildExamSchedule(exam, today)
  const pct = exam.totalMinutes > 0 ? Math.min(100, Math.round((s.doneMinutes / exam.totalMinutes) * 100)) : 0
  const started = exam.startDate <= today
  return (
    <li>
      <button onClick={onOpen} className="w-full rounded-lg border border-gray-200 bg-white p-3 text-left">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate font-medium text-gray-900">
            {exam.course ? `${exam.course} ` : ''}
            {exam.title}
          </span>
          <span className="shrink-0 text-sm font-semibold text-primary">{examCountdown(exam, today)}</span>
        </div>
        <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-gray-500">
          <span>
            {fmtExamDate(exam.examDate)}
            {exam.tentative && <span className="ml-1 rounded bg-amber-50 px-1 text-amber-700">仮</span>}
          </span>
          <span>{WEIGHT_DEFAULTS[exam.weight].label}</span>
          <span>{started ? `勉強中` : `${fmtExamDate(exam.startDate)}から勉強`}</span>
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-[11px] text-gray-400">
          やった {fmtMinutes(s.doneMinutes)} / 合計 {fmtMinutes(exam.totalMinutes)}
        </p>
      </button>
    </li>
  )
}

function ExamEditor(props: {
  exam: Exam | null
  courseSuggestions: string[]
  onFlash: (text: string) => void
  onClose: () => void
  onSaved: (exam: Exam) => void
  onDeleted: (id: string) => void
}) {
  const { exam, courseSuggestions, onFlash, onClose, onSaved, onDeleted } = props
  const today = dayKey(new Date())
  const isNew = exam === null
  const [draft, setDraft] = useState<Omit<Exam, 'id'>>(() => {
    if (exam) {
      const { id: _id, ...rest } = exam
      return { ...rest, overrides: { ...rest.overrides }, doneLog: { ...rest.doneLog }, todos: rest.todos.map((t) => ({ ...t })) }
    }
    return newExamDraft(addDays(today, 30), 'normal')
  })
  // 重みを自分で選んだか(選んでいなければ、講義を選んだときにシラバスの試験%から決める)
  const [weightTouched, setWeightTouched] = useState(!isNew)
  const [selected, setSelected] = useState<string | null>(null)
  const [todoText, setTodoText] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (patch: Partial<Omit<Exam, 'id'>>) => setDraft((d) => ({ ...d, ...patch }))

  const applyWeight = (w: ExamWeight, examDate = draft.examDate) =>
    set({ weight: w, startDate: defaultStartDate(examDate, w), totalMinutes: WEIGHT_DEFAULTS[w].minutes })

  const onCourseChange = async (course: string) => {
    set({ course })
    if (weightTouched || !courseSuggestions.includes(course)) return
    try {
      const info = await repo.fetchCourseInfo(course)
      applyWeight(weightFromExamPct(info?.examPct))
    } catch {
      // 取れなければ今の重みのまま
    }
  }

  const onExamDateChange = (examDate: string) => {
    if (!examDate) return
    // 始める日を自分で変えていなければ、目安どおりに動かす
    const wasDefault = draft.startDate === defaultStartDate(draft.examDate, draft.weight)
    set({ examDate, ...(wasDefault ? { startDate: defaultStartDate(examDate, draft.weight) } : {}) })
  }

  const onPatternChange = (pattern: ExamPattern) => {
    if (pattern === draft.pattern) return
    const kept = Object.keys(draft.overrides).filter((d) => d >= today).length
    if (kept > 0 && !window.confirm(`自分で直した日が${kept}日あります。残しますか?\n(OK=残す / キャンセル=消して作り直す)`)) {
      const overrides = Object.fromEntries(Object.entries(draft.overrides).filter(([d]) => d < today))
      set({ pattern, overrides })
      return
    }
    set({ pattern })
  }

  const schedule = useMemo(() => buildExamSchedule({ ...draft, id: '' }, today), [draft, today])
  const maxMin = Math.max(30, ...schedule.days.map((d) => d.minutes))
  const sel = schedule.days.find((d) => d.date === selected)
  const valid = draft.title.trim() !== '' && draft.startDate < draft.examDate

  const setDay = (date: string, minutes: number | null) => {
    const overrides = { ...draft.overrides }
    if (minutes === null) delete overrides[date]
    else overrides[date] = minutes
    set({ overrides })
  }

  const save = async () => {
    if (!valid) {
      onFlash('始める日はテストの日より前にしてください')
      return
    }
    // 勉強期間の外になった「直した日」は消しておく
    const range = new Set(studyDays(draft))
    const clean = {
      ...draft,
      title: draft.title.trim(),
      course: draft.course?.trim() || undefined,
      overrides: Object.fromEntries(Object.entries(draft.overrides).filter(([d]) => range.has(d))),
    }
    setBusy(true)
    try {
      const saved = isNew ? await repo.insertExam(clean) : (await repo.updateExam({ ...clean, id: exam.id }), { ...clean, id: exam.id })
      onSaved(saved)
      onFlash('保存しました')
      onClose()
    } catch {
      onFlash('保存に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!exam || !window.confirm('このテストを削除しますか?(やった記録も消えます)')) return
    try {
      await repo.deleteExam(exam.id)
      onDeleted(exam.id)
      onClose()
    } catch {
      onFlash('削除に失敗しました')
    }
  }

  const label = 'text-sm font-medium text-gray-700'
  const input = 'mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm'
  const chip = (on: boolean) =>
    `rounded-lg border px-2 py-1.5 text-xs ${on ? 'border-primary bg-primary-soft font-semibold text-primary-dark' : 'border-gray-200 text-gray-600'}`

  return (
    <main className="px-4 py-4 pb-24">
      <button onClick={onClose} className="text-sm text-primary">
        ← 戻る
      </button>
      <h2 className="mt-3 text-base font-semibold text-gray-800">{isNew ? 'テストを追加' : 'テストの計画'}</h2>

      <div className="mt-3 space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <label className="block">
          <span className={label}>講義</span>
          <input
            list="exam-courses"
            value={draft.course ?? ''}
            onChange={(e) => void onCourseChange(e.target.value)}
            placeholder="時間割の講義から選ぶ"
            className={input}
          />
          <datalist id="exam-courses">
            {courseSuggestions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>

        <label className="block">
          <span className={label}>テストの名前</span>
          <input value={draft.title} onChange={(e) => set({ title: e.target.value })} className={input} />
          <span className="mt-1 flex gap-1.5">
            {['期末試験', '中間試験'].map((t) => (
              <button key={t} type="button" onClick={() => set({ title: t })} className={chip(draft.title === t)}>
                {t}
              </button>
            ))}
          </span>
        </label>

        <div>
          <label className="block">
            <span className={label}>テストの日</span>
            <input type="date" value={draft.examDate} onChange={(e) => onExamDateChange(e.target.value)} className={input} />
          </label>
          <label className="mt-1.5 flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={draft.tentative}
              onChange={(e) => set({ tentative: e.target.checked, tentativeAsked: false })}
              className="h-4 w-4 accent-primary"
            />
            日付はまだ決まっていない(だいたいの日で入れておく)
          </label>
        </div>

        <div>
          <span className={label}>重み</span>
          <div className="mt-1 grid grid-cols-3 gap-1.5">
            {WEIGHTS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => {
                  setWeightTouched(true)
                  applyWeight(w)
                }}
                className={chip(draft.weight === w)}
              >
                <span className="block text-sm">{WEIGHT_DEFAULTS[w].label}</span>
                <span className="block text-[10px] font-normal">
                  {WEIGHT_DEFAULTS[w].leadLabel}・{fmtMinutes(WEIGHT_DEFAULTS[w].minutes)}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-gray-400">選ぶと下の2つに目安が入ります。どちらも自分で変えられます</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className={label}>始める日</span>
            <input
              type="date"
              value={draft.startDate}
              max={addDays(draft.examDate, -1)}
              onChange={(e) => e.target.value && set({ startDate: e.target.value })}
              className={input}
            />
          </label>
          <label className="block">
            <span className={label}>合計(時間)</span>
            <input
              type="number"
              min={0}
              step={0.5}
              value={draft.totalMinutes / 60}
              onChange={(e) => set({ totalMinutes: Math.max(0, Math.round(Number(e.target.value) * 60)) })}
              className={input}
            />
          </label>
        </div>
      </div>

      {/* 割り振り */}
      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-800">毎日の割り振り</h3>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {PATTERNS.map((p) => (
            <button key={p} type="button" onClick={() => onPatternChange(p)} className={chip(draft.pattern === p)}>
              {PATTERN_LABELS[p]}
            </button>
          ))}
        </div>

        {schedule.days.length === 0 ? (
          <p className="mt-3 text-xs text-red-600">始める日をテストの日より前にしてください</p>
        ) : (
          <>
            <div className="mt-3 overflow-x-auto">
              <div className="flex h-28 items-end gap-[2px]" style={{ minWidth: schedule.days.length * 8 }}>
                {schedule.days.map((d) => {
                  const h = Math.max(2, Math.round((d.minutes / maxMin) * 96))
                  const color =
                    d.kind === 'done'
                      ? 'bg-primary'
                      : d.kind === 'missed'
                        ? 'bg-gray-200'
                        : d.kind === 'today'
                          ? 'bg-amber-400'
                          : 'bg-primary/35'
                  const editable = d.kind === 'today' || d.kind === 'planned'
                  return (
                    <button
                      key={d.date}
                      type="button"
                      disabled={!editable}
                      onClick={() => setSelected(d.date === selected ? null : d.date)}
                      aria-label={`${fmtExamDate(d.date)} ${d.minutes}分`}
                      className={`flex h-full min-w-[6px] flex-1 items-end ${selected === d.date ? 'rounded-sm ring-2 ring-primary ring-offset-1' : ''}`}
                    >
                      <span
                        className={`block w-full rounded-t-sm ${color} ${d.overridden && editable ? 'outline outline-1 outline-primary-dark' : ''}`}
                        style={{ height: d.minutes === 0 && editable ? 2 : h }}
                      />
                    </button>
                  )
                })}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-gray-400">
                <span>{fmtExamDate(schedule.days[0].date)}</span>
                <span>テスト {fmtExamDate(draft.examDate)}</span>
              </div>
            </div>
            <p className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-gray-500">
              <span>
                <span className="mr-0.5 inline-block h-2 w-2 bg-primary" />
                やった
              </span>
              <span>
                <span className="mr-0.5 inline-block h-2 w-2 bg-amber-400" />
                今日
              </span>
              <span>
                <span className="mr-0.5 inline-block h-2 w-2 bg-primary/35" />
                予定
              </span>
              <span>棒をタップするとその日を直せます</span>
            </p>

            {sel && (
              <div className="mt-2 rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-700">
                  {fmtExamDate(sel.date)} の勉強時間: <b>{sel.minutes === 0 ? '休み' : fmtMinutes(sel.minutes)}</b>
                  {sel.overridden ? '(自分で直した日)' : '(自動)'}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {DAY_CHOICES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDay(sel.date, m)}
                      className={chip(sel.overridden && draft.overrides[sel.date] === m)}
                    >
                      {m === 0 ? '休み' : fmtMinutes(m)}
                    </button>
                  ))}
                  {sel.overridden && (
                    <button type="button" onClick={() => setDay(sel.date, null)} className="px-2 text-xs text-primary underline">
                      自動に戻す
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-[10px] text-gray-400">合計は変わりません。差の分は、直していないほかの日に配り直します</p>
              </div>
            )}

            <p className="mt-2 text-xs text-gray-600">
              やった {fmtMinutes(schedule.doneMinutes)} / 合計 {fmtMinutes(draft.totalMinutes)}
            </p>
            {schedule.shortfall > 0 && (
              <p className="mt-1 text-xs text-red-600">
                自分で直した日だけでは {fmtMinutes(schedule.shortfall)} 足りません。どこかの日を「自動に戻す」か、合計を減らしてください
              </p>
            )}
          </>
        )}
      </div>

      {/* やることリスト */}
      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-800">やることリスト</h3>
        <p className="mt-0.5 text-[11px] text-gray-400">上から順に「今日やること」に1つずつ添えます</p>
        <ul className="mt-2 space-y-1.5">
          {draft.todos.map((t) => (
            <li key={t.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={t.done}
                onChange={() => set({ todos: draft.todos.map((x) => (x.id === t.id ? { ...x, done: !t.done } : x)) })}
                className="h-4 w-4 accent-primary"
              />
              <span className={`min-w-0 flex-1 text-sm ${t.done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{t.text}</span>
              <button
                type="button"
                onClick={() => set({ todos: draft.todos.filter((x) => x.id !== t.id) })}
                className="text-gray-300 hover:text-red-500"
                aria-label="削除"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const text = todoText.trim()
            if (!text) return
            set({ todos: [...draft.todos, { id: crypto.randomUUID(), text, done: false }] })
            setTodoText('')
          }}
        >
          <input
            value={todoText}
            onChange={(e) => setTodoText(e.target.value)}
            placeholder="例: 過去問2年分"
            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
          />
          <button type="submit" className="rounded-lg border border-primary px-3 text-sm text-primary">
            追加
          </button>
        </form>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={save}
          disabled={busy || !valid}
          className="flex-1 rounded-lg bg-primary py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? '保存中…' : '保存'}
        </button>
        {!isNew && (
          <button onClick={remove} className="rounded-lg border border-gray-200 px-3 text-gray-400 hover:text-red-500" aria-label="削除">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </main>
  )
}
