import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code=fs.readFileSync(new URL('../js/baz-inspection-pdf-actions.js',import.meta.url),'utf8');
function surface(){
 const listeners=new Map();
 return {
  addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},
  emit(type,values={}){
   const event={type,button:0,pointerId:7,isPrimary:true,isTrusted:true,detail:1,
    preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...values};
   for(const fn of listeners.get(type)||[]){fn(event);if(event.stopped)break;}
   return event;
  }
 };
}
function fixture(mode='pointer',settleMs=0){
 const nodes=new Map(),calls=[],timers=[];
 const document=surface(),window={...surface(),navigator:{},setTimeout(fn,delay){timers.push({fn,delay});}};
 if(mode==='pointer')window.PointerEvent=function(){};
 if(mode==='touch'){window.ontouchstart=null;window.navigator.maxTouchPoints=5;}
 document.getElementById=id=>{
  if(!nodes.has(id)){const node={id,disabled:false};node.closest=tag=>tag==='button'?node:null;nodes.set(id,node);}
  return nodes.get(id);
 };
 vm.runInNewContext(code,{window,Promise,Map});
 const gate=window.BazInspectionPdfActions.create({window,document,settleMs});
 for(const id of ['generateBtn','previewBtn','blankPdfBtn'])gate.bind(id,()=>calls.push(id));
 const node=document.getElementById('generateBtn');
 const send=(type,extra={})=>document.emit(type,{target:node,...extra});
 function tap(extra={}){send('pointerdown',extra);send('pointerup',extra);return send('click',extra);}
 return {window,document,gate,node,nodes,calls,timers,send,tap};
}
const tick=async()=>{for(let i=0;i<4;i++)await Promise.resolve();};
async function activate(f){const ready=f.gate.activateAfter(Promise.resolve());f.timers.forEach(t=>t.fn());await ready;}

// A fast handover navigation can deliver only the release/click on this page.
const f=fixture('pointer',800);
let storageReady,prefillReady,workflowReady;
const ready=f.gate.activateAfter(Promise.all([
 new Promise(r=>storageReady=r),new Promise(r=>prefillReady=r),new Promise(r=>workflowReady=r)
]));
assert.equal(f.timers[0].delay,800);
assert.ok([...f.nodes.values()].every(n=>n.disabled));
f.tap();assert.equal(f.calls.length,0,'early double taps cannot create a PDF');
f.timers[0].fn();storageReady();workflowReady();await tick();
assert.equal(f.node.disabled,true,'prefill must finish even if storage/workflow already finished');
f.send('pointerdown');prefillReady();await ready;
assert.ok([...f.nodes.values()].every(n=>!n.disabled));
f.send('pointerup');assert.equal(f.send('click').prevented,true);
assert.equal(f.calls.length,0,'a press started before readiness must not become armed later');
f.send('pointerup');assert.equal(f.send('click').stopped,true);
assert.equal(f.calls.length,0,'release/click inherited from handover is rejected after readiness too');
assert.equal(f.send('click',{detail:0,pointerType:'touch'}).prevented,true,'zero-detail pointer clicks still require a fresh gesture');
assert.equal(f.send('click',{detail:0,isTrusted:false}).prevented,true,'programmatic click cannot generate a PDF');
f.tap();assert.deepEqual(f.calls,['generateBtn'],'a new complete touch works');
f.send('click');assert.equal(f.calls.length,1,'the same gesture cannot execute twice');
f.send('pointerdown');f.send('click');assert.equal(f.calls.length,1,'click without release is not a completed gesture');
f.send('pointerdown');f.send('pointercancel');f.send('pointerup');f.send('click');assert.equal(f.calls.length,1);
f.send('pointerdown');f.send('pointerup',{pointerId:8});f.send('click');assert.equal(f.calls.length,1);
f.send('pointerdown');f.send('pointerup');f.send('click',{pointerId:8});assert.equal(f.calls.length,1);
f.send('pointerdown');f.send('pointerup',{target:f.nodes.get('previewBtn')});f.send('click');assert.equal(f.calls.length,1);
for(const event of ['blur','pagehide']){f.send('pointerdown');f.send('pointerup');f.window.emit(event);f.send('click');}
f.send('pointerdown');f.send('pointerup');f.document.emit('visibilitychange');f.send('click');assert.equal(f.calls.length,1);
f.send('click',{detail:0,pointerId:-1});assert.equal(f.calls.length,2,'trusted keyboard/assistive activation works');
for(const id of ['previewBtn','blankPdfBtn']){f.tap({target:f.nodes.get(id)});assert.equal(f.calls.at(-1),id);}

