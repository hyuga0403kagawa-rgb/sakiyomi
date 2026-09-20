import { supabase } from './supabase'

// Moodleとの通信はすべてサーバー側(Edge Function moodle-sync)が行う。
// - ブラウザから大学のMoodleへ直接アクセスできない(CORS)問題の解決
// - 1時間ごとの自動同期(cron)と同じコードが動くため挙動が完全に一致する

export interface SyncResult {
  pending?: number
  submitted?: number
  skipped?: string
  error?: string
}

/**
 * MoodleのID/パスワードをサーバー側(moodle-connect)でトークンに交換して保存する。
 * パスワードはこのリクエストの中でしか使われず、どこにも保存されない。
 */
export async function connectMoodle(
  moodleUrl: string,
  username: string,
  password: string,
): Promise<void> {
  const { data, error } = await supabase.functions.invoke('moodle-connect', {
    body: { moodleUrl, username, password },
  })
  if (error) throw new Error('連携サーバーへの接続に失敗しました')
  if (data?.error) throw new Error(data.error)
}

export async function syncMoodleViaServer(): Promise<SyncResult> {
  const { data, error } = await supabase.functions.invoke('moodle-sync', { body: {} })
  if (error) throw new Error('同期サーバーへの接続に失敗しました')
  const result = (data?.result ?? {}) as SyncResult
  if (result.skipped) {
    throw new Error('先にマイページでMoodleと連携してください')
  }
  if (result.error?.includes('invalidtoken')) {
    throw new Error('Moodleとの連携が切れています。マイページから連携し直してください。')
  }
  if (result.error?.startsWith('ical:')) {
    throw new Error('カレンダーURLでの取り込みに失敗しました。マイページでURLを貼り直してください。')
  }
  if (result.error) {
    throw new Error(`Moodleとの通信に失敗しました: ${result.error}`)
  }
  return result
}

/** Edge Function が 4xx で返したときの、サーバー側のメッセージを取り出す */
async function serverMessage(error: unknown): Promise<string | null> {
  try {
    const ctx = (error as { context?: Response }).context
    const body = ctx ? await ctx.json() : null
    return typeof body?.error === 'string' ? body.error : null
  } catch {
    return null
  }
}

/**
 * カレンダーURL方式の連携(知プラe など、APIが使えないMoodle向け)。
 * 学生がMoodleの「カレンダーのエクスポート」で取得したURLをサーバーに渡す。
 * URLの検証と、実際に読めるかの確認はサーバー側で行う。パスワードは扱わない。
 * @returns 取り込めた締め切りの件数
 */
export async function connectCalendarUrl(icalUrl: string): Promise<number> {
  const { data, error } = await supabase.functions.invoke('moodle-sync', { body: { icalUrl } })
  if (error) throw new Error((await serverMessage(error)) ?? '連携サーバーへの接続に失敗しました')
  if (data?.error) throw new Error(data.error)
  return Number(data?.imported ?? 0)
}

/** カレンダーURL方式の連携を解除する(この方式で取り込んだ課題も消える) */
export async function disconnectCalendarUrl(): Promise<void> {
  const { data, error } = await supabase.functions.invoke('moodle-sync', { body: { icalUrl: '' } })
  if (error) throw new Error((await serverMessage(error)) ?? '連携サーバーへの接続に失敗しました')
  if (data?.error) throw new Error(data.error)
}
