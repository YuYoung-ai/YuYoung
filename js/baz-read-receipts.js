(function(root){
 'use strict';
 var dialog,requestId='',selectedId='',filter='read',sequence=0,current=null,reminding=false,summaries=new Map();
 var $=function(selector){return dialog.querySelector(selector);};
 function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 function stamp(v){return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v));}
 function create(){
  if(dialog)return;
  dialog=document.createElement('dialog');dialog.className='read-receipts-dialog';dialog.setAttribute('aria-labelledby','read-receipts-title');
  dialog.innerHTML='<div class="read-receipts-heading"><div><h2 id="read-receipts-title">알림 읽음 현황</h2><p data-receipts-hospital></p></div><button type="button" data-receipts-close aria-label="읽음 현황 닫기">닫기</button></div><p class="read-receipts-note">최근 30일 알림 · 수신 계정 기준<br>선택 읽음·모두 읽음도 포함하며, 업무 완료·결과 검토와는 별개입니다.</p><label class="read-receipts-select">확인할 알림<select data-receipts-event></select></label><div class="read-receipts-tabs" role="group" aria-label="읽음 여부"><button type="button" data-receipts-filter="read" aria-pressed="true">읽음</button><button type="button" data-receipts-filter="unread" aria-pressed="false">미확인</button></div><div class="read-receipts-status"><p data-receipts-status role="status" aria-live="polite"></p><button type="button" data-receipts-refresh>새로고침</button></div><ul class="read-receipts-people" data-receipts-people></ul>';
  document.body.append(dialog);
  $('[data-receipts-close]').onclick=function(){dialog.close();};
  dialog.addEventListener('close',function(){sequence++;current=null;reminding=false;requestId='';});
  dialog.addEventListener('click',function(e){var b=e.target.closest('[data-remind-recipient]');if(b)remind(b.dataset.remindRecipient);});
  $('[data-receipts-event]').onchange=function(){selectedId=this.value;load();};
  $('[data-receipts-refresh]').onclick=load;
  dialog.querySelectorAll('[data-receipts-filter]').forEach(function(b){b.onclick=function(){filter=b.dataset.receiptsFilter;renderPeople();};});
 }
 function summary(d){return d.selected?'최근 알림 · 읽음 '+d.read+' · 미확인 '+d.unread:'최근 30일 알림 없음';}
 function paintButtons(d){
  // A historic event must not replace the newest event's list summary.
  if(d.selected&&d.events[0]?.id!==d.selected.id)return;
  document.querySelectorAll('[data-receipt-request]').forEach(function(b){if(b.dataset.receiptRequest===d.requestId){b.setAttribute('aria-label','알림 읽음 현황 · '+summary(d));b.title=summary(d)+' · '+(d.selected?d.selected.title+' · '+stamp(d.selected.createdAt)+' · 알림별 읽음 현황 보기':'알림 읽음 현황 보기');}});
 }
 function renderPeople(){
  dialog.querySelectorAll('[data-receipts-filter]').forEach(function(b){var read=b.dataset.receiptsFilter==='read';b.textContent=(read?'읽음':'미확인')+' ('+(current?(read?current.read:current.unread):'—')+')';b.setAttribute('aria-pressed',String(b.dataset.receiptsFilter===filter));});
  var people=current?current.recipients.filter(function(p){return filter==='read'?!!p.readAt:!p.readAt;}):[];
  $('[data-receipts-people]').innerHTML=people.map(function(p){var same=current.recipients.filter(function(x){return x.name===p.name;}).length;return '<li><span class="read-receipts-avatar" aria-hidden="true">'+esc(p.name.slice(-2))+'</span><div><strong>'+esc(p.name)+'</strong>'+(same>1?'<small>동일 이름의 수신 계정 '+same+'개</small>':'')+'</div><div class="read-receipts-when"><span>'+(p.readAt?'읽음':'미확인')+'</span>'+(p.readAt?'<time datetime="'+esc(p.readAt)+'">'+esc(stamp(p.readAt))+'</time>':'')+'</div>'+(!p.readAt&&p.recipientId?'<button type="button" class="read-receipts-remind" data-remind-recipient="'+esc(p.recipientId)+'" aria-label="'+esc(p.name+' 재알림 요청')+'"'+(!p.canRemind||reminding||Date.parse(p.retryAt)>Date.now()?' disabled':'')+' title="'+esc(!p.canRemind?'현재 수신 대상·설정·기기 연결을 확인하세요.':Date.parse(p.retryAt)>Date.now()?'10분 뒤 다시 요청할 수 있습니다.':'이 계정의 연결 기기에 푸시 재알림을 요청합니다.')+'">'+(Date.parse(p.retryAt)>Date.now()?'요청됨':'재알림')+'</button>':'')+'</li>';}).join('')||'<li class="read-receipts-empty">'+(current?(current.selected?(filter==='read'?'읽음 처리한 계정이 없습니다.':'미확인 계정이 없습니다.'):'최근 30일에 연결된 알림이 없습니다.'):'')+'</li>';
 }
 async function remind(recipientId){
  if(reminding||!current?.selected)return;
  var seq=sequence,id=requestId,eventId=selectedId,person=current.recipients.find(function(p){return p.recipientId===recipientId;});
  if(!person||person.readAt||!person.canRemind)return;
  reminding=true;renderPeople();$('[data-receipts-status]').textContent=person.name+' 재알림을 요청하고 있습니다…';
  try{
   var result=await root.BazNotifications.call('notification_remind',{requestId:id,notificationId:eventId,recipientId:recipientId});
   if(seq!==sequence||!dialog.open)return;
   person.remindedAt=result.remindedAt;person.retryAt=result.retryAt;
   $('[data-receipts-status]').textContent=person.name+' 재알림 요청 완료 · 수신 여부는 대상 기기 상태에 따라 달라집니다.';
  }catch(e){if(seq===sequence&&dialog.open)$('[data-receipts-status]').textContent='재알림 요청 실패 · '+e.message;}
  finally{if(seq===sequence&&dialog.open){reminding=false;renderPeople();}}
 }
 async function load(){
  reminding=false;
  var seq=++sequence,id=requestId,eventId=selectedId;
  current=null;renderPeople();dialog.setAttribute('aria-busy','true');$('[data-receipts-status]').textContent='읽음 현황을 확인하고 있습니다…';$('[data-receipts-event]').disabled=true;$('[data-receipts-refresh]').disabled=true;
  try{
   var d=await root.BazNotifications.call('notification_receipts',{requestId:id,notificationId:eventId});
   if(seq!==sequence||!dialog.open)return;
   current=d;selectedId=d.selected?.id||'';
   $('[data-receipts-hospital]').textContent=d.hospitalName;
   $('[data-receipts-event]').innerHTML=d.events.length?d.events.map(function(e){return '<option value="'+esc(e.id)+'">'+esc(stamp(e.createdAt)+' · '+e.title)+'</option>';}).join(''):'<option value="">최근 30일 알림 없음</option>';
   $('[data-receipts-event]').value=selectedId;
   $('[data-receipts-status]').textContent=d.selected?(d.pending?'알림 대상 등록 중 · ':'')+'수신 계정 '+d.total+'개 · '+stamp(new Date())+' 확인':'알림 기록은 30일 동안 보관됩니다.';
   paintButtons(d);renderPeople();
  }catch(e){if(seq===sequence&&dialog.open){$('[data-receipts-status]').textContent='조회 실패 · '+e.message;$('[data-receipts-people]').textContent='';}}
  finally{if(seq===sequence){dialog.setAttribute('aria-busy','false');$('[data-receipts-event]').disabled=!current?.events.length;$('[data-receipts-refresh]').disabled=false;}}
 }
 function open(id){create();requestId=id;selectedId='';filter='read';current=null;$('[data-receipts-hospital]').textContent='';$('[data-receipts-event]').innerHTML='';if(!dialog.open)dialog.showModal();return load();}
 function mount(id){
  var old=summaries.get(id),token=root.BazAuth.token();
  function paint(d){if(root.BazAuth.token()===token)paintButtons(d);}
  if(old&&Date.now()-old.at<15000&&old.token===token){old.task.then(paint).catch(function(){});return;}
  var task=root.BazNotifications.call('notification_receipts',{requestId:id});summaries.set(id,{at:Date.now(),task:task,token:token});
  task.then(paint).catch(function(){summaries.delete(id);});
 }
 document.addEventListener('click',function(e){var b=e.target.closest('[data-receipt-request]');if(b){e.preventDefault();open(b.dataset.receiptRequest);}});
 root.addEventListener('baz-auth-logout',function(){sequence++;summaries.clear();if(dialog?.open)dialog.close();document.querySelectorAll('[data-receipt-request]').forEach(function(b){b.textContent='읽음 현황';b.setAttribute('aria-label','알림 읽음 현황');b.title='알림 읽음 현황 보기';});});
 root.BazReadReceipts={open:open,mount:mount};
})(window);
