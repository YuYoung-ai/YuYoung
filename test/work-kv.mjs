import assert from 'node:assert/strict';
import {createWorkStore} from '../deno-auth/work-store.ts';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
// Versioned fixture exercises actual transactions, including interleaving/replayed writes.
class Kv{
 data=new Map();seq=0;
 async get(key){const x=this.data.get(JSON.stringify(key));return {key,value:x?structuredClone(x.value):null,versionstamp:x?.version||null};}
 async set(key,value){this.data.set(JSON.stringify(key),{key,value:structuredClone(value),version:String(++this.seq)});}
 async delete(key){this.data.delete(JSON.stringify(key));}
 atomic(){const checks=[],sets=[],deletes=[];const self=this;const tx={check(...e){checks.push(...e);return tx;},set(k,v){sets.push([k,v]);return tx;},delete(k){deletes.push(k);return tx;},async commit(){for(const e of checks){if((self.data.get(JSON.stringify(e.key))?.version||null)!==e.versionstamp)return {ok:false};}for(const [k,v]of sets)self.data.set(JSON.stringify(k),{key:k,value:structuredClone(v),version:String(++self.seq)});for(const k of deletes)self.data.delete(JSON.stringify(k));return {ok:true};}};return tx;}
 list(selector,options={}){
  const compare=(a,b)=>{for(let i=0;i<Math.min(a.length,b.length);i++){if(a[i]===b[i])continue;if(typeof a[i]!==typeof b[i])return typeof a[i]==='number'?-1:1;return a[i]<b[i]?-1:1;}return a.length-b.length;};
  let rows=[...this.data.values()].filter(e=>selector.prefix?selector.prefix.every((x,i)=>e.key[i]===x):compare(e.key,selector.start)>=0&&compare(e.key,selector.end)<0).sort((a,b)=>compare(a.key,b.key));if(options.reverse)rows.reverse();const offset=Number(options.cursor||0);rows=rows.slice(offset,offset+(options.limit||Infinity));const it={cursor:String(offset+rows.length),async *[Symbol.asyncIterator](){for(const e of rows)yield {key:e.key,value:structuredClone(e.value),versionstamp:e.version};}};return it;
 }
}
const kv=new Kv(),store=createWorkStore(kv),alice={name:'CS A',level:1},bob={name:'CS B',level:1},admin={name:'관리자',level:3};
const hospital={id:'h1',key:'병원\u001fSN1\u001f서울',name:'병원',sn:'SN1',region:'서울'};
await store.bridge('seed',{hospitals:[hospital],references:{engineers:['엔지니어'],minimumLevel:1}});
await store.bridge('activate',{manifest:await store.manifest()});
assert.equal((await store.handle({action:'work_bootstrap'},bob)).success,true);
assert.equal((await store.handle({action:'work_bootstrap'},{name:'',level:0})).success,false);
const form={hospitalKey:hospital.key,symptom:'정기 점검',cs:'CS A',engineer:'엔지니어',sales:'영업',registeredAt:'2026-10-06T09:00',visitAt:'2026-10-06T10:00',deadline:'',status:'방문예정'};
const op={action:'work_save',form,operationId:crypto.randomUUID()};const created=await store.handle(op,alice);assert.equal(created.success,true);assert.deepEqual(await store.handle(op,alice),created);assert.equal((await store.handle({...op,form:{...form,symptom:'다른 내용'}},alice)).success,false);
const id=created.request.id;
const stale=await store.handle({action:'work_save',id,baseRevision:0,form,operationId:crypto.randomUUID()},alice);assert.equal(stale.conflict,true);
const duplicate=await store.handle({...op,operationId:crypto.randomUUID()},alice);assert.equal(duplicate.duplicate,true);
const source={date:'2026-10-06',hospitalName:'병원',engineer:'엔지니어',sn:'SN1',gubun:'점검',result:'정상',detail:'점검 정상',recordId:'inspection1',version:'v1',observedAt:'2026-10-06T01:00:00Z'};
await store.ingestSources([source]);let detail=await store.handle({action:'work_detail',id},alice);assert.equal(detail.request.status,'결과확인');assert.equal(detail.request.gubun,'점검');assert.equal(detail.history[0].auto,true);assert.equal(detail.request.completedAt,'');
await store.ingestSources([source]);assert.equal((await store.handle({action:'work_detail',id},alice)).history.length,1);
const c1=await store.handle({action:'work_history_add',requestId:id,body:'상담 내용',operationId:crypto.randomUUID()},alice);assert.equal(c1.success,true);
const changed=await store.handle({action:'work_history_update',requestId:id,historyId:c1.history.id,baseHistoryRevision:1,body:'수정된 내용',operationId:crypto.randomUUID()},alice);assert.equal(changed.success,true);
assert.equal((await store.handle({action:'work_history_update',requestId:id,historyId:c1.history.id,baseHistoryRevision:2,body:'남의 댓글 수정',operationId:crypto.randomUUID()},bob)).success,false);
const drop={action:'work_delete',requestId:id,baseRevision:changed.request.revision,operationId:crypto.randomUUID()};assert.equal((await store.handle(drop,bob)).success,false);
const deleted=await store.handle(drop,alice);assert.equal(deleted.success,true);assert.ok(deleted.request.deletedAt);assert.deepEqual(await store.handle(drop,alice),deleted);
assert.equal((await store.handle({action:'work_history_add',requestId:id,body:'오래된 PC 댓글',operationId:crypto.randomUUID()},bob)).deleted,true);
const delta=await store.handle({action:'work_sync',revision:'0'},bob);assert.ok(delta.requests.find(r=>r.id===id).deletedAt,'deletion reaches other PC');
detail=await store.handle({action:'work_detail',id},alice);assert.equal(detail.history.length,2,'trash preserves comment and original report');
const restored=await store.handle({action:'work_restore',requestId:id,baseRevision:deleted.request.revision,operationId:crypto.randomUUID()},alice);assert.equal(restored.success,true);assert.equal(restored.request.deletedAt,'');
const complete=await store.handle({action:'work_complete',requestId:id,baseRevision:restored.request.revision,operationId:crypto.randomUUID()},alice);assert.equal(complete.request.status,'완료');
const pending=await store.bridge('pending',{});assert.ok(pending.events.length>=6,'each commit keeps durable mirror work');const first=pending.events[0];await store.bridge('ack',{items:[{id:'wrong',seq:first.seq}]});assert.ok((await store.bridge('pending',{})).events.some(e=>e.id===first.id));await store.bridge('ack',{items:[{id:first.id,seq:first.seq}]});assert.ok(!(await store.bridge('pending',{})).events.some(e=>e.id===first.id));assert.ok((await store.bridge('pending',{})).events.length,'other pending versions not cleared');
await store.ingestSources([{...source,version:'v2',detail:'새 내용',observedAt:'2026-10-06T02:00:00Z'}]);await store.ingestSources([source]);assert.equal((await store.sources('병원'))[0].version,'v2','delayed events cannot overwrite newer report');
const other=await store.handle({...op,form:{...form,visitAt:'2026-10-07T10:00'},operationId:crypto.randomUUID()},alice);assert.equal(other.success,true);
await store.ingestSources([{...source,date:'2026-10-07',recordId:'as1',gubun:'A/S'},{...source,date:'2026-10-07',recordId:'inspection2'}]);assert.equal((await store.handle({action:'work_detail',id:other.request.id},alice)).request.status,'방문예정','mixed AS/inspection candidates require selection');
const manual=await store.handle({action:'work_result_save',requestId:other.request.id,baseRevision:1,recordId:'inspection2',sourceVersion:'v1',memo:'CS 확인',operationId:crypto.randomUUID()},alice);assert.equal(manual.success,true);assert.equal(manual.request.gubun,'점검');
assert.equal((await store.bridge('status',{})).ready,true);
const concurrent=await Promise.all([alice,bob,admin].map((who,i)=>store.handle({action:'work_history_add',requestId:id,body:'동시 댓글 '+i,operationId:crypto.randomUUID()},who)));
assert.ok(concurrent.every(x=>x.success));assert.equal((await store.handle({action:'work_detail',id},alice)).history.length,5,'all interleaved comments survive');
const racers=await Promise.all([alice,bob].map(who=>store.handle({...op,form:{...form,visitAt:'2026-10-08T11:00'},operationId:crypto.randomUUID()},who)));
assert.ok(racers.every(x=>x.duplicate),'another active request prevents competing creation without acknowledgement');
const cleanKv=new Kv(),clean=createWorkStore(cleanKv);await clean.bridge('seed',{hospitals:[hospital],references:{engineers:[],minimumLevel:1}});
await assert.rejects(()=>clean.bridge('activate',{manifest:{}}),/검증/);assert.equal((await clean.status()).ready,false);
await assert.rejects(()=>store.bridge('seed',{requests:[]}),/다시 가져올/);
const main=fs.readFileSync(new URL('../deno-auth/main.ts',import.meta.url),'utf8');stripTypeScriptTypes(main);assert.ok(main.includes("baz-work-bridge-v1\\n"));
const ui=fs.readFileSync(new URL('../js/baz-work-manager.js',import.meta.url),'utf8');new vm.Script(ui);assert.ok(ui.includes("state.filter==='trash'"));assert.ok(!/setInterval|visibilitychange|window\.onfocus/.test(ui));
const fn=ui.slice(ui.indexOf('function detailMarkup('),ui.indexOf('function auditText('));const render=vm.runInNewContext('('+fn.trim()+')',{esc:x=>String(x??''),time:x=>x||'미정',badge:x=>'<span>'+x+'</span>',hospitalTerms:()=>'',resultFields:()=>'',overdue:()=>false,sourceCheckedAt:'',account:'CS A',BazAuth:{cachedLevel:()=>1}});
const markup=render({requests:[],logs:[],updatedAt:'now'},complete.request,[{source,author:'현장',createdAt:'now'}],[]);assert.match(markup,/<span>완료<\/span><span class="badge work-kind"[^>]*>점검<\/span>/);assert.ok(markup.includes('data-action="delete"'));assert.ok(render({requests:[],logs:[],updatedAt:'now'},deleted.request,[],[]).includes('data-action="restore"'));
console.log('work-kv: revisions, idempotency, inspection auto-review/manual import, comments/ACL, deletion+delta+restore, durable mirror ack, stale sources, ambiguity, migration freeze and detail badge passed.');
