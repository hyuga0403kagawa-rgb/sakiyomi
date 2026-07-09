import { useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Settings, Task, TimetableSlot } from './types'
import { DEFAULT_SETTINGS } from './types'
import { supabase } from './supabase'
import * as repo from './repo'
import { loadSettings as loadLocalSettings, loadTasks as loadLocalTasks } from './storage'
import { connectMoodle, syncMoodleViaServer } from './moodle'
import { buildTodayPlan } from './planner'
import { buildRecommendation } from './recommend'
import { WEEKDAY_JA, fmtMinutes, fmtTime } from './format'
import AuthScreen from './AuthScreen'
import TaskRow from './TaskRow'
import CalendarTab from './CalendarTab'
import MaterialsTab from './MaterialsTab'
import TimetableTab from './TimetableTab'
import ProfileForm from './ProfileForm'
import AvatarIcon from './AvatarIcon'
import { UNIVERSITIES } from './universities'

// calendar は下タブには出さないサブ画面(「すべて」の📅から開く)
type Tab = 'today' | 'timetable' | 'all' | 'calendar' | 'materials' | 'settings'
type TaskDraft = Omit<Task, 'id' | 'createdAt'>

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [recovery, setRecovery] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      // パスワード再設定メールのリンクから戻ってきた場合
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (!authReady) {
    return <div className="flex min-h-screen items-center justify-center text-gray-400">読み込み中…</div>
  }
  if (!session) return <AuthScreen />
  if (recovery) return <NewPasswordScreen onDone={() => setRecovery(false)} />
  return <Home key={session.user.id} />
}

function NewPasswordScreen(props: { onDone: () => void }) {
  const { onDone } = props
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    if (password.length < 6) {
      setError('パスワードは6文字以上にしてください')
      return
    }
    if (password !== confirm) {
      setError('2つのパスワードが一致しません')
      return
    }
    setBusy(true)
    setError('')
    const { error: err } = await supabase.auth.updateUser({ password })
    if (err) {
      setError(`変更に失敗しました: ${err.message}`)
      setBusy(false)
      return
    }
    onDone()
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center bg-gray-50 px-6">
      <h1 className="text-center text-xl font-bold text-indigo-600">新しいパスワードを設定</h1>
      <div className="mt-6 space-y-3 rounded-xl bg-white p-4 shadow-sm">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="新しいパスワード(6文字以上)"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          autoComplete="new-password"
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="もう一度入力"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          autoComplete="new-password"
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          onClick={save}
          disabled={busy}
          className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? '変更中…' : 'パスワードを変更する'}
        </button>
      </div>
    </div>
  )
}

