import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const candidate=process.env.INSPECTION_TEST_STORE;
if(candidate)globalThis.Deno={env:{get:()=>''},cron(){},serve(){}};
const {createWorkStore}=await import(candidate?pathToFileURL(candidate):'../deno-auth/work-store.ts');

const data=new Map();
let version=0;
let exactReadsOnly=false;
const get=key=>data.get(JSON.stringify(key))||{key,value:null,versionstamp:null};
const set=(key,value)=>data.set(JSON.stringify(key),{key,value:structuredClone(value),versionstamp:String(++version)});
const kv={
 async get(key){return structuredClone(get(key));},
 async set(key,value){set(key,value);},
 async *list({prefix}){
  if(exactReadsOnly)throw new Error('Targeted PDF completion must not scan KV ranges');
  for(const entry of [...data.values()])if(prefix.every((part,i)=>entry.key[i]===part))yield structuredClone(entry);
 },
 atomic(){
  const checks=[],writes=[],removals=[];
  const transaction={
   then(){throw new Error('Call commit on the atomic operation');},
   check(...entries){checks.push(...entries);return transaction;},
   set(key,value){writes.push([key,value]);return transaction;},
   delete(key){removals.push(key);return transaction;},
   async commit(){
    if(checks.some(entry=>get(entry.key).versionstamp!==entry.versionstamp))return {ok:false};
    for(const [key,value] of writes)set(key,value);
    for(const key of removals)data.delete(JSON.stringify(key));
    return {ok:true};
   }
  };
  return transaction;
 }
};
const namespace='hospitalwork-v2';
const requestId='request_fixture',recordId='record_fixture';
const context={hospitalName:'합성 병원',date:'2026-11-19',sn:'SN-FIXTURE'};
const request={id:requestId,hospitalId:'fixture',hospitalName:context.hospitalName,visitAt:'2026-11-18T09:00',sn:context.sn,revision:1,updatedAt:'2026-11-19T00:00:00Z',status:'결과확인'};
const history={id:'history_fixture',requestId,kind:'result',source:{...context,recordId,gubun:'점검'}};
set([namespace,'meta'],{ready:true,seq:1});
set([namespace,'refs'],{minimumLevel:1});
set([namespace,'request',requestId],request);
set([namespace,'history',requestId,history.id],history);
const store=createWorkStore(kv);
const pdf={fileId:'fixture-file',url:'https://drive.google.com/file/d/fixture-file/view',filename:'fixture.pdf',sha256:'a'.repeat(64),revision:1,bytes:30,uploadedBy:'fixture',uploadedAt:'2026-11-19T00:00:00Z',uploadId:'fixture_upload'};
const delivery={recordId,requestId,revision:pdf.revision,sha256:pdf.sha256,document:{recordId,requestId,context,pdf}};
assert.equal((await store.bridge('inspection_complete',delivery)).code,'TARGET_PENDING');
set([namespace,'link',recordId],{requestId,historyId:history.id});
assert.equal((await store.bridge('inspection_target',{...delivery,requestId:'wrong_request'})).code,'TARGET_CHANGED');
set([namespace,'documentPending','unrelated_fixture'],{recordId:'unrelated_fixture'});
exactReadsOnly=true;
const completed=await store.bridge('inspection_complete',delivery);
assert.equal(completed.complete,true,'exact linked record permits actual service date different from scheduled date');
for(const field of ['requestId','recordId','sha256','revision'])assert.equal(completed[field],delivery[field]);
assert.equal(completed.fileId,pdf.fileId);
assert.ok(Number.isFinite(Date.parse(completed.checkedAt)));
assert.equal(Object.values(completed.stageTimings).length,3);
assert.equal((await store.bridge('inspection_complete',delivery)).complete,true);
const comments=[...data.values()].filter(x=>x.key[1]==='history'&&x.value.kind==='comment');
assert.equal(comments.length,1);
assert.equal(comments[0].value.attachment.sha256,pdf.sha256);
assert.equal(get([namespace,'request',requestId]).value.revision,2,'lost reply does not update the same comment again');
assert.ok(get([namespace,'documentPending','unrelated_fixture']).value,'targeted processing leaves unrelated pending work alone');
data.delete(JSON.stringify(comments[0].key));
// Use a new version to model a saved receipt whose attachment checkpoint was lost.
const later={...pdf,sha256:'b'.repeat(64),revision:2};
set([namespace,'document',recordId],{recordId,requestId,context,pdf:later});
const repaired=await store.bridge('inspection_complete',{...delivery,revision:later.revision,sha256:later.sha256,document:{...delivery.document,pdf:later}});
assert.equal(repaired.complete,true,'registered PDF can recover even when its pending checkpoint is missing');
assert.equal(get(comments[0].key).value.attachment.sha256,later.sha256);
assert.equal((await store.bridge('inspection_complete',delivery)).code,'VERSION_CHANGED');
const laterDelivery={...delivery,revision:later.revision,sha256:later.sha256,document:{...delivery.document,pdf:later}};
const wrongFile={...later,fileId:'other-file',url:'https://drive.google.com/file/d/other-file/view'};
assert.equal((await store.bridge('inspection_complete',{...laterDelivery,document:{...laterDelivery.document,pdf:wrongFile}})).code,'VERSION_CHANGED');
const attached=get(comments[0].key).value;
set(comments[0].key,{...attached,attachment:wrongFile});
assert.equal((await store.bridge('inspection_complete',laterDelivery)).code,'FILE_CONFLICT');
set([namespace,'request',requestId],{...request,status:'취소'});
assert.equal((await store.bridge('inspection_target',laterDelivery)).code,'TARGET_CHANGED');
assert.equal((await store.bridge('inspection_complete',laterDelivery)).code,'TARGET_CHANGED');
set([namespace,'request',requestId],request);
set(comments[0].key,{...comments[0].value,deletedAt:'2026-11-19T01:00:00Z'});
assert.equal((await store.bridge('inspection_complete',delivery)).code,'COMMENT_DELETED');
console.log('PASS: actual KV target validation, exact record attachment, replay safety, targeted processing and preservation of deleted comments.');
