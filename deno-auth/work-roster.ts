// Date/person assignments are separate from service requests and Handover results.
type Obj = Record<string, any>;
type Actor = {name:string;level:number};
const key=(...parts:any[])=>['hospitalwork-v2',...parts];
const clone=(v:any)=>JSON.parse(JSON.stringify(v));
export function rosterMonth(v:any){
 const month=String(v||new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).format(new Date()));
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||Number(month.slice(0,4))<2000||Number(month.slice(0,4))>2199)throw new Error('근무 일정의 월을 확인하세요.');return month;
}
async function hash(v:any){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v))))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export function createWorkRoster(kv:any){
 async function read(v:any){
  const month=rosterMonth(v);
  for(let i=0;i<4;i++){
   const before=await kv.get(key('rosterMonth',month)),roster:Obj[]=[];
   for await(const e of kv.list({prefix:key('roster',month)}))roster.push(e.value);
   const after=await kv.get(key('rosterMonth',month));
   if(before.versionstamp===after.versionstamp)return {success:true,storage:'kv',rosterMonth:month,roster,rosterRevision:Number(after.value?.revision||0)};
  }
  throw new Error('근무 일정이 변경 중입니다. 동기화를 다시 실행하세요.');
 }
 async function save(p:Obj,who:Actor){
  const date=String(p.date||''),month=rosterMonth(date.slice(0,7)),person=String(p.person||'').trim().normalize('NFC'),type=String(p.type||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(+new Date(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new Error('근무 날짜를 확인하세요.');
  if(!person||person.length>60||/[\u0000-\u001f\u007f]/.test(person))throw new Error('근무자 이름은 1~60자로 입력하세요.');
  const removing=p.action==='work_roster_delete';if(!removing&&!['휴무','당직'].includes(type))throw new Error('휴무 또는 당직을 선택하세요.');
  if(!Number.isSafeInteger(Number(p.baseRevision))||Number(p.baseRevision)<0)throw new Error('근무 일정 버전을 확인하세요.');
  const op=String(p.operationId||'');if(!/^[A-Za-z0-9_-]{8,90}$/.test(op))throw new Error('저장 식별자가 없습니다. 다시 시도하세요.');
  const clean={...p};delete clean.token;delete clean.__ua;
  const fingerprint=await hash({actor:who.name,payload:clean}),id=await hash([date,person]);
  for(let attempt=0;attempt<12;attempt++){
   const previous=await kv.get(key('rosterOperation',op));
   if(previous.value){if(previous.value.actor!==who.name||previous.value.fingerprint!==fingerprint)throw new Error('같은 저장 식별자에 다른 내용이 전달되었습니다.');return clone(previous.value.response);}
   const original=await kv.get(key('roster',month,id)),old=original.value,meta=await kv.get(key('rosterMonth',month));
   if(Number(old?.revision||0)!==Number(p.baseRevision))return {success:false,conflict:true,current:old,error:'다른 PC에서 근무 일정을 수정했습니다. 일정 새로고침 후 내용을 확인하세요.'};
   if(removing&&(!old||old.deletedAt))throw new Error('삭제할 근무 일정이 없습니다.');
   if(!old&&Number(meta.value?.count||0)>=500)throw new Error('한 달에 최대 500개 근무 일정을 등록할 수 있습니다.');
   const now=new Date().toISOString(),schedule={id,date,person,type:removing?old.type:type,revision:Number(old?.revision||0)+1,createdAt:old?.createdAt||now,createdBy:old?.createdBy||who.name,updatedAt:now,updatedBy:who.name,deletedAt:removing?now:''};
   const response={success:true,storage:'kv',rosterMonth:month,schedule},audit={before:old||null,after:schedule,actor:who.name,at:now,operationId:op};
   const tx=kv.atomic().check(previous,original,meta).set(key('roster',month,id),schedule)
    .set(key('rosterMonth',month),{revision:Number(meta.value?.revision||0)+1,count:Number(meta.value?.count||0)+(old?0:1)})
    .set(key('rosterOperation',op),{actor:who.name,fingerprint,response}).set(key('rosterAudit',month,id,schedule.revision),audit);
   if((await tx.commit()).ok)return response;
  }
  const e:any=new Error('다른 저장과 겹쳤습니다. 같은 기록으로 다시 시도하세요.');e.retrySameOperation=true;throw e;
 }
 return {read,save};
}
