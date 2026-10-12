import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createWorkStore} from '../deno-auth/work-store.ts';

// No real Sheets, credentials, tokens, or network calls. Actual queue/worker,
// KV status validation and page badge code run against an in-memory fixture.
const root=new URL('../',import.meta.url);
const queueCode=fs.readFileSync(new URL('hospital_work_kv_gas.gs',root),'utf8');
const workCode=fs.readFileSync(new URL('hospital_work_gas.gs',root),'utf8');
const uiCode=fs.readFileSync(new URL('js/baz-work-manager.js',root),'utf8');
const kvTest=fs.readFileSync(new URL('test/work-kv.mjs',root),'utf8');
const Kv=vm.runInNewContext('('+kvTest.slice(kvTest.indexOf('class Kv{'),kvTest.indexOf('const kv=new Kv()')).trim()+')',{Map,structuredClone,JSON,String,Number,Infinity});
const actualHook=workCode.slice(workCode.indexOf('function hospitalWorkHandoverSaved_('),workCode.indexOf('function hwReadWithAuto_('));
const candidateHook=actualHook;
const baselineHook='function hospitalWorkHandoverSaved_(hospitalName,date){if(hwKvMode_()){hwKvQueueSources_(hospitalName,date);return {enabled:true,pending:true,completed:0};}}';
const badgeCode=uiCode.slice(uiCode.indexOf('  function renderBridgeStatus('),uiCode.indexOf('  function err('));
const results=[];

