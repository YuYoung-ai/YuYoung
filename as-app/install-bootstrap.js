// Capture the browser-owned install event before deferred modules or API work.
(function(root){
 'use strict';if(root.CurejetInstall)return;
 var event=null,busy=false,installed=false,outcome='',subscribers=new Set(),preparation=null,startedAt=Date.now();
 var scriptURL=document.currentScript?.src||location.href;
 function prepare(){if(preparation)return preparation;if(!root.isSecureContext||!navigator.serviceWorker)return Promise.resolve(null);try{var url=new URL('sw.js?v=325',scriptURL);preparation=navigator.serviceWorker.register(url,{scope:new URL('./',url).pathname,updateViaCache:'none'}).catch(function(){return null;});}catch(e){preparation=Promise.resolve(null);}return preparation;}
 function state(){return {ready:!!event&&!busy&&!installed,busy:busy,installed:installed,outcome:outcome,supported:'onbeforeinstallprompt' in root};}
 function publish(){subscribers.forEach(function(f){try{f(state());}catch(e){}});}
 root.addEventListener('beforeinstallprompt',function(e){e.preventDefault();if(installed)return;event=e;outcome='';publish();});
 root.addEventListener('appinstalled',function(){installed=true;event=null;outcome='installed';publish();});
 root.CurejetInstall=Object.freeze({startedAt:startedAt,prepare:prepare,state:state,subscribe:function(f){subscribers.add(f);f(state());return function(){subscribers.delete(f);};},prompt:function(){
  if(!event||busy||installed)return Promise.reject(Error('install-not-ready'));
  var current=event;event=null;busy=true;outcome='';publish();var pending;
  // Call prompt synchronously inside the trusted click; no fetch/worker/timer await first.
  try{pending=current.prompt();}catch(e){busy=false;outcome='failed';publish();return Promise.reject(e);}
  return Promise.resolve(pending).then(function(){return current.userChoice;}).then(function(choice){if(!installed)outcome=choice.outcome==='accepted'?'accepted':'dismissed';return choice;}).catch(function(e){if(!installed)outcome='failed';throw e;}).finally(function(){busy=false;publish();});
 }});
 prepare();
})(window);
