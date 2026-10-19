// Compact, revision-bound projection of PDF comments; no audit/source bodies leave this read.
type Obj=Record<string,any>;
const NS='hospitalwork-v2',key=(...p:any[])=>[NS,...p];
export function createInspectionLinks(kv:any){
 async function one(id:string){
  for(let attempt=0;attempt<2;attempt++){
   const r=await kv.get(key('request',id));
   if(!r.value||r.value.purgedAt)return {requestId:id,revision:r.value?.revision||0,attachment:null};
   const cached=await kv.get(key('inspectionLinks',id));
   if(cached.value?.revision===r.value.revision)return cached.value;
   let latest:Obj|null=null;
   for await(const entry of kv.list({prefix:key('history',id)})){
    const h=entry.value,a=h.attachment;
    if(h.deletedAt||h.kind!=='comment'||a?.kind!=='inspection_pdf'||!/^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/view(?:\?resourcekey=[A-Za-z0-9_-]+)?$/.test(String(a.url||'')))continue;
    const at=String(h.updatedAt||h.createdAt||'');
    if(!latest||at>latest.at||at===latest.at&&String(h.id)>latest.historyId)latest={at,historyId:h.id,attachment:{kind:a.kind,url:a.url,filename:a.filename||'',uploadedAt:a.uploadedAt||''}};
   }
   const value={requestId:id,revision:r.value.revision,attachment:latest?.attachment||null};
   if((await kv.atomic().check(r,cached).set(key('inspectionLinks',id),value,{expireIn:7*86400000}).commit()).ok)return value;
  }
  throw new Error('내역서가 변경되었습니다. 다시 확인해 주세요.');
 }
 return async function(p:Obj){
  if(!Array.isArray(p.requestIds)||!p.requestIds.length||p.requestIds.length>50||p.requestIds.some((id:any)=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,90}$/.test(id)))throw new Error('내역서를 조회할 접수를 확인하세요. 최대 50건까지 가능합니다.');
  const ids=[...new Set(p.requestIds)] as string[],rows:Obj[]=new Array(ids.length);let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,ids.length)},async()=>{for(;;){const i=cursor++;if(i>=ids.length)return;rows[i]=await one(ids[i]);}}));
  return {success:true,items:rows};
 };
}
