import assert from 'node:assert/strict';
import {createWorkStore} from '../deno-auth/work-store.ts';
import {createWorkNotifications,notificationKey as k} from '../deno-auth/work-notifications.ts';
const kv=await Deno.openKv(':memory:');
try{
 let clock=Date.now(),sent:any[]=[],fail=false;
 const user=(c:string,name:string,level=2)=>({uid:'g:'+c.repeat(43),name,level}),alice=user('A','현장 A'),bob=user('B','현장 B'),admin=user('C','관리자',3),low=user('X','권한 없음',0),accounts=[alice,bob,admin,low];
 const store=createWorkStore(kv);await store.bridge('seed',{hospitals:[{id:'h1',key:'h1',name:'재알림 검증 병원',sn:'SN1'}],references:{engineers:['현장 A','현장 B'],minimumLevel:1}});await store.bridge('activate',{manifest:await store.manifest()});
 const service=createWorkNotifications(kv,{store,accounts:async()=>accounts,now:()=>clock,publicKey:async()=>'',send:async(_:any,p:any)=>{if(fail)throw {statusCode:503};sent.push(p);}});
 const form={hospitalKey:'h1',symptom:'재알림 검증',cs:'CS',engineer:alice.name,registeredAt:'2026-10-19T09:00',status:'접수'};
 async function save(form:any){const r=await store.handle({action:'work_save',operationId:crypto.randomUUID(),form,acknowledgeDuplicates:true},admin);assert.ok(r.success,r.error);return r.request;}
 const request=await save(form),other=await save({...form,engineer:bob.name});clock+=1000;await service.process();
 const view=async()=>await service.handle({action:'notification_receipts',requestId:request.id},admin) as any;
 let d=await view();assert.ok(d.recipients.every((p:any)=>!p.canRemind),'no connected device disables reminder');
 for(let i=0;i<2;i++)await service.handle({action:'notification_subscribe',subscription:{endpoint:'https://fcm.googleapis.com/fcm/send/remind'+i,keys:{p256dh:btoa(String.fromCharCode(4)+'a'.repeat(64)).replace(/=/g,''),auth:btoa('b'.repeat(16)).replace(/=/g,'')}}},alice);
 // The original event is older than normal push TTL but remains a current assignment.
 clock+=2*86400000;d=await view();const target=d.recipients.find((p:any)=>p.name===alice.name),event=d.selected.id;
 assert.equal(target.canRemind,true);assert.match(target.recipientId,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(d).includes('g:'));
 const payload={action:'notification_remind',requestId:request.id,notificationId:event,recipientId:target.recipientId};
 await assert.rejects(()=>service.handle(payload,low),/권한|로그인/);
 await assert.rejects(()=>service.handle({...payload,requestId:other.id},admin),/연결된 알림/);
 await assert.rejects(()=>service.handle({...payload,recipientId:'0'.repeat(64)},admin),/수신 계정/);
 const concurrent=await Promise.allSettled([service.handle(payload,admin),service.handle(payload,admin)]);
 assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1,'atomic cooldown permits one concurrent request');
 await service.process();assert.equal(sent.length,2,'selected account devices only, even for event older than 24h');
 assert.ok(sent.every(p=>p.recipient===alice.uid&&p.notificationId===event&&p.title.startsWith('재알림 · ')));
 await service.process();assert.equal(sent.length,2,'queue does not replay successful jobs');
 await assert.rejects(()=>service.handle(payload,admin),/10분/);
 d=await view();assert.deepEqual([d.total,d.read,d.unread],[2,0,2]);assert.ok(d.recipients.find((p:any)=>p.name===alice.name).remindedAt);
 clock+=600001;fail=true;await service.handle(payload,admin);await service.process();assert.equal(sent.length,2);
 clock+=60001;fail=false;await service.process();assert.equal(sent.length,4,'transient push failure retries');
 clock+=600001;await service.handle(payload,admin);await service.handle({action:'notification_mark_read',ids:[event]},alice);await service.process();assert.equal(sent.length,4,'read after queue suppresses delivery');
 await assert.rejects(()=>service.handle(payload,admin),/이미 확인/);
 const readAt=(await view()).recipients.find((p:any)=>p.name===alice.name).readAt;assert.ok(readAt);assert.equal((await store.request(request.id)).value.revision,request.revision);
 // A reassigned request cannot be reminded through an old assignment recipient.
 const stale=await save({...form});await service.process();const staleView=await service.handle({action:'notification_receipts',requestId:stale.id},admin) as any;
 const oldTarget=staleView.recipients.find((p:any)=>p.name===alice.name);
 const changed=await store.handle({action:'work_save',operationId:crypto.randomUUID(),id:stale.id,baseRevision:stale.revision,acknowledgeDuplicates:true,form:{...form,engineer:bob.name}},admin);assert.ok(changed.success,changed.error);
 await assert.rejects(()=>service.handle({action:'notification_remind',requestId:stale.id,notificationId:staleView.selected.id,recipientId:oldTarget.recipientId},admin),/지난 배정|대상/);
 clock+=31*86400000;await assert.rejects(()=>service.handle(payload,admin),/보관 기간|연결된 알림/);
 console.log('work-notification-reminders: real KV, opaque target identity, access and event isolation, device availability, atomic duplicate/cooldown protection, old-event reminder, per-account multi-device delivery, transient retry, read-before-delivery suppression, first-read/request preservation, reassignment and retention passed.');
}finally{kv.close();}
