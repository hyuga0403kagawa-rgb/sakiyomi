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

// '不可' を '可' より先に判定できるよう並び順に注意
const GRADE_RE = /不可|秀|優|良|可/

function detectTermKey(line: string): string | null {
  if (/1\s*学期|前期|春学期/.test(line)) return '1学期'
  if (/2\s*学期|後期|秋学期/.test(line)) return '2学期'
  if (/3\s*学期/.test(line)) return '3学期'
  if (/4\s*学期/.test(line)) return '4学期'
  if (/通年/.test(line)) return '通年'
  return null
}

interface DraftGrade {
  course: string
  grade: string
  credits: number
  term: string
}

/**
 * カダサポ等の成績一覧テキストを行ごとに解析する(ヒューリスティック)。
 * 「年度・学期」の見出し行を見つけたら以降の行にその学期を割り当てる。
 * 成績段階(秀優良可不可)を含む行を成績として扱う。あくまで下書きで、UIで手直し前提。
 */
function parseGradesText(text: string, defYear: number, defTerm: string): DraftGrade[] {
  const rows: DraftGrade[] = []
  let curYear = defYear
  let curTerm = defTerm
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/　/g, ' ').trim()
    if (!line) continue
    const gm = line.match(GRADE_RE)
    const yearM = line.match(/(20\d{2})\s*年?度?/)
    const tk = detectTermKey(line)
    if (!gm) {
      if (yearM) curYear = Number(yearM[1])
      if (tk) curTerm = tk
      continue
    }
    const grade = gm[0]
    // 単位数: 「◯単位」優先、無ければ年(4桁)以外の小さな数の最後
    let credits = 2
    const cm = line.match(/(\d+(?:\.\d)?)\s*単位/)
    if (cm) {
      credits = Number(cm[1])
    } else {
      const nums = (line.match(/\d+(?:\.\d)?/g) ?? [])
        .filter((n) => !/^20\d{2}$/.test(n))
        .map(Number)
        .filter((n) => n > 0 && n <= 10)
      if (nums.length) credits = nums[nums.length - 1]
    }
    // 講義名: 成績トークンより前。末尾に「空白+数字(=単位)」があれば除く。
    // 「電気回路1」のように名前に付いた数字は空白が無いので残る。
    let course = line.slice(0, line.indexOf(grade))
    course = course.replace(/[|｜\t]+/g, ' ').trim()
    course = course.replace(/\s+\d+(?:\.\d)?\s*(単位)?$/, '').trim()
    if (!course) {
      course = line
        .replace(GRADE_RE, ' ')
        .replace(/\d+(?:\.\d)?\s*単位?/g, ' ')
        .replace(/[|｜\t]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
    }
    if (course) rows.push({ course, grade, credits, term: `${curYear} ${curTerm}` })
  }
  return rows
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

  // まとめて貼り付け取り込み
  const [showPaste, setShowPaste] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [drafts, setDrafts] = useState<DraftGrade[]>([])

  useEffect(() => {
    repo.fetchGrades().then(setGrades).catch(() => {})
  }, [])

  const runParse = () => {
    const rows = parseGradesText(pasteText, year, term)
    if (rows.length === 0) {
      onFlash('成績を読み取れませんでした。手入力で追加してください')
      return
    }
    setDrafts(rows)
  }

  const updateDraft = (i: number, patch: Partial<DraftGrade>) => {
    setDrafts((ds) => ds.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))
  }
  const removeDraft = (i: number) => setDrafts((ds) => ds.filter((_, idx) => idx !== i))

  const saveDrafts = async () => {
    try {
      const created: Grade[] = []
      for (const d of drafts) {
        if (!d.course.trim()) continue
        created.push(await repo.addGrade({ course: d.course.trim(), term: d.term, grade: d.grade, credits: d.credits }))
      }
      setGrades((gs) => [...gs, ...created])
      setDrafts([])
      setPasteText('')
      setShowPaste(false)
      onFlash(`${created.length}件の成績を登録しました`)
    } catch {
      onFlash('登録に失敗しました')
    }
  }

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

      {/* まとめて貼り付け取り込み */}
      <div className="mt-3 rounded-xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-800">📋 カダサポからまとめて取り込み</h3>
          <button
            onClick={() => setShowPaste(!showPaste)}
            className="text-xs text-indigo-600 underline"
          >
            {showPaste ? '閉じる' : '開く'}
          </button>
        </div>
        {showPaste && (
          <div className="mt-3 space-y-2">
            <p className="text-[11px] text-gray-400">
              カダサポの成績一覧の文字をコピーして貼り付け、「解析する」を押してください。
              読み取った内容は下で手直ししてから登録できます(パスワードは不要です)。
            </p>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={4}
              placeholder={'例:\n2025年度 前期\n微分積分学  優  2単位\n電気回路Ⅰ  良  2単位'}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
            />
            <button
              onClick={runParse}
              className="w-full rounded-lg border border-indigo-600 py-2 text-sm font-medium text-indigo-600"
            >
              ✨ 解析する
            </button>

            {drafts.length > 0 && (
              <div className="mt-2 space-y-2">
                <p className="text-xs font-bold text-gray-700">
                  読み取り結果({drafts.length}件) — 間違いは直してください
                </p>
                {drafts.map((d, i) => (
                  <div key={i} className="rounded-lg border border-gray-100 p-2">
                    <div className="flex items-center gap-1.5">
                      <input
                        value={d.course}
                        onChange={(e) => updateDraft(i, { course: e.target.value })}
                        className="min-w-0 flex-1 rounded border border-gray-200 px-2 py-1 text-sm"
                      />
                      <button
                        onClick={() => removeDraft(i)}
                        className="shrink-0 text-gray-300 hover:text-red-500"
                        aria-label="この行を除く"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <select
                        value={d.grade}
                        onChange={(e) => updateDraft(i, { grade: e.target.value })}
                        className="rounded border border-gray-200 px-1.5 py-1 text-sm text-gray-600"
                      >
                        {GRADE_SCALE.map((g) => (
                          <option key={g.key} value={g.key}>
                            {g.key}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1 text-xs text-gray-500">
                        単位
                        <input
                          type="number"
                          min={0}
                          max={10}
                          value={d.credits}
                          onChange={(e) => updateDraft(i, { credits: Number(e.target.value) })}
                          className="w-12 rounded border border-gray-200 px-1.5 py-1 text-sm"
                        />
                      </label>
                      <span className="ml-auto text-[11px] text-gray-400">{d.term}</span>
                    </div>
                  </div>
                ))}
                <button
                  onClick={saveDrafts}
                  className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-bold text-white"
                >
                  この内容で登録({drafts.length}件)
                </button>
              </div>
            )}
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
