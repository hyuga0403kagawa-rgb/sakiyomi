import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  Bell,
  Briefcase,
  Calendar,
  CalendarDays,
  Check,
  Copy,
  CheckCircle2,
  ChevronDown,
  CircleUser,
  ClipboardList,
  Crown,
  ExternalLink,
  FileText,
  Home as HomeIcon,
  ListTodo,
  Mail,
  RefreshCw,
  Settings as SettingsIcon,
  Smartphone,
  Sparkles,
} from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import type { Company, JobEntry, Settings, Task, TimetableSlot } from './types'
import { DEFAULT_SETTINGS } from './types'
import { supabase } from './supabase'
import { isDemo } from './demo'
import * as repo from './repo'
import {
  forgetLegacyMoodleToken,
  loadSettings as loadLocalSettings,
  loadTasks as loadLocalTasks,
} from './storage'
import { connectMoodle, registerMoodleToken, syncMoodleViaServer } from './moodle'
import { buildTodayPlan } from './planner'
import { buildRecommendation } from './recommend'
import { defaultSemester } from './semester'
import { WEEKDAY_JA, fmtMinutes, fmtTime } from './format'
import AuthScreen from './AuthScreen'
import TaskRow from './TaskRow'
import CalendarTab from './CalendarTab'
import TimetableTab from './TimetableTab'
import JobTab from './JobTab'
import ProfileForm from './ProfileForm'
import AvatarIcon from './AvatarIcon'
import WidgetPreview from './WidgetPreview'
import GradesScreen from './GradesScreen'
import SponsorSplash from './SponsorSplash'
import {
  consumeFromPushFlag,
  isUpperGrade,
  markOpenSponsorShown,
  openSponsorShownToday,
  pickTodaysSponsor,
} from './sponsor'
import { UNIVERSITIES } from './universities'
import { JOB_LOOKAHEAD_DAYS, fmtJobDate, jobCountdown, upcomingJobEntries } from './jobDeadlines'

// calendar は下タブには出さないサブ画面(「すべて」の📅から開く)
// 講義資料は時間割→講義詳細に統合済み(旧・資料タブは就活タブに置き換え)
type Tab = 'today' | 'timetable' | 'all' | 'calendar' | 'job' | 'settings'
type TaskDraft = Omit<Task, 'id' | 'createdAt'>

// 香川大学生向けのポータルリンク
const ICOMPASS_URL = 'https://attendsyst.kagawa-u.ac.jp/mobile/g/'
const KADASAPO_URL = 'https://kyoumusyst.kagawa-u.ac.jp/campusweb/top.do'

/** 香川大生かどうか。moodleUrl はデフォルト値が香川大なので、香川Moodleに
 *  連携済み、またはプロフィールの大学が香川、で判定する */
