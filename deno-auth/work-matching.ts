// Durable, bounded visit matching. These are worker jobs, never editor locks.
type Obj=Record<string,any>;
const key=(...p:any[])=>['hospitalwork-v2',...p];
export function createWorkMatching(kv:any){
 function enqueue(tx:any,rows:Obj[]){
  const visits=new Map<string,Obj>();
  for(const r of rows){
   const name=r?.hospitalName,date=String(r?.visitAt||r?.date||'').slice(0,10);
   if(name&&/^\d{4}-\d{2}-\d{2}$/.test(date))visits.set(JSON.stringify([name,date]),{hospitalName:name,date});
  }
  for(const visit of visits.values()){
   const token=crypto.randomUUID(),due=Date.now(),job={...visit,token,due,attempts:0};
   tx=tx.set(key('matchPending',visit.hospitalName,visit.date),job).set(key('matchDue',due,token),visit);
  }
  return tx;
 }
 async function backfill(){
  // Preserve old requests and old pending events. Seed once in resumable pages;
  // this scan belongs to the worker, never bootstrap/sync/detail.
  const state=await kv.get(key('matchBackfill'));
  if(state.value?.complete)return;
  const it=kv.list({prefix:key('request')},{limit:16,cursor:state.value?.cursor||undefined}),rows:any[]=[];
  for await(const row of it)rows.push(row);
  let tx=kv.atomic().check(state,...rows);
  tx=enqueue(tx,rows.map(e=>e.value).filter(r=>!r.deletedAt&&!r.purgedAt));
  await tx.set(state.key,{cursor:it.cursor,complete:rows.length<16}).commit();
 }
 async function process(run:(name:string,date:string)=>Promise<Obj>,limit=20){
  let linked=0,processed=0,failed=0;const skipped:Obj[]=[];
  const now=Date.now();
  // Old due pointers are harmless. A token and version check prevent a late
  // worker from acknowledging a newer request/source event for this visit.
  for await(const due of kv.list({start:key('matchDue',0),end:key('matchDue',now+1)},{limit:limit*3})){
   const visit=due.value,job=await kv.get(key('matchPending',visit.hospitalName,visit.date));
   if(!job.value||job.value.token!==due.key.at(-1)){
    await kv.atomic().check(due,job).delete(due.key).commit();continue;
   }
   try{
    const result=await run(visit.hospitalName,visit.date);
    linked+=result.linked||0;skipped.push(...(result.skipped||[]));
    await kv.atomic().check(due,job).delete(due.key).delete(job.key).commit();
   }catch{
    const attempts=Number(job.value.attempts||0)+1,at=Date.now()+Math.min(300000,1000*2**Math.min(attempts,8));
    await kv.atomic().check(due,job).delete(due.key)
     .set(job.key,{...job.value,due:at,attempts,errorCode:'MATCH_RETRY'})
     .set(key('matchDue',at,job.value.token),visit).commit();failed++;
   }
   if(++processed>=limit)break;
  }
  return {linked,skipped,processed,failed};
 }
 return {enqueue,backfill,process};
}
