// サキヨミ(仮) Moodle連携 Edge Function
// アプリから受け取ったMoodleのID/パスワードを /login/token.php で
// トークンに交換し、トークンだけを user_settings に保存する。
// パスワードはこの関数の中で使い捨てられ、保存もログ出力もしない。
// デプロイ: npx supabase functions deploy moodle-connect --project-ref kdyffkcowdkbgtbledbc
import { createClient } from 'npm:@supabase/supabase-js@2'

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

  let moodleUrl = '', username = '', password = ''
  try {
    const body = await req.json()
    moodleUrl = String(body.moodleUrl ?? '').trim().replace(/\/+$/, '')
    username = String(body.username ?? '').trim()
    password = String(body.password ?? '')
  } catch {
    return json({ error: 'リクエストの形式が不正です' })
  }

  if (!moodleUrl.startsWith('https://')) {
    return json({ error: 'MoodleのURLは https:// で始まる必要があります' })
  }
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

  // トークンだけを保存(パスワードはここで破棄される)
  const { error } = await admin.from('user_settings').upsert({
    user_id: userData.user.id,
    moodle_url: moodleUrl,
    moodle_token: data.token,
  })
  if (error) return json({ error: '設定の保存に失敗しました' })

  return json({ ok: true })
})
