import type { Task } from './types'
import { dueColor, fmtCountdown, fmtDue, fmtMinutes } from './format'

/** 課題1件の表示(講義名 → 課題名 → 期限+カウントダウン)。全画面で共通利用する */
export default function TaskRow(props: {
  task: Task
  minutes?: number
  crammed?: boolean
  onToggle: (id: string) => void
  onRemove?: (id: string) => void
  showCourse?: boolean
}) {
  const { task, minutes, crammed, onToggle, onRemove, showCourse = true } = props
  return (
    <li className="flex items-start gap-3 rounded-xl bg-white p-3 shadow-sm">
      <input
        type="checkbox"
        checked={task.done}
        onChange={() => onToggle(task.id)}
        className="mt-1 h-5 w-5 accent-indigo-600"
      />
      <div className="min-w-0 flex-1">
        {showCourse && task.course && (
          <p className="truncate text-xs font-medium text-indigo-500">{task.course}</p>
        )}
        <span className="block truncate font-medium text-gray-800">{task.title}</span>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
          {task.due ? (
            <>
              <span className={dueColor(task.due)}>{fmtDue(task.due)}</span>
              <span className={`font-medium ${dueColor(task.due)}`}>{fmtCountdown(task.due)}</span>
            </>
          ) : (
            <span className="text-gray-400">期限なし</span>
          )}
          {task.source === 'manual' && (
            <span className="rounded bg-gray-100 px-1 py-0.5 text-[10px] font-medium text-gray-500">
              自分で追加
            </span>
          )}
        </p>
        {crammed && <p className="text-xs text-red-600">⚠ 期限日に詰め込みが発生しています</p>}
      </div>
      {minutes !== undefined && (
        <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700">
          {fmtMinutes(minutes)}
        </span>
      )}
      {onRemove && task.source === 'manual' && (
        <button
          onClick={() => onRemove(task.id)}
          className="shrink-0 text-gray-300 hover:text-red-500"
          aria-label="削除"
        >
          ✕
        </button>
      )}
    </li>
  )
}
