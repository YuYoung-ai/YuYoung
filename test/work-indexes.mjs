import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createWorkStore} from '../deno-auth/work-store.ts';
import {createWorkIndexes} from '../deno-auth/work-indexes.ts';
const fixture=fs.readFileSync(new URL('./work-kv.mjs',import.meta.url),'utf8');
const Kv=vm.runInNewContext('('+fixture.slice(fixture.indexOf('class Kv{'),fixture.indexOf('const kv=new Kv()')).trim()+')',{Map,structuredClone,JSON,String,Number,Infinity});
// Deno executes the same mutation suite against an isolated, real KV database.
const kv=globalThis.Deno?await Deno.openKv(':memory:'):new Kv(),s=createWorkStore(kv),idx=createWorkIndexes(kv),who={name:'CS',level:3},NS=s.NS;
await assert.rejects(()=>Promise.resolve(kv.atomic()),/AtomicOperation.*not a promise/,'the test runtime must reject uncommitted atomic operations returned by async helpers');
try{
const hospitals=[{id:'h1',key:'h1',name:'첫 병원',sales:'영업'},{id:'h2',key:'h2',name:'둘 병원',sales:'영업'},{id:'h3',key:'h3',name:'셋 병원',sales:'영업'}];
hospitals.push({id:'h4',key:'h4',name:'넷 병원',sales:'영업'},{id:'h5',key:'h5',name:'다섯 병원',sales:'영업'},{id:'h6',key:'h6',name:'여섯 병원',sales:'영업'});
const legacy=Array.from({length:150},(_,i)=>({id:'legacy_'+String(i).padStart(4,'0'),hospitalId:'unused_'+i,hospitalName:'과거 병원 '+i,status:'완료',visitAt:'2026-10-15T09:00',revision:1}));legacy[149]={...legacy[149],hospitalId:'h1',hospitalName:'첫 병원',status:'접수'};
await s.bridge('seed',{hospitals,requests:legacy,references:{engineers:['FSE','FSE2'],minimumLevel:1}});await s.bridge('activate',{manifest:await s.manifest()});
const form={hospitalKey:'h1',symptom:'중복 확인',cs:'CS',sales:'영업',engineer:'FSE',registeredAt:'2026-10-15T08:00',visitAt:'2026-10-15T12:00',status:'접수'};
const write=(action,p)=>s.handle({action,operationId:crypto.randomUUID(),...p},who);
assert.equal((await s.prepareIndexes()).ready,false);assert.equal((await write('work_save',{form})).duplicate,true,'partial backfill cannot miss an unprocessed legacy request');
while(!(await s.prepareIndexes()).ready){}
assert.equal(await idx.ready(),true);assert.equal((await write('work_save',{form})).duplicate,true);
const saveOperation={action:'work_save',operationId:crypto.randomUUID(),form:{...form,hospitalKey:'h2'}};
const saved=await s.handle(saveOperation,who);assert.ok(saved.success,saved.error);const r=saved.request;
const savedSeq=(await s.status()).seq;assert.deepEqual(await s.handle(saveOperation,who),saved);assert.equal((await s.status()).seq,savedSeq,'a successful save retry must not commit again');assert.equal(await idx.ready(),true);
assert.equal((await write('work_save',{form:{...form,hospitalKey:'h3'}})).overlaps[0].id,r.id);
let updated=await write('work_save',{id:r.id,baseRevision:r.revision,form:{...form,hospitalKey:'h2',engineer:'FSE2',visitAt:'2026-10-15T13:00'}});assert.ok(updated.success,updated.error);
assert.equal((await idx.conflicts({...r,id:'probe',hospitalId:'h3'})).overlaps.length,0,'old engineer/time keys are removed');
assert.equal((await idx.conflicts({...updated.request,id:'probe',hospitalId:'h3'})).overlaps.length,1);
updated=await write('work_status',{requestId:r.id,baseRevision:updated.request.revision,status:'완료'});assert.equal((await idx.conflicts({...updated.request,id:'probe'})).duplicates.length,0);assert.equal((await idx.visits('둘 병원','2026-10-15')).length,1,'completed visits still protect Handover ambiguity');
updated=await write('work_status',{requestId:r.id,baseRevision:updated.request.revision,status:'보류'});assert.equal((await idx.conflicts({...updated.request,id:'probe'})).duplicates.length,1);
updated=await write('work_delete',{requestId:r.id,baseRevision:updated.request.revision});assert.equal((await idx.conflicts({...updated.request,id:'probe'})).duplicates.length,0);assert.equal((await idx.visits('둘 병원','2026-10-15')).length,0);
updated=await write('work_restore',{requestId:r.id,baseRevision:updated.request.revision});assert.ok(updated.success,updated.error);assert.equal((await idx.conflicts({...updated.request,id:'probe'})).duplicates.length,1);
const concurrent=await Promise.all([write('work_save',{form:{...form,hospitalKey:'h4',engineer:'FSE',visitAt:'2026-10-16T10:00'}}),write('work_save',{form:{...form,hospitalKey:'h5',engineer:'FSE',visitAt:'2026-10-16T10:00'}})]);assert.equal(concurrent.filter(x=>x.success).length,1);assert.equal(concurrent.filter(x=>x.duplicate).length,1,'atomic sequence catches concurrent appointments');
// Simulate a writer from a rolled-back release that has no derived-index updates.
const meta=await kv.get([NS,'meta']);await kv.set([NS,'meta'],{...meta.value,seq:meta.value.seq+1});await kv.set([NS,'request','legacy_writer'],{...r,id:'legacy_writer',hospitalId:'h3',hospitalName:'셋 병원',engineer:'FSE2',visitAt:'2026-10-20T12:00'});
assert.equal(await idx.ready(),false);assert.equal((await write('work_save',{form:{...form,hospitalKey:'h3',visitAt:'2026-10-20T12:00',engineer:'FSE2'}})).duplicate,true);
while(!(await s.prepareIndexes()).ready){}assert.equal((await idx.conflicts({id:'probe',hospitalId:'h3',engineer:'FSE2',visitAt:'2026-10-20T12:00'})).overlaps[0].id,'legacy_writer');
let current=(await s.handle({action:'work_detail',id:r.id},who)).request;await write('work_status',{requestId:r.id,baseRevision:current.revision,status:'방문예정'});
let fullScans=0;const originalList=kv.list.bind(kv);kv.list=(selector,options)=>{if(JSON.stringify(selector.prefix)==JSON.stringify([NS,'request']))fullScans++;return originalList(selector,options);};
await s.ingestSources([{recordId:'report_indexed',hospitalName:'둘 병원',date:'2026-10-15',sn:'DIFFERENT-SN',gubun:'A/S',detail:'최신 처리 내용',result:'수리',version:'v1',observedAt:new Date().toISOString()}],undefined,r.id);
let detail=await s.handle({action:'work_detail',id:r.id},who);assert.equal(detail.history.filter(h=>h.kind==='result'&&h.source.recordId==='report_indexed').length,1);assert.equal(fullScans,0,'targeted Handover ingestion and automatic linking must not scan all requests');
assert.equal((await s.handle({action:'work_index_prepare'},{name:'',level:0})).success,false);
const unassigned=await write('work_save',{form:{...form,hospitalKey:'h6',engineer:'',visitAt:'2026-10-22T12:00'}});assert.ok(unassigned.success,unassigned.error);
const claimed=await s.handle({action:'work_claim',requestId:unassigned.request.id,baseRevision:unassigned.request.revision,expectedEngineer:'FSE2',operationId:crypto.randomUUID()},{...who,engineer:'FSE2'});assert.ok(claimed.success,claimed.error);
const commented=await write('work_history_add',{requestId:claimed.request.id,body:'실제 KV 댓글 저장 검증'});assert.ok(commented.success,commented.error);assert.equal((await s.handle({action:'work_detail',id:claimed.request.id},who)).history[0].body,'실제 KV 댓글 저장 검증');assert.equal(await idx.ready(),true);
for await(const entry of kv.list({prefix:[NS,'queryIndex','hospital']}))assert.deepEqual(Object.keys(entry.value),['id'],'lookup keys must not duplicate clinical text');
console.log('work-indexes: resumable partial backfill/fallback, exact conflicts, appointment updates, completion/hold/trash/restore, live-date ambiguity, concurrent saves, old-writer detection/rebuild, ACL and metadata-only keys passed.');
}finally{kv.close?.();}
