(function(root){
 'use strict';
 // A click carried over from another page must never start a PDF. Require a
 // complete gesture on this document, after storage/prefill/workflow are ready.
 function create(options){
  const win=options.window,doc=options.document,actions=new Map();
  let enabled=false,gesture=null;
  const settled=new Promise(resolve=>win.setTimeout(resolve,options.settleMs||0));
  function button(event){
   const node=event.target?.closest?.('button');
   return actions.has(node)?node:null;
  }
  function start(event,id){
   const node=button(event);
   gesture=enabled&&node&&!node.disabled?{node,id,ended:false}:null;
  }
  function end(event,id){
   if(!gesture||gesture.id!==id||gesture.node!==button(event)){gesture=null;return;}
   gesture.ended=true;
  }
  function cancel(){gesture=null;}
  if(win.PointerEvent){
   doc.addEventListener('pointerdown',event=>{
    if(event.isPrimary===false||event.button!==0){cancel();return;}
    start(event,event.pointerId);
   },true);
   doc.addEventListener('pointerup',event=>end(event,event.pointerId),true);
   doc.addEventListener('pointercancel',cancel,true);
  }else{
   doc.addEventListener('touchstart',event=>{
    if(event.touches.length!==1){cancel();return;}
    start(event,event.changedTouches[0].identifier);
   },true);
   doc.addEventListener('touchend',event=>end(event,event.changedTouches[0].identifier),true);
   doc.addEventListener('touchcancel',cancel,true);
   // Old touch browsers synthesize mousedown after touchend. That event alone
   // cannot establish a new gesture on the destination page.
   if(!('ontouchstart' in win)&&!win.navigator?.maxTouchPoints){
    doc.addEventListener('mousedown',event=>{if(event.button===0)start(event,'mouse');},true);
    doc.addEventListener('mouseup',event=>end(event,'mouse'),true);
   }
  }
  win.addEventListener('blur',cancel);
  win.addEventListener('pagehide',cancel);
  doc.addEventListener('visibilitychange',cancel);
  doc.addEventListener('click',event=>{
   const node=button(event),previous=gesture;cancel();
   if(!node)return;
   // Keyboard and assistive technology generate trusted zero-detail clicks.
   const accessible=event.isTrusted&&event.detail===0&&!event.pointerType;
   const fresh=previous?.node===node&&previous.ended&&
    (event.pointerId==null||event.pointerId===previous.id);
   if(!enabled||node.disabled||!(accessible||fresh)){
    event.preventDefault();event.stopImmediatePropagation();return;
   }
   actions.get(node)();
  },true);
  return {
   bind(id,run){const node=doc.getElementById(id);node.disabled=true;actions.set(node,run);},
   async activateAfter(ready){
    await Promise.all([ready,settled]);cancel();enabled=true;
    actions.forEach((run,node)=>{node.disabled=false;});
   }
  };
 }
 root.BazInspectionPdfActions={create};
})(window);
