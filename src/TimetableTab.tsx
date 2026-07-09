import { Fragment, useMemo, useState } from 'react'
import type { Task, TimetableSlot } from './types'
import * as repo from './repo'
import CourseDetail from './CourseDetail'

const DAYS = ['月', '火', '水', '木', '金', '土']
const PERIODS = [1, 2, 3, 4, 5, 6]

/** 時間割タブ: 曜日×時限グリッド。コマをタップすると講義詳細へ。
 *  時間割データ(slots)は「今日」タブとも共有するため親(Home)が持つ */
export default function TimetableTab(props: {
  tasks: Task[]
  slots: TimetableSlot[]
  onSlotsChange: (slots: TimetableSlot[]) => void
  onToggle: (id: string) => void
  onFlash: (text: string) => void
  initialCourse?: string | null
}) {
  const { tasks, slots, onSlotsChange, onToggle, onFlash, initialCourse } = props
  const [editMode, setEditMode] = useState(false)
  const [adding, setAdding] = useState<{ day: number; period: number } | null>(null)
  const [course, setCourse] = useState('')
  const [room, setRoom] = useState('')
  const [selectedCourse, setSelectedCourse] = useState<string | null>(initialCourse ?? null)

  // 講義名の候補: Moodleの課題から取れた講義名 + 既存の時間割
  const knownCourses = useMemo(() => {
    const s = new Set<string>()
    for (const t of tasks) if (t.course) s.add(t.course)
    for (const slot of slots) s.add(slot.course)
    return [...s].sort((a, b) => a.localeCompare(b, 'ja'))
  }, [tasks, slots])

  const slotAt = (day: number, period: number) =>
    slots.find((s) => s.day === day && s.period === period)

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

  const addSlot = async () => {
    if (!adding || !course.trim()) return
    try {
      const created = await repo.addTimetableSlot(adding.day, adding.period, course.trim(), room.trim() || undefined)
      onSlotsChange([
        ...slots.filter((s) => !(s.day === created.day && s.period === created.period)),
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
      />
    )
  }

  return (
    <main className="px-3 py-4">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-base font-bold text-gray-800">時間割</h2>
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

      {(
        <div className="mt-3 grid grid-cols-[1.2rem_repeat(6,1fr)] gap-1">
          <div />
          {DAYS.map((d, i) => (
            <div key={d} className={`text-center text-xs font-medium ${i === 5 ? 'text-blue-400' : 'text-gray-500'}`}>
              {d}
            </div>
          ))}
          {PERIODS.map((p) => (
            <Fragment key={`row-${p}`}>
              <div className="flex items-center justify-center text-xs text-gray-400">
                {p}
              </div>
              {DAYS.map((_, day) => {
                const slot = slotAt(day, p)
                return (
                  <button
                    key={`${day}-${p}`}
                    onClick={() => handleCellTap(day, p)}
                    className={`relative min-h-16 rounded-lg p-1 text-left align-top ${
                      slot
                        ? editMode
                          ? 'border border-red-200 bg-red-50'
                          : 'bg-indigo-50'
                        : 'border border-dashed border-gray-200 bg-white'
                    }`}
                  >
                    {slot ? (
                      <>
                        {pendingCourses.has(slot.course) && (
                          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500" />
                        )}
                        <span className="block break-all text-[10px] font-medium leading-tight text-indigo-800">
                          {slot.course.length > 14 ? slot.course.slice(0, 14) + '…' : slot.course}
                        </span>
                        {slot.room && (
                          <span className="mt-0.5 block text-[9px] text-indigo-400">{slot.room}</span>
                        )}
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

      <p className="mt-2 px-1 text-[11px] text-gray-400">
        空きコマの「+」で講義を登録。講義をタップすると課題・資料・出席・成績見込みが見られます。
        赤い点は未提出の課題がある講義です。
      </p>

      {adding && (
        <div className="mt-3 rounded-xl bg-white p-4 shadow-sm">
          <h3 className="text-sm font-bold text-gray-800">
            {DAYS[adding.day]}曜{adding.period}限に追加
          </h3>
          <input
            value={course}
            onChange={(e) => setCourse(e.target.value)}
            list="known-courses"
            placeholder="講義名(Moodleと同じ名前推奨)"
            className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <datalist id="known-courses">
            {knownCourses.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <input
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder="教室(任意)"
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
      )}
    </main>
  )
}
