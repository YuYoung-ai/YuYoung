import assert from 'node:assert/strict';
import {createWorkStore} from '../deno-auth/work-store.ts';
import {createWorkNotifications,notificationKey as k,NOTIFICATION_TYPES} from '../deno-auth/work-notifications.ts';

const kv=await Deno.openKv(':memory:');
try{
 let clock=Date.now();
 const uid=(c:string)=>'g:'+c.repeat(43);
 const alice={uid:uid('A'),name:'현장 A',level:2},bob={uid:uid('B'),name:'현장 B',level:2},admin={uid:uid('C'),name:'관리자',level:3},low={uid:uid('X'),name:'권한 없음',level:0};
 const accounts=[alice,bob,admin,low],store=createWorkStore(kv);
 await store.bridge('seed',{hospitals:[{id:'h1',key:'h1',name:'검증 병원',sn:'SN1'}],references:{engineers:['현장 A','현장 B'],minimumLevel:1}});
 await store.bridge('activate',{manifest:await store.manifest()});
 const service=createWorkNotifications(kv,{store,accounts:async()=>accounts,now:()=>clock,publicKey:async()=>'',send:async()=>{throw new Error('No push is needed for inbox recipients');}});
 const form={hospitalKey:'h1',symptom:'읽음 현황 검증',cs:'CS',engineer:'현장 A',registeredAt:'2026-10-17T09:00',status:'접수'};
 async function save(action:string,p:any={}){const d=await store.handle({action,operationId:crypto.randomUUID(),...p},admin);assert.ok(d.success,d.error);clock+=100;return d;}
 async function receipt(id:string,notificationId?:string,who=admin){return await service.handle({action:'notification_receipts',requestId:id,notificationId},who) as any;}
 const first=await save('work_save',{form}),id=first.request.id;
 let d=await receipt(id);assert.equal(d.total,0);assert.ok(d.pending,'pending fanout is explicit');
 await service.process();d=await receipt(id);
 assert.deepEqual([d.read,d.unread,d.total],[0,2,2],'no subscription is required to be an inbox recipient');
 assert.deepEqual(d.recipients.map((x:any)=>x.name).sort(),[alice.name,admin.name].sort());
 const eventId=d.selected.id,original=(await store.request(id)).value;
 await receipt(id,undefined,alice);assert.equal((await receipt(id)).read,0,'lookup is read-only');
 await service.handle({action:'notification_read',notificationId:eventId,revision:original.revision},alice);
 d=await receipt(id,eventId);assert.deepEqual([d.read,d.unread],[1,1]);const readAt=d.recipients.find((x:any)=>x.name===alice.name).readAt;
 clock+=1000;await service.handle({action:'notification_mark_read',ids:[eventId]},alice);
 assert.equal((await receipt(id,eventId)).recipients.find((x:any)=>x.name===alice.name).readAt,readAt,'first read time is preserved');
 const inbox=await service.handle({action:'notification_list'},admin);
 await service.handle({action:'notification_mark_read',all:true,through:inbox.readThrough},admin);
 assert.equal((await receipt(id,eventId)).read,2,'mark all uses the same receipt records');
 assert.deepEqual((await store.request(id)).value,original,'receipt reads never change request or review state');
 const changed=await save('work_status',{requestId:id,baseRevision:1,status:'처리중'});await service.process();
 d=await receipt(id);assert.equal(d.selected.kind,'status');assert.equal(d.read,0,'new events do not inherit earlier reads');assert.equal((await receipt(id,eventId)).read,2);
 const other=await save('work_save',{form:{...form,engineer:'현장 B'},acknowledgeDuplicates:true});await service.process();
 await assert.rejects(()=>receipt(other.request.id,eventId),/연결된 알림/);
 await assert.rejects(()=>receipt(id,undefined,low),/로그인|권한/);
 await assert.rejects(()=>receipt('missing-request'),/찾지/);
 // Existing recipients stay visible after preference, mapping and directory changes.
 const preferences=Object.fromEntries(NOTIFICATION_TYPES.map(t=>[t,false]));await service.handle({action:'notification_preferences',types:preferences},admin);
 await service.handle({action:'notification_mapping',uid:alice.uid,engineer:'현장 B'},admin);
 alice.name='변경된 이름';d=await receipt(id,eventId);assert.ok(d.recipients.some((x:any)=>x.name==='현장 A'),'delivery-time names survive renames');
 // Pre-feature rows have no name snapshot; resolve with the current directory.
 await kv.delete(k('recipientName',eventId,admin.uid));assert.ok((await receipt(id,eventId)).recipients.some((x:any)=>x.name===admin.name));
 accounts.splice(accounts.indexOf(alice),1);assert.ok((await receipt(id,eventId)).recipients.some((x:any)=>x.name==='현장 A'),'removed recipient is not silently dropped');
 const second={...bob,uid:uid('D')};accounts.push(second);
 const broadcast=await save('work_save',{form:{...form,engineer:''},acknowledgeDuplicates:true});await service.process();
 d=await receipt(broadcast.request.id);assert.equal(d.recipients.filter((x:any)=>x.name===bob.name).length,2,'separate Google accounts remain separate receipts');
 assert.ok(!JSON.stringify(d).includes('g:'),'recipient identities expose names only, not auth identifiers');
 // Link a source to exactly one request; same hospital name must not leak it to another.
 const source={schemaVersion:2,recordId:'receipt_source_001',date:'2026-10-17',hospitalName:'검증 병원',sn:'SN1',gubun:'A/S',result:'정상',detail:'읽음 검증',originalAuthor:bob.name,createdAt:new Date(clock).toISOString(),observedAt:new Date(clock).toISOString(),version:'v1'};
 await store.ingestSources([source]);await service.process();
 const latest=(await store.request(id)).value,s=(await store.sources('검증 병원')).find((x:any)=>x.recordId===source.recordId);
 await save('work_result_save',{requestId:id,baseRevision:latest.revision,recordId:s.recordId,sourceVersion:s.version,memo:''});
 d=await receipt(id);const handover=d.events.find((e:any)=>e.kind==='handover');assert.ok(handover);
 assert.ok(!(await receipt(other.request.id)).events.some((e:any)=>e.id===handover.id));
 assert.equal((await receipt(id,handover.id)).total,2,'source author accounts only after admin opt-out');
 // A malformed/unrelated event selector is never trusted.
 await assert.rejects(()=>receipt(id,'unrelated-event'),/연결된 알림/);
 clock+=31*86400000;d=await receipt(id);assert.equal(d.selected,null);assert.equal(d.total,0);assert.ok((await store.request(id)).value);
 console.log('work-read-receipts: real KV, event-specific read/unread, exact recipients, first-read time, bulk read, pending, ACL, cross-request isolation, delivery names, legacy fallback, account changes, linked-source isolation and 30-day retention passed.');
}finally{kv.close();}
