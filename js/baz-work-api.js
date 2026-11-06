(function(root){
 'use strict';var URL='https://yuyoung-production.coaptation.workers.dev';
 async function call(action,params,write,options){
  if(root.BazQrRuntime){
   if(root.BazQrRuntime.api!=='/_local/api'&&!(root.BazQrRuntime.environment==='pilot'&&root.BazQrRuntime.api===URL))throw new Error('QR 업무 API 설정을 확인하세요.');
   URL=root.BazQrRuntime.api;
  }
  var measured=root.BazPerf?root.BazPerf.start(action):function(){},timing={};
  var ctl=new AbortController(),parent=options&&options.signal,rejectLocal,timedOut=false;
  var local=new Promise(function(_,reject){rejectLocal=reject;});
  function stop(timeout){timedOut=timeout;ctl.abort();var e=new Error(timeout?'응답 대기 시간이 지났습니다.':'확인이 중단되었습니다.');e.name='AbortError';rejectLocal(e);}
  var abort=function(){stop(false);},ms=action==='work_document_status'?20000:action==='work_document_retry'?35000:action.indexOf('qr_')===0||root.BazQrRuntime&&action==='work_status'?35000:action.indexOf('work_flow_')===0?45000:action.indexOf('work_handover_')===0||action==='work_references_refresh'?35000:15000;
  var timer=setTimeout(function(){stop(true);},ms);
  if(parent)parent.addEventListener('abort',abort,{once:true});
  try{var token=root.BazAuth.token();if(parent&&parent.aborted){abort();return await local;}
   return await Promise.race([local,(async function(){var response=await fetch(URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(Object.assign({},params,{action:action,token:token})),signal:ctl.signal,cache:'no-store'}),data=await response.json();if(response.headers){var header=response.headers.get('Server-Timing')||'',server=header.match(/work;dur=([\d.]+)/),google=header.match(/gas;dur=([\d.]+)/);if(server)timing.serverMs=Number(server[1]);if(google)timing.googleMs=Number(google[1]);}if(root.BazAuth.token()!==token)throw new Error('로그인 계정이 변경되었습니다. 다시 접수에서 열어 주세요.');if(!data||typeof data.success!=='boolean')throw new Error('업무 서버 응답을 확인하지 못했습니다.');return data;})()]);
  }
  catch(e){var error=new Error(e.name==='AbortError'?(timedOut?'응답 대기 시간이 지났습니다.':'확인이 중단되었습니다.'):e.message||'연결 실패');error.unknown=!!write;error.timeout=timedOut;error.aborted=!!(parent&&parent.aborted);throw error;}
  finally{clearTimeout(timer);if(parent)parent.removeEventListener('abort',abort);measured(timing);}
 }
 function id(){if(typeof root.crypto?.randomUUID==='function')return root.crypto.randomUUID();var bytes=root.crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;return Array.from(bytes,function(b,i){return ([4,6,8,10].includes(i)?'-':'')+b.toString(16).padStart(2,'0');}).join('');}
 root.BazWorkAPI={get:function(a,p,o){return call(a,p||{},false,o);},post:function(a,p,o){return call(a,p||{},true,o);},id:id};
})(window);
