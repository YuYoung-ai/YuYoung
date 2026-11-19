import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const code=fs.readFileSync(new URL('../js/baz-inspection-upload.js',import.meta.url),'utf8');
const blob=new Blob(['%PDF-immutable']),basis={v:1,fingerprint:'a'.repeat(64),format:'standard'},context={taskId:'task-A',sessionEpoch:1,recordId:'record-A',hospital:'Synthetic A',date:'2026-11-19',sourceBasis:basis,sourcePdfRevision:0,sourcePrepared:false,requireSourceBasis:true};
function fixture(settings={}){
 const nodes=Object.fromEntries(['pdfUploadStatus','pdfUploadRetry','pdfOpenLink','doneNew'].map(id=>[id,{textContent:'',addEventListener(t,f){this[t]=f;}}])),jobs=new Map(),calls=[],saved=[],ui=[],window={};
 class Reader{readAsDataURL(b){b.arrayBuffer().then(v=>{this.result='data:application/pdf;base64,'+Buffer.from(v).toString('base64');this.onload();});}}
 vm.runInNewContext(code,{window,document:{getElementById:id=>nodes[id]},URL,AbortController,crypto,FileReader:Reader,TextEncoder,Uint8Array,atob,setTimeout,clearTimeout});
 const outbox={put:async j=>jobs.set(j.key,structuredClone(j)),remove:async k=>jobs.delete(k),find:settings.find|| (async()=>null)};
 const app=window.BazInspectionUpload.create({url:'https://script.google.com/macros/s/synthetic/exec',outbox,token:()=> 'synthetic-token',isCurrent:settings.isCurrent||(()=>true),onRecovered:j=>ui.push(j),onProgress:s=>ui.push(s),onSaved:(s,c)=>saved.push({s,c}),delay:async()=>{},fetch:async(_,init)=>{const p=JSON.parse(init.body);calls.push(p);if(settings.reply)return {json:async()=>settings.reply(p)};return {json:async()=>p.action==='inspection_pdf_resolve'?{success:true,recordId:p.recordId,pdf:null,sourceBasis:basis}:{success:true,recordId:p.recordId,pdf:{url:'https://drive.google.com/file/d/synthetic/view',sha256:p.sha256,revision:1}}};}});
 return {app,nodes,jobs,calls,saved,ui};
}
for(const change of ['missing','body','revision']){
 const f=fixture({reply:p=>({success:true,recordId:p.recordId,pdf:change==='revision'?{revision:1}:null,sourceBasis:change==='body'?{...basis,fingerprint:'b'.repeat(64)}:basis})});
 await f.app.publish(blob,'original.pdf',{...context,...(change==='missing'?{sourceBasis:null}:{})});assert.equal(f.calls.filter(p=>p.action==='inspection_pdf_upload').length,0);assert.equal(f.jobs.size,1);assert.equal([...f.jobs.values()][0].blob.size,blob.size);assert.equal(f.nodes.pdfUploadRetry.hidden,true);
}
let current=true,releaseFind;const f=fixture({isCurrent:()=>current,find:()=>new Promise(r=>releaseFind=r)}),finding=f.app.restore(context);while(!releaseFind)await new Promise(r=>setTimeout(r,0));current=false;releaseFind({context,blob,filename:'old-A.pdf'});assert.equal(await finding,false);assert.equal(f.ui.length,0,'late restore cannot invoke onRecovered or progress');
let epoch=1,release;const q=fixture({isCurrent:c=>c.sessionEpoch===epoch,reply:async p=>{if(p.action==='inspection_pdf_upload'&&p.taskId==='task-A')await new Promise(r=>release=r);return p.action==='inspection_pdf_resolve'?{success:true,recordId:p.recordId,pdf:null,sourceBasis:basis}:{success:true,recordId:p.recordId,pdf:{url:'https://drive.google.com/file/d/synthetic/view',sha256:p.sha256,revision:1}};}});
const first=q.app.publish(blob,'A.pdf',context);while(!release)await new Promise(r=>setTimeout(r,1));q.app.reset();epoch=2;const second=q.app.publish(blob,'B.pdf',{...context,taskId:'task-B',recordId:'record-B',sessionEpoch:2});
await new Promise(r=>setTimeout(r,5));assert.equal(q.jobs.size,2,'queued B bytes are durable before A finishes');assert.equal(q.calls.filter(p=>p.action==='inspection_pdf_upload').length,1,'uploads are serialized');const before=q.ui.length;release();await first;await second;
assert.equal(q.saved.length,2);assert.equal(q.saved[0].c.taskId,'task-A');assert.equal(q.saved[1].c.taskId,'task-B');assert.equal(q.nodes.pdfOpenLink.hidden,false);assert.equal(q.jobs.size,0);assert.ok(q.ui.length>before);assert.equal(q.calls.filter(p=>p.action==='inspection_pdf_upload').length,2);
console.log('PASS: source/body/revision conflicts preserve original PDF; stale async restore has zero UI effects; detached and queued transfers keep original tasks and durable bytes');
