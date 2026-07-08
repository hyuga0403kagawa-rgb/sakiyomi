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
    throw new Error('先に設定画面でMoodleトークンを登録してください')
  }
  if (result.error === 'invalidtoken') {
    throw new Error('トークンが無効です。設定画面で確認してください。')
  }
  if (result.error) {
    throw new Error(`Moodleとの通信に失敗しました: ${result.error}`)
  }
  return result
}
