import { useEffect, useMemo, useState } from 'react'
import type { Settings, Task } from './types'
import { loadSettings, loadTasks, saveSettings, saveTasks } from './storage'
import { syncMoodle } from './moodle'
import { buildTodayPlan } from './planner'

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土']

function fmtDue(iso: string): string {
  const d = new Date(iso)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_JA[d.getDay()]}) ${hm}`
}

function fmtMinutes(min: number): string {
  if (min < 60) return `${min}分`
  return min % 60 === 0 ? `${min / 60}時間` : `${Math.floor(min / 60)}時間${min % 60}分`
}

function dueColor(iso?: string): string {
  if (!iso) return 'text-gray-400'
  const diff = new Date(iso).getTime() - Date.now()
  if (diff < 0) return 'text-red-600 font-bold'
  if (diff < 2 * 86400_000) return 'text-orange-500 font-medium'
  return 'text-gray-500'
}

type Tab = 'today' | 'all' | 'settings'

export default function App() {
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks())
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [tab, setTab] = useState<Tab>('today')
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => saveTasks(tasks), [tasks])
  useEffect(() => saveSettings(settings), [settings])

  const plan = useMemo(
    () => buildTodayPlan(tasks, settings.minutesPerDay),
    [tasks, settings.minutesPerDay],
  )

  const toggleDone = (id: string) =>
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, done: !t.done } : t)))

  const removeTask = (id: string) => setTasks((ts) => ts.filter((t) => t.id !== id))

  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 4000)
  }

  const handleSync = async () => {
    if (!settings.moodleToken) {
      flash('先に設定画面でMoodleトークンを登録してください')
      setTab('settings')
      return
    }
    setSyncing(true)
    try {
      const merged = await syncMoodle(settings, tasks)
      setTasks(merged)
      setSettings((s) => ({ ...s, lastSyncedAt: new Date().toISOString() }))
      const count = merged.filter((t) => t.source === 'moodle' && !t.done).length
      flash(`同期完了! 未提出の課題 ${count}件`)
    } catch (e) {
      flash(e instanceof Error ? e.message : '同期に失敗しました')
    } finally {
      setSyncing(false)
    }
  }

  const today = new Date()

  return (
    <div className="mx-auto min-h-screen max-w-md bg-gray-50 pb-24">
      <header className="sticky top-0 z-10 bg-indigo-600 px-4 py-3 text-white shadow">
        <h1 className="text-lg font-bold">
          サキヨミ <span className="text-xs font-normal opacity-70">(仮)</span>
        </h1>
        <p className="text-xs opacity-80">課題を先読みして、今日やる分だけ教えてくれる</p>
      </header>

      {message && (
        <div className="mx-4 mt-3 rounded-lg bg-indigo-100 px-3 py-2 text-sm text-indigo-800">
          {message}
        </div>
      )}

      {tab === 'today' && (
        <main className="px-4 py-4">
          <h2 className="text-base font-bold text-gray-800">
            {today.getMonth() + 1}月{today.getDate()}日({WEEKDAY_JA[today.getDay()]}) 今日やること
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            合計 {fmtMinutes(plan.totalMinutes)} / 上限 {fmtMinutes(settings.minutesPerDay)}
          </p>

          {plan.overloaded && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              ⚠ このペースだと期限に間に合わない課題があります。1日の時間を増やすか、今日多めに進めましょう。
            </div>
          )}

          {plan.items.length === 0 ? (
            <div className="mt-10 text-center text-gray-500">
              <div className="text-4xl">✅</div>
              <p className="mt-2 text-sm">今日やる分はありません!</p>
              {tasks.filter((t) => !t.done).length === 0 && (
                <p className="mt-1 text-xs">
                  「すべて」タブからMoodleと同期するか、タスクを追加してみましょう
                </p>
              )}
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {plan.items.map(({ task, minutes, crammed }) => (
                <li
                  key={task.id}
                  className="flex items-start gap-3 rounded-xl bg-white p-3 shadow-sm"
                >
                  <input
                    type="checkbox"
                    checked={task.done}
                    onChange={() => toggleDone(task.id)}
                    className="mt-1 h-5 w-5 accent-indigo-600"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-gray-800">{task.title}</span>
                      {task.source === 'moodle' && (
                        <span className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-700">
                          Moodle
                        </span>
                      )}
                    </div>
                    {task.course && <p className="truncate text-xs text-gray-500">{task.course}</p>}
                    {task.due && (
                      <p className={`text-xs ${dueColor(task.due)}`}>期限 {fmtDue(task.due)}</p>
                    )}
                    {crammed && (
                      <p className="text-xs text-red-600">⚠ 期限日に詰め込みが発生しています</p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700">
                    {fmtMinutes(minutes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </main>
      )}

      {tab === 'all' && (
        <AllTab
          tasks={tasks}
          setTasks={setTasks}
          syncing={syncing}
          onSync={handleSync}
          lastSyncedAt={settings.lastSyncedAt}
          toggleDone={toggleDone}
          removeTask={removeTask}
        />
      )}

      {tab === 'settings' && (
        <SettingsTab
          settings={settings}
          setSettings={setSettings}
          onSaved={() => flash('設定を保存しました')}
        />
      )}

      <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md border-t border-gray-200 bg-white">
        {(
          [
            ['today', '📅', '今日'],
            ['all', '📋', 'すべて'],
            ['settings', '⚙️', '設定'],
          ] as const
        ).map(([key, icon, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex flex-1 flex-col items-center py-2 text-xs ${
              tab === key ? 'font-bold text-indigo-600' : 'text-gray-400'
            }`}
          >
            <span className="text-lg">{icon}</span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}

