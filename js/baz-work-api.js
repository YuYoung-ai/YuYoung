(function(root){
  'use strict';
  var URL='https://script.google.com/macros/s/AKfycbwhf3fnxQPSM4cDLVEls0gtGgVGIpNOP83gMiBn-7JZmWciIsAlxyf4cYmPRiA2Ct0/exec';
  var DENO='https://yuyoung.yuyoung-ai.deno.net',denoReady=false;
  // 첫 요청도 활성화된 Deno 중계를 사용한다. 설정 조회는 최대 1.5초만 기다린다.
  // OFF/실패/시간 초과면 GAS 사용. 늦게 도착한 설정은 이후 요청부터 적용한다.
  var configReady=new Promise(function(resolve){
    var timer=setTimeout(resolve,1500);
    Promise.resolve().then(function(){return root.BazAuth.config?root.BazAuth.config():null;})
      .then(function(c){denoReady=!!(c&&c.ok&&c.workApi===true);},function(){})
      .then(function(){clearTimeout(timer);resolve();});
  });
  function id(){return root.crypto.randomUUID();}
  async function call(action,params,write){
    await configReady;
    var ctl=new AbortController(),timer=setTimeout(function(){ctl.abort();},35000);
    var payload=Object.assign({},params,{action:action,token:root.BazAuth.token()});
    var url=denoReady?DENO:URL,options={signal:ctl.signal,cache:'no-store'};
    if(write||denoReady){options.method='POST';options.headers={'Content-Type':'text/plain;charset=utf-8'};options.body=JSON.stringify(payload);}
    else url+='?'+new URLSearchParams(payload);
    try{
      var response=await fetch(url,options),text=await response.text(),data;
      try{data=JSON.parse(text);}catch(e){throw new Error('서버 응답을 확인하지 못했습니다.');}
      if(!data||typeof data.success!=='boolean')throw new Error('서버 응답 형식이 올바르지 않습니다.');
      return data;
    }catch(e){
      var error=new Error(e.name==='AbortError'?'응답 대기 시간이 지났습니다.':e.message||'연결 실패');
      error.unknown=!!write;throw error;
    }finally{clearTimeout(timer);}
  }
  root.BazWorkAPI={get:function(a,p){return call(a,p||{},false);},post:function(a,p){return call(a,p||{},true);},id:id};
})(window);
