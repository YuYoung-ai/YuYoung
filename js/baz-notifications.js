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
 var dialog=null,cursor='',items=[],selected=new Set(),inboxBusy=false,inboxSeq=0,readThrough='',inboxUnread=0;
 function clearInbox(){inboxSeq++;inboxBusy=false;items=[];cursor='';readThrough='';inboxUnread=0;selected.clear();if(dialog){dialog.querySelector('[data-inbox-list]').textContent='';dialog.querySelector('[data-inbox-more]').hidden=true;if(dialog.open)dialog.close();}}
 function inboxControls(){
  if(!dialog)return;var unread=items.filter(function(n){return !n.readAt;});
  dialog.querySelector('[data-inbox-selected]').disabled=inboxBusy||!selected.size;
  dialog.querySelector('[data-inbox-selected]').textContent='선택 읽음'+(selected.size?' ('+selected.size+')':'');
  dialog.querySelector('[data-inbox-all]').disabled=inboxBusy||!inboxUnread;
  dialog.querySelector('[data-inbox-refresh]').disabled=dialog.querySelector('[data-inbox-more]').disabled=inboxBusy;
  var selectAll=dialog.querySelector('[data-inbox-select-page]');selectAll.disabled=inboxBusy||!unread.length;selectAll.checked=unread.length>0&&unread.every(function(n){return selected.has(n.id);});selectAll.indeterminate=selected.size>0&&!selectAll.checked;
  dialog.querySelectorAll('[data-inbox-check]').forEach(function(c){c.checked=selected.has(c.dataset.inboxCheck);c.disabled=inboxBusy||!!items.find(function(n){return n.id===c.dataset.inboxCheck;})?.readAt;});
 }
 function renderInbox(d,append){
  cursor=d.cursor||'';items=Array.from(new Map((append?items:[]).concat(d.items||[]).map(function(n){return [n.id,n];})).values());inboxUnread=d.unread||0;if(!append){readThrough=d.readThrough||'';selected.clear();}counts(d);
  dialog.querySelector('[data-inbox-list]').innerHTML=items.length?items.map(function(n){return '<article class="baz-notification-row'+(n.readAt?'':' unread')+'"><label class="baz-inbox-check"><input type="checkbox" data-inbox-check="'+esc(n.id)+'" aria-label="'+esc(n.hospitalName)+' 알림 선택"'+(n.readAt?' disabled':'')+'></label><a class="baz-notification-item" href="'+esc(root.BazNotificationRoute.url({requestId:n.requestId,notificationId:n.id}))+'" data-notification-id="'+esc(n.id)+'" data-request-id="'+esc(n.requestId)+'"><div><strong>'+esc(n.hospitalName)+'</strong><span>'+esc(n.audience==='all'?'전체 알림 · 담당자 미지정':'담당 업무 배정')+'</span></div><p>'+esc(n.gubun)+' · '+esc(n.visitAt?n.visitAt.replace('T',' '):'방문일 미정')+'</p><small>'+esc(new Date(n.createdAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))+' · '+(n.readAt?'읽음':'안 읽음')+'</small></a></article>';}).join(''):'<p class="baz-notification-empty">최근 30일 동안 받은 알림이 없습니다.</p>';
  dialog.querySelector('[data-inbox-more]').hidden=!cursor;
  selected.forEach(function(id){if(!items.some(function(n){return n.id===id&&!n.readAt;}))selected.delete(id);});inboxControls();
 }
 async function loadInbox(append){
  if(inboxBusy)return;var seq=inboxSeq,status=dialog.querySelector('[data-inbox-status]');inboxBusy=true;inboxControls();status.textContent='알림을 확인하고 있습니다…';
  try{var data=await call('notification_list',append?{cursor:cursor}:{});if(seq!==inboxSeq)return;renderInbox(data,append);status.textContent='최근 30일 · 병원을 누르면 최신 접수와 Handover를 확인합니다. 읽음 처리는 업무 상태를 바꾸지 않습니다.';}
  catch(e){if(seq===inboxSeq)status.textContent=e.message;}
  finally{if(seq===inboxSeq){inboxBusy=false;inboxControls();}}
 }
 async function readInbox(all){
  if(inboxBusy||!all&&!selected.size)return;var seq=inboxSeq,status=dialog.querySelector('[data-inbox-status]'),ids=Array.from(selected),next='',done=new Set(),failures=new Set(),changed=0;inboxBusy=true;inboxControls();
  try{
   do{
    status.textContent='알림 읽음 처리 중… '+changed+'건';
    var data=await call('notification_mark_read',all?{all:true,through:readThrough,cursor:next}:{ids:ids.splice(0,50)});if(seq!==inboxSeq)return;
    changed+=Number(data.changed||0);(data.readIds||[]).forEach(function(id){done.add(id);selected.delete(id);var n=items.find(function(x){return x.id===id;});if(n)n.readAt=new Date().toISOString();});(data.failedIds||[]).forEach(function(id){failures.add(id);});next=all?data.cursor||'':'';
   }while(next||ids.length&&!all);
   var fresh=await call('notification_list');if(seq!==inboxSeq)return;inboxUnread=fresh.unread||0;counts(fresh);
   var kept=Array.from(selected),loadedCursor=cursor;renderInbox({items:items,cursor:loadedCursor,unread:fresh.unread,unreadMore:fresh.unreadMore,readThrough:fresh.readThrough||readThrough},false);kept.forEach(function(id){selected.add(id);});
   status.textContent=changed+'건 읽음 처리'+(failures.size?' · '+failures.size+'건은 다시 시도해 주세요.':' 완료. 새 알림은 새로고침으로 확인하세요.');
  }catch(e){if(seq===inboxSeq){status.textContent='일부 알림은 처리되었을 수 있습니다. 새로고침 후 다시 시도하세요. '+e.message;}}
  finally{if(seq===inboxSeq){inboxBusy=false;inboxControls();}}
 }
 function showInbox(){
  if(!dialog){
   dialog=document.createElement('dialog');dialog.className='baz-notification-dialog';dialog.setAttribute('aria-labelledby','baz-inbox-title');
   dialog.innerHTML='<div class="baz-notification-heading"><div><small>BAZ CS</small><h2 id="baz-inbox-title">접수 알림</h2></div><button type="button" data-inbox-close aria-label="알림 닫기">✕</button></div><div class="baz-notification-toolbar"><a href="install.html">앱 설치·알림 설정</a><div class="baz-inbox-actions"><button type="button" data-inbox-refresh>새로고침</button><button type="button" data-inbox-selected disabled>선택 읽음</button><button type="button" data-inbox-all disabled>모두 읽음</button></div></div><p data-inbox-status role="status" aria-live="polite"></p><label class="baz-inbox-select-all"><input type="checkbox" data-inbox-select-page>불러온 안 읽은 알림 전체 선택</label><div data-inbox-list></div><button type="button" data-inbox-more hidden>이전 알림 더 보기</button>';
   var heading=document.createElement('div');heading.className='baz-inbox-top';heading.append(dialog.querySelector('.baz-notification-heading'),dialog.querySelector('.baz-notification-toolbar'));dialog.prepend(heading);
   document.body.appendChild(dialog);dialog.querySelector('[data-inbox-close]').onclick=function(){dialog.close();};dialog.querySelector('[data-inbox-refresh]').onclick=function(){return loadInbox(false);};dialog.querySelector('[data-inbox-more]').onclick=function(){return loadInbox(true);};
   dialog.querySelector('[data-inbox-selected]').onclick=function(){return readInbox(false);};dialog.querySelector('[data-inbox-all]').onclick=function(){return readInbox(true);};
   dialog.addEventListener('close',function(){inboxSeq++;inboxBusy=false;});
   dialog.addEventListener('change',function(event){var c=event.target;if(c.matches('[data-inbox-select-page]')){items.filter(function(n){return !n.readAt;}).forEach(function(n){if(c.checked)selected.add(n.id);else selected.delete(n.id);});}else if(c.dataset.inboxCheck){if(c.checked)selected.add(c.dataset.inboxCheck);else selected.delete(c.dataset.inboxCheck);}inboxControls();});
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
