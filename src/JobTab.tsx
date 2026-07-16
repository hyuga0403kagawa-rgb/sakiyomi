import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Copy,
  Crown,
  ExternalLink,
  Pencil,
  X,
} from 'lucide-react'
import type { Company, JobEntry, JobNote, JobProfile } from './types'
import { JOB_NOTE_CATEGORIES, JOB_STATUSES } from './types'
import * as repo from './repo'
import { JOB_TEMPLATES } from './jobTemplates'

const ENTRY_TYPES = ['説明会', 'セミナー', 'インターン', '本選考', 'ES提出', '面接', 'OB/OG訪問', 'その他']

/** 締切までの残り日数(その日を含む) */
function daysLeft(deadline: string): number {
  const today = new Date()
  const d0 = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const [y, m, d] = deadline.split('-').map(Number)
  return Math.round((new Date(y, m - 1, d).getTime() - d0.getTime()) / 86400_000)
}

/** 危険度カラー(7日以内:赤 / 8〜14日:黄 / 15日以上:緑) */
function deadlineColor(days: number): string {
  if (days < 0) return 'text-red-600 font-semibold'
  if (days <= 7) return 'text-red-600'
  if (days <= 14) return 'text-amber-600'
  return 'text-green-600'
}

/** プロフィールと企業の単純マッチ度(AIおすすめ枠のソート用) */
function matchScore(c: Company, p: JobProfile | null): number {
  if (!p) return 0
  const hay = `${c.name} ${c.industry ?? ''} ${c.matchTags ?? ''} ${c.location ?? ''}`.toLowerCase()
  const words = [p.industries, p.interests, p.jobType, p.location]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .split(/[\s、,・/]+/)
    .filter((w) => w.length >= 2)
  return words.reduce((score, w) => (hay.includes(w) ? score + 1 : score), 0)
}

const CHAT_CHIPS = ['自己PRを考えたい', 'ガクチカを整理したい', 'ES添削をしてほしい', '面接対策をしたい', '逆質問を考えて']

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

type View = 'home' | 'chat' | `template:${string}`

