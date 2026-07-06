import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Settings, Task } from './types'
import { DEFAULT_SETTINGS } from './types'
import { supabase } from './supabase'
import * as repo from './repo'
import { loadSettings as loadLocalSettings, loadTasks as loadLocalTasks } from './storage'
import { syncMoodleViaServer } from './moodle'
import { buildTodayPlan } from './planner'
import AuthScreen from './AuthScreen'

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
type TaskDraft = Omit<Task, 'id' | 'createdAt'>

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!authReady) {
    return <div className="flex min-h-screen items-center justify-center text-gray-400">読み込み中…</div>
  }
  if (!session) return <AuthScreen />
  return <Home key={session.user.id} />
}

function Home() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('today')
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState('')

  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 4000)
  }

  // 初回読み込み。クラウドが空でこの端末にlocalStorage時代のデータが残っていれば、
  // 一度だけクラウドへ引っ越す。
  useEffect(() => {
    ;(async () => {
      try {
        let [cloudTasks, cloudSettings] = await Promise.all([
          repo.fetchTasks(),
          repo.fetchSettings(),
        ])
        if (cloudTasks.length === 0) {
          const localTasks = loadLocalTasks()
          if (localTasks.length > 0) {
            for (const t of localTasks) await repo.insertTask(t)
            cloudTasks = await repo.fetchTasks()
            flash(`この端末のデータ ${localTasks.length}件をクラウドへ移行しました`)
          }
          const localSettings = loadLocalSettings()
          if (localSettings.moodleToken && !cloudSettings.moodleToken) {
            cloudSettings = { ...cloudSettings, ...localSettings }
            await repo.saveSettingsCloud(cloudSettings)
          }
        }
        setTasks(cloudTasks)
        setSettings(cloudSettings)
      } catch (e) {
        flash(e instanceof Error ? `読み込みに失敗しました: ${e.message}` : '読み込みに失敗しました')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const plan = useMemo(
    () => buildTodayPlan(tasks, settings.minutesPerDay),
    [tasks, settings.minutesPerDay],
  )

  const toggleDone = async (id: string) => {
    const t = tasks.find((x) => x.id === id)
    if (!t) return
    const updated = { ...t, done: !t.done }
    setTasks((ts) => ts.map((x) => (x.id === id ? updated : x)))
    try {
      await repo.updateTask(updated)
    } catch {
      flash('クラウドへの保存に失敗しました')
    }
  }

  const addTask = async (draft: TaskDraft) => {
    try {
      const created = await repo.insertTask(draft)
      setTasks((ts) => [...ts, created])
    } catch {
      flash('タスクの追加に失敗しました')
    }
  }

  const removeTask = async (id: string) => {
    setTasks((ts) => ts.filter((t) => t.id !== id))
    try {
      await repo.deleteTask(id)
    } catch {
      flash('削除に失敗しました')
    }
  }

  const saveSettingsAll = async (s: Settings) => {
    setSettings(s)
    try {
      await repo.saveSettingsCloud(s)
      flash('設定を保存しました')
    } catch {
      flash('設定の保存に失敗しました')
    }
  }

  const handleSync = async () => {
    if (!settings.moodleToken) {
      flash('先に設定画面でMoodleトークンを登録してください')
      setTab('settings')
      return
    }
    setSyncing(true)
    try {
      await syncMoodleViaServer()
      const [fresh, freshSettings] = await Promise.all([repo.fetchTasks(), repo.fetchSettings()])
      setTasks(fresh)
      setSettings(freshSettings)
      const count = fresh.filter((t) => t.source === 'moodle' && !t.done).length
      flash(`同期完了! 未提出の課題 ${count}件`)
    } catch (e) {
      flash(e instanceof Error ? e.message : '同期に失敗しました')
    } finally {
      setSyncing(false)
    }
  }

  const today = new Date()

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-gray-400">読み込み中…</div>
  }

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
          onAdd={addTask}
          syncing={syncing}
          onSync={handleSync}
          lastSyncedAt={settings.lastSyncedAt}
          toggleDone={toggleDone}
          removeTask={removeTask}
        />
      )}

      {tab === 'settings' && <SettingsTab settings={settings} onSave={saveSettingsAll} />}

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
  onAdd: (draft: TaskDraft) => void
  syncing: boolean
  onSync: () => void
  lastSyncedAt?: string
  toggleDone: (id: string) => void
  removeTask: (id: string) => void
}) {
  const { tasks, onAdd, syncing, onSync, lastSyncedAt, toggleDone, removeTask } = props
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('23:59')
  const [estimate, setEstimate] = useState(60)
  const [showDone, setShowDone] = useState(false)

  const addTask = () => {
    if (!title.trim()) return
    const due = dueDate ? new Date(`${dueDate}T${dueTime || '23:59'}`).toISOString() : undefined
    onAdd({
      title: title.trim(),
      due,
      estimatedMinutes: estimate,
      done: false,
      source: 'manual',
    })
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

function SettingsTab(props: { settings: Settings; onSave: (s: Settings) => void }) {
  const { settings, onSave } = props
  const [url, setUrl] = useState(settings.moodleUrl)
  const [token, setToken] = useState(settings.moodleToken)
  const [minutes, setMinutes] = useState(settings.minutesPerDay)

  const save = () =>
    onSave({
      ...settings,
      moodleUrl: url.trim(),
      moodleToken: token.trim(),
      minutesPerDay: minutes,
    })

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
            トークンはあなた専用のクラウドDBに保存され、課題の自動同期に使われます
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

      <button
        onClick={() => supabase.auth.signOut()}
        className="mt-6 w-full rounded-lg border border-gray-300 py-2 text-sm text-gray-500"
      >
        ログアウト
      </button>
    </main>
  )
}
