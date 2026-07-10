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
  blue: { cell: 'bg-blue-100', text: 'text-blue-900', swatch: 'bg-blue-400' },
  red: { cell: 'bg-red-100', text: 'text-red-900', swatch: 'bg-red-400' },
  green: { cell: 'bg-green-100', text: 'text-green-900', swatch: 'bg-green-500' },
  amber: { cell: 'bg-amber-100', text: 'text-amber-900', swatch: 'bg-amber-400' },
  purple: { cell: 'bg-purple-100', text: 'text-purple-900', swatch: 'bg-purple-400' },
  teal: { cell: 'bg-teal-100', text: 'text-teal-900', swatch: 'bg-teal-500' },
  pink: { cell: 'bg-pink-100', text: 'text-pink-900', swatch: 'bg-pink-400' },
  gray: { cell: 'bg-gray-100', text: 'text-gray-800', swatch: 'bg-gray-400' },
}

export function colorClass(key?: string): ColorClass {
  return COURSE_COLOR_CLASS[(key as CourseColorKey) in COURSE_COLOR_CLASS
    ? (key as CourseColorKey)
    : DEFAULT_COURSE_COLOR]
}
