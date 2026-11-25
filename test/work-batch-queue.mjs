import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const files=['handover_gas.gs','hospital_work_gas.gs','hospital_work_kv_gas.gs'];
const current=files.map(file=>fs.readFileSync(new URL(file,root),'utf8'));
const compare=process.argv[2]==='--compare'?process.argv[3]:null;
const queueHeaders=['eventKey','recordId','version','json','state','createdAt'];
const historySize=252, sourceSize=2144;
const sourceHeaders=['처리일','병원명','CS 담당자','점검/AS','대분류','유형','교체품','교체비용',
 '내용','노즐 재사용','A/S 결과','비고','장비SN','기록 ID','원본 저장 정보'];
const part='내부 세척', hospital='검증 병원', date='2026-11-25', engineer='검증 담당자';
const input=[
 {reqId:'1'.repeat(32),sn:'TEST101'},
 {reqId:'2'.repeat(32),sn:'TEST102'}
].map(device=>({...device,hosp:hospital,fse:engineer,token:'fixture',date,gubun:'A/S',
 cat:'점검',type:'기타',part,cost:0,result:'정상',detail:'장비별 검증 '+device.sn}));
const epoch=Date.parse('2026-11-25T02:00:00.000Z');
const timingPrefix='[inspection-batch-sheet] ';

function fixture(code){
 let now=epoch, owner=null, inQueue=false;
 const logs=[], reads=[], notes=new Map(), receipts=new Map(), calls=[];
 // Synthetic timings only. A range read uses 80ms + 0.02ms per cell,
 // an exact lookup 80ms + 0.003ms per cell, and a write 45ms.
 function observe(sheet,type,row,col,height,width){
  const cells=height*width;
  now+=type==='read'?80+Math.round(cells*.02):type==='find'?80+Math.round(cells*.003):45;
  if(inQueue)reads.push({sheet,type,row,col,height,width});
 }
 class Sheet{
  constructor(name,rows){this.name=name;this.rows=rows;}
  getLastRow(){return this.rows.length;}
  getMaxRows(){return Math.max(2200,this.rows.length);}
  getLastColumn(){return this.rows[0].length;}
  getRange(row,col,height=1,width=1){
   const sh=this;
   const values=()=>Array.from({length:height},(_,i)=>
    Array.from({length:width},(_,j)=>sh.rows[row+i-1]?.[col+j-1]??''));
   const range={
    getRow:()=>row,
    getValues(){observe(sh.name,'read',row,col,height,width);return values();},
    getDisplayValues(){return this.getValues().map(r=>r.map(String));},
    getValue(){return this.getValues()[0][0];},
    setValues(data){
     assert.ok(owner,'all Sheet writes must have ScriptLock in this fixture');
     observe(sh.name,'write',row,col,height,width);
     if(sh.failNextWrite){sh.failNextWrite=false;throw new Error('fixture write interrupted');}
     data.forEach((r,i)=>r.forEach((v,j)=>{(sh.rows[row+i-1]??=[])[col+j-1]=v;}));
     return this;
    },
    setValue(value){return this.setValues([[value]]);},
    getNote(){return notes.get(sh.name+':'+row+':'+col)||'';},
    setNote(value){notes.set(sh.name+':'+row+':'+col,value);return this;},
    createTextFinder(query){
     let exact=false,caseSensitive=false;
     function find(){
      observe(sh.name,'find',row,col,height,width);
      if(sh.failNextFind){sh.failNextFind=false;throw new Error('fixture lookup interrupted');}
      const normalized=value=>caseSensitive?String(value):String(value).toLowerCase();
      const target=normalized(query);
      return values().flatMap((r,i)=>r.flatMap((v,j)=>{
       const candidate=normalized(v);
       return (exact?candidate===target:candidate.includes(target))?[sh.getRange(row+i,col+j)]:[];
      }));
     }
     return {matchEntireCell(v){exact=v;return this;},matchCase(v){caseSensitive=v;return this;},
      findNext:()=>find()[0]||null,findAll:find};
    }
   };
   return range;
  }
 }
 const source=new Sheet('source',[sourceHeaders,...Array.from({length:sourceSize},(_,i)=>[
  '2026-11-24',i<4?hospital:'다른 병원 '+i,engineer,'A/S','점검','기타',part,'0',
  '이전 처리 기록','X','정상','','HIST'+i,'old-'+i,''
 ])]);
 const queue=new Sheet('queue',[queueHeaders,...Array.from({length:historySize},(_,i)=>[
  'old-'+i+'_v1','old-'+i,'v1',JSON.stringify({recordId:'old-'+i,version:'v1',detail:'이전 처리 기록'}),
  i<247?'sent':'source_deleted','2026-11-24T09:00:00.000Z'
 ])]);
 const journal=new Sheet('journal',[['recordId','row','state']]);
 const tabs=new Map([['현장 처리 현황(handover)',source],['업무Handover대기',queue],['업무원본저장저널',journal]]);
 const book={getSheetByName:name=>tabs.get(name)};
 class ClockDate extends Date{
  constructor(...args){super(...(args.length?args:[now]));}
  static now(){return now;}
 }
 const context=vm.createContext({
  Date:ClockDate,
  Logger:{log(message){if(String(message).startsWith(timingPrefix))logs.push(JSON.parse(message.slice(timingPrefix.length)));}},
  PropertiesService:{getScriptProperties:()=>({getProperty:key=>({
   HOSPITAL_WORK_KV_STAGE:'active',HOSPITAL_WORK_SS_ID:'test'
  })[key]||''})},
  SpreadsheetApp:{openById:()=>book},
  Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},
   computeDigest:(_,value)=>[...createHash('sha256').update(value).digest()]},
  LockService:{getScriptLock(){
   const lock={
    tryLock(ms){if(owner){now+=ms;return false;}now+=15;owner=lock;return true;},
    waitLock(ms){assert.equal(this.tryLock(ms),true,'fixture serial write');},
    releaseLock(){if(owner===lock)owner=null;}
   };
   return lock;
  }}
 });
 for(const [i,script] of code.entries())vm.runInContext(script,context,{filename:files[i]});
 Object.assign(context,{
  requireWrite_:()=>null,authName_:()=>engineer,sheet_:name=>tabs.get(name),json_:value=>value,
  log_(){},bazDropHandoverCaches_(){},invRecordUsage_:()=>({excluded:true}),
  reqGet_:id=>receipts.get(id),reqPut_:(id,value)=>receipts.set(id,value),reqPrune_(){},
  hwKvCall_:(verb,payload)=>{calls.push({verb,payload});return {success:true};}
 });
 const save=context.hospitalWorkHandoverSaved_;
 context.hospitalWorkHandoverSaved_=(...args)=>{
  assert.ok(owner,'deduplication and append share ScriptLock');
  inQueue=true;
  try{return save(...args);}finally{inQueue=false;}
 };
 const post=(payload,batch=true)=>context.doPost({
  parameter:batch?{inspectionBatch:'1'}:{},postData:{contents:JSON.stringify(payload)}
 });
 const withLock=run=>context.hwLock_(run);
 const hold=()=>{assert.equal(owner,null);owner='external';};
 const release=()=>{assert.equal(owner,'external');owner=null;};
 const age=ms=>{now+=ms;};
 return {source,queue,journal,logs,reads,calls,receipts,context,post,withLock,hold,release,age};
}

