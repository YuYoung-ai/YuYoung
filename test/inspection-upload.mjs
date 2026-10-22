import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const nodes=Object.fromEntries(['pdfUploadStatus','pdfUploadRetry','pdfOpenLink','doneNew'].map(id=>[id,{hidden:true,disabled:false,textContent:'',addEventListener(type,fn){this[type]=fn;}}]));
class Reader{readAsDataURL(blob){blob.arrayBuffer().then(a=>{this.result='data:application/pdf;base64,'+Buffer.from(a).toString('base64');this.onload();});}}
const window={};vm.runInNewContext(fs.readFileSync(new URL('../js/baz-inspection-upload.js',import.meta.url),'utf8'),{window,document:{getElementById:id=>nodes[id]},URL,AbortController,setTimeout,clearTimeout,crypto,FileReader:Reader,Uint8Array});
const calls=[],saved=[];let fail=true;
const url='https://script.google.com/macros/s/fixture-upload/exec';
const pdf={url:'https://drive.google.com/file/d/pdf-file-123/view',revision:1};
const app=window.BazInspectionUpload.create({url,token:()=> 'fixture-token',onSaved:(data,context)=>saved.push({data,context}),fetch:async(endpoint,options)=>{const p=JSON.parse(options.body);calls.push({endpoint,p,cache:options.cache,credentials:options.credentials});if(p.action==='inspection_pdf_upload'&&fail)throw new Error('연결 끊김');return {json:async()=>p.action==='inspection_pdf_resolve'?{success:true,recordId:'record-123',pdf:null}:{success:true,recordId:'record-123',pdf}};}});
const size=7*1024*1024,blob=new Blob(['%PDF-1.7\n',' '.repeat(size-9)],{type:'application/pdf'});assert.equal(blob.size,size);
await app.publish(blob,'AS_검증병원_2026-10-14.pdf',{hospital:'검증병원',date:'2026-10-14',sn:'SN1',taskId:'task-one'});
assert.equal(nodes.pdfUploadRetry.hidden,false);assert.match(nodes.pdfUploadStatus.textContent,/연결 끊김/);assert.equal(nodes.doneNew.disabled,false);
const first=calls.find(c=>c.p.action==='inspection_pdf_upload').p;assert.equal(first.bytes,size);assert.equal(Buffer.from(first.base64,'base64').length,size);assert.equal(first.recordId,'record-123');
fail=false;await nodes.pdfUploadRetry.click();const last=calls.at(-1).p;assert.equal(last.uploadId,first.uploadId);assert.equal(last.sha256,first.sha256);assert.equal(last.base64,first.base64);assert.equal(saved.length,1);assert.equal(saved[0].context.taskId,'task-one');assert.equal(nodes.pdfOpenLink.href,pdf.url);assert.equal(nodes.pdfUploadRetry.hidden,true);
assert.ok(calls.every(c=>c.endpoint.split('?')[0]===url&&c.cache==='no-store'&&c.credentials==='omit'),'transport stays on Google with browser cache disabled');
assert.equal(new Set(calls.map(c=>new URL(c.endpoint).searchParams.get('pdfRequest'))).size,calls.length,'each transport avoids a stale cached redirect while retaining the same upload receipt');
const count=calls.length;await app.publish(new Blob([' '.repeat(size+1)]),'large.pdf',{hospital:'검증',date:'2026-10-14'});assert.equal(calls.length,count);assert.match(nodes.pdfUploadStatus.textContent,/7MB/);
const rejected=window.BazInspectionUpload.create({url:'https://yuyoung.yuyoung-ai.deno.net',token:()=>'',fetch:()=>{throw new Error('must not call');},onSaved(){}});await rejected.publish(new Blob(['%PDF-1.7']), 'file.pdf',{hospital:'검증',date:'2026-10-14'});assert.match(nodes.pdfUploadStatus.textContent,/서버 주소/);
app.reset();assert.equal(nodes.pdfOpenLink.hidden,true);assert.equal(nodes.pdfUploadStatus.textContent,'');
const html=fs.readFileSync(new URL('../inspection.html',import.meta.url),'utf8');for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
assert.ok(html.includes('handover:handoverReference'));assert.ok(html.includes('pdfPublisher.publish(pdfBlob'));
console.log('inspection-upload: exact 7MB body/digest, direct Google transport, same-file retry, status/link, task identity, size/endpoint guard and page script syntax passed.');
const verifiedCalls=[];let sourceConflict=false;
const verified=window.BazInspectionUpload.create({url,token:()=> 'fixture-token',onSaved(){},fetch:async(endpoint,options)=>{const p=JSON.parse(options.body);verifiedCalls.push(p);return {json:async()=>p.action==='inspection_pdf_resolve'?{success:true,recordId:'record-123',sourceBasis:{fingerprint:'a'.repeat(64)},pdf:null}:sourceConflict?{success:false,sourceConflict:true,error:'원본이 바뀌었습니다. PDF를 다시 생성하세요.'}:{success:true,recordId:'record-123',pdf}};}});
const prepared=await verified.prepare({hospital:'검증',date:'2026-10-14',pdfFormat:'simplified'});assert.equal(prepared.sourceBasis.fingerprint,'a'.repeat(64));
await verified.publish(new Blob(['%PDF-1.7']), 'verified.pdf',prepared);assert.equal(verifiedCalls.at(-1).sourceBasis.fingerprint,prepared.sourceBasis.fingerprint);assert.equal(verifiedCalls.at(-1).pdfFormat,'simplified');
assert.equal(verifiedCalls.filter(p=>p.action==='inspection_pdf_resolve').length,1,'a prepared source needs no redundant Google resolve before upload');
sourceConflict=true;await verified.publish(new Blob(['%PDF-1.7 changed']), 'verified.pdf',prepared);assert.equal(nodes.pdfUploadRetry.hidden,true,'a changed source requires regeneration, not a doomed same-file retry');
const beforePrepareError=verifiedCalls.length;await verified.publish(new Blob(['%PDF-1.7']), 'offline.pdf',{...prepared,sourcePreparationError:'원본 확인 실패'});assert.equal(verifiedCalls.length,beforePrepareError);assert.match(nodes.pdfUploadStatus.textContent,/다시 생성/);
assert.ok(html.indexOf('()=>pdfPublisher.prepare(')<html.indexOf("step('본문·서명 페이지 생성'"),'source snapshot is captured before the PDF is rendered or reused');
assert.ok(html.includes('pdfPublisher.publish(pdfBlob,shareFilename,uploadContext)'),'publish retains the prepared account and original task context');
console.log('inspection-upload: pre-render source basis, immutable upload context, regeneration on source conflict and local-file preservation after failed preflight passed.');
const stages=[],linkCalls=[];let linkFail=true,saves=0,uploads=0;
const linked=window.BazInspectionUpload.create({url,token:()=> 'fixture-token',onSaved(){saves++;},onProgress:s=>stages.push(s),confirmAttachment:async()=>{linkCalls.push('check');if(linkFail)throw new Error('댓글 대기');},fetch:async(endpoint,options)=>{const p=JSON.parse(options.body);if(p.action==='inspection_pdf_upload')uploads++;return {json:async()=>p.action==='inspection_pdf_resolve'?{success:true,recordId:'record-123',pdf:null}:{success:true,recordId:'record-123',pdf:{...pdf,sha256:'a'.repeat(64)}}};}});
await linked.publish(new Blob(['%PDF-1.7']), 'linked.pdf',{hospital:'검증',date:'2026-10-14',requestId:'request_123'});assert.equal(nodes.pdfOpenLink.hidden,false);assert.equal(nodes.pdfUploadRetry.textContent,'댓글 연결 다시 시도');assert.equal(stages.at(-1).drive,'done');assert.equal(stages.at(-1).comment,'error');
linkFail=false;await nodes.pdfUploadRetry.click();assert.equal(uploads,1,'comment retry never retransmits PDF bytes');assert.equal(saves,1);assert.equal(linkCalls.length,2);assert.equal(stages.at(-1).comment,'done');
await linked.resume({success:true,recordId:'record-123',pdf:{...pdf,sha256:'a'.repeat(64)}},{requestId:'request_123',recordId:'record-123'});assert.equal(uploads,1,'a persisted saved PDF can verify its attachment without the original blob');
let token='account_A',releaseResponse;const delayed=new Promise(r=>releaseResponse=r);
const switched=window.BazInspectionUpload.create({url,token:()=>token,onSaved(){throw new Error('must not record a previous account response');},fetch:async()=>{await delayed;return {json:async()=>({success:true,recordId:'record-123',pdf:null})};}});
const transfer=switched.publish(new Blob(['%PDF-1.7']), 'switch.pdf',{hospital:'검증',date:'2026-10-14'});token='account_B';releaseResponse();await transfer;assert.match(nodes.pdfUploadStatus.textContent,/계정이 변경/);assert.equal(nodes.pdfUploadRetry.hidden,true);
console.log('inspection-upload: independent progress, saved-file link visibility, attachment-only retry/resume, single onSaved and account-switch response protection passed.');
const revisionCalls=[];let otherRevision=3,dropUpload=true;
const concurrent=window.BazInspectionUpload.create({url,token:()=> 'fixture-token',onSaved(){},fetch:async(endpoint,options)=>{const p=JSON.parse(options.body);revisionCalls.push(p);if(p.action==='inspection_pdf_upload'&&dropUpload)throw new Error('응답 유실');return {json:async()=>p.action==='inspection_pdf_resolve'?{success:true,recordId:'record-123',pdf:{revision:otherRevision}}:{success:false,conflict:true,error:'다른 내역서가 저장되었습니다.'}};}});
await concurrent.publish(new Blob(['%PDF-1.7']), 'concurrent.pdf',{hospital:'검증',date:'2026-10-14',sourcePdfRevision:3});otherRevision=4;dropUpload=false;await nodes.pdfUploadRetry.click();assert.deepEqual(revisionCalls.filter(p=>p.action==='inspection_pdf_upload').map(p=>p.baseRevision),[3,3],'retry must not adopt a newer document revision and overwrite it');
assert.equal(nodes.pdfUploadRetry.hidden,true,'a newer document requires regeneration, not an endless upload retry');
console.log('inspection-upload: concurrent-document retry keeps the original base revision.');