function AllTab(props: {
  tasks: Task[]
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>
  syncing: boolean
  onSync: () => void
  lastSyncedAt?: string
  toggleDone: (id: string) => void
  removeTask: (id: string) => void
}) {
  const { tasks, setTasks, syncing, onSync, lastSyncedAt, toggleDone, removeTask } = props
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('23:59')
  const [estimate, setEstimate] = useState(60)
  const [showDone, setShowDone] = useState(false)

  const addTask = () => {
    if (!title.trim()) return
    const due = dueDate ? new Date(`${dueDate}T${dueTime || '23:59'}`).toISOString() : undefined
    setTasks((ts) => [
      ...ts,
      {
        id: `manual-${Date.now()}`,
        title: title.trim(),
        due,
        estimatedMinutes: estimate,
        done: false,
        source: 'manual',
        createdAt: new Date().toISOString(),
      },
    ])
    setTitle('')
    setDueDate('')
  }

  const active = tasks
    .filter((t) => !t.done)
    .sort((a, b) => {
      const ad = a.due ? new Date(a.due).getTime() : Infinity
      const bd = b.due ? new Date(b.due).getTime() : Infinity
      return ad - bd
    })
  const doneTasks = tasks.filter((t) => t.done)

  return (
    <main className="px-4 py-4">
      <div className="flex items-center justify-between">
        <button
          onClick={onSync}
          disabled={syncing}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {syncing ? '同期中…' : '🔄 Moodleと同期'}
        </button>
        {lastSyncedAt && (
          <span className="text-xs text-gray-400">最終同期 {fmtDue(lastSyncedAt)}</span>
        )}
      </div>

      <div className="mt-4 rounded-xl bg-white p-3 shadow-sm">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="タスクを追加(例: レポートの下調べ)"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-600"
          />
          <input
            type="time"
            value={dueTime}
            onChange={(e) => setDueTime(e.target.value)}
            className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-600"
          />
          <select
            value={estimate}
            onChange={(e) => setEstimate(Number(e.target.value))}
            className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-600"
          >
            {[30, 60, 90, 120, 180, 240].map((m) => (
              <option key={m} value={m}>
                {fmtMinutes(m)}
              </option>
            ))}
          </select>
          <button
            onClick={addTask}
            className="ml-auto rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white"
          >
            追加
          </button>
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {active.map((task) => (
          <li key={task.id} className="flex items-start gap-3 rounded-xl bg-white p-3 shadow-sm">
            <input
              type="checkbox"
              checked={task.done}
              onChange={() => toggleDone(task.id)}
              className="mt-1 h-5 w-5 accent-indigo-600"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-gray-800">{task.title}</span>
                {task.source === 'moodle' && (
                  <span className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-700">
                    Moodle
                  </span>
                )}
              </div>
              {task.course && <p className="truncate text-xs text-gray-500">{task.course}</p>}
              <p className="text-xs">
                {task.due ? (
                  <span className={dueColor(task.due)}>期限 {fmtDue(task.due)}</span>
                ) : (
                  <span className="text-gray-400">期限なし</span>
                )}
                <span className="ml-2 text-gray-400">見積 {fmtMinutes(task.estimatedMinutes)}</span>
              </p>
            </div>
            {task.source === 'manual' && (
              <button
                onClick={() => removeTask(task.id)}
                className="shrink-0 text-gray-300 hover:text-red-500"
                aria-label="削除"
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>

      {doneTasks.length > 0 && (
        <div className="mt-4">
          <button onClick={() => setShowDone(!showDone)} className="text-sm text-gray-500 underline">
            完了済み {doneTasks.length}件 {showDone ? 'を隠す' : 'を表示'}
          </button>
          {showDone && (
            <ul className="mt-2 space-y-2 opacity-60">
              {doneTasks.map((task) => (
                <li key={task.id} className="flex items-center gap-3 rounded-xl bg-white p-3">
                  <input
                    type="checkbox"
                    checked
                    onChange={() => toggleDone(task.id)}
                    className="h-5 w-5 accent-indigo-600"
                  />
                  <span className="truncate text-sm text-gray-500 line-through">{task.title}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  )
}

function SettingsTab(props: {
  settings: Settings
  setSettings: React.Dispatch<React.SetStateAction<Settings>>
  onSaved: () => void
}) {
  const { settings, setSettings, onSaved } = props
  const [url, setUrl] = useState(settings.moodleUrl)
  const [token, setToken] = useState(settings.moodleToken)
  const [minutes, setMinutes] = useState(settings.minutesPerDay)

  const save = () => {
    setSettings((s) => ({
      ...s,
      moodleUrl: url.trim(),
      moodleToken: token.trim(),
      minutesPerDay: minutes,
    }))
    onSaved()
  }

  return (
    <main className="px-4 py-4">
      <h2 className="text-base font-bold text-gray-800">設定</h2>

      <div className="mt-4 space-y-4 rounded-xl bg-white p-4 shadow-sm">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">MoodleのURL</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-gray-700">Moodleトークン</span>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="check_api_support.py で取得した値"
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-gray-400">
            トークンはこの端末のブラウザ内にだけ保存されます
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-gray-700">
            1日に課題へ使える時間: {fmtMinutes(minutes)}
          </span>
          <input
            type="range"
            min={30}
            max={360}
            step={30}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="mt-2 w-full accent-indigo-600"
          />
        </label>

        <button onClick={save} className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-bold text-white">
          保存
        </button>
      </div>
    </main>
  )
}
