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

interface Message {
  text: string
  isError: boolean
}

type Mode = 'login' | 'signup'

export default function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)
  const [resetMode, setResetMode] = useState(false)

  const fail = (text: string) => setMessage({ text, isError: true })
  const info = (text: string) => setMessage({ text, isError: false })

  const switchMode = (m: Mode) => {
    setMode(m)
    setMessage(null)
  }

  const signIn = async () => {
    const cleaned = normalizeEmail(email)
    const problem = emailProblem(cleaned)
    if (problem) {
      fail(problem)
      return
    }
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.auth.signInWithPassword({ email: cleaned, password })
    if (error) {
      fail(
        error.message === 'Invalid login credentials'
          ? 'メールアドレスかパスワードが違います(初めての場合は上の「新規登録」に切り替えてください)'
          : `ログインに失敗しました: ${error.message}`,
      )
    }
    setBusy(false)
  }

  const signUp = async () => {
    const cleaned = normalizeEmail(email)
    const problem = emailProblem(cleaned)
    if (problem) {
      fail(problem)
      return
    }
    if (password.length < 6) {
      fail('パスワードは6文字以上にしてください')
      return
    }
    setBusy(true)
    setMessage(null)
    const { data, error } = await supabase.auth.signUp({ email: cleaned, password })
    if (error) {
      fail(
        error.message.includes('invalid format')
          ? 'メールアドレスの形式が正しくないようです(全角文字や余分なスペースがないか確認してください)'
          : error.message.includes('already registered') || error.message.includes('already been registered')
            ? 'このメールアドレスはすでに登録済みです。上の「ログイン」に切り替えてください'
            : `登録に失敗しました: ${error.message}`,
      )
      setBusy(false)
      return
    }
    // メール確認オフの設定ではsessionが即発行され、そのままログイン状態になる
    // (onAuthStateChangeがHomeへ切り替える)。sessionが無い場合のみ確認メール案内を出す。
    if (data.session) {
      info('登録が完了しました!ようこそ')
    } else {
      info(
        '確認メールを送りました!メール内のリンクを開いてから、上の「ログイン」を押してください。',
      )
    }
    setBusy(false)
  }

  const sendReset = async () => {
    const cleaned = normalizeEmail(email)
    const problem = emailProblem(cleaned)
    if (problem) {
      fail(problem)
      return
    }
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.auth.resetPasswordForEmail(cleaned)
    if (error) {
      fail(`送信に失敗しました: ${error.message}`)
    } else {
      info(
        '再設定メールを送りました!メール内のリンクを開くと、新しいパスワードを設定する画面になります。',
      )
    }
    setBusy(false)
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center bg-gray-50 px-6">
      <h1 className="text-center text-2xl font-semibold tracking-tight text-gray-900">UniPort</h1>
      <p className="mt-1 text-center text-sm text-gray-500">
        大学とつながる、課題ぜんぶ先読みアプリ
      </p>

      <div className="mt-8 space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        {!resetMode && (
          <>
            <div className="flex rounded-lg bg-gray-100 p-0.5 text-sm">
              {(
                [
                  ['login', 'ログイン'],
                  ['signup', '新規登録'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => switchMode(key)}
                  className={`flex-1 rounded-md py-1.5 ${
                    mode === key ? 'bg-white font-semibold text-primary' : 'text-gray-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-center text-xs text-gray-500">
              {mode === 'signup'
                ? '初めての方はこちら。メールとパスワードを決めるだけです'
                : 'すでに登録した方はこちら'}
            </p>
          </>
        )}

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="メールアドレス"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          autoComplete="email"
        />

        {!resetMode && (
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'signup' ? 'パスワード(6文字以上で自由に決める)' : 'パスワード'}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />
        )}

        {message && (
          <p className={`text-xs ${message.isError ? 'text-red-600' : 'text-primary-dark'}`}>
            {message.text}
          </p>
        )}

        {resetMode ? (
          <>
            <button
              onClick={sendReset}
              disabled={busy}
              className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? '送信中…' : '再設定メールを送る'}
            </button>
            <button
              onClick={() => {
                setResetMode(false)
                setMessage(null)
              }}
              className="w-full py-1 text-xs text-gray-500 underline"
            >
              ← ログイン画面に戻る
            </button>
          </>
        ) : (
          <>
            <button
              onClick={mode === 'signup' ? signUp : signIn}
              disabled={busy}
              className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? '処理中…' : mode === 'signup' ? 'この内容で新規登録' : 'ログイン'}
            </button>
            {mode === 'login' && (
              <button
                onClick={() => {
                  setResetMode(true)
                  setMessage(null)
                }}
                className="w-full py-1 text-xs text-gray-500 underline"
              >
                パスワードを忘れた場合
              </button>
            )}
          </>
        )}
      </div>

      <p className="mt-4 text-center text-xs text-gray-500">
        ここで登録するのはこのアプリ専用のアカウントです(Moodleとは別)
      </p>
      <p className="mt-2 flex items-center justify-center gap-3 text-center text-xs">
        <a href="terms.html" className="text-gray-500 underline">
          利用規約
        </a>
        <a href="privacy.html" className="text-gray-500 underline">
          プライバシーポリシー
        </a>
      </p>
    </div>
  )
}
