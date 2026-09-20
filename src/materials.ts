import { supabase } from './supabase'
import { demoStore, isDemo } from './demo'

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
  if (isDemo()) {
    // デモでは時間割に入っている講義をそのままMoodle上の講義として扱う
    const names = [...new Set(demoStore().slots.map((s) => s.course))]
    return names.map((name, i) => ({ id: 1000 + i, name, enddate: 0, visible: 1 }))
  }
  const data = await invokeMaterials({})
  return (data.courses ?? []) as Course[]
}

export async function fetchCourseFiles(courseId: number): Promise<MaterialFile[]> {
  if (isDemo()) {
    const base = demoStore().settings.moodleUrl
    const now = Math.floor(Date.now() / 1000)
    return [
      { section: '第1回', module: '講義スライド', modname: 'resource', filename: '第1回_ガイダンス.pdf', url: base, mimetype: 'application/pdf', filesize: 1_240_000, timemodified: now },
      { section: '第2回', module: '講義スライド', modname: 'resource', filename: '第2回_講義資料.pdf', url: base, mimetype: 'application/pdf', filesize: 2_080_000, timemodified: now },
      { section: '第2回', module: '演習問題', modname: 'resource', filename: '演習問題.docx', url: base, mimetype: 'application/msword', filesize: 86_000, timemodified: now },
    ]
  }
  const data = await invokeMaterials({ courseId })
  return (data.files ?? []) as MaterialFile[]
}

/** ファイル種別(表示側で対応するアイコンに割り当てる) */
export type FileKind =
  | 'link'
  | 'pdf'
  | 'slides'
  | 'doc'
  | 'sheet'
  | 'image'
  | 'video'
  | 'archive'
  | 'file'

export function fileKind(f: MaterialFile): FileKind {
  if (f.modname === 'url') return 'link'
  const name = f.filename.toLowerCase()
  if (name.endsWith('.pdf')) return 'pdf'
  if (/\.(pptx?|key)$/.test(name)) return 'slides'
  if (/\.(docx?|txt|md)$/.test(name)) return 'doc'
  if (/\.(xlsx?|csv)$/.test(name)) return 'sheet'
  if (/\.(png|jpe?g|gif|webp)$/.test(name)) return 'image'
  if (/\.(mp4|mov|avi|mp3|wav)$/.test(name)) return 'video'
  if (/\.(zip|7z|rar)$/.test(name)) return 'archive'
  return 'file'
}

export function fmtFileSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
