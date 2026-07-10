import { Fragment, useEffect, useMemo, useState } from 'react'
import type { Settings, Task, TimetableDays, TimetableSlot } from './types'
import * as repo from './repo'
import { fetchCourses } from './materials'
import { SEMESTER_TERMS, defaultSemester, parseSemester, yearOptions } from './semester'
import { colorClass } from './courseColors'
import { PERIOD_TIMES } from './periods'
import { DAY_LABEL, ON_DEMAND_DAY, visibleDayDefs } from './timetableDays'
import CourseDetail from './CourseDetail'

const PERIODS = [1, 2, 3, 4, 5, 6]

const DISPLAY_DAYS_LABEL: Record<TimetableDays, string> = {
  weekday: '平日のみ',
  sat: '平日+土',
  satsun: '平日+土日',
}

// ローマ数字(Ⅰ〜Ⅹ)・全角英数字を正規化してから検索する。
// 「電気回路Ⅰ」のような講義名は「電気回路1」と入力しても文字コードが違うためヒットしない問題への対応
const ROMAN_TO_DIGIT: Record<string, string> = {
  Ⅰ: '1', Ⅱ: '2', Ⅲ: '3', Ⅳ: '4', Ⅴ: '5', Ⅵ: '6', Ⅶ: '7', Ⅷ: '8', Ⅸ: '9', Ⅹ: '10',
  ⅰ: '1', ⅱ: '2', ⅲ: '3', ⅳ: '4', ⅴ: '5', ⅵ: '6', ⅶ: '7', ⅷ: '8', ⅸ: '9', ⅹ: '10',
}
function normalizeForSearch(s: string): string {
  let out = ''
  for (const ch of s) out += ROMAN_TO_DIGIT[ch] ?? ch
  return out
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase()
}

