import type { Settings, Task } from './types'

// Moodleのアクションイベント(課題等)。APIレスポンスのうち使う項目だけ定義
interface MoodleEvent {
  id: number
  name: string
  activityname?: string
  timesort: number
  course?: { fullname?: string }
}

// 「「第4回 レポート課題」の提出期限」→「第4回レポート課題」
export function cleanTitle(name: string): string {
  const m = name.match(/^「(.+)」の(提出期限|受験終了日時|期限)$/)
  const base = m ? m[1] : name
  return base.split(/\s+/).join('')
}

/**
 * Moodleから今後の課題(アクションイベント)を取得する。
 * notifier(moodle-notifier)と同じ core_calendar_get_action_events_by_timesort を使う。
 * 開発中は /moodle-api (Viteのプロキシ) 経由で呼ぶ。
 */
export async function fetchMoodleEvents(token: string): Promise<MoodleEvent[]> {
  const timesortfrom = Math.floor(Date.now() / 1000) - 14 * 86400
  const params = new URLSearchParams({
    wstoken: token,
    wsfunction: 'core_calendar_get_action_events_by_timesort',
    moodlewsrestformat: 'json',
    timesortfrom: String(timesortfrom),
    limitnum: '50',
  })
  const res = await fetch(`/moodle-api/webservice/rest/server.php?${params}`)
  if (!res.ok) throw new Error(`Moodleへの接続に失敗しました (HTTP ${res.status})`)
  const data = await res.json()
  if (data.errorcode === 'invalidtoken') {
    throw new Error('トークンが無効です。設定画面で確認してください。')
  }
  if (data.exception || data.errorcode) {
    throw new Error(`Moodleエラー: ${data.message ?? data.error ?? data.errorcode}`)
  }
  return (data.events ?? []) as MoodleEvent[]
}

/**
 * 取得したMoodleイベントを既存タスクへマージする。
 * - 新しいイベント → タスクとして追加
 * - 既存のイベント → 期限などを更新(完了状態と見積もり時間は維持)
 * - 消えたイベント → 提出済みとみなして自動で完了にする 🎉
 */
export function mergeMoodleTasks(existing: Task[], events: MoodleEvent[]): Task[] {
  const eventIds = new Set(events.map((e) => e.id))
  const byEventId = new Map(
    existing.filter((t) => t.source === 'moodle').map((t) => [t.moodleEventId!, t]),
  )

  const merged: Task[] = existing.map((t) => {
    if (t.source !== 'moodle') return t
    if (!eventIds.has(t.moodleEventId!)) {
      // Moodle側から消えた = 提出済み
      return { ...t, done: true }
    }
    return t
  })

  for (const ev of events) {
    const due = new Date(ev.timesort * 1000).toISOString()
    const found = byEventId.get(ev.id)
    if (found) {
      const i = merged.findIndex((t) => t.id === found.id)
      merged[i] = {
        ...merged[i],
        title: cleanTitle(ev.activityname || ev.name),
        course: ev.course?.fullname,
        due,
      }
    } else {
      merged.push({
        id: `moodle-${ev.id}`,
        title: cleanTitle(ev.activityname || ev.name),
        course: ev.course?.fullname,
        due,
        estimatedMinutes: 120,
        done: false,
        source: 'moodle',
        moodleEventId: ev.id,
        createdAt: new Date().toISOString(),
      })
    }
  }
  return merged
}

export async function syncMoodle(settings: Settings, tasks: Task[]): Promise<Task[]> {
  const events = await fetchMoodleEvents(settings.moodleToken)
  return mergeMoodleTasks(tasks, events)
}
