import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createWorkStore} from '../deno-auth/work-store.ts';
import {createWorkNotifications,notificationKey as key,validateSubscription} from '../deno-auth/work-notifications.ts';
import {createPushSender} from '../deno-auth/work-push.ts';

// Expiry, CAS, ordering and cursors model the actual KV behavior used by the queue.
class Kv {
 data=new Map();seq=0;clock=Date.now();
 id(k){return JSON.stringify(k);}
 clean(){for(const [k,e]of this.data)if(e.expires&&e.expires<=this.clock)this.data.delete(k);}
 async get(k){this.clean();const e=this.data.get(this.id(k));return {key:k,value:e?structuredClone(e.value):null,versionstamp:e?.version||null};}
 async set(k,v,o={}){this.data.set(this.id(k),{key:k,value:structuredClone(v),version:String(++this.seq),expires:o.expireIn?this.clock+o.expireIn:0});}
 async delete(k){this.data.delete(this.id(k));}
 atomic(){const checks=[],ops=[],kv=this;const tx={check(...e){checks.push(...e);return tx;},set(k,v,o){ops.push(['set',k,v,o]);return tx;},delete(k){ops.push(['delete',k]);return tx;},async commit(){kv.clean();for(const e of checks)if((kv.data.get(kv.id(e.key))?.version||null)!==e.versionstamp)return {ok:false};for(const [kind,k,v,o]of ops){if(kind==='delete')kv.data.delete(kv.id(k));else kv.data.set(kv.id(k),{key:k,value:structuredClone(v),version:String(++kv.seq),expires:o?.expireIn?kv.clock+o.expireIn:0});}return {ok:true};}};return tx;}
 list(s,o={}){this.clean();const cmp=(a,b)=>{for(let i=0;i<Math.min(a.length,b.length);i++){if(a[i]===b[i])continue;return a[i]<b[i]?-1:1;}return a.length-b.length;};let rows=[...this.data.values()].filter(x=>s.prefix?s.prefix.every((p,i)=>x.key[i]===p):cmp(x.key,s.start)>=0&&cmp(x.key,s.end)<0).sort((a,b)=>cmp(a.key,b.key));if(o.reverse)rows.reverse();const offset=Number(o.cursor||0);rows=rows.slice(offset,offset+(o.limit||Infinity));return {cursor:String(offset+rows.length),async *[Symbol.asyncIterator](){for(const e of rows)yield {key:e.key,value:structuredClone(e.value),versionstamp:e.version};}};}
}
const uid=n=>'g:'+createHash('sha256').update(n).digest('base64url');
const alice={uid:uid('alice'),name:'담당 A',level:1},bob={uid:uid('bob'),name:'담당 B',level:1},admin={uid:uid('admin'),name:'관리자',level:3},low={uid:uid('low'),name:'권한 없음',level:0};
const kv=new Kv(),store=createWorkStore(kv),h={id:'h1',key:'h1',name:'검증 병원',sn:'SN',region:'서울'};
await store.bridge('seed',{hospitals:[h],references:{engineers:['담당 A','담당 B'],minimumLevel:1}});await store.bridge('activate',{manifest:await store.manifest()});
let accounts=[alice,bob,admin,low],sent=[],failure=0;
const service=createWorkNotifications(kv,{store,accounts:async()=>accounts,now:()=>kv.clock,publicKey:async()=>'public-only',send:async(s,p)=>{if(failure)throw Object.assign(new Error('send failed'),{statusCode:failure});sent.push({s,p});}});
const sub=n=>({endpoint:'https://fcm.googleapis.com/fcm/send/'+n,keys:{p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url'),auth:Buffer.alloc(16,2).toString('base64url')}});
await service.handle({action:'notification_subscribe',subscription:sub('a')},alice);
await service.handle({action:'notification_subscribe',subscription:sub('b')},bob);
await service.handle({action:'notification_subscribe',subscription:sub('admin')},admin);
assert.throws(()=>validateSubscription({...sub('a'),endpoint:'https://localhost/private'}),/지원/);
assert.throws(()=>validateSubscription({...sub('a'),endpoint:'https://fcm.googleapis.com.evil.test/x'}),/지원/);
assert.throws(()=>validateSubscription({...sub('a'),keys:{p256dh:'bad',auth:'bad'}}),/암호화/);
await assert.rejects(()=>service.handle({action:'notification_config'},low),/로그인|권한/);

const form={hospitalKey:h.key,symptom:'검증용 접수',cs:'CS',engineer:'담당 A',registeredAt:'2026-10-14T09:00',visitAt:'2026-10-14T12:00',status:'접수'};
async function create(engineer,operationId=crypto.randomUUID()){const op={action:'work_save',operationId,acknowledgeDuplicates:true,form:{...form,engineer}};const saved=await store.handle(op,admin);assert.equal(saved.success,true);return {op,saved};}
async function events(){return [...kv.data.values()].filter(x=>x.key[0]===key()[0]&&x.key[1]==='event');}
const first=await create('담당 A');assert.equal((await events()).length,1,'notification event committed with receipt');
await store.handle(first.op,admin);assert.equal((await events()).length,1,'operation replay does not produce a new alert');
await service.process(first.op.operationId);assert.equal(sent.length,1);assert.equal(sent[0].p.recipient,alice.uid);
await service.process(first.op.operationId);assert.equal(sent.length,1,'redelivery keeps one inbox and completed job');
const concurrent=await create('담당 A');const beforeConcurrent=sent.length;await Promise.all([service.process(concurrent.op.operationId),service.process(concurrent.op.operationId)]);assert.equal(sent.length,beforeConcurrent+1,'concurrent workers claim a device job once');
const unassigned=await create('');await service.process(unassigned.op.operationId);assert.equal(sent.length,5,'unassigned receipt sends to all work users');
for(const who of [alice,bob,admin])assert.ok((await service.handle({action:'notification_list'},who)).items.some(x=>x.id===unassigned.op.operationId));
assert.ok(!kv.data.has(kv.id(key('unread',low.uid,unassigned.op.operationId))),'users below work ACL excluded');

const edit={action:'work_save',id:first.saved.request.id,baseRevision:first.saved.request.revision,operationId:crypto.randomUUID(),acknowledgeDuplicates:true,form:{...form,symptom:'접수 내용만 수정'}};
assert.equal((await store.handle(edit,admin)).success,true);assert.equal((await events()).length,3,'content updates do not notify');
const change={...edit,baseRevision:2,operationId:crypto.randomUUID(),form:{...form,engineer:'담당 B'}};
assert.equal((await store.handle(change,admin)).success,true);await service.process(change.operationId);assert.equal(sent.at(-1).p.recipient,bob.uid);
const stale=await create('담당 A');const moved=await store.handle({...change,id:stale.saved.request.id,baseRevision:1,operationId:crypto.randomUUID()},admin);assert.equal(moved.success,true);
let count=sent.length;await service.process(stale.op.operationId);assert.equal(sent.length,count,'obsolete assignment is not sent');
await service.process(moved.event.id);assert.equal(sent.at(-1).p.recipient,bob.uid);

// Read only after the latest request and successful source check; no status mutation.
const current=(await store.request(unassigned.saved.request.id)).value;
assert.equal((await service.handle({action:'notification_read',notificationId:unassigned.op.operationId,revision:current.revision},alice)).success,true,'committed revision allows viewing without a GAS read');
assert.equal((await service.handle({action:'notification_read',notificationId:unassigned.op.operationId,revision:current.revision-1,sourceCheckedAt:new Date(kv.clock).toISOString()},alice)).success,false);
assert.equal((await service.handle({action:'notification_read',notificationId:unassigned.op.operationId,revision:current.revision,sourceCheckedAt:new Date(kv.clock).toISOString()},alice)).success,true);
assert.equal((await store.request(current.id)).value.status,'접수');
await assert.rejects(()=>service.handle({action:'notification_read',notificationId:first.op.operationId,revision:3,sourceCheckedAt:new Date(kv.clock).toISOString()},bob),/알림/);

// Transient delivery retries; expired subscriptions are removed without touching work data.
const retry=await create('담당 A');failure=503;count=sent.length;await service.process(retry.op.operationId);assert.equal(sent.length,count);
assert.equal((await store.request(retry.saved.request.id)).value.symptom,form.symptom,'delivery failure keeps saved receipt');
failure=0;kv.clock+=61000;await service.process();assert.ok(sent.some(x=>x.p.notificationId===retry.op.operationId));
const gone=await create('담당 A');failure=410;await service.process(gone.op.operationId);failure=0;
assert.equal((await service.handle({action:'notification_config'},alice)).devices.length,0);

// A browser endpoint belongs to exactly one account; stale queued jobs cannot follow a switch.
await service.handle({action:'notification_subscribe',subscription:sub('shared')},alice);const switched=await create('담당 A');
await service.handle({action:'notification_subscribe',subscription:sub('shared')},bob);count=sent.length;await service.process(switched.op.operationId);assert.equal(sent.length,count);
assert.equal((await service.handle({action:'notification_config'},alice)).devices.length,0);
await service.handle({action:'notification_unsubscribe',endpoint:sub('shared').endpoint},alice);
assert.equal((await service.handle({action:'notification_config'},bob)).devices.length,2,'one user cannot detach another account');

await assert.rejects(()=>service.handle({action:'notification_mapping',uid:bob.uid,engineer:'담당 A'},alice),/관리자/);
await service.handle({action:'notification_mapping',uid:bob.uid,engineer:'담당 A'},admin);assert.equal((await service.handle({action:'notification_config'},bob)).engineer,'담당 A');
accounts=accounts.filter(x=>x.uid!==bob.uid);await assert.rejects(()=>service.handle({action:'notification_list'},bob),/로그인/);

// Missing account mappings must not block ready events behind them.
await service.handle({action:'notification_mapping',uid:alice.uid,engineer:''},admin);
await service.handle({action:'notification_mapping',uid:admin.uid,engineer:'담당 B'},admin);
for(let i=0;i<25;i++)await create('담당 A','aaaa_unmapped_'+String(i).padStart(3,'0'));
await service.process();const mapped=await create('담당 B','zzzz_mapped_001');await service.process();
assert.ok((await service.handle({action:'notification_list'},admin)).items.some(x=>x.id===mapped.op.operationId),'unmapped events are deferred so mapped accounts can still receive later notifications');
// Public configuration exposes only the public key. Concurrent initialization keeps one key.
const sender1=createPushSender(kv),sender2=createPushSender(kv),publicKeys=await Promise.all([sender1.publicKey(),sender2.publicKey()]);assert.equal(publicKeys[0],publicKeys[1]);assert.equal(Buffer.from(publicKeys[0],'base64url').length,65);
assert.ok(!JSON.stringify(await service.handle({action:'notification_config'},admin)).includes('privateKey'));

const purgeCase=await create('');await service.process(purgeCase.op.operationId);const soft=await store.handle({action:'work_delete',requestId:purgeCase.saved.request.id,baseRevision:1,operationId:crypto.randomUUID()},admin);assert.equal(soft.success,true);const purged=await store.handle({action:'work_purge',requestId:purgeCase.saved.request.id,baseRevision:soft.request.revision,confirmPermanentDelete:true,operationId:crypto.randomUUID()},admin);assert.equal(purged.success,true);assert.equal((await kv.get(key('event',purgeCase.op.operationId))).value,null);for(const who of [alice,admin])assert.ok(!(await service.handle({action:'notification_list'},who)).items.some(x=>x.id===purgeCase.op.operationId));
// Pagination must not drop the lookahead row. Expiry never removes work history.
for(let i=0;i<55;i++){const id='paging_'+String(i).padStart(3,'0'),at=new Date(kv.clock+i*1000).toISOString();await kv.set(key('inbox',admin.uid,at+'|'+id),{id,requestId:current.id,createdAt:at});}
const page1=await service.handle({action:'notification_list'},admin),page2=await service.handle({action:'notification_list',cursor:page1.cursor},admin);assert.equal(new Set([...page1.items,...page2.items].filter(x=>x.id.startsWith('paging_')).map(x=>x.id)).size,55);
kv.clock+=31*86400000;assert.ok((await store.request(current.id)).value);assert.equal((await kv.get(key('event',unassigned.op.operationId))).value,null);
console.log('work-notifications: atomic assignment events, broadcast ACL, replay/updates, reassignment suppression, fresh read without status change, retry/410, account switch, mapping ACL, VAPID secrecy, pagination and expiry passed.');