function measure(code){
 const f=fixture(code);
 const metrics=input.map(device=>{
  const start=f.reads.length, response=f.post(device);
  assert.ok(response.success,response.error);
  assert.equal(response.recordId,device.reqId);
  assert.equal(response.workAuto.statusPending,true);
  const log=f.logs.at(-1);
  assert.equal(log.outcome,'saved');
  assert.equal(log.statusDeferred,true);
  const inQueue=f.reads.slice(start);
  const cells=sheet=>inQueue.filter(r=>r.sheet===sheet&&r.type==='read'&&!(sheet==='queue'&&r.row===1))
   .reduce((sum,r)=>sum+r.height*r.width,0);
  return {queueMs:log.queueMs,lockHeldMs:log.lockHeldMs,sourceCells:cells('source'),queueCells:cells('queue')};
 });
 const produced=f.queue.rows.slice(historySize+1);
 assert.equal(produced.length,2);
 for(const [i,event] of produced.entries()){
  const snapshot=JSON.parse(event[3]), committed=JSON.parse(f.source.rows[sourceSize+i+1][14]);
  assert.equal(event[1],input[i].reqId);
  assert.equal(event[2],committed.snapshot.version);
  assert.equal(snapshot.sn,input[i].sn);
  assert.equal(snapshot.originalAuthor,committed.createdBy);
  assert.equal(snapshot.createdAt,committed.createdAt);
 }
 return {f,metrics};
}

const {f,metrics}=measure(current);
assert.ok(metrics.every(m=>m.sourceCells===0&&m.queueCells===0),
 'fresh batch devices reuse the committed snapshot and transfer no historical queue rows');