async function scenario(mode){
 let clock=Date.now()-3600000,raw=[],sources=[],calls=[],failStatus=false,failDelivery=false,broken=new Set();
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const values={HOSPITAL_WORK_KV_STAGE:'active'},nodes=new Map();
 const props={getProperty:k=>values[k]||'',setProperty:(k,v)=>{values[k]=v;}};
 const sheet={getLastRow:()=>raw.length+1,getRange:(row,col,n=1,width=1)=>({
  getValues:()=>raw.slice(row-2,row-2+n).map(r=>r.slice(col-1,col-1+width)),
  setValues:vs=>vs.forEach((r,i)=>{raw[row-2+i]=r;}),
  setValue:v=>{raw[row-2][col-1]=v;},
  createTextFinder:id=>{const finder={matchEntireCell:()=>finder,findNext:()=>{const i=raw.findIndex(r=>r[col-1]===id);return i<0?null:{getRow:()=>i+2};}};return finder;}
 })};
 const kv=new Kv(),store=createWorkStore(kv);
 await store.bridge('seed',{references:{engineers:[],minimumLevel:1},hospitals:[]});await store.bridge('activate',{manifest:await store.manifest()});
 const pendingCalls=[];
 const context={Date:ClockDate,Logger:{log(){}},PropertiesService:{getScriptProperties:()=>props}};
 vm.createContext(context);vm.runInContext(queueCode,context);vm.runInContext(mode==='current'?baselineHook:candidateHook,context);
 context.safeCell_=x=>x;context._issueDateNorm_=x=>x;context.hwSources_=()=>sources.map(source=>({source}));context.hwKvStableSource_=()=>{};context.hwKvSheet_=()=>sheet;context.hwKvControl_=()=>{};context.hwLock_=fn=>fn();
 context.hwKvSourceById_=id=>{if(broken.has(id))throw new Error('가상 원본 오류');return sources.find(s=>s.recordId===id);};
 context.hwKvCall_=(verb,payload)=>{
  calls.push({verb,payload:JSON.parse(JSON.stringify(payload))});
  if(verb==='sync_status'){if(failStatus)throw new Error('가상 집계 전송 오류');pendingCalls.push(store.bridge('sync_status',JSON.parse(JSON.stringify(payload))));}
  if(verb==='sources'&&failDelivery)throw new Error('가상 전송 오류');
  return {success:true};
 };
 const flush=async()=>{for(const p of pendingCalls.splice(0))await p;};
 const $=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',dataset:{}});return nodes.get(id);};
 const page={bridgeStatus:null,Date:ClockDate,Number,time:x=>x,$};vm.createContext(page);vm.runInContext(badgeCode,page);
 async function view(stage){await flush();const sync=await store.handle({action:'work_sync',revision:'0'},{name:'가상 CS',level:1});page.bridgeStatus=sync.bridgeStatus;page.renderBridgeStatus();const rows=context.hwKvPendingRows_();const item={mode,stage,actualPending:new Set(rows.map(r=>r.id)).size,events:rows.length,displayedCount:sync.bridgeStatus?.pendingCount??null,badge:$('handover-pending').textContent,failed:sync.bridgeStatus?.failedCount??null};results.push(item);return item;}
 const save=async(id,version=1,gubun='A/S')=>{clock+=1000;const source={recordId:id,version:String(version),hospitalName:'가상 병원 '+id,date:'2026-10-12',gubun};sources=sources.filter(s=>s.recordId!==id).concat(source);context.hospitalWorkHandoverSaved_('가상 병원 '+id,'2026-10-12');await flush();};
 context.hwKvPublishStatus_('',[]);await view('초기 대기 0건');
 await save('A');const first=await view('A/S 1건 저장 직후');assert.equal(first.actualPending,1);assert.equal(first.displayedCount,mode==='current'?0:1);
 await save('B',1,'점검');const second=await view('점검 추가 · 총 2건');assert.equal(second.actualPending,2);assert.equal(second.displayedCount,mode==='current'?0:2);
 await save('A',2);const repeated=await view('동일 기록 재수정');assert.equal(repeated.actualPending,2);assert.equal(repeated.events,3);assert.equal(repeated.displayedCount,mode==='current'?0:2);
 if(mode==='current'){
  clock+=1000;context.hwKvDeliverSources_();context.hwKvPublishStatus_('',[]);const after=await view('5분 작업 전송 후');assert.equal(after.displayedCount,0);assert.equal(after.actualPending,0);return;
 }
 failDelivery=true;clock+=1000;assert.throws(()=>context.hwKvDeliverSources_(),/전송 오류/);context.hwKvPublishStatus_('전송 오류',[]);const failed=await view('전송 실패 · 재시도 보존');assert.equal(failed.displayedCount,2);assert.equal(failed.actualPending,2);
 failDelivery=false;broken.add('B');clock+=1000;const partial=context.hwKvDeliverSources_();context.hwKvPublishStatus_(partial.error,partial.failedIds);const partialView=await view('정상 1건 전송 · 오류 1건 유지');assert.equal(partialView.displayedCount,1);assert.equal(partialView.failed,1);
 await save('C');const stillFailed=await view('추가 저장 시 기존 원본 오류 보존');assert.equal(stillFailed.displayedCount,2);assert.equal(stillFailed.failed,1);
 broken.clear();clock+=1000;const done=context.hwKvDeliverSources_();context.hwKvPublishStatus_(done.error,done.failedIds);const doneView=await view('재시도 성공');assert.equal(doneView.displayedCount,0);assert.equal(doneView.actualPending,0);
 raw=[];sources=[];for(let i=0;i<25;i++)await save('bulk'+i);clock+=1000;const bulk=context.hwKvDeliverSources_();context.hwKvPublishStatus_(bulk.error,bulk.failedIds);const remainder=await view('25건 중 20건 전달');assert.equal(remainder.displayedCount,5);assert.equal(remainder.actualPending,5);
 raw=[];sources=[];clock+=1000;context.hwKvPublishStatus_('',[]);await flush();failStatus=true;await save('statusfail');assert.equal(context.hwKvPendingRows_().length,1,'count-publication failure must retain saved queue');await view('집계 통신 실패 · 대기열 보존');
 failStatus=false;clock+=1000;context.hwKvPublishStatus_('',[]);const recovered=await view('집계 재시도');assert.equal(recovered.displayedCount,1);
 page.bridgeStatus={...(await store.handle({action:'work_sync',revision:'0'},{name:'가상 CS',level:1})).bridgeStatus};clock+=11*60000;page.renderBridgeStatus();assert.ok($('handover-pending').textContent.includes('이전 집계'));
 results.push({mode,stage:'11분간 PC 동기화 없음',actualPending:1,events:1,displayedCount:1,badge:$('handover-pending').textContent,failed:0});
}
await scenario('current');await scenario('candidate');
console.log('work-queue-save: reproduced previous stale zero; actual save hook publishes counts, groups versions, preserves errors and durable queue after failures, worker recovery, batch remainder and stale display passed.');
