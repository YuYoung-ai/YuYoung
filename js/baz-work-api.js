(function(root){
 'use strict';var URL='https://yuyoung-production.coaptation.workers.dev';
 async function call(action,params,write){
  var measured=root.BazPerf?root.BazPerf.start(action):function(){},timing={};
  var ctl=new AbortController(),timer=setTimeout(function(){ctl.abort();},action.indexOf('work_flow_')===0?45000:action.indexOf('work_handover_')===0||action==='work_references_refresh'?35000:15000);
  try{var token=root.BazAuth.token(),response=await fetch(URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(Object.assign({},params,{action:action,token:token})),signal:ctl.signal,cache:'no-store'}),data=await response.json();if(response.headers){var header=response.headers.get('Server-Timing')||'',server=header.match(/work;dur=([\d.]+)/),google=header.match(/gas;dur=([\d.]+)/);if(server)timing.serverMs=Number(server[1]);if(google)timing.googleMs=Number(google[1]);}if(root.BazAuth.token()!==token)throw new Error('로그인 계정이 변경되었습니다. 다시 접수에서 열어 주세요.');if(!data||typeof data.success!=='boolean')throw new Error('업무 서버 응답을 확인하지 못했습니다.');return data;}
  catch(e){var error=new Error(e.name==='AbortError'?'응답 대기 시간이 지났습니다.':e.message||'연결 실패');error.unknown=!!write;throw error;}
  finally{clearTimeout(timer);measured(timing);}
 }
 function id(){if(typeof root.crypto?.randomUUID==='function')return root.crypto.randomUUID();var bytes=root.crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;return Array.from(bytes,function(b,i){return ([4,6,8,10].includes(i)?'-':'')+b.toString(16).padStart(2,'0');}).join('');}
 root.BazWorkAPI={get:function(a,p){return call(a,p||{},false);},post:function(a,p){return call(a,p||{},true);},id:id};
})(window);
