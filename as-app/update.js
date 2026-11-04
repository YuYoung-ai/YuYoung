(function(){
 'use strict';
 var current=document.documentElement.dataset.asRelease,root=new URL('./',document.currentScript.src),dirty=false,checking=null,target='',dismissed='';
 document.addEventListener('input',function(e){if(e.target.closest('form'))dirty=true;},true);
 document.addEventListener('change',function(e){if(e.target.closest('form'))dirty=true;},true);
 function saving(){return !!document.querySelector('form [aria-busy=true],#pending-note:not([hidden]),form button[type=submit]:disabled');}
 function move(){var url=new URL(location.href);url.searchParams.set('_v',target);location.replace(url.href);}
 function prompt(){
  if(!document.body||dismissed===target)return;var old=document.getElementById('app-update');if(old)return;
  var bar=document.createElement('aside');bar.id='app-update';bar.setAttribute('role','status');bar.style.cssText='position:fixed;bottom:16px;left:16px;right:16px;max-width:728px;margin:auto;padding:14px;border:1px solid #579bce;border-radius:12px;background:#173b55;color:#fff;z-index:10050;box-shadow:0 4px 20px #0003;display:flex;align-items:center;gap:10px;flex-wrap:wrap';
  var text=document.createElement('span');text.textContent='새 버전이 준비되었습니다. 입력을 마친 뒤 새로고침해 주세요.';text.style.flex='1 1 240px';
  var apply=document.createElement('button');apply.type='button';apply.textContent='새로고침';apply.onclick=function(){if(saving()){text.textContent='저장 또는 사진 첨부가 끝난 뒤 새로고침해 주세요.';return;}move();};
  var later=document.createElement('button');later.type='button';later.textContent='나중에';later.onclick=function(){dismissed=target;bar.remove();};bar.append(text,apply,later);document.body.append(bar);
 }
 function check(){
  if(checking||!current||!navigator.onLine)return checking||Promise.resolve();
  var ctl=new AbortController(),timer=setTimeout(function(){ctl.abort();},5000);
  checking=fetch(new URL('release.json',root),{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:ctl.signal}).then(function(r){if(!r.ok)throw Error();return r.json();}).then(function(release){
   if(!/^\d{1,8}$/.test(String(release.version||''))||release.version===current)return;target=String(release.version);
   if(!dirty&&!saving()&&new URL(location.href).searchParams.get('_v')!==target)move();else prompt();
  }).catch(function(){}).finally(function(){clearTimeout(timer);checking=null;});return checking;
 }
 window.QrAppUpdate={check:check};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',check,{once:true});else check();
 window.addEventListener('pageshow',function(e){if(e.persisted)check();});
 document.addEventListener('visibilitychange',function(){if(!document.hidden)check();});
 navigator.serviceWorker?.addEventListener('message',function(e){if(e.data?.type==='CUREJET_AS_UPDATED')check();});
})();
