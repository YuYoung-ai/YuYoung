import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const nodes=Object.fromEntries(['pdfUploadStatus','pdfUploadRetry','pdfOpenLink','doneNew'].map(id=>[id,{addEventListener(type,fn){this[type]=fn;}}]));
const metrics=[],window={BazPerf:{start(name,at){return extra=>metrics.push({name,at,...extra});}}},body=fs.readFileSync(new URL('../js/baz-inspection-upload.js',import.meta.url),'utf8');
class Reader{
 async readAsDataURL(blob){
  this.result='data:application/pdf;base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64');
  this.onload();
 }
}
vm.runInNewContext(body,{window,document:{getElementById:id=>nodes[id]},URL,AbortController,FileReader:Reader,TextEncoder,Uint8Array,crypto,atob,setTimeout,clearTimeout});
const jobs=new Map(),audit=[],saved=[],progress=[];
const outbox={put:async job=>jobs.set(job.key,structuredClone(job)),remove:async key=>jobs.delete(key),find:async owner=>[...jobs.values()].find(job=>job.owner===owner)};
let server=null,online=false,dropResponse=true,lockFailures=0,readsUntilComplete=0,completeOnSubmit=false;
function fixture(repairTarget,onSaved=value=>saved.push(value)){
 return window.BazInspectionUpload.create({
  url:'https://script.google.com/macros/s/fixture/exec',token:()=> 'fixture-token',outbox,delay:async()=>{},
  repairTarget,onSaved,onProgress:value=>progress.push(value),
  fetch:async(_url,init)=>{
   const p=JSON.parse(init.body),action=p.action.replace('inspection_pdf_job_','');audit.push({action,id:p.uploadId,base64:!!p.base64,requestId:p.requestId});
   if(action==='submit'){
    assert.equal(p.sourceVersion,'canonical-sheet-version');
    assert.equal(p.sourceBasis.fingerprint,'b'.repeat(64));
    assert.equal(p.baseRevision,0);
    assert.equal(server,null);
    server={success:true,state:'drive',jobId:p.uploadId,requestId:p.requestId,recordId:p.recordId,sha256:p.sha256,bytes:p.bytes,filename:p.filename,received:true};
    if(dropResponse)throw new TypeError('synthetic response loss after durable receipt');
   }
   if(action==='resume'&&lockFailures>0){lockFailures--;return {json:async()=>({success:false,code:'LOCK_BUSY',retryable:true})};}
   if(action==='submit'&&completeOnSubmit||action==='resume'&&online||action==='status'&&readsUntilComplete>0&&--readsUntilComplete===0)server={...server,serverMs:680,requestId:p.requestId||server.requestId,state:'complete',commentAttached:true,pdf:{sha256:server.sha256,revision:1,url:'https://drive.google.com/file/d/fixture-file/view'}};
   return {json:async()=>server};
  }
 });
}
const app=fixture(),context={taskId:'original-draft',recordId:'original-record',requestId:'original-request',hospital:'Synthetic hospital',date:'2026-11-19',transferVersion:2,sourcePdfRevision:0,sourceVersion:'canonical-sheet-version',sourceBasis:{format:'standard',fingerprint:'b'.repeat(64)}};
await app.publish(new Blob(['%PDF-1.7 fixed']),'original.pdf',context);
assert.deepEqual(audit.map(event=>event.action),['submit','status','resume']);
assert.equal(nodes.pdfUploadRetry.hidden,false);
assert.equal(nodes.pdfUploadRetry.textContent,'이어서 전송');
assert.ok([...jobs.values()][0].blob,'original PDF is available locally while the server establishes its share link');
const reopened=fixture();
assert.equal(await reopened.restore(context),true);
online=true;await nodes.pdfUploadRetry.click();
assert.deepEqual(audit.map(event=>event.action),['submit','status','resume','status','resume']);
assert.equal(new Set(audit.map(event=>event.id)).size,1);
assert.equal(audit.filter(event=>event.base64).length,1);
assert.equal(progress.at(-1).comment,'done');
assert.equal(saved.length,1);assert.equal(jobs.size,0);
dropResponse=false;server=null;audit.length=0;
completeOnSubmit=true;
const fastBlob=new Blob(['%PDF-1.7 nominal']);
await fixture().publish(fastBlob,'nominal.pdf',context,123);
assert.deepEqual(audit.map(event=>event.action),['submit']);
assert.equal(progress.at(-1).comment,'done');assert.equal(nodes.pdfUploadRetry.hidden,true);
assert.equal(metrics.findLast(metric=>metric.name==='inspection_pdf_job_submit').serverMs,680);
assert.deepEqual(metrics.at(-1),{name:'pdf_delivery_total',at:123,bytes:fastBlob.size,jobId:audit[0].id});
server=null;audit.length=0;
let failLocalSave=true;
await fixture(undefined,()=>{
 if(failLocalSave)throw new Error('synthetic device storage quota');
}).publish(fastBlob,'nominal.pdf',context);
assert.equal(progress.at(-1).comment,'done','a local draft failure cannot undo confirmed server completion');
assert.equal(nodes.pdfUploadRetry.textContent,'기기 연결 정보 다시 보관');
assert.equal(nodes.pdfUploadRetry.hidden,false);
failLocalSave=false;
await nodes.pdfUploadRetry.click();
assert.deepEqual(audit.map(event=>event.action),['submit','status']);
assert.equal(nodes.pdfUploadRetry.hidden,true);
completeOnSubmit=false;server=null;audit.length=0;
await fixture().publish(new Blob(['%PDF-1.7 nominal']),'nominal.pdf',context);
assert.deepEqual(audit.map(event=>event.action),['submit','resume']);
assert.equal(progress.at(-1).comment,'done');assert.equal(nodes.pdfUploadRetry.hidden,true);
server=null;audit.length=0;progress.length=0;lockFailures=2;readsUntilComplete=2;
await fixture().publish(new Blob(['%PDF-1.7 concurrent trigger']),'locked.pdf',context);
assert.deepEqual(audit.map(event=>event.action),['submit','resume','status','status']);
assert.equal(progress.at(-1).comment,'done');assert.equal(nodes.pdfUploadRetry.hidden,true);
assert.ok(progress.every(value=>value.drive!=='error'&&value.handover!=='error'));
assert.equal(lockFailures,1,'the browser never races the background process with a second resume');
readsUntilComplete=0;lockFailures=0;online=false;
server={...server,state:'drive',requestId:'',pdf:null,commentAttached:false,code:'TARGET_PENDING'};
audit.length=0;let repairs=0;
const resumed=fixture(async target=>{assert.equal(target.requestId,context.requestId);repairs++;online=true;});
assert.equal(await resumed.restoreServer(context),true);
await nodes.pdfUploadRetry.click();
assert.deepEqual(audit.map(event=>event.action),['lookup','status','resume','resume']);
assert.equal(repairs,1);assert.equal(audit.filter(event=>event.base64).length,0);
assert.ok(audit.filter(event=>event.action==='resume').every(event=>event.requestId===context.requestId));
assert.equal(progress.at(-1).comment,'done');assert.equal(nodes.pdfUploadRetry.hidden,true);
console.log('PASS: response loss, original-file resume after linking, lock contention read-back, and no duplicate upload.');
