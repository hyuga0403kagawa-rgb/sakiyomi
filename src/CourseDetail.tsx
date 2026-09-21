import { useEffect, useMemo, useState } from 'react'
import {
  Archive,
  BookOpen,
  ExternalLink,
  File as FileIcon,
  FileText,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Link2,
  Presentation,
  Table2,
  TrendingUp,
  UserCheck,
} from 'lucide-react'
import type { AttendanceRecord, AttendanceStatus, CourseInfo, Task } from './types'
import * as repo from './repo'
import { fetchCourseFiles, fetchCourses, fileKind, fmtFileSize, type MaterialFile } from './materials'
import { COURSE_COLOR_CLASS, COURSE_COLOR_KEYS, DEFAULT_COURSE_COLOR } from './courseColors'
import TaskRow from './TaskRow'

/** シラバスの貼り付けテキストから評価割合などを自動読み取りする(ルールベース) */
export function extractSyllabus(text: string): Partial<CourseInfo> {
  const pct = (patterns: RegExp[]): number | undefined => {
    for (const p of patterns) {
      const m = text.match(p)
      if (m) {
        const v = Number(m[1])
        if (v >= 0 && v <= 100) return v
      }
    }
    return undefined
  }
  const textbook = text.match(/教科書[::]?\s*([^\n]{2,60})/)?.[1]?.trim()
  const bring = text.match(/持ち?込み?[^\n]{0,10}?(不可|一部可|可)/)?.[1]
  return {
    attendancePct: pct([/出席[^0-9%%]{0,15}(\d{1,3})\s*[%%点]/]),
    reportPct: pct([/(?:レポート|課題|提出物|小テスト)[^0-9%%]{0,15}(\d{1,3})\s*[%%点]/]),
    examPct: pct([/(?:定期試験|期末試験|期末|試験|テスト)[^0-9%%]{0,15}(\d{1,3})\s*[%%点]/]),
    textbook,
    bringIn: bring,
  }
}

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: '出席',
  late: '遅刻',
  absent: '欠席',
}

/** ファイル種別→ラインアイコン(絵文字は使わない) */
const FILE_KIND_ICON = {
  link: Link2,
  pdf: FileText,
  slides: Presentation,
  doc: FileText,
  sheet: Table2,
  image: ImageIcon,
  video: Film,
  archive: Archive,
  file: FileIcon,
} as const

function FileTypeIcon(props: { f: MaterialFile }) {
  const Icon = FILE_KIND_ICON[fileKind(props.f)]
  return <Icon className="h-4 w-4 shrink-0 text-gray-400" />
}

