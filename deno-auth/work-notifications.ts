// Notification records are isolated from authentication, work audit and Sheet mirror keys.
type Obj = Record<string, any>;
import {createWorkRoster} from './work-roster.ts';
export const PUSH_NS = 'work-notifications-v1';
export const notificationKey = (...p:any[]) => [PUSH_NS,...p];
export async function removeRequestNotifications(kv:any,requestId:string){
 const key=notificationKey;
 // Removing the guard first prevents a concurrent fanout from recreating inbox rows.
 await kv.delete(key('latest',requestId));
 for await(const index of kv.list({prefix:key('requestEvent',requestId)})){
  const id=String(index.key[index.key.length-1]);
  const pending=await kv.get(key('pending',id));
  if(pending.value?.due)await kv.delete(key('fanoutDue',pending.value.due,id));
  for await(const recipient of kv.list({prefix:key('recipient',id)})){
   const uid=String(recipient.key[recipient.key.length-1]);
   if(!(await kv.atomic().delete(key('inbox',uid,recipient.value)).delete(key('index',uid,id)).delete(key('unread',uid,id)).delete(key('read',uid,id)).delete(key('recipientName',id,uid)).delete(recipient.key).commit()).ok)throw new Error('접수 알림 삭제 정리를 다시 시도합니다.');
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
const uidOK = (v:any) => /^g:[A-Za-z0-9_-]{43}$/.test(String(v));
async function digest(v:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))].map(x=>x.toString(16).padStart(2,'0')).join('');}

// Called inside the existing work transaction. Source/Flow imports never produce alerts.
export function assignmentNotification(ev:Obj){
 if(!['request_create','request_update'].includes(ev.kind)||!live(ev.request))return null;
 const r=ev.request,b=ev.before;
 if(b&&norm(b.engineer)===norm(r.engineer))return null;
 return {id:ev.id,requestId:r.id,revision:r.revision,createdAt:ev.at,engineer:r.engineer||'',audience:r.engineer?'assigned':'all',hospitalName:r.hospitalName,visitAt:r.visitAt||'',gubun:r.gubun||'A/S',kind:b?'assignment':'receipt'};
}

