// サキヨミ(仮) Moodle連携 Edge Function
// 次のどちらかで連携し、合鍵(トークン)を暗号化して保存する(_shared/moodleCredential.ts)。
//   1) MoodleのID/パスワード → /login/token.php でトークンに交換
//      パスワードはこの関数の中で使い捨てられ、保存もログ出力もしない
//   2) トークンを直接(上級者向け) → Moodleに問い合わせて使えることを確かめてから保存
// アプリ(ブラウザ)には合鍵を返さない。返すのは成否だけ。
// デプロイ: npx supabase functions deploy moodle-connect --project-ref kdyffkcowdkbgtbledbc
import { createClient } from 'npm:@supabase/supabase-js@2'
import { saveMoodleCredential } from '../_shared/moodleCredential.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

/** 直接登録されたトークンが本当に使えるかを、Moodleに問い合わせて確かめる */
async function tokenWorks(moodleUrl: string, token: string): Promise<boolean> {
  try {
    const q = new URLSearchParams({
      wstoken: token,
      wsfunction: 'core_webservice_get_site_info',
      moodlewsrestformat: 'json',
    })
    const res = await fetch(`${moodleUrl}/webservice/rest/server.php?${q}`)
    if (!res.ok) return false
    const data = await res.json()
    return !data?.exception && !data?.errorcode && !!data?.userid
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // ログイン中のユーザー本人からの呼び出しであることを確認
  const jwt = (req.headers.get('authorization') ?? '').replace('Bearer ', '')
  const { data: userData } = await admin.auth.getUser(jwt)
  if (!userData?.user) return json({ error: 'ログインしてから操作してください' }, 401)
  const userId = userData.user.id

  let moodleUrl = '', username = '', password = '', directToken = ''
  try {
    const body = await req.json()
    moodleUrl = String(body.moodleUrl ?? '').trim().replace(/\/+$/, '')
    username = String(body.username ?? '').trim()
    password = String(body.password ?? '')
    directToken = String(body.token ?? '').trim()
  } catch {
    return json({ error: 'リクエストの形式が不正です' })
  }

  if (!moodleUrl.startsWith('https://')) {
    return json({ error: 'MoodleのURLは https:// で始まる必要があります' })
  }

  // 2) トークンの直接登録
  if (directToken) {
    if (!(await tokenWorks(moodleUrl, directToken))) {
      return json({ error: 'このトークンではMoodleに接続できませんでした。大学とトークンを確認してください' })
    }
    try {
      await saveMoodleCredential(admin, userId, moodleUrl, directToken)
    } catch {
      return json({ error: '設定の保存に失敗しました' })
    }
    return json({ ok: true })
  }

  // 1) ID/パスワード
  if (!username || !password) {
    return json({ error: 'IDとパスワードの両方を入力してください' })
  }

  // Moodle公式アプリと同じ入り口でトークン発行を依頼
  let data: { token?: string; errorcode?: string; error?: string }
  try {
    const res = await fetch(`${moodleUrl}/login/token.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        username,
        password,
        service: 'moodle_mobile_app',
      }),
    })
    data = await res.json()
  } catch {
    return json({
      error: 'このURLにMoodleが見つかりませんでした。大学のMoodleのアドレスを確認してください',
    })
  }

  if (!data.token) {
    const code = data.errorcode ?? ''
    if (code === 'invalidlogin') {
      return json({ error: 'IDまたはパスワードが違います' })
    }
    if (code === 'servicenotavailable' || code === 'enablewsdescription' || code === 'wsdisabled') {
      return json({
        error: 'この大学のMoodleはアプリ連携(モバイルAPI)が有効になっていないようです',
      })
    }
    return json({ error: `連携できませんでした (${code || '不明なエラー'})` })
  }

  // トークンだけを暗号化して保存(パスワードはここで破棄される)
  try {
    await saveMoodleCredential(admin, userId, moodleUrl, data.token)
  } catch {
    return json({ error: '設定の保存に失敗しました' })
  }

  return json({ ok: true })
})
