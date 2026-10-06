// Shared work data only. Authentication keys and databases are never changed here.
type Obj = Record<string, any>;
type Actor = {name:string;level:number};
const NS='hospitalwork-v2',STATES=['접수','방문예정','처리중','결과확인','완료','보류','취소'];
const key=(...parts:any[])=>[NS,...parts];
const copy=(v:any)=>JSON.parse(JSON.stringify(v));
const text=(v:any,max:number,label:string)=>{const s=String(v??'').trim();if(s.length>max)throw new Error(label+'은 '+max+'자 이하로 입력하세요.');return s;};
const live=(r:Obj)=>!r.deletedAt;
const active=(r:Obj)=>live(r)&&!['완료','취소'].includes(r.status);
const kind=(s:Obj)=>['A/S','점검'].includes(s.gubun);
const clash=(current:Obj)=>({success:false,conflict:true,current,error:'다른 사용자가 수정했습니다. 최신 내용과 입력 내용을 비교하세요.'});
function datetime(v:any,required:boolean,label:string){
 const s=String(v||'');if(!s&&!required)return '';
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s))throw new Error(label+' 날짜와 시간을 확인하세요.');
 const d=new Date(s+':00+09:00');
 if(!Number.isFinite(+d)||new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d).replace(' ','T')!==s)throw new Error(label+' 날짜가 올바르지 않습니다.');return s;
}
async function hash(v:any){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v))))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function bounded(v:any){if(new TextEncoder().encode(JSON.stringify(v)).length>48000)throw new Error('기록이 너무 큽니다. 내용을 줄여주세요.');return v;}

