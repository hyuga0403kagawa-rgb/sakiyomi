import { useEffect, useMemo, useState } from 'react'
import type { Grade } from './types'
import { GRADE_SCALE, gradeGp, gradePassed } from './types'
import * as repo from './repo'
import { SEMESTER_TERMS, defaultSemester, parseSemester, yearOptions } from './semester'

const GRADE_BADGE: Record<string, string> = {
  秀: 'bg-indigo-100 text-indigo-700',
  優: 'bg-blue-100 text-blue-700',
  良: 'bg-green-100 text-green-700',
  可: 'bg-amber-100 text-amber-700',
  不可: 'bg-red-100 text-red-600',
}

/** 手入力の成績一覧とGPA計算。マイページから開く別画面 */
export default function GradesScreen(props: {
  onBack: () => void
  onFlash: (text: string) => void
  courseSuggestions: string[]
}) {
  const { onBack, onFlash, courseSuggestions } = props
  const [grades, setGrades] = useState<Grade[]>([])
  const [adding, setAdding] = useState(false)

  const def = parseSemester(defaultSemester())
  const [year, setYear] = useState(def.year)
  const [term, setTerm] = useState<string>(def.term)
  const [course, setCourse] = useState('')
  const [grade, setGrade] = useState<string>('優')
  const [credits, setCredits] = useState(2)

  useEffect(() => {
    repo.fetchGrades().then(setGrades).catch(() => {})
  }, [])

  const summary = useMemo(() => {
    const total = grades.reduce((s, g) => s + g.credits, 0)
    const num = grades.reduce((s, g) => s + gradeGp(g.grade) * g.credits, 0)
    const earned = grades.filter((g) => gradePassed(g.grade)).reduce((s, g) => s + g.credits, 0)
    return { gpa: total > 0 ? num / total : null, total, earned }
  }, [grades])

  const byTerm = useMemo(() => {
    const m = new Map<string, Grade[]>()
    for (const g of grades) {
      const key = g.term ?? 'その他'
      m.set(key, [...(m.get(key) ?? []), g])
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0], 'ja'))
  }, [grades])

  const add = async () => {
    if (!course.trim()) {
      onFlash('講義名を入力してください')
      return
    }
    try {
      const created = await repo.addGrade({
        course: course.trim(),
        term: `${year} ${term}`,
        grade,
        credits,
      })
      setGrades((gs) => [...gs, created])
      setCourse('')
      setAdding(false)
    } catch {
      onFlash('追加に失敗しました')
    }
  }

  const remove = async (id: string) => {
    setGrades((gs) => gs.filter((g) => g.id !== id))
    try {
      await repo.deleteGrade(id)
    } catch {
      onFlash('削除に失敗しました')
    }
  }

  return (
    <main className="px-4 py-4">
      <button onClick={onBack} className="text-sm text-indigo-600 underline">
        ← マイページに戻る
      </button>
      <h2 className="mt-3 text-base font-bold text-gray-800">成績・GPA</h2>
      <p className="mt-0.5 text-[11px] text-gray-400">
        手入力で管理します(カダサポとの自動連携はできないため)。GP: 秀4・優3・良2・可1・不可0
      </p>

      {/* サマリー */}
      <div className="mt-3 flex gap-2">
        <div className="flex-1 rounded-xl bg-white p-3 text-center shadow-sm">
          <p className="text-2xl font-bold text-indigo-600">
            {summary.gpa === null ? '—' : summary.gpa.toFixed(2)}
          </p>
          <p className="text-[11px] text-gray-500">GPA</p>
        </div>
        <div className="flex-1 rounded-xl bg-white p-3 text-center shadow-sm">
          <p className="text-2xl font-bold text-gray-800">{summary.earned}</p>
          <p className="text-[11px] text-gray-500">取得単位</p>
        </div>
        <div className="flex-1 rounded-xl bg-white p-3 text-center shadow-sm">
          <p className="text-2xl font-bold text-gray-800">{summary.total}</p>
          <p className="text-[11px] text-gray-500">履修単位</p>
        </div>
      </div>

      {/* 追加 */}
      <div className="mt-3 rounded-xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-800">📝 成績を追加</h3>
          <button onClick={() => setAdding(!adding)} className="text-xs text-indigo-600 underline">
            {adding ? '閉じる' : '+ 追加'}
          </button>
        </div>
        {adding && (
          <div className="mt-3 space-y-2">
            <div className="flex gap-2">
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-600"
              >
                {yearOptions(year).map((y) => (
                  <option key={y} value={y}>
                    {y}年度
                  </option>
                ))}
              </select>
              <select
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-600"
              >
                {SEMESTER_TERMS.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.key}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              list="grade-course-suggestions"
              placeholder="講義名"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <datalist id="grade-course-suggestions">
              {courseSuggestions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <div className="flex flex-wrap items-center gap-1.5">
              {GRADE_SCALE.map((g) => (
                <button
                  key={g.key}
                  onClick={() => setGrade(g.key)}
                  className={`rounded-full px-3 py-1 text-sm ${
                    grade === g.key ? 'bg-slate-800 text-white' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {g.key}
                </button>
              ))}
              <label className="ml-auto flex items-center gap-1 text-xs text-gray-500">
                単位
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={credits}
                  onChange={(e) => setCredits(Number(e.target.value))}
                  className="w-14 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                />
              </label>
            </div>
            <button
              onClick={add}
              className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-bold text-white"
            >
              登録
            </button>
          </div>
        )}
      </div>

      {/* 一覧 */}
      {grades.length === 0 ? (
        <p className="mt-4 text-center text-sm text-gray-400">
          まだ成績はありません。「+ 追加」から登録できます
        </p>
      ) : (
        byTerm.map(([t, list]) => (
          <div key={t} className="mt-4">
            <h3 className="mb-1 text-sm font-bold text-gray-700">
              {t}
              <span className="ml-2 text-xs font-normal text-gray-400">
                {list.reduce((s, g) => s + g.credits, 0)}単位
              </span>
            </h3>
            <ul className="space-y-1.5">
              {list.map((g) => (
                <li key={g.id} className="flex items-center gap-2 rounded-lg bg-white p-2.5 shadow-sm">
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-sm font-bold ${
                      GRADE_BADGE[g.grade] ?? 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {g.grade}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{g.course}</span>
                  <span className="shrink-0 text-xs text-gray-400">{g.credits}単位</span>
                  <button
                    onClick={() => remove(g.id)}
                    className="shrink-0 text-gray-300 hover:text-red-500"
                    aria-label="削除"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </main>
  )
}
