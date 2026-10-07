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
assert.equal((await store.handle({action:'work_bootstrap'},bob)).bridgeStatus,null,'unconfirmed queue is not reported as zero');
const queueStatus={checkedAt:'2026-10-07T02:00:00Z',pendingCount:2,pendingEvents:3,failedCount:1,oldestPendingAt:'2026-10-07T01:00:00Z',lastSuccessAt:'',error:'원본 확인 필요'};
await store.bridge('sync_status',queueStatus);
assert.equal((await store.handle({action:'work_sync',revision:'0'},bob)).bridgeStatus.pendingCount,2,'status changes sync even without request revisions');
assert.equal((await store.bridge('sync_status',{...queueStatus,checkedAt:'2026-10-07T01:59:00Z',pendingCount:0,failedCount:0})).stale,true,'late workers cannot overwrite newer snapshots');
assert.equal((await store.handle({action:'work_bootstrap'},bob)).bridgeStatus.failedCount,1);
for(const patch of [{pendingCount:-1},{pendingEvents:1},{failedCount:3},{checkedAt:'invalid'}])await assert.rejects(()=>store.bridge('sync_status',{...queueStatus,...patch}));
assert.equal((await store.handle({action:'work_bootstrap'},bob)).success,true);
assert.equal((await store.handle({action:'work_bootstrap'},{name:'',level:0})).success,false);
const form={hospitalKey:hospital.key,symptom:'정기 점검',cs:'CS A',engineer:'엔지니어',sales:'영업',registeredAt:'2026-10-06T09:00',visitAt:'2026-10-06T10:00',deadline:'',status:'방문예정'};
const op={action:'work_save',form,operationId:crypto.randomUUID()};const created=await store.handle(op,alice);assert.equal(created.success,true);assert.deepEqual(await store.handle(op,alice),created);assert.equal((await store.handle({...op,form:{...form,symptom:'다른 내용'}},alice)).success,false);
const id=created.request.id;
const stale=await store.handle({action:'work_save',id,baseRevision:0,form,operationId:crypto.randomUUID()},alice);assert.equal(stale.conflict,true);
const duplicate=await store.handle({...op,operationId:crypto.randomUUID()},alice);assert.equal(duplicate.duplicate,true);
const source={date:'2026-10-06',hospitalName:'병원',engineer:'엔지니어',sn:'SN1',gubun:'점검',result:'정상',detail:'점검 정상',recordId:'inspection1',version:'v1',observedAt:'2026-10-06T01:00:00Z'};
async function multiDeviceFixture(){
 const db=new Kv(),s=createWorkStore(db),second={...hospital,id:'h2',key:'병원\u001fSN2\u001f서울',sn:'SN2'};
 await s.bridge('seed',{hospitals:[hospital,second],references:{engineers:['엔지니어'],minimumLevel:1}});
 await s.bridge('activate',{manifest:await s.manifest()});
 const one=await s.handle({...op,operationId:crypto.randomUUID()},alice);
 return {db,s,one,second};
}
{
 const {s,one}=await multiDeviceFixture();
 const a={...source,recordId:'multi-a',nsFill:'O',nsAmt:'정상',jet:'가능',nozzleReuse:'X'},b={...source,recordId:'multi-b',sn:'SN2',nozzleReuse:'O'};
 assert.equal((await s.ingestSources([a,b])).linked,2,'distinct serials join one visit');
 let d=await s.handle({action:'work_detail',id:one.request.id},alice);assert.equal(d.history.length,2);assert.equal(d.request.status,'결과확인');
 assert.equal(d.history.find(h=>h.source.sn==='SN1').source.jet,'가능');assert.equal(d.history.find(h=>h.source.sn==='SN2').source.nozzleReuse,'O');
 assert.equal((await s.ingestSources([a,b])).linked,0,'redelivery does not duplicate device reports');
 assert.equal((await s.ingestSources([{...source,recordId:'multi-c',sn:'SN3'}])).linked,1,'a later device is added in result review');
 d=await s.handle({action:'work_detail',id:one.request.id},alice);assert.equal(d.history.length,3);
 assert.equal((await s.bridge('pending',{})).events.filter(e=>e.kind==='result_auto').length,3,'each device result has a durable mirror event');
}
for(const badSn of ['SN1','']){
 const {s,one}=await multiDeviceFixture();
 const response=await s.ingestSources([{...source,recordId:'amb-a'},{...source,recordId:'amb-b',sn:badSn}]);
 assert.equal(response.linked,0,'duplicate or missing serials remain manual');assert.equal(response.skipped.length,1);
 assert.equal((await s.handle({action:'work_detail',id:one.request.id},alice)).history.length,0);
}
{
 const {s,one,second}=await multiDeviceFixture();
 const two=await s.handle({...op,form:{...form,hospitalKey:second.key},acknowledgeDuplicates:true,operationId:crypto.randomUUID()},alice);
 assert.equal((await s.ingestSources([{...source,recordId:'split-a'},{...source,recordId:'split-b',sn:'SN2'}])).linked,2);
 for(const [id,sn]of [[one.request.id,'SN1'],[two.request.id,'SN2']]){const d=await s.handle({action:'work_detail',id},alice);assert.equal(d.history.length,1);assert.equal(d.history[0].source.sn,sn,'separate requests are assigned by serial');}
}
await store.ingestSources([source]);let detail=await store.handle({action:'work_detail',id},alice);assert.equal(detail.request.status,'결과확인');assert.equal(detail.request.gubun,'점검');assert.equal(detail.history[0].auto,true);assert.equal(detail.request.completedAt,'');
await store.ingestSources([source]);assert.equal((await store.handle({action:'work_detail',id},alice)).history.length,1);
const c1=await store.handle({action:'work_history_add',requestId:id,body:'상담 내용',operationId:crypto.randomUUID()},alice);assert.equal(c1.success,true);
{
 const {s,one}=await multiDeviceFixture();
 const added=await s.handle({action:'work_history_add',requestId:one.request.id,body:'보존할 댓글',operationId:crypto.randomUUID()},alice);
 const deletion={action:'work_history_update',requestId:one.request.id,historyId:added.history.id,baseHistoryRevision:1,deleted:true,operationId:crypto.randomUUID()};
 assert.equal((await s.handle(deletion,bob)).success,false,'other staff cannot delete a comment');
 const removed=await s.handle(deletion,alice);assert.equal(removed.success,true);assert.ok(removed.history.deletedAt);assert.equal(removed.history.body,'보존할 댓글');assert.equal(removed.request.latest,'');
 assert.deepEqual(await s.handle(deletion,alice),removed,'delete replay is idempotent');
 assert.equal((await s.handle({...deletion,operationId:crypto.randomUUID()},alice)).conflict,true,'stale delete cannot override a newer revision');
 assert.equal((await s.handle({...deletion,deleted:undefined,body:'덮어쓰기',baseHistoryRevision:2,operationId:crypto.randomUUID()},alice)).success,false,'deleted comments require restore before editing');
 const back=await s.handle({...deletion,deleted:false,baseHistoryRevision:2,operationId:crypto.randomUUID()},admin);assert.equal(back.success,true);assert.equal(back.history.deletedAt,'');assert.equal(back.history.body,'보존할 댓글');assert.equal(back.request.latest,'보존할 댓글');
 const events=(await s.bridge('pending',{})).events;assert.ok(events.some(x=>x.kind==='comment_delete'&&x.history.deletedAt));assert.ok(events.some(x=>x.kind==='comment_restore'&&!x.history.deletedAt));
}
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
const fields=vm.runInNewContext('('+ui.slice(ui.indexOf('function resultFields('),ui.indexOf('function detailMarkup(')).trim()+')',{esc:v=>String(v).replaceAll('<','&lt;')});
let fieldsMarkup=fields({...source,nozzleReuse:'O',nsFill:'X',nsAmt:'부족',jet:'<교육 필요>'});
assert.match(fieldsMarkup,/노즐 재사용<\/dt><dd>유/);assert.match(fieldsMarkup,/사용자 숙련도 평가/);assert.match(fieldsMarkup,/&lt;교육 필요>/);
assert.match(fields({...source,nozzleReuse:'X'}),/노즐 재사용<\/dt><dd>무/);
assert.match(fields({...source,origin:'flow'},'[사용자 숙련도 평가]NS 충진 여부 : ONS 충진량 : 정상젯 분사 판단[병원담당자] : 가능비고/특이사항 : N/A'),/NS 충진 여부<\/dt><dd>O<\/dd>/);
assert.match(fields({...source,origin:'flow'},'노즐 재사용 의심'),/노즐 재사용<\/dt><dd>미기록/,'do not infer nozzle reuse from free text');
const statusPicker=vm.runInNewContext('('+ui.split('\n').find(l=>l.trim().startsWith('function statusPicker(')).trim()+')',{esc:x=>String(x??''),statuses:['접수','방문예정','처리중','결과확인','완료','보류','취소']});
const fn=ui.slice(ui.indexOf('function detailMarkup('),ui.indexOf('function auditText('));const render=vm.runInNewContext('('+fn.trim()+')',{statusPicker,esc:x=>String(x??''),time:x=>x||'미정',badge:x=>'<span>'+x+'</span>',hospitalTerms:()=>'',resultFields:()=>'',overdue:()=>false,sourceCheckedAt:'',account:'CS A',BazAuth:{cachedLevel:()=>1}});
const markup=render({requests:[],logs:[],updatedAt:'now'},complete.request,[{source,author:'현장',createdAt:'now'}],[]);assert.match(markup,/<option value="완료" selected>완료<\/option>/);assert.match(markup,/<span class="badge work-kind"[^>]*>점검<\/span>/);assert.ok(!markup.includes('data-action="save-status"'));assert.ok(markup.includes('data-action="delete"'));assert.ok(render({requests:[],logs:[],updatedAt:'now'},deleted.request,[],[]).includes('data-action="restore"'));
// Existing deleted-owner links must heal without clearing the original result/history.
async function relinkFixture(gubun='A/S'){
 const db=new Kv(),s=createWorkStore(db);
 await s.bridge('seed',{hospitals:[hospital],references:{engineers:['엔지니어'],minimumLevel:1}});
 await s.bridge('activate',{manifest:await s.manifest()});
 const createPayload={...op,operationId:crypto.randomUUID()},first=await s.handle(createPayload,alice);
 const report={...source,gubun,recordId:'reused-report'};
 await s.ingestSources([report]);
 const found=await s.handle({action:'work_detail',id:first.request.id},alice);
 const completed=await s.handle({action:'work_result_save',requestId:first.request.id,baseRevision:found.request.revision,baseHistoryRevision:found.history[0].revision,recordId:report.recordId,sourceVersion:report.version,memo:'기존 접수 보완',complete:true,operationId:crypto.randomUUID()},alice);
 assert.equal(completed.success,true);
 const trash=await s.handle({action:'work_delete',requestId:first.request.id,baseRevision:completed.request.revision,operationId:crypto.randomUUID()},alice);
 assert.equal(trash.success,true);
 const original=await s.handle({action:'work_detail',id:first.request.id},alice);
 return {db,s,report,trash,original,createPayload};
}
for(const gubun of ['A/S','점검']){
 const {s,report,trash,original}=await relinkFixture(gubun);
 const fresh=await s.handle({...op,form:{...form,status:gubun==='점검'?'보류':'방문예정'},operationId:crypto.randomUUID()},alice);
 assert.equal(fresh.success,true,'same hospital/date can be re-registered after trash');
 if(gubun==='A/S')assert.equal((await s.ingestSources([report])).linked,1,'auto matching reclaims a trashed owner link');
 else assert.equal((await s.handle({action:'work_result_save',requestId:fresh.request.id,baseRevision:1,recordId:report.recordId,sourceVersion:report.version,memo:'새 접수 보완',operationId:crypto.randomUUID()},alice)).success,true,'manual selection also reclaims a trashed link');
 const freshDetail=await s.handle({action:'work_detail',id:fresh.request.id},alice);
 assert.equal(freshDetail.request.status,'결과확인');assert.equal(freshDetail.request.gubun,gubun);assert.equal(freshDetail.history.length,1);
 assert.notEqual(freshDetail.history[0].id,original.history[0].id,'re-registration gets its own result entry');
 assert.equal(freshDetail.history[0].memo,gubun==='점검'?'새 접수 보완':'','old CS memo is not copied to the new request');
 const stillTrashed=await s.handle({action:'work_detail',id:trash.request.id},alice);
 for(const field of ['request','history','logs'])assert.deepEqual(stillTrashed[field],original[field],'trash '+field+' is untouched');
 await s.ingestSources([report]);assert.equal((await s.handle({action:'work_detail',id:fresh.request.id},alice)).history.length,1,'repeated delivery creates no duplicate result');
 const restored=await s.handle({action:'work_restore',requestId:trash.request.id,baseRevision:trash.request.revision,acknowledgeDuplicates:true,operationId:crypto.randomUUID()},alice);
 assert.equal(restored.success,true);
 const blocked=await s.handle({action:'work_result_save',requestId:restored.request.id,baseRevision:restored.request.revision,baseHistoryRevision:original.history[0].revision,recordId:report.recordId,sourceVersion:report.version,operationId:crypto.randomUUID()},alice);
 assert.equal(blocked.success,false);assert.match(blocked.error,/다른 접수에 연결/,'restoring an old request never steals the newer link');
 assert.deepEqual((await s.handle({action:'work_detail',id:restored.request.id},alice)).history,original.history);
}
{
 const {db,s,report,trash}=await relinkFixture();
 const fresh=await s.handle({...op,operationId:crypto.randomUUID()},alice);
 const atomic=db.atomic.bind(db);let restoreBeforeCommit=true;
 db.atomic=()=>{const tx=atomic(),commit=tx.commit;tx.commit=async()=>{
  if(restoreBeforeCommit){restoreBeforeCommit=false;const restored=await s.handle({action:'work_restore',requestId:trash.request.id,baseRevision:trash.request.revision,acknowledgeDuplicates:true,operationId:crypto.randomUUID()},alice);assert.equal(restored.success,true);}
  return commit();
 };return tx;};
 const blocked=await s.handle({action:'work_result_save',requestId:fresh.request.id,baseRevision:1,recordId:report.recordId,sourceVersion:report.version,operationId:crypto.randomUUID()},alice);
 assert.equal(blocked.success,false);assert.match(blocked.error,/다른 접수에 연결/,'restore racing with relink is rechecked atomically');
 assert.equal((await s.handle({action:'work_detail',id:fresh.request.id},alice)).history.length,0);
}
{
 const {s,report}=await relinkFixture();
 const fresh=await Promise.all([alice,bob].map(who=>s.handle({...op,acknowledgeDuplicates:true,operationId:crypto.randomUUID()},who)));
 const attempts=await Promise.all(fresh.map((x,i)=>s.handle({action:'work_result_save',requestId:x.request.id,baseRevision:1,recordId:report.recordId,sourceVersion:report.version,operationId:crypto.randomUUID()},i?bob:alice)));
 assert.equal(attempts.filter(x=>x.success).length,1,'only one live request wins a reused report');
 assert.match(attempts.find(x=>!x.success).error,/다른 접수에 연결/);
}
{
 const {s,report,trash}=await relinkFixture();
 const restored=await s.handle({action:'work_restore',requestId:trash.request.id,baseRevision:trash.request.revision,operationId:crypto.randomUUID()},alice);
 assert.equal(restored.request.status,'완료');
 const fresh=await s.handle({...op,operationId:crypto.randomUUID()},alice);
 assert.equal((await s.ingestSources([report])).linked,0,'a restored completed owner remains protected');
 const blocked=await s.handle({action:'work_result_save',requestId:fresh.request.id,baseRevision:1,recordId:report.recordId,sourceVersion:report.version,operationId:crypto.randomUUID()},alice);
 assert.equal(blocked.success,false);assert.match(blocked.error,/다른 접수에 연결/);
}
{
 const {db,s,report,trash,createPayload}=await relinkFixture();
 const fresh=await s.handle({...op,operationId:crypto.randomUUID()},alice);await s.ingestSources([report]);
 const before=await s.handle({action:'work_detail',id:fresh.request.id},alice);
 const payload={action:'work_purge',requestId:trash.request.id,baseRevision:trash.request.revision,confirmPermanentDelete:true,operationId:crypto.randomUUID()};
 assert.equal((await s.handle(payload,alice)).success,false,'even the author cannot empty trash without admin access');
 assert.equal((await s.handle({...payload,confirmPermanentDelete:false},admin)).success,false,'explicit permanent-delete acknowledgement required');
 assert.equal((await s.handle({...payload,baseRevision:0},admin)).conflict,true);
 assert.equal((await s.handle({...payload,requestId:fresh.request.id,baseRevision:before.request.revision},admin)).success,false,'active requests cannot be purged');
 const purged=await s.handle(payload,admin);assert.equal(purged.success,true);assert.ok(purged.request.purgedAt);assert.equal(purged.request.hospitalName,undefined,'only a minimal tombstone remains');
 assert.deepEqual(await s.handle(payload,admin),purged,'permanent-delete retries are idempotent');
 assert.equal((await s.handle({action:'work_detail',id:trash.request.id},admin)).purged,true);
 assert.equal((await s.handle({action:'work_restore',requestId:trash.request.id,baseRevision:purged.request.revision,operationId:crypto.randomUUID()},admin)).purged,true);
 assert.equal([...db.data.values()].filter(e=>e.key[1]==='history'&&e.key[2]===trash.request.id).length,0,'purged comments/results removed');
 assert.equal([...db.data.values()].filter(e=>e.key[1]==='audit'&&e.key[2]===trash.request.id&&e.value.kind!=='purge').length,0);
 assert.equal((await db.get([s.NS,'link',report.recordId])).value.requestId,fresh.request.id,'purge never removes another live request link');
 assert.deepEqual((await s.handle({action:'work_detail',id:fresh.request.id},alice)).history,before.history);
 assert.deepEqual((await s.sources(hospital.name))[0],report,'Handover source retained');
 const replay=await s.handle(createPayload,alice);assert.equal(replay.success,false);assert.equal(replay.purged,true,'retrying an old save cannot recreate a permanently deleted request');
 const deletedDelta=(await s.handle({action:'work_sync',revision:'0'},bob)).requests.find(r=>r.id===trash.request.id);assert.ok(deletedDelta.purgedAt,'other PCs receive the permanent-delete tombstone');
 const queue=await s.bridge('pending',{});assert.ok(queue.events.filter(e=>e.request.id===trash.request.id).every(e=>e.kind==='purge'&&!e.history&&!e.before&&!e.request.hospitalName),'queued old copies sanitized');
}
{
 const {db,s,report,trash}=await relinkFixture();
 const atomic=db.atomic.bind(db);let commits=0;
 db.atomic=()=>{const tx=atomic(),commit=tx.commit;tx.commit=async()=>++commits===2?{ok:false}:commit();return tx;};
 const purged=await s.handle({action:'work_purge',requestId:trash.request.id,baseRevision:trash.request.revision,confirmPermanentDelete:true,operationId:crypto.randomUUID()},admin);
 assert.equal(purged.success,true);assert.equal(purged.cleanupPending,true,'cleanup interruption does not undo the deletion fence');
 assert.ok((await db.get([s.NS,'purgeCleanup',trash.request.id])).value,'cleanup retry is durable');
 await s.bridge('pending',{});assert.equal((await db.get([s.NS,'purgeCleanup',trash.request.id])).value,null);
 assert.equal((await db.get([s.NS,'link',report.recordId])).value,null,'purged owner binding is released');
 const fresh=await s.handle({...op,operationId:crypto.randomUUID()},alice);assert.equal((await s.ingestSources([report])).linked,1);
 assert.equal((await s.handle({action:'work_detail',id:fresh.request.id},alice)).history.length,1,'original Handover can be reused after permanent deletion');
}
{
 const db=new Kv(),s=createWorkStore(db);await s.bridge('seed',{hospitals:[hospital],references:{engineers:['엔지니어'],minimumLevel:1}});await s.bridge('activate',{manifest:await s.manifest()});
 const created=await s.handle({...op,operationId:crypto.randomUUID()},alice);let r=created.request;
 const comment=await s.handle({action:'work_history_add',requestId:r.id,body:'수동 변경 전 상담',operationId:crypto.randomUUID()},alice);r=comment.request;
 for(const status of ['완료','처리중','보류','접수','방문예정','결과확인','취소','완료']){
  const p={action:'work_status',requestId:r.id,baseRevision:r.revision,status,operationId:crypto.randomUUID()},out=await s.handle(p,alice);
  assert.equal(out.success,true,'manual status '+status+' requires no Handover result');assert.equal(out.request.status,status);assert.equal(out.request.revision,r.revision+1);
  assert.deepEqual(await s.handle(p,alice),out,'status retry is idempotent');
  if(status==='완료'){assert.ok(out.request.completedAt);assert.equal(out.request.completedBy,alice.name);}else{assert.equal(out.request.completedAt,'');assert.equal(out.request.completedBy,'');}
  for(const key of ['hospitalName','visitAt','engineer','symptom','latest'])assert.equal(out.request[key],r[key],'status write preserves '+key);
  assert.equal(out.event.kind,'status_change');assert.equal(out.event.before.status,r.status);r=out.request;
 }
 const preserved=await s.handle({action:'work_detail',id:r.id},alice);assert.deepEqual(preserved.history,[comment.history]);
 assert.equal((await s.handle({action:'work_status',requestId:r.id,baseRevision:r.revision,status:'invalid',operationId:crypto.randomUUID()},alice)).success,false);
 assert.equal((await s.handle({action:'work_status',requestId:r.id,baseRevision:r.revision,status:'접수',operationId:crypto.randomUUID()},{name:'외부',level:0})).success,false);
 const parallel=await Promise.all(['보류','처리중'].map(status=>s.handle({action:'work_status',requestId:r.id,baseRevision:r.revision,status,operationId:crypto.randomUUID()},alice)));
 assert.equal(parallel.filter(x=>x.success).length,1);assert.equal(parallel.filter(x=>x.conflict).length,1,'concurrent status edits cannot overwrite');r=parallel.find(x=>x.success).request;
 const full=await s.handle({action:'work_save',id:r.id,baseRevision:r.revision,form:{...form,status:'완료'},operationId:crypto.randomUUID()},alice);assert.equal(full.success,true,'existing edit form can also complete');assert.ok(full.request.completedAt);
 const reopen=await s.handle({action:'work_save',id:r.id,baseRevision:full.request.revision,form:{...form,status:'처리중'},operationId:crypto.randomUUID()},alice);assert.equal(reopen.request.completedAt,'','edit form clears current completion on reopening');
 const done=await s.handle({action:'work_complete',requestId:r.id,baseRevision:reopen.request.revision,operationId:crypto.randomUUID()},alice);assert.equal(done.success,true,'completion button follows manual completion policy');
 const trash=await s.handle({action:'work_delete',requestId:r.id,baseRevision:done.request.revision,operationId:crypto.randomUUID()},alice);
 assert.equal((await s.handle({action:'work_status',requestId:r.id,baseRevision:trash.request.revision,status:'접수',operationId:crypto.randomUUID()},alice)).deleted,true);
 const synced=await s.handle({action:'work_sync',revision:'0'},bob);assert.ok(synced.requests.some(x=>x.id===r.id),'manual changes are delivered on other PC sync');
 console.log('manual status: all seven states, no-result completion, reopening metadata, idempotency, atomic conflicts, ACL, trash rejection, preserved history and edit-form parity passed.');
}
console.log('work-kv: revisions, ACL, trash AS/inspection relink, original history preservation, restore/relink races, admin-confirmed permanent deletion, resumable cleanup, tombstones/mirror sanitation and active source protection passed.');

