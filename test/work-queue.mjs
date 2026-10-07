import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const context={Date,Logger:{log(){}},PropertiesService:{getScriptProperties:()=>({getProperty:()=>''})}};
vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../hospital_work_kv_gas.gs',import.meta.url),'utf8'),context);
let rows=[{row:2,id:'renamed',state:'pending',createdAt:'2026-10-07T01:00:00Z'},{row:3,id:'renamed',state:'pending',createdAt:'2026-10-07T02:00:00Z'},{row:4,id:'missing',state:'pending',createdAt:'2026-10-07T03:00:00Z'},{row:5,id:'valid',state:'pending',createdAt:'2026-10-07T04:00:00Z'}],sent=[],calls=[];
context.hwKvPendingRows_=()=>rows.filter(r=>r.state==='pending');context.hwLock_=fn=>fn();
context.hwKvSheet_=()=>({getRange:row=>({setValue:state=>{rows.find(r=>r.row===row).state=state;sent.push(row);}})});
context.hwKvSourceById_=id=>{if(id==='missing')throw new Error('원본 없음');return {recordId:id,hospitalName:'현재 병원명'};};
context.hwKvCall_=(verb,payload)=>{calls.push({verb,payload});return {success:true};};context.hwKvControl_=()=>{};
const delivered=context.hwKvDeliverSources_();assert.deepEqual(sent,[2,3,5],'one bad record does not block other records; repeated versions all acknowledged');
assert.equal(calls[0].payload.sources.length,2,'one current source per stable ID');assert.equal(delivered.failedIds[0],'missing');
context.hwKvPublishStatus_(delivered.error,delivered.failedIds);const snapshot=calls.at(-1).payload;assert.equal(snapshot.pendingCount,1);assert.equal(snapshot.pendingEvents,1);assert.equal(snapshot.failedCount,1);
rows=Array.from({length:25},(_,i)=>({row:i+2,id:'id'+i,state:'pending',createdAt:'2026-10-07T01:00:00Z'}));sent=[];calls=[];
context.hwKvDeliverSources_();assert.equal(sent.length,20);context.hwKvPublishStatus_('',[]);assert.equal(calls.at(-1).payload.pendingCount,5,'counts entire remaining queue rather than just the batch');
rows=[{row:2,id:'fail',state:'pending'}];context.hwKvCall_=()=>{throw new Error('전송 실패');};assert.throws(()=>context.hwKvDeliverSources_());assert.equal(rows[0].state,'pending','failed delivery retains durable retry');
// Exercise actual stable-ID lookup against a renamed source, independent of queue JSON/name.
const finder={matchEntireCell:()=>finder,findAll:()=>[{getRow:()=>19}]};
const sheet={getLastColumn:()=>3,getRange:(row,col,n,width)=>width===1?{createTextFinder:id=>{assert.equal(id,'renamed');return finder;}}:{getValues:()=>{throw new Error('Raw Date cells must not bypass the existing formatted source parser');},getDisplayValues:()=>[['현재 병원명','renamed','2026. 10. 7']]}};
context.hwSS_=()=>({getSheetByName:()=>sheet});context.CONFIG={SHEET_NAME:'Handover'};context.REC_ID_COLS=['기록 ID'];context.findHeader_=()=>({row:2,headers:['병원명','기록 ID','처리일']});context.colBy_=()=>2;context.lastDataRow_=()=>20;context.hwSource_=raw=>({recordId:raw['기록 ID'],hospitalName:raw['병원명'],date:raw['처리일'],gubun:'A/S'});context.hwKvStableSource_=()=>{};
// Restore the implementation overwritten by the fixture.
const code=fs.readFileSync(new URL('../hospital_work_kv_gas.gs',import.meta.url),'utf8');vm.runInContext(code.slice(code.indexOf('function hwKvSourceById_'),code.indexOf('function hwKvDeliverSources_')),context);
assert.equal(context.hwKvSourceById_('renamed').hospitalName,'현재 병원명');finder.findAll=()=>[{getRow:()=>19},{getRow:()=>20}];assert.throws(()=>context.hwKvSourceById_('renamed'),/중복/);
console.log('work-queue: stable-ID rename recovery, duplicate-version grouping, poison-record isolation, 20-record batches, accurate remaining counts and retry preservation passed.');