export default function JobTab(props: { onFlash: (text: string) => void }) {
  const { onFlash } = props
  const [view, setView] = useState<View>('home')
  const [entries, setEntries] = useState<JobEntry[]>([])
  const [profile, setProfile] = useState<JobProfile | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [showAddEntry, setShowAddEntry] = useState(false)
  const [showProfileForm, setShowProfileForm] = useState(false)
  const [showAllEntries, setShowAllEntries] = useState(false)

  useEffect(() => {
    repo.fetchJobEntries().then(setEntries).catch(() => {})
    repo.fetchJobProfile().then(setProfile).catch(() => {})
    repo.fetchCompanies().then(setCompanies).catch(() => {})
  }, [])

  // ---- エントリー追加フォーム ----
  const [company, setCompany] = useState('')
  const [entryType, setEntryType] = useState(ENTRY_TYPES[0])
  const [deadline, setDeadline] = useState('')
  const [memo, setMemo] = useState('')

  const addEntry = async () => {
    if (!company.trim()) {
      onFlash('企業名を入力してください')
      return
    }
    try {
      const created = await repo.addJobEntry({
        company: company.trim(),
        entryType,
        deadline: deadline || undefined,
        memo: memo.trim() || undefined,
      })
      setEntries((es) => [...es, created])
      setCompany('')
      setDeadline('')
      setMemo('')
      setShowAddEntry(false)
    } catch {
      onFlash('追加に失敗しました')
    }
  }

  const toggleEntry = async (e: JobEntry) => {
    setEntries((es) => es.map((x) => (x.id === e.id ? { ...x, done: !x.done } : x)))
    try {
      await repo.updateJobEntryDone(e.id, !e.done)
    } catch {
      onFlash('更新に失敗しました')
    }
  }

  const removeEntry = async (id: string) => {
    setEntries((es) => es.filter((x) => x.id !== id))
    try {
      await repo.deleteJobEntry(id)
    } catch {
      onFlash('削除に失敗しました')
    }
  }

  const changeStatus = async (e: JobEntry, status: string) => {
    setEntries((es) => es.map((x) => (x.id === e.id ? { ...x, status: status || undefined } : x)))
    try {
      await repo.updateJobEntryStatus(e.id, status || null)
    } catch {
      onFlash('更新に失敗しました')
    }
  }

  const activeEntries = useMemo(
    () =>
      entries
        .filter((e) => !e.done)
        .sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999')),
    [entries],
  )
  const shownEntries = showAllEntries ? activeEntries : activeEntries.slice(0, 5)

  // ---- 企業(PR枠とAIおすすめ枠は厳密に分離。sponsoredはおすすめに混ぜない) ----
  const recommended = useMemo(
    () =>
      companies
        .filter((c) => !c.isSponsored)
        .sort((a, b) => matchScore(b, profile) - matchScore(a, profile))
        .slice(0, 5),
    [companies, profile],
  )
  const sponsored = useMemo(() => companies.filter((c) => c.isSponsored), [companies])
  const events = useMemo(
    () => companies.filter((c) => c.internInfo || c.seminarInfo),
    [companies],
  )

  if (view === 'chat') {
    return <JobChat onBack={() => setView('home')} />
  }

  if (typeof view === 'string' && view.startsWith('template:')) {
    const tpl = JOB_TEMPLATES.find((t) => t.id === view.slice('template:'.length))
    if (tpl) {
      return (
        <main className="px-4 py-4">
          <button onClick={() => setView('home')} className="text-sm text-primary">
            ← 就活に戻る
          </button>
          <h2 className="mt-2 text-lg font-semibold text-gray-800">
            {tpl.title}
          </h2>
          <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-gray-700">
              {tpl.content}
            </pre>
          </div>
          <button
            onClick={() => {
              navigator.clipboard
                .writeText(tpl.content)
                .then(() => onFlash('テンプレートをコピーしました'))
                .catch(() => onFlash('コピーに失敗しました'))
            }}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-gray-900 py-2 text-sm font-semibold text-white"
          >
            <Copy className="h-4 w-4" />
            全文をコピー
          </button>
        </main>
      )
    }
  }

  return (
    <main className="px-4 py-4">
      <h2 className="text-base font-semibold text-gray-800">就活</h2>

      {/* 1. 就活スケジュール(説明会・セミナー・インターン・締切などを一元管理) */}
      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800">就活スケジュール</h3>
          <button
            onClick={() => setShowAddEntry(!showAddEntry)}
            className="text-xs text-primary underline"
          >
            {showAddEntry ? '閉じる' : '+ 追加'}
          </button>
        </div>

        {showAddEntry && (
          <div className="mt-3 space-y-2 rounded-lg bg-gray-50 p-3">
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="企業・イベント名(例: ◯◯社 説明会)"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <select
                value={entryType}
                onChange={(e) => setEntryType(e.target.value)}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-600"
              >
                {ENTRY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-600"
              />
            </div>
            <input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="メモ(例: マイページから提出)"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
            <button
              onClick={addEntry}
              className="w-full rounded-lg bg-gray-900 py-2 text-sm font-semibold text-white"
            >
              登録
            </button>
          </div>
        )}

        {activeEntries.length === 0 ? (
          <p className="mt-2 text-xs text-gray-400">
            説明会・セミナー・インターン・エントリー締切などを日付付きで登録すると、
            近い順に「あと◯日」で表示されます
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {shownEntries.map((e) => {
              const days = e.deadline ? daysLeft(e.deadline) : null
              return (
                <li key={e.id} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={e.done}
                    onChange={() => toggleEntry(e)}
                    className="mt-0.5 h-5 w-5 accent-primary"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2">
                      <span className="truncate text-sm font-medium text-gray-800">{e.company}</span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                        {e.entryType}
                      </span>
                    </p>
                    <p className="text-xs">
                      {days !== null && e.deadline ? (
                        <span className={deadlineColor(days)}>
                          {e.deadline.replaceAll('-', '/')} ·{' '}
                          {days < 0 ? '期限切れ' : days === 0 ? '今日まで!' : `あと${days}日`}
                        </span>
                      ) : (
                        <span className="text-gray-400">締切未設定</span>
                      )}
                      {e.memo && <span className="ml-2 text-gray-400">{e.memo}</span>}
                    </p>
                    <select
                      value={e.status ?? ''}
                      onChange={(ev) => changeStatus(e, ev.target.value)}
                      className={`mt-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        JOB_STATUSES.find((s) => s.key === e.status)?.color ??
                        'bg-gray-50 text-gray-400'
                      }`}
                    >
                      <option value="">状態なし</option>
                      {JOB_STATUSES.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.key}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={() => removeEntry(e.id)}
                    className="shrink-0 text-gray-300 hover:text-red-500"
                    aria-label="削除"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {activeEntries.length > 5 && (
          <button
            onClick={() => setShowAllEntries(!showAllEntries)}
            className="mt-2 text-xs text-gray-400 underline"
          >
            {showAllEntries ? '折りたたむ' : `すべて表示(${activeEntries.length}件)`}
          </button>
        )}
      </div>

      {/* 2. AI就活サポート */}
      <button
        onClick={() => setView('chat')}
        className="mt-3 w-full rounded-lg bg-gray-900 p-4 text-left"
      >
        <p className="flex items-center gap-1.5 text-sm font-semibold text-white"><Bot className="h-4 w-4 text-amber-400" />AI就活サポート</p>
        <p className="mt-1 text-xs text-gray-400">
          自己PR・ガクチカ・ES添削・面接対策の相談はこちら
        </p>
      </button>

      {/* 3. 就活プロフィール */}
      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800">就活プロフィール</h3>
          <button
            onClick={() => setShowProfileForm(!showProfileForm)}
            className="text-xs text-primary underline"
          >
            {showProfileForm ? '閉じる' : profile ? '編集' : '設定する'}
          </button>
        </div>
        {!showProfileForm &&
          (profile ? (
            <p className="mt-1 truncate text-xs text-gray-500">
              {[profile.industries, profile.jobType, profile.location, profile.startPeriod]
                .filter(Boolean)
                .join(' · ') || '未入力'}
            </p>
          ) : (
            <p className="mt-1 text-xs text-gray-400">
              志望業界などを設定すると、おすすめ企業の精度が上がります
            </p>
          ))}
        {showProfileForm && (
          <JobProfileForm
            profile={profile}
            onSaved={(p) => {
              setProfile(p)
              setShowProfileForm(false)
              onFlash('就活プロフィールを保存しました')
            }}
            onFlash={onFlash}
          />
        )}
      </div>

      {/* 4. おすすめ企業(AIおすすめ枠: 非スポンサーのみ) */}
      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-800">あなたへのおすすめ企業</h3>
        {recommended.length === 0 ? (
          <p className="mt-2 text-xs text-gray-400">
            企業情報は掲載準備中です。掲載企業が増え次第、プロフィールに合わせて表示されます
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {recommended.map((c) => (
              <CompanyCard key={c.id} company={c} />
            ))}
          </ul>
        )}
      </div>

      {/* PR枠(有料掲載。おすすめとは明確に分離) */}
      {sponsored.length > 0 && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-800">
            協賛企業
            <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
              PR
            </span>
          </h3>
          <ul className="mt-2 space-y-2">
            {sponsored.map((c) => (
              <CompanyCard key={c.id} company={c} pr />
            ))}
          </ul>
        </div>
      )}

      {/* 5. 掲載企業のインターン・説明会(運営が登録するイベント枠) */}
      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-800">掲載企業のインターン・説明会</h3>
        {events.length === 0 ? (
          <p className="mt-2 text-xs text-gray-400">掲載準備中です</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {events.map((c) => (
              <li key={c.id} className="rounded-lg border border-gray-100 p-2">
                <p className="flex items-center gap-2 text-sm font-medium text-gray-800">
                  {c.name}
                  {c.isSponsored && (
                    <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                      PR
                    </span>
                  )}
                </p>
                {c.internInfo && <p className="text-xs text-gray-500">インターン: {c.internInfo}</p>}
                {c.seminarInfo && <p className="text-xs text-gray-500">説明会: {c.seminarInfo}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 6. テンプレート */}
      <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-gray-800">テンプレート集</h3>
        <ul className="mt-2 space-y-1">
          {JOB_TEMPLATES.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => setView(`template:${t.id}`)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-gray-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-gray-800">{t.title}</span>
                  <span className="block text-[11px] text-gray-400">{t.description}</span>
                </span>
                <ChevronRight className="h-4 w-4 text-gray-300" />
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* 6.5 自己分析メモ */}
      <JobNotes onFlash={onFlash} />

      {/* 7. Premium(準備中) */}
      <div className="mt-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
          <Crown className="h-4 w-4 text-amber-500" />
          UniPort Premium
          <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600">
            準備中
          </span>
        </h3>
        <ul className="mt-1 space-y-0.5 text-xs text-gray-500">
          <li>・ホーム画面ウィジェット</li>
          <li>・AI添削 無制限</li>
          <li>・面接練習(AIロールプレイ)</li>
          <li>・企業分析レポート</li>
          <li>・外部カレンダー連携</li>
        </ul>
      </div>
    </main>
  )
}

function CompanyCard(props: { company: Company; pr?: boolean }) {
  const { company: c, pr } = props
  const [open, setOpen] = useState(false)
  return (
    <li className="rounded-lg border border-gray-100">
      <button onClick={() => setOpen(!open)} className="w-full p-2 text-left">
        <p className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">{c.name}</span>
          {pr && (
            <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
              PR
            </span>
          )}
          {open ? <ChevronDown className="h-4 w-4 text-gray-300" /> : <ChevronRight className="h-4 w-4 text-gray-300" />}
        </p>
        <p className="truncate text-xs text-gray-400">
          {[c.industry, c.location].filter(Boolean).join(' · ')}
        </p>
      </button>
      {open && (
        <div className="border-t border-gray-100 p-2 text-xs text-gray-600">
          {c.startingSalary && <p>初任給: {c.startingSalary}</p>}
          {c.avgSalary && <p>平均年収: {c.avgSalary}</p>}
          {c.employees && <p>従業員数: {c.employees}</p>}
          {c.positions && <p>募集職種: {c.positions}</p>}
          {c.benefits && <p>福利厚生: {c.benefits}</p>}
          {c.website && (
            <a
              href={c.website}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-primary underline"
            >
              公式サイト
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
    </li>
  )
}

function JobProfileForm(props: {
  profile: JobProfile | null
  onSaved: (p: JobProfile) => void
  onFlash: (text: string) => void
}) {
  const { profile, onSaved, onFlash } = props
  const [interests, setInterests] = useState(profile?.interests ?? '')
  const [location, setLocation] = useState(profile?.location ?? '')
  const [industries, setIndustries] = useState(profile?.industries ?? '')
  const [jobType, setJobType] = useState(profile?.jobType ?? '')
  const [startPeriod, setStartPeriod] = useState(profile?.startPeriod ?? '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const p: JobProfile = {
      interests: interests.trim() || undefined,
      location: location.trim() || undefined,
      industries: industries.trim() || undefined,
      jobType: jobType.trim() || undefined,
      startPeriod: startPeriod || undefined,
    }
    setBusy(true)
    try {
      await repo.upsertJobProfile(p)
      onSaved(p)
    } catch {
      onFlash('保存に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    placeholder: string,
  ) => (
    <label className="block">
      <span className="text-xs text-gray-500">{label}</span>
      <input
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
        className="mt-0.5 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
      />
    </label>
  )

  return (
    <div className="mt-3 space-y-2">
      {field('志望業界', industries, setIndustries, '例: IT・メーカー')}
      {field('希望職種', jobType, setJobType, '例: エンジニア・企画')}
      {field('希望勤務地', location, setLocation, '例: 四国・関西・どこでも')}
      {field('興味・関心', interests, setInterests, '例: AI・まちづくり・教育')}
      <label className="block">
        <span className="text-xs text-gray-500">就活開始時期</span>
        <select
          value={startPeriod}
          onChange={(e) => setStartPeriod(e.target.value)}
          className="mt-0.5 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
        >
          <option value="">未定</option>
          <option>もう始めている</option>
          <option>3ヶ月以内に始める</option>
          <option>半年以内に始める</option>
          <option>1年以上先</option>
        </select>
      </label>
      <button
        onClick={save}
        disabled={busy}
        className="w-full rounded-lg bg-gray-900 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        保存
      </button>
    </div>
  )
}

function JobNotes(props: { onFlash: (text: string) => void }) {
  const { onFlash } = props
  const [notes, setNotes] = useState<JobNote[]>([])
  const [editing, setEditing] = useState<JobNote | 'new' | null>(null)
  const [category, setCategory] = useState<string>(JOB_NOTE_CATEGORIES[0])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  useEffect(() => {
    repo.fetchJobNotes().then(setNotes).catch(() => {})
  }, [])

  const startNew = () => {
    setEditing('new')
    setCategory(JOB_NOTE_CATEGORIES[0])
    setTitle('')
    setBody('')
  }
  const startEdit = (n: JobNote) => {
    setEditing(n)
    setCategory(n.category)
    setTitle(n.title ?? '')
    setBody(n.body)
  }

  const save = async () => {
    if (!body.trim()) {
      onFlash('本文を入力してください')
      return
    }
    try {
      if (editing === 'new') {
        const created = await repo.addJobNote({ category, title: title.trim() || undefined, body: body.trim() })
        setNotes((ns) => [created, ...ns])
      } else if (editing) {
        const updated = { ...editing, category, title: title.trim() || undefined, body: body.trim() }
        await repo.updateJobNote(updated)
        setNotes((ns) => [updated, ...ns.filter((x) => x.id !== updated.id)])
      }
      setEditing(null)
    } catch {
      onFlash('保存に失敗しました')
    }
  }

  const remove = async (id: string) => {
    if (!window.confirm('このメモを削除しますか?')) return
    setNotes((ns) => ns.filter((n) => n.id !== id))
    try {
      await repo.deleteJobNote(id)
    } catch {
      onFlash('削除に失敗しました')
    }
  }

  const copy = (n: JobNote) => {
    navigator.clipboard
      .writeText(n.body)
      .then(() => onFlash('メモをコピーしました'))
      .catch(() => onFlash('コピーに失敗しました'))
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">自己分析メモ</h3>
        <button onClick={startNew} className="text-xs text-primary underline">
          + 追加
        </button>
      </div>
      <p className="mt-1 text-[11px] text-gray-400">
        ガクチカ・自己PR・強みなどを書きためて、ESや面接でコピーして使えます
      </p>

      {editing && (
        <div className="mt-3 space-y-2 rounded-lg bg-gray-50 p-3">
          <div className="flex flex-wrap gap-1.5">
            {JOB_NOTE_CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`rounded-full px-2.5 py-1 text-xs ${
                  category === c ? 'bg-gray-900 text-white' : 'bg-white text-gray-500'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="タイトル(任意 例: サークルの代表経験)"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="本文をここに書きためておく"
            rows={4}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(null)}
              className="flex-1 rounded-lg border border-gray-200 py-2 text-sm text-gray-500"
            >
              キャンセル
            </button>
            <button
              onClick={save}
              className="flex-1 rounded-lg bg-gray-900 py-2 text-sm font-semibold text-white"
            >
              保存
            </button>
          </div>
        </div>
      )}

      {notes.length === 0 && !editing ? (
        <p className="mt-2 text-xs text-gray-400">まだメモはありません。「+ 追加」から書けます</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border border-gray-100 p-2">
              <div className="flex items-center gap-2">
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                  {n.category}
                </span>
                {n.title && (
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">
                    {n.title}
                  </span>
                )}
                <button onClick={() => copy(n)} className="shrink-0 text-gray-400 hover:text-gray-600" aria-label="コピー">
                  <Copy className="h-4 w-4" />
                </button>
                <button onClick={() => startEdit(n)} className="shrink-0 text-gray-400 hover:text-gray-600" aria-label="編集">
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={() => remove(n.id)} className="shrink-0 text-gray-300 hover:text-red-500" aria-label="削除">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-gray-600">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function JobChat(props: { onBack: () => void }) {
  const { onBack } = props
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = (text: string) => {
    const t = text.trim()
    if (!t) return
    setMessages((ms) => [
      ...ms,
      { role: 'user', text: t },
      {
        role: 'assistant',
        text: 'AIチャットは現在準備中です。もうすぐ相談できるようになるので、少しだけお待ちください!(いま送った内容はどこにも保存されていません)\n\nそれまでは「テンプレート集」の自己PR・ガクチカの構成ガイドが役に立つはずです。',
      },
    ])
    setInput('')
  }

  return (
    <main className="flex min-h-[calc(100vh-8rem)] flex-col px-4 py-4">
      <div>
        <button onClick={onBack} className="text-sm text-primary">
          ← 就活に戻る
        </button>
        <h2 className="mt-1 text-base font-semibold text-gray-800">
          AI就活サポート
          <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600">
            準備中
          </span>
        </h2>
      </div>

      <div className="mt-3 flex-1 space-y-2 overflow-y-auto">
        {messages.length === 0 && (
          <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-600">
            こんにちは!自己PR・ガクチカ・ES添削・面接対策など、就活の相談相手になります。
            下のボタンから選ぶか、自由に入力してください。
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] whitespace-pre-wrap rounded-lg p-3 text-sm ${
              m.role === 'user'
                ? 'ml-auto bg-gray-900 text-white'
                : 'border border-gray-200 bg-white text-gray-700'
            }`}
          >
            {m.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="mt-3">
        <div className="flex flex-wrap gap-1.5">
          {CHAT_CHIPS.map((c) => (
            <button
              key={c}
              onClick={() => send(c)}
              className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700"
            >
              {c}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send(input)
            }}
            placeholder="相談したいことを入力…"
            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
          <button
            onClick={() => send(input)}
            className="shrink-0 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white"
          >
            送信
          </button>
        </div>
        <p className="mt-2 text-center text-[10px] leading-4 text-gray-400">
          AIの回答は参考情報です。企業の選考・待遇などの正式な情報は、
          必ず企業公式サイト等でご確認ください。
        </p>
      </div>
    </main>
  )
}
