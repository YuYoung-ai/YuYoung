import assert from 'node:assert/strict';
import {createWorkStore} from '../deno-auth/work-store.ts';
import {createWorkNotifications,notificationKey as k,NOTIFICATION_TYPES} from '../deno-auth/work-notifications.ts';

// Real Deno atomic operations, isolated KV; no Google/Push/production writes.
const kv=await Deno.openKv(':memory:');
try{
 let clock=Date.now(),sent:any[]=[];
 const uid=(c:string)=>'g:'+c.repeat(43),alice={uid:uid('A'),name:'현장 A',level:2},bob={uid:uid('B'),name:'현장 B',level:2},admin={uid:uid('C'),name:'관리자',level:3};
 const accounts=[alice,bob,admin],store=createWorkStore(kv);
 await store.bridge('seed',{hospitals:[{id:'h1',key:'h1',name:'검증 병원',sn:'SN1'}],references:{engineers:['현장 A','현장 B'],minimumLevel:1}});await store.bridge('activate',{manifest:await store.manifest()});
 const service=createWorkNotifications(kv,{store,accounts:async()=>accounts,now:()=>clock,publicKey:async()=>'',send:async(_:any,p:any)=>sent.push(p)});
 async function flush(){clock=Math.max(clock+1000,Date.now()+1000);await service.process();}
 for(const [i,a] of accounts.entries())await service.handle({action:'notification_subscribe',subscription:{endpoint:'https://fcm.googleapis.com/fcm/send/fixture'+i,keys:{p256dh:btoa(String.fromCharCode(4)+'a'.repeat(64)).replace(/=/g,''),auth:btoa('b'.repeat(16)).replace(/=/g,'')}}},a);
 const form={hospitalKey:'h1',symptom:'검증',cs:'CS',engineer:'현장 A',registeredAt:'2026-10-16T09:00',visitAt:'2026-10-17T10:00',status:'방문예정'};
 async function save(action:string,p:any={},who:any=admin){const d=await store.handle({action,operationId:crypto.randomUUID(),...p},who);assert.ok(d.success,d.error);return d;}
 async function inbox(a:any){return (await service.handle({action:'notification_list'},a)).items as any[];}
 const created=await save('work_save',{form});await flush();
 for(const a of [alice,admin])assert.deepEqual((await inbox(a)).map(x=>x.kind).sort(),['receipt','visit']);assert.equal((await inbox(bob)).length,0);
 let changed=await save('work_status',{requestId:created.request.id,baseRevision:1,status:'완료'});await flush();
 assert.equal((await inbox(alice)).filter(x=>x.kind==='status').length,1,'completed status is deliverable');assert.ok(sent.some(x=>x.kind==='status'&&x.recipient===admin.uid));
 const preferences=Object.fromEntries(NOTIFICATION_TYPES.map(t=>[t,t!=='status']));
 await assert.rejects(()=>service.handle({action:'notification_preferences',types:preferences},alice),/관리자/);
 await service.handle({action:'notification_preferences',types:preferences},admin);
 changed=await save('work_status',{requestId:created.request.id,baseRevision:changed.request.revision,status:'보류'});await flush();
 assert.equal((await inbox(admin)).filter(x=>x.kind==='status').length,1,'admin opted-out category receives no later event');assert.equal((await inbox(alice)).filter(x=>x.kind==='status').length,2);
 const source={schemaVersion:2,recordId:'source_notify_001',date:'2026-10-17',hospitalName:'검증 병원',sn:'SN1',gubun:'A/S',result:'정상',detail:'현장 확인',originalAuthor:bob.name,createdAt:new Date(clock+50).toISOString(),observedAt:new Date(clock+60).toISOString(),version:'v1'};
 await store.ingestSources([source]);await flush();
 const handover=(await inbox(bob)).find(x=>x.kind==='handover');assert.ok(handover);assert.ok(!(await inbox(alice)).some(x=>x.kind==='handover'),'creator, not assigned engineer, receives Handover');
 assert.equal((await service.handle({action:'notification_detail',notificationId:handover.id},bob)).source.detail,source.detail);
 await assert.rejects(()=>service.handle({action:'notification_detail',notificationId:handover.id},alice),/알림/);
 await store.ingestSources([source]);await flush();assert.equal((await inbox(bob)).filter(x=>x.kind==='handover').length,1,'source delivery replay is silent');
 await store.ingestSources([{...source,recordId:'source_historical',createdAt:'2020-01-01T00:00:00Z'}]);await flush();assert.equal((await inbox(bob)).filter(x=>x.kind==='handover').length,1,'historical imports are silent');
 const pdf={fileId:'pdf_fixture',url:'https://drive.google.com/file/d/pdf_fixture/view',filename:'AS_검증.pdf',bytes:1234,sha256:'a'.repeat(64),revision:1,uploadedAt:new Date(clock+100).toISOString(),uploadedBy:bob.name,uploadId:'upload_fixture'};
 await store.bridge('documents',{documents:[{recordId:source.recordId,context:{hospitalName:'검증 병원',date:source.date,sn:'SN1'},requestId:created.request.id,pdf}]});await flush();
 assert.equal((await inbox(bob)).filter(x=>x.kind==='pdf').length,1);assert.equal((await inbox(alice)).filter(x=>x.kind==='pdf').length,0);assert.equal((await inbox(admin)).filter(x=>x.kind==='pdf').length,1);
 await store.bridge('documents',{documents:[{recordId:source.recordId,context:{hospitalName:'검증 병원',date:source.date,sn:'SN1'},requestId:created.request.id,pdf}]});await flush();assert.equal((await inbox(bob)).filter(x=>x.kind==='pdf').length,1,'PDF retry does not create another completion');
 // A person can use several authorized Google logins.
 const secondLogin={...bob,uid:'g:'+'D'.repeat(43)};accounts.push(secondLogin);
 await store.ingestSources([{...source,recordId:'source_dual_login',createdAt:new Date(clock+50).toISOString()}]);await flush();
 for(const a of [bob,secondLogin])assert.ok((await inbox(a)).some(x=>x.recordId==='source_dual_login'),'each authenticated login for the author receives its own inbox item');
 assert.ok(!(await inbox(alice)).some(x=>x.recordId==='source_dual_login'));
 // Korea 08:30: off-duty recipient (including an administrator) never receives.
 const rosterDate=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
 clock=Date.parse(rosterDate+'T08:29:00+09:00');
 for(const [person,type] of [[alice.name,'휴무'],[admin.name,'휴무'],[bob.name,'당직']])await save('work_roster_save',{date:rosterDate,person,type,baseRevision:0});
 await flush();assert.equal((await inbox(bob)).filter(x=>x.kind==='roster').length,0);
 clock+=60000;await Promise.all([service.process(),service.process()]);
 for(const a of [alice,admin])assert.equal((await inbox(a)).filter(x=>x.kind==='roster').length,0);
 const roster=(await inbox(bob)).find(x=>x.kind==='roster');assert.ok(roster);assert.equal(sent.filter(x=>x.kind==='roster').length,1,'daily marker and delivery lease prevent duplicates');
 assert.equal((await service.handle({action:'notification_detail',notificationId:roster.id},bob)).roster.length,3);
 await flush();assert.equal(sent.filter(x=>x.kind==='roster').length,1);
 assert.equal(sent.filter(x=>x.kind==='roster')[0].recipient,bob.uid);
 console.log('work-notification-events: real KV recipient matrix, completion state, administrator opt-out/ACL, source author/ownership/replay/historical silence, PDF+comment completion/replay and Korean 08:30 concurrent roster with leave exclusion passed.');
}finally{kv.close();}