function isKagawaStudent(s: Settings): boolean {
  return Boolean(
    (s.moodleConnected && s.moodleUrl?.includes('kagawa-u.ac.jp')) || s.university?.includes('香川'),
  )
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [recovery, setRecovery] = useState(false)

  useEffect(() => {
    if (isDemo()) return // デモモードではログイン状態を見に行かない
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

  // デモモード(QRコードから ?demo=1)は、ログインなしで見学用データを表示する
  if (isDemo()) return <Home key="demo" />
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
      <h1 className="text-center text-xl font-semibold text-primary">新しいパスワードを設定</h1>
      <div className="mt-6 space-y-3 rounded-lg border border-gray-200 bg-white p-4">
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
          className="w-full rounded-lg bg-primary py-2 text-sm font-semibold text-white disabled:opacity-50"
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
  // 初回の案内ステップ。'profile'→'moodle'→null(通常画面)の順に進む
  const [onboardStep, setOnboardStep] = useState<null | 'profile' | 'moodle'>(null)
  // 「時間割」タブを押すたびに増やし、TimetableTab の追加画面等を閉じさせる
  const [timetableReset, setTimetableReset] = useState(0)
  // 開いた最初に出す協賛企業(出さないときは null)
  const [sponsor, setSponsor] = useState<Company | null>(null)
  const initRan = useRef(false)

  // 開いた最初の協賛企業。ルールは sponsor.ts(3年生以上・1日1回・日替わり)。
  // 通知から開いたときは呼ばない。条件に合わなければ何も出さない
  const maybeShowSponsor = async (s: Settings) => {
    if (isDemo() || !isUpperGrade(s.grade) || openSponsorShownToday()) return
    try {
      const pick = pickTodaysSponsor(await repo.fetchCompanies())
      if (!pick) return
      markOpenSponsorShown()
      setSponsor(pick)
    } catch {
      // 協賛の取得に失敗しても、アプリ本体の動作は止めない
    }
  }

  const flash = (text: string) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 4000)
  }

  const performSync = async (silent = false) => {
    if (isDemo()) {
      if (!silent) flash('デモでは同期できません（表示中のデータは見学用のサンプルです）')
      return
    }
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
    // 通知をタップして開いたか(締切に追われている場面なので協賛は出さない)
    const openedFromPush = consumeFromPushFlag()
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
          // 旧版が端末に保存していた合鍵は、サーバー経由で暗号化して登録する(アプリ側には持たない)
          const localSettings = loadLocalSettings()
          if (localSettings.moodleToken && !cloudSettings.moodleConnected) {
            try {
              await registerMoodleToken(localSettings.moodleUrl, localSettings.moodleToken)
              cloudSettings = await repo.fetchSettings()
            } catch {
              // 使えない古い合鍵なら、連携の案内からやり直してもらう
            }
          }
        }
        forgetLegacyMoodleToken()
        setTasks(cloudTasks)
        setSettings(cloudSettings)
        repo.fetchTimetable().then(setSlots).catch(() => {})

        // 初回案内: プロフィール未設定ならプロフィールから、設定済みでMoodle未連携なら
        // 連携案内から順に出す。両方済みなら通常どおり自動同期する。
        if (!cloudSettings.nickname) {
          setOnboardStep('profile')
        } else if (!cloudSettings.moodleConnected) {
          setOnboardStep('moodle')
        } else {
          const last = cloudSettings.lastSyncedAt ? new Date(cloudSettings.lastSyncedAt).getTime() : 0
          if (Date.now() - last > 10 * 60 * 1000) void performSync(true)
          if (!openedFromPush) void maybeShowSponsor(cloudSettings)
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

  // 就活の予定。「今日」タブを開くたびに取り直す(就活タブで追加・完了した分を反映するため)
  const [jobEntries, setJobEntries] = useState<JobEntry[]>([])
  useEffect(() => {
    if (tab !== 'today') return
    repo.fetchJobEntries().then(setJobEntries).catch(() => {})
  }, [tab])
  const upcomingJobs = useMemo(() => upcomingJobEntries(jobEntries), [jobEntries])

  const toggleJobDone = async (id: string) => {
    const e = jobEntries.find((x) => x.id === id)
    if (!e) return
    // 新しい値は先に確定させる。デモではデータの実体を共有しているため、
    // 保存処理が先に e.done を書き換えると、更新関数の中で !x.done が逆向きになる
    const next = !e.done
    setJobEntries((es) => es.map((x) => (x.id === id ? { ...x, done: next } : x)))
    try {
      await repo.updateJobEntryDone(id, next)
    } catch {
      setJobEntries((es) => es.map((x) => (x.id === id ? { ...x, done: !next } : x)))
      flash('クラウドへの保存に失敗しました')
    }
  }

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

  // 学期切替・表示曜日の変更用(トーストを出さずに静かに保存する)
  const saveSettingsQuiet = async (s: Settings) => {
    setSettings(s)
    try {
      await repo.saveSettingsCloud(s)
    } catch {
      flash('設定の保存に失敗しました')
    }
  }

  const afterMoodleConnected = async () => {
    setOnboardStep(null) // 初回案内の途中なら通常画面へ抜ける
    flash('連携しました。課題を取得しています…')
    await performSync() // 同期のあと設定を取り直すので、「連携済み」もここで反映される
    setTab('today')
  }

  const handleConnect = async (moodleUrl: string, username: string, password: string) => {
    await connectMoodle(moodleUrl, username, password)
    await afterMoodleConnected()
  }

  // 上級者向けのトークン直接登録も、サーバーで確かめて暗号化してから保存する
  const handleRegisterToken = async (moodleUrl: string, token: string) => {
    await registerMoodleToken(moodleUrl, token)
    await afterMoodleConnected()
  }

  const today = new Date()

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-gray-400">読み込み中…</div>
  }

  if (onboardStep === 'profile') {
    return (
      <div className="mx-auto min-h-screen max-w-md bg-white px-6 py-8">
        <p className="text-center text-xs font-semibold text-primary">ステップ 1 / 2</p>
        <h1 className="mt-1 text-center text-xl font-semibold text-primary">プロフィールを設定</h1>
        <p className="mt-1 text-center text-xs text-gray-500">
          あなたのことを少しだけ教えてください(あとで「マイページ」からいつでも変更できます)
        </p>
        {message && (
          <div className="mt-3 rounded-lg bg-primary-soft px-3 py-2 text-sm text-primary-dark">
            {message}
          </div>
        )}
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
          <ProfileForm
            settings={settings}
            onFlash={flash}
            submitLabel="次へ進む"
            onSave={async (s) => {
              await saveSettingsAll(s)
              if (!s.moodleConnected) {
                setOnboardStep('moodle')
              } else {
                setOnboardStep(null)
              }
            }}
          />
        </div>
      </div>
    )
  }

  if (onboardStep === 'moodle') {
    return (
      <div className="mx-auto min-h-screen max-w-md bg-white px-6 py-8">
        <p className="text-center text-xs font-semibold text-primary">ステップ 2 / 2</p>
        <h1 className="mt-1 text-center text-xl font-semibold text-primary">課題を自動で読み込む</h1>
        <p className="mt-1 text-center text-xs text-gray-500">
          大学のMoodleにログインするIDとパスワードを入れるだけ。
          <br />
          パスワードは保存されないので安心してください。
        </p>
        {message && (
          <div className="mt-3 rounded-lg bg-primary-soft px-3 py-2 text-sm text-primary-dark">
            {message}
          </div>
        )}
        <MoodleConnectCard settings={settings} onConnect={handleConnect} onRegisterToken={handleRegisterToken} />
        <button
          onClick={() => {
            setOnboardStep(null)
            flash('あとで「マイページ」タブからいつでも連携できます')
          }}
          className="mt-4 w-full py-2 text-xs text-gray-500 underline"
        >
          あとで設定する(スキップ)
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto min-h-screen max-w-md bg-white pb-[calc(6.5rem_+_env(safe-area-inset-bottom))]">
      {sponsor && (
        <SponsorSplash
          company={sponsor}
          onClose={() => setSponsor(null)}
          onOpenJobTab={() => {
            setSponsor(null)
            setTab('job')
          }}
        />
      )}
      {isDemo() && (
        <div className="bg-amber-100 px-4 py-2 text-center text-xs font-medium text-amber-900">
          デモモード — 見学用のサンプルデータです。自由に触っても実際のデータには影響しません
        </div>
      )}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <h1 className="text-lg font-semibold tracking-tight text-gray-900">UniPort</h1>
        <span className="flex items-center gap-1 text-[11px] text-gray-400">
          {syncing && <RefreshCw className="h-3 w-3 animate-spin" />}
          {syncing
            ? '同期中…'
            : settings.lastSyncedAt
              ? `自動同期 ${fmtTime(settings.lastSyncedAt)}`
              : ''}
        </span>
      </header>

      {message && (
        <div className="mx-4 mt-3 rounded-lg bg-gray-900 px-3 py-2 text-sm text-white">
          {message}
        </div>
      )}

      {settings.moodleConnected &&
        settings.lastSyncedAt &&
        Date.now() - new Date(settings.lastSyncedAt).getTime() > 24 * 3600_000 && (
          <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            同期が24時間以上成功していません。設定画面からMoodleとの連携をやり直してください。
          </div>
        )}

      {tab === 'today' && (
        <main className="px-4 py-4">
          <div
            className={`rounded-lg border p-3 ${
              recommendation.warning ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'
            }`}
          >
            <p
              className={`flex items-center gap-1.5 text-xs font-semibold ${
                recommendation.warning ? 'text-red-600' : 'text-amber-700'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              AIおすすめ
            </p>
            <p className={`mt-1 text-sm ${recommendation.warning ? 'text-red-700' : 'text-gray-800'}`}>
              {recommendation.text}
            </p>
          </div>

          {isKagawaStudent(settings) && (
            <a
              href={ICOMPASS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-3"
            >
              <Smartphone className="h-5 w-5 text-gray-400" />
              <span className="flex-1">
                <span className="block text-sm font-medium text-gray-800">iCompass</span>
                <span className="block text-xs text-gray-400">出席の登録・確認(香川大学)</span>
              </span>
              <ExternalLink className="h-4 w-4 text-gray-300" />
            </a>
          )}

          {(() => {
            // 今日の授業(day: 0=月〜5=土, 7=日)。現在の学期のコマのみ表示
            const jsDay = today.getDay()
            const todayIdx = jsDay === 0 ? 7 : jsDay - 1
            const curSemester = settings.currentSemester ?? defaultSemester()
            const todayClasses = slots
              .filter((s) => s.day === todayIdx && s.semester === curSemester)
              .sort((a, b) => a.period - b.period)
            if (todayClasses.length === 0) return null
            return (
              <button
                onClick={() => setTab('timetable')}
                className="mt-3 w-full rounded-lg border border-gray-200 bg-white p-3 text-left"
              >
                <p className="text-xs font-semibold text-gray-500">今日の授業</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {todayClasses.map((s) => (
                    <span key={s.id} className="text-sm text-gray-800">
                      <span className="font-medium text-primary">{s.period}限</span> {s.course}
                      {s.room && <span className="text-xs text-gray-400"> @{s.room}</span>}
                    </span>
                  ))}
                </div>
              </button>
            )
          })()}

          <h2 className="mt-4 text-base font-semibold text-gray-800">
            {today.getMonth() + 1}月{today.getDate()}日({WEEKDAY_JA[today.getDay()]}) 今日やること
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            合計 {fmtMinutes(plan.totalMinutes)} / 上限 {fmtMinutes(settings.minutesPerDay)}
          </p>

          {plan.items.length === 0 ? (
            <div className="mt-10 flex flex-col items-center text-center text-gray-500">
              <CheckCircle2 className="h-10 w-10 text-amber-400" />
              <p className="mt-2 text-sm">今日やる分はありません</p>
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

          {/* 就活の予定(期限が今日〜3日後のもの)。課題と同じく締切を落とさせないため */}
          {upcomingJobs.length > 0 && (
            <>
              <h3 className="mt-5 flex items-center gap-1.5 text-sm font-semibold text-gray-700">
                <Briefcase className="h-4 w-4 text-gray-400" />
                就活の予定({JOB_LOOKAHEAD_DAYS}日以内)
              </h3>
              <ul className="mt-2 space-y-2">
                {upcomingJobs.map((e) => {
                  const cd = jobCountdown(e.deadline!)
                  return (
                    <li key={e.id} className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3">
                      <input
                        type="checkbox"
                        checked={e.done}
                        onChange={() => toggleJobDone(e.id)}
                        aria-label={`${e.company} ${e.entryType} を完了にする`}
                        className="mt-1 h-5 w-5 accent-primary"
                      />
                      <button onClick={() => setTab('job')} className="min-w-0 flex-1 text-left">
                        <p className="truncate text-xs text-gray-500">{e.entryType}</p>
                        <span className="block truncate font-medium text-gray-900">{e.company}</span>
                        <p className="mt-0.5 flex items-center gap-x-2 text-xs">
                          <span className={cd.color}>{fmtJobDate(e.deadline!)}</span>
                          <span className={`font-medium ${cd.color}`}>{cd.label}</span>
                        </p>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
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
          settings={settings}
          onSaveSettings={saveSettingsQuiet}
          resetSignal={timetableReset}
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

      {tab === 'job' && <JobTab onFlash={flash} />}

      {tab === 'settings' && (
        <SettingsTab
          settings={settings}
          onSave={saveSettingsAll}
          onFlash={flash}
          onConnect={handleConnect}
          onRegisterToken={handleRegisterToken}
          tasks={tasks}
          slots={slots}
          onToggle={toggleDone}
        />
      )}

      {/* iPhoneのホームバーと重ならないよう、下端の安全領域ぶん余白を取る
          (viewport-fit=cover なので、取らないとタブがホームバーの上に乗って押しづらい) */}
      <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]">
        {(
          [
            ['today', HomeIcon, '今日'],
            ['timetable', CalendarDays, '時間割'],
            ['all', ListTodo, 'すべて'],
            ['job', Briefcase, '就活'],
            ['settings', CircleUser, 'マイページ'],
          ] as const
        ).map(([key, Icon, label]) => (
          <button
            key={key}
            onClick={() => {
              setTab(key)
              if (key === 'timetable') setTimetableReset((n) => n + 1)
            }}
            className={`flex flex-1 flex-col items-center gap-1 pt-2.5 pb-2 text-xs ${
              tab === key ? 'font-medium text-primary' : 'text-gray-400'
            }`}
          >
            <Icon className="h-6 w-6" strokeWidth={tab === key ? 2.2 : 1.8} />
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
        <span>{lastSyncedAt ? `自動同期 · 最終更新 ${fmtTime(lastSyncedAt)}` : 'まだ同期していません'}</span>
        <span className="flex items-center gap-1">
          <button
            onClick={onOpenCalendar}
            aria-label="カレンダー表示"
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
          >
            <Calendar className="h-4 w-4" />
          </button>
          <button
            onClick={onSync}
            disabled={syncing}
            aria-label="今すぐ同期"
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          </button>
        </span>
      </div>

      {editing && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
          <h3 className="text-sm font-semibold text-gray-800">タスクを編集</h3>
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
              className="flex-1 rounded-lg bg-primary py-2 text-sm font-semibold text-white"
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
              view === key ? 'bg-white font-medium text-primary' : 'text-gray-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="タスクを追加(例: レポートの下調べ)"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none"
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
            className="ml-auto rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white"
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
            <h3 className="mb-2 text-sm font-semibold text-gray-700">
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
        <p className="mt-6 text-center text-sm text-gray-400">未提出の課題はありません</p>
      )}

      {doneTasks.length > 0 && (
        <div className="mt-4">
          <button onClick={() => setShowDone(!showDone)} className="text-sm text-gray-500 underline">
            完了済み {doneTasks.length}件 {showDone ? 'を隠す' : 'を表示'}
          </button>
          {showDone && (
            <ul className="mt-2 space-y-2 opacity-70">
              {doneTasks.map((task) => (
                <li key={task.id} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
                  <input
                    type="checkbox"
                    checked
                    onChange={() => toggleDone(task.id)}
                    className="h-5 w-5 shrink-0 accent-primary"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-gray-500 line-through">
                      {task.title}
                    </span>
                    {task.course && (
                      <span className="block truncate text-xs text-gray-400">{task.course}</span>
                    )}
                  </span>
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
  onRegisterToken: (moodleUrl: string, token: string) => Promise<void>
}) {
  const { settings, onConnect, onRegisterToken } = props
  const connected = Boolean(settings.moodleConnected)
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
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">大学のMoodleと連携</h3>
        {connected && (
          <span className="flex items-center gap-1 rounded bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
            <Check className="h-3 w-3" />
            連携済み
          </span>
        )}
      </div>

      {connected && !showForm && (
        <button onClick={() => setShowForm(true)} className="mt-3 text-sm text-primary underline">
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
            <span className="mt-1 block text-xs text-gray-500">
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
            <span className="mt-1 block text-xs text-gray-500">
              パスワードは保存されません。Moodle公式アプリと同じ仕組みで「合鍵(トークン)」に
              交換され、以後はトークンだけで同期します
            </span>
          </label>

          {message && <p className="text-xs text-red-600">{message}</p>}

          <button
            onClick={connect}
            disabled={busy}
            className="w-full rounded-lg bg-primary py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? '連携中…' : '連携する'}
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
                onClick={async () => {
                  if (!token.trim()) return
                  const moodleUrl = (univ === 'custom' ? customUrl.trim() : univ) || settings.moodleUrl
                  setBusy(true)
                  setMessage('')
                  try {
                    // サーバーがMoodleに問い合わせて使えることを確かめ、暗号化して保存する
                    await onRegisterToken(moodleUrl, token.trim())
                    setToken('')
                    setShowForm(false)
                  } catch (e) {
                    setMessage(e instanceof Error ? e.message : '登録に失敗しました')
                  } finally {
                    setBusy(false)
                  }
                }}
                disabled={busy}
                className="rounded-lg border border-primary px-3 py-2 text-sm font-medium text-primary disabled:opacity-50"
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

// 「近日公開」には、まだ実際に提供していない機能だけを載せる。
// (就活サポート・企業情報は既に「就活」タブで提供中なのでここには出さない)
const COMING_SOON = ['AI就活相談・ES添削', 'ホーム画面ウィジェット(アプリ版)'] as const

/** マイページ内の折りたたみセクション(規約・設定など) */
function CollapsibleSection(props: {
  icon: React.ReactNode
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? true)
  return (
    <div className="mt-5">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-1 py-1">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          {props.icon}
          {props.title}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-gray-400 transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open && <div className="mt-2 rounded-lg border border-gray-200 bg-white p-4">{props.children}</div>}
    </div>
  )
}

/** カレンダー連携カード。ICS購読URLを発行してGoogle/iPhoneのカレンダーに登録してもらう */
/** カレンダーに含める種類の切り替え定義 */
const CALENDAR_KINDS = [
  { key: 'calendarTasks', label: '課題の締め切り', hint: 'レポート・提出物の期限' },
  { key: 'calendarExams', label: 'テストの日程', hint: 'Moodleの小テスト・試験' },
  { key: 'calendarTimetable', label: '時間割', hint: '毎週の授業(教室つき)' },
  { key: 'calendarJobs', label: '就活の予定', hint: '説明会・選考など' },
] as const satisfies readonly { key: keyof Settings; label: string; hint: string }[]

function CalendarFeedCard(props: {
  settings: Settings
  onSaveSettings: (s: Settings) => Promise<void> | void
  onFlash: (text: string) => void
}) {
  const { settings, onSaveSettings, onFlash } = props
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent)

  // 未設定(undefined)はオン扱い
  const isOn = (key: (typeof CALENDAR_KINDS)[number]['key']) => settings[key] !== false
  const toggle = (key: (typeof CALENDAR_KINDS)[number]['key']) => {
    void onSaveSettings({ ...settings, [key]: !isOn(key) })
  }

  const issue = async (regenerate = false) => {
    if (isDemo()) {
      onFlash('デモではカレンダー連携用URLの発行はできません')
      return
    }
    if (
      regenerate &&
      !window.confirm(
        'URLを再発行すると、いまカレンダーに登録済みのURLは無効になります(新しいURLで登録し直しが必要です)。再発行しますか?',
      )
    )
      return
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('calendar-feed', {
        body: { regenerate },
      })
      if (error || data?.error) throw new Error(data?.error ?? 'URLの発行に失敗しました')
      setUrl(data.url)
      if (regenerate) onFlash('新しいURLを発行しました(前のURLは無効です)')
    } catch (e) {
      onFlash(e instanceof Error ? e.message : 'URLの発行に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      onFlash('URLをコピーしました')
    } catch {
      onFlash('コピーできませんでした。URLを長押しで選択してコピーしてください')
    }
  }

  const webcalUrl = url ? url.replace(/^https:\/\//, 'webcal://') : null
  const googleAddUrl = webcalUrl
    ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`
    : null

  const primaryBtn =
    'block w-full rounded-lg bg-primary py-2.5 text-center text-sm font-semibold text-white'
  const secondaryBtn =
    'block w-full rounded-lg border border-gray-200 py-2.5 text-center text-sm font-medium text-gray-700'

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
        <Calendar className="h-4 w-4 text-gray-400" />
        カレンダー連携
      </h3>
      <p className="mt-1 text-xs text-gray-500">
        課題の提出期限・時間割・就活の予定を、Googleカレンダーや
        iPhoneの標準カレンダーに表示できます。ボタン1つ、スマホだけで登録できます。
      </p>
      {!url ? (
        <button
          onClick={() => issue(false)}
          disabled={busy}
          className="mt-3 w-full rounded-lg border border-primary py-2 text-sm font-semibold text-primary disabled:opacity-50"
        >
          {busy ? '発行中…' : '連携する'}
        </button>
      ) : (
        <div className="mt-3 space-y-2">
          {isIOS ? (
            <>
              <a href={webcalUrl!} className={primaryBtn}>
                📅 iPhoneのカレンダーに追加
              </a>
              <a href={googleAddUrl!} target="_blank" rel="noopener noreferrer" className={secondaryBtn}>
                Googleカレンダーに追加
              </a>
            </>
          ) : (
            <>
              <a href={googleAddUrl!} target="_blank" rel="noopener noreferrer" className={primaryBtn}>
                📅 Googleカレンダーに追加
              </a>
              <a href={webcalUrl!} className={secondaryBtn}>
                iPhoneのカレンダーに追加
              </a>
            </>
          )}
          <p className="text-[11px] text-gray-500">
            タップするとカレンダーアプリが開くので、「登録」または「追加」を選んでください。
          </p>

          <div className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
            <p className="text-xs font-semibold text-gray-700">カレンダーに表示するもの</p>
            <div className="mt-1.5 divide-y divide-gray-100">
              {CALENDAR_KINDS.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  role="switch"
                  aria-checked={isOn(k.key)}
                  onClick={() => toggle(k.key)}
                  className="flex w-full items-center gap-3 py-2 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium text-gray-800">{k.label}</span>
                    <span className="block text-[10px] text-gray-400">{k.hint}</span>
                  </span>
                  {/* トグルスイッチ。ノブの移動は left で行う(Tailwind v4 の translate は
                      transition と併用すると値が古いまま固まる)。任意値クラスは使わず
                      標準の間隔スケールだけで左右対称になる寸法にしている:
                      トラック 40px / ノブ 16px / 余白 4px */}
                  <span
                    className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${
                      isOn(k.key) ? 'bg-primary' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-[left] duration-200 ${
                        isOn(k.key) ? 'left-5' : 'left-1'
                      }`}
                    />
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-gray-400">
              切り替えは登録済みのカレンダーにも反映されます(URLの登録し直しは不要。
              反映まで数時間〜1日かかります)。
            </p>
          </div>
          <p className="text-[11px] text-gray-400">
            ※予定の反映はカレンダー側の仕様で数時間〜1日ほど遅れることがあります。
            時間割は学期の期間中、毎週表示されます(長期休み中も含む)。
            URLを知っている人はあなたの予定を見られるので、他人に共有しないでください。
          </p>

          <button
            onClick={() => setShowManual((v) => !v)}
            className="text-[11px] text-gray-400 underline"
          >
            {showManual ? '閉じる' : 'うまく開かない場合(URLを直接登録)'}
          </button>
          {showManual && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <input
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] text-gray-600"
                />
                <button
                  onClick={copy}
                  className="flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white"
                >
                  <Copy className="h-3.5 w-3.5" />
                  コピー
                </button>
              </div>
              <div className="rounded-lg bg-gray-50 p-2.5 text-xs leading-relaxed text-gray-600">
                <p className="font-semibold text-gray-700">登録のしかた(手動)</p>
                <p className="mt-1">
                  <span className="font-medium">Googleカレンダー:</span> 左の「他のカレンダー」の＋ →「URLで追加」にこのURLを貼り付け
                </p>
                <p className="mt-1">
                  <span className="font-medium">iPhoneカレンダー:</span> 設定 → カレンダー → アカウント → アカウントを追加 → その他 →「照会カレンダーを追加」にこのURLを貼り付け
                </p>
              </div>
            </div>
          )}

          <button
            onClick={() => issue(true)}
            disabled={busy}
            className="block text-[11px] text-gray-400 underline"
          >
            URLを再発行する(前のURLを無効化)
          </button>
        </div>
      )}
    </div>
  )
}

/** プロフィール編集の別画面(マイページの「プロフィール詳細」から遷移) */
function ProfileDetailScreen(props: {
  settings: Settings
  onFlash: (text: string) => void
  onSave: (s: Settings) => Promise<void> | void
  onBack: () => void
}) {
  const { settings, onFlash, onSave, onBack } = props
  return (
    <main className="px-4 py-4">
      <button onClick={onBack} className="text-sm text-primary underline">
        ← マイページに戻る
      </button>
      <h2 className="mt-3 text-base font-semibold text-gray-800">プロフィール詳細</h2>
      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
        <ProfileForm
          settings={settings}
          onFlash={onFlash}
          onSave={async (s) => {
            await onSave(s)
            onBack()
          }}
        />
      </div>
    </main>
  )
}

function SettingsTab(props: {
  settings: Settings
  onSave: (s: Settings) => void
  onFlash: (text: string) => void
  onConnect: (moodleUrl: string, username: string, password: string) => Promise<void>
  onRegisterToken: (moodleUrl: string, token: string) => Promise<void>
  tasks: Task[]
  slots: TimetableSlot[]
  onToggle: (id: string) => void
}) {
  const { settings, onSave, onFlash, onConnect, onRegisterToken, tasks, slots, onToggle } = props
  const [minutes, setMinutes] = useState(settings.minutesPerDay)
  const [notifyTime, setNotifyTime] = useState(settings.notifyTime)
  const [enabling, setEnabling] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [showProfileDetail, setShowProfileDetail] = useState(false)
  const [showGrades, setShowGrades] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null))
  }, [])

  const save = () =>
    onSave({
      ...settings,
      minutesPerDay: minutes,
      notifyTime,
    })

  const handleEnablePush = async () => {
    if (isDemo()) {
      onFlash('デモでは通知の登録はできません')
      return
    }
    setEnabling(true)
    try {
      const { enablePush } = await import('./push')
      await enablePush()
      onFlash('この端末で通知を受け取ります')
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
        'アカウントを削除すると、課題データ・設定・通知の登録がすべて完全に消去されます。この操作は取り消せません。\n\n' +
          'Moodle側の合鍵は有効なまま残ります。削除のあと、Moodleの「セキュリティキー」でリセットしてください。\n\n削除しますか?',
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

  if (showGrades) {
    return (
      <GradesScreen
        onBack={() => setShowGrades(false)}
        onFlash={onFlash}
        courseSuggestions={[...new Set(slots.map((s) => s.course))].sort((a, b) => a.localeCompare(b, 'ja'))}
      />
    )
  }

  if (showProfileDetail) {
    return (
      <ProfileDetailScreen
        settings={settings}
        onFlash={onFlash}
        onSave={onSave}
        onBack={() => setShowProfileDetail(false)}
      />
    )
  }

  return (
    <main className="px-4 py-4">
      <h2 className="text-base font-semibold text-gray-800">マイページ</h2>

      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center gap-3">
          <AvatarIcon avatar={settings.avatar} avatarUrl={settings.avatarUrl} size={52} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-gray-800">
              {settings.nickname ?? 'ニックネーム未設定'}
            </p>
            <p className="truncate text-xs text-gray-500">
              {[settings.university, settings.faculty, settings.department, settings.grade]
                .filter(Boolean)
                .join(' · ') || 'プロフィール未設定'}
            </p>
          </div>
        </div>
        {email && (
          <p className="mt-3 flex items-center gap-1.5 truncate text-xs text-gray-500">
            <Mail className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            {email}
          </p>
        )}
        <button
          onClick={() => setShowProfileDetail(true)}
          className="mt-3 w-full rounded-lg border border-gray-300 py-2 text-sm font-medium text-gray-700"
        >
          プロフィール詳細
        </button>
      </div>

      <button
        onClick={() => setShowGrades(true)}
        className="mt-4 flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white p-4 text-left"
      >
        <BarChart3 className="h-5 w-5 text-gray-400" />
        <span className="flex-1">
          <span className="block text-sm font-semibold text-gray-800">成績・GPA</span>
          <span className="block text-xs text-gray-400">手入力で成績を記録してGPAを計算</span>
        </span>
        <span className="text-gray-300">›</span>
      </button>

      {!isDemo() && (
        <MoodleConnectCard settings={settings} onConnect={onConnect} onRegisterToken={onRegisterToken} />
      )}

      <CalendarFeedCard settings={settings} onSaveSettings={onSave} onFlash={onFlash} />

      {isKagawaStudent(settings) && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-800">大学のリンク</h3>
          <a
            href={KADASAPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 flex items-center gap-2 rounded-lg border border-gray-100 p-2"
          >
            <ClipboardList className="h-5 w-5 text-gray-400" />
            <span className="flex-1">
              <span className="block text-sm font-medium text-gray-800">カダサポ</span>
              <span className="block text-xs text-gray-400">履修登録・成績など(香川大学)</span>
            </span>
            <ExternalLink className="h-4 w-4 text-gray-300" />
          </a>
        </div>
      )}

      {/* Premium(準備中): ホーム画面ウィジェットの完成イメージを見せる */}
      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
            <Crown className="h-4 w-4 text-amber-500" />
            UniPort Premium
          </h3>
          <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
            準備中
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-600">
          ホーム画面ウィジェットで、タスク・時間割がひと目で。下のボタンで種類を切り替えられます。
        </p>
        <WidgetPreview tasks={tasks} slots={slots} settings={settings} onToggle={onToggle} />
        <p className="mt-3 text-[11px] text-gray-400">
          ※ウィジェットはアプリ版(準備中)で提供予定です。上は今のあなたのデータでの表示イメージです。
        </p>
      </div>

      <CollapsibleSection icon={<FileText className="h-4 w-4 text-gray-400" />} title="規約">
        <div className="flex flex-col gap-2">
          <a href="terms.html" target="_blank" rel="noopener" className="text-sm text-primary underline">
            利用規約
          </a>
          <a href="privacy.html" target="_blank" rel="noopener" className="text-sm text-primary underline">
            プライバシーポリシー
          </a>
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon={<SettingsIcon className="h-4 w-4 text-gray-400" />} title="設定">
        <div className="space-y-4">
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
              className="mt-2 w-full accent-primary"
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
            <span className="mt-1 block text-xs text-gray-500">
              毎日この時刻に、未提出課題のまとめをプッシュ通知します
            </span>
          </label>

          <button onClick={save} className="w-full rounded-lg bg-primary py-2 text-sm font-semibold text-white">
            保存
          </button>

          <div className="border-t border-gray-100 pt-4">
            <button
              onClick={handleEnablePush}
              disabled={enabling}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary py-2 text-sm font-semibold text-primary disabled:opacity-50"
            >
              <Bell className="h-4 w-4" />
              この端末で通知を受け取る
            </button>
            <p className="mt-2 text-xs text-gray-500">
              iPhoneの場合は、先にSafariの共有ボタンから「ホーム画面に追加」し、
              ホーム画面のUniPortを開いてからこのボタンを押してください
            </p>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-semibold text-gray-800">近日公開</h3>
            <ul className="mt-2 space-y-2">
              {COMING_SOON.map((label) => (
                <li key={label} className="flex items-center justify-between text-sm text-gray-400">
                  <span>{label}</span>
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px]">準備中</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-3 border-t border-gray-100 pt-4">
            {isDemo() ? (
              <>
                <p className="text-xs text-gray-500">
                  デモモードのため、ログアウトとアカウント削除は使えません。
                  本番では、ここからアカウントと全データをその場で削除できます。
                </p>
                <a
                  href="./?demo=0"
                  className="block w-full rounded-lg border border-gray-300 py-2 text-center text-sm text-gray-500"
                >
                  デモを終了する
                </a>
              </>
            ) : (
              <>
                <button
                  onClick={() => supabase.auth.signOut()}
                  className="w-full rounded-lg border border-gray-300 py-2 text-sm text-gray-500"
                >
                  ログアウト
                </button>
                {/* 退会しても、Moodle側の合鍵は有効なまま残る(UniPortからは取り消せない)。
                    本人がMoodleの「セキュリティキー」でリセットすれば、その場で使えなくなる */}
                {settings.moodleConnected && (
                  <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-600">
                    アカウントを削除すると、UniPortに保存していたMoodleの合鍵も消えます。ただし
                    <b>Moodle側では合鍵が有効なまま</b>残るので、削除のあとにMoodleの「セキュリティキー」で
                    「Moodle mobile web service」の鍵をリセットしてください
                    (スマホのMoodle公式アプリは、ログインし直しになることがあります)。
                    <a
                      href={`${settings.moodleUrl}/user/managetoken.php`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 flex items-center gap-1 font-medium text-primary underline"
                    >
                      Moodleのセキュリティキーを開く
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleting}
                  className="w-full rounded-lg border border-red-200 py-2 text-sm text-red-400 disabled:opacity-50"
                >
                  {deleting ? '削除中…' : 'アカウントを削除(全データ消去)'}
                </button>
              </>
            )}
          </div>
        </div>
      </CollapsibleSection>
    </main>
  )
}
