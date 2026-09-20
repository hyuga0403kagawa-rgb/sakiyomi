import { CalendarClock, ExternalLink, FileText, X } from 'lucide-react'
import type { Task } from './types'
import { dueColor, fmtCountdown, fmtDue, fmtMinutes } from './format'

/** Moodleの種別 → 画面に出す呼び名 */
function kindLabel(task: Task): string {
  if (task.source === 'manual') return '自分で追加'
  if (task.moodleModule === 'quiz') return '小テスト'
  if (task.moodleModule === 'assign') return '課題'
  return 'Moodle'
}

/**
 * 課題1件の詳細(下から出るシート)。
 * Moodleでは課題ごとに説明や提出方法の書かれる位置がまちまちなので、
 * ここでは必ず「講義 → 課題名 → 期限 → 説明 → 提出ページ」の順・同じ位置で見せる。
 */
export default function TaskDetailSheet(props: {
  task: Task
  onClose: () => void
  onToggle: (id: string) => void
}) {
  const { task, onClose, onToggle } = props
  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="課題の詳細"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 見出し(講義名・課題名) */}
        <div className="flex items-start gap-3 border-b border-gray-100 px-4 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">
                {kindLabel(task)}
              </span>
              {task.course && <span className="truncate text-xs text-gray-500">{task.course}</span>}
            </div>
            <h3 className="mt-1 text-base font-semibold leading-snug text-gray-900">{task.title}</h3>
          </div>
          <button onClick={onClose} aria-label="閉じる" className="shrink-0 p-1 text-gray-400">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-4 py-4">
          {/* 期限 */}
          <section>
            <h4 className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
              <CalendarClock className="h-3.5 w-3.5" />
              期限
            </h4>
            {task.due ? (
              <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
                <span className="text-lg font-semibold text-gray-900">{fmtDue(task.due)}</span>
                <span className={`text-sm font-semibold ${dueColor(task.due)}`}>
                  {fmtCountdown(task.due)}
                </span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-gray-500">期限は設定されていません</p>
            )}
            <p className="mt-0.5 text-xs text-gray-500">
              作業時間の見積もり: {fmtMinutes(task.estimatedMinutes)}
            </p>
          </section>

          {/* 説明(Moodleの記載) */}
          {task.source === 'moodle' && (
            <section>
              <h4 className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                <FileText className="h-3.5 w-3.5" />
                Moodleに書かれている説明
              </h4>
              {task.description ? (
                <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 text-sm leading-relaxed text-gray-800">
                  {task.description}
                </p>
              ) : (
                <p className="mt-1 text-sm text-gray-500">
                  説明文は取得できていません。提出ページで確認してください。
                </p>
              )}
            </section>
          )}

          {/* 提出ページ */}
          {task.moodleUrl && (
            <a
              href={task.moodleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-3 text-sm font-semibold text-white"
            >
              {/* カレンダーURL方式では提出ページそのもののURLが取れないので、サイトの入口に飛ばす */}
              {task.viaCalendarUrl ? 'Moodleを開く' : 'Moodleの提出ページを開く'}
              <ExternalLink className="h-4 w-4" />
            </a>
          )}

          {task.viaCalendarUrl && !task.done && (
            <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-800">
              この課題はカレンダーURLで取り込んだものです。提出済みかどうかは自動では分からないので、
              提出したら下のボタンで「提出済み」にしてください。
            </p>
          )}

          <button
            onClick={() => {
              onToggle(task.id)
              onClose()
            }}
            className="w-full rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-gray-700"
          >
            {task.done ? '未提出に戻す' : '提出済みにする'}
          </button>

          {task.source === 'moodle' && (
            <p className="text-xs leading-relaxed text-gray-500">
              期限と内容はMoodleの表示が正です。UniPortは1時間ごとにMoodleと同期していますが、
              提出の前には必ずMoodleの画面でも確認してください。
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
