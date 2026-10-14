import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createWorkStore} from '../deno-auth/work-store.ts';
const fixture=fs.readFileSync(new URL('./work-kv.mjs',import.meta.url),'utf8');
const Kv=vm.runInNewContext('('+fixture.slice(fixture.indexOf('class Kv{'),fixture.indexOf('const kv=new Kv()')).trim()+')',{Map,structuredClone,JSON,String,Number,Infinity});
const who={name:'CS',level:3},hospital={id:'h1',key:'h1',name:'검증 병원',sn:'SN1'};
const form={hospitalKey:'h1',symptom:'원래 증상',cs:'CS',engineer:'FSE',sales:'',registeredAt:'2026-10-14T09:00',visitAt:'2026-10-14T12:00',deadline:'',status:'방문예정'};
const report={recordId:'report1',hospitalName:hospital.name,date:'2026-10-14',sn:'SN1',engineer:'FSE',gubun:'A/S',detail:'수정 전',result:'수리',version:'v1',observedAt:'2026-10-14T01:00:00Z'};
const write=(s,action,p)=>s.handle({action,operationId:crypto.randomUUID(),...p},who);
for(const status of ['결과확인','완료','보류','취소']){
 const kv=new Kv(),s=createWorkStore(kv);await s.bridge('seed',{hospitals:[hospital],references:{engineers:['FSE'],minimumLevel:1}});await s.bridge('activate',{manifest:await s.manifest()});
 const created=await write(s,'work_save',{form}),id=created.request.id;await s.ingestSources([report]);let d=await s.handle({action:'work_detail',id},who);
 const result=d.history[0];await write(s,'work_result_save',{requestId:id,baseRevision:d.request.revision,recordId:report.recordId,sourceVersion:'v1',baseHistoryRevision:result.revision,memo:'보완 메모'});d=await s.handle({action:'work_detail',id},who);
 await write(s,'work_status',{requestId:id,baseRevision:d.request.revision,status});await write(s,'work_history_add',{requestId:id,body:'보존 댓글'});d=await s.handle({action:'work_detail',id},who);
 const before=d,seq=(await s.handle({action:'work_bootstrap'},who)).revision;
 const changed={...report,detail:'케이블 수리(4층)',result:'',sn:'SN2',gubun:'점검',part:'교체품 정정',version:'v2',observedAt:'2026-10-14T02:00:00Z'};
 await s.ingestSources([changed]);d=await s.handle({action:'work_detail',id},who);const h=d.history.find(h=>h.kind==='result');
 assert.equal(h.id,result.id);assert.equal(h.source.version,'v2');assert.equal(h.source.detail,changed.detail);assert.equal(h.source.sn,'SN2');assert.equal(h.memo,'보완 메모');assert.equal(h.author,result.author);assert.equal(h.createdAt,result.createdAt);
 assert.equal(d.request.status,status);assert.equal(d.request.completedAt,before.request.completedAt);assert.equal(d.request.completedBy,before.request.completedBy);assert.equal(d.request.symptom,form.symptom);assert.equal(d.request.visitAt,form.visitAt);assert.equal(d.request.engineer,form.engineer);assert.equal(d.request.gubun,'점검');assert.ok(d.history.some(h=>h.body==='보존 댓글'));
 const audit=d.logs.find(e=>e.kind==='result_source_update');assert.equal(audit.before.source.detail,'수정 전');assert.equal(audit.after.source.detail,changed.detail);
 const delta=await s.handle({action:'work_sync',revision:seq},who);assert.equal(delta.nochange,false);assert.equal(delta.requests.find(r=>r.id===id).revision,d.request.revision);
 const revision=d.request.revision;await s.ingestSources([changed]);await s.ingestSources([report]);await s.handle({action:'work_sync',revision:delta.revision},who);assert.equal((await s.handle({action:'work_detail',id},who)).request.revision,revision,'repeat and stale delivery do not add an update');
 // Renames and moved processing dates follow the existing immutable source, never another request.
 const moved={...changed,hospitalName:'정정된 병원명',date:'2026-10-15',version:'v3',observedAt:'2026-10-14T03:00:00Z'};await s.ingestSources([moved]);await s.ingestSources([changed]);d=await s.handle({action:'work_detail',id},who);
 assert.equal(d.history.find(h=>h.kind==='result').source.hospitalName,moved.hospitalName);assert.equal(d.history.find(h=>h.kind==='result').source.date,moved.date);assert.equal(d.request.hospitalName,hospital.name);assert.equal((await s.sources(hospital.name)).length,0);assert.equal((await s.sources(moved.hospitalName))[0].version,'v3');
 // Reverting source contents still creates an auditable update when the observation is newer.
 await s.ingestSources([{...report,observedAt:'2026-10-14T04:00:00Z'}]);d=await s.handle({action:'work_detail',id},who);assert.equal(d.history.find(h=>h.kind==='result').source.detail,'수정 전');assert.equal(d.history.filter(h=>h.kind==='result').length,1);assert.equal(d.request.status,status);
 assert.equal([...kv.data.values()].filter(e=>e.key[1]==='sourcePending').length,0);
 const events=(await s.bridge('pending',{})).events;assert.ok(events.some(e=>e.kind==='result_source_update'),'updates reach durable Sheet mirror');
}
console.log('work-source-updates: completed/active/hold/cancel, stable history ID, cleared result, SN/classification/part corrections, memo/comments/completion preservation, audit, deltas, replay, stale cross-hospital delivery, renamed/moved source and reversions passed.');