export function createWorkStore(kv:any){
 async function get(...parts:any[]){return kv.get(key(...parts));}
 async function values(parts:any[],options:Obj={}){const out:Obj[]=[];for await(const e of kv.list({prefix:key(...parts)},options))out.push(e.value);return out;}
 async function status(){return (await get('meta')).value||{ready:false,seq:0};}
 async function refs(){return (await get('refs')).value;}
 async function access(who:Actor){const r=await refs();if(!r||!who.name||who.level<(Number(r.minimumLevel)||1))throw new Error('업무관리 접근 권한이 없거나 기준 정보가 준비되지 않았습니다.');return r;}
 async function request(id:any,deleted=false){const e=await get('request',String(id));if(!e.value)throw new Error('요청을 찾지 못했습니다.');if(!deleted&&!live(e.value)){const x:any=new Error('삭제된 접수입니다. 동기화하거나 휴지통에서 복원하세요.');x.deleted=true;x.current=e.value;throw x;}return e;}
 async function hospitalRequests(id:string){return values(['hospital',id]);}
 async function history(id:string){return values(['history',id]);}
 async function sources(name:string){return values(['source',name]);}
 async function mutate(p:Obj,who:Actor,build:any){
  const op=text(p.operationId,90,'저장 식별자');if(!/^[A-Za-z0-9_-]{8,90}$/.test(op))throw new Error('저장 식별자가 없습니다. 다시 시도하세요.');
  const clean={...p};delete clean.token;delete clean.__ua;
  const fingerprint=await hash({actor:who.name,payload:clean});
  for(let attempt=0;attempt<12;attempt++){
   const previous=await get('operation',op);
   if(previous.value){
    const old=previous.value;if(old.actor!==who.name||!(old.fingerprint===fingerprint||(old.legacy&&old.fingerprint===fingerprint.slice(0,24))))throw new Error('같은 저장 식별자에 다른 내용이 전달되었습니다.');return copy(old.response);
   }
   const meta=await get('meta');if(!meta.value?.ready)throw new Error('업무 데이터 전환 중입니다. 잠시 후 다시 시도하세요.');
   const ev=await build();if(ev.response?.success===false)return ev.response;
   const seq=Number(meta.value.seq||0)+1,now=new Date().toISOString();
   const checks=ev.checks||[];delete ev.checks;
   ev.id=op;ev.seq=seq;ev.actor=who.name;ev.at=now;bounded(ev);
   const response=copy({...ev.response,event:{id:ev.id,kind:ev.kind,at:ev.at,actor:ev.actor,before:ev.before,requestBefore:ev.requestBefore,after:ev.history||ev.request},storage:'kv',mirrorPending:true});
   let tx=kv.atomic().check(meta,previous).set(key('meta'),{...meta.value,seq})
    .set(key('operation',op),bounded({actor:who.name,fingerprint,response}))
    .set(key('change',seq),{seq,request:ev.request})
    .set(key('audit',ev.request.id,seq),ev)
    .set(key('outbox',seq),ev)
    .set(key('request',ev.request.id),ev.request)
    .set(key('hospital',ev.request.hospitalId,ev.request.id),ev.request);
   if(ev.history)tx=tx.set(key('history',ev.history.requestId,ev.history.id),ev.history);
   if(ev.link)tx=tx.set(key('link',ev.link),{requestId:ev.request.id,historyId:ev.history.id});
   if(ev.hospital)tx=tx.set(key('hospitalRef',ev.hospital.key),ev.hospital);
   if(checks.length)tx=tx.check(...checks);
   if(ev.before?.hospitalId&&ev.before.hospitalId!==ev.request.hospitalId)tx=tx.delete(key('hospital',ev.before.hospitalId,ev.request.id));
   if((await tx.commit()).ok)return response;
  }
  const e:any=new Error('다른 저장과 겹쳤습니다. 같은 기록으로 다시 시도하세요.');e.retrySameOperation=true;throw e;
 }
 async function save(p:Obj,who:Actor){return mutate(p,who,async()=>{
  const original=p.id?await request(p.id):null,old=original?.value;
  if(old&&String(old.revision)!==String(p.baseRevision))return {response:clash(old)};
  const f=p.form||{},h=(await get('hospitalRef',text(f.hospitalKey,500,'병원'))).value,reference=await refs();
  if(!h)throw new Error('병원 원본 목록에 없습니다. 동기화한 뒤 다시 선택하세요.');
  const id=old?.id||crypto.randomUUID(),now=new Date().toISOString();
  const r:Obj={id,hospitalId:h.id,hospitalKey:h.key,hospitalName:h.name,sn:h.sn||'',region:h.region||'',symptom:text(f.symptom,4000,'접수 증상'),cs:text(f.cs,60,'CS 담당자'),engineer:text(f.engineer,60,'엔지니어'),sales:text(f.sales,60,'영업 담당자'),registeredAt:datetime(f.registeredAt,true,'등록일시'),visitAt:datetime(f.visitAt,false,'방문일시'),deadline:datetime(f.deadline,false,'마감'),status:String(f.status||'접수'),createdAt:old?.createdAt||now,createdBy:old?.createdBy||who.name,updatedAt:now,updatedBy:who.name,revision:(old?.revision||0)+1,latest:old?.latest||'',completedAt:old?.completedAt||'',completedBy:old?.completedBy||'',gubun:old?.gubun||''};
  if(!r.symptom||!r.cs)throw new Error('접수 증상과 CS 담당자를 입력하세요.');
  if(!STATES.includes(r.status))throw new Error('알 수 없는 상태입니다.');
  if(r.status==='완료'&&old?.status!=='완료')throw new Error('처리 결과를 등록한 뒤 완료하세요.');
  if(['방문예정','처리중'].includes(r.status)&&(!r.visitAt||!r.engineer))throw new Error('방문 일시와 엔지니어가 필요합니다.');
  if(r.engineer&&!reference.engineers.includes(r.engineer)&&r.engineer!==old?.engineer)throw new Error('엔지니어 원본 목록에 없습니다. 동기화하세요.');
  if(old&&old.hospitalId!==h.id&&(await history(id)).length)throw new Error('이력이 있는 요청의 병원은 변경할 수 없습니다. 새 요청을 등록하세요.');
  const all=await values(['request']),duplicates=all.filter(x=>x.id!==id&&active(x)&&x.hospitalId===r.hospitalId),overlaps=all.filter(x=>x.id!==id&&active(x)&&r.engineer&&r.visitAt&&x.engineer===r.engineer&&x.visitAt===r.visitAt);
  if((duplicates.length||overlaps.length)&&!p.acknowledgeDuplicates)return {response:{success:false,duplicate:true,candidates:duplicates,overlaps,error:'진행 중인 요청 또는 같은 엔지니어의 동일 방문 일시가 있습니다. 확인 후 저장하세요.'}};
  return {kind:old?'request_update':'request_create',before:old||null,request:r,hospital:h,response:{success:true,request:r}};
 });}
 async function comment(p:Obj,who:Actor){return mutate(p,who,async()=>{
  const r=copy((await request(p.requestId)).value),old=p.historyId?(await get('history',r.id,String(p.historyId))).value:null;
  if(p.historyId&&(!old||old.kind!=='comment'))throw new Error('댓글을 찾지 못했습니다.');
  if(old&&old.author!==who.name&&who.level<3)throw new Error('본인 댓글 또는 관리자만 수정할 수 있습니다.');
  if(old&&String(old.revision)!==String(p.baseHistoryRevision))return {response:clash(old)};
  const body=text(p.body,4000,'댓글');if(!body)throw new Error('댓글을 입력하세요.');const now=new Date().toISOString(),before=copy(r);
  const h={id:old?.id||crypto.randomUUID(),requestId:r.id,kind:'comment',body,author:old?.author||who.name,createdAt:old?.createdAt||now,updatedAt:now,updatedBy:who.name,revision:(old?.revision||0)+1};
  r.revision++;r.updatedAt=now;r.updatedBy=who.name;r.latest=body.slice(0,120);
  return {kind:old?'comment_update':'comment_add',before:old||null,requestBefore:before,request:r,history:h,response:{success:true,request:r,history:h}};
 });}
 async function result(p:Obj,who:Actor,automatic=false){return mutate(p,who,async()=>{
  const r=copy((await request(p.requestId)).value);
  if(String(r.revision)!==String(p.baseRevision))return {response:clash(r)};
  const src=await get('source',r.hospitalName,String(p.recordId)),s=src.value;
  if(!s||!kind(s))throw new Error('A/S 또는 점검 기록을 선택하세요.');
  if(s.version!==p.sourceVersion)throw new Error('Handover 원본이 바뀌었습니다. 다시 불러와 확인하세요.');
  const linked=await get('link',s.recordId);
  if(automatic){
   const day=r.visitAt?.slice(0,10),same=(await values(['request'])).filter(x=>live(x)&&x.status!=='취소'&&x.hospitalName===r.hospitalName&&x.visitAt?.slice(0,10)===day);
   const matches=(await sources(r.hospitalName)).filter(x=>x.date===day&&kind(x));
   if(!['접수','방문예정','처리중'].includes(r.status)||same.length!==1||matches.length!==1||!s.result||(r.sn&&s.sn&&r.sn!==s.sn)||(await history(r.id)).some(h=>h.kind==='result')||linked.value)return {response:{success:false,skipped:true}};
  }
  if(linked.value&&linked.value.requestId!==r.id)throw new Error('이 결과는 다른 접수에 연결되어 있습니다. 해당 접수를 먼저 확인하세요.');
  const old=linked.value?(await get('history',r.id,linked.value.historyId)).value:null;
  if(old&&String(old.revision)!==String(p.baseHistoryRevision||0))return {response:clash(old)};
  const now=new Date().toISOString(),before=copy(r),h={id:old?.id||crypto.randomUUID(),requestId:r.id,kind:'result',source:s,body:s.detail||'',memo:automatic?old?.memo||'':text(p.memo,2000,'보완 메모'),auto:automatic||old?.auto||false,author:old?.author||who.name,createdAt:old?.createdAt||now,updatedAt:now,updatedBy:who.name,revision:(old?.revision||0)+1};
  r.revision++;r.updatedAt=now;r.updatedBy=who.name;r.latest=s.result||s.detail?.slice(0,120)||'';r.gubun=s.gubun;
  r.status=p.complete||r.status==='완료'?'완료':'결과확인';
  if(p.complete){r.completedAt=r.completedAt||now;r.completedBy=r.completedBy||who.name;}
  return {kind:automatic?'result_auto':'result_save',before:old||null,requestBefore:before,request:r,history:h,link:s.recordId,checks:[src,linked],response:{success:true,request:r,history:h}};
 });}
 async function lifecycle(p:Obj,who:Actor){return mutate(p,who,async()=>{
  const r=copy((await request(p.requestId,p.action==='work_restore')).value);
  if(String(r.revision)!==String(p.baseRevision))return {response:clash(r)};
  const before=copy(r),now=new Date().toISOString();
  if(p.action==='work_complete'){
   const results=(await history(r.id)).filter(h=>h.kind==='result');
   if(!results.some(h=>h.source?.result||h.source?.detail))throw new Error('처리 결과를 등록한 뒤 완료하세요.');
   r.status='완료';r.completedAt=r.completedAt||now;r.completedBy=r.completedBy||who.name;
  }else{
   if(who.level<3&&r.createdBy!==who.name)throw new Error('접수 등록자 또는 관리자만 삭제·복원할 수 있습니다.');
   if(p.action==='work_restore'){
    if(!r.deletedAt)throw new Error('휴지통에 있는 접수가 아닙니다.');
    r.deletedAt='';r.deletedBy='';r.restoredAt=now;r.restoredBy=who.name;
    const others=(await values(['request'])).filter(x=>x.id!==r.id&&active(x));
    const candidates=others.filter(x=>x.hospitalId===r.hospitalId),overlaps=others.filter(x=>r.engineer&&r.visitAt&&x.engineer===r.engineer&&x.visitAt===r.visitAt);
    if((candidates.length||overlaps.length)&&!p.acknowledgeDuplicates)return {response:{success:false,duplicate:true,candidates,overlaps,error:'복원하면 진행 중인 요청 또는 방문 일정과 겹칩니다. 확인 후 복원하세요.'}};
   }else{r.deletedAt=now;r.deletedBy=who.name;}
  }
  r.revision++;r.updatedAt=now;r.updatedBy=who.name;
  return {kind:p.action.slice(5),before,request:r,response:{success:true,request:r}};
 });}
 async function detail(p:Obj){
  const e=await request(p.id,true),r=e.value;
  const limit=100,his=kv.list({prefix:key('history',r.id)},{limit,cursor:p.historyCursor||undefined}),audit=kv.list({prefix:key('audit',r.id)},{limit,cursor:p.auditCursor||undefined,reverse:true});
  const hs:Obj[]=[],logs:Obj[]=[];for await(const x of his)hs.push(x.value);for await(const x of audit){const ev=x.value;logs.push({id:ev.id,kind:ev.kind,at:ev.at||ev.request.updatedAt,actor:ev.actor||ev.request.updatedBy,before:ev.before,requestBefore:ev.requestBefore,after:ev.history||ev.request});}
  logs.reverse();const ref=await refs();
  return {success:true,request:r,history:hs,logs,requests:(await hospitalRequests(r.hospitalId)).filter(live),historyCursor:hs.length===limit?his.cursor:null,auditCursor:logs.length===limit?audit.cursor:null,updatedAt:new Date().toISOString(),sourceCheckedAt:ref?.sourceCheckedAt||'',storage:'kv'};
 }
 async function bootstrap(p:Obj,who:Actor){
  const meta=await status(),reference=await refs(),it=kv.list({prefix:key('request')},{limit:200,cursor:p.pageCursor||undefined}),requests:Obj[]=[];
  for await(const e of it)requests.push(e.value);
  return {success:true,storage:'kv',requests,revision:String(p.snapshotSeq??meta.seq),pageCursor:requests.length===200?it.cursor:null,hospitals:await values(['hospitalRef']),engineers:reference.engineers,who,referencesIncluded:true,updatedAt:new Date().toISOString(),sourceCheckedAt:reference.sourceCheckedAt||''};
 }
 async function sync(p:Obj){
  const meta=await status(),after=Number(p.revision||0);if(!Number.isSafeInteger(after)||after<0||after>meta.seq)throw new Error('동기화 기준이 잘못됐습니다. 전체 동기화를 실행하세요.');
  const rows:Obj[]=[],it=kv.list({start:key('change',after+1),end:key('change',meta.seq+1)},{limit:100});for await(const e of it)rows.push(e.value);
  const map=new Map();rows.forEach(x=>map.set(x.request.id,x.request));const revision=rows.length?rows.at(-1)!.seq:after,reference=await refs();
  return {success:true,storage:'kv',requests:[...map.values()],revision:String(revision),nochange:!rows.length,more:revision<meta.seq,hospitals:await values(['hospitalRef']),engineers:reference.engineers,updatedAt:new Date().toISOString(),sourceCheckedAt:reference.sourceCheckedAt||''};
 }
 async function handle(p:Obj,who:Actor){
  try{
   await access(who);if(!(await status()).ready)throw new Error('업무 데이터 전환 중입니다.');
   switch(p.action){
    case 'work_bootstrap':return await bootstrap(p,who);
    case 'work_sync':return await sync(p);
    case 'work_detail':return await detail(p);
    case 'work_save':return await save(p,who);
    case 'work_history_add':case 'work_history_update':return await comment(p,who);
    case 'work_result_save':return await result(p,who);
    case 'work_complete':case 'work_delete':case 'work_restore':return await lifecycle(p,who);
    default:throw new Error('지원하지 않는 업무 API입니다.');
   }
  }catch(e:any){return {success:false,error:e.message||'업무 처리 실패',retrySameOperation:!!e.retrySameOperation,deleted:!!e.deleted,current:e.current};}
 }
 async function ingestSources(items:Obj[],checkedAt=new Date().toISOString()){
  for(const s of items){if(!s.recordId||!s.hospitalName||!kind(s)||s.recordId.startsWith('legacy_'))continue;for(let tries=0;tries<12;tries++){
   const old=await get('source',s.hospitalName,s.recordId),meta=await get('meta');
   if(old.value?.observedAt&&(!s.observedAt||old.value.observedAt>s.observedAt))break;
   // Source changes invalidate in-flight automatic matching as well as older source deliveries.
   if((await kv.atomic().check(old,meta).set(old.key,bounded(s)).set(meta.key,{...(meta.value||{ready:false,seq:0}),sourceGeneration:Number(meta.value?.sourceGeneration||0)+1}).commit()).ok)break;
   if(tries===11)throw new Error('원본 전달이 겹쳤습니다. 다시 연동하세요.');
  }}
  const r=await get('refs');if(r.value)await kv.set(key('refs'),{...r.value,sourceCheckedAt:checkedAt});
  const meta=await status();if(!meta.ready)return {linked:0,skipped:[]};
  const all=await values(['request']);let linked=0;const skipped:Obj[]=[];
  for(const r of all){
   if(!live(r)||!['접수','방문예정','처리중'].includes(r.status)||!r.visitAt)continue;
   const day=r.visitAt.slice(0,10),same=all.filter(x=>live(x)&&x.status!=='취소'&&x.hospitalName===r.hospitalName&&x.visitAt?.slice(0,10)===day);
   const matches=(await sources(r.hospitalName)).filter(s=>s.date===day&&kind(s));
   if(!matches.length)continue;
   if(same.length!==1||matches.length!==1){skipped.push({requestId:r.id,reason:'ambiguous'});continue;}
   const s=matches[0],hs=(await history(r.id)).filter(h=>h.kind==='result');
   if(!s.result||(r.sn&&s.sn&&r.sn!==s.sn)||hs.length||(await get('link',s.recordId)).value)continue;
   const p={action:'work_auto_result',requestId:r.id,recordId:s.recordId,sourceVersion:s.version,baseRevision:r.revision,operationId:'auto_'+await hash([r.id,s.recordId,s.version,r.revision])};
   const response=await result(p,{name:'Handover 자동 연결',level:0},true);if(response.success)linked++;
  }
  return {linked,skipped};
 }
 async function seed(p:Obj){
  if((await status()).ready)throw new Error('활성화된 KV에는 기존 시트를 다시 가져올 수 없습니다.');
  for(const r of p.requests||[]){bounded(r);await kv.atomic().set(key('request',r.id),r).set(key('hospital',r.hospitalId,r.id),r).commit();}
  for(const h of p.history||[]){let tx=kv.atomic().set(key('history',h.requestId,h.id),bounded(h));if(h.kind==='result')tx=tx.set(key('link',h.source.recordId),{requestId:h.requestId,historyId:h.id});await tx.commit();}
  for(const op of p.operations||[]){if(op.state!=='committed')throw new Error('미완료 GAS 저널이 있습니다.');await kv.set(key('operation',op.id),bounded({actor:op.actor,fingerprint:op.fingerprint,legacy:true,response:op.response}));if(op.event?.request)await kv.set(key('audit',op.event.request.id,-1e15+Date.parse(op.createdAt),op.id),bounded({...op.event,actor:op.actor,at:op.createdAt}));}
  for(const h of p.hospitals||[])await kv.set(key('hospitalRef',h.key),bounded(h));
  if(p.references)await kv.set(key('refs'),bounded(p.references));
  await kv.set(key('meta'),{ready:false,seq:0,migrationId:p.migrationId||''});
  return {success:true};
 }
 async function manifest(){const tables:Obj={requests:await values(['request']),history:[],operations:[]};for await(const e of kv.list({prefix:key('history')}))tables.history.push(e.value);for await(const e of kv.list({prefix:key('operation')}))tables.operations.push({id:e.key.at(-1),actor:e.value.actor,fingerprint:e.value.fingerprint,response:e.value.response});const out:Obj={};for(const [name,rows]of Object.entries(tables)){const sorted=(rows as Obj[]).sort((a,b)=>String(a.id).localeCompare(String(b.id),'en'));out[name]={count:sorted.length,hash:await hash(sorted)};}return out;}
 async function bridge(verb:string,p:Obj){
  if(verb==='status')return {success:true,...await status(),manifest:await manifest()};
  if(verb==='seed')return seed(p);
  if(verb==='activate'){
   const state=await get('meta');if(state.value?.ready)return {success:true,ready:true};
   const actual=await manifest();if(JSON.stringify(actual)!==JSON.stringify(p.manifest))throw new Error('이전 데이터 검증 결과가 다릅니다. 활성화를 중단했습니다.');
   if(!(await refs()))throw new Error('기준 정보 없음');
   if(!(await kv.atomic().check(state).set(key('meta'),{...state.value,ready:true,seq:0,activatedAt:new Date().toISOString()}).commit()).ok)throw new Error('전환 상태가 변경되었습니다.');return {success:true,ready:true};
  }
  if(verb==='references'){
   const old=await values(['hospitalRef']);for(const h of p.hospitals||[])await kv.set(key('hospitalRef',h.key),bounded(h));
   const keep=new Set((p.hospitals||[]).map((h:Obj)=>h.key));for(const h of old)if(!keep.has(h.key))await kv.delete(key('hospitalRef',h.key));
   const current=await refs();await kv.set(key('refs'),bounded({...current,...p.references}));return {success:true};
  }
  if(verb==='sources')return {success:true,...await ingestSources(p.sources||[])};
  if(verb==='pending'){const rows=await values(['outbox'],{limit:21});return {success:true,events:rows.slice(0,20),more:rows.length>20,seq:(await status()).seq};}
  if(verb==='ack'){
   for(const item of p.items||[]){const e=await get('outbox',Number(item.seq));if(e.value?.id===item.id)await kv.atomic().check(e).delete(e.key).commit();}
   return {success:true};
  }
  throw new Error('지원하지 않는 연동 작업입니다.');
 }
 return {handle,status,bridge,manifest,ingestSources,sources,request,checkAccess:access,NS};
}
