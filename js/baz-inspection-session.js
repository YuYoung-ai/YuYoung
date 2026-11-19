(function(root){
 'use strict';
 const PREFIX='insp_entry_v2:',TTL=10*60*1000;
 function owner(auth){
  try{const p=JSON.parse(atob(auth.token().split('.')[0].replace(/-/g,'+').replace(/_/g,'/')));if(/^[gp]:[A-Za-z0-9_-]{43}$/.test(p.u))return 'account:'+p.u;}catch{}
  return auth.name()?'staff:'+encodeURIComponent(auth.name()):'';
 }
 function nonce(){const b=crypto.getRandomValues(new Uint8Array(16));return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');}
 function intent(search){const p=new URLSearchParams(search);return p.has('entry')?{kind:'handover',entry:p.get('entry')}:p.get('prefill')==='1'?{kind:'handover',legacy:true}:p.has('request')||p.has('record')?{kind:'linked'}:{kind:'general'};}
 function write(storage,auth,payload){const entry=nonce(),key=PREFIX+entry;storage.setItem(key,JSON.stringify({...payload,v:2,entry,owner:owner(auth),createdAt:Date.now()}));return 'inspection.html?entry='+entry;}
 function read(storage,auth,target){
  if(!target.legacy&&!/^[a-f0-9]{32}$/.test(target.entry||''))throw new Error('이어쓰기 주소가 올바르지 않습니다. Handover에서 다시 열어 주세요.');
  const key=target.legacy?'insp_prefill_v1':PREFIX+target.entry,raw=storage.getItem(key);let p;
  try{p=JSON.parse(raw);}catch{}
  if(!p||!p.form||p.source!=='handover'||p.v!==(target.legacy?1:2))throw new Error('이어쓰기 자료가 없습니다. Handover에서 다시 열어 주세요.');
  if(!Number.isFinite(p.createdAt)||Date.now()-p.createdAt>TTL||p.createdAt>Date.now()+60000)throw new Error('이어쓰기 유효 시간이 지났습니다. Handover에서 다시 열어 주세요.');
  if(!target.legacy&&(p.entry!==target.entry||!p.owner||p.owner!==owner(auth)))throw new Error('이어쓰기 계정이 다릅니다. 저장한 계정으로 다시 열어 주세요.');
  if(!/^[A-Za-z0-9_-]{8,90}$/.test(p.form.handover?.recordId||'')||!p.form.basic?.hospital||!p.form.basic?.inspectDate)throw new Error('이어쓰기 원본 정보가 불완전합니다. Handover에서 다시 열어 주세요.');
  return {form:p.form,ack(){try{if(storage.getItem(key)===raw)storage.removeItem(key);}catch{}}};
 }
 function view(){let epoch=0;return {bump(){return ++epoch;},capture(){return epoch;},matches(value){return value===epoch;}};}
 function freeze(value){const copy=JSON.parse(JSON.stringify(value));function visit(v){if(v&&typeof v==='object'){Object.values(v).forEach(visit);Object.freeze(v);}return v;}return visit(copy);}
 async function basis(source,format){
  const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
  const fields={},names=['hospitalName','date','sn','engineer','gubun','cat','type','part','cost','detail','result','remark','nozzleReuse','nsFill','nsAmt','jet'];
  for(const name of names)fields[name]=await hash(String((name==='hospitalName'?source.sourceHospitalName||source.hospitalName:source[name])||'').replace(/\r\n?/g,'\n').trim());
  const relevant={},selected=format==='simplified'?'simplified':'standard',printed=['hospitalName','date','sn','gubun','cat','type','part','cost','detail','result','remark'];if(selected==='standard')printed.push('engineer');printed.forEach(name=>{relevant[name]=fields[name];});
  return {v:1,recordId:source.recordId,identity:{hospital:source.sourceHospitalName||source.hospitalName,date:source.date,sn:source.sn||''},fields,fingerprint:await hash(JSON.stringify(relevant)),capturedAt:new Date().toISOString(),format:selected,template:1};
 }
 function sourceReference(reference,receipt,basic,flow){
  if(!receipt||receipt.recordId!==reference.recordId||receipt.source?.recordId!==reference.recordId||
     !flow.sameInspectionIdentity(basic,receipt.source)||!receipt.version||
     !['standard','simplified'].every(format=>receipt.basis?.[format]?.format===format&&/^[a-f0-9]{64}$/.test(receipt.basis[format].fingerprint||'')))
   throw new Error('현재 병원·처리일·S/N의 PDF 원본 정보를 확인할 수 없습니다.');
  return {...reference,deliveryReceipt:receipt,sourceSnapshot:receipt.source,sourcePdfRevision:receipt.pdfRevision||0};
 }
 function deliveryContext(reference,format){
  const receipt=reference?.deliveryReceipt;
  return receipt?{transferVersion:2,sourceBasis:receipt.basis[format],sourceVersion:receipt.version}:null;
 }
 root.BazInspectionSession={owner,intent,write,read,view,freeze,basis,id:nonce,sourceReference,deliveryContext};
})(typeof window==='object'?window:globalThis);
