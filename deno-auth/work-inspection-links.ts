// Compact, revision-bound projection of PDF comments; no audit/source bodies leave this read.
type Obj=Record<string,any>;
const NS='hospitalwork-v2',key=(...p:any[])=>[NS,...p];
// Explicit result costs only; DB warranty, empty costs and narrative text are not confirmations.
export function resultPayment(cost:any){
 const value=String(cost??'').normalize('NFKC').trim();
 if(value==='유상')return 'paid';if(value==='무상')return 'free';
 const number=value.replace(/[,₩\s원]/g,'');
 return /^\d+(?:\.\d{1,2})?$/.test(number)?(Number(number)>0?'paid':'free'):'unknown';
}
export function createInspectionLinks(kv:any){
 async function one(id:string){
  for(let attempt=0;attempt<2;attempt++){
   const r=await kv.get(key('request',id));
   if(!r.value||r.value.purgedAt)return {requestId:id,revision:r.value?.revision||0,attachment:null};
   const cached=await kv.get(key('inspectionLinks',id));
   if(cached.value?.schema===2&&cached.value?.revision===r.value.revision)return cached.value;
   let latest:Obj|null=null;
   const results:Obj[]=[];
   for await(const entry of kv.list({prefix:key('history',id)})){
    const h=entry.value,a=h.attachment;
    if(!h.deletedAt&&h.kind==='result'&&h.source)results.push(h);
    if(h.deletedAt||h.kind!=='comment'||a?.kind!=='inspection_pdf'||!/^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/view(?:\?resourcekey=[A-Za-z0-9_-]+)?$/.test(String(a.url||'')))continue;
    const at=String(h.updatedAt||h.createdAt||'');
    if(!latest||at>latest.at||at===latest.at&&String(h.id)>latest.historyId)latest={at,historyId:h.id,attachment:{kind:a.kind,url:a.url,filename:a.filename||'',uploadedAt:a.uploadedAt||''}};
   }
   // A linked official result supersedes an imported copy of the same device/day.
   const current=results.filter(h=>h.source.origin!=='flow'||!h.source.sn||!results.some(other=>other.source.origin!=='flow'&&other.source.sn===h.source.sn&&other.source.date===h.source.date));
   const treatment=[...new Set(current.map(h=>[h.source.gubun,h.source.cat,h.source.type].filter(Boolean).join(' / ')).filter(Boolean))].join(' · ').slice(0,1200);
   const payments=current.map(h=>h.sourceReview?.pending?'unknown':resultPayment(h.source.cost));
   const payment=!payments.length||payments.includes('unknown')?'unknown':payments.includes('paid')?'paid':'free';
   const value={schema:2,requestId:id,revision:r.value.revision,attachment:latest?.attachment||null,treatment,payment};
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
