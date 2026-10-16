import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createWorkStore} from '../deno-auth/work-store.ts';
import {createWorkMatching} from '../deno-auth/work-matching.ts';
const fixture=fs.readFileSync(new URL('work-kv.mjs',import.meta.url),'utf8');
const Kv=vm.runInNewContext('('+fixture.slice(fixture.indexOf('class Kv{'),fixture.indexOf('const kv=new Kv()')).trim()+')',{Map,structuredClone,JSON,String,Number,Infinity});
const who={name:'CS',level:3},hospital={id:'h',key:'h',name:'병원',sn:'SN',region:''};
const source={recordId:'record',version:'v1',hospitalName:'병원',date:'2026-10-16',gubun:'점검',sn:'SN',result:'정상',detail:'현장 원문',observedAt:'2026-10-16T00:00:00Z'};
const form={hospitalKey:'h',symptom:'점검',cs:'CS',engineer:'',registeredAt:'2026-10-16T09:00',visitAt:'2026-10-16T12:00',status:'접수'};
async function setup(){const db=new Kv(),store=createWorkStore(db);await store.bridge('seed',{hospitals:[hospital],references:{minimumLevel:1,engineers:[]}});await store.bridge('activate',{manifest:await store.manifest()});return {db,store};}
async function create(store,changes={}){return store.handle({action:'work_save',form:{...form,...changes},operationId:crypto.randomUUID()},who);}
{
 const {db,store}=await setup();await store.ingestSources([source]);const saved=await create(store);
 assert.equal((await store.handle({action:'work_detail',id:saved.request.id},who)).history.length,0);
 const recreated=createWorkStore(db);await recreated.processPendingMatches();
 const detail=await recreated.handle({action:'work_detail',id:saved.request.id},who);
 assert.equal(detail.history.length,1,'source-first creation links from durable work after store recreation');
 assert.equal(detail.history[0].source.detail,'현장 원문');
 await recreated.processPendingMatches();assert.equal((await recreated.handle({action:'work_detail',id:saved.request.id},who)).history.length,1);
}
{
 const {store}=await setup(),saved=await create(store,{visitAt:'2026-10-15T12:00'});await store.ingestSources([source]);
 const edited=await store.handle({action:'work_request_edit',id:saved.request.id,baseRevision:1,form,operationId:crypto.randomUUID()},who);
 assert.equal(edited.success,true);assert.equal(edited.workDetail.history.length,1,'condition edits link an already-received source');
}
{
 const {db,store}=await setup(),saved=await create(store);
 const trash=await store.handle({action:'work_delete',requestId:saved.request.id,baseRevision:1,operationId:crypto.randomUUID()},who);
 await store.ingestSources([source]);assert.equal((await store.handle({action:'work_detail',id:saved.request.id},who)).history.length,0);
 const restored=await createWorkStore(db).handle({action:'work_restore',requestId:saved.request.id,baseRevision:trash.request.revision,operationId:crypto.randomUUID()},who);
 assert.equal(restored.success,true);assert.equal((await store.handle({action:'work_detail',id:saved.request.id},who)).history.length,1,'restore schedules the original-first match');
}
{
 const {store}=await setup(),saved=await create(store,{status:'보류'});await store.ingestSources([source]);
 const status=await store.handle({action:'work_status',requestId:saved.request.id,baseRevision:1,status:'접수',operationId:crypto.randomUUID()},who);
 assert.equal(status.success,true);await store.processPendingMatches();assert.equal((await store.handle({action:'work_detail',id:saved.request.id},who)).history.length,1,'reopening a held request also schedules matching');
}
for(const count of [100,1000,10000]){
 const {db,store}=await setup();
 for(let i=0;i<count;i++)await db.set([store.NS,'request',String(i)],{id:String(i),hospitalName:'병원',visitAt:form.visitAt,status:'접수'});
 const scans=[],list=db.list.bind(db);db.list=(selector,options)=>{scans.push(selector);return list(selector,options);};
 const before=db.seq,out=await store.handle({action:'work_sync',revision:'0'},who);
 assert.equal(out.nochange,true);assert.equal(db.seq,before,'read-only sync performs no writes');
 assert.ok(scans.every(s=>!s.prefix||!['request','source','sourcePending','pdfPending','matchPending','matchDue'].includes(s.prefix[1])),`${count} requests: no full matching/list scan on zero changes`);
}
{
 const {db,store}=await setup();
 for(let i=0;i<17;i++)await db.set([store.NS,'request','legacy'+i],{id:'legacy'+i,hospitalId:'h',hospitalName:i?'다른 병원 '+i:'병원',visitAt:form.visitAt,status:i?'완료':'접수',revision:1});
 await db.set([store.NS,'source','병원',source.recordId],source);
 await store.processPendingMatches();assert.equal((await store.handle({action:'work_detail',id:'legacy0'},who)).history.length,0,'foreground source handling does not scan legacy requests');
 await store.processPendingMatches({backfill:true});assert.equal((await db.get([store.NS,'matchBackfill'])).value.complete,false,'legacy scan is checkpointed after a bounded page');
 await createWorkStore(db).processPendingMatches({backfill:true});assert.equal((await db.get([store.NS,'matchBackfill'])).value.complete,true);
 assert.equal((await store.handle({action:'work_detail',id:'legacy0'},who)).history.length,1,'background migration finds pre-upgrade matching gaps');
 assert.equal((await db.get([store.NS,'source','병원',source.recordId])).value.detail,source.detail,'migration preserves the current saved source');
}
{
 const db=new Kv(),worker=createWorkMatching(db),visit={hospitalName:'병원',date:'2026-10-16'},pending=['hospitalwork-v2','matchPending',visit.hospitalName,visit.date];
 await worker.enqueue(db.atomic(),[visit]).commit();
 const failed=await worker.process(async()=>{throw new Error('temporary failure');});assert.equal(failed.failed,1);
 const job=(await db.get(pending)).value;assert.equal(job.attempts,1);assert.equal(job.errorCode,'MATCH_RETRY');
 assert.equal((await worker.process(async()=>({linked:1}))).processed,0,'retry waits until its due time');
 const originalNow=Date.now;Date.now=()=>job.due+1;
 try{assert.equal((await createWorkMatching(db).process(async()=>({linked:1}))).linked,1);}finally{Date.now=originalNow;}
 assert.equal((await db.get(pending)).value,null,'successful resumed work clears only its own job');
 await worker.enqueue(db.atomic(),[visit]).commit();
 await worker.process(async()=>{await worker.enqueue(db.atomic(),[visit]).commit();return {linked:0};});
 assert.ok((await db.get(pending)).value,'a late worker cannot erase a newer event');
 await worker.process(async()=>({linked:0}));assert.equal((await db.get(pending)).value,null);
}
{
 const {db,store}=await setup();
 await db.set([store.NS,'meta'],{ready:true,seq:102});
 for(let seq=1;seq<=102;seq++)await db.set([store.NS,'change',seq],{seq,request:{id:'r'+seq,revision:1}});
 const first=await store.handle({action:'work_sync',revision:'0'},who);assert.equal(first.requests.length,100);assert.equal(first.snapshotSeq,'102');
 await db.set([store.NS,'meta'],{ready:true,seq:103});await db.set([store.NS,'change',103],{seq:103,request:{id:'late',revision:1}});
 const last=await store.handle({action:'work_sync',revision:first.revision,snapshotSeq:first.snapshotSeq},who);
 assert.equal(last.revision,'102');assert.equal(last.more,false);assert.ok(!last.requests.some(r=>r.id==='late'));
 assert.equal((await store.handle({action:'work_sync',revision:'102'},who)).requests[0].id,'late');
 assert.equal((await store.handle({action:'work_sync',revision:'invalid'},who)).code,'REVISION_INVALID');
}
console.log('work-matching: source-first/create/edit/restore/reopen, restart recovery, bounded retry, late acknowledgment protection, pure reads at 100/1000/10000 records and fixed delta upper bound passed.');
