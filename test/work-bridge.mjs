import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
const fixture=fs.readFileSync(new URL('work-kv.mjs',import.meta.url),'utf8');
const Kv=vm.runInNewContext('('+fixture.slice(fixture.indexOf('class Kv{'),fixture.indexOf('const kv=new Kv()')).trim()+')',{Map,structuredClone,JSON,String,Number,Infinity});
const kv=new Kv();let handler,forwarded;
const env={TOKEN_SECRET:'test-bridge-only-secret',CREDENTIALS:JSON.stringify([{pw:'password',name:'관리자',level:3}]),WORK_API_ENABLED:'true',WORK_GAS_URL:'https://script.google.com/macros/s/test/exec',ALLOWED_ORIGINS:'https://work.example',LOGIN_FAILURE_DELAY_MS:'0',GOOGLE_AUTH_ENABLED:'false'};
globalThis.Deno={cron:()=>Promise.resolve(),env:{get:n=>env[n]},openKv:async()=>kv,serve:fn=>{handler=fn;return {finished:Promise.resolve()};}};
globalThis.fetch=async(url,options)=>{forwarded=JSON.parse(options.body);return new Response(JSON.stringify({success:true,data:[],total:0}));};
await import('../deno-auth/main.ts?bridge-test');
async function post(body){const response=await handler(new Request('https://auth.example/',{method:'POST',headers:{'content-type':'text/plain'},body:JSON.stringify(body)}),{remoteAddr:{hostname:'127.0.0.1'},completed:Promise.resolve()});return {status:response.status,body:await response.json()};}
const secret=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.TOKEN_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
async function bridge(verb,payload={},at=Date.now()){const body={action:'work_bridge',verb,at,nonce:crypto.randomUUID(),payload};body.signature=Buffer.from(await crypto.subtle.sign('HMAC',secret,new TextEncoder().encode('baz-work-bridge-v1\n'+JSON.stringify(body)))).toString('base64url');return body;}
assert.equal((await post({action:'work_bridge',verb:'status',at:Date.now(),nonce:crypto.randomUUID(),signature:'invalid'})).status,403);
const once=await bridge('status');assert.equal((await post(once)).body.success,true);assert.equal((await post(once)).status,409);
const gas={bazTokenConf_:()=>({secret:env.TOKEN_SECRET}),Utilities:{Charset:{UTF_8:'utf8'},base64EncodeWebSafe:bytes=>Buffer.from(bytes).toString('base64url'),computeHmacSha256Signature:(value,key,charset)=>{assert.equal(charset,'utf8','GAS must explicitly sign Unicode in UTF-8');return [...nodeCrypto.createHmac('sha256',key).update(value,charset).digest()];}}};
vm.createContext(gas);vm.runInContext(fs.readFileSync(new URL('../hospital_work_kv_gas.gs',import.meta.url),'utf8'),gas);
const unicode={action:'work_bridge',verb:'status',at:Date.now(),nonce:crypto.randomUUID(),payload:{hospital:'바노바기피부과',kind:'점검',memo:'정상 · 😀',key:'병원\u001fSN'}};unicode.signature=gas.hwKvSign_(unicode);
assert.equal((await post(unicode)).body.success,true,'actual GAS signer accepted by Deno with Korean, emoji and separators');
assert.equal((await post(await bridge('status',{},Date.now()-600000))).status,403);
assert.equal((await post(await bridge('seed',{references:{engineers:[],minimumLevel:1},hospitals:[]}))).body.success,true);
const manifest=(await post(await bridge('status'))).body.manifest;
assert.equal((await post(await bridge('activate',{manifest}))).body.ready,true);
assert.equal((await post({action:'work_bootstrap',token:'invalid'})).status,401);
const login=await post({action:'login',password:'password'});assert.equal(login.body.ok,true);
assert.equal((await post({action:'work_bootstrap',token:login.body.token})).body.storage,'kv');
{
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async url=>{const target=new URL(url);assert.equal(target.searchParams.get('action'),'hospdbrich');assert.equal(target.searchParams.get('force'),'1');assert.equal(target.searchParams.get('token'),login.body.token);return new Response(JSON.stringify({success:true,data:[{name:'최신 DB 병원',sn:'BW0001',region:'서울',sales:'DB 영업',asType:'유상',ncare:'가입'}]}));};
 assert.equal((await post({action:'work_references_refresh',token:'invalid'})).status,401);
 const refreshed=await post({action:'work_references_refresh',token:login.body.token});assert.equal(refreshed.body.success,true);assert.equal(refreshed.body.hospitals[0].name,'최신 DB 병원');assert.match(refreshed.body.hospitals[0].id,/^hosp_[0-9a-f]{24}$/);
 globalThis.fetch=async()=>{throw new Error('offline')};assert.equal((await post({action:'work_references_refresh',token:login.body.token})).status,502);
 assert.equal((await post({action:'work_bootstrap',token:login.body.token})).body.hospitals[0].name,'최신 DB 병원','failed source read preserves cached references');
 globalThis.fetch=originalFetch;
 console.log('explicit hospital DB refresh: token/ACL gate, force-read original DB, KV reference update, compatible ID and failed-read preservation passed.');
}
assert.equal((await post({action:'work_handover_candidates',hospitalName:'새 접수 병원',token:login.body.token})).body.success,true);
assert.equal(forwarded.hospitalName,'새 접수 병원','new receipt can query Handover before Sheet mirror');
assert.equal((await post({action:'work_handover_candidates',requestId:'deleted-or-missing',token:login.body.token})).status,403);
assert.equal((await post({action:'work_handover_refresh',token:'invalid'})).status,401);
assert.equal((await post({action:'work_handover_refresh',token:login.body.token})).body.success,true);
assert.equal(forwarded.action,'work_handover_refresh','explicit sync performs one authenticated original read');
{
 const h=(await post({action:'work_bootstrap',token:login.body.token})).body.hospitals[0];
 const op=crypto.randomUUID(),saved=await post({action:'work_save',token:login.body.token,operationId:op,form:{hospitalKey:h.key,symptom:'알림 통합 검증',cs:'관리자',engineer:'',registeredAt:'2026-10-14T09:00',visitAt:'2026-10-14T12:00',status:'접수'}});
 assert.equal(saved.body.success,true);
 const cfg=await post({action:'notification_config',token:login.body.token});assert.equal(cfg.body.success,true);assert.match(cfg.body.uid,/^p:/);assert.equal(cfg.body.privateKey,undefined);
 const inbox=await post({action:'notification_list',token:login.body.token});assert.ok(inbox.body.items.some(n=>n.id===op),"unassigned save creates the authenticated user's broadcast inbox");
 assert.equal((await post({action:'notification_list',token:'invalid'})).status,401);
 const target=await post({action:'work_handover_refresh',requestId:saved.body.request.id,target:{hospitalName:'forged-client-scope',recordIds:['wrong']},token:login.body.token});
 assert.equal(target.body.workDetail.request.id,saved.body.request.id);assert.equal(forwarded.target.hospitalName,h.name);assert.equal(forwarded.target.visitDate,'2026-10-14');assert.deepEqual(forwarded.target.recordIds,[]);assert.ok(!('__ua' in forwarded));
 const soft=await post({action:'work_delete',token:login.body.token,requestId:saved.body.request.id,baseRevision:saved.body.request.revision,operationId:crypto.randomUUID()});assert.equal(soft.body.success,true);
 const prior=forwarded;const deleted=await post({action:'work_handover_refresh',token:login.body.token,requestId:saved.body.request.id});assert.equal(deleted.body.deleted,true);assert.equal(forwarded,prior,'deleted alert targets return the current state without a source read');
 assert.equal((await post({action:'notification_read',token:login.body.token,notificationId:op,revision:soft.body.request.revision})).body.success,true,'viewing current deletion can clear the stale unread alert');
 console.log('notification HTTP integration: signed identity, broadcast save/inbox, public-key-only config, authentication gate, server-owned Handover scope and deleted-target read passed.');
}
assert.equal((await post(await bridge('seed',{}))).status,500);
console.log('work-bridge: domain HMAC, expiry/replay protection, manifest activation, access control and unsaved hospital Handover lookup passed.');