/** 年度・学期を切り替えるボトムシート */
function SemesterModal(props: {
  current: string
  onClose: () => void
  onApply: (semester: string) => void
}) {
  const parsed = parseSemester(props.current)
  const [year, setYear] = useState(parsed.year)
  const [term, setTerm] = useState(parsed.term)
  const years = yearOptions(parsed.year)
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
      onClick={props.onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <button onClick={props.onClose} className="text-2xl leading-none text-gray-400">
            ×
          </button>
          <h3 className="text-base font-bold text-gray-800">年度・学期切替</h3>
          <span className="w-6" />
        </div>
        <p className="mt-4 text-sm text-gray-500">
          年度や学期が変わったときは、こちらから表示を切り替えましょう💡
        </p>
        <p className="mt-1 text-xs text-gray-400">※過去に作成した時間割も引き続きご利用できます</p>

        <label className="mt-5 block text-sm font-bold text-gray-700">年度</label>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-base"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <p className="mt-5 text-sm font-bold text-gray-700">学期</p>
        <div className="mt-2 space-y-1">
          {SEMESTER_TERMS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTerm(t.key)}
              className="flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left"
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                  term === t.key ? 'border-blue-500' : 'border-gray-300'
                }`}
              >
                {term === t.key && <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />}
              </span>
              <span className="text-sm text-gray-800">{t.label}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-400">
          ※クォーター制の方は、1学期〜4学期の中から該当する学期を選択しましょう
          <br />
          (例: 第1クォーター → 1学期)
        </p>

        <button
          onClick={() => props.onApply(`${year} ${term}`)}
          className="mt-5 w-full rounded-xl bg-blue-500 py-3 text-base font-bold text-white"
        >
          変更する
        </button>
      </div>
    </div>
  )
}

/** 時間割タブ: 曜日×時限グリッド。コマをタップすると講義詳細へ。
 *  時間割データ(slots)は「今日」タブとも共有するため親(Home)が持つ */
export default function TimetableTab(props: {
  tasks: Task[]
  slots: TimetableSlot[]
  onSlotsChange: (slots: TimetableSlot[]) => void
  onToggle: (id: string) => void
  onFlash: (text: string) => void
  settings: Settings
  onSaveSettings: (s: Settings) => void
  initialCourse?: string | null
}) {
  const { tasks, slots, onSlotsChange, onToggle, onFlash, settings, onSaveSettings, initialCourse } = props
  const timetableDays = settings.timetableDays ?? 'sat'
  const semester = settings.currentSemester ?? defaultSemester()
  const { year, term } = parseSemester(semester)
  const dayDefs = visibleDayDefs(timetableDays)
  // 今日の曜日(day値)。日曜は7、月〜土は0〜5
  const todayDayValue = (() => {
    const j = new Date().getDay()
    return j === 0 ? 7 : j - 1
  })()
  const [editMode, setEditMode] = useState(false)
  const [showSemesterModal, setShowSemesterModal] = useState(false)
  const [adding, setAdding] = useState<{ day: number; period: number } | null>(null)
  const [course, setCourse] = useState('')
  const [room, setRoom] = useState('')
  const [selectedCourse, setSelectedCourse] = useState<string | null>(initialCourse ?? null)
  // 講義ごとの色(course_info.color)。{ 講義名: 色キー }
  const [courseColors, setCourseColors] = useState<Record<string, string>>({})

  useEffect(() => {
    repo.fetchCourseColors().then(setCourseColors).catch(() => {})
  }, [])
  // Moodleに履修登録してある講義名(課題の有無に関わらず全部)を、終了済み/非表示かどうかで分けて持つ。
  // 大学Moodleの enddate/visible が実態とズレている場合があるため、除外した講義も
  // 「終了済み・非表示の講義も表示」から後で選べるようにする(でないと原因が分からず詰む)
  const [activeEnrolled, setActiveEnrolled] = useState<string[]>([])
  const [excludedEnrolled, setExcludedEnrolled] = useState<string[]>([])
  const [showExcluded, setShowExcluded] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const courses = await fetchCourses()
        const now = Date.now()
        const active: string[] = []
        const excluded: string[] = []
        for (const c of courses) {
          // enddate は Unix秒。0/未設定なら終了日なし。visible=0 は非表示コース。
          const ended = Boolean(c.enddate) && c.enddate! * 1000 < now
          const hidden = (c.visible ?? 1) === 0
          ;(ended || hidden ? excluded : active).push(c.name)
        }
        if (!cancelled) {
          setActiveEnrolled(active)
          setExcludedEnrolled(excluded)
        }
      } catch {
        // 未連携・通信失敗時は候補なしのまま(課題・時間割由来の候補は従来どおり出る)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 講義名の候補: Moodle履修中の講義(終了済み等は除く) + 課題から取れた講義名 + 既存の時間割
  const knownCourses = useMemo(() => {
    const s = new Set<string>()
    for (const name of activeEnrolled) s.add(name)
    for (const t of tasks) if (t.course) s.add(t.course)
    for (const slot of slots) s.add(slot.course)
    return [...s].sort((a, b) => a.localeCompare(b, 'ja'))
  }, [activeEnrolled, tasks, slots])

  // 上の除外ロジックに引っかかった講義(トグルで表示するまでは隠す)
  const hiddenCourses = useMemo(
    () => excludedEnrolled.filter((c) => !knownCourses.includes(c)).sort((a, b) => a.localeCompare(b, 'ja')),
    [excludedEnrolled, knownCourses],
  )

  const slotAt = (day: number, period: number) =>
    slots.find((s) => s.day === day && s.period === period && s.semester === semester)

  const onDemandSlots = useMemo(
    () =>
      slots
        .filter((s) => s.day === ON_DEMAND_DAY && s.semester === semester)
        .sort((a, b) => a.period - b.period),
    [slots, semester],
  )

  // 未提出課題がある講義に赤ドットを出す
  const pendingCourses = useMemo(
    () => new Set(tasks.filter((t) => !t.done && t.course).map((t) => t.course!)),
    [tasks],
  )

  const handleCellTap = (day: number, period: number) => {
    const slot = slotAt(day, period)
    if (editMode) {
      if (slot && window.confirm(`「${slot.course}」を時間割から外しますか?`)) {
        onSlotsChange(slots.filter((s) => s.id !== slot.id))
        repo.deleteTimetableSlot(slot.id).catch(() => onFlash('削除に失敗しました'))
      }
      return
    }
    if (slot) {
      setSelectedCourse(slot.course)
    } else {
      setAdding({ day, period })
      setCourse('')
      setRoom('')
    }
  }

  const handleOnDemandTap = (slot: TimetableSlot) => {
    if (editMode) {
      if (window.confirm(`「${slot.course}」をオンデマンドから外しますか?`)) {
        onSlotsChange(slots.filter((s) => s.id !== slot.id))
        repo.deleteTimetableSlot(slot.id).catch(() => onFlash('削除に失敗しました'))
      }
      return
    }
    setSelectedCourse(slot.course)
  }

  const startAddOnDemand = () => {
    const nextPeriod = onDemandSlots.length
      ? Math.max(...onDemandSlots.map((s) => s.period)) + 1
      : 1
    setAdding({ day: ON_DEMAND_DAY, period: nextPeriod })
    setCourse('')
    setRoom('')
  }

  const addSlot = async () => {
    if (!adding || !course.trim()) return
    try {
      const created = await repo.addTimetableSlot(
        adding.day,
        adding.period,
        course.trim(),
        semester,
        room.trim() || undefined,
      )
      onSlotsChange([
        ...slots.filter(
          (s) => !(s.day === created.day && s.period === created.period && s.semester === created.semester),
        ),
        created,
      ])
      setAdding(null)
    } catch {
      onFlash('登録に失敗しました')
    }
  }

  if (selectedCourse) {
    return (
      <CourseDetail
        course={selectedCourse}
        tasks={tasks}
        onToggle={onToggle}
        onBack={() => setSelectedCourse(null)}
        onFlash={onFlash}
        color={courseColors[selectedCourse]}
        onColorChange={(c) =>
          setCourseColors((m) => ({ ...m, [selectedCourse]: c }))
        }
      />
    )
  }

  return (
    <main className="px-3 py-4">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-lg font-bold text-gray-800">
          {year}年 {term}
        </h2>
        <button
          onClick={() => setShowSemesterModal(true)}
          className="rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600"
        >
          学期切替
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between px-1">
        <select
          value={timetableDays}
          onChange={(e) =>
            onSaveSettings({ ...settings, timetableDays: e.target.value as TimetableDays })
          }
          className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600"
        >
          {(['weekday', 'sat', 'satsun'] as TimetableDays[]).map((m) => (
            <option key={m} value={m}>
              {DISPLAY_DAYS_LABEL[m]}
            </option>
          ))}
        </select>
        <button
          onClick={() => setEditMode(!editMode)}
          className={`rounded-lg px-3 py-1 text-xs ${
            editMode ? 'bg-red-50 font-bold text-red-600' : 'text-indigo-600 underline'
          }`}
        >
          {editMode ? '編集を終了' : 'コマを削除'}
        </button>
      </div>
      {editMode && (
        <p className="mt-1 px-1 text-xs text-red-500">削除したいコマをタップしてください</p>
      )}

      {showSemesterModal && (
        <SemesterModal
          current={semester}
          onClose={() => setShowSemesterModal(false)}
          onApply={(s) => {
            onSaveSettings({ ...settings, currentSemester: s })
            setShowSemesterModal(false)
          }}
        />
      )}

      {(
        <div
          className="mt-3 grid gap-1"
          style={{ gridTemplateColumns: `1.2rem repeat(${dayDefs.length}, 1fr)` }}
        >
          <div />
          {dayDefs.map((d) => {
            const isToday = d.day === todayDayValue
            const dayColor = d.day === 5 ? 'text-blue-400' : d.day === 7 ? 'text-red-400' : 'text-gray-500'
            return (
              <div key={d.day} className="flex items-center justify-center">
                {isToday ? (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-500 text-xs font-bold text-white">
                    {d.label}
                  </span>
                ) : (
                  <span className={`text-xs font-medium ${dayColor}`}>{d.label}</span>
                )}
              </div>
            )
          })}
          {PERIODS.map((p) => (
            <Fragment key={`row-${p}`}>
              <div className="flex flex-col items-center justify-center py-1 text-center">
                <span className="text-xs font-bold text-gray-600">{p}</span>
                {PERIOD_TIMES[p] && (
                  <span className="mt-0.5 text-[7px] leading-tight text-gray-400">
                    {PERIOD_TIMES[p][0]}
                    <br />|<br />
                    {PERIOD_TIMES[p][1]}
                  </span>
                )}
              </div>
              {dayDefs.map(({ day }) => {
                const slot = slotAt(day, p)
                const isSelected = adding?.day === day && adding?.period === p
                const c = slot ? colorClass(courseColors[slot.course]) : null
                return (
                  <button
                    key={`${day}-${p}`}
                    onClick={() => handleCellTap(day, p)}
                    className={`relative flex min-h-16 flex-col rounded-lg p-1 text-left transition ${
                      isSelected
                        ? 'bg-indigo-100 ring-2 ring-indigo-500'
                        : slot
                          ? editMode
                            ? 'border border-red-200 bg-red-50'
                            : c!.cell
                          : 'border border-dashed border-gray-200 bg-white'
                    }`}
                  >
                    {slot ? (
                      <>
                        {pendingCourses.has(slot.course) && (
                          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500" />
                        )}
                        <span className={`block flex-1 break-all text-[10px] font-medium leading-tight ${c!.text}`}>
                          {slot.course.length > 16 ? slot.course.slice(0, 16) + '…' : slot.course}
                        </span>
                        <span
                          className={`mt-0.5 self-start rounded bg-white/70 px-1 py-px text-[8px] ${
                            slot.room ? 'text-gray-600' : 'text-gray-400'
                          }`}
                        >
                          {slot.room || '未登録'}
                        </span>
                      </>
                    ) : isSelected ? (
                      <span className="flex h-full items-center justify-center text-[10px] font-bold text-indigo-600">
                        選択中
                      </span>
                    ) : (
                      <span className="flex h-full items-center justify-center text-gray-200">+</span>
                    )}
                  </button>
                )
              })}
            </Fragment>
          ))}
        </div>
      )}

      <div className="mt-4 px-1">
        <h3 className="text-xs font-bold text-gray-500">🖥️ オンデマンド</h3>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {onDemandSlots.map((slot) => {
            const c = colorClass(courseColors[slot.course])
            return (
              <button
                key={slot.id}
                onClick={() => handleOnDemandTap(slot)}
                className={`relative rounded-lg px-2.5 py-1.5 text-left text-xs ${
                  editMode ? 'border border-red-200 bg-red-50 text-red-700' : `${c.cell} ${c.text}`
                }`}
              >
                {pendingCourses.has(slot.course) && (
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500" />
                )}
                {slot.course}
                {slot.room && <span className="ml-1 text-[10px] opacity-70">({slot.room})</span>}
              </button>
            )
          })}
          <button
            onClick={startAddOnDemand}
            className="rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-400"
          >
            + 追加
          </button>
        </div>
      </div>

      <p className="mt-2 px-1 text-[11px] text-gray-400">
        右上の「学期切替」で年度・学期ごとの時間割を切り替えられます(今の学期は自動で選ばれます)。
        空きコマの「+」で講義を登録、オンデマンドは下の欄から。講義をタップすると課題・資料・出席・
        成績見込みが見られ、色も変えられます。赤い点は未提出の課題がある講義です。
      </p>

      {adding && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
          onClick={() => setAdding(null)}
        >
          <div
            className="w-full max-w-md rounded-t-2xl bg-white p-4 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-gray-200 sm:hidden" />
            <h3 className="text-center text-sm font-bold text-gray-800">
              {adding.day === ON_DEMAND_DAY ? (
                <span className="mr-1 rounded-md bg-indigo-100 px-2 py-0.5 text-indigo-700">
                  🖥️ オンデマンド
                </span>
              ) : (
                <span className="mr-1 rounded-md bg-indigo-100 px-2 py-0.5 text-indigo-700">
                  {DAY_LABEL[adding.day]}曜 {adding.period}限
                </span>
              )}
              に授業を追加
            </h3>
            <input
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              autoFocus
              placeholder="講義名(Moodleと同じ名前推奨)"
              className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          {(() => {
            // 部分一致で候補を出す(「Web入門」→「Web入門 2026」がヒット、
            // 「電気回路1」→「電気回路Ⅰ」のようにローマ数字/全角数字の表記違いもヒット)
            const q = normalizeForSearch(course.trim())
            // 何も入力していない時は全件表示(登録講義を全部候補に出したいという要望のため)。
            // 入力して絞り込んでいる時だけ6件に抑えて見やすくする
            const matched = knownCourses.filter(
              (c) => c !== course && (!q || normalizeForSearch(c).includes(q)),
            )
            const suggestions = q ? matched.slice(0, 6) : matched
            const excludedMatches = showExcluded
              ? hiddenCourses.filter((c) => c !== course && (!q || normalizeForSearch(c).includes(q)))
              : []
            if (suggestions.length === 0 && excludedMatches.length === 0) return null
            return (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {suggestions.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCourse(c)}
                    className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs text-indigo-700"
                  >
                    {c}
                  </button>
                ))}
                {excludedMatches.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCourse(c)}
                    className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500"
                    title="Moodle上で終了済み/非表示になっている講義です"
                  >
                    {c}
                  </button>
                ))}
              </div>
            )
          })()}
          {hiddenCourses.length > 0 && (
            <button
              onClick={() => setShowExcluded(!showExcluded)}
              className="mt-1.5 text-[11px] text-gray-400 underline"
            >
              {showExcluded
                ? '終了済み・非表示の講義を隠す'
                : `終了済み・非表示の講義も表示(${hiddenCourses.length}件)`}
            </button>
          )}
          <input
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder={adding.day === ON_DEMAND_DAY ? '配信サイト等のメモ(任意)' : '教室(任意)'}
            className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-[11px] text-gray-400">
            候補から選ぶと、課題や資料が自動でこの講義に紐づきます
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setAdding(null)}
              className="flex-1 rounded-lg border border-gray-200 py-2 text-sm text-gray-500"
            >
              キャンセル
            </button>
            <button
              onClick={addSlot}
              className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-bold text-white"
            >
              追加
            </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
