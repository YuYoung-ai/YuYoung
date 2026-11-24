self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });

const bindingCache = 'baz-sales-binding-v1';
const bindingUrl = new URL('_notification_binding', self.registration.scope).href;
self.addEventListener('message', event => {
  if (event.data?.type !== 'SALES_BIND') return;
  event.waitUntil((async () => {
    const cache = await caches.open(bindingCache);
    if (event.data.binding) await cache.put(bindingUrl, new Response(event.data.binding));
    else await cache.delete(bindingUrl);
    event.ports[0]?.postMessage(true);
  })());
});

self.addEventListener('push', event => {
  let message;
  try { message = event.data?.json(); } catch { return; }
  if (!message?.binding) return;
  event.waitUntil((async () => {
    const entry = await (await caches.open(bindingCache)).match(bindingUrl);
    if (!entry || await entry.text() !== message.binding) return;
    await self.registration.showNotification('BAZ 영업', {
      body: message.body || '영업 서비스 알림을 확인해 주세요.',
      icon: new URL('app-icon-192.png', self.registration.scope).href,
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL('?notices=1', self.registration.scope);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    const open = windows.find(client => new URL(client.url).pathname === target.pathname);
    if (open) {
      await open.navigate(target.href);
      await open.focus();
    } else await self.clients.openWindow(target.href);
  })());
});
