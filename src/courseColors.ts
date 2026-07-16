// 講義ごとの色。course_info.color に色キー(下記のいずれか)を保存する。
// Tailwindのクラスは静的に書いておく(JITが拾えるように文字列で列挙)。

export const COURSE_COLOR_KEYS = [
  'blue',
  'red',
  'green',
  'amber',
  'purple',
  'teal',
  'pink',
  'gray',
] as const
export type CourseColorKey = (typeof COURSE_COLOR_KEYS)[number]

export const DEFAULT_COURSE_COLOR: CourseColorKey = 'blue'

interface ColorClass {
  /** 時間割セルの背景 */
  cell: string
  /** 講義名などの文字色 */
  text: string
  /** 選択パレットの丸 */
  swatch: string
}

export const COURSE_COLOR_CLASS: Record<CourseColorKey, ColorClass> = {
  blue: { cell: 'bg-blue-50', text: 'text-blue-800', swatch: 'bg-blue-400' },
  red: { cell: 'bg-red-50', text: 'text-red-800', swatch: 'bg-red-400' },
  green: { cell: 'bg-green-50', text: 'text-green-800', swatch: 'bg-green-400' },
  amber: { cell: 'bg-amber-50', text: 'text-amber-800', swatch: 'bg-amber-400' },
  purple: { cell: 'bg-purple-50', text: 'text-purple-800', swatch: 'bg-purple-400' },
  teal: { cell: 'bg-teal-50', text: 'text-teal-800', swatch: 'bg-teal-400' },
  pink: { cell: 'bg-pink-50', text: 'text-pink-800', swatch: 'bg-pink-400' },
  gray: { cell: 'bg-gray-100', text: 'text-gray-800', swatch: 'bg-gray-400' },
}

export function colorClass(key?: string): ColorClass {
  return COURSE_COLOR_CLASS[(key as CourseColorKey) in COURSE_COLOR_CLASS
    ? (key as CourseColorKey)
    : DEFAULT_COURSE_COLOR]
}
