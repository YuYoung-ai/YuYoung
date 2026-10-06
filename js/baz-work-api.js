(function(root){
 'use strict';var URL='https://yuyoung.yuyoung-ai.deno.net';
 async function call(action,params,write){
  var ctl=new AbortController(),timer=setTimeout(function(){ctl.abort();},action==='work_flow_preview'?45000:action.indexOf('work_handover_')===0?35000:15000);
  try{var response=await fetch(URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(Object.assign({},params,{action:action,token:root.BazAuth.token()})),signal:ctl.signal,cache:'no-store'}),data=await response.json();if(!data||typeof data.success!=='boolean')throw new Error('업무 서버 응답을 확인하지 못했습니다.');return data;}
  catch(e){var error=new Error(e.name==='AbortError'?'응답 대기 시간이 지났습니다.':e.message||'연결 실패');error.unknown=!!write;throw error;}
  finally{clearTimeout(timer);}
 }
 root.BazWorkAPI={get:function(a,p){return call(a,p||{},false);},post:function(a,p){return call(a,p||{},true);},id:function(){return root.crypto.randomUUID();}};
})(window);
