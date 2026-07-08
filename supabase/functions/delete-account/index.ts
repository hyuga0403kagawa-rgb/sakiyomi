// サキヨミ(仮) アカウント削除 Edge Function
// 本人のJWTで呼ばれ、アカウントと全データを即時削除する。
// tasks / user_settings / push_subscriptions は外部キーの on delete cascade で
// auth.users の削除に連動して消える。
// デプロイ: npx supabase functions deploy delete-account --project-ref kdyffkcowdkbgtbledbc
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
  const jwt = (req.headers.get('authorization') ?? '').replace('Bearer ', '')
  const { data: userData } = await admin.auth.getUser(jwt)
  if (!userData?.user) return json({ error: 'ログインしてから操作してください' }, 401)

  const { error } = await admin.auth.admin.deleteUser(userData.user.id)
  if (error) return json({ error: '削除に失敗しました。時間をおいて再度お試しください' })
  return json({ ok: true })
})