// An already-completed gesture must also be discarded when readiness arrives.
const slow=fixture();let release;
const slowReady=slow.gate.activateAfter(new Promise(r=>release=r));
slow.send('pointerdown');slow.send('pointerup');slow.timers[0].fn();release();await slowReady;
slow.send('click');assert.equal(slow.calls.length,0);slow.tap();assert.equal(slow.calls.length,1);

// Legacy iOS: a synthetic mousedown on arrival must not arm the click guard.
const touch=fixture('touch');await activate(touch);
touch.send('mousedown');touch.send('mouseup');touch.send('click',{pointerId:undefined});assert.equal(touch.calls.length,0);
const touchStart={touches:[{identifier:2}],changedTouches:[{identifier:2}]};
touch.send('touchstart',touchStart);touch.send('touchend',{changedTouches:[{identifier:2}]});
touch.send('click',{pointerId:undefined});assert.deepEqual(touch.calls,['generateBtn']);
touch.send('touchstart',touchStart);touch.send('touchcancel');touch.send('touchend',{changedTouches:[{identifier:2}]});
touch.send('click',{pointerId:undefined});assert.equal(touch.calls.length,1);
const mouse=fixture('mouse');await activate(mouse);
mouse.send('mousedown');mouse.send('mouseup');mouse.send('click',{pointerId:undefined});assert.equal(mouse.calls.length,1);

const failed=fixture();const rejected=failed.gate.activateAfter(Promise.reject(new Error('storage')));
failed.timers[0].fn();await assert.rejects(rejected,/storage/);failed.tap();assert.equal(failed.node.disabled,true);assert.equal(failed.calls.length,0);

// Check the actual page uses the guard and waits for all initialization paths.
const html=fs.readFileSync(new URL('../inspection.html',import.meta.url),'utf8');
assert.match(html,/<script src="js\/baz-inspection-pdf-actions\.js\?v=345"><\/script>/);
assert.match(html,/window\.inspectionPrefillReady=\(async function consumePrefill/);
const wiring=html.slice(html.indexOf('const inspectionPdfActions='),html.indexOf("document.getElementById('doneSurvey').addEventListener"));
const wired=[],callbacks=[],pending={storage:{},prefill:{},workflow:{}};
const context={window:{BazInspectionPdfActions:{create:options=>{assert.equal(options.settleMs,800);return {bind:(id,fn)=>wired.push({id,fn}),activateAfter:promise=>{callbacks.push(promise);return Promise.resolve();}};}},BazWorkFlow:{route:()=>null},inspectionStorageReady:pending.storage,inspectionPrefillReady:pending.prefill,inspectionWorkflowReady:pending.workflow},document:{addEventListener:(type,fn)=>{assert.equal(type,'DOMContentLoaded');fn();}},location:{search:'?prefill=1'},URLSearchParams,Promise:{all:items=>items},generatePDF:value=>value};
vm.runInNewContext(wiring,context);
assert.deepEqual(wired.map(x=>x.id),['generateBtn','previewBtn','blankPdfBtn']);
assert.deepEqual(Array.from(callbacks[0]),Object.values(pending));
assert.equal(wired[0].fn(),false);assert.equal(wired[1].fn(),true);assert.equal(wired[2].fn().blank,true);
context.location.search='';context.window.BazWorkFlow.route=()=>({recordId:'record_123'});vm.runInNewContext(wiring,{...context});
context.window.BazWorkFlow.route=()=>null;
context.window.BazInspectionPdfActions.create=options=>{assert.equal(options.settleMs,0);return {bind(){},activateAfter:()=>Promise.resolve()};};
vm.runInNewContext(wiring,{...context});
for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))if(!/\bsrc=|application\/ld\+json/.test(match[1]))new vm.Script(match[2]);
console.log('inspection-pdf-actions: initialization and landing lock, inherited/duplicate clicks, fresh pointer/touch/mouse gestures, cancellation, keyboard/accessibility and page wiring passed.');