// A transient preflight failure must retain the rendered file; business failures
// and login changes still require verification rather than an automatic upload.
const recoveryCalls=[];let offline=true,uploadLost=true;
const recovering=window.BazInspectionUpload.create({url,token:()=> 'fixture-token',onSaved(){},fetch:async(endpoint,options)=>{
 const p=JSON.parse(options.body);recoveryCalls.push(p);
 if(p.action==='inspection_pdf_resolve'){
  if(offline)throw new TypeError('Failed to fetch');
  return {json:async()=>({success:true,recordId:'record-fixed',sourceBasis:{fingerprint:'b'.repeat(64)},pdf:{revision:5}})};
 }
 if(uploadLost)throw new TypeError('Network connection lost');
 return {json:async()=>({success:true,recordId:'record-fixed',pdf})};
}});
const snapshot={hospital:'원래 병원',date:'2026-10-14',sn:'SN-original',recordId:'record-fixed',requestId:'request-fixed',taskId:'task-fixed'};
const offlinePrepared=await recovering.prepare(snapshot);
await recovering.publish(new Blob(['%PDF-1.7 original']), 'original.pdf',offlinePrepared);
assert.equal(nodes.pdfUploadRetry.hidden,false);assert.match(nodes.pdfUploadRetry.textContent,/원본 확인/);
assert.equal(recoveryCalls.filter(p=>p.action==='inspection_pdf_upload').length,0,'never upload while source verification is offline');
offline=false;await nodes.pdfUploadRetry.click();const recoveredUpload=recoveryCalls.at(-1);
assert.equal(recoveredUpload.action,'inspection_pdf_upload');assert.equal(recoveredUpload.baseRevision,5);
assert.equal(recoveredUpload.recordId,snapshot.recordId);assert.equal(recoveredUpload.hospital,snapshot.hospital);assert.equal(recoveredUpload.sn,snapshot.sn);assert.equal(recoveredUpload.taskId,snapshot.taskId);
assert.equal('sourcePreparationError' in recoveredUpload,false,'client failure state does not travel to GAS');
const resolveCount=recoveryCalls.filter(p=>p.action==='inspection_pdf_resolve').length;
uploadLost=false;await nodes.pdfUploadRetry.click();const retried=recoveryCalls.at(-1);
for(const key of ['uploadId','sha256','base64','baseRevision','recordId'])assert.equal(retried[key],recoveredUpload[key],key+' is fixed after recovery');
assert.equal(recoveryCalls.filter(p=>p.action==='inspection_pdf_resolve').length,resolveCount,'uncertain writes never resolve a newer revision');