function Home() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [slots, setSlots] = useState<TimetableSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('today')
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState('')
  const [needsProfile, setNeedsProfile] = useState(false)
  const initRan = useRef(false)

  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 4000)
  }

  const performSync = async (silent = false) => {
    setSyncing(true)
    try {
      await syncMoodleViaServer()
      const [fresh, freshSettings] = await Promise.all([repo.fetchTasks(), repo.fetchSettings()])
      setTasks(fresh)
      setSettings(freshSettings)
      if (!silent) {
        const count = fresh.filter((t) => t.source === 'moodle' && !t.done).length
        flash(`同期完了! 未提出の課題 ${count}件`)
      }
    } catch (e) {
      if (!silent) flash(e instanceof Error ? e.message : '同期に失敗しました')
    } finally {
      setSyncing(false)
    }
  }

  // 初回読み込み。localStorage時代のデータがあればクラウドへ移行し、
  // 前回の同期から時間が経っていればバックグラウンドで自動同期する。
  useEffect(() => {
    if (initRan.current) return
    initRan.current = true
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
        repo.fetchTimetable().then(setSlots).catch(() => {})

        // プロフィール未設定(新規ユーザー・既存ユーザーの初回)なら設定画面を先に出す
        if (!cloudSettings.nickname) {
          setNeedsProfile(true)
        }
        if (!cloudSettings.moodleToken) {
          setTab('settings')
          if (cloudSettings.nickname) flash('ようこそ!まず大学のMoodleと連携しましょう')
        } else {
          const last = cloudSettings.lastSyncedAt ? new Date(cloudSettings.lastSyncedAt).getTime() : 0
          if (Date.now() - last > 10 * 60 * 1000) void performSync(true)
        }
      } catch (e) {
        flash(e instanceof Error ? `読み込みに失敗しました: ${e.message}` : '読み込みに失敗しました')
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const plan = useMemo(
    () => buildTodayPlan(tasks, settings.minutesPerDay),
    [tasks, settings.minutesPerDay],
  )
  const recommendation = useMemo(() => buildRecommendation(tasks, plan), [tasks, plan])

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

  const editTask = async (updated: Task) => {
    setTasks((ts) => ts.map((t) => (t.id === updated.id ? updated : t)))
    try {
      await repo.updateTask(updated)
      flash('タスクを更新しました')
    } catch {
      flash('更新に失敗しました')
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

  const handleConnect = async (moodleUrl: string, username: string, password: string) => {
    await connectMoodle(moodleUrl, username, password)
    flash('✅ 連携しました!課題を取得しています…')
    await performSync()
    setTab('today')
  }

  const today = new Date()

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-gray-400">読み込み中…</div>
  }

  if (needsProfile) {
    return (
      <div className="mx-auto min-h-screen max-w-md bg-gray-50 px-6 py-8">
        <h1 className="text-center text-xl font-bold text-indigo-600">プロフィールを設定</h1>
        <p className="mt-1 text-center text-xs text-gray-500">
          あなたのことを少しだけ教えてください(あとで「その他」からいつでも変更できます)
        </p>
        {message && (
          <div className="mt-3 rounded-lg bg-indigo-100 px-3 py-2 text-sm text-indigo-800">
            {message}
          </div>
        )}
        <div className="mt-6 rounded-xl bg-white p-4 shadow-sm">
          <ProfileForm
            settings={settings}
            onFlash={flash}
            submitLabel="はじめる"
            onSave={async (s) => {
              await saveSettingsAll(s)
              setNeedsProfile(false)
              if (!s.moodleToken) {
                setTab('settings')
                flash('プロフィールを保存しました!次は大学のMoodleと連携しましょう')
              }
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto min-h-screen max-w-md bg-gray-50 pb-24">
      <header className="sticky top-0 z-10 bg-indigo-600 px-4 py-3 text-white shadow">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">
            UniPort
          </h1>
          <span className="text-[11px] opacity-80">
            {syncing
              ? '同期中…'
              : settings.lastSyncedAt
                ? `✓ 自動同期 ${fmtTime(settings.lastSyncedAt)}`
                : ''}
          </span>
        </div>
        <p className="text-xs opacity-80">課題を先読みして、今日やる分だけ教えてくれる</p>
      </header>

      {message && (
        <div className="mx-4 mt-3 rounded-lg bg-indigo-100 px-3 py-2 text-sm text-indigo-800">
          {message}
        </div>
      )}

      {settings.moodleToken &&
        settings.lastSyncedAt &&
        Date.now() - new Date(settings.lastSyncedAt).getTime() > 24 * 3600_000 && (
          <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            ⚠ 同期が24時間以上成功していません。設定画面からMoodleとの連携をやり直してください。
          </div>
        )}

      {tab === 'today' && (
        <main className="px-4 py-4">
          <div
            className={`rounded-xl p-3 ${
              recommendation.warning
                ? 'border border-red-200 bg-red-50'
                : 'border border-indigo-100 bg-indigo-50'
            }`}
          >
            <p className={`text-xs font-bold ${recommendation.warning ? 'text-red-500' : 'text-indigo-500'}`}>
              ✨ AIおすすめ
            </p>
            <p className={`mt-1 text-sm ${recommendation.warning ? 'text-red-700' : 'text-indigo-900'}`}>
              {recommendation.text}
            </p>
          </div>

          {(() => {
            // 今日の授業(day: 0=月〜5=土。日曜は表示なし)
            const jsDay = today.getDay()
            const todayIdx = jsDay === 0 ? -1 : jsDay - 1
            const todayClasses = slots
              .filter((s) => s.day === todayIdx)
              .sort((a, b) => a.period - b.period)
            if (todayClasses.length === 0) return null
            return (
              <button
                onClick={() => setTab('timetable')}
                className="mt-3 w-full rounded-xl bg-white p-3 text-left shadow-sm"
              >
                <p className="text-xs font-bold text-gray-500">🗓️ 今日の授業</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {todayClasses.map((s) => (
                    <span key={s.id} className="text-sm text-gray-800">
                      <span className="font-medium text-indigo-600">{s.period}限</span> {s.course}
                      {s.room && <span className="text-xs text-gray-400"> @{s.room}</span>}
                    </span>
                  ))}
                </div>
              </button>
            )
          })()}

          <h2 className="mt-4 text-base font-bold text-gray-800">
            {today.getMonth() + 1}月{today.getDate()}日({WEEKDAY_JA[today.getDay()]}) 今日やること
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            合計 {fmtMinutes(plan.totalMinutes)} / 上限 {fmtMinutes(settings.minutesPerDay)}
          </p>

          {plan.items.length === 0 ? (
            <div className="mt-10 text-center text-gray-500">
              <div className="text-4xl">✅</div>
              <p className="mt-2 text-sm">今日やる分はありません!</p>
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {plan.items.map(({ task, minutes, crammed }) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  minutes={minutes}
                  crammed={crammed}
                  onToggle={toggleDone}
                />
              ))}
            </ul>
          )}
        </main>
      )}

      {tab === 'timetable' && (
        <TimetableTab
          tasks={tasks}
          slots={slots}
          onSlotsChange={setSlots}
          onToggle={toggleDone}
          onFlash={flash}
        />
      )}

      {tab === 'all' && (
        <AllTab
          tasks={tasks}
          onAdd={addTask}
          onEdit={editTask}
          syncing={syncing}
          onSync={() => performSync()}
          lastSyncedAt={settings.lastSyncedAt}
          toggleDone={toggleDone}
          removeTask={removeTask}
          onOpenCalendar={() => setTab('calendar')}
        />
      )}

      {tab === 'calendar' && (
        <CalendarTab tasks={tasks} onToggle={toggleDone} onBack={() => setTab('all')} />
      )}

      {tab === 'materials' && <MaterialsTab />}

      {tab === 'settings' && (
        <SettingsTab
          settings={settings}
          onSave={saveSettingsAll}
          onFlash={flash}
          onConnect={handleConnect}
        />
      )}

      <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md border-t border-gray-200 bg-white">
        {(
          [
            ['today', '🏠', '今日'],
            ['timetable', '🗓️', '時間割'],
            ['all', '📋', 'すべて'],
            ['materials', '📚', '資料'],
            ['settings', '⚙️', 'その他'],
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
  onEdit: (task: Task) => void
  syncing: boolean
  onSync: () => void
  lastSyncedAt?: string
  toggleDone: (id: string) => void
  removeTask: (id: string) => void
  onOpenCalendar: () => void
}) {
  const { tasks, onAdd, onEdit, syncing, onSync, lastSyncedAt, toggleDone, removeTask, onOpenCalendar } = props
  const [view, setView] = useState<'all' | 'course'>('all')
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('23:59')
  const [estimate, setEstimate] = useState(60)
  const [showDone, setShowDone] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editTime, setEditTime] = useState('23:59')
  const [editEstimate, setEditEstimate] = useState(60)

  const startEdit = (task: Task) => {
    setEditing(task)
    setEditTitle(task.title)
    if (task.due) {
      const d = new Date(task.due)
      setEditDate(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      )
      setEditTime(
        `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      )
    } else {
      setEditDate('')
      setEditTime('23:59')
    }
    setEditEstimate(task.estimatedMinutes)
  }

  const saveEdit = () => {
    if (!editing) return
    const isManual = editing.source === 'manual'
    onEdit({
      ...editing,
      title: isManual && editTitle.trim() ? editTitle.trim() : editing.title,
      due: isManual
        ? editDate
          ? new Date(`${editDate}T${editTime || '23:59'}`).toISOString()
          : undefined
        : editing.due,
      estimatedMinutes: editEstimate,
    })
    setEditing(null)
  }

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

  const byCourse = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of active) {
      const key = t.course ?? 'その他'
      m.set(key, [...(m.get(key) ?? []), t])
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ja'))
  }, [active])

  return (
    <main className="px-4 py-4">
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>{lastSyncedAt ? `✓ 自動同期 · 最終更新 ${fmtTime(lastSyncedAt)}` : 'まだ同期していません'}</span>
        <span className="flex items-center gap-1">
          <button
            onClick={onOpenCalendar}
            aria-label="カレンダー表示"
            className="rounded-lg px-2 py-1 hover:bg-gray-100"
          >
            📅
          </button>
          <button
            onClick={onSync}
            disabled={syncing}
            aria-label="今すぐ同期"
            className="rounded-lg px-2 py-1 hover:bg-gray-100 disabled:opacity-50"
          >
            {syncing ? '同期中…' : '🔄'}
          </button>
        </span>
      </div>

      {editing && (
        <div className="mt-3 rounded-xl border border-indigo-200 bg-white p-3 shadow-sm">
          <h3 className="text-sm font-bold text-gray-800">タスクを編集</h3>
          {editing.source === 'manual' ? (
            <>
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-600"
                />
                <input
                  type="time"
                  value={editTime}
                  onChange={(e) => setEditTime(e.target.value)}
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-600"
                />
              </div>
            </>
          ) : (
            <p className="mt-1 text-xs text-gray-400">
              Moodleの課題のため、名前と期限は変更できません(見積もり時間のみ変更可)
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs text-gray-500">見積もり</span>
            <select
              value={editEstimate}
              onChange={(e) => setEditEstimate(Number(e.target.value))}
              className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-600"
            >
              {[15, 30, 60, 90, 120, 180, 240, 300].map((m) => (
                <option key={m} value={m}>
                  {fmtMinutes(m)}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setEditing(null)}
              className="flex-1 rounded-lg border border-gray-200 py-2 text-sm text-gray-500"
            >
              キャンセル
            </button>
            <button
              onClick={saveEdit}
              className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-bold text-white"
            >
              保存
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 flex rounded-lg bg-gray-100 p-0.5 text-sm">
        {(
          [
            ['all', 'すべて'],
            ['course', '講義ごと'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`flex-1 rounded-md py-1.5 ${
              view === key ? 'bg-white font-medium text-indigo-600 shadow-sm' : 'text-gray-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 rounded-xl bg-white p-3 shadow-sm">
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

      {view === 'all' ? (
        <ul className="mt-4 space-y-2">
          {active.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onToggle={toggleDone}
              onRemove={removeTask}
              onEdit={startEdit}
            />
          ))}
        </ul>
      ) : (
        byCourse.map(([course, list]) => (
          <div key={course} className="mt-4">
            <h3 className="mb-2 text-sm font-bold text-gray-700">
              {course} <span className="ml-1 text-xs font-normal text-gray-400">{list.length}件</span>
            </h3>
            <ul className="space-y-2">
              {list.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={toggleDone}
                  onRemove={removeTask}
                  onEdit={startEdit}
                  showCourse={false}
                />
              ))}
            </ul>
          </div>
        ))
      )}

      {active.length === 0 && (
        <p className="mt-6 text-center text-sm text-gray-400">未提出の課題はありません 🎉</p>
      )}

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

function MoodleConnectCard(props: {
  settings: Settings
  onConnect: (moodleUrl: string, username: string, password: string) => Promise<void>
  onSave: (s: Settings) => void
}) {
  const { settings, onConnect, onSave } = props
  const connected = Boolean(settings.moodleToken)
  const [showForm, setShowForm] = useState(!connected)
  const [univ, setUniv] = useState(UNIVERSITIES[0].url)
  const [customUrl, setCustomUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const connect = async () => {
    const moodleUrl = univ === 'custom' ? customUrl.trim() : univ
    if (!moodleUrl || !username.trim() || !password) {
      setMessage('大学・ID・パスワードをすべて入力してください')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      await onConnect(moodleUrl, username.trim(), password)
      setPassword('')
      setShowForm(false)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '連携に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-800">大学のMoodleと連携</h3>
        {connected && (
          <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            ✅ 連携済み
          </span>
        )}
      </div>

      {connected && !showForm && (
        <button onClick={() => setShowForm(true)} className="mt-3 text-sm text-indigo-600 underline">
          連携をやり直す
        </button>
      )}

      {showForm && (
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">大学</span>
            <select
              value={univ}
              onChange={(e) => setUniv(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              {UNIVERSITIES.map((u) => (
                <option key={u.url} value={u.url}>
                  {u.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-gray-400">
              ※SSO(学認・Microsoftログイン等)専用の大学では連携できない場合があります
            </span>
          </label>

          {univ === 'custom' && (
            <label className="block">
              <span className="text-sm font-medium text-gray-700">MoodleのURL</span>
              <input
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="https://moodle.example-u.ac.jp"
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </label>
          )}

          <label className="block">
            <span className="text-sm font-medium text-gray-700">MoodleのID</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Moodleのパスワード</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <span className="mt-1 block text-xs text-gray-400">
              パスワードは保存されません。Moodle公式アプリと同じ仕組みで「合鍵(トークン)」に
              交換され、以後はトークンだけで同期します
            </span>
          </label>

          {message && <p className="text-xs text-red-600">{message}</p>}

          <button
            onClick={connect}
            disabled={busy}
            className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? '連携中…' : '🔗 連携する'}
          </button>

          <details className="text-xs text-gray-400">
            <summary className="cursor-pointer">上級者向け: トークンを直接登録する</summary>
            <div className="mt-2 flex gap-2">
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Webサービストークン"
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
              <button
                onClick={() => {
                  if (!token.trim()) return
                  const moodleUrl = univ === 'custom' ? customUrl.trim() : univ
                  onSave({
                    ...settings,
                    moodleUrl: moodleUrl || settings.moodleUrl,
                    moodleToken: token.trim(),
                  })
                  setToken('')
                  setShowForm(false)
                }}
                className="rounded-lg border border-indigo-600 px-3 py-2 text-sm font-medium text-indigo-600"
              >
                登録
              </button>
            </div>
          </details>
        </div>
      )}
    </div>
  )
}

const COMING_SOON = [
  ['💼', '就活サポート'],
  ['🏢', 'インターン・企業情報'],
  ['📝', 'ES・履歴書のAI添削'],
] as const

function SettingsTab(props: {
  settings: Settings
  onSave: (s: Settings) => void
  onFlash: (text: string) => void
  onConnect: (moodleUrl: string, username: string, password: string) => Promise<void>
}) {
  const { settings, onSave, onFlash, onConnect } = props
  const [minutes, setMinutes] = useState(settings.minutesPerDay)
  const [notifyTime, setNotifyTime] = useState(settings.notifyTime)
  const [enabling, setEnabling] = useState(false)

  const save = () =>
    onSave({
      ...settings,
      minutesPerDay: minutes,
      notifyTime,
    })

  const handleEnablePush = async () => {
    setEnabling(true)
    try {
      const { enablePush } = await import('./push')
      await enablePush()
      onFlash('✅ この端末で通知を受け取ります')
    } catch (e) {
      onFlash(e instanceof Error ? e.message : '通知の設定に失敗しました')
    } finally {
      setEnabling(false)
    }
  }

  const [deleting, setDeleting] = useState(false)
  const handleDeleteAccount = async () => {
    if (
      !window.confirm(
        'アカウントを削除すると、課題データ・設定・通知の登録がすべて完全に消去されます。この操作は取り消せません。削除しますか?',
      )
    )
      return
    if (!window.confirm('本当に削除してよろしいですか?(最終確認)')) return
    setDeleting(true)
    try {
      const { data, error } = await supabase.functions.invoke('delete-account', { body: {} })
      if (error || data?.error) throw new Error(data?.error ?? '削除に失敗しました')
      await supabase.auth.signOut()
    } catch (e) {
      onFlash(e instanceof Error ? e.message : '削除に失敗しました')
      setDeleting(false)
    }
  }

  const [editingProfile, setEditingProfile] = useState(false)

  return (
    <main className="px-4 py-4">
      <h2 className="text-base font-bold text-gray-800">その他</h2>

      <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <AvatarIcon avatar={settings.avatar} avatarUrl={settings.avatarUrl} size={52} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold text-gray-800">
              {settings.nickname ?? 'ニックネーム未設定'}
            </p>
            <p className="truncate text-xs text-gray-500">
              {[settings.university, settings.faculty, settings.department, settings.grade]
                .filter(Boolean)
                .join(' · ') || 'プロフィール未設定'}
            </p>
          </div>
          <button
            onClick={() => setEditingProfile(!editingProfile)}
            className="shrink-0 text-xs text-indigo-600 underline"
          >
            {editingProfile ? '閉じる' : '編集'}
          </button>
        </div>
        {editingProfile && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <ProfileForm
              settings={settings}
              onFlash={onFlash}
              onSave={async (s) => {
                await onSave(s)
                setEditingProfile(false)
              }}
            />
          </div>
        )}
      </div>

      <MoodleConnectCard settings={settings} onConnect={onConnect} onSave={onSave} />

      <div className="mt-4 space-y-4 rounded-xl bg-white p-4 shadow-sm">
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

        <label className="block">
          <span className="text-sm font-medium text-gray-700">通知時刻</span>
          <input
            type="time"
            value={notifyTime}
            onChange={(e) => setNotifyTime(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-gray-400">
            毎日この時刻に、未提出課題のまとめをプッシュ通知します
          </span>
        </label>

        <button onClick={save} className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-bold text-white">
          保存
        </button>
      </div>

      <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <button
          onClick={handleEnablePush}
          disabled={enabling}
          className="w-full rounded-lg border border-indigo-600 py-2 text-sm font-bold text-indigo-600 disabled:opacity-50"
        >
          🔔 この端末で通知を受け取る
        </button>
        <p className="mt-2 text-xs text-gray-400">
          iPhoneの場合は、先にSafariの共有ボタンから「ホーム画面に追加」し、
          ホーム画面のUniPortを開いてからこのボタンを押してください
        </p>
      </div>

      <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <h3 className="text-sm font-bold text-gray-800">🚀 近日公開</h3>
        <ul className="mt-2 space-y-2">
          {COMING_SOON.map(([icon, label]) => (
            <li key={label} className="flex items-center justify-between text-sm text-gray-400">
              <span>
                {icon} {label}
              </span>
              <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px]">準備中</span>
            </li>
          ))}
        </ul>
      </div>

      <button
        onClick={() => supabase.auth.signOut()}
        className="mt-6 w-full rounded-lg border border-gray-300 py-2 text-sm text-gray-500"
      >
        ログアウト
      </button>

      <button
        onClick={handleDeleteAccount}
        disabled={deleting}
        className="mt-3 w-full rounded-lg border border-red-200 py-2 text-sm text-red-400 disabled:opacity-50"
      >
        {deleting ? '削除中…' : 'アカウントを削除(全データ消去)'}
      </button>

      <p className="mt-4 text-center text-xs">
        <a href="privacy.html" target="_blank" rel="noopener" className="text-gray-400 underline">
          プライバシーポリシー
        </a>
      </p>
    </main>
  )
}
