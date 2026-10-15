import {createWorkStore} from '../deno-auth/work-store.ts';
function assert(value:unknown,message:string){if(!value)throw new Error(message);}
Deno.test('real KV: atomic matching jobs, source-first recovery and pure delta reads',async()=>{
 const kv=await Deno.openKv(':memory:');
 try{
  const store=createWorkStore(kv),who={name:'fixture',level:3};
  await store.bridge('seed',{hospitals:[{id:'h',key:'h',name:'fixture',sn:'SN'}],references:{minimumLevel:1,engineers:[]}});
  await store.bridge('activate',{manifest:await store.manifest()});
  const empty=await store.handle({action:'work_sync',revision:'0'},who);assert(empty.success&&empty.nochange,'empty KV sync');
  await store.ingestSources([{recordId:'record',version:'v1',hospitalName:'fixture',date:'2026-10-16',gubun:'점검',sn:'SN',result:'정상',detail:'원문',observedAt:'2026-10-16T00:00:00Z'}]);
  const saved=await store.handle({action:'work_save',operationId:crypto.randomUUID(),form:{hospitalKey:'h',symptom:'점검',cs:'fixture',engineer:'',registeredAt:'2026-10-16T09:00',visitAt:'2026-10-16T12:00',status:'접수'}},who);
  assert(saved.success,'real atomic request/job transaction: '+JSON.stringify(saved));
  const current=createWorkStore(kv);
  await Promise.all([current.processPendingMatches(),createWorkStore(kv).processPendingMatches()]);
  await current.processPendingMatches();
  const d=await current.handle({action:'work_detail',id:saved.request.id},who);
  assert(d.history.length===1&&d.history[0].source.detail==='원문','concurrent workers link once');
  const seq=String((await current.status()).seq);
  const delta=await current.handle({action:'work_sync',revision:seq},who);
  assert(delta.nochange&&String((await current.status()).seq)===seq,'read does not run matching');
  const pending=[];for await(const e of kv.list({prefix:[current.NS,'matchPending']}))pending.push(e);
  assert(!pending.length,'worker receipts acknowledged');
 }finally{kv.close();}
});
