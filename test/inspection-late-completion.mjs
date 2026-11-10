import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const code=fs.readFileSync(new URL('../js/baz-inspection-upload.js',import.meta.url),'utf8');
const blob=new Blob(['%PDF-late-completion']),sha=Buffer.from(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())).toString('hex');
const context={hospital:'Synthetic Hospital',date:'2026-11-10',sn:'SYNTHETIC',recordId:'record-one',requestId:'request-one',taskId:'task-one',sourcePdfRevision:0};
const pdf={url:'https://drive.google.com/file/d/synthetic-file/view',sha256:sha,revision:1,filename:'same.pdf',bytes:blob.size};
const jobs=new Map(),outbox={put:async j=>jobs.set(j.key,structuredClone(j)),remove:async k=>jobs.delete(k),find:async owner=>[...jobs.values()].find(j=>j.owner===owner)};
function fixture(settings={}){
 const nodes=Object.fromEntries(['pdfUploadStatus','pdfUploadRetry','pdfOpenLink','doneNew'].map(id=>[id,{addEventListener(t,f){this[t]=f;}}])),events={},stages=[],calls=[],delays=[];let now=1000000;
 class Reader{readAsDataURL(blob){this.readyState=1;blob.arrayBuffer().then(b=>{this.readyState=2;this.result='data:application/pdf;base64,'+Buffer.from(b).toString('base64');this.onload?.();});}abort(){this.readyState=2;}}
 class TestDate extends Date{static now(){return now;}}
 const window={addEventListener:(name,fn)=>{events[name]=fn;}},doc={getElementById:id=>nodes[id],addEventListener:(name,fn)=>{events[name]=fn;},hidden:false};
 vm.runInNewContext(code,{window,document:doc,URL,AbortController,crypto,FileReader:Reader,TextEncoder,Uint8Array,atob,Date:TestDate,setTimeout:settings.setTimeout||setTimeout,clearTimeout:settings.clearTimeout||clearTimeout});
 const app=window.BazInspectionUpload.create({url:'https://script.google.com/macros/s/synthetic/exec',outbox,token:()=> 'synthetic-token',delay:async ms=>{delays.push(ms);now+=ms;},onSaved:settings.onSaved||(()=>{}),onProgress:s=>stages.push(s),confirmAttachment:settings.confirm|| (async()=>({applicable:true})),fetch:async(u,o)=>{const p=JSON.parse(o.body);calls.push(p);return {json:async()=>settings.reply?settings.reply(p):{success:true,recordId:context.recordId,pdf}};}});
 return {app,calls,nodes,events,stages,delays,advance:ms=>{now+=ms;}};
}
const until=async fn=>{for(let i=0;i<1000&&!fn();i++)await new Promise(r=>setTimeout(r,1));assert.ok(fn(),'async checkpoint');};
let comments=0,saves=0,probes=0;
let f=fixture({onSaved(){saves++;},reply(p){if(p.action==='inspection_pdf_upload')throw new TypeError('response lost after commit');probes++;return {success:true,recordId:context.recordId,pdf:probes>=3?pdf:null};},confirm:async()=>{comments++;if(comments<3){const e=Error('projection delayed');e.pending=true;throw e;}return {applicable:true};}});
await f.app.publish(blob,'same.pdf',context);assert.equal(f.calls.filter(p=>p.action==='inspection_pdf_upload').length,1);assert.equal(probes,3);assert.equal(comments,3);assert.equal(saves,1);assert.equal(f.stages.at(-1).comment,'done');assert.equal(jobs.size,0);assert.deepEqual(f.delays,[2000,5000,2000,5000]);
// When the browser deadline fires before the server's late response, read the
// receipt and finish attachment without another upload. Late JSON is harmless.
let deadline,releaseUpload,readBacks=0;
f=fixture({setTimeout(fn,ms){if(ms===120000){deadline=fn;return -1;}return setTimeout(fn,ms);},clearTimeout(id){if(id!==-1)clearTimeout(id);},reply(p){if(p.action==='inspection_pdf_upload')return new Promise(resolve=>{releaseUpload=()=>resolve({success:true,recordId:context.recordId,pdf});});readBacks++;return {success:true,recordId:context.recordId,pdf};}});
const running=f.app.publish(blob,'timeout.pdf',context);await until(()=>releaseUpload);deadline();await running;assert.equal(readBacks,1);assert.equal(f.calls.filter(p=>p.action==='inspection_pdf_upload').length,1);assert.equal(f.stages.at(-1).comment,'done');releaseUpload();await Promise.resolve();assert.equal(jobs.size,0);
// Persisted attachment work resumes after network recovery without file bytes.
let online=false;f=fixture({confirm:async()=>{if(!online){const e=Error('offline');e.pending=true;throw e;}return {applicable:true};}});
await f.app.publish(blob,'pending.pdf',context);assert.equal(jobs.size,1);const savedJob=[...jobs.values()][0];assert.equal(savedJob.saved.pdf.sha256,sha);assert.equal(savedJob.blob,null);
online=true;f.advance(6000);f.events.online();await until(()=>f.stages.at(-1)?.comment==='done');assert.equal(f.calls.filter(p=>p.action==='inspection_pdf_upload').length,1);assert.equal(jobs.size,0);
// A pre-existing uncertain outbox entry is reconciled on reopening, not resent.
f=fixture({reply(p){if(p.action==='inspection_pdf_upload')throw new TypeError('offline');return {success:true,recordId:context.recordId,pdf:null};}});await f.app.publish(blob,'reload.pdf',context);assert.equal(jobs.size,1);const original=[...jobs.values()][0],uploadId=original.uploadId;
const restored=fixture();assert.equal(await restored.app.restore(context,{automatic:true}),true);await until(()=>restored.stages.at(-1)?.comment==='done');assert.equal(restored.calls.filter(p=>p.action==='inspection_pdf_upload').length,0);assert.equal(restored.calls[0].action,'inspection_pdf_resolve');assert.equal(original.uploadId,uploadId);assert.equal(jobs.size,0);
// Lock failures from older deployments keep the rendered PDF retryable.
f=fixture({reply:()=>({success:false,error:'잠금 시간초과: 다른 프로세스가 잠금을 유지하고 있습니다.'})});const prepared=await f.app.prepare(context);await f.app.publish(blob,'lock.pdf',prepared);assert.equal(f.nodes.pdfUploadRetry.hidden,false);assert.equal(f.calls.filter(p=>p.action==='inspection_pdf_upload').length,0);
console.log('PASS: late committed receipt, timeout-before-response, bounded attachment retry, online recovery, automatic same-file outbox restore and legacy lock classification without duplicate upload');
jobs.clear();let localAttempts=0,attachedAfterLocalError=0;
f=fixture({onSaved(){if(++localAttempts===1)throw Error('local quota');},confirm:async()=>{attachedAfterLocalError++;return {applicable:true};}});
await f.app.publish(blob,'local-quota.pdf',context);assert.equal(attachedAfterLocalError,1,'local receipt failure cannot block the server attachment');assert.equal(jobs.size,1,'keep the local checkpoint repair durable');await f.nodes.pdfUploadRetry.click();assert.equal(f.calls.filter(p=>p.action==='inspection_pdf_upload').length,1);assert.equal(localAttempts,2);assert.equal(jobs.size,0);
console.log('PASS: local draft/checkpoint failure cannot prevent attachment of an already saved PDF');
