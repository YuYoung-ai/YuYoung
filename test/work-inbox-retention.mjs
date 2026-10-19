import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Kv} from './notification-test-kv.mjs';
import {createWorkNotifications,notificationKey as k,readInboxExpiresAt} from '../deno-auth/work-notifications.ts';
const day=86400000,uid=n=>'g:'+createHash('sha256').update(n).digest('base64url');
const alice={uid:uid('retention-a'),name:'담당 A',level:1},bob={uid:uid('retention-b'),name:'담당 B',level:1};
assert.equal(readInboxExpiresAt('2026-10-19T14:59:59.000Z'),Date.parse('2026-10-19T15:00:00Z'));
assert.equal(readInboxExpiresAt('2026-10-19T15:00:00.000Z'),Date.parse('2026-10-20T15:00:00Z'));
function fixture(){
 const kv=new Kv();kv.clock=Date.parse('2026-10-19T14:50:00Z');
 const requestKey=['retention-test','request'];
 const store={checkAccess:async()=>({minimumLevel:1,engineers:['담당 A','담당 B']}),request:()=>kv.get(requestKey),notificationSources:async()=>[],sources:async()=>[]};
 const service=createWorkNotifications(kv,{store,accounts:async()=>[alice,bob],now:()=>kv.clock,publicKey:async()=>'',send:async()=>{throw new Error('read notifications must not be pushed');}});
 async function seed(id,who=alice,readAt=''){
  await kv.set(requestKey,{id:'request_123',revision:1,hospitalName:'테스트 병원',status:'접수'});
  const event={schema:2,id,requestId:'request_123',createdAt:new Date(kv.clock).toISOString(),hospitalName:'테스트 병원',kind:'status',audience:'all',engineer:'',previousStatus:'접수',status:'방문예정'},index=event.createdAt+'|'+id,ttl={expireIn:30*day};
  await kv.set(k('event',id),event,ttl);await kv.set(k('requestEvent',event.requestId,id),true,ttl);
  await kv.set(k('inbox',who.uid,index),event,ttl);await kv.set(k('index',who.uid,id),index,ttl);
  await kv.set(k('recipient',id,who.uid),index,ttl);await kv.set(k('recipientName',id,who.uid),who.name,ttl);
  if(readAt)await kv.set(k('read',who.uid,id),readAt,ttl);else await kv.set(k('unread',who.uid,id),true,ttl);
  return {event,index};
 }
 const list=who=>service.handle({action:'notification_list'},who);
 return {kv,service,seed,list};
}
{
 const f=fixture(),id='midnight_alert';const {index}=await f.seed(id);await f.seed(id,bob);
 const before=(await f.list(alice)).items.length;
 await f.service.handle({action:'notification_mark_read',ids:[id]},alice);
 const stamp=(await f.kv.get(k('read',alice.uid,id))).value;
 assert.equal((await f.list(alice)).items.length,before);assert.equal((await f.list(alice)).unread,0);
 const expires=readInboxExpiresAt(stamp);assert.equal(f.kv.data.get(f.kv.id(k('inbox',alice.uid,index))).expires,expires);
 f.kv.clock+=1000;await f.service.handle({action:'notification_mark_read',ids:[id]},alice);assert.equal((await f.kv.get(k('read',alice.uid,id))).value,stamp);
 f.kv.clock=expires-1;assert.equal((await f.list(alice)).items.length,1);
 f.kv.clock=expires;assert.equal((await f.list(alice)).items.length,0);assert.equal((await f.kv.get(k('index',alice.uid,id))).value,null);
 assert.equal((await f.list(bob)).items.length,1);assert.equal((await f.list(bob)).unread,1);
 const receipt=await f.service.handle({action:'notification_receipts',requestId:'request_123',notificationId:id},alice);assert.deepEqual([receipt.read,receipt.unread],[1,1]);
 await f.kv.set(k('pending',id),{id,due:f.kv.clock});await f.kv.set(k('fanoutDue',f.kv.clock,id),true);await f.service.process(id);
 assert.equal((await f.list(alice)).items.length,0,'fanout retry cannot resurrect an expired read inbox');
}
{
 const f=fixture();await f.seed('read_selected');await f.seed('read_selected',bob);await f.seed('unread_selected');
 await f.service.handle({action:'notification_mark_read',ids:['read_selected']},alice);
 const result=await f.service.handle({action:'notification_delete',ids:['read_selected','unread_selected'],uid:bob.uid},alice);
 assert.deepEqual(result.deletedIds,['read_selected']);assert.deepEqual(result.skippedIds,['unread_selected']);
 assert.ok((await f.list(alice)).items.some(n=>n.id==='unread_selected'));assert.ok((await f.list(bob)).items.some(n=>n.id==='read_selected'));
 assert.ok((await f.kv.get(k('read',alice.uid,'read_selected'))).value);assert.ok((await f.kv.get(k('event','read_selected'))).value);assert.ok((await f.kv.get(k('recipient','read_selected',alice.uid))).value);
 assert.deepEqual((await f.service.handle({action:'notification_delete',ids:['read_selected']},alice)).deletedIds,['read_selected'],'delete retry is idempotent');
 await assert.rejects(()=>f.service.handle({action:'notification_delete',ids:Array(51).fill('read_selected')},alice),/50/);
 await assert.rejects(()=>f.service.handle({action:'notification_delete',ids:['../bad']},alice),/50/);
}
{
 const f=fixture();await f.seed('revision_alert');
 const failed=await f.service.handle({action:'notification_read',notificationId:'revision_alert',revision:99},alice);assert.equal(failed.success,false);assert.equal((await f.list(alice)).items[0].readAt,'');
 assert.equal((await f.service.handle({action:'notification_read',notificationId:'revision_alert',revision:1},alice)).success,true);
 f.kv.clock=Date.parse('2026-10-19T15:00:00Z');assert.equal((await f.list(alice)).items.length,0,'opening a request uses the same expiry as bulk read');
}
{
 const f=fixture();await f.seed('conflict_alert');await f.service.handle({action:'notification_mark_read',ids:['conflict_alert']},alice);
 const atomic=f.kv.atomic.bind(f.kv);let conflict=true;
 f.kv.atomic=()=>{const tx=atomic(),commit=tx.commit;tx.commit=async()=>{if(conflict){conflict=false;return {ok:false};}return commit();};return tx;};
 const failed=await f.service.handle({action:'notification_delete',ids:['conflict_alert']},alice);assert.deepEqual(failed.failedIds,['conflict_alert']);assert.equal((await f.list(alice)).items.length,1,'CAS conflict retains the inbox item for retry');
 assert.deepEqual((await f.service.handle({action:'notification_delete',ids:['conflict_alert']},alice)).deletedIds,['conflict_alert']);
}
{
 const f=fixture(),old='2026-10-18T01:00:00Z';
 for(let i=0;i<205;i++)await f.seed('legacy_'+String(i).padStart(4,'0'),alice,old);
 await f.service.process();assert.equal((await f.kv.get(k('readRetentionV1'))).value.done,false);
 await f.service.process();await f.service.process();assert.equal((await f.kv.get(k('readRetentionV1'))).value.done,true);
 assert.equal((await f.list(alice)).items.length,0);assert.equal([...f.kv.data.values()].filter(x=>x.key[1]==='read').length,205,'cleanup keeps all read receipt evidence');
}
{
 const f=fixture();for(let i=0;i<55;i++)await f.seed('paging_old_'+String(i).padStart(3,'0'),alice,'2026-10-18T01:00:00Z');
 for(let i=0;i<6;i++)await f.seed('paging_new_'+String(i).padStart(3,'0'));
 const page=await f.list(alice);assert.equal(page.items.length,6,'expired legacy rows cannot hide unread rows on later pages');assert.equal(page.unread,6);
}
console.log('Inbox retention: KST midnight boundary, unread isolation, original read time, TTL expiry, revision checks, idempotent/account-scoped read-only deletion, preserved receipts, bounded legacy migration and fanout resurrection guard passed.');
