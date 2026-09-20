import { useState } from 'react'
import { ChevronRight, Pencil, X } from 'lucide-react'
import type { Task } from './types'
import { dueColor, fmtCountdown, fmtDue, fmtMinutes } from './format'
import TaskDetailSheet from './TaskDetailSheet'

/** 課題1件の表示(講義名 → 課題名 → 期限+カウントダウン)。全画面で共通利用する */
export default function TaskRow(props: {
  task: Task
  minutes?: number
  crammed?: boolean
  onToggle: (id: string) => void
  onRemove?: (id: string) => void
  onEdit?: (task: Task) => void
  showCourse?: boolean
}) {
  const { task, minutes, crammed, onToggle, onRemove, onEdit, showCourse = true } = props
  const [open, setOpen] = useState(false)
  return (
    <li className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3">
      <input
        type="checkbox"
        checked={task.done}
        onChange={() => onToggle(task.id)}
        className="mt-1 h-5 w-5 shrink-0 accent-primary"
        aria-label={`${task.title}を完了にする`}
      />
      {/* 本文をタップすると詳細(説明・提出ページ)が開く */}
      <button onClick={() => setOpen(true)} className="min-w-0 flex-1 text-left">
        {showCourse && task.course && (
          <p className="truncate text-xs text-gray-500">{task.course}</p>
        )}
        {/* 課題名は1行で切らない(「レポート3…」のように肝心な部分が読めなくなるため) */}
        <span className="line-clamp-2 break-words font-medium text-gray-900">{task.title}</span>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
          {task.due ? (
            <>
              <span className={dueColor(task.due)}>{fmtDue(task.due)}</span>
              <span className={`font-medium ${dueColor(task.due)}`}>{fmtCountdown(task.due)}</span>
            </>
          ) : (
            <span className="text-gray-500">期限なし</span>
          )}
          {task.moodleModule === 'quiz' && (
            <span className="rounded bg-amber-50 px-1 py-0.5 text-[11px] font-medium text-amber-700">
              小テスト
            </span>
          )}
          {task.viaCalendarUrl && (
            <span className="rounded bg-sky-50 px-1 py-0.5 text-[11px] font-medium text-sky-700">
              URL連携
            </span>
          )}
          {task.source === 'manual' && (
            <span className="rounded bg-gray-100 px-1 py-0.5 text-[11px] font-medium text-gray-600">
              自分で追加
            </span>
          )}
        </p>
        {crammed && <p className="text-xs text-red-600">期限日に詰め込みが発生しています</p>}
      </button>
      {minutes !== undefined && (
        <span className="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-xs font-medium tabular-nums text-gray-600">
          {fmtMinutes(minutes)}
        </span>
      )}
      {onEdit && (
        <button
          onClick={() => onEdit(task)}
          className="shrink-0 text-gray-400 hover:text-gray-600"
          aria-label="編集"
        >
          <Pencil className="h-4 w-4" />
        </button>
      )}
      {onRemove && task.source === 'manual' && (
        <button
          onClick={() => onRemove(task.id)}
          className="shrink-0 text-gray-400 hover:text-red-500"
          aria-label="削除"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      {!onEdit && !onRemove && minutes === undefined && (
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-gray-300" aria-hidden="true" />
      )}
      {open && <TaskDetailSheet task={task} onClose={() => setOpen(false)} onToggle={onToggle} />}
    </li>
  )
}