for(const failure of [
 {json:async()=>({success:false,error:'로그인이 필요합니다.'})},
 {ok:false,status:403,json(){throw new Error('must not parse');}},
 {json:async()=>({success:true,recordId:'different-record',pdf:null})}
]){
 let requests=0;const denied=window.BazInspectionUpload.create({url,token:()=> 'fixture-token',onSaved(){throw new Error('must not save');},fetch:async()=>{requests++;return failure;}});
 const p=await denied.prepare(snapshot);await denied.publish(new Blob(['%PDF-1.7']), 'denied.pdf',p);
 assert.equal(requests,1,'source mismatch, permission and application failures do not repeat');assert.equal(nodes.pdfUploadRetry.hidden,true);
}
for(const badResponse of [
 ()=>({ok:false,status:503}),
 ()=>({json:async()=>{throw new SyntaxError('Unexpected HTML');}}),
 ()=>({json:async()=>({})})
]){
 let first=true,uploads=0;
 const temporary=window.BazInspectionUpload.create({url,token:()=> 'fixture-token',onSaved(){},fetch:async(endpoint,options)=>{const p=JSON.parse(options.body);if(first){first=false;return badResponse();}if(p.action==='inspection_pdf_upload')uploads++;return {json:async()=>p.action==='inspection_pdf_resolve'?{success:true,recordId:'record-fixed',pdf:null}:{success:true,recordId:'record-fixed',pdf}};}});
 const p=await temporary.prepare(snapshot);await temporary.publish(new Blob(['%PDF-1.7']), 'recovered.pdf',p);assert.equal(uploads,1);
}
let currentToken='account-A',crossRequests=0;
const accountBound=window.BazInspectionUpload.create({url,token:()=>currentToken,onSaved(){throw new Error('must not save');},fetch:async()=>{crossRequests++;return {json:async()=>({success:true,recordId:'record-fixed',pdf:null})};}});
const accountPrepared=await accountBound.prepare(snapshot);currentToken='account-B';
await accountBound.publish(new Blob(['%PDF-1.7']), 'account.pdf',accountPrepared);
assert.equal(crossRequests,1,'account changes between preflight and rendering never transmit the previous account file');assert.equal(nodes.pdfUploadRetry.hidden,true);
console.log('inspection-upload: transient preflight recovery preserves bytes/context/revision, rejects source/auth/business failures and binds the generating account across rendering.');
