import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const code=fs.readFileSync(new URL('../js/baz-inspection-upload.js',import.meta.url),'utf8');
const pdf={url:'https://drive.google.com/file/d/synthetic-file/view',sha256:'a'.repeat(64),revision:1,bytes:16};
const context={hospital:'Synthetic Hospital',date:'2026-10-22',recordId:'record_123',taskId:'task_123'};
const jobs=new Map(),outbox={put:async job=>jobs.set(job.key,structuredClone(job)),remove:async key=>jobs.delete(key),find:async owner=>[...jobs.values()].find(j=>j.owner===owner)};
function fixture(options={}){
 const nodes=Object.fromEntries(['pdfUploadStatus','pdfUploadRetry','pdfOpenLink','doneNew'].map(id=>[id,{addEventListener(t,fn){this[t]=fn;}}])),stages=[],calls=[];
 const window={},cryptoFallback={subtle:crypto.subtle,getRandomValues:crypto.getRandomValues.bind(crypto)};
 class Reader{readAsDataURL(blob){this.readyState=1;blob.arrayBuffer().then(bytes=>{this.readyState=2;this.result='data:application/pdf;base64,'+Buffer.from(bytes).toString('base64');this.onload?.();});}abort(){this.readyState=2;}}
 vm.runInNewContext(code,{window,document:{getElementById:id=>nodes[id]},URL,AbortController,setTimeout:options.setTimeout||setTimeout,clearTimeout:options.clearTimeout||clearTimeout,crypto:cryptoFallback,FileReader:Reader,Uint8Array,TextEncoder,atob});
 const app=window.BazInspectionUpload.create({outbox,token:()=>typeof options.token==='function'?options.token():options.token||'synthetic-token',onSaved:options.onSaved||function(){},onRecovered:options.onRecovered,onIdle:options.onIdle,onProgress:s=>stages.push(s),confirmAttachment:options.confirm||(async()=>({applicable:true})),prepareContext:async c=>({...c,requestId:'request_123'}),url:'https://script.google.com/macros/s/synthetic/exec',fetch:async(url,init)=>{const p=JSON.parse(init.body);calls.push(p);return options.fetch?options.fetch(p):{json:async()=>p.action==='inspection_pdf_resolve'?{success:true,recordId:context.recordId,pdf:null}:{success:true,recordId:context.recordId,pdf}};}});
 return {app,nodes,stages,calls};
}
const until=async fn=>{for(let i=0;i<1000&&!fn();i++)await new Promise(r=>setTimeout(r,1));assert.ok(fn(),'asynchronous checkpoint reached');};
const a=fixture({fetch:async p=>{if(p.action==='inspection_pdf_upload')throw new TypeError('offline');return {json:async()=>({success:true,recordId:context.recordId,pdf:null})};}});
const prepared=await a.app.prepare(context);assert.equal(prepared.requestId,'request_123','pre-render context hook actually runs');
const blob=new Blob(['%PDF-synthetic']);await a.app.publish(blob,'synthetic.pdf',prepared);
assert.equal(a.nodes.pdfUploadRetry.hidden,false);assert.equal(jobs.size,1);
const first=a.calls.find(p=>p.action==='inspection_pdf_upload');assert.match(first.uploadId,/^[a-f0-9-]{36}$/,'Safari UUID fallback');
const durable=[...jobs.values()][0];assert.ok(durable.blob instanceof Blob);assert.equal(durable.blob.size,blob.size);assert.ok(!('base64' in durable));assert.ok(!JSON.stringify(durable).includes('synthetic-token'));
const other=fixture({token:'other-account'});assert.equal(await other.app.restore(context),false,'another account cannot recover the file');
const b=fixture();assert.equal(await b.app.restore(context),true);await b.nodes.pdfUploadRetry.click();const retried=b.calls.find(p=>p.action==='inspection_pdf_upload');
for(const key of ['uploadId','sha256','base64','baseRevision','recordId','requestId'])assert.equal(retried[key],first[key],key+' survives reload');
assert.equal(jobs.size,0);assert.equal(b.stages.at(-1).comment,'done');
// Abort-ignoring fetch and JSON promises must not permanently disable retry.
let hang=true,deadline;
const c=fixture({setTimeout(fn,ms){if(ms===120000){deadline=fn;return -1;}return setTimeout(fn,ms);},clearTimeout(id){if(id!==-1)clearTimeout(id);},fetch:async p=>{if(p.action==='inspection_pdf_upload'&&hang)return new Promise(()=>{});return {json:async()=>p.action==='inspection_pdf_resolve'?{success:true,recordId:context.recordId,pdf:null}:{success:true,recordId:context.recordId,pdf}};}});
const p=await c.app.prepare(context),running=c.app.publish(blob,'same.pdf',p);await until(()=>c.calls.some(x=>x.action==='inspection_pdf_upload'));
assert.equal(c.nodes.pdfUploadRetry.hidden,true);assert.equal(c.nodes.pdfUploadRetry.disabled,true);assert.equal(c.app.isBusy(),true);
await c.nodes.pdfUploadRetry.click();assert.equal(c.calls.filter(p=>p.action==='inspection_pdf_upload').length,1,'a click does not abort/restart the server write');
assert.equal(c.app.publish(blob,'duplicate.pdf',p),running,'a second publish cannot start another transfer');
hang=false;deadline();await running;assert.equal(c.app.isBusy(),false);assert.equal(c.nodes.pdfUploadRetry.disabled,false);await c.nodes.pdfUploadRetry.click();
const uploads=c.calls.filter(p=>p.action==='inspection_pdf_upload');assert.equal(uploads.length,2);assert.equal(uploads[0].uploadId,uploads[1].uploadId);assert.equal(c.stages.at(-1).comment,'done');
const d=fixture({confirm:async()=>({applicable:false})});await d.app.publish(blob,'standalone.pdf',await d.app.prepare(context));assert.equal(d.stages.at(-1).comment,'skipped');assert.equal(d.nodes.pdfUploadRetry.hidden,true);
// A saved file's attachment failure remains durable; restore never sends bytes.
const e=fixture({confirm:async()=>{throw new Error('bridge delayed');}});await e.app.publish(blob,'saved.pdf',await e.app.prepare(context));assert.equal(e.nodes.pdfUploadRetry.hidden,false);assert.ok([...jobs.values()][0].saved);
const f=fixture();assert.equal(await f.app.restore(context),true);await f.nodes.pdfUploadRetry.click();assert.equal(f.calls.length,0);assert.equal(f.stages.at(-1).comment,'done');
// A warm-up/partial success response is not source verification. It must never
// transmit PDF bytes until a subsequent response supplies the real record ID.
for(const missingId of [undefined,null,'', '   ',42]){
 const g=fixture({fetch:async()=>({json:async()=>({success:true,recordId:missingId,ver:'3.9.0'})})});
 await g.app.publish(blob,'preserved.pdf',await g.app.prepare(context));
 assert.equal(g.nodes.pdfUploadRetry.hidden,false);assert.equal(g.calls.filter(c=>c.action==='inspection_pdf_upload').length,0);
 const old=[...jobs.values()][0];assert.equal(old.blob.size,blob.size);const uploadId=old.uploadId;
 old.context.sourcePreparationError='AS 처리 현황의 기록 ID를 확인하지 못했습니다.';old.preparationRetryable=false;jobs.set(old.key,old);
 const h=fixture();assert.equal(await h.app.restore(context),true);await h.nodes.pdfUploadRetry.click();
 const sent=h.calls.find(c=>c.action==='inspection_pdf_upload');assert.ok(sent);assert.equal(sent.uploadId,uploadId);assert.equal(Buffer.from(sent.base64,'base64').toString(),'%PDF-synthetic');assert.equal(jobs.size,0);
}
console.log('PDF delivery recovery: missing route ID, Safari UUID fallback, durable same-file receipt, owner isolation, interrupted upload, abort-ignoring transport, saved-file-only recovery and unlinked status passed');
let owner='initial-owner',releaseResponse,idleCalls=0;
const changed=fixture({token:()=>owner,onIdle(){idleCalls++;},fetch:async()=>{await new Promise(resolve=>{releaseResponse=resolve;});return {json:async()=>({success:true,recordId:context.recordId,pdf})};}});
const switched=changed.app.publish(blob,'account.pdf',context);await until(()=>releaseResponse);
owner='another-owner';releaseResponse();await switched;
assert.equal(idleCalls,0,'an old-account transfer never starts deferred task/photo synchronization with the new token');
let recoveredSaved=0,recoveredMetadata;
const metadataOnly=fixture({onSaved(value,c){recoveredSaved++;assert.equal(c.taskId,context.taskId);assert.equal(value.pdf.sha256,pdf.sha256);},onRecovered:j=>{recoveredMetadata=j;},fetch:async()=>({json:async()=>({success:true,recordId:context.recordId,pdf})})});
await metadataOnly.app.recover(context);
assert.deepEqual(metadataOnly.calls.map(c=>c.action),['inspection_pdf_resolve'],'recover the canonical saved PDF without uploading a file');
assert.equal(recoveredSaved,1);assert.equal(recoveredMetadata.blob,undefined);assert.equal(metadataOnly.nodes.pdfOpenLink.href,pdf.url);assert.equal(metadataOnly.stages.at(-1).comment,'done');
const wrongRecovery=fixture({fetch:async()=>({json:async()=>({success:true,recordId:'wrong-record',pdf})})});await wrongRecovery.app.recover(context);assert.equal(wrongRecovery.nodes.pdfUploadRetry.hidden,true);assert.equal(wrongRecovery.calls.length,1);
let confirmationDeadline,confirmationSignal;
const confirmation=fixture({setTimeout(fn,ms){if(ms===120000){confirmationDeadline=fn;return -1;}return setTimeout(fn,ms);},clearTimeout(id){if(id!==-1)clearTimeout(id);},confirm:async(s,c,o)=>{confirmationSignal=o.signal;return new Promise(()=>{});}});
const verifying=confirmation.app.resume({success:true,pdf},context);await until(()=>confirmationSignal);confirmationDeadline();await verifying;
assert.equal(confirmationSignal.aborted,true,'the parent deadline cancels the underlying confirmation instead of leaving a late repair running');assert.equal(confirmation.nodes.pdfUploadRetry.hidden,false);
console.log('PASS: metadata-only saved PDF recovery, source guard and shared confirmation cancellation');
