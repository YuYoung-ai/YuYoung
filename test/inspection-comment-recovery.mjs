import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../js/baz-inspection-workflow.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('  async function confirmAttachment('),source.indexOf('  function progress('));
const context={requestId:'request-one',recordId:'record-one'},saved={pdf:{sha256:'a'.repeat(64)}};
const ready={success:true,request:{id:'request-one'},pdfStored:true,commentAttached:true};
const waiting={...ready,commentAttached:false};
function fixture(reply,name='operator'){
 const calls=[];const api={};for(const method of ['get','post'])api[method]=async(action,params,options)=>{calls.push({method,action,params,options});return reply(action,calls.length);};
 const confirm=vm.runInNewContext(code+';confirmAttachment;',{api,account:'operator',BazAuth:{name:()=>name}});
 return {calls,run:(options)=>confirm(saved,{...context},options)};
}
let f=fixture(()=>ready);assert.equal((await f.run()).applicable,true);assert.deepEqual(f.calls.map(c=>c.method+':'+c.action),['get:work_document_status'],'an attached file never triggers another write');
f=fixture(action=>action==='work_document_status'?{...waiting,pdfStored:false}:action==='work_handover_detail'?{success:true}:ready);
await f.run();assert.deepEqual(f.calls.map(c=>c.action),['work_document_status','work_handover_detail','work_document_retry']);
assert.ok(f.calls.every(c=>!('base64' in c.params)&&!('url' in c.params)),'recovery carries only identity/hash, never file bytes or a caller supplied URL');
f=fixture((action,n)=>{if(action==='work_document_retry'){const e=new Error('response lost');e.unknown=true;throw e;}return n===1?waiting:ready;});
await f.run();assert.equal(f.calls.filter(c=>c.method==='post').length,1);assert.equal(f.calls.at(-1).action,'work_document_status','read back an uncertain write instead of retransmitting');
f=fixture(action=>action==='work_document_retry'?waiting:waiting);await assert.rejects(f.run(),e=>e.pending===true);
for(const status of [{...ready,documentChanged:true},{...ready,commentDeleted:true},{...ready,request:{id:'another-request'}}]){
 f=fixture(()=>status);await assert.rejects(f.run(),e=>e.noRetry===true);assert.equal(f.calls.length,1);
}
f=fixture(()=>({success:false,retryable:true,error:'source pending'}));await assert.rejects(f.run(),e=>e.pending===true);
f=fixture(()=>ready,'another-account');await assert.rejects(f.run(),/계정/);assert.equal(f.calls.length,0);
f=fixture(action=>action==='work_document_status'?{...waiting,pdfStored:false}:{success:false,error:'Google read delayed'});
await assert.rejects(f.run(),e=>e.pending===true);assert.equal(f.calls.filter(c=>c.method==='post').length,0);
const controller=new AbortController();
f=fixture(action=>{if(action==='work_document_retry'){controller.abort();const e=new Error('stopped');e.aborted=true;throw e;}return waiting;});
await assert.rejects(f.run({signal:controller.signal}),/stopped/);assert.equal(f.calls.length,2,'cancel does not launch read-back after the confirmation was replaced');assert.ok(f.calls.every(c=>c.options.signal===controller.signal));
console.log('PASS: read-first completion, canonical metadata recovery, one repair, uncertain-write read-back, pending state, source/account guards and cancellation');
