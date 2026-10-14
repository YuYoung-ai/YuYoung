(function(root){
 'use strict';
 var API='https://yuyoung.yuyoung-ai.deno.net',config=null,workerReady=null,lastCheck=0;
 function esc(v){return String(v||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 async function call(action,params){
  var token=root.BazAuth.token(),ctl=new AbortController(),timer=setTimeout(function(){ctl.abort();},15000);
  try{var r=await fetch(API,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(Object.assign({},params||{},{action:action,token:token})),cache:'no-store',signal:ctl.signal}),d=await r.json();if(root.BazAuth.token()!==token)throw new Error('계정이 변경되었습니다. 알림을 다시 여세요.');if(!d.success)throw new Error(d.error||'알림 요청 실패');return d;}
  catch(e){if(e.name==='AbortError')throw new Error('알림 서버 응답을 기다리지 못했습니다. 다시 시도하세요.');throw e;}finally{clearTimeout(timer);}
 }
 async function worker(){
  if(!('serviceWorker' in navigator))throw new Error('이 브라우저에서는 앱 알림을 지원하지 않습니다.');
  if(!workerReady)workerReady=(async function(){
   var reg=await navigator.serviceWorker.register('sw.js');await reg.update().catch(function(){});
   var installing=reg.installing||reg.waiting;
   if(installing&&installing.state!=='activated')await new Promise(function(resolve,reject){
    var timer=setTimeout(function(){installing.removeEventListener('statechange',changed);reject(new Error('앱 업데이트를 마친 뒤 알림 설정을 다시 눌러 주세요.'));},15000);
    function changed(){if(installing.state==='activated'||installing.state==='redundant'){clearTimeout(timer);installing.removeEventListener('statechange',changed);installing.state==='activated'?resolve():reject(new Error('앱 업데이트를 다시 확인하세요.'));}}
    installing.addEventListener('statechange',changed);changed();
   });
   return navigator.serviceWorker.ready;
  })().catch(function(e){workerReady=null;throw e;});
  return workerReady;
 }
 async function binding(uid){
  var reg=await worker(),sw=reg.active;if(!sw)throw new Error('앱을 다시 열어 알림 설정을 완료하세요.');
  await new Promise(function(resolve,reject){var channel=new MessageChannel(),timer=setTimeout(function(){reject(new Error('앱 알림 연결을 다시 시도하세요.'));},5000);channel.port1.onmessage=function(){clearTimeout(timer);channel.port1.close();resolve();};sw.postMessage({type:'BAZ_PUSH_BINDING',uid:uid||''},[channel.port2]);});
  try{if(uid)localStorage.setItem('baz_push_uid',uid);else localStorage.removeItem('baz_push_uid');}catch(e){}
 }
 function standalone(){return matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;}
 function platform(){return /iPad|iPhone|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1?'ios':'android';}
 function supported(){return root.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in root&&'Notification' in root&&(platform()!=='ios'||standalone());}
 async function getConfig(force){if(!config||force)config=await call('notification_config');return config;}
 async function reconcile(){
  if(!root.BazAuth.token())return;
  var c=await getConfig(true),old='';try{old=localStorage.getItem('baz_push_uid')||'';}catch(e){}
  if(!supported())return c;
  var reg=await worker(),sub=await reg.pushManager.getSubscription();
  if(old&&old!==c.uid){await binding('');if(sub)await sub.unsubscribe();sub=null;}
  if(sub&&Notification.permission==='granted'){
   await call('notification_subscribe',{subscription:sub.toJSON()});await binding(c.uid);
  }else if(old)await binding('');
  return c;
 }
 function bytes(value){var s=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(s,function(c){return c.charCodeAt(0);});}
 async function enable(){
  if(!supported())throw new Error(platform()==='ios'?'Safari에서 홈 화면에 추가한 뒤 앱을 열어 알림을 설정하세요.':'Chrome 등 알림을 지원하는 브라우저에서 다시 열어 주세요.');
  // Permission must be requested directly by this button click, before network awaits.
  var permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
  if(permission!=='granted')throw new Error('기기 설정에서 BAZ CS 알림을 허용한 뒤 다시 연결하세요.');
  var c=await getConfig(true),reg=await worker(),sub=await reg.pushManager.getSubscription();
  if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(c.publicKey)});
  await binding('');
  try{await call('notification_subscribe',{subscription:sub.toJSON()});await binding(c.uid);}
  catch(e){await sub.unsubscribe().catch(function(){});throw e;}
  return c;
 }
 async function disable(){
  await binding('');var reg=await worker(),sub=await reg.pushManager.getSubscription();if(!sub)return;
  var endpoint=sub.endpoint;await sub.unsubscribe();if(root.BazAuth.token())await call('notification_unsubscribe',{endpoint:endpoint});
 }
 async function test(){var reg=await worker(),sub=await reg.pushManager.getSubscription();if(!sub)throw new Error('접수 알림 받기를 먼저 설정하세요.');await call('notification_test',{endpoint:sub.endpoint});}
 function counts(d){document.querySelectorAll('[data-notification-count]').forEach(function(el){el.textContent=d.unread?String(d.unread)+(d.unreadMore?'+':''):'';el.hidden=!d.unread;});}
 async function refreshCount(){
  if(!root.BazAuth.token()||document.hidden||Date.now()-lastCheck<60000)return;
  lastCheck=Date.now();try{var d=await call('notification_list');counts(d);}catch(e){}
 }
 var dialog=null,cursor='',items=[];
 function clearInbox(){items=[];cursor='';if(dialog){dialog.querySelector('[data-inbox-list]').textContent='';dialog.querySelector('[data-inbox-more]').hidden=true;if(dialog.open)dialog.close();}}
 function renderInbox(d,append){
  cursor=d.cursor||'';items=append?items.concat(d.items||[]):d.items||[];counts(d);
  dialog.querySelector('[data-inbox-list]').innerHTML=items.length?items.map(function(n){return '<a class="baz-notification-item'+(n.readAt?'':' unread')+'" href="'+esc(root.BazNotificationRoute.url({requestId:n.requestId,notificationId:n.id}))+'" data-notification-id="'+esc(n.id)+'" data-request-id="'+esc(n.requestId)+'"><div><strong>'+esc(n.hospitalName)+'</strong><span>'+esc(n.audience==='all'?'전체 알림 · 담당자 미지정':'담당 업무 배정')+'</span></div><p>'+esc(n.gubun)+' · '+esc(n.visitAt?n.visitAt.replace('T',' '):'방문일 미정')+'</p><small>'+esc(new Date(n.createdAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))+' · '+(n.readAt?'확인함':'미확인')+'</small></a>';}).join(''):'<p class="baz-notification-empty">최근 30일 동안 받은 알림이 없습니다.</p>';
  dialog.querySelector('[data-inbox-more]').hidden=!cursor;
 }
 async function loadInbox(append){
  var status=dialog.querySelector('[data-inbox-status]');status.textContent='알림을 확인하고 있습니다…';
  try{renderInbox(await call('notification_list',append?{cursor:cursor}:{}),append);status.textContent='최근 30일 · 접수를 열면 최신 내용을 확인합니다.';}
  catch(e){status.textContent=e.message;}
 }
 function showInbox(){
  if(!dialog){
   dialog=document.createElement('dialog');dialog.className='baz-notification-dialog';dialog.setAttribute('aria-labelledby','baz-inbox-title');
   dialog.innerHTML='<div class="baz-notification-heading"><div><small>BAZ CS</small><h2 id="baz-inbox-title">접수 알림</h2></div><button type="button" data-inbox-close aria-label="알림 닫기">✕</button></div><div class="baz-notification-toolbar"><a href="install.html">앱 설치·알림 설정</a><button type="button" data-inbox-refresh>새로고침</button></div><p data-inbox-status role="status" aria-live="polite"></p><div data-inbox-list></div><button type="button" data-inbox-more hidden>이전 알림 더 보기</button>';
   document.body.appendChild(dialog);dialog.querySelector('[data-inbox-close]').onclick=function(){dialog.close();};dialog.querySelector('[data-inbox-refresh]').onclick=function(){return loadInbox(false);};dialog.querySelector('[data-inbox-more]').onclick=function(){return loadInbox(true);};
   dialog.addEventListener('click',function(event){var a=event.target.closest('[data-notification-id]');if(a&&root.location.pathname.endsWith('/hospital-work.html')){event.preventDefault();dialog.close();root.dispatchEvent(new CustomEvent('baz-open-notification',{detail:{requestId:a.dataset.requestId,notificationId:a.dataset.notificationId}}));}});
  }
  clearInbox();dialog.showModal();return loadInbox(false);
 }
 function init(){
  if(root.parent!==root&&new URLSearchParams(root.location.search).get('embed')==='1')return;
  document.querySelectorAll('[data-notification-open]').forEach(function(b){b.onclick=showInbox;});
  if(root.BazAuth.token()){reconcile().catch(function(){});refreshCount();}
  document.addEventListener('visibilitychange',refreshCount);
  root.addEventListener('baz-auth-login',function(){clearInbox();config=null;lastCheck=0;reconcile().catch(function(){});refreshCount();});
  root.addEventListener('baz-auth-logout',function(){clearInbox();config=null;lastCheck=0;counts({unread:0});});
  if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('message',function(event){
   var d=event.data||{};
   if(d.type==='BAZ_OPEN_NOTIFICATION'&&root.BazNotificationRoute.valid(d.requestId))root.dispatchEvent(new CustomEvent('baz-open-notification',{detail:d}));
   if(d.type==='BAZ_NOTIFICATION_RECEIVED'){lastCheck=0;refreshCount();}
  });
 }
 root.BazNotifications={call:call,config:getConfig,reconcile:reconcile,enable:enable,disable:disable,test:test,platform:platform,standalone:standalone,supported:supported,worker:worker,refresh:function(){lastCheck=0;return refreshCount();},showInbox:showInbox};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})(window);