// Roster records have their own revision/operation space; a schedule never becomes an A/S request.
{
 const db=new Kv(),s=createWorkStore(db);await s.bridge('seed',{hospitals:[hospital],references:{engineers:['양승주'],minimumLevel:1}});await s.bridge('activate',{manifest:await s.manifest()});
 const write=(payload,who=alice)=>s.handle({action:'work_roster_save',date:'2026-08-17',person:'양승주',type:'휴무',baseRevision:0,operationId:crypto.randomUUID(),...payload},who);
 const p={action:'work_roster_save',date:'2026-08-17',person:'양승주',type:'휴무',baseRevision:0,operationId:crypto.randomUUID()};
 const added=await s.handle(p,alice);assert.equal(added.success,true);assert.equal(added.schedule.revision,1);assert.deepEqual(await s.handle(p,alice),added,'retry creates one schedule');
 assert.equal((await s.handle({...p,type:'당직'},alice)).success,false,'different operation payload cannot reuse an id');
 assert.equal((await s.handle(p,bob)).success,false,'another actor cannot replay a saved operation');
 const duplicate=await write({type:'당직'});assert.equal(duplicate.conflict,true);assert.equal(duplicate.current.type,'휴무','one date/person cannot have both types');
 const next=await write({date:'2026-08-19',type:'당직'});assert.equal(next.success,true);
 const sync=await s.handle({action:'work_sync',revision:'0',rosterMonth:'2026-08'},bob);assert.equal(sync.requests.length,0);assert.equal(sync.revision,'0');assert.deepEqual(sync.roster.map(x=>[x.date,x.type]).sort(),[['2026-08-17','휴무'],['2026-08-19','당직']]);
 assert.equal((await s.handle({action:'work_bootstrap',rosterMonth:'2026-08'},bob)).roster.length,2);
 assert.equal((await s.handle({action:'work_roster',rosterMonth:'2026-09'},bob)).roster.length,0,'months are isolated');
 const parallel=await Promise.all(['휴무','당직'].map(type=>write({type,baseRevision:1},type==='휴무'?alice:bob)));assert.equal(parallel.filter(x=>x.success).length,1);assert.equal(parallel.filter(x=>x.conflict).length,1,'concurrent edits cannot overwrite');
 const current=parallel.find(x=>x.success).schedule,removed=await s.handle({action:'work_roster_delete',date:current.date,person:current.person,baseRevision:current.revision,operationId:crypto.randomUUID()},bob);assert.equal(removed.success,true);assert.ok(removed.schedule.deletedAt);
 const beforeRetry=(await s.handle({action:'work_roster',rosterMonth:'2026-08'},alice)).roster;
 assert.equal(beforeRetry.filter(x=>!x.deletedAt).length,1);assert.equal((await write({baseRevision:0})).conflict,true,'stale add cannot revive a deleted row');
 const restored=await write({baseRevision:removed.schedule.revision});assert.equal(restored.success,true);assert.equal(restored.schedule.deletedAt,'');
 for(const payload of [{date:'2026-02-30'},{date:'2026-13-01'},{person:''},{person:'x'.repeat(61)},{type:'외근'},{baseRevision:-1}])assert.equal((await write(payload)).success,false,JSON.stringify(payload));
 assert.equal((await s.handle({action:'work_roster',rosterMonth:'2026-08'},{name:'',level:0})).success,false);
 assert.equal((await write({date:'2026-08-20'},{name:'읽기 불가',level:0})).success,false);
 assert.equal((await s.status()).seq,0,'roster has no Handover/outbox or service revision side effects');
 assert.ok([...db.data.values()].some(x=>x.key[1]==='rosterAudit'),'edits retain a separate audit');
 console.log('work-roster: monthly shared read/sync, date/person uniqueness, idempotency, atomic conflicts, validation, ACL, reversible deletion and no A/S side effects passed.');
}
