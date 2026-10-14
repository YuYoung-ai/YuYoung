(function(){
 'use strict';var api=window.BazNotifications,$=function(id){return document.getElementById(id);},promptEvent=null,installed=false,connected=false;
 function choose(kind){document.querySelectorAll('[data-platform]').forEach(function(b){var on=b.dataset.platform===kind;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;$('guide-'+b.dataset.platform).hidden=!on;});$('install-button').hidden=kind!=='android'||!promptEvent||api.standalone()||installed;}
 function show(message,state){$('notification-state').textContent=message;$('notification-state').dataset.state=state||'';}
 document.querySelectorAll('[data-platform]').forEach(function(b){b.onclick=function(){choose(b.dataset.platform);};b.onkeydown=function(e){if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();var next=b.dataset.platform==='ios'?'android':'ios';choose(next);$('platform-'+next).focus();}};});
 choose(api.platform());
 window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();promptEvent=e;choose(document.querySelector('[data-platform][aria-selected=true]').dataset.platform);});
 window.addEventListener('appinstalled',function(){installed=true;promptEvent=null;$('install-button').hidden=true;$('install-state').textContent='설치가 완료되었습니다. 홈 화면에서 BAZ CS를 실행하세요.';});
 $('install-button').onclick=async function(){if(!promptEvent)return;var current=promptEvent;promptEvent=null;this.hidden=true;await current.prompt();await current.userChoice;};
 $('copy-install').onclick=async function(){try{await navigator.clipboard.writeText(new URL('install.html',location.href).href);$('copy-status').textContent='설치 주소를 복사했습니다.';}catch{$('copy-status').textContent='브라우저 주소창의 주소를 복사하세요.';}};
 $('install-login').onclick=function(){BazAuth.rememberReturn('install.html');location.href='index.html';};
 async function state(){
  $('install-state').textContent=api.standalone()?'홈 화면 앱에서 실행 중입니다. 아래에서 알림을 설정하세요.':'설치 후 홈 화면에서 BAZ CS를 실행하세요.';
  $('install-login').hidden=!!BazAuth.token();$('notification-enable').hidden=true;$('notification-test').hidden=true;$('notification-disable').hidden=true;
  if(!BazAuth.token()){show('먼저 업무 계정으로 로그인해 주세요.');return;}
  try{
   var c=await api.reconcile()||await api.config(true);
   $('notification-admin').hidden=!c.admin;
   if(!api.supported()){show(c.name+' · 앱 설치 후 알림을 연결하세요.');$('notification-help').textContent=api.platform()==='ios'?'iOS 16.4 이상에서 홈 화면에 추가한 앱을 열어 주세요.':'Chrome 등 알림을 지원하는 브라우저에서 열어 주세요.';return;}
   var reg=await api.worker(),sub=await reg.pushManager.getSubscription();connected=!!sub&&Notification.permission==='granted';
   show(c.name+' · '+(connected?'이 기기 알림 연결 완료':'접수 알림을 허용해 주세요.'),connected?'ready':'');
   $('notification-enable').hidden=connected;$('notification-test').hidden=!connected;$('notification-disable').hidden=!connected;
   $('notification-help').textContent=(c.engineer?'담당 업무: '+c.engineer+' · 전체 알림도 받습니다.':'전체 알림을 받습니다. 담당 업무 연결은 관리자 설정에서 확인하세요.')+(Notification.permission==='denied'?' 기기 또는 브라우저 설정에서 알림 권한을 허용한 뒤 다시 접속하세요.':'');
  }catch(e){show(e.message,'error');$('notification-enable').hidden=!api.supported();}
 }
 async function action(button,fn,success){button.disabled=true;try{await fn();await state();if(success)show(success,'ready');}catch(e){show(e.message,'error');}finally{button.disabled=false;}}
 $('notification-enable').onclick=function(){return action(this,api.enable,'알림 연결 완료 · 테스트 알림으로 수신을 확인하세요.');};
 $('notification-test').onclick=function(){return action(this,api.test,'테스트 알림을 전송했습니다. 휴대폰의 알림 표시를 확인하세요.');};
 $('notification-disable').onclick=function(){return action(this,api.disable,'이 기기의 알림 연결을 해제했습니다.');};
 function esc(v){return String(v||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 $('notification-admin').addEventListener('toggle',async function(){
  if(!this.open)return;
  try{var d=await api.call('notification_accounts');$('notification-accounts').innerHTML=d.accounts.map(function(a){return '<div class="install-account"><strong>'+esc(a.name)+'</strong><small>'+esc(a.label)+' · '+(a.explicit?'관리자 지정':'자동 연결')+'</small><div><select aria-label="'+esc(a.name+' 업무 담당자')+'" data-mapping="'+esc(a.uid)+'"><option value="">전체 알림만 수신</option>'+d.engineers.map(function(n){return '<option'+(n===a.engineer?' selected':'')+'>'+esc(n)+'</option>';}).join('')+'</select><button type="button" data-mapping-save="'+esc(a.uid)+'">저장</button></div></div>';}).join('');}
  catch(e){$('notification-admin-status').textContent=e.message;}
 });
 $('notification-accounts').onclick=async function(e){var b=e.target.closest('[data-mapping-save]');if(!b)return;b.disabled=true;try{var select=this.querySelector('[data-mapping="'+b.dataset.mappingSave+'"]');await api.call('notification_mapping',{uid:b.dataset.mappingSave,engineer:select.value});$('notification-admin-status').textContent='담당자 연결을 저장했습니다.';await state();}catch(error){$('notification-admin-status').textContent=error.message;}finally{b.disabled=false;}};
 state();
})();
