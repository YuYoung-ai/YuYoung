(function(root){
 'use strict';
 root.BazQrReady=(async function(){
  if(!root.BazQrRuntime){
   if(!root.BazAuth?.token())return null;
   var config=await root.BazWorkAPI.get('qr_config');
   if(!config.success)throw Error(config.error||'QR 업무 설정을 확인하지 못했습니다.');
   if(!config.enabled)return null;
   var api='https://yuyoung-production.coaptation.workers.dev';
   root.BazQrRuntime={environment:'pilot',api:api,file:api,fileAction:'qr_file',pushMode:config.pushMode};
  }
  if(document.getElementById('work-management-tabs')){
   function script(path){return new Promise(function(resolve,reject){var el=document.createElement('script');el.src='js/'+path+'.js?v=306';el.onload=resolve;el.onerror=function(){reject(Error('관리 화면을 불러오지 못했습니다. 새로고침하세요.'));};document.body.append(el);});}
   await script('baz-work-tabs');
   await Promise.all([script('baz-work-reservations'),script('baz-qr-workflow')]);
  }
  return root.BazQrRuntime;
 })();
 root.BazQrReady.then(function(runtime){
  if(!runtime&&new URLSearchParams(location.search).get('view')&&document.getElementById('work-management-tabs'))show('QR 접수·예약 관리가 아직 활성화되지 않았습니다. 관리자에게 운영 설정을 요청하세요.');
 }).catch(function(e){show(e.message);});
 function show(message){var el=document.createElement('p');el.className='notice';el.setAttribute('role','alert');el.textContent=message;document.querySelector('main')?.prepend(el);}
})(window);
