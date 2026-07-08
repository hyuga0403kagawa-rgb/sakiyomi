import { useState } from 'react'
import { supabase } from './supabase'

/** スマホ入力にありがちな「余分なスペース」「全角文字」を自動で直す。
 *  例: "Ｔａｒｏ@ Gmail.com " → "taro@gmail.com" */
function normalizeEmail(raw: string): string {
  return raw
    .replace(/[\s　]/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９＠．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase()
}

function emailProblem(email: string): string | null {
  if (!email) return 'メールアドレスを入力してください'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return 'メールアドレスの形式が正しくないようです(全角文字や打ち間違いがないか確認してください)'
  }
  return null
}

export default function AuthScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const signIn = async () => {
    const cleaned = normalizeEmail(email)
    const problem = emailProblem(cleaned)
    if (problem) {
      setMessage(problem)
      return
    }
    setBusy(true)
    setMessage('')
    const { error } = await supabase.auth.signInWithPassword({ email: cleaned, password })
    if (error) {
      setMessage(
        error.message === 'Invalid login credentials'
          ? 'メールアドレスかパスワードが違います(初めての場合は先に「新規登録」を押してください)'
          : `ログインに失敗しました: ${error.message}`,
      )
    }
    setBusy(false)
  }

  const signUp = async () => {
    const cleaned = normalizeEmail(email)
    const problem = emailProblem(cleaned)
    if (problem) {
      setMessage(problem)
      return
    }
    if (password.length < 6) {
      setMessage('パスワードは6文字以上にしてください')
      return
    }
    setBusy(true)
    setMessage('')
    const { error } = await supabase.auth.signUp({ email: cleaned, password })
    if (error) {
      setMessage(
        error.message.includes('invalid format')
          ? 'メールアドレスの形式が正しくないようです(全角文字や余分なスペースがないか確認してください)'
          : `登録に失敗しました: ${error.message}`,
      )
    } else {
      setMessage(
        '確認メールを送りました!メール内のリンクを開いてから、この画面で「ログイン」を押してください。',
      )
    }
    setBusy(false)
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center bg-gray-50 px-6">
      <h1 className="text-center text-2xl font-bold text-indigo-600">サキヨミ (仮)</h1>
      <p className="mt-1 text-center text-sm text-gray-500">
        課題を先読みして、今日やる分だけ教えてくれる
      </p>

      <div className="mt-8 space-y-3 rounded-xl bg-white p-4 shadow-sm">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="メールアドレス"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          autoComplete="email"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="パスワード(6文字以上)"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          autoComplete="current-password"
        />
        {message && <p className="text-xs text-indigo-700">{message}</p>}
        <button
          onClick={signIn}
          disabled={busy}
          className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          ログイン
        </button>
        <button
          onClick={signUp}
          disabled={busy}
          className="w-full rounded-lg border border-indigo-600 py-2 text-sm font-bold text-indigo-600 disabled:opacity-50"
        >
          新規登録
        </button>
      </div>

      <p className="mt-4 text-center text-xs text-gray-400">
        ここで登録するのはこのアプリ専用のアカウントです(Moodleとは別)
      </p>
    </div>
  )
}