if(compare){
 const before=files.map(file=>execFileSync('git',['show',compare+':'+file],{
  cwd:fileURLToPath(root),encoding:'utf8',maxBuffer:1024*1024
 }));
 const original=measure(before).metrics;
 assert.deepEqual(original.map(m=>m.queueCells),[252*6,253*6]);
 assert.ok(original.every((m,i)=>m.queueMs>metrics[i].queueMs&&m.lockHeldMs>metrics[i].lockHeldMs));
 console.log(JSON.stringify({synthetic:true,sourceSize,historySize,before:original,after:metrics}));
}

// A lost reply and an expired receipt both confirm the existing Sheet row.
assert.equal(f.post(input[0]).row,sourceSize+2);
f.receipts.clear();
assert.equal(f.post(input[0]).recovered,true);
assert.equal(f.source.rows.length,sourceSize+3);
assert.equal(f.queue.rows.length,historySize+3);
f.context.hwKvRecoverFields_();
assert.equal(f.queue.rows.length,historySize+3,'recovering journal entries cannot duplicate the queue');
assert.deepEqual(f.journal.rows.slice(1).map(row=>row[2]),['queued','queued']);

{
 const g=fixture(current);
 assert.equal(g.post(input[0]).success,true);
 g.hold();
 const busy=g.post(input[1]);
 assert.equal(busy.code,'LOCK_BUSY');
 assert.equal(g.logs.at(-1).lockWaitMs,4000);
 assert.equal(g.logs.at(-1).lockHeldMs,0);
 g.release();
 g.queue.failNextWrite=true;
 const stored=g.post(input[1]);
 assert.equal(stored.success,true,'a queue write failure keeps the original Sheet row');
 assert.equal(g.journal.rows.at(-1)[2],'preparing');
 assert.equal(g.queue.rows.filter(r=>r[1]===input[1].reqId).length,0);
 assert.equal(g.post(input[1]).row,stored.row);
 g.queue.failNextFind=true;
 assert.throws(()=>g.context.hwKvRecoverFields_(),/lookup interrupted/);
 assert.equal(g.journal.rows.at(-1)[2],'preparing');
 g.context.hwKvRecoverFields_();
 assert.equal(g.journal.rows.at(-1)[2],'queued');
 assert.equal(g.source.rows.filter(r=>r[13]===input[1].reqId).length,1);
 assert.equal(g.queue.rows.filter(r=>r[1]===input[1].reqId).length,1);
 g.context.hwKvDeliverSources_();
 assert.deepEqual(Array.from(g.calls.at(-1).payload.sources,s=>s.sn),input.map(device=>device.sn));
}

{
 const g=fixture(current);
 const result=g.post(input[0]);
 assert.equal(result.success,true);
 g.context.hwKvRecoverFields_();
 const existing=g.queue.rows.at(-1);
 const originalRow=g.source.rows.pop();
 assert.deepEqual(Array.from(g.context.hwKvDeliverSources_().cancelledIds),[input[0].reqId]);
 assert.equal(existing[4],'source_deleted');
 g.source.rows.push(originalRow);
 const readSource=()=>g.context.hwKvSourceById_(input[0].reqId);
 const queue=()=>g.withLock(()=>g.context.hwKvQueueRecord_(readSource()));
 assert.equal(queue(),1,'restored source with the same version returns to pending');
 assert.equal(existing[4],'pending');
 assert.equal(queue(),0);
 g.context.hwKvDeliverSources_();
 assert.equal(existing[4],'sent');
 const earlier=originalRow[8];
 originalRow[8]='두 번째 원본 버전';
 g.age(1000);
 assert.equal(queue(),1);
 g.context.hwKvDeliverSources_();
 assert.equal(g.queue.rows.at(-1)[4],'sent');
 assert.notEqual(g.queue.rows.at(-1)[2],existing[2]);
 originalRow[8]=earlier;
 g.age(1000);
 assert.equal(queue(),1,'restoring an earlier version uses its existing row');
 assert.equal(existing[4],'pending');
 assert.equal(queue(),0);
 g.context.hwKvDeliverSources_();
 assert.equal(g.calls.at(-1).payload.sources[0].detail,earlier);
 assert.equal(g.queue.rows.filter(r=>r[1]===input[0].reqId).length,2);
}

console.log('batch queue: two independent device saves, lock retry, lost reply, durable queue repair, same-version restoration and earlier-version replay passed.');