export const NOTIFICATION_TYPES=['receipt','visit','status','handover','pdf','roster'];
export async function notificationActivation(kv:any,at=Date.now()){
 const k=notificationKey('activationV2');for(let i=0;i<8;i++){const e=await kv.get(k);if(e.value)return e.value;if((await kv.atomic().check(e).set(k,{since:new Date(at).toISOString()}).commit()).ok)return {since:new Date(at).toISOString()};}throw new Error('알림 시작 설정을 다시 확인하세요.');
}
// Synchronous builder only: callers commit the event together with the saved record.
export function appendNotification(tx:any,e:Obj){
 const due=Date.parse(e.createdAt),key=notificationKey,o={expireIn:TTL};
 tx=tx.set(key('event',e.id),e,o).set(key('pending',e.id),{id:e.id,due},o).set(key('fanoutDue',due,e.id),true,o);
 if(e.requestId)tx=tx.set(key('requestEvent',e.requestId,e.id),true,o);
 if(['receipt','assignment'].includes(e.kind))tx=tx.set(key('latest',e.requestId),e.id,o);
 return tx;
}
export function requestNotifications(ev:Obj){
 const r=ev.request,b=ev.requestBefore||ev.before,events:Obj[]=[];
 if(!r||r.deletedAt||r.purgedAt||ev.kind==='flow_import')return events;
 const base={schema:2,requestId:r.id,revision:r.revision,createdAt:ev.at,engineer:r.engineer||'',hospitalName:r.hospitalName,visitAt:r.visitAt||'',gubun:r.gubun||'A/S',actor:ev.actor};
 const assignment=assignmentNotification(ev);if(assignment)events.push({...base,...assignment});
 if(['request_create','request_update'].includes(ev.kind)&&r.visitAt&&b?.visitAt!==r.visitAt)events.push({...base,id:ev.id+'_visit',kind:'visit',audience:'assigned'});
 if(b?.status&&b.status!==r.status)events.push({...base,id:ev.id+'_status',kind:'status',audience:'assigned',previousStatus:b.status,status:r.status});
 if(ev.kind==='pdf_attachment')events.push({...base,id:ev.id+'_pdf',kind:'pdf',audience:'author',author:r.updatedBy||ev.history?.attachment?.uploadedBy||ev.actor,recordId:ev.history?.sourceRecordId});
 return events;
}
function category(e:Obj){return e.kind==='assignment'?'receipt':e.kind;}
export function notificationText(e:Obj){
 const titles:Obj={receipt:e.audience==='all'?'담당자 미지정 접수가 등록되었습니다':'새 접수가 배정되었습니다',assignment:'담당자가 변경되었습니다',visit:'방문 일정이 등록·변경되었습니다',status:'업무 상태가 변경되었습니다',handover:'AS 처리 현황 작성이 완료되었습니다',pdf:'AS/점검 내역서·댓글 등록이 완료되었습니다',roster:'오늘의 휴무·당직 안내'};
 return {title:titles[e.kind]||'업무 알림',body:String(e.kind==='roster'?e.summary:e.hospitalName+' · '+(e.kind==='status'?e.previousStatus+' → '+e.status:e.kind==='pdf'?'AS/점검 내역서':e.gubun+' · '+(e.visitAt?e.visitAt.replace('T',' '):'방문일 미정'))).slice(0,280)};
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
   const preferences=a.level>=3?(await get('preferences',a.uid)).value?.types||{}:{};
   output.push({...a,engineer:engineers.includes(engineer)?engineer:'',explicit:!!binding,preferences});
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
  if(e.schema===2&&!['receipt','assignment'].includes(e.kind)){
   if(e.kind==='roster')return e.date===new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date(now()))&&now()<Date.parse(e.date+'T09:00:00+09:00');
   if(e.kind==='handover')return (await options.store.sources(e.hospitalName)).some((s:Obj)=>s.recordId===e.recordId);
   try{const r=(await options.store.request(e.requestId)).value;return !r.deletedAt&&!r.purgedAt&&(e.kind!=='visit'||r.visitAt===e.visitAt&&norm(r.engineer)===norm(e.engineer));}catch{return false;}
  }
  try{const r=(await options.store.request(e.requestId)).value;return live(r)&&norm(r.engineer)===norm(e.engineer)&&(await get('latest',e.requestId)).value===e.id;}catch{return false;}
 }
 function eligible(e:Obj,a:Obj,d:Obj){
  if(e.kind==='roster'&&(e.offPeople||[]).some((name:string)=>norm(name)===norm(a.engineer)||norm(name)===norm(a.name)))return false;
  if(a.level>=3&&e.schema===2)return a.preferences?.[category(e)]!==false;
  // Work ownership is the authenticated account name. A staff member may have
  // several authorized Google accounts; each active login needs its own inbox.
  if(e.audience==='author')return !!e.author&&norm(a.name)===norm(e.author);
  return e.audience==='all'||!!e.engineer&&norm(a.engineer)===norm(e.engineer);
 }
 async function rosterReminder(){
  const time=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(now())),date=time.slice(0,10),hm=time.slice(11,16);
  // Retry the same day after transient errors; never send yesterday's reminder.
  if(hm<'08:30'||hm>='09:00')return;
  const id='roster_'+date,marker=await get('rosterDay',date);if(marker.value)return;
  const data=await createWorkRoster(kv).read(date.slice(0,7)),today=data.roster.filter((r:Obj)=>!r.deletedAt&&r.date===date),entry=await kv.get(['hospitalwork-v2','rosterMonth',date.slice(0,7)]);
  if(Number(entry.value?.revision||0)!==data.rosterRevision)return;
  const offPeople=today.filter((r:Obj)=>r.type==='휴무').map((r:Obj)=>r.person),duty=today.filter((r:Obj)=>r.type==='당직').map((r:Obj)=>r.person);
  let tx=kv.atomic().check(marker,entry).set(marker.key,true,{expireIn:32*86400000});
  if(today.length)tx=appendNotification(tx,{schema:2,id,kind:'roster',audience:'all',date,createdAt:new Date(now()).toISOString(),hospitalName:'오늘의 휴무·당직',summary:('휴무: '+(offPeople.join(', ')||'없음')+' · 당직: '+(duty.join(', ')||'없음')).slice(0,1000)});
  await tx.commit();
 }
 async function detail(p:Obj,a:Obj){
  const idx=(await get('index',a.uid,String(p.notificationId||''))).value,event=idx?(await get('inbox',a.uid,idx)).value:null;
  if(!event)throw new Error('알림을 찾지 못했거나 보관 기간이 지났습니다.');
  if(event.kind==='roster')return {success:true,event,roster:(await createWorkRoster(kv).read(event.date.slice(0,7))).roster.filter((r:Obj)=>!r.deletedAt&&r.date===event.date)};
  if(event.kind==='handover'){const source=(await options.store.sources(event.hospitalName)).find((s:Obj)=>s.recordId===event.recordId);if(!source)throw new Error('AS 처리 현황 기록을 찾지 못했습니다.');return {success:true,event,source};}
  return {success:true,event};
 }
 // Receipt lookup is read-only: querying it must not acknowledge any inbox.
 async function receipts(p:Obj,d:Obj){
  const requestId=String(p.requestId||'');
  if(!/^[A-Za-z0-9_-]{8,90}$/.test(requestId))throw new Error('접수 번호를 확인하세요.');
  const r=(await options.store.request(requestId,true)).value;
  const indexes=await rows(['requestEvent',requestId],1001);
  if(indexes.length>1000)throw new Error('알림 이력이 많아 조회할 수 없습니다. 관리자에게 문의하세요.');
  const ids=new Set(indexes.map(x=>String(x.key[x.key.length-1])));
  // Original handover events predate the request link; include only linked records.
  for(const recordId of await options.store.notificationSources(requestId))ids.add('handover_'+await digest(JSON.stringify(recordId)));
  const events:Obj[]=[];
  for(const id of ids){const e=(await get('event',id)).value;if(e&&Date.parse(e.createdAt)+TTL>now())events.push(e);}
  events.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
  const selected=p.notificationId?events.find(e=>e.id===p.notificationId):events[0];
  if(p.notificationId&&!selected)throw new Error('이 접수에 연결된 알림을 찾지 못했거나 보관 기간이 지났습니다.');
  const eventList=events.map(e=>({id:e.id,kind:e.kind,title:notificationText(e).title,createdAt:e.createdAt}));
  if(!selected)return {success:true,requestId,hospitalName:r.hospitalName,events:eventList,selected:null,recipients:[],read:0,unread:0,total:0,retentionDays:30};
  const recipients=await rows(['recipient',selected.id],1001);
  if(recipients.length>1000)throw new Error('알림 수신 계정이 많아 조회할 수 없습니다. 관리자에게 문의하세요.');
  const people:Obj[]=[];
  for(const entry of recipients){
   const uid=String(entry.key[entry.key.length-1]);
   const name=(await get('recipientName',selected.id,uid)).value||d.accounts.find((a:Obj)=>a.uid===uid)?.name||'이전 수신 계정';
   const readAt=(await get('read',uid,selected.id)).value||'';
   people.push({name:String(name),readAt});
  }
  people.sort((a,b)=>a.name.localeCompare(b.name,'ko')||a.readAt.localeCompare(b.readAt));
  const read=people.filter(x=>x.readAt).length;
  return {success:true,requestId,hospitalName:r.hospitalName,events:eventList,selected:eventList.find(e=>e.id===selected.id),recipients:people,read,unread:people.length-read,total:people.length,pending:!!(await get('pending',selected.id)).value,retentionDays:30};
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
  return {success:true,items,cursor:items.length===50?String(iterator.cursor||''):'',readThrough:new Date(now()).toISOString(),unread:Math.min(1000,unread.length),unreadMore:unread.length>1000};
 }
 // Inbox acknowledgement only. It never marks a request or Handover as reviewed.
 async function markInboxRead(p:Obj,a:Obj){
  let entries:Obj[]=[],cursor='',through='';
  if(p.all===true){
   const cutoff=Date.parse(p.through||'');if(!Number.isFinite(cutoff)||cutoff>now()+10000||cutoff<now()-TTL)throw new Error('알림을 새로고침한 뒤 다시 읽음 처리하세요.');
   through=new Date(cutoff).toISOString();const iterator=kv.list({prefix:key('inbox',a.uid)},{reverse:true,limit:50,cursor:p.cursor||undefined});
   for await(const entry of iterator)entries.push(entry);if(entries.length===50)cursor=String(iterator.cursor||'');
  }else{
   if(!Array.isArray(p.ids)||!p.ids.length||p.ids.length>50||p.ids.some((id:any)=>typeof id!=='string'||!/^[A-Za-z0-9_-]{8,90}$/.test(id)))throw new Error('읽음 처리할 알림을 50개 이하로 선택하세요.');
   for(const id of new Set(p.ids)){const idx=(await get('index',a.uid,id)).value;if(idx){const entry=await get('inbox',a.uid,idx);if(entry.value)entries.push(entry);}}
  }
  const readIds:string[]=[],failedIds:string[]=[];let changed=0;
  for(let i=0;i<entries.length;i+=4)await Promise.all(entries.slice(i,i+4).map(async entry=>{
   const e=entry.value;if(!e||through&&e.createdAt>through)return;
   const stamp=await get('read',a.uid,e.id),ttl=Date.parse(e.createdAt)+TTL-now();if(ttl<=0)return;
   if(stamp.value){readIds.push(e.id);return;}
   const result=await kv.atomic().check(entry,stamp).set(key('read',a.uid,e.id),stamp.value||new Date(now()).toISOString(),{expireIn:ttl}).delete(key('unread',a.uid,e.id)).commit();
   (result.ok?readIds:failedIds).push(e.id);if(result.ok)changed++;
  }));
  return {success:true,readIds,failedIds,cursor,through,changed};
 }
 async function markRead(p:Obj,a:Obj){
  const id=String(p.notificationId||''),idx=(await get('index',a.uid,id)).value;
  if(!idx)throw new Error('알림을 찾지 못했거나 보관 기간이 지났습니다.');
  const e=await get('inbox',a.uid,idx),requestEntry=await options.store.request(e.value?.requestId,true),r=requestEntry.value;
  if(String(r.revision)!==String(p.revision))return {success:false,error:'접수 내용이 변경되었습니다. 최신 내용을 다시 확인하세요.'};
  // The committed request revision is the read boundary; raw GAS freshness
  // must never be a prerequisite for viewing published review data.
  const ttl=Math.max(1,Date.parse(e.value.createdAt)+TTL-now()),stamp=(await get('read',a.uid,id));
  const result=await kv.atomic().check(e,stamp,requestEntry).set(key('read',a.uid,id),stamp.value||new Date(now()).toISOString(),{expireIn:ttl}).delete(key('unread',a.uid,id)).commit();
  return result.ok?{success:true}:{success:false,error:'알림 확인 기록을 다시 시도하세요.'};
 }
 async function migratePending(){
  const version=await get('fanoutVersion');if(version.value===2)return;
  for await(const p of kv.list({prefix:key('pending')})){
   if(p.value.due)continue;
   const e=(await get('event',p.value.id)).value,due=e?Date.parse(e.createdAt):now();
   if(!(await kv.atomic().check(p).set(p.key,{...p.value,due},{expireIn:TTL}).set(key('fanoutDue',due,p.value.id),true,{expireIn:TTL}).commit()).ok)throw new Error('알림 대기열 전환을 다시 시도합니다.');
  }
  await kv.set(version.key,2);
 }
 async function fanout(eventId?:string){
  await migratePending();
  const pending=[];
  if(eventId)pending.push(await get('pending',eventId));
  else for await(const index of kv.list({start:key('fanoutDue',0),end:key('fanoutDue',now()+1)},{limit:20})){
   const p=await get('pending',index.key[index.key.length-1]);
   if(!p.value||p.value.due!==index.key[index.key.length-2])await kv.delete(index.key);else pending.push(p);
  }
  if(!pending.some(x=>x.value))return;
  const d=await directory();
  for(const p of pending){
   if(!p.value)continue;const e=(await get('event',p.value.id)).value;
   if(!e){await kv.atomic().delete(p.key).delete(key('fanoutDue',p.value.due,p.value.id)).commit();continue;}
   const roster=e.kind==='roster'?(await createWorkRoster(kv).read(e.date.slice(0,7))).roster:[];
   const recipients=d.accounts.filter(a=>eligible(e,a,d)&&!roster.some((r:Obj)=>!r.deletedAt&&r.date===e.date&&r.type==='휴무'&&[a.engineer,a.name].some(n=>norm(n)===norm(r.person))));
   const valid=await currentEvent(e);
   if(!valid){await kv.atomic().delete(p.key).delete(key('fanoutDue',p.value.due,e.id)).commit();continue;}
   const guard=await get(e.schema===2&&!['receipt','assignment'].includes(e.kind)?'event':'latest',e.schema===2&&!['receipt','assignment'].includes(e.kind)?e.id:e.requestId);if(!guard.value||guard.value!==e.id&&guard.value.id!==e.id)continue;
   let complete=true;
   for(const a of recipients){
    const idx=e.createdAt+'|'+e.id,existing=await get('inbox',a.uid,idx);
    if(existing.value)continue;
    const remaining=Math.max(1,Date.parse(e.createdAt)+TTL-now());
    let tx=kv.atomic().check(existing,guard).set(existing.key,e,{expireIn:remaining}).set(key('index',a.uid,e.id),idx,{expireIn:remaining}).set(key('unread',a.uid,e.id),true,{expireIn:remaining}).set(key('recipient',e.id,a.uid),idx,{expireIn:remaining}).set(key('recipientName',e.id,a.uid),a.name,{expireIn:remaining});
    if(now()-Date.parse(e.createdAt)<PUSH_TTL){
     for(const device of await rows(['device',a.uid],10)){
      const id=await digest(e.id+'|'+a.uid+'|'+device.value.id),job={id,eventId:e.id,uid:a.uid,deviceId:device.value.id,binding:device.value.binding,attempt:0,due:now(),lease:0};
      tx=tx.set(key('job',id),job,{expireIn:PUSH_TTL}).set(key('due',job.due,id),true,{expireIn:PUSH_TTL}).set(key('eventJob',e.id,id),id,{expireIn:PUSH_TTL});
     }
    }
    if(!(await tx.commit()).ok)complete=false;
   }
   // Missing assigned-account mapping can be repaired by an admin before this expires.
   const missingAssignee=e.audience==='assigned'&&e.engineer&&!recipients.some(a=>norm(a.engineer)===norm(e.engineer));
   if(complete&&!missingAssignee&&(recipients.length||e.audience==='all'||e.schema===2&&e.audience==='author'))await kv.atomic().check(p).delete(p.key).delete(key('fanoutDue',p.value.due,e.id)).commit();
   else{
    const due=now()+(missingAssignee||!recipients.length?300000:60000),remaining=Math.max(1,Date.parse(e.createdAt)+TTL-now());
    await kv.atomic().check(p).set(p.key,{id:e.id,due},{expireIn:remaining}).delete(key('fanoutDue',p.value.due,e.id)).set(key('fanoutDue',due,e.id),true,{expireIn:remaining}).commit();
   }
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
  const roster=e?.kind==='roster'?(await createWorkRoster(kv).read(e.date.slice(0,7))).roster:[];
  const off=roster.some((r:Obj)=>!r.deletedAt&&r.date===e.date&&r.type==='휴무'&&[a?.engineer,a?.name].some(n=>norm(n)===norm(r.person)));
  if(e&&now()-Date.parse(e.createdAt)<PUSH_TTL&&a&&eligible(e,a,d)&&!off&&sub?.uid===j.uid&&sub.binding===j.binding&&!(await get('read',j.uid,e.id)).value&&await currentEvent(e)){
   try{
    await options.send(sub.subscription,{...notificationText(e),requestId:e.requestId||'',notificationId:e.id,kind:e.kind,recipient:j.uid},Math.max(1,Math.floor(((e.kind==='roster'?Math.min(PUSH_TTL,Date.parse(e.date+'T09:00:00+09:00')-Date.parse(e.createdAt)):PUSH_TTL)-(now()-Date.parse(e.createdAt)))/1000)));
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
  await notificationActivation(kv,now());
  try{await rosterReminder();}catch{console.warn('휴무·당직 알림은 다음 주기에 재시도합니다.');}
  await fanout(eventId);
  const entries=[];
  for await(const x of kv.list({start:key('due',0),end:key('due',now()+1)},{limit}))entries.push(x);
  if(!entries.length)return;
  const d=await directory();
  for(let i=0;i<entries.length;i+=4)await Promise.all(entries.slice(i,i+4).map(e=>deliver(e,d)));
 }
 async function handle(p:Obj,who:Obj){
  await notificationActivation(kv,now());
  const {a,d}=await actor(who);
  switch(p.action){
   case 'notification_config':return {success:true,uid:a.uid,name:a.name,engineer:a.engineer||'',broadcast:true,publicKey:await options.publicKey(),devices:(await rows(['device',a.uid],10)).map(x=>({id:x.value.id})),admin:Math.min(a.level,who.level)>=3,notificationTypes:NOTIFICATION_TYPES,preferences:a.preferences};
   case 'notification_detail':return await detail(p,a);
   case 'notification_receipts':return await receipts(p,d);
   case 'notification_preferences':{
    if(Math.min(a.level,who.level)<3)throw new Error('관리자 권한이 필요합니다.');
    if(!p.types||Object.keys(p.types).length!==NOTIFICATION_TYPES.length||NOTIFICATION_TYPES.some(t=>typeof p.types[t]!=='boolean')||Object.keys(p.types).some(t=>!NOTIFICATION_TYPES.includes(t)))throw new Error('알림 종류별 수신 설정을 확인하세요.');
    await kv.set(key('preferences',a.uid),{types:p.types,updatedAt:new Date(now()).toISOString()});return {success:true};
   }
   case 'notification_subscribe':return await subscribe(p,a);
   case 'notification_unsubscribe':{
    const id=await digest(String(p.endpoint||''));await removeDevice(id,a.uid);return {success:true};
   }
   case 'notification_list':return await list(p,a);
   case 'notification_read':return await markRead(p,a);
   case 'notification_mark_read':return await markInboxRead(p,a);
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
