// Derived lookup keys only. The request remains the authoritative record.
type Obj=Record<string,any>;
const NS='hospitalwork-v2',key=(...p:any[])=>[NS,...p],stateKey=key('queryIndex','state');
const live=(r:Obj)=>!r.deletedAt&&!r.purgedAt;
export function requestIndexKeys(r:Obj|null){
 const keys:any[][]=[];if(!r?.id||!live(r))return keys;
 if(!['완료','취소'].includes(r.status)){
  keys.push(key('queryIndex','hospital',r.hospitalId,r.id));
  if(r.engineer&&r.visitAt)keys.push(key('queryIndex','appointment',r.engineer,r.visitAt,r.id));
 }
 if(r.status!=='취소'&&r.hospitalName&&r.visitAt)keys.push(key('queryIndex','visit',r.hospitalName,r.visitAt.slice(0,10),r.id));
 return keys;
}
export function updateRequestIndexes(tx:any,previous:Obj|null,next:Obj){
 const keys=requestIndexKeys(next),keep=new Set(keys.map(k=>JSON.stringify(k)));
 for(const k of requestIndexKeys(previous))if(!keep.has(JSON.stringify(k)))tx=tx.delete(k);
 for(const k of keys)tx=tx.set(k,{id:next.id});
 return tx;
}
export function createWorkIndexes(kv:any){
 async function ready(){const [state,meta]=await Promise.all([kv.get(stateKey),kv.get(key('meta'))]);return state.value?.ready===true&&state.value.seq===meta.value?.seq;}
 async function write(tx:any,oldSeq:number,newSeq:number){
  const state=await kv.get(stateKey),old=state.value;
  // A rolled-back older writer advances the request sequence without updating
  // this marker. Fall back and rebuild, rather than trusting incomplete keys.
  const gap=old&&old.writeSeq!==oldSeq;
  const next=gap||!old?{v:1,ready:false,cursor:'',scanned:0}:old;
  return tx.check(state).set(stateKey,{...next,writeSeq:newSeq,...(next.ready?{seq:newSeq}:{})});
 }
 async function invalidate(){await kv.set(stateKey,{v:1,ready:false,cursor:'',scanned:0});}
 async function prepare(){
  // Each batch is resumable and checks both request versions and the cursor.
  // Do not hold a large atomic operation or mark a partial scan as complete.
  for(let batch=0;batch<4;batch++){
   const [state,meta]=await Promise.all([kv.get(stateKey),kv.get(key('meta'))]);if(state.value?.ready&&state.value.seq===meta.value?.seq)return {success:true,...state.value};
   const gap=state.value&&state.value.writeSeq!==meta.value?.seq;
   const previous=gap?{cursor:'',scanned:0}:state.value;
   const it=kv.list({prefix:key('request')},{limit:32,cursor:previous?.cursor||undefined}),rows:any[]=[];
   for await(const entry of it)rows.push(entry);
   let tx=kv.atomic().check(state,meta);
   for(const entry of rows){tx=tx.check(entry);for(const k of requestIndexKeys(entry.value))tx=tx.set(k,{id:entry.value.id});}
   const complete=rows.length<32,next={v:1,ready:complete,cursor:complete?'':it.cursor,scanned:Number(previous?.scanned||0)+rows.length,writeSeq:meta.value?.seq||0,...(complete?{seq:meta.value?.seq||0}:{})};
   if((await tx.set(stateKey,next).commit()).ok){if(complete)return {success:true,...next};}
   else return {success:true,ready:false,retry:true,scanned:Number(state.value?.scanned||0)};
  }
  return {success:true,...(await kv.get(stateKey)).value};
 }
 async function read(parts:any[]){
  const rows:Obj[]=[];
  for await(const entry of kv.list({prefix:key('queryIndex',...parts)})){
   const r=(await kv.get(key('request',entry.value.id))).value;
   if(r&&requestIndexKeys(r).some(k=>JSON.stringify(k)===JSON.stringify(entry.key)))rows.push(r);
  }
  return rows;
 }
 async function conflicts(r:Obj){
  const [hospital,appointments]=await Promise.all([read(['hospital',r.hospitalId]),r.engineer&&r.visitAt?read(['appointment',r.engineer,r.visitAt]):Promise.resolve([])]);
  return {duplicates:hospital.filter(x=>x.id!==r.id),overlaps:appointments.filter(x=>x.id!==r.id)};
 }
 return {ready,write,invalidate,prepare,conflicts,visits:(name:string,date:string)=>read(['visit',name,date])};
}
