// 学期(年度 + 学期)のユーティリティ。
// 日本の学年度は4月始まりなので、1〜3月は前の年度として扱う。
// 学期の文字列は "2026 2学期" の形式で timetable_slots.semester に保存する。
// 学期の呼び方は大学によって違うため、選択肢は synonym を併記する。

/** 学期の選択肢(内部キーと表示ラベル)。前期/後期/クォーター/通年に対応 */
export const SEMESTER_TERMS = [
  { key: '1学期', label: '1学期 / 前期 / 春学期' },
  { key: '2学期', label: '2学期 / 後期 / 秋学期' },
  { key: '3学期', label: '3学期' },
  { key: '4学期', label: '4学期' },
  { key: '通年', label: '通年' },
] as const

/** その日が属する学年度(4月始まり)。例: 2027-02 → 2026 */
export function academicYear(d: Date = new Date()): number {
  return d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1
}

/** その日が1学期(4〜9月)か2学期(10〜3月)か */
export function currentTerm(d: Date = new Date()): '1学期' | '2学期' {
  const m = d.getMonth() + 1
  return m >= 4 && m <= 9 ? '1学期' : '2学期'
}

/** 今日時点の既定の学期。例: 2026-07 → "2026 1学期" */
export function defaultSemester(d: Date = new Date()): string {
  return `${academicYear(d)} ${currentTerm(d)}`
}

/** "2026 2学期" → { year: 2026, term: "2学期" } */
export function parseSemester(s: string): { year: number; term: string } {
  const idx = s.indexOf(' ')
  if (idx === -1) return { year: academicYear(), term: s }
  return { year: parseInt(s.slice(0, idx)) || academicYear(), term: s.slice(idx + 1) }
}

/** 年度ドロップダウンの選択肢。現在の年度の前後を並べ、選択中の年も必ず含める */
export function yearOptions(includeYear?: number, d: Date = new Date()): number[] {
  const y = academicYear(d)
  const set = new Set<number>()
  for (let yy = y - 2; yy <= y + 1; yy++) set.add(yy)
  if (includeYear) set.add(includeYear)
  return [...set].sort((a, b) => b - a)
}
