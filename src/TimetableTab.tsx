import { Fragment, useEffect, useMemo, useState } from 'react'
import { Monitor, X } from 'lucide-react'
import type { CourseMeta, Settings, Task, TimetableDays, TimetableSlot } from './types'
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
          <button onClick={props.onClose} className="text-gray-400" aria-label="閉じる">
            <X className="h-5 w-5" />
          </button>
          <h3 className="text-base font-semibold text-gray-800">年度・学期切替</h3>
          <span className="w-6" />
        </div>
        <p className="mt-4 text-sm text-gray-500">
          年度や学期が変わったときは、こちらから表示を切り替えましょう
        </p>
        <p className="mt-1 text-xs text-gray-400">※過去に作成した時間割も引き続きご利用できます</p>

        <label className="mt-5 block text-sm font-semibold text-gray-700">年度</label>
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

        <p className="mt-5 text-sm font-semibold text-gray-700">学期</p>
        <div className="mt-2 space-y-1">
          {SEMESTER_TERMS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTerm(t.key)}
              className="flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left"
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                  term === t.key ? 'border-primary' : 'border-gray-300'
                }`}
              >
                {term === t.key && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
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
          className="mt-5 w-full rounded-lg bg-primary py-3 text-base font-semibold text-white"
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
  /** 「時間割」タブを押すたびに増える。増えたら追加画面・講義詳細を閉じてグリッドに戻す */
  resetSignal?: number
}) {
  const { tasks, slots, onSlotsChange, onToggle, onFlash, settings, onSaveSettings, initialCourse, resetSignal } = props
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
  // コマの追加・編集画面。slot があれば既存のコマの編集
  const [adding, setAdding] = useState<{ day: number; period: number; slot?: TimetableSlot } | null>(null)
  const [course, setCourse] = useState('')
  const [room, setRoom] = useState('')
  // 講義ごとの項目(course_info に保存。同じ講義の全コマで共通)
  const [shortName, setShortName] = useState('')
  const [teacher, setTeacher] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedCourse, setSelectedCourse] = useState<string | null>(initialCourse ?? null)
  // 講義ごとの色・略称・教員名(course_info)。{ 講義名: … }
  const [courseMeta, setCourseMeta] = useState<Record<string, CourseMeta>>({})
  const courseColors = useMemo(() => {
    const m: Record<string, string> = {}
    for (const [k, v] of Object.entries(courseMeta)) if (v.color) m[k] = v.color
    return m
  }, [courseMeta])
  /** 時間割に出す名前(略称があれば略称) */
  const labelOf = (c: string) => courseMeta[c]?.shortName || c

  useEffect(() => {
    repo.fetchCourseMeta().then(setCourseMeta).catch(() => {})
  }, [])

  // 「時間割」タブが押されたら追加画面・講義詳細を閉じてグリッドに戻す(初回=undefinedは無視)
  useEffect(() => {
    if (resetSignal === undefined) return
    setAdding(null)
    setSelectedCourse(null)
    setShowSemesterModal(false)
  }, [resetSignal])
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

  /** 追加・編集画面を開く。既存のコマなら今の値を入れておく */
  const openForm = (day: number, period: number, slot?: TimetableSlot) => {
    setAdding({ day, period, slot })
    setCourse(slot?.course ?? '')
    setRoom(slot?.room ?? '')
    setShortName(slot ? courseMeta[slot.course]?.shortName ?? '' : '')
    setTeacher(slot ? courseMeta[slot.course]?.teacher ?? '' : '')
  }

  /** 講義を選び直したら、その講義に保存済みの略称・教員名を入れ直す(講義ごとの項目のため) */
  const pickCourse = (c: string) => {
    setCourse(c)
    setShortName(courseMeta[c]?.shortName ?? '')
    setTeacher(courseMeta[c]?.teacher ?? '')
  }

  const handleCellTap = (day: number, period: number) => {
    const slot = slotAt(day, period)
    if (editMode) {
      if (slot) openForm(day, period, slot)
      return
    }
    if (slot) setSelectedCourse(slot.course)
    else openForm(day, period)
  }

  const handleOnDemandTap = (slot: TimetableSlot) => {
    if (editMode) {
      openForm(slot.day, slot.period, slot)
      return
    }
    setSelectedCourse(slot.course)
  }

  const startAddOnDemand = () => {
    const nextPeriod = onDemandSlots.length
      ? Math.max(...onDemandSlots.map((s) => s.period)) + 1
      : 1
    openForm(ON_DEMAND_DAY, nextPeriod)
  }

  const saveSlot = async () => {
    const name = course.trim()
    if (!adding || !name || saving) return
    setSaving(true)
    try {
      const created = await repo.addTimetableSlot(adding.day, adding.period, name, semester, room.trim() || undefined)
      onSlotsChange([
        ...slots.filter(
          (s) => !(s.day === created.day && s.period === created.period && s.semester === created.semester),
        ),
        created,
      ])
      // 略称・教員名は講義ごと。変わったときだけ、講義情報(メモ・評価割合など)を残したまま書き足す
      const prev = courseMeta[name] ?? {}
      const nextShort = shortName.trim() === name ? '' : shortName.trim()
      if ((prev.shortName ?? '') !== nextShort || (prev.teacher ?? '') !== teacher.trim()) {
        const info = (await repo.fetchCourseInfo(name)) ?? { course: name }
        await repo.upsertCourseInfo({ ...info, course: name, shortName: nextShort, teacher: teacher.trim() })
        setCourseMeta((m) => ({
          ...m,
          [name]: { ...m[name], shortName: nextShort || undefined, teacher: teacher.trim() || undefined },
        }))
      }
      setAdding(null)
      if (adding.slot) onFlash('保存しました')
    } catch {
      onFlash(adding.slot ? '保存に失敗しました' : '登録に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const removeSlot = (slot: TimetableSlot) => {
    const where = slot.day === ON_DEMAND_DAY ? 'オンデマンド' : '時間割'
    if (!window.confirm(`「${labelOf(slot.course)}」を${where}から外しますか?`)) return
    onSlotsChange(slots.filter((s) => s.id !== slot.id))
    repo.deleteTimetableSlot(slot.id).catch(() => onFlash('削除に失敗しました'))
    setAdding(null)
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
          setCourseMeta((m) => ({ ...m, [selectedCourse]: { ...m[selectedCourse], color: c } }))
        }
      />
    )
  }

  // 授業の追加は全画面(左上「時間割に戻る」/「時間割」タブ再タップで戻る)
  if (adding) {
    const q = normalizeForSearch(course.trim())
    const matched = knownCourses.filter((c) => c !== course && (!q || normalizeForSearch(c).includes(q)))
    const suggestions = q ? matched.slice(0, 6) : matched
    const excludedMatches = showExcluded
      ? hiddenCourses.filter((c) => c !== course && (!q || normalizeForSearch(c).includes(q)))
      : []
    return (
      <main className="px-4 py-4">
        <button onClick={() => setAdding(null)} className="text-sm text-primary underline">
          ← 時間割に戻る
        </button>
        <h2 className="mt-3 text-base font-semibold text-gray-800">
          {adding.day === ON_DEMAND_DAY
            ? adding.slot
              ? 'オンデマンドの授業を編集'
              : 'オンデマンドに授業を追加'
            : `${DAY_LABEL[adding.day]}曜 ${adding.period}限${adding.slot ? 'の授業を編集' : 'に授業を追加'}`}
        </h2>

        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
          <span className="text-xs font-medium text-gray-600">講義(Moodleとつなぐ名前)</span>
          <input
            value={course}
            onChange={(e) => setCourse(e.target.value)}
            placeholder="講義名(Moodleと同じ名前推奨)"
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          {(suggestions.length > 0 || excludedMatches.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestions.map((c) => (
                <button
                  key={c}
                  onClick={() => pickCourse(c)}
                  className="rounded-full bg-primary-soft px-2.5 py-1 text-xs text-primary-dark"
                >
                  {c}
                </button>
              ))}
              {excludedMatches.map((c) => (
                <button
                  key={c}
                  onClick={() => pickCourse(c)}
                  className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500"
                  title="Moodle上で終了済み/非表示になっている講義です"
                >
                  {c}
                </button>
              ))}
            </div>
          )}
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
          <p className="mt-1 text-[11px] text-gray-400">
            候補から選ぶと、課題や資料が自動でこの講義に紐づきます
          </p>

          <label className="mt-3 block">
            <span className="text-xs font-medium text-gray-600">
              {adding.day === ON_DEMAND_DAY ? 'メモ(配信サイトなど)' : '教室'}
            </span>
            <input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder={adding.day === ON_DEMAND_DAY ? '任意' : '例: 4103(任意)'}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="mt-3 block">
            <span className="text-xs font-medium text-gray-600">教員名</span>
            <input
              value={teacher}
              onChange={(e) => setTeacher(e.target.value)}
              placeholder="任意"
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="mt-3 block">
            <span className="text-xs font-medium text-gray-600">時間割に出す名前(略称)</span>
            <input
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              placeholder="空なら講義名のまま"
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </label>
          <p className="mt-1 text-[11px] text-gray-400">
            教員名と略称は講義ごとです(同じ講義のほかのコマにも出ます)。略称にしても課題・資料のつながりは変わりません
          </p>

          <button
            onClick={saveSlot}
            disabled={saving || !course.trim()}
            className="mt-4 w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? '保存中…' : adding.slot ? '保存' : '追加'}
          </button>
          {adding.slot && (
            <button
              onClick={() => removeSlot(adding.slot!)}
              className="mt-2 w-full rounded-lg border border-red-200 py-2 text-sm text-red-600"
            >
              このコマを時間割から外す
            </button>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="px-3 py-4">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-lg font-semibold text-gray-800">
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
            editMode ? 'bg-primary-soft font-semibold text-primary-dark' : 'text-primary underline'
          }`}
        >
          {editMode ? '編集を終了' : 'コマを編集'}
        </button>
      </div>
      {editMode && (
        <p className="mt-1 px-1 text-xs text-primary">編集したいコマをタップしてください(外すのも編集画面から)</p>
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
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">
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
                <span className="text-xs font-semibold text-gray-600">{p}</span>
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
                const c = slot ? colorClass(courseColors[slot.course]) : null
                return (
                  <button
                    key={`${day}-${p}`}
                    onClick={() => handleCellTap(day, p)}
                    className={`relative flex min-h-16 flex-col rounded-lg p-1 text-left transition ${
                      slot
                        ? editMode
                          ? 'border-2 border-dashed border-primary/60 bg-primary-soft'
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
                          {labelOf(slot.course).length > 16 ? labelOf(slot.course).slice(0, 16) + '…' : labelOf(slot.course)}
                        </span>
                        <span
                          className={`mt-0.5 self-start rounded bg-white/70 px-1 py-px text-[8px] ${
                            slot.room ? 'text-gray-600' : 'text-gray-400'
                          }`}
                        >
                          {slot.room || '未登録'}
                        </span>
                      </>
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
        <h3 className="flex items-center gap-1 text-xs font-semibold text-gray-500"><Monitor className="h-3.5 w-3.5" />オンデマンド</h3>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {onDemandSlots.map((slot) => {
            const c = colorClass(courseColors[slot.course])
            return (
              <button
                key={slot.id}
                onClick={() => handleOnDemandTap(slot)}
                className={`relative rounded-lg px-2.5 py-1.5 text-left text-xs ${
                  editMode ? 'border-2 border-dashed border-primary/60 bg-primary-soft text-primary-dark' : `${c.cell} ${c.text}`
                }`}
              >
                {pendingCourses.has(slot.course) && (
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500" />
                )}
                {labelOf(slot.course)}
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
        成績見込みが見られ、色も変えられます。教室・教員名・略称は「コマを編集」から。赤い点は未提出の課題がある講義です。
      </p>

    </main>
  )
}
