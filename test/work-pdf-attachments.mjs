import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createWorkStore} from '../deno-auth/work-store.ts';
const source=fs.readFileSync(new URL('./work-kv.mjs',import.meta.url),'utf8');
const Kv=vm.runInNewContext(source.slice(source.indexOf('class Kv{'),source.indexOf('\nconst kv='))+'\nKv;', {structuredClone});
const who={name:'CS A',level:3},hospital={id:'h1',key:'hospital',name:'검증 병원',sn:'BW4015',region:'서울'};
const form={hospitalKey:hospital.key,symptom:'장비 점검',cs:who.name,engineer:who.name,sales:'',status:'방문예정',registeredAt:'2026-10-14T09:00',visitAt:'2026-10-14T10:00',deadline:''};
const report={date:'2026-10-14',hospitalName:hospital.name,engineer:who.name,sn:'BW4015',gubun:'점검',result:'정상',detail:'정상 확인',recordId:'report-one',version:'v1',observedAt:'2026-10-14T00:01:00Z'};
const pdf={fileId:'drive-file-one',url:'https://drive.google.com/file/d/drive-file-one/view',filename:'AS_검증병원_2026-10-14.pdf',bytes:7*1024*1024,sha256:'a'.repeat(64),revision:1,uploadedAt:'2026-10-14T00:02:00Z',uploadedBy:who.name,uploadId:'upload-one'};
async function fixture(){const kv=new Kv(),store=createWorkStore(kv);await store.bridge('seed',{hospitals:[hospital],references:{engineers:[who.name],minimumLevel:1}});await store.bridge('activate',{manifest:await store.manifest()});return {kv,store};}
const write=(s,action,p)=>s.handle({action,operationId:crypto.randomUUID(),...p},who);
const {store,kv}=await fixture();const saved=await write(store,'work_save',{form});assert.ok(saved.success,saved.error);const id=saved.request.id;
await store.ingestSources([report]);let d=await store.handle({action:'work_detail',id},who);assert.equal(d.history.length,1);
await write(store,'work_status',{requestId:id,baseRevision:d.request.revision,status:'완료'});
await store.ingestSources([{...report,pdf,version:'v2',observedAt:pdf.uploadedAt}]);
d=await store.handle({action:'work_detail',id},who);
const attached=d.history.find(h=>h.attachment);assert.equal(attached.body,'AS/점검 내역서');assert.equal(attached.attachment.url,pdf.url);assert.equal(d.request.status,'완료','PDF arrival must not reopen completed work');
const rev=d.request.revision;await store.ingestSources([{...report,pdf,version:'v2',observedAt:pdf.uploadedAt}]);d=await store.handle({action:'work_detail',id},who);assert.equal(d.request.revision,rev);assert.equal(d.history.filter(h=>h.attachment).length,1,'redelivery never duplicates comments');
const regular=await write(store,'work_history_add',{requestId:id,body:'사용자 보완 댓글'});assert.ok(regular.success);
const updated={...pdf,fileId:'drive-file-two',url:'https://drive.google.com/file/d/drive-file-two/view?resourcekey=key123',revision:2,sha256:'b'.repeat(64),uploadedAt:'2026-10-14T00:03:00Z'};
await store.ingestSources([{...report,pdf:updated,version:'v3',observedAt:updated.uploadedAt}]);d=await store.handle({action:'work_detail',id},who);
assert.equal(d.history.filter(h=>h.attachment).length,1);assert.equal(d.history.find(h=>h.attachment).id,attached.id);assert.equal(d.history.find(h=>h.attachment).revision,2);assert.equal(d.history.find(h=>h.attachment).attachment.url,updated.url);assert.ok(d.history.some(h=>h.body==='사용자 보완 댓글'));assert.equal(d.history.find(h=>h.kind==='result').source.detail,report.detail);
await store.ingestSources([{...report,pdf,version:'v2',observedAt:pdf.uploadedAt}]);d=await store.handle({action:'work_detail',id},who);assert.equal(d.history.find(h=>h.attachment).attachment.sha256,updated.sha256,'late old delivery cannot replace a regenerated PDF');
const change=await write(store,'work_history_update',{requestId:id,historyId:attached.id,baseHistoryRevision:2,body:'수정 시도'});assert.equal(change.success,false);
const removed=await write(store,'work_history_update',{requestId:id,historyId:attached.id,baseHistoryRevision:2,deleted:true});assert.ok(removed.success);assert.equal(removed.history.attachment.url,updated.url,'comment lifecycle preserves the file metadata');
await store.handle({action:'work_sync',revision:'0'},who);d=await store.handle({action:'work_detail',id},who);assert.ok(d.history.find(h=>h.attachment).deletedAt,'sync does not resurrect an explicitly deleted comment');
for(const entry of kv.data.values())assert.ok(JSON.stringify(entry.value).length<48000,'even a 7MB PDF contributes metadata only to KV');
assert.equal([...kv.data.values()].filter(e=>e.key[1]==='pdfPending').length,0,'completed receipts leave no pending scan work');
await assert.rejects(()=>store.ingestSources([{...report,pdf:{...pdf,url:'https://attacker.example/steal'},observedAt:'2026-10-14T00:04:00Z'}]),/링크/);
await assert.rejects(()=>store.ingestSources([{...report,pdf:{...pdf,bytes:7*1024*1024+1},observedAt:'2026-10-14T00:04:00Z'}]),/정보/);
// A PDF before result linking waits until that exact source is connected.
const early=await fixture();const er=await write(early.store,'work_save',{form});
await early.store.ingestSources([{...report,result:'',pdf}]);let ed=await early.store.handle({action:'work_detail',id:er.request.id},who);assert.equal(ed.history.length,0);
await early.store.ingestSources([{...report,pdf,version:'ready',observedAt:'2026-10-14T00:05:00Z'}]);ed=await early.store.handle({action:'work_detail',id:er.request.id},who);assert.equal(ed.history.filter(h=>h.attachment).length,1);assert.equal(ed.history.filter(h=>h.kind==='result').length,1);
// Ambiguous visits receive no PDF comment until a user selects the source.
const ambiguous=await fixture(),a=await write(ambiguous.store,'work_save',{form}),b=await write(ambiguous.store,'work_save',{form,acknowledgeDuplicates:true});assert.ok(b.success);
await ambiguous.store.ingestSources([{...report,pdf}]);let ad=await ambiguous.store.handle({action:'work_detail',id:a.request.id},who);assert.equal(ad.history.length,0);
const manual=await write(ambiguous.store,'work_result_save',{requestId:a.request.id,baseRevision:ad.request.revision,recordId:report.recordId,sourceVersion:report.version,memo:''});assert.ok(manual.success,manual.error);assert.equal(manual.workDetail.history.filter(h=>h.attachment).length,1);assert.equal((await ambiguous.store.handle({action:'work_detail',id:b.request.id},who)).history.length,0);
// An older deployment may already have stored the PDF metadata without a pending receipt.
const migrated=await fixture(),mr=await write(migrated.store,'work_save',{form});await migrated.store.ingestSources([report]);await migrated.kv.set(['hospitalwork-v2','source',report.hospitalName,report.recordId],{...report,pdf});await migrated.store.ingestSources([{...report,pdf}]);assert.equal((await migrated.store.handle({action:'work_detail',id:mr.request.id},who)).history.filter(h=>h.attachment).length,1);
console.log('work-pdf-attachments: completed status, ID binding, 7MB metadata-only KV, idempotency, regeneration, original comments/results, lifecycle, stale delivery, delayed/ambiguous/manual linking and old-deployment recovery passed.');
