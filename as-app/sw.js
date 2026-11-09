// Customer scope only. Private API responses and secret links are never cached.
const NOTICE_CACHE='curejet-as-notices-v2';
const NOTICE_TEXT={scheduled:'방문 예정으로 변경되었습니다.',completed:'AS 처리가 완료되었습니다.',rescheduled:'방문 일정이 변경되었습니다.',cancelled:'방문이 취소되었습니다.'};
const APP_RELEASE='324';
let noticeQueue=Promise.resolve();
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const scope=new URL(self.registration.scope);for(const name of await caches.keys()){if(name===NOTICE_CACHE)continue;const cache=await caches.open(name);for(const request of await cache.keys()){const u=new URL(request.url);if(u.origin===scope.origin&&u.pathname.startsWith(scope.pathname))await cache.delete(request);}}
 await self.clients.claim();for(const client of await self.clients.matchAll({type:'window'}))client.postMessage({type:'CUREJET_AS_UPDATED',version:APP_RELEASE});
})()));
self.addEventListener('fetch',event=>{
 const req=event.request,u=new URL(req.url),scope=new URL(self.registration.scope);if(req.method!=='GET'||u.origin!==scope.origin||!u.pathname.startsWith(scope.pathname))return;
 event.respondWith(fetch(req,{cache:'no-store'}).catch(()=>req.mode==='navigate'?new Response('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>인터넷 연결 확인</title><body><h1>인터넷 연결을 확인해 주세요.</h1><p>연결한 뒤 CUREJET AS를 다시 열어 주세요. 접수 기록은 유지됩니다.</p></body></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}}):Response.error()));
});
self.addEventListener('push',event=>{
 let data={};try{data=event.data.json();}catch{}const id=String(data.requestId||''),eventId=String(data.eventId||'');
 if(data.policy!==2||!Object.hasOwn(NOTICE_TEXT,data.kind)||!/^[-a-zA-Z0-9_]{8,90}$/.test(id)||!/^[-a-zA-Z0-9_:]{8,180}$/.test(eventId))return;
 const task=noticeQueue.catch(()=>{}).then(async()=>{
  const cache=await caches.open(NOTICE_CACHE),key=new URL('__notice__/'+encodeURIComponent(eventId),self.registration.scope).href;
  if(await cache.match(key))return;
  await self.registration.showNotification('Curejet 서비스 안내',{body:NOTICE_TEXT[data.kind],tag:'curejet-as:'+id+':'+data.kind,renotify:true,data:{requestId:id},icon:'../icon-192.png'});
  await cache.put(key,new Response('1'));const keys=await cache.keys();if(keys.length>128)await Promise.all(keys.slice(0,keys.length-128).map(k=>cache.delete(k)));
 });noticeQueue=task;event.waitUntil(task);
});
self.addEventListener('notificationclick',event=>{event.notification.close();const id=String(event.notification.data?.requestId||'');if(!/^[-a-zA-Z0-9_]{8,90}$/.test(id))return;event.waitUntil(self.clients.openWindow(new URL('index.html#request='+encodeURIComponent(id),self.registration.scope).href));});
