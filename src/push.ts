import { supabase } from './supabase'

// Web PushのVAPID公開鍵(サーバー側の秘密鍵とペア。公開してよい値)
const VAPID_PUBLIC_KEY =
  'BOqDhEJZkzhfZ7hgnJkLCfag5XbJMBV_X-5QCMkoj-0e7wGHDonYqcbIx5lFDZBYDUejzATuevVNa3MXG_tbXDg'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

/** この端末でプッシュ通知を受け取れるようにし、宛先をクラウドに登録する。 */
export async function enablePush(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error(
      'この環境はプッシュ通知に未対応です。iPhoneでは「ホーム画面に追加」したアプリから開いてください。',
    )
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('通知が許可されませんでした')
  }
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
  })
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys) throw new Error('購読情報の取得に失敗しました')
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
      { onConflict: 'endpoint' },
    )
  if (error) throw new Error('通知の登録に失敗しました')
}
