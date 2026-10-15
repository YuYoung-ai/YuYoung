// Local Deno KV benchmark. No network or production credentials.
import {createWorkStore} from '../deno-auth/work-store.ts';
const baselinePath=Deno.args[0];
const baseline=baselinePath?(await import(new URL(baselinePath,import.meta.url).href)).createWorkStore:null;
const who={name:'CS',level:3},NS='hospitalwork-v2';
const rows=[];
for(const n of [100,1000,10000])for(const [mode,make]of [['before',baseline],['after',createWorkStore]] as const){
 if(!make)continue;
 const kv=await Deno.openKv(':memory:');let scanned=0,gets=0;
 const wrapped={get:async(k:any)=>{gets++;return kv.get(k);},set:kv.set.bind(kv),delete:kv.delete.bind(kv),atomic:kv.atomic.bind(kv),list:(s:any,o:any)=>{const it=kv.list(s,o);return {get cursor(){return it.cursor;},async *[Symbol.asyncIterator](){for await(const e of it){scanned++;yield e;}}};}};
 await kv.set([NS,'meta'],{ready:true,seq:0});await kv.set([NS,'refs'],{engineers:['FSE'],minimumLevel:1});await kv.set([NS,'hospitalRef','target'],{id:'target',key:'target',name:'측정 병원',sales:'영업'});
 for(let at=0;at<n;at+=200){let tx=kv.atomic();for(let i=at;i<Math.min(n,at+200);i++){const r={id:'r'+String(i).padStart(6,'0'),hospitalId:i===0?'target':'h'+i,hospitalName:i===0?'측정 병원':'병원'+i,hospitalKey:i===0?'target':'h'+i,sn:'SN'+i,status:'접수',engineer:'FSE',visitAt:'2026-10-15T09:00',symptom:'측정',cs:'CS',sales:'영업',registeredAt:'2026-10-15T08:00',revision:1};tx=tx.set([NS,'request',r.id],r);}await tx.commit();}
 const store=make(wrapped);if(mode==='after'){while(!(await store.prepareIndexes()).ready){}}
 const samples=[],reads=[];
 for(let i=0;i<25;i++){scanned=0;gets=0;const begin=performance.now();const result=await store.handle({action:'work_save',operationId:crypto.randomUUID(),form:{hospitalKey:'target',symptom:'중복 점검',cs:'CS',sales:'영업',engineer:'FSE',registeredAt:'2026-10-15T10:00',visitAt:'2026-10-15T12:00',status:'접수'}},who);if(!result.duplicate||result.candidates.length!==1)throw new Error('conflict semantics changed');if(i>=5){samples.push(performance.now()-begin);reads.push(scanned+gets);}}
 samples.sort((a,b)=>a-b);rows.push({requests:n,mode,runs:samples.length,meanMs:+(samples.reduce((a,b)=>a+b,0)/samples.length).toFixed(2),p95Ms:+samples[Math.ceil(samples.length*.95)-1].toFixed(2),readRows:reads[0]});kv.close();
}
console.log(JSON.stringify({environment:'Deno local in-memory KV, 5 warm-up + 20 measured calls; includes duplicate check, excludes Google/network',rows},null,2));
