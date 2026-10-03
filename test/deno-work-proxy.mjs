import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const secret='test-work-secret', upstream='https://script.google.com/macros/s/test-deployment/exec';
const env=new Map(Object.entries({TOKEN_SECRET:secret,TOKEN_EPOCH:'1',WORK_API_ENABLED:'true',WORK_GAS_URL:upstream,WORK_REFERENCE_TTL_SEC:'1',ALLOWED_ORIGINS:'https://allowed.example'}));
let handler, gate=null, failed=false, denied=false, hanging=false, revision=0;
const calls=[],logs=[];
globalThis.Deno={env:{get:n=>env.get(n)},serve:fn=>{handler=fn;},openKv:async()=>null};
const originalInfo=console.info;
console.info=s=>logs.push(s);
globalThis.fetch=async(url,options)=>{
  assert.equal(url,upstream);assert.equal(options.method,'POST');assert.equal(new URL(url).search,'');
  const p=JSON.parse(options.body);calls.push(p);assert.ok(!('__ua' in p));
  if(hanging)return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));
  if(gate)await gate.promise;
  if(failed)throw new Error('private network detail');
  let body;
  if(denied)body={success:false,error:'GAS ACL denied'};
  else if(p.action==='work_bootstrap')body={success:true,requests:[{id:'work',revision:++revision,status:revision===1?'방문예정':'완료'}],autoMatch:{completed:[],skipped:[]},who:{name:p.token===alice?'A':'B'},referencesIncluded:p.omitReferences!=='1',...(p.omitReferences==='1'?{}:{hospitals:[{name:'private-hospital'}],engineers:['engineer']}),updatedAt:'fresh'};
  else body={success:true,request:{id:'work',revision:++revision},history:[]};
  return new Response(JSON.stringify(body));
};
function token(name){const payload=Buffer.from(JSON.stringify({n:name,l:1,e:Math.floor(Date.now()/1000)+3600,ep:1})).toString('base64url');return payload+'.'+crypto.createHmac('sha256',secret).update(payload).digest('base64url');}
const alice=token('A'),bob=token('B');
const source=stripTypeScriptTypes(fs.readFileSync(new URL('../deno-auth/main.ts',import.meta.url),'utf8'));
function load(){vm.runInNewContext(source,{Deno:globalThis.Deno,fetch:(...a)=>globalThis.fetch(...a),console,crypto:globalThis.crypto,TextEncoder,TextDecoder,URL,Response,Headers,AbortController,Error,performance,Date,Uint8Array,atob,btoa,setTimeout:(...a)=>globalThis.setTimeout(...a),clearTimeout});}
load();
async function send(action,p={},options={}){
  const res=await handler(new Request('https://auth.example/',{method:'POST',headers:{origin:options.origin||'https://allowed.example','Content-Type':'text/plain'},body:JSON.stringify({token:alice,action,...p})}),{remoteAddr:{hostname:'203.0.113.1'}});
  return {res,body:await res.json()};
}
function block(){let resolve;const promise=new Promise(r=>resolve=r);gate={promise,resolve};}
async function started(n){for(let i=0;i<30&&calls.length<n;i++)await new Promise(setImmediate);assert.equal(calls.length,n);}

const first=await send('work_bootstrap');assert.equal(first.res.headers.get('X-Baz-Work-Mode'),'live');assert.equal(first.body.requests[0].status,'방문예정');
const second=await send('work_bootstrap');assert.equal(second.res.headers.get('X-Baz-Work-Mode'),'references-hit');assert.equal(calls.at(-1).omitReferences,'1');assert.deepEqual(second.body.hospitals,first.body.hospitals);assert.equal(second.body.requests[0].status,'완료','state remains live with cached references');
const other=await send('work_bootstrap',{token:bob});assert.equal(other.body.who.name,'B');assert.equal(calls.at(-1).token,bob);
denied=true;const acl=await send('work_bootstrap');assert.equal(acl.body.success,false);assert.ok(!acl.body.hospitals,'GAS denial must not disclose cached references');denied=false;
let count=calls.length;assert.equal((await send('work_detail',{token:'invalid'})).res.status,401);assert.equal(calls.length,count);
assert.equal((await send('work_detail',{}, {origin:'https://evil.example'})).res.status,403);assert.equal(calls.length,count);
assert.equal((await send('work_unknown')).res.status,400);assert.equal(calls.length,count);
const get=await handler(new Request('https://auth.example/?action=work_detail&token=invalid'),{remoteAddr:{hostname:'test'}});assert.equal(get.status,405);assert.equal(calls.length,count);

