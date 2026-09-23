// サキヨミ Service Worker
// PWAとしてホーム画面に追加できるようにするための最小構成 + プッシュ通知の受け口

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'UniPort', {
      body: data.body || '',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: data.url || './' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus()
      }
      // 通知から開いたことをアプリに伝える(このときは協賛企業の案内を出さない)
      const url = new URL(event.notification.data?.url || './', self.registration.scope)
      url.searchParams.set('from', 'push')
      return self.clients.openWindow(url.href)
    }),
  )
})
