(function(){
 'use strict';var api=window.BazNotifications,$=function(id){return document.getElementById(id);},id=new URLSearchParams(location.search).get('notification'),busy=false;
 function esc(v){return String(v||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 function fields(rows){return '<dl class="notice-fields">'+rows.filter(function(r){return r[1];}).map(function(r){return '<div><dt>'+esc(r[0])+'</dt><dd>'+esc(r[1])+'</dd></div>';}).join('')+'</dl>';}
 async function load(){
  if(busy)return;if(!BazAuth.token()){BazAuth.rememberReturn('notification.html?notification='+encodeURIComponent(id||''));$('notice-state').textContent='로그인 후 알림을 확인해 주세요.';return;}
  if(!window.BazNotificationRoute.valid(id)){$('notice-state').textContent='알림 주소를 확인하세요.';return;}
  busy=true;$('notice-refresh').disabled=true;$('notice-state').textContent='최신 내용을 확인하고 있습니다…';$('notice-content').textContent='';
  try{var d=await api.call('notification_detail',{notificationId:id}),e=d.event;
   $('notice-title').textContent=e.kind==='roster'?'휴무·당직 일정':e.hospitalName+' · AS 처리 현황';
   if(d.source){var s=d.source;$('notice-content').innerHTML=fields([['병원',s.hospitalName],['처리일',s.date],['작성자',s.originalAuthor||e.author],['담당자',s.engineer],['구분',s.gubun],['S/N',s.sn],['처리 결과',s.result],['처리 내용',s.detail],['교체품',s.part],['비고',s.remark]]);}
   else if(e.kind==='roster'){$('notice-content').innerHTML=fields([['일자',e.date],['현재 휴무',d.roster.filter(function(r){return r.type==='휴무';}).map(function(r){return r.person;}).join(', ')||'없음'],['현재 당직',d.roster.filter(function(r){return r.type==='당직';}).map(function(r){return r.person;}).join(', ')||'없음']]);$('notice-roster').href='hospital-work.html?roster='+encodeURIComponent(e.date);$('notice-roster').hidden=false;}
   else{location.href=window.BazNotificationRoute.url({requestId:e.requestId,notificationId:e.id});return;}
   $('notice-state').textContent='최신 저장 내용 확인 완료 · '+new Date().toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul'});
   var read=await api.call('notification_mark_read',{ids:[id]});if(read.failedIds?.length)$('notice-state').textContent+=' · 읽음 기록은 다시 시도해 주세요.';api.refresh();
  }catch(e){$('notice-state').textContent=e.message;}finally{busy=false;$('notice-refresh').disabled=false;}
 }
 $('notice-refresh').onclick=load;window.addEventListener('baz-auth-login',load);window.addEventListener('baz-auth-logout',function(){$('notice-content').textContent='';$('notice-state').textContent='로그인 후 알림을 확인해 주세요.';});load();
})();
