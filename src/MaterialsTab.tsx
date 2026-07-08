import { useEffect, useState } from 'react'
import type { Course, MaterialFile } from './materials'
import { fetchCourseFiles, fetchCourses, fileIcon, fmtFileSize } from './materials'

/** 講義資料タブ: 講義一覧 → タップで資料一覧を展開。ファイルはタップでそのまま開く */
export default function MaterialsTab() {
  const [courses, setCourses] = useState<Course[] | null>(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  const [filesByCourse, setFilesByCourse] = useState<Record<number, MaterialFile[]>>({})
  const [loadingCourse, setLoadingCourse] = useState<number | null>(null)

  useEffect(() => {
    fetchCourses()
      .then(setCourses)
      .catch((e) => setError(e instanceof Error ? e.message : '取得に失敗しました'))
  }, [])

  const toggleCourse = async (id: number) => {
    if (openId === id) {
      setOpenId(null)
      return
    }
    setOpenId(id)
    if (!filesByCourse[id]) {
      setLoadingCourse(id)
      try {
        const files = await fetchCourseFiles(id)
        setFilesByCourse((m) => ({ ...m, [id]: files }))
      } catch (e) {
        setError(e instanceof Error ? e.message : '取得に失敗しました')
      } finally {
        setLoadingCourse(null)
      }
    }
  }

  return (
    <main className="px-4 py-4">
      <h2 className="text-base font-bold text-gray-800">講義資料</h2>
      <p className="mt-1 text-xs text-gray-400">
        Moodleに置かれている資料をここからすぐ開けます
      </p>

      {error && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {courses === null && !error && (
        <p className="mt-6 text-center text-sm text-gray-400">講義一覧を読み込み中…</p>
      )}

      {courses && courses.length === 0 && (
        <p className="mt-6 text-center text-sm text-gray-400">履修中の講義が見つかりませんでした</p>
      )}

      <div className="mt-3 space-y-2">
        {courses?.map((c) => (
          <div key={c.id} className="rounded-xl bg-white shadow-sm">
            <button
              onClick={() => toggleCourse(c.id)}
              className="flex w-full items-center justify-between p-3 text-left"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">
                {c.name}
              </span>
              <span className="ml-2 shrink-0 text-gray-400">{openId === c.id ? '▾' : '▸'}</span>
            </button>

            {openId === c.id && (
              <div className="border-t border-gray-100 px-3 pb-3">
                {loadingCourse === c.id ? (
                  <p className="py-3 text-center text-xs text-gray-400">資料を読み込み中…</p>
                ) : (filesByCourse[c.id] ?? []).length === 0 ? (
                  <p className="py-3 text-center text-xs text-gray-400">
                    この講義にはファイルがありません
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {(filesByCourse[c.id] ?? []).map((f, i) => (
                      <li key={i}>
                        <a
                          href={f.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-indigo-50"
                        >
                          <span className="shrink-0">{fileIcon(f)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-gray-800">{f.filename}</span>
                            <span className="block truncate text-[11px] text-gray-400">
                              {f.module}
                              {f.filesize > 0 && ` · ${fmtFileSize(f.filesize)}`}
                            </span>
                          </span>
                          <span className="shrink-0 text-xs text-gray-300">↗</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  )
}
