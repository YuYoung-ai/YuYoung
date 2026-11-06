import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const code=fs.readFileSync(new URL('../hospital_work_kv_gas.gs',import.meta.url),'utf8');
const fn=code.slice(code.indexOf('function hwKvDeliverDocuments_(){'),code.indexOf('function hwReviewApply_('));
function fixture({bad=[],lostAck=false,concurrent=false,budget=false}={}){
 const data=[['eventKey','json','state'],...['bad','target','other'].map(id=>[id+'_1',JSON.stringify({recordId:id,pdf:{revision:1,sha256:id}}),'pending'])],calls=[],accepted=new Set();let clock=0,first=true;
 const sheet={getLastRow:()=>data.length,getRange(row,col,rows=1,cols=1){return {getValues:()=>data.slice(row-1,row-1+rows).map(r=>r.slice(col-1,col-1+cols)),setValue(value){data[row-1][col-1]=value;}};}};
 const run=vm.runInNewContext(fn+';hwKvDeliverDocuments_;',{HW_KV_DOCUMENTS:'outbox',hwKvSheet_:()=>sheet,hwKvSourceById_(){},hwLock_:f=>f(),Logger:{log(){}},Date:{now:()=>clock},hwResetContext_(){},hwKvCall_(verb,payload){assert.equal(verb,'documents');const ids=payload.documents.map(d=>d.recordId);calls.push(ids);if(budget&&ids.length===1)clock+=50000;for(const id of ids){if(bad.includes(id))throw Error('문서와 접수의 병원·처리일·장비가 다릅니다.');accepted.add(id);}if(concurrent)data[2][1]=JSON.stringify({recordId:'target',pdf:{revision:2}});if(lostAck&&first){first=false;throw Error('ACK lost');}}});
 return {data,calls,accepted,run};
}
let f=fixture({bad:['bad']});assert.throws(f.run,/2건 전달 완료.*1건 재확인/);assert.deepEqual(f.data.slice(1).map(r=>r[2]),['pending','sent','sent']);assert.deepEqual([...f.accepted],['target','other']);assert.equal(f.data[1][1].includes('"recordId":"bad"'),true,'the rejected document is preserved for correction');
f=fixture();assert.equal(f.run().sent,3);assert.equal(f.calls.length,1,'healthy batches retain their original single-request fast path');
f=fixture({lostAck:true});assert.equal(f.run().sent,3);assert.equal(f.accepted.size,3,'accepted-but-lost ACK recovery does not create another document');
f=fixture({bad:['bad'],concurrent:true});assert.throws(f.run);assert.equal(f.data[2][2],'pending','a newer PDF is never acknowledged by an old response');
f=fixture({bad:['bad'],budget:true});assert.throws(f.run,/재확인/);assert.equal(f.data[3][2],'pending','time-budget leftovers remain durable');
console.log('PASS: one invalid document cannot block valid peers, accepted-only ACKs, lost ACK idempotency, concurrent regeneration and bounded durable retries');