block();count=calls.length;
const a=send('work_detail',{id:'work'}),b=send('work_detail',{id:'work'});await started(count+1);gate.resolve();gate=null;
const pair=await Promise.all([a,b]);assert.deepEqual(pair[0].body,pair[1].body);assert.ok(pair.some(x=>x.res.headers.get('X-Baz-Work-Mode')==='coalesced'));
block();count=calls.length;
const separate=Promise.all([send('work_detail',{id:'work'}),send('work_detail',{id:'work',token:bob})]);await started(count+2);gate.resolve();gate=null;await separate;
await send('work_detail',{id:'work'});assert.equal(calls.length,count+3,'finished details are never cached');

const forced=await send('work_bootstrap',{force:'1'});assert.equal(forced.res.headers.get('X-Baz-Work-Mode'),'live');assert.ok(!calls.at(-1).omitReferences);
const realNow=Date.now;Date.now=()=>realNow()+2000;await send('work_bootstrap');Date.now=realNow;assert.ok(!calls.at(-1).omitReferences,'expired references fetched again');
const op={operationId:'same-operation-123',form:{symptom:'test'}};count=calls.length;
await Promise.all([send('work_save',op),send('work_save',op)]);assert.equal(calls.length,count+2,'writes are not coalesced or retried by proxy');assert.deepEqual(calls.at(-1).form,op.form);assert.equal(calls.at(-1).operationId,op.operationId);
await send('work_bootstrap');assert.ok(!calls.at(-1).omitReferences,'write invalidates reference cache');
// A read started before a write cannot absorb a read requested after that write.
block();count=calls.length;
const old=send('work_detail',{id:'work'});await started(count+1);
const write=send('work_save',op);await started(count+2);
const newer=send('work_detail',{id:'work'});await started(count+3);gate.resolve();gate=null;await Promise.all([old,write,newer]);

failed=true;count=calls.length;const ambiguous=await send('work_save',op);assert.equal(ambiguous.res.status,502);assert.equal(ambiguous.body.retrySameOperation,true);assert.equal(calls.length,count+1);assert.ok(!JSON.stringify(ambiguous.body).includes('private network detail'));failed=false;
hanging=true;const realTimeout=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>realTimeout(fn,ms===28000?1:ms,...args);
const timeout=await send('work_detail',{id:'work'});globalThis.setTimeout=realTimeout;hanging=false;assert.equal(timeout.res.status,504);
assert.equal(second.res.headers.get('Cache-Control'),'no-store');assert.match(second.res.headers.get('Server-Timing'),/work;dur=\d+, gas;dur=\d+/);
assert.ok(second.res.headers.get('Access-Control-Expose-Headers').includes('Server-Timing'));
assert.ok(!logs.join('').includes(alice));assert.ok(!logs.join('').includes('private-hospital'));
assert.equal((await send('config')).body.workApi,true);
env.set('WORK_GAS_URL','https://evil.example/exec');load();assert.equal((await send('config')).body.workApi,false);assert.equal((await send('work_detail')).res.status,503);
env.set('WORK_GAS_URL',upstream);env.set('WORK_API_ENABLED','false');load();assert.equal((await send('config')).body.workApi,false);
console.info=originalInfo;
console.log('deno-work-proxy: live state + reference TTL/force, per-session coalescing, GAS ACL, POST-only auth, writes/retry identity, timeout, no-store, timing and disabled/invalid upstream passed.');
