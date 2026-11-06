(function(root){
 'use strict';
 var script=document.currentScript,base=new URL('./',script&&script.src||new URL('push.js',location.href).href),workerTask=null;
 function platform(){return /Android/i.test(navigator.userAgent)?'android':/iPad|iPhone|iPod/i.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1?'ios':'desktop';}
 function standalone(){return root.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;}
 function permission(){return 'Notification' in root?Notification.permission:'unsupported';}
 function supported(){return !!root.isSecureContext&&'Notification' in root&&'serviceWorker' in navigator&&'PushManager' in root&&(platform()!=='ios'||standalone());}
 function guidance(state){
  if(!root.isSecureContext)return 'HTTPS 주소에서 병원 QR을 다시 열어 주세요.';
  if(platform()==='ios'&&!standalone())return 'iPhone은 Safari에서 홈 화면에 추가한 뒤, 홈 화면 앱에서 알림을 허용해 주세요.';
  if(!supported())return '일반 Chrome에서 병원 QR을 열어 주세요. 앱 안의 브라우저나 시크릿 모드에서는 알림 연결이 제한될 수 있습니다.';
  if(state==='denied')return platform()==='android'?'Chrome 주소창 왼쪽 사이트 정보 → 권한 → 알림을 허용해 주세요. 항목이 없으면 Chrome 설정 → 사이트 설정 → 알림에서 이 사이트를 확인하세요. 휴대폰 설정 → 앱 → Chrome → 알림도 켜져 있어야 합니다.':'브라우저 주소창의 사이트 설정에서 알림을 허용해 주세요. 운영체제의 브라우저 알림 설정도 확인하세요.';
  if(state==='default')return '아래 알림 허용을 누른 뒤 Chrome의 권한 요청에서도 허용을 선택해 주세요. 요청이 작게 표시되면 주소창의 알림 표시를 확인하세요.';
  return '웹사이트 권한이 허용되어도 휴대폰의 Chrome 알림, 방해 금지 모드 등에 따라 표시되지 않을 수 있습니다.';
 }
 function validRegistration(reg){return reg&&reg.scope===base.href&&reg.active&&new URL(reg.active.scriptURL).pathname===new URL('sw.js',base).pathname;}
 function worker(){
  if(!supported())return Promise.reject(Error(guidance(permission())));
  if(!workerTask)workerTask=(async function(){
   var reg=await navigator.serviceWorker.register(new URL('sw.js?v=314',base).href,{scope:base.href,updateViaCache:'none'});
   if(reg.scope!==base.href)throw Error('AS 전용 알림 연결을 확인하지 못했습니다. 병원 QR을 다시 열어 주세요.');
   if(validRegistration(reg)&&reg.active.state==='activated')return reg;
   return new Promise(function(resolve,reject){var seen=[],timer=setTimeout(function(){finish(Error('AS 알림 준비가 지연되고 있습니다. 인터넷 연결을 확인하고 다시 연결해 주세요.'));},15000);
    function finish(error){clearTimeout(timer);reg.removeEventListener('updatefound',check);seen.forEach(function(sw){sw.removeEventListener('statechange',check);});error?reject(error):resolve(reg);}
    function check(){if(validRegistration(reg)&&reg.active.state==='activated')return finish();[reg.installing,reg.waiting,reg.active].filter(Boolean).forEach(function(sw){if(!seen.includes(sw)){seen.push(sw);sw.addEventListener('statechange',check);}});if(seen.length&&seen.every(function(sw){return sw.state==='redundant';}))finish(Error('AS 알림 연결을 준비하지 못했습니다. 다시 연결해 주세요.'));}
    reg.addEventListener('updatefound',check);check();
   });
  })().catch(function(e){workerTask=null;throw e;});
  return workerTask;
 }
 async function fingerprint(sub){var value=sub.toJSON(),binding={endpoint:sub.endpoint,keys:{p256dh:value.keys?.p256dh||'',auth:value.keys?.auth||''}};return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(binding))))).map(function(b){return b.toString(16).padStart(2,'0');}).join('');}
 async function inspect(server){
  var result={permission:permission(),supported:supported(),workerReady:false,localSubscription:false,connected:false,code:'unsupported'};
  if(!result.supported){result.help=guidance(result.permission);return result;}
  if(result.permission!=='granted'){result.code=result.permission;result.help=guidance(result.permission);return result;}
  try{var reg=await navigator.serviceWorker.getRegistration(base.href);result.workerReady=!!validRegistration(reg);var sub=result.workerReady?await reg.pushManager.getSubscription():null;result.localSubscription=!!sub;
   result.connected=!!(sub&&server&&server.connected&&server.subscriptionFingerprint===await fingerprint(sub));result.code=result.connected?'connected':'reconnect';result.help=result.connected?'':'알림 권한은 허용됐지만 이 접수와 기기 연결을 확인하지 못했습니다. 알림 받기로 다시 연결해 주세요.';
  }catch(e){result.code='check_failed';result.help='기기 알림 상태를 확인하지 못했습니다. 인터넷 연결을 확인하고 다시 점검해 주세요.';}
  return result;
 }
 function bytes(value){var s=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(s,function(c){return c.charCodeAt(0);});}
 function sameKey(a,b){return a&&a.byteLength===b.byteLength&&Array.from(new Uint8Array(a)).every(function(v,i){return v===b[i];});}
 async function connect(publicKey){
  if(!supported())throw Error(guidance(permission()));
  // Keep the native prompt in the user's click, before any network/worker await.
  var state=permission();if(state==='default')state=await Notification.requestPermission();
  if(state!=='granted')throw Error(guidance(state));
  if(!publicKey)throw Error('알림 발송 설정을 확인하지 못했습니다. 잠시 후 다시 연결해 주세요.');
  var reg=await worker(),key=bytes(publicKey),sub=await reg.pushManager.getSubscription();
  if(sub&&sub.options&&sub.options.applicationServerKey&&!sameKey(sub.options.applicationServerKey,key)){await sub.unsubscribe();sub=null;}
  if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
  if(!sub||!sub.endpoint)throw Error('기기 알림 구독을 만들지 못했습니다. Chrome의 사이트 알림 설정을 확인하세요.');
  return sub;
 }
 async function displayTest(){if(permission()!=='granted')throw Error(guidance(permission()));var reg=await worker();await reg.showNotification('Curejet 알림 표시 테스트',{body:'이 기기에서 알림 표시를 요청했습니다.',tag:'curejet-as-device-test',icon:new URL('../icon-192.png',base).href});}
 function observe(fn){if(navigator.permissions&&navigator.permissions.query)navigator.permissions.query({name:'notifications'}).then(function(p){p.addEventListener('change',fn);}).catch(function(){});root.addEventListener('pageshow',fn);}
 root.QrCustomerPush={worker:worker,inspect:inspect,connect:connect,permission:permission,guidance:guidance,supported:supported,displayTest:displayTest,observe:observe};
})(window);
