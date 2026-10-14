// Notification records are isolated from authentication, work audit and Sheet mirror keys.
type Obj = Record<string, any>;
export const PUSH_NS = 'work-notifications-v1';
export const notificationKey = (...p:any[]) => [PUSH_NS,...p];
export async function removeRequestNotifications(kv:any,requestId:string){
 const key=notificationKey;
 // Removing the guard first prevents a concurrent fanout from recreating inbox rows.
 await kv.delete(key('latest',requestId));
 for await(const index of kv.list({prefix:key('requestEvent',requestId)})){
  const id=String(index.key[index.key.length-1]);
  for await(const recipient of kv.list({prefix:key('recipient',id)})){
   const uid=String(recipient.key[recipient.key.length-1]);
   if(!(await kv.atomic().delete(key('inbox',uid,recipient.value)).delete(key('index',uid,id)).delete(key('unread',uid,id)).delete(key('read',uid,id)).delete(recipient.key).commit()).ok)throw new Error('접수 알림 삭제 정리를 다시 시도합니다.');
  }
  for await(const jobIndex of kv.list({prefix:key('eventJob',id)})){
   const job=await kv.get(key('job',jobIndex.value));let tx=kv.atomic().check(job).delete(job.key).delete(jobIndex.key);
   if(job.value){tx=tx.delete(key('due',job.value.due,job.value.id));if(job.value.lease)tx=tx.delete(key('due',job.value.lease,job.value.id));}
   if(!(await tx.commit()).ok)throw new Error('접수 알림 삭제 정리를 다시 시도합니다.');
  }
  if(!(await kv.atomic().delete(key('event',id)).delete(key('pending',id)).delete(index.key).commit()).ok)throw new Error('접수 알림 삭제 정리를 다시 시도합니다.');
 }
}
const TTL = 30*86400000, DEVICE_TTL = 90*86400000, PUSH_TTL = 86400000;
const norm = (v:any) => String(v||'').normalize('NFKC').trim().replace(/\s+/g,'');
const clone = (v:any) => structuredClone(v);
const live = (r:Obj) => r&&!r.deletedAt&&!r.purgedAt&&!['완료','취소'].includes(r.status);
const uidOK = (v:any) => /^[gp]:[A-Za-z0-9_-]{43}$/.test(String(v));
async function digest(v:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))].map(x=>x.toString(16).padStart(2,'0')).join('');}

// Called inside the existing work transaction. Source/Flow imports never produce alerts.
export function assignmentNotification(ev:Obj){
 if(!['request_create','request_update'].includes(ev.kind)||!live(ev.request))return null;
 const r=ev.request,b=ev.before;
 if(b&&norm(b.engineer)===norm(r.engineer))return null;
 return {id:ev.id,requestId:r.id,revision:r.revision,createdAt:ev.at,engineer:r.engineer||'',audience:r.engineer?'assigned':'all',hospitalName:r.hospitalName,visitAt:r.visitAt||'',gubun:r.gubun||'A/S',kind:b?'assignment':'receipt'};
}

export function validateSubscription(value:any){
 if(!value||JSON.stringify(value).length>4096)throw new Error('알림 기기 정보를 확인하세요.');
 let u:URL;try{u=new URL(value.endpoint);}catch{throw new Error('알림 주소가 올바르지 않습니다.');}
 const h=u.hostname;
 const allowed=h==='fcm.googleapis.com'||h==='web.push.apple.com'||h.endsWith('.push.apple.com')||h==='updates.push.services.mozilla.com'||h.endsWith('.push.services.mozilla.com')||h.endsWith('.notify.windows.com');
 if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash||!allowed)throw new Error('지원하는 알림 서비스 주소가 아닙니다.');
 const decode=(s:any,length:number)=>{if(typeof s!=='string'||! /^[A-Za-z0-9_-]+$/.test(s))return false;try{return atob(s.replace(/-/g,'+').replace(/_/g,'/')).length===length;}catch{return false;}};
 if(!decode(value.keys?.p256dh,65)||!decode(value.keys?.auth,16))throw new Error('알림 암호화 정보를 확인하세요.');
 return {endpoint:u.href,keys:{p256dh:value.keys.p256dh,auth:value.keys.auth}};
}

