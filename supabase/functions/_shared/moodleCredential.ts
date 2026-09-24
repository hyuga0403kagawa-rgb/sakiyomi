// Moodleの合鍵(トークン)の保存と読み出し。合鍵に触るのはこのファイルだけにする。
//
// 保存先は moodle_credentials.token_enc(暗号化済み)。この表はアプリ(ブラウザ)から
// 読めない・書けない(RLS有効・ポリシーなし)。アプリが見るのは user_settings.moodle_connected だけ。
//
// 2026-09-24 より前は user_settings.moodle_token に平文で入っていた。
// loadMoodleCredential は平文が残っていれば、その場で暗号化して移し、平文を消す。
// 毎時の同期が全員分をこれで読むので、デプロイ後1時間以内に全員分の移行が終わる。
// 定義: supabase/sql/2026-09-24_moodle_credentials.sql
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { decryptToken, encryptToken, keysFromEnv } from './secret.ts'

export interface MoodleCredential {
  moodleUrl: string
  token: string
}

/** 合鍵を暗号化して保存し、「連携済み」にする(平文の列は空にする) */
export async function saveMoodleCredential(
  admin: SupabaseClient,
  userId: string,
  moodleUrl: string,
  token: string,
): Promise<void> {
  const keys = await keysFromEnv()
  const tokenEnc = await encryptToken(keys, token, userId)
  // 先に暗号化した方を書く。後の平文消去が失敗しても、次に読むときにやり直せる
  const { error: e1 } = await admin
    .from('moodle_credentials')
    .upsert({ user_id: userId, token_enc: tokenEnc, updated_at: new Date().toISOString() })
  if (e1) throw new Error('合鍵の保存に失敗しました: ' + e1.message)
  // moodle_token は「not null default ''」の列。空は NULL ではなく '' で表す
  const { error: e2 } = await admin
    .from('user_settings')
    .upsert({ user_id: userId, moodle_url: moodleUrl, moodle_connected: true, moodle_token: '' })
  if (e2) throw new Error('連携状態の保存に失敗しました: ' + e2.message)
}

/**
 * 合鍵を読み出す。連携していなければ null。
 * 平文の合鍵が残っていれば(移行前の利用者)、暗号化して移してから返す。
 */
export async function loadMoodleCredential(
  admin: SupabaseClient,
  userId: string,
): Promise<MoodleCredential | null> {
  const { data: s } = await admin
    .from('user_settings')
    .select('moodle_url, moodle_token')
    .eq('user_id', userId)
    .maybeSingle()
  if (!s?.moodle_url) return null

  if (s.moodle_token) {
    await saveMoodleCredential(admin, userId, s.moodle_url, s.moodle_token)
    return { moodleUrl: s.moodle_url, token: s.moodle_token }
  }

  const { data: c } = await admin
    .from('moodle_credentials')
    .select('token_enc')
    .eq('user_id', userId)
    .maybeSingle()
  if (!c?.token_enc) return null
  const keys = await keysFromEnv()
  return { moodleUrl: s.moodle_url, token: await decryptToken(keys, c.token_enc, userId) }
}
