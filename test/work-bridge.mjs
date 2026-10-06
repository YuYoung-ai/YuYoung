import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const fixture=fs.readFileSync(new URL('work-kv.mjs',import.meta.url),'utf8');
const Kv=vm.runInNewContext('('+fixture.slice(fixture.indexOf('class Kv{'),fixture.indexOf('const kv=new Kv()')).trim()+')',{Map,structuredClone,JSON,String,Number,Infinity});
const kv=new Kv();let handler,forwarded;
const env={TOKEN_SECRET:'test-bridge-only-secret',CREDENTIALS:JSON.stringify([{pw:'password',name:'관리자',level:3}]),WORK_API_ENABLED:'true',WORK_GAS_URL:'https://script.google.com/macros/s/test/exec',ALLOWED_ORIGINS:'https://work.example',LOGIN_FAILURE_DELAY_MS:'0',GOOGLE_AUTH_ENABLED:'false'};
globalThis.Deno={env:{get:n=>env[n]},openKv:async()=>kv,serve:fn=>{handler=fn;return {finished:Promise.resolve()};}};
globalThis.fetch=async(url,options)=>{forwarded=JSON.parse(options.body);return new Response(JSON.stringify({success:true,data:[],total:0}));};
await import('../deno-auth/main.ts?bridge-test');
async function post(body){const response=await handler(new Request('https://auth.example/',{method:'POST',headers:{'content-type':'text/plain'},body:JSON.stringify(body)}),{remoteAddr:{hostname:'127.0.0.1'},completed:Promise.resolve()});return {status:response.status,body:await response.json()};}
const secret=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.TOKEN_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
async function bridge(verb,payload={},at=Date.now()){const body={action:'work_bridge',verb,at,nonce:crypto.randomUUID(),payload};body.signature=Buffer.from(await crypto.subtle.sign('HMAC',secret,new TextEncoder().encode('baz-work-bridge-v1\n'+JSON.stringify(body)))).toString('base64url');return body;}
assert.equal((await post({action:'work_bridge',verb:'status',at:Date.now(),nonce:crypto.randomUUID(),signature:'invalid'})).status,403);
const once=await bridge('status');assert.equal((await post(once)).body.success,true);assert.equal((await post(once)).status,409);
assert.equal((await post(await bridge('status',{},Date.now()-600000))).status,403);
assert.equal((await post(await bridge('seed',{references:{engineers:[],minimumLevel:1},hospitals:[]}))).body.success,true);
const manifest=(await post(await bridge('status'))).body.manifest;
assert.equal((await post(await bridge('activate',{manifest}))).body.ready,true);
assert.equal((await post({action:'work_bootstrap',token:'invalid'})).status,401);
const login=await post({action:'login',password:'password'});assert.equal(login.body.ok,true);
assert.equal((await post({action:'work_bootstrap',token:login.body.token})).body.storage,'kv');
assert.equal((await post({action:'work_handover_candidates',hospitalName:'새 접수 병원',token:login.body.token})).body.success,true);
assert.equal(forwarded.hospitalName,'새 접수 병원','new receipt can query Handover before Sheet mirror');
assert.equal((await post({action:'work_handover_candidates',requestId:'deleted-or-missing',token:login.body.token})).status,403);
assert.equal((await post(await bridge('seed',{}))).status,500);
console.log('work-bridge: domain HMAC, expiry/replay protection, manifest activation, access control and unsaved hospital Handover lookup passed.');