export function createWorkNotifications(kv:any,options:Obj){
 const key=notificationKey,now=options.now||Date.now;
 const get=(...p:any[])=>kv.get(key(...p));
 async function rows(parts:any[],limit=1000){const out:Obj[]=[];for await(const e of kv.list({prefix:key(...parts)},{limit}))out.push(e);return out;}
 async function directory(){
  const ref=(await options.store.checkAccess({name:'notification-worker',level:3})),minimum=Number(ref.minimumLevel)||1;
  const accounts=(await options.accounts()).filter((a:Obj)=>uidOK(a.uid)&&a.level>=minimum),engineers=ref.engineers||[];
  const output=[];
  for(const a of accounts){
   const binding=(await get('mapping',a.uid)).value;
   const candidates=engineers.filter((n:string)=>norm(n)===norm(a.name));
   const unique=accounts.filter((x:Obj)=>norm(x.name)===norm(a.name)).length===1;
   const engineer=binding?String(binding.engineer||''):unique&&candidates.length===1?candidates[0]:'';
   output.push({...a,engineer:engineers.includes(engineer)?engineer:'',explicit:!!binding});
  }
  return {accounts:output,engineers};
 }
 async function actor(who:Obj){
  const d=await directory();
  const matches=who.uid?d.accounts.filter(a=>a.uid===who.uid):d.accounts.filter(a=>a.name===who.name);
  if(matches.length!==1)throw new Error('알림 설정을 위해 다시 로그인해 주세요.');
  const a=matches[0];await options.store.checkAccess({name:a.name,level:Math.min(a.level,who.level)});return {a,d};
 }
 async function currentEvent(e:Obj){
  try{const r=(await options.store.request(e.requestId)).value;return live(r)&&norm(r.engineer)===norm(e.engineer)&&(await get('latest',e.requestId)).value===e.id;}catch{return false;}
 }
 async function subscribe(p:Obj,a:Obj){
  const subscription=validateSubscription(p.subscription),id=await digest(subscription.endpoint);
  for(let tries=0;tries<8;tries++){
   const old=await get('subscription',id),quota=await get('deviceRevision',a.uid),devices=await rows(['device',a.uid],11);
   if(!devices.some(x=>x.value.id===id)&&devices.length>=10)throw new Error('알림 기기는 최대 10개까지 등록할 수 있습니다.');
   const same=old.value?.uid===a.uid&&JSON.stringify(old.value.subscription)===JSON.stringify(subscription);
   const record={id,uid:a.uid,subscription,binding:same?old.value.binding:crypto.randomUUID(),updatedAt:now()};
   let tx=kv.atomic().check(old,quota).set(quota.key,Number(quota.value||0)+1).set(key('subscription',id),record,{expireIn:DEVICE_TTL}).set(key('device',a.uid,id),{id,binding:record.binding},{expireIn:DEVICE_TTL});
   if(old.value&&old.value.uid!==a.uid)tx=tx.delete(key('device',old.value.uid,id));
   if((await tx.commit()).ok)return {success:true,uid:a.uid,deviceId:id,engineer:a.engineer||'',broadcast:true};
  }
  throw new Error('알림 기기 연결을 다시 시도하세요.');
 }
 async function removeDevice(id:string,uid:string,binding?:string){
  const e=await get('subscription',id);
  if(e.value?.uid!==uid||binding&&e.value.binding!==binding)return;
  await kv.atomic().check(e).delete(e.key).delete(key('device',uid,id)).commit();
 }
 async function list(p:Obj,a:Obj){
  const iterator=kv.list({prefix:key('inbox',a.uid)},{reverse:true,limit:50,cursor:p.cursor||undefined}),items=[];
  for await(const x of iterator)items.push({...x.value,readAt:(await get('read',a.uid,x.value.id)).value||''});
  const unread=await rows(['unread',a.uid],1001);
  return {success:true,items,cursor:items.length===50?String(iterator.cursor||''):'',unread:Math.min(1000,unread.length),unreadMore:unread.length>1000};
 }
 async function markRead(p:Obj,a:Obj){
  const id=String(p.notificationId||''),idx=(await get('index',a.uid,id)).value;
  if(!idx)throw new Error('알림을 찾지 못했거나 보관 기간이 지났습니다.');
  const e=await get('inbox',a.uid,idx),r=(await options.store.request(e.value?.requestId,true)).value;
  if(String(r.revision)!==String(p.revision))return {success:false,error:'접수 내용이 변경되었습니다. 최신 내용을 다시 확인하세요.'};
  if(!r.deletedAt&&(!Number.isFinite(Date.parse(p.sourceCheckedAt||''))||now()-Date.parse(p.sourceCheckedAt)>120000||Date.parse(p.sourceCheckedAt)>now()+10000))throw new Error('Handover 최신 확인 후 알림을 열람 처리하세요.');
  const ttl=Math.max(1,Date.parse(e.value.createdAt)+TTL-now()),stamp=(await get('read',a.uid,id));
  const result=await kv.atomic().check(e,stamp).set(key('read',a.uid,id),stamp.value||new Date(now()).toISOString(),{expireIn:ttl}).delete(key('unread',a.uid,id)).commit();
  return result.ok?{success:true}:{success:false,error:'알림 확인 기록을 다시 시도하세요.'};
 }
 async function fanout(eventId?:string){
  const pending=eventId?[await get('pending',eventId)]:await rows(['pending'],20);
  if(!pending.some(x=>x.value))return;
  const d=await directory();
  for(const p of pending){
   if(!p.value)continue;const e=(await get('event',p.value.id)).value;
   if(!e){await kv.delete(p.key);continue;}
   const eligible=d.accounts.filter(a=>e.audience==='all'||a.engineer===e.engineer);
   const valid=await currentEvent(e);
   if(!valid){await kv.delete(p.key);continue;}
   const guard=await get('latest',e.requestId);if(guard.value!==e.id)continue;
   let complete=true;
   for(const a of eligible){
    const idx=e.createdAt+'|'+e.id,existing=await get('inbox',a.uid,idx);
    if(existing.value)continue;
    const remaining=Math.max(1,Date.parse(e.createdAt)+TTL-now());
    let tx=kv.atomic().check(existing,guard).set(existing.key,e,{expireIn:remaining}).set(key('index',a.uid,e.id),idx,{expireIn:remaining}).set(key('unread',a.uid,e.id),true,{expireIn:remaining}).set(key('recipient',e.id,a.uid),idx,{expireIn:remaining});
    if(now()-Date.parse(e.createdAt)<PUSH_TTL){
     for(const device of await rows(['device',a.uid],10)){
      const id=await digest(e.id+'|'+a.uid+'|'+device.value.id),job={id,eventId:e.id,uid:a.uid,deviceId:device.value.id,binding:device.value.binding,attempt:0,due:now(),lease:0};
      tx=tx.set(key('job',id),job,{expireIn:PUSH_TTL}).set(key('due',job.due,id),true,{expireIn:PUSH_TTL}).set(key('eventJob',e.id,id),id,{expireIn:PUSH_TTL});
     }
    }
    if(!(await tx.commit()).ok)complete=false;
   }
   // Missing assigned-account mapping can be repaired by an admin before this expires.
   if(complete&&(eligible.length||e.audience==='all'))await kv.delete(p.key);
  }
 }
 async function deliver(due:Obj,d:Obj){
  const id=String(due.key[due.key.length-1]),entry=await get('job',id),j=entry.value;
  if(!j){await kv.delete(due.key);return;}
  if(j.lease>now())return;
  const claim=crypto.randomUUID(),leaseDue=now()+30000;
  if(!(await kv.atomic().check(entry).set(entry.key,{...j,lease:leaseDue,claim},{expireIn:PUSH_TTL}).delete(due.key).set(key('due',leaseDue,id),true,{expireIn:PUSH_TTL}).commit()).ok)return;
  const e=(await get('event',j.eventId)).value,sub=(await get('subscription',j.deviceId)).value,a=d.accounts.find((x:Obj)=>x.uid===j.uid);
  let retry=false,expired=false;
  if(e&&now()-Date.parse(e.createdAt)<PUSH_TTL&&a&&(e.audience==='all'||a.engineer===e.engineer)&&sub?.uid===j.uid&&sub.binding===j.binding&&await currentEvent(e)){
   try{
    await options.send(sub.subscription,{title:e.audience==='all'?'담당자 미지정 접수가 등록되었습니다':'새 접수가 배정되었습니다',body:e.hospitalName+' · '+e.gubun+' · '+(e.visitAt?e.visitAt.replace('T',' '):'방문일 미정'),requestId:e.requestId,notificationId:e.id,recipient:j.uid},Math.max(1,Math.floor((PUSH_TTL-(now()-Date.parse(e.createdAt)))/1000)));
   }catch(error:any){expired=[404,410].includes(Number(error.statusCode));retry=!expired&&(!error.statusCode||error.statusCode===429||error.statusCode>=500);}
  }
  if(expired)await removeDevice(j.deviceId,j.uid,j.binding);
  const latest=await get('job',id);if(latest.value?.claim!==claim)return;
  let tx=kv.atomic().check(latest).delete(key('due',leaseDue,id));
  if(retry&&j.attempt<8){const dueAt=now()+[60000,300000,900000,3600000][Math.min(j.attempt,3)];tx=tx.set(latest.key,{...j,attempt:j.attempt+1,lease:0,due:dueAt},{expireIn:PUSH_TTL}).set(key('due',dueAt,id),true,{expireIn:PUSH_TTL});}
  else tx=tx.delete(latest.key);
  await tx.commit();
 }
 async function process(eventId?:string,limit=20){
  await fanout(eventId);
  const entries=[];
  for await(const x of kv.list({start:key('due',0),end:key('due',now()+1)},{limit}))entries.push(x);
  if(!entries.length)return;
  const d=await directory();
  for(let i=0;i<entries.length;i+=4)await Promise.all(entries.slice(i,i+4).map(e=>deliver(e,d)));
 }
 async function handle(p:Obj,who:Obj){
  const {a,d}=await actor(who);
  switch(p.action){
   case 'notification_config':return {success:true,uid:a.uid,name:a.name,engineer:a.engineer||'',broadcast:true,publicKey:await options.publicKey(),devices:(await rows(['device',a.uid],10)).map(x=>({id:x.value.id})),admin:Math.min(a.level,who.level)>=3};
   case 'notification_subscribe':return await subscribe(p,a);
   case 'notification_unsubscribe':{
    const id=await digest(String(p.endpoint||''));await removeDevice(id,a.uid);return {success:true};
   }
   case 'notification_list':return await list(p,a);
   case 'notification_read':return await markRead(p,a);
   case 'notification_test':{
    const id=await digest(String(p.endpoint||'')),sub=(await get('subscription',id)).value;
    if(sub?.uid!==a.uid)throw new Error('현재 기기의 알림 연결을 먼저 설정하세요.');
    const rate=await get('testRate',a.uid);if(rate.value&&now()-rate.value<60000)throw new Error('테스트 알림은 1분 뒤 다시 보낼 수 있습니다.');
    if(!(await kv.atomic().check(rate).set(rate.key,now(),{expireIn:60000}).commit()).ok)throw new Error('테스트 알림을 잠시 후 다시 시도하세요.');
    await options.send(sub.subscription,{title:'BAZ CS 알림 연결 확인',body:'이 기기로 접수 알림을 받을 수 있습니다.',recipient:a.uid,test:true},60);return {success:true};
   }
   case 'notification_accounts':{
    if(Math.min(a.level,who.level)<3)throw new Error('관리자 권한이 필요합니다.');
    return {success:true,accounts:d.accounts.map(x=>({uid:x.uid,name:x.name,label:x.label,engineer:x.engineer,explicit:x.explicit})),engineers:d.engineers};
   }
   case 'notification_mapping':{
    if(Math.min(a.level,who.level)<3)throw new Error('관리자 권한이 필요합니다.');
    const target=d.accounts.find(x=>x.uid===p.uid),engineer=String(p.engineer||'');
    if(!target||engineer&&!d.engineers.includes(engineer))throw new Error('계정과 원본 담당자를 확인하세요.');
    await kv.set(key('mapping',target.uid),{engineer,updatedBy:a.uid,updatedAt:new Date(now()).toISOString()});return {success:true};
   }
   default:throw new Error('지원하지 않는 알림 요청입니다.');
  }
 }
 return {handle,process,directory};
}