export default function CourseDetail(props: {
  course: string
  tasks: Task[]
  onToggle: (id: string) => void
  onBack: () => void
  onFlash: (text: string) => void
  color?: string
  onColorChange?: (color: string) => void
}) {
  const { course, tasks, onToggle, onBack, onFlash, color, onColorChange } = props
  const [info, setInfo] = useState<CourseInfo | null>(null)
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [files, setFiles] = useState<MaterialFile[] | null>(null)
  const [filesError, setFilesError] = useState('')
  const [showSyllabusForm, setShowSyllabusForm] = useState(false)
  const [paste, setPaste] = useState('')
  const [form, setForm] = useState<CourseInfo>({ course })
  const [marking, setMarking] = useState(false)

  useEffect(() => {
    repo
      .fetchCourseInfo(course)
      .then((i) => {
        setInfo(i)
        setForm(i ?? { course })
        if (!i) setShowSyllabusForm(false)
      })
      .catch(() => {})
    repo.fetchAttendance(course).then(setRecords).catch(() => {})
    ;(async () => {
      try {
        const courses = await fetchCourses()
        const matched = courses.find((c) => c.name === course)
        if (!matched) {
          setFiles([])
          setFilesError('Moodle上の講義と名前が一致しませんでした')
          return
        }
        setFiles(await fetchCourseFiles(matched.id))
      } catch (e) {
        setFiles([])
        setFilesError(e instanceof Error ? e.message : '資料の取得に失敗しました')
      }
    })()
  }, [course])

  const courseTasks = tasks.filter((t) => t.course === course)
  const pending = courseTasks.filter((t) => !t.done)

  // 出席統計
  const stats = useMemo(() => {
    const total = records.length
    const present = records.filter((r) => r.status === 'present').length
    const late = records.filter((r) => r.status === 'late').length
    const absent = records.filter((r) => r.status === 'absent').length
    const rate = total > 0 ? (present + late * 0.5) / total : null
    return { total, present, late, absent, rate }
  }, [records])

  // 成績見込み(登録された評価割合 × 実際の出席率・課題提出率)
  const grade = useMemo(() => {
    if (!info || (!info.attendancePct && !info.reportPct && !info.examPct)) return null
    const lines: string[] = []
    let secured = 0
    if (info.attendancePct) {
      const r = stats.rate ?? 1
      const pts = info.attendancePct * r
      secured += pts
      lines.push(
        `出席: ${Math.round(pts)} / ${info.attendancePct}点` +
          (stats.rate === null ? '(記録なし・満点と仮定)' : `(出席率${Math.round(r * 100)}%)`),
      )
    }
    if (info.reportPct) {
      const r = courseTasks.length > 0 ? courseTasks.filter((t) => t.done).length / courseTasks.length : 1
      const pts = info.reportPct * r
      secured += pts
      lines.push(
        `課題: ${Math.round(pts)} / ${info.reportPct}点` +
          (courseTasks.length === 0 ? '(課題なし・満点と仮定)' : `(提出率${Math.round(r * 100)}%)`),
      )
    }
    const examMax = info.examPct ?? 0
    if (examMax) lines.push(`試験: 0〜${examMax}点(これから)`)
    const min = Math.round(secured)
    const max = Math.round(secured + examMax)
    return { lines, min, max }
  }, [info, stats, courseTasks])

  const mark = async (status: AttendanceStatus) => {
    setMarking(true)
    try {
      const rec = await repo.addAttendance(course, status)
      setRecords((rs) => [rec, ...rs])
      onFlash(`${STATUS_LABEL[status]}を記録しました`)
    } catch {
      onFlash('記録に失敗しました')
    } finally {
      setMarking(false)
    }
  }

  const undoLast = async () => {
    const last = records[0]
    if (!last) return
    setRecords((rs) => rs.slice(1))
    try {
      await repo.deleteAttendance(last.id)
    } catch {
      onFlash('取り消しに失敗しました')
    }
  }

  const saveInfo = async () => {
    try {
      await repo.upsertCourseInfo({ ...form, course })
      setInfo({ ...form, course })
      setShowSyllabusForm(false)
      onFlash('講義情報を保存しました')
    } catch {
      onFlash('保存に失敗しました')
    }
  }

  const currentColor = color ?? info?.color ?? DEFAULT_COURSE_COLOR
  const changeColor = async (key: string) => {
    onColorChange?.(key) // 時間割側の表示を即反映
    const merged = { ...(info ?? { course }), course, color: key }
    setInfo(merged)
    setForm((f) => ({ ...f, color: key }))
    try {
      await repo.upsertCourseInfo(merged)
    } catch {
      onFlash('色の保存に失敗しました')
    }
  }

  const runExtract = () => {
    if (!paste.trim()) return
    const ex = extractSyllabus(paste)
    const found = Object.values(ex).filter((v) => v !== undefined).length
    setForm((f) => ({ ...f, ...Object.fromEntries(Object.entries(ex).filter(([, v]) => v !== undefined)) }))
    onFlash(found > 0 ? `${found}項目を読み取りました(内容を確認してください)` : '読み取れる項目が見つかりませんでした')
  }

  const numField = (
    label: string,
    key: 'attendancePct' | 'reportPct' | 'examPct',
  ) => (
    <label className="block">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={100}
          value={form[key] ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value === '' ? undefined : Number(e.target.value) }))}
          className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
        />
        <span className="text-xs text-gray-400">%</span>
      </div>
    </label>
  )

  return (
    <main className="px-4 py-4">
      <button onClick={onBack} className="text-sm text-primary">
        ← 時間割に戻る
      </button>
      <h2 className="mt-2 text-lg font-semibold text-gray-800">{course}</h2>

      {/* 講義の色 */}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs text-gray-500">色</span>
        <div className="flex flex-wrap gap-1.5">
          {COURSE_COLOR_KEYS.map((key) => (
            <button
              key={key}
              onClick={() => changeColor(key)}
              aria-label={`色を${key}にする`}
              className={`h-6 w-6 rounded-full ${COURSE_COLOR_CLASS[key].swatch} ${
                currentColor === key ? 'ring-2 ring-gray-800 ring-offset-1' : ''
              }`}
            />
          ))}
        </div>
      </div>

      {/* 成績見込み */}
      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800"><TrendingUp className="h-4 w-4 text-gray-400" />成績見込み</h3>
        {grade ? (
          <>
            <p className="mt-2 text-2xl font-semibold text-primary">
              {grade.min}〜{grade.max}
              <span className="text-sm font-normal text-gray-500"> 点</span>
            </p>
            <ul className="mt-1 space-y-0.5 text-xs text-gray-500">
              {grade.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            {grade.max < 60 && (
              <p className="mt-2 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">
                このままだと単位取得が難しい可能性があります
              </p>
            )}
            {grade.max >= 60 && grade.min < 60 && (
              <p className="mt-2 text-xs text-orange-500">
                試験で{60 - grade.min}点以上とれば60点に届きます
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-xs text-gray-400">
            下の「シラバス情報」で評価割合を登録すると、出席率と課題提出率から見込み点を計算します
          </p>
        )}
      </div>

      {/* 出席管理 */}
      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800"><UserCheck className="h-4 w-4 text-gray-400" />出席管理</h3>
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => mark('present')}
            disabled={marking}
            className="flex-1 rounded-lg bg-green-50 py-2 text-sm font-medium text-green-700 disabled:opacity-50"
          >
            ○ 出席
          </button>
          <button
            onClick={() => mark('late')}
            disabled={marking}
            className="flex-1 rounded-lg bg-orange-50 py-2 text-sm font-medium text-orange-600 disabled:opacity-50"
          >
            △ 遅刻
          </button>
          <button
            onClick={() => mark('absent')}
            disabled={marking}
            className="flex-1 rounded-lg bg-red-50 py-2 text-sm font-medium text-red-600 disabled:opacity-50"
          >
            ✕ 欠席
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
          <span>
            出席{stats.present} · 遅刻{stats.late} · 欠席{stats.absent}
            {stats.rate !== null && (
              <span className={`ml-2 font-semibold ${stats.rate < 0.7 ? 'text-red-600' : 'text-green-600'}`}>
                出席率 {Math.round(stats.rate * 100)}%
              </span>
            )}
          </span>
          {records.length > 0 && (
            <button onClick={undoLast} className="text-gray-400 underline">
              直前を取り消す
            </button>
          )}
        </div>
      </div>

      {/* シラバス情報 */}
      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800"><BookOpen className="h-4 w-4 text-gray-400" />シラバス情報</h3>
          <button
            onClick={() => setShowSyllabusForm(!showSyllabusForm)}
            className="text-xs text-primary underline"
          >
            {showSyllabusForm ? '閉じる' : info ? '編集' : '登録する'}
          </button>
        </div>

        {!showSyllabusForm && info && (
          <ul className="mt-2 space-y-1 text-sm text-gray-700">
            {(info.attendancePct || info.reportPct || info.examPct) && (
              <li>
                評価: {info.attendancePct ? `出席${info.attendancePct}% ` : ''}
                {info.reportPct ? `レポート${info.reportPct}% ` : ''}
                {info.examPct ? `試験${info.examPct}%` : ''}
              </li>
            )}
            {info.textbook && <li>教科書: {info.textbook}</li>}
            {info.bringIn && <li>持ち込み: {info.bringIn}</li>}
            {info.notes && <li className="text-xs text-gray-500">{info.notes}</li>}
          </ul>
        )}
        {!showSyllabusForm && !info && (
          <p className="mt-2 text-xs text-gray-400">
            シラバスの内容(評価割合・教科書・持ち込み可否)をここにメモしておけます
          </p>
        )}

        {showSyllabusForm && (
          <div className="mt-3 space-y-3">
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="シラバスの本文をここに貼り付けると、評価割合などを自動で読み取ります"
              rows={3}
              className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
            />
            <button
              onClick={runExtract}
              className="w-full rounded-lg border border-primary py-1.5 text-xs font-medium text-primary"
            >
              貼り付けた文章から自動読み取り
            </button>
            <div className="grid grid-cols-3 gap-2">
              {numField('出席', 'attendancePct')}
              {numField('レポート', 'reportPct')}
              {numField('試験', 'examPct')}
            </div>
            <label className="block">
              <span className="text-xs text-gray-500">教科書</span>
              <input
                value={form.textbook ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, textbook: e.target.value || undefined }))}
                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">試験の持ち込み</span>
              <select
                value={form.bringIn ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, bringIn: e.target.value || undefined }))}
                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
              >
                <option value="">未記入</option>
                <option value="可">可</option>
                <option value="一部可">一部可</option>
                <option value="不可">不可</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-gray-500">重要事項メモ</span>
              <textarea
                value={form.notes ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value || undefined }))}
                rows={2}
                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
              />
            </label>
            <button onClick={saveInfo} className="w-full rounded-lg bg-primary py-2 text-sm font-semibold text-white">
              保存
            </button>
          </div>
        )}
      </div>

      {/* 課題 */}
      <div className="mt-4">
        <h3 className="text-sm font-semibold text-gray-800">
          この講義の課題{' '}
          <span className="text-xs font-normal text-gray-400">
            未提出{pending.length}件 / 全{courseTasks.length}件
          </span>
        </h3>
        {pending.length === 0 ? (
          <p className="mt-2 text-xs text-gray-400">未提出の課題はありません</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {pending.map((t) => (
              <TaskRow key={t.id} task={t} onToggle={onToggle} showCourse={false} />
            ))}
          </ul>
        )}
      </div>

      {/* 資料 */}
      <div className="mt-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800"><FolderOpen className="h-4 w-4 text-gray-400" />講義資料</h3>
        {files === null ? (
          <p className="mt-2 text-xs text-gray-400">読み込み中…</p>
        ) : files.length === 0 ? (
          <p className="mt-2 text-xs text-gray-400">{filesError || '資料はありません'}</p>
        ) : (
          <ul className="mt-2 space-y-1 rounded-lg border border-gray-200 bg-white p-2">
            {files.map((f, i) => (
              <li key={i}>
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-primary-soft"
                >
                  <FileTypeIcon f={f} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-gray-800">{f.filename}</span>
                    <span className="block truncate text-[11px] text-gray-400">
                      {f.module}
                      {f.filesize > 0 && ` · ${fmtFileSize(f.filesize)}`}
                    </span>
                  </span>
                  <ExternalLink className="h-4 w-4 shrink-0 text-gray-300" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
