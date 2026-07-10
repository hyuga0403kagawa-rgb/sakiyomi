import { supabase } from './supabase'

export interface Course {
  id: number
  name: string
  /** 講義の終了日(Unix秒)。0 のときは終了日なし。時間割の候補で終了済みを除外するのに使う */
  enddate?: number
  /** 0 のとき非表示コース */
  visible?: number
}

export interface MaterialFile {
  section: string
  module: string
  modname: string
  filename: string
  url: string
  mimetype: string
  filesize: number
  timemodified: number
}

async function invokeMaterials(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('moodle-materials', { body })
  if (error) throw new Error('資料サーバーへの接続に失敗しました')
  if (data?.error) throw new Error(data.error)
  return data
}

export async function fetchCourses(): Promise<Course[]> {
  const data = await invokeMaterials({})
  return (data.courses ?? []) as Course[]
}

export async function fetchCourseFiles(courseId: number): Promise<MaterialFile[]> {
  const data = await invokeMaterials({ courseId })
  return (data.files ?? []) as MaterialFile[]
}

/** ファイル種別に応じたアイコン */
export function fileIcon(f: MaterialFile): string {
  if (f.modname === 'url') return '🔗'
  const name = f.filename.toLowerCase()
  if (name.endsWith('.pdf')) return '📕'
  if (/\.(pptx?|key)$/.test(name)) return '📙'
  if (/\.(docx?|txt|md)$/.test(name)) return '📘'
  if (/\.(xlsx?|csv)$/.test(name)) return '📗'
  if (/\.(png|jpe?g|gif|webp)$/.test(name)) return '🖼️'
  if (/\.(mp4|mov|avi|mp3|wav)$/.test(name)) return '🎬'
  if (/\.(zip|7z|rar)$/.test(name)) return '🗜️'
  return '📄'
}

export function fmtFileSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
