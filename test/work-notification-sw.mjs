import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import route from '../js/baz-notification-route.js';
const req='request_123',notice='notice_123';
assert.deepEqual(route.parse('?request='+req+'&notification='+notice),{requestId:req,notificationId:notice});
assert.equal(route.parse('?request=https://evil.test'),null);assert.equal(route.url({requestId:req,notificationId:notice}),'hospital-work.html?request='+req+'&notification='+notice);
const maps=new Map(),handlers={},shown=[],opened=[],messages=[],scope='https://app.example/YuYoung/';let unsubscribed=0,windows=[];
const cacheFor=name=>{if(!maps.has(name))maps.set(name,new Map());const data=maps.get(name);return {put:async(k,v)=>data.set(k,v.clone()),match:async k=>data.get(k)?.clone(),delete:async k=>data.delete(k)};};
const self={registration:{scope,pushManager:{getSubscription:async()=>({endpoint:'https://fcm.googleapis.com/x',unsubscribe:async()=>unsubscribed++})},showNotification:async(t,o)=>shown.push({t,o})},location:{origin:'https://app.example'},addEventListener:(n,fn)=>handlers[n]=fn,clients:{matchAll:async()=>windows,openWindow:async u=>opened.push(u),claim:async()=>{}},skipWaiting:async()=>{}};
const context={self,caches:{open:async n=>cacheFor(n),keys:async()=>[...maps.keys()],delete:async n=>maps.delete(n)},URL,Response,Promise,AbortController,setTimeout,clearTimeout,fetch:async()=>new Response('{}')};
vm.runInNewContext(fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8'),context);
async function fire(name,event={}){let work;handlers[name]({...event,waitUntil:p=>work=p});await work;}
const uid='g:'+'A'.repeat(43),other='g:'+'B'.repeat(43),source={url:scope+'install.html'};
await fire('message',{source,data:{type:'BAZ_PUSH_BINDING',uid},ports:[{postMessage:()=>{}}]});
await fire('push',{data:{json:()=>({recipient:uid,requestId:req,notificationId:notice,title:'새 접수',body:'검증'})}});assert.equal(shown.length,1);
await fire('push',{data:{json:()=>({recipient:other,requestId:req,title:'다른 계정'})}});assert.equal(shown.length,1,'a different logged-in account cannot receive the prior binding');
await fire('notificationclick',{notification:{data:{requestId:req,notificationId:notice},close:()=>{}}});assert.equal(opened[0],scope+route.url({requestId:req,notificationId:notice}));
let focused=0;windows=[{url:scope+'hospital-work.html',focus:async()=>focused++,postMessage:m=>messages.push(m)}];
await fire('notificationclick',{notification:{data:{requestId:req,notificationId:notice},close:()=>{}}});assert.equal(focused,1);assert.equal(opened.length,1);assert.equal(messages[0].type,'BAZ_OPEN_NOTIFICATION','focus existing window without discarding a draft');
await fire('notificationclick',{notification:{data:{requestId:'https://evil.test'},close:()=>{}}});assert.equal(opened.length,1);
await fire('message',{source,data:{type:'BAZ_PUSH_LOGOUT'},ports:[]});assert.equal(unsubscribed,1);await fire('push',{data:{json:()=>({recipient:uid,requestId:req})}});assert.equal(shown.length,1);
await fire('message',{source,data:{type:'BAZ_PUSH_BINDING',uid},ports:[]});maps.set('old-shell',new Map());await fire('activate');assert.equal(maps.has('old-shell'),false);assert.equal(maps.has('baz-push-binding-v1'),true,'updating app assets preserves push binding');
console.log('work-notification-sw: validated target routes, recipient binding, logout unsubscribe, safe notification click, existing-window draft preservation and cache upgrade passed.');
windows=[];const count=shown.length;
for(const kind of ['handover','roster']){
 const notificationId='notice_'+kind+'_123';await fire('push',{data:{json:()=>({recipient:uid,kind,notificationId,title:'업무 알림'})}});
 assert.equal(shown.at(-1).o.tag,'baz-work-'+notificationId);
 await fire('notificationclick',{notification:{data:{kind,notificationId},close:()=>{}}});
 assert.equal(opened.at(-1),scope+'notification.html?notification='+notificationId);
}
assert.equal(shown.length,count+2);assert.equal(route.url({notificationId:'notice_handover_123'}),'notification.html?notification=notice_handover_123');
await fire('push',{data:{json:()=>({recipient:uid,kind:'roster',notificationId:'https://evil.test'})}});assert.equal(shown.length,count+2);
