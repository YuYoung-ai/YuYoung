import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

class Sheet{
 constructor(data){this.data=structuredClone(data);this.notes=new Map();this.failIds=new Set();}
 getLastRow(){return this.data.length;}
 getLastColumn(){return Math.max(...this.data.map(r=>r.length));}
 getRange(row,col,count=1,width=1){
  const sh=this;
  const range={getValues:()=>Array.from({length:count},(_,r)=>Array.from({length:width},(_,c)=>sh.data[row+r-1]?.[col+c-1]??'')),
   getDisplayValues:()=>range.getValues().map(r=>r.map(v=>String(v))),getValue:()=>range.getValues()[0][0],getRow:()=>row,
   setValue:v=>{sh.data[row-1]??=[];sh.data[row-1][col-1]=v;return range;},
   setValues:values=>{values.forEach((r,i)=>r.forEach((v,j)=>{sh.data[row+i-1]??=[];sh.data[row+i-1][col+j-1]=v;}));return range;},
   getNote:()=>sh.notes.get(row+':'+col)||'',setNote:note=>{sh.notes.set(row+':'+col,note);return range;},
   createTextFinder:id=>{if(sh.failIds.has(id))throw new Error('시트 조회 실패');const finder={matchEntireCell:()=>finder,findAll:()=>range.getDisplayValues().flatMap((r,i)=>r.flatMap((v,j)=>v===id?[sh.getRange(row+i,col+j)]:[])),findNext:()=>finder.findAll()[0]||null};return finder;}
  };return range;
 }
}
const queueHeaders=['eventKey','recordId','version','json','state','createdAt'];
const sourceHeaders=['처리일','병원명','점검/AS','장비SN','A/S 결과','내용','기록 ID'];
const report=id=>({recordId:id,version:'v1',date:'2026-10-12',hospitalName:'가상 병원',gubun:'A/S',sn:'BW3007',detail:'보존할 원문',result:'교체'});
const queueRow=(id,version='v1')=>[id+'_'+version,id,version,JSON.stringify({...report(id),version}),'pending','2026-10-12T06:02:36Z'];
const sourceRow=id=>['2026-10-12','가상 병원','A/S','BW3007','교체','현재 원문',id];
function fixture(ids=['gone','valid','duplicate','read-failure']){
 const rows=[sourceHeaders,sourceRow('duplicate'),sourceRow('duplicate')];
 // A valid ID outside the continuous data block must never be misclassified as deleted.
 while(rows.length<30)rows.push([]);rows.push(sourceRow('valid'));
 const original=new Sheet(rows),queue=new Sheet([queueHeaders,...ids.map(id=>queueRow(id))]);original.failIds.add('read-failure');
 const calls=[],props={},context={Date,JSON,Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()]},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||'',setProperty:(k,v)=>{props[k]=v;}})},Logger:{log(){}}};
 vm.createContext(context);
 for(const file of ['handover_gas.gs','hospital_work_gas.gs','hospital_work_kv_gas.gs'])vm.runInContext(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),context);
 context.hwSS_=()=>({getSheetByName:()=>original});context.hwKvSheet_=()=>queue;
 context.findHeader_=()=>({row:1,headers:sourceHeaders});context.colBy_=()=>7;context.lastDataRow_=()=>3;
 context.hwKvStableSource_=()=>{};context.hwKvControl_=()=>{};context.hwLock_=fn=>fn();
 context.hwKvCall_=(verb,payload)=>{calls.push({verb,payload});return {success:true};};
 return {original,queue,calls,context};
}
{
 const f=fixture(['gone','gone','valid','duplicate','read-failure']),before=structuredClone(f.queue.data);f.queue.notes.set('2:5','기존 확인 메모');
 const out=f.context.hwKvDeliverSources_();
 assert.deepEqual(Array.from(out.cancelledIds),['gone']);
 assert.equal(f.queue.data[1][4],'source_deleted');assert.equal(f.queue.data[2][4],'source_deleted');
 for(const i of [1,2]){assert.deepEqual(f.queue.data[i].slice(0,4),before[i].slice(0,4),'queued source/ID/version/JSON are retained');assert.match(f.queue.notes.get((i+1)+':5'),/원본 삭제로 전송 취소/);}
 assert.match(f.queue.notes.get('2:5'),/^기존 확인 메모/,'existing notes are retained');
 assert.equal(f.queue.data[3][4],'sent','source after blank gaps is delivered');
 assert.equal(f.queue.data[4][4],'pending','duplicate IDs remain an error requiring review');
 assert.equal(f.queue.data[5][4],'pending','read failures never prove deletion');
 assert.deepEqual(Array.from(f.calls[0].payload.sources,s=>s.recordId),['valid']);
 assert.deepEqual(Array.from(out.failedIds),['duplicate','read-failure']);
 f.context.hwKvPublishStatus_(out.error,out.failedIds);assert.equal(f.calls.at(-1).payload.pendingCount,2);assert.equal(f.calls.at(-1).payload.failedCount,2);
 assert.equal(f.original.data.length,31,'no deleted report is recreated');
}
{
 const f=fixture(['gone']);let restored=false;
 f.context.hwLock_=fn=>{if(!restored){f.original.data.push(sourceRow('gone'));restored=true;}return fn();};
 const out=f.context.hwKvDeliverSources_();assert.equal(out.cancelledIds.length,0);assert.equal(f.queue.data[1][4],'pending','restoration between lookup and lock prevents cancellation');
 f.context.hwKvDeliverSources_();assert.equal(f.queue.data[1][4],'sent','next delivery sends the restored source');
}
{
 const f=fixture(['gone','valid']);f.context.hwKvCall_=()=>{throw new Error('Deno 연결 실패');};
 assert.throws(()=>f.context.hwKvDeliverSources_(),/Deno 연결 실패/);assert.equal(f.queue.data[1][4],'source_deleted');assert.equal(f.queue.data[2][4],'pending','network failure preserves valid delivery retries');
}
{
 const f=fixture(['gone']);const before=f.queue.data[1][3];f.context.hwKvDeliverSources_();
 assert.equal(f.queue.data[1][4],'source_deleted');f.context.hwKvPublishStatus_('',[]);assert.equal(f.calls.at(-1).payload.pendingCount,0);assert.equal(f.calls.at(-1).payload.failedCount,0);
 const restored={...report('gone'),observedAt:'2026-10-12T08:00:00Z'};
 f.context.hwSources_=()=>[{raw:{_row:3},source:restored}];
 assert.equal(f.context.hwKvQueueSources_('가상 병원','2026-10-12'),1,'restoring/re-saving the same ID/version requeues it');
 assert.equal(f.queue.data.length,2,'no duplicate queue event is created');assert.equal(f.queue.data[1][4],'pending');assert.match(f.queue.notes.get('2:5'),/원본 삭제로 전송 취소[\s\S]*원본 복원으로 전송 재개/,'cancellation and restoration notes remain auditable');
 assert.equal(JSON.parse(f.queue.data[1][3]).detail,JSON.parse(before).detail,'original report text is preserved');
 assert.equal(f.context.hwKvQueueSources_('가상 병원','2026-10-12'),0,'repeated save is idempotent');
}
console.log('deleted-source queue: preserved JSON/IDs, cancellation notes, zero pending/errors, full ID-column lookup, duplicate/read-failure protection, locked restoration race, network retries and same-version restoration passed.');
