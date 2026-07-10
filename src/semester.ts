// 学期(年度 + 前期/後期)のユーティリティ。
// 日本の学年度は4月始まりなので、1〜3月は前の年度として扱う。
// 学期の文字列は "2026 前期" の形式で timetable_slots.semester に保存する。

/** その日が属する学年度(4月始まり)。例: 2027-02 → 2026 */
export function academicYear(d: Date = new Date()): number {
  return d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1
}

/** その日が前期(4〜9月)か後期(10〜3月)か */
export function currentTerm(d: Date = new Date()): '前期' | '後期' {
  const m = d.getMonth() + 1
  return m >= 4 && m <= 9 ? '前期' : '後期'
}

/** 今日時点の既定の学期。例: 2026-07 → "2026 前期" */
export function defaultSemester(d: Date = new Date()): string {
  return `${academicYear(d)} ${currentTerm(d)}`
}

function termRank(s: string): number {
  if (s.includes('前期')) return 0
  if (s.includes('後期')) return 1
  return 2
}

/**
 * 学期セレクタの選択肢を自動生成する。
 * 現在の年度の前後1年 × 前期/後期 を並べ、年が変われば勝手に候補も変わる。
 * 現在選択中の学期や、既にデータが存在する学期(present)も取りこぼさず含める。
 */
export function semesterOptions(
  current?: string,
  present: string[] = [],
  d: Date = new Date(),
): string[] {
  const y = academicYear(d)
  const set = new Set<string>()
  for (let yy = y - 1; yy <= y + 1; yy++) {
    set.add(`${yy} 前期`)
    set.add(`${yy} 後期`)
  }
  for (const p of present) if (p) set.add(p)
  if (current) set.add(current)
  return [...set].sort((a, b) => {
    const ya = parseInt(a) || 0
    const yb = parseInt(b) || 0
    if (ya !== yb) return ya - yb
    const ra = termRank(a)
    const rb = termRank(b)
    if (ra !== rb) return ra - rb
    return a.localeCompare(b, 'ja')
  })
}
