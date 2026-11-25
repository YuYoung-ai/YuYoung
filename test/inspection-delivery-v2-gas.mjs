import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let clock=Date.parse('2026-11-25T10:00:00Z');
class Clock extends Date{static now(){return clock;}}
const pdfHash='a'.repeat(64),basis='b'.repeat(64),jobId='upload_fixture',fileId='file_fixture';
const context={recordId:'record_fixture',requestId:'request_fixture',hospital:'가상 병원',date:'2026-11-25',sn:'SN1'};
let job={id:jobId,fileId,context,owner:'fixture_owner',author:'fixture',filename:'fixture.pdf',bytes:20,sha256:pdfHash,
  fingerprint:basis,format:'standard',sourceVersion:'original',baseRevision:0,state:'receiving',attempts:0,createdAt:clock};
let cells=[],stage='target',locked=false,contended=true,commentPending=true,shareCalls=0,fileUploads=0,linkWrites=0,jobWrites=0;
const table={getRange(row,column){
  assert.equal(row,2);
  if(column===4)return {getValue:()=>JSON.stringify(job)};
  assert.equal(column,1);
  return {setValues([[id,state,,value]]){
    assert.equal(locked,true);assert.equal(id,jobId);
    job=JSON.parse(value);assert.equal(state,job.state);jobWrites++;
  }};
}};
const sheet={getRange(row,column){
  assert.equal(locked,true);assert.equal(row,5);assert.equal(column,8);
  return {setValues([values]){linkWrites++;clock+=350;cells=values;},getDisplayValue(){clock+=40;return cells[0];}};
}};
const sandbox=vm.createContext({
  Date:Clock,Utilities:{getUuid:()=> 'lease_fixture'},SpreadsheetApp:{flush(){clock+=30;}},Logger:{log(){}},
  PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'enabled'})},
  inspectionPdfLock_(){
    if(contended){contended=false;throw Object.assign(new Error('fixture lock'),{code:'LOCK_BUSY'});}
    assert.equal(locked,false);locked=true;clock+=20;return {releaseLock(){locked=false;}};
  },
  inspectionPdfBasis_:()=>({fingerprint:basis}),bazDropHandoverCaches_(){clock+=30;},
  DriveApp:{getFileById(id){
    assert.equal(id,fileId);
    return {getResourceKey:()=>'',setSharing(){
      assert.equal(stage,'linked');assert.equal(locked,false);assert.ok(cells[0]);shareCalls++;clock+=150;
    }};
  },Access:{ANYONE_WITH_LINK:1},Permission:{VIEW:1}},
  hwKvCall_(verb,input){
    assert.equal(locked,false);
    if(verb==='inspection_target'){stage='linked';clock+=100;return {ready:true,requestId:context.requestId};}
    assert.equal(verb,'inspection_complete');assert.equal(job.state,'handover');assert.equal(job.shared,true);
    assert.ok(job.lease);assert.equal(cells[0],job.pdf.url);clock+=200;
    const time={targetMs:20,registrationMs:50,confirmationMs:25};
    if(commentPending)return {complete:false,code:'SERVICE_PENDING',message:'가상 댓글 지연',stageTimings:time};
    return {complete:true,requestId:context.requestId,recordId:context.recordId,sha256:pdfHash,revision:1,fileId,
      checkedAt:new Date(clock).toISOString(),stageTimings:time};
  }
});
const source=fs.readFileSync(new URL('../inspection_delivery_gas.gs',import.meta.url),'utf8');
vm.runInContext(source,sandbox);
Object.assign(sandbox,{
  inspectionDeliveryActor_:()=>({owner:'fixture_owner'}),
  inspectionDeliveryTable_:()=>table,inspectionDeliveryRow_:()=>2,
  inspectionDeliverySource_:()=>({source:{recordId:context.recordId,hospitalName:context.hospital,date:context.date,sn:context.sn,version:'original'},
    sheet,row:5,linkCol:8,metaCol:9,pdf:cells[1]?JSON.parse(cells[1]):null}),
  inspectionDeliveryUpload_:()=>{fileUploads++;clock+=100;return true;}
});
const resume=()=>sandbox.inspectionDeliveryPost_({action:'inspection_pdf_job_resume',uploadId:jobId,requestId:context.requestId});
assert.equal(resume().code,'LOCK_BUSY');
assert.equal(jobWrites,0);
const interrupted=resume();
assert.equal(interrupted.state,'handover');
assert.equal(interrupted.commentAttached,false);
assert.equal(interrupted.stageTimings.sheetLink,380);
assert.equal(interrupted.stageTimings.driveShare,150);
assert.equal(job.stageTimings.workRegistration,50);
assert.equal(job.lease,undefined);
assert.equal(linkWrites,1);
assert.equal(shareCalls,1);

const originalCheckpoint=structuredClone(job),originalCells=[...cells],beforeRetry=jobWrites;
commentPending=false;
const recovered=resume();
assert.equal(recovered.state,'complete');
assert.equal(recovered.commentAttached,true);
assert.equal(recovered.jobId,jobId);
assert.equal(recovered.stageTimings.sheetLinkCheck,40);
assert.equal(recovered.stageTimings.sheetLink,undefined);
assert.equal(job.stageTimings.sheetLink,380);
assert.equal(job.stageTimings.workRegistration,100);
assert.equal(jobWrites-beforeRetry,2,'lease and final stage are the only job writes on an intact retry');
assert.equal(linkWrites,1);
assert.equal(fileUploads,1);
assert.equal(shareCalls,1);

job=structuredClone(originalCheckpoint);cells=['',originalCells[1]];
assert.equal(resume().state,'complete','a missing Sheet link is restored before confirming the comment');
assert.equal(linkWrites,2);
job=structuredClone(originalCheckpoint);cells=[originalCells[0],JSON.stringify({...JSON.parse(originalCells[1]),sha256:'c'.repeat(64)})];
assert.equal(resume().code,'FILE_CONFLICT');
assert.equal(fileUploads,1);
assert.equal(shareCalls,1);
console.log('PASS: Apps Script lock, durable handover receipt, same-ID resume, exact sheet repair, no duplicate sharing, and stage timing persistence.');
