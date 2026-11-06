import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../js/baz-work-api.js',import.meta.url),'utf8');
const calls=[],timers=new Map();let broken=false,invalid=false,serial=0;
const root={crypto:{randomUUID:()=> 'same-operation'},BazAuth:{token:()=> 'session',config:()=>{throw Error('config must not block saves');}}};
vm.runInNewContext(source,{window:root,AbortController,setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),fetch:async(url,opts)=>{calls.push({url,opts});if(broken)throw Error('offline');return {json:async()=>invalid?{}:{success:true}};}});
await root.BazWorkAPI.get('work_bootstrap');
assert.equal(calls[0].url,'https://yuyoung-production.coaptation.workers.dev');assert.equal(calls[0].opts.method,'POST');assert.equal(JSON.parse(calls[0].opts.body).token,'session');assert.equal(timers.size,0);
await root.BazWorkAPI.post('work_history_add',{operationId:'same-operation'});assert.equal(JSON.parse(calls[1].opts.body).operationId,'same-operation');assert.equal(timers.size,0);
broken=true;await assert.rejects(root.BazWorkAPI.post('work_save',{operationId:'same-operation'}),e=>e.unknown===true);assert.equal(calls.length,3,'unknown writes never fall back to GAS');
await assert.rejects(root.BazWorkAPI.get('work_sync',{revision:'10'}),e=>e.unknown===false);assert.equal(timers.size,0);
broken=false;invalid=true;await assert.rejects(root.BazWorkAPI.post('work_save',{}),e=>e.unknown===true);assert.equal(timers.size,0);
assert.equal(root.BazWorkAPI.id(),'same-operation');
console.log('work-api-transport: immediate Deno reads/writes, token and operation preservation, unknown write safety and timer cleanup passed.');
// Reproduce the old 15s document deadline and abort-ignoring fetch/JSON paths.
function stalledFixture(jsonStall=false){
 const deadlines=new Map(),window={BazAuth:{token:()=> 'session'}};let seq=0,requests=0;
 vm.runInNewContext(source,{window,AbortController,setTimeout(fn,ms){const id=++seq;deadlines.set(id,{fn,ms});return id;},clearTimeout:id=>deadlines.delete(id),fetch:async()=>{requests++;return jsonStall?{json:()=>new Promise(()=>{})}:new Promise(()=>{});}});
 return {api:window.BazWorkAPI,deadlines,requests:()=>requests};
}
for(const [action,ms]of [['work_document_status',20000],['work_document_retry',35000],['work_handover_detail',35000]]){
 const f=stalledFixture(),job=f.api.post(action,{recordId:'fixed'});const deadline=[...f.deadlines.values()][0];assert.equal(deadline.ms,ms);deadline.fn();await assert.rejects(job,e=>e.timeout===true&&e.unknown===true);assert.equal(f.deadlines.size,0);
}
const stalledJson=stalledFixture(true),jsonJob=stalledJson.api.get('work_document_status',{});await Promise.resolve();[...stalledJson.deadlines.values()][0].fn();await assert.rejects(jsonJob,e=>e.timeout===true);assert.equal(stalledJson.deadlines.size,0);
const parent=new AbortController(),cancelled=stalledFixture(),cancelJob=cancelled.api.post('work_document_retry',{}, {signal:parent.signal});parent.abort();await assert.rejects(cancelJob,e=>e.aborted===true&&!e.timeout);assert.equal(cancelled.deadlines.size,0);
const already=new AbortController();already.abort();const untouched=stalledFixture();await assert.rejects(untouched.api.get('work_document_status',{}, {signal:already.signal}),e=>e.aborted);assert.equal(untouched.requests(),0);
console.log('PASS: document deadlines, bounded abort-ignoring fetch/JSON and parent cancellation');
