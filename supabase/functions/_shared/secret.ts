// Moodleの合鍵(トークン)の暗号化と、講義資料リンクの署名。
//
// 元になる秘密の値は Edge Function の秘密設定 MOODLE_TOKEN_KEY(32バイトをbase64にしたもの)だけに置く。
// データベースには暗号化済みの値しか入らないので、DBの中身が漏れても合鍵としては使えない。
// この値を失う・変えると、保存済みの合鍵は二度と復号できない(利用者はMoodle連携のやり直しになる)。
//
// 1つの秘密の値から、用途ごとに別の鍵を作って使う(HKDF):
//   - uniport/moodle-token/v1 … 合鍵の暗号化(AES-GCM)
//   - uniport/material-link/v1 … 講義資料リンクの署名(HMAC-SHA256)
// Deno(Edge Function)と Node(手元の検証)の両方で動くよう、Web Crypto だけを使う。

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export interface SecretKeys {
  aes: CryptoKey
  hmac: CryptoKey
}

function toB64Url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

/** 秘密の値(base64)から、暗号化用と署名用の鍵を作る */
export async function deriveKeys(secretBase64: string): Promise<SecretKeys> {
  const raw = Uint8Array.from(atob(secretBase64.trim()), (c) => c.charCodeAt(0))
  if (raw.length < 32) throw new Error('MOODLE_TOKEN_KEY は32バイト以上が必要です')
  const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey'])
  const hkdf = (info: string) => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new Uint8Array(0),
    info: encoder.encode(info),
  })
  const aes = await crypto.subtle.deriveKey(
    hkdf('uniport/moodle-token/v1'),
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  const hmac = await crypto.subtle.deriveKey(
    hkdf('uniport/material-link/v1'),
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  )
  return { aes, hmac }
}

let cached: Promise<SecretKeys> | null = null

/** Edge Function の秘密設定から鍵を作る(同じ実行環境の中では1回だけ) */
export function keysFromEnv(): Promise<SecretKeys> {
  if (!cached) {
    // deno-lint-ignore no-explicit-any
    const secret = (globalThis as any).Deno?.env.get('MOODLE_TOKEN_KEY')
    if (!secret) throw new Error('MOODLE_TOKEN_KEY が設定されていません')
    cached = deriveKeys(secret)
  }
  return cached
}

/**
 * 合鍵を暗号化する。利用者のIDも一緒に検証に使うので(追加認証データ)、
 * 別人の行に暗号文を書き写しても復号できない。
 * 形式: "v1.<初期化ベクトル>.<暗号文>"(どちらもbase64url)
 */
export async function encryptToken(keys: SecretKeys, token: string, userId: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(userId) },
    keys.aes,
    encoder.encode(token),
  )
  return `v1.${toB64Url(iv)}.${toB64Url(new Uint8Array(ct))}`
}

/** encryptToken の逆。鍵・利用者ID・中身のどれかが違えば例外になる */
export async function decryptToken(keys: SecretKeys, enc: string, userId: string): Promise<string> {
  const [ver, ivPart, ctPart] = enc.split('.')
  if (ver !== 'v1' || !ivPart || !ctPart) throw new Error('暗号化された合鍵の形式が不正です')
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64Url(ivPart), additionalData: encoder.encode(userId) },
    keys.aes,
    fromB64Url(ctPart),
  )
  return decoder.decode(pt)
}

/** 講義資料リンクの署名。中身は「利用者ID・期限・MoodleのファイルURL」 */
function linkPayload(userId: string, expSec: number, fileUrl: string): Uint8Array {
  return encoder.encode(`${userId}\n${expSec}\n${fileUrl}`)
}

export async function signMaterialLink(
  keys: SecretKeys,
  userId: string,
  expSec: number,
  fileUrl: string,
): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', keys.hmac, linkPayload(userId, expSec, fileUrl))
  return toB64Url(new Uint8Array(sig))
}

/** 署名が正しく、期限内なら true(比較は Web Crypto の verify に任せて、時間差での推測を防ぐ) */
export async function verifyMaterialLink(
  keys: SecretKeys,
  userId: string,
  expSec: number,
  fileUrl: string,
  sig: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!Number.isFinite(expSec) || expSec < nowSec) return false
  let sigBytes: Uint8Array
  try {
    sigBytes = fromB64Url(sig)
  } catch {
    return false
  }
  return crypto.subtle.verify('HMAC', keys.hmac, sigBytes, linkPayload(userId, expSec, fileUrl))
}
