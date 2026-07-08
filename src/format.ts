export const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土']

export function fmtDue(iso: string): string {
  const d = new Date(iso)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_JA[d.getDay()]}) ${hm}`
}

export function fmtTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function fmtMinutes(min: number): string {
  if (min < 60) return `${min}分`
  return min % 60 === 0 ? `${min / 60}時間` : `${Math.floor(min / 60)}時間${min % 60}分`
}

/** 期限までの近さで文字色を変える(期限切れ/24時間以内=赤、3日以内=オレンジ) */
export function dueColor(iso?: string): string {
  if (!iso) return 'text-gray-400'
  const diff = new Date(iso).getTime() - Date.now()
  if (diff < 0) return 'text-red-600 font-bold'
  if (diff < 24 * 3600_000) return 'text-red-600'
  if (diff < 72 * 3600_000) return 'text-orange-500'
  return 'text-gray-500'
}

/** 「あと3日」「あと5時間」のようなカウントダウン表記 */
export function fmtCountdown(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff < 0) return '期限切れ'
  const days = Math.floor(diff / 86400_000)
  if (days >= 1) return `あと${days}日`
  const hours = Math.floor(diff / 3600_000)
  if (hours >= 1) return `あと${hours}時間`
  const minutes = Math.max(1, Math.floor(diff / 60_000))
  return `あと${minutes}分`
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
