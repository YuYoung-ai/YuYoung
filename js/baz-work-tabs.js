(function(root){
 'use strict';
 var nav=document.getElementById('work-management-tabs'),tabs=new Map();
 var params=new URLSearchParams(location.search);
 var wanted=params.get('view')||(params.get('qr')?'customers':'service'),active='service';
 if(params.get('entry')==='inspection-search'||!['service','demo','customers','reservations','field-records'].includes(wanted))wanted='service';

 function render(){
  var selected=tabs.get(active);
  document.body.dataset.workView=active;
  tabs.forEach(function(tab,name){
   var on=name===active;
   tab.panel.hidden=tab.panel!==selected.panel;
   tab.button.setAttribute('aria-selected',String(on));
   tab.button.tabIndex=on?0:-1;
  });
  selected.panel.setAttribute('aria-labelledby',selected.button.id);
 }
 function show(name){
  if(!tabs.has(name))return;
  var measured=root.BazPerf?root.BazPerf.start('tab_paint'):function(){};
  requestAnimationFrame(function(){measured();});
  wanted=active=name;
  render();
  var url=new URL(location.href);
  url.searchParams.delete('qr');
  url.searchParams.set('view',name);
  history.replaceState(history.state,'',url);
  root.dispatchEvent(new CustomEvent('baz-work-tab',{detail:{name:name}}));
 }
 function register(name,button,panel){
  tabs.set(name,{button:button,panel:panel});
  button.hidden=false;
  button.setAttribute('role','tab');
  button.setAttribute('aria-controls',panel.id);
  panel.setAttribute('role','tabpanel');
  button.onclick=function(){show(name);};
  if(name===wanted)show(name);
  else render();
 }
 function unregister(name){
  var tab=tabs.get(name);if(!tab)return;
  if(active===name)show('service');
  tab.button.hidden=true;tab.panel.hidden=true;tabs.delete(name);
 }
 root.BazWorkTabs={register:register,unregister:unregister,show:show,current:function(){return active;}};
 nav.addEventListener('keydown',function(e){if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;var buttons=Array.from(nav.querySelectorAll('[role=tab]:not([hidden])')),index=buttons.indexOf(document.activeElement);if(index<0)return;e.preventDefault();index=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[index].click();buttons[index].focus();});
 var panel=document.getElementById('service-panel');
 register('service',document.getElementById('service-tab'),panel);
 register('demo',document.getElementById('demo-tab'),panel);
 nav.hidden=false;
})(window);
