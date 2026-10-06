import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../js/baz-work-api.js',import.meta.url),'utf8');
const DENO='https://yuyoung.yuyoung-ai.deno.net';
const GAS='https://script.google.com/';
function harness(config){
  const calls=[],timers=new Map();let serial=0,broken=false;
  const root={crypto:{randomUUID:()=> 'test-op'},BazAuth:{token:()=> 'test-token'}};
  if(config)root.BazAuth.config=config;
  vm.runInNewContext(source,{window:root,AbortController,URLSearchParams,
    setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},
    clearTimeout:id=>timers.delete(id),
    fetch:async(url,opts)=>{calls.push({url,opts});if(broken)throw new Error('offline');return {text:async()=>JSON.stringify({success:true})};}});
  return {api:root.BazWorkAPI,calls,timers,breakNetwork:()=>broken=true,
    timeoutConfig:()=>{const entry=[...timers].find(([,v])=>v.ms===1500);assert.ok(entry,'bounded config wait exists');timers.delete(entry[0]);entry[1].fn();}};
}
const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
let configure;
const enabled=harness(()=>new Promise(resolve=>configure=resolve));
const first=enabled.api.get('work_bootstrap');await flush();
assert.equal(enabled.calls.length,0,'first request waits for feature discovery');
configure({ok:true,workApi:true});await first;
assert.equal(enabled.calls[0].url,DENO,'first request uses enabled Deno');
assert.equal(enabled.calls[0].opts.method,'POST');
assert.equal(JSON.parse(enabled.calls[0].opts.body).token,'test-token');
assert.equal(enabled.timers.size,0,'successful request clears both timers');
enabled.breakNetwork();await assert.rejects(enabled.api.post('work_save',{operationId:'test-op'}),e=>e.unknown===true);
assert.equal(enabled.calls.length,2,'ambiguous write never falls back to GAS');
assert.equal(JSON.parse(enabled.calls[1].opts.body).operationId,'test-op');
for(const config of [undefined,()=>Promise.resolve({ok:true,workApi:false}),()=>Promise.reject(new Error('offline')),()=>{throw new Error('unavailable');}]){
  const fallback=harness(config);await fallback.api.get('work_detail',{id:'work'});
  assert.ok(fallback.calls[0].url.startsWith(GAS),'absent, OFF or failed config uses GAS');
  assert.equal(fallback.calls[0].opts.method,undefined);assert.equal(fallback.timers.size,0);
}
let lateResolve;
const late=harness(()=>new Promise(resolve=>lateResolve=resolve));
const timed=late.api.get('work_detail',{id:'work'});await flush();late.timeoutConfig();await timed;
assert.ok(late.calls[0].url.startsWith(GAS),'unresponsive config cannot block indefinitely');
lateResolve({ok:true,workApi:true});await flush();await late.api.get('work_detail',{id:'work'});
assert.equal(late.calls[1].url,DENO,'late setting applies to subsequent requests');
let discoverCount=0,writeResolve;
const parallel=harness(()=>{discoverCount++;return new Promise(resolve=>writeResolve=resolve);});
const write=parallel.api.post('work_history_add',{operationId:'same-op'});
const read=parallel.api.get('work_detail',{id:'work'});await flush();
assert.equal(discoverCount,1,'concurrent calls share feature discovery');assert.equal(parallel.calls.length,0);
writeResolve({ok:true,workApi:true});await Promise.all([write,read]);
assert.ok(parallel.calls.every(c=>c.url===DENO));
assert.equal(JSON.parse(parallel.calls[0].opts.body).operationId,'same-op');
console.log('work-api-transport: first-call Deno routing, bounded/off/error fallback, late config, shared discovery and no ambiguous write fallback passed.');
