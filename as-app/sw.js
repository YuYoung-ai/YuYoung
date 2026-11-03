// Customer scope only. Never cache private API responses or individual secret URLs.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{let data={};try{data=event.data.json();}catch{}const id=String(data.requestId||'');if(!/^[-a-zA-Z0-9_]{8,90}$/.test(id))return;
 event.waitUntil(self.registration.showNotification('Curejet 서비스 안내',{body:'접수의 최신 내용을 확인해 주세요.',tag:String(data.eventId||id),data:{requestId:id},icon:'../icon-192.png'}));});
self.addEventListener('notificationclick',event=>{event.notification.close();const id=String(event.notification.data?.requestId||'');event.waitUntil(self.clients.openWindow(new URL('index.html#request='+encodeURIComponent(id),self.registration.scope).href));});
