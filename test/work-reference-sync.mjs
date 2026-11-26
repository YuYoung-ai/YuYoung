import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import vm from 'node:vm';
const bundled=process.env.INSPECTION_TEST_STORE;
if(bundled)globalThis.Deno={env:{get:()=>''},cron(){},serve(){}};
const {createWorkStore}=await import(bundled?pathToFileURL(bundled):'../deno-auth/work-store.ts');

const root=new URL('../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
const fixture=read('test/work-kv.mjs');
const Kv=vm.runInNewContext('('+fixture.slice(fixture.indexOf('class Kv{'),fixture.indexOf('const kv=new Kv()')).trim()+')',
 {Map,structuredClone,JSON,String,Number,Infinity});
const hospital=(key,sales='기존')=>({id:key,key,name:key,sn:'SN1',region:'서울',sales});
const original=[hospital('가상 A'),hospital('가상 B')];
const legacy={...hospital('flow_example'),origin:'flow'};
const snapshot=(hospitals,extras={})=>({hospitals,hospitalCount:hospitals.length,references:{engineers:[],minimumLevel:1},...extras});
const sql=new Kv(),store=createWorkStore(sql);
await store.bridge('seed',snapshot([...original,legacy]));
await store.bridge('activate',{manifest:await store.manifest()});
const getHospital=key=>sql.get([store.NS,'hospitalRef',key]);
const txFor=sql.atomic.bind(sql);
let batch=0,failOnBatch=0,hospitalCommits=[];
sql.atomic=()=>{
 const tx=txFor(),set=tx.set,del=tx.delete,commit=tx.commit,ops=[];
 tx.set=(key,v)=>{if(key[1]==='hospitalRef')ops.push(['set',key[2]]);return set(key,v);};
 tx.delete=key=>{if(key[1]==='hospitalRef')ops.push(['delete',key[2]]);return del(key);};
 tx.commit=async()=>{
  if(ops.length&&++batch===failOnBatch)throw Error('simulated D1 timeout');
  const result=await commit();
  if(result.ok&&ops.length)hospitalCommits.push(ops);
  return result;
 };
 return tx;
};
const unchanged=await store.bridge('references',snapshot(original.toReversed()));
assert.equal(unchanged.upserted,0);assert.equal(unchanged.removed,0);assert.deepEqual(hospitalCommits,[]);
assert.equal((await store.bridge('references',snapshot([hospital('가상 A','변경'),original[1]]))).upserted,1);
assert.deepEqual(hospitalCommits,[ [['set','가상 A']] ]);
const corrected=hospital('가상 B 지역 수정');
const renamed=await store.bridge('references',snapshot([hospital('가상 A','변경'),corrected]));
assert.equal(renamed.upserted,1);assert.equal(renamed.removed,1);
assert.deepEqual(hospitalCommits.at(-1),[['set',corrected.key],['delete',original[1].key]]);
assert.equal((await getHospital(legacy.key)).value.origin,'flow');
const beforeValidation=hospitalCommits.length;
await assert.rejects(()=>store.bridge('references',snapshot([])),/전체 목록/);
await assert.rejects(()=>store.bridge('references',snapshot([corrected],{hospitalCount:2})),/전체 목록/);
await assert.rejects(()=>store.bridge('references',snapshot([corrected,{...corrected,sales:'중복'}])),/중복 항목/);
assert.equal(hospitalCommits.length,beforeValidation);

const many=[hospital('가상 A','변경'),corrected,...Array.from({length:12},(_,i)=>hospital('추가 '+i))];
const start=Date.now()-90000,firstAt=new Date(start).toISOString(),nextAt=new Date(start+1000).toISOString();
// Separate fixture generations ensure these snapshots can be ordered with a fixed clock.
const reset=await sql.get([store.NS,'referenceRefresh']);
await txFor().check(reset).delete(reset.key).commit();
batch=0;hospitalCommits=[];failOnBatch=2;
await assert.rejects(()=>store.bridge('references',snapshot(many,{snapshotStartedAt:firstAt,reportSync:true})),/D1 timeout/);
assert.equal(hospitalCommits.flat().length,8);
assert.equal((await getHospital('추가 11')).value,null);
failOnBatch=0;hospitalCommits=[];
const resumed=await store.bridge('references',snapshot(many,{snapshotStartedAt:nextAt,reportSync:true}));
assert.equal(resumed.upserted,4);assert.equal(hospitalCommits.flat().length,4);
assert.equal((await store.bridge('references',snapshot(original,{snapshotStartedAt:firstAt,reportSync:true}))).stale,true);
assert.equal((await getHospital('추가 11')).value.key,'추가 11');
assert.equal((await store.bridge('references_status',{checkedAt:nextAt,error:'late lost response'})).stale,true);

const gasPath='hospital_work_kv_gas.gs',uiPath='js/baz-work-manager.js';
const renderSource=code=>code.slice(code.indexOf('  function renderBridgeStatus('),code.indexOf('  function err('));
const origin=Date.now()-600000;
const baseline=process.argv[2];
const old=path=>execFileSync('git',['show',baseline+':'+path],{cwd:fileURLToPath(root),encoding:'utf8'});

async function timeScenario(gas,ui,failReferences){
 let clock=origin,acked=false,sent=false,ackedMs,displayMs,referenceDeadline,backend={},badge;
 const calls=[],updates=[],values={HOSPITAL_WORK_KV_STAGE:'active'},nodes=new Map(),records=new Map();
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const props={getProperty:key=>values[key]||'',setProperty:(key,value)=>{values[key]=value;}};
 const vmContext=vm.createContext({Date:ClockDate,Logger:{log(){}},PropertiesService:{getScriptProperties:()=>props}});
 vm.runInContext(gas,vmContext);
 const $=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',dataset:{}});return nodes.get(id);};
 const view=vm.createContext({Date:ClockDate,bridgeStatus:null,time:x=>x,$,Number});
 vm.runInContext(renderSource(ui),view);
 const source={recordId:'test_source',version:'v1',hospitalName:'가상 A',date:'2026-11-26',gubun:'점검'};
 const raw=[['test_source_v1',source.recordId,source.version,JSON.stringify(source),'pending',new ClockDate().toISOString()]];
 const sheet={getLastRow:()=>raw.length+1,getRange:(row,col,_n,width)=>({
  getValues:()=>[raw[row-2].slice(col-1,col-1+width)],
  setValue:state=>{raw[row-2][col-1]=state;sent=state==='sent';clock+=20;}
 })};
 const workflow=makeStatusStore();
 async function bridgeUpdates(){
  for(const event of updates.splice(0)){
   if(event.verb==='references')await workflow.bridge('references',event.payload);
   else await workflow.bridge(event.verb,event.payload);
   backend=(await workflow.handle({action:'work_sync',revision:'0'},{name:'가상',level:1})).bridgeStatus;
   view.bridgeStatus=backend;view.renderBridgeStatus();
   if(displayMs===undefined&&backend?.pendingCount===0&&!backend.error){
    displayMs=event.ms;badge=$('handover-pending').textContent;
   }
  }
 }
 Object.assign(vmContext,{
  hwResetContext_(){},hwKvPrepareSheets_(){},hwKvRecoverFields_(){},hwKvRefreshSources_:()=>[],
  hwKvQueueHits_(){},hwLock_:fn=>fn(),hwKvDeliverDocuments_(){},
  hwKvRefs_:()=>snapshot(original),hwKvHash_:()=>'fixture',hwKvControl_(){},
  hwKvSheet_:()=>sheet,hwKvSourceById_:()=>source,
  hwKvCall_(verb,payload){
   calls.push(verb);
   if(verb==='pending'){clock+=90;return {events:[],more:false};}
   if(verb==='sources'){
    clock+=1100;ackedMs??=clock-origin;acked=true;
    for(const s of payload.sources)records.set(s.recordId+'_'+s.version,s);
    return {success:true};
   }
   if(verb==='references'){
    clock+=failReferences?60000:2500;
    if(failReferences){referenceDeadline=clock-origin;throw new Error('backend_unavailable');}
   }else clock+=100;
   updates.push({verb,payload:JSON.parse(JSON.stringify(payload)),ms:clock-origin});
   return {success:true};
  }
 });
 await workflow.ready;
 const updated=gas===read(gasPath);
 if(failReferences&&!updated)assert.throws(()=>vmContext.syncHospitalWorkKv(),/backend_unavailable/);
 else vmContext.syncHospitalWorkKv();
 assert.ok(acked&&sent,'the original snapshot was acknowledged and marked sent');
 await bridgeUpdates();
 const final={badge:$('handover-pending').textContent,ref:$('work-reference-sync').textContent,error:backend.error};
 const handoverSnapshotMs=Date.parse(backend.checkedAt)-origin;
 const firstCalls=[...calls];
 if(failReferences&&updated){
  assert.equal(backend.pendingCount,0);assert.equal(backend.error,'');
  assert.equal(backend.referenceSync.error,'backend_unavailable');
  assert.equal(final.ref,'병원 기준정보 갱신 실패 · 재시도 예정');
  assert.equal(final.badge,'Handover 대기 0건 · 전송 정상');
  $('sync-state').dataset.state='error';view.renderBridgeStatus();
  assert.match($('handover-checked').textContent,/최신 상태 확인 지연/);
  assert.equal($('handover-pending').dataset.state,'waiting');
  $('sync-state').dataset.state='done';view.renderBridgeStatus();
  assert.ok(displayMs<referenceDeadline);
  failReferences=false;clock+=5*60000;
  assert.equal(vmContext.syncHospitalWorkKv(),'업무 연동 완료');
  await bridgeUpdates();
  assert.equal(backend.referenceSync.error,'');assert.equal(records.size,1);
  assert.equal(calls.filter(x=>x==='sources').length,1);
  assert.equal($('work-reference-sync').hidden,true);
 }
 return {ackedMs,displayMs:displayMs??null,handoverSnapshotMs,
  referenceDeadline,badge,final,firstCalls};
}
function makeStatusStore(){
 const s=createWorkStore(new Kv());
 s.ready=(async()=>{
  await s.bridge('seed',snapshot(original));await s.bridge('activate',{manifest:await s.manifest()});
 })();
 return s;
}
const clean=await timeScenario(read(gasPath),read(uiPath),false);
const stalled=await timeScenario(read(gasPath),read(uiPath),true);
assert.deepEqual(clean.firstCalls,['pending','sources','sync_status','references']);
assert.deepEqual(stalled.firstCalls,[...clean.firstCalls,'references_status']);
if(baseline){
 const oldClean=await timeScenario(old(gasPath),old(uiPath),false),oldStall=await timeScenario(old(gasPath),old(uiPath),true);
 assert.equal(clean.ackedMs,oldClean.ackedMs);
 assert.equal(stalled.ackedMs,oldStall.ackedMs);
 assert.equal(clean.firstCalls.length,oldClean.firstCalls.length);
 assert.ok(clean.displayMs<oldClean.displayMs);
 assert.equal(oldStall.displayMs,null);
 assert.match(oldStall.final.badge,/연동 오류/);
 console.log(JSON.stringify({simulatedMs:{normal:{old:oldClean,new:clean},timeout:{old:oldStall,new:stalled}}}));
}
console.log('PASS: exact reference diff, Flow preservation, partial resume, stale rejection, independent Handover status and lost-response protection.');
