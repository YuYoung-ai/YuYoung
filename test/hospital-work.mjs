import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
let failSheet='',lockHeld=false,readRanges=[],finderReading=false;
class Range{
  constructor(sheet,row,col,rows=1,cols=1){Object.assign(this,{sheet,row,col,rows,cols});}
  getDisplayValues(){return this.getValues().map(r=>r.map(x=>String(x??'')));}
  getValues(){if(!finderReading)readRanges.push({sheet:this.sheet.name,row:this.row,col:this.col,rows:this.rows,cols:this.cols});return Array.from({length:this.rows},(_,r)=>Array.from({length:this.cols},(_,c)=>this.sheet.data[this.row+r-1]?.[this.col+c-1]??''));}
  getValue(){return this.getValues()[0][0];}
  setValues(values){if(this.sheet.name===failSheet){failSheet='';throw new Error('simulated interrupted projection');}values.forEach((v,r)=>{this.sheet.data[this.row+r-1]??=[];v.forEach((x,c)=>{this.sheet.data[this.row+r-1][this.col+c-1]=x;});});return this;}
  setValue(v){return this.setValues([[v]]);}
  getRow(){return this.row;}
  createTextFinder(text){let exact=false;const matches=()=>{const out=[];finderReading=true;let values;try{values=this.getDisplayValues();}finally{finderReading=false;}values.forEach((r,i)=>r.forEach((v,c)=>{if(exact?v===text:v.includes(text))out.push(new Range(this.sheet,this.row+i,this.col+c));}));return out;};return {matchEntireCell(v){exact=v;return this;},findNext(){return matches()[0]||null;},findAll(){return matches();}};}
}
class Sheet{
  constructor(name){this.name=name;this.data=[];}
  getRange(...args){return new Range(this,...args);}
  getDataRange(){return this.getRange(1,1,Math.max(this.getLastRow(),1),Math.max(this.getLastColumn(),1));}
  getLastRow(){return this.data.length;}
  getMaxRows(){return Math.max(1000,this.data.length);}
  getLastColumn(){return Math.max(0,...this.data.map(x=>x.length));}
  setFrozenRows(){}
  getName(){return this.name;}
}
const sheets=new Map(),ss={getId:()=> 'fixture-handover',getSheetByName:n=>sheets.get(n)||null,insertSheet:n=>{const sh=new Sheet(n);sheets.set(n,sh);return sh;},getSheets:()=>[...sheets.values()]};
const props=new Map();
const handover=ss.insertSheet('현장 처리 현황(handover)');
handover.data=[['처리일','병원명','CS 담당자','점검/AS','대분류','유형','교체품','교체비용','내용','A/S 결과','비고','장비SN','기록 ID'],
 ['2026-10-02','샘플병원','엔지니어 A','A/S','점검','누수','부품','1000','원본 처리 내용','정상','추가 관찰','SN1','report-1'],
 ['2026-10-02','샘플병원 분점','엔지니어 B','A/S','점검','누수','','','다른 지점 내용','','','SN2','report-2'],
 ['2026-09-29','샘플병원','엔지니어 A','A/S','점검','누수','','','과거 내용','','','SN1','']];
const sandbox={console,Date,JSON,Map,Set,SpreadsheetApp:{openById:()=>ss,getActiveSpreadsheet:()=>ss,flush(){}},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v)})},
  Utilities:{getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,value)=>[...crypto.createHash('sha256').update(value).digest()],
    formatDate:(d,tz,fmt)=>{const s=new Intl.DateTimeFormat('sv-SE',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d).replace(' ','T');return fmt.includes('HH:mm')?s:s.slice(0,10);}},
  LockService:{getScriptLock:()=>({waitLock(){assert.equal(lockHeld,false,'no nested lock');lockHeld=true;},releaseLock(){lockHeld=false;}})},
  bazVerifyLocal_:token=>token==='alice'?{ok:true,level:1,name:'CS A'}:token==='bob'?{ok:true,level:1,name:'CS B'}:token==='admin'?{ok:true,level:3,name:'관리자'}:{ok:false}};
vm.createContext(sandbox);vm.runInContext(read('handover_gas.gs'),sandbox);vm.runInContext(read('hospital_work_gas.gs'),sandbox);
sandbox.getHospDBRich_=()=>({success:true,data:[{name:'샘플병원',sn:'SN1',region:'서울',sales:'영업 A'},{name:'샘플병원 분점',sn:'SN2',region:'서울',sales:'영업 B'}]});
sandbox.getMaster_=()=>({fse:['엔지니어 A','엔지니어 B']});
sandbox.bazDropHandoverCaches_=()=>{};
const copy=o=>JSON.parse(JSON.stringify(o));
const get=p=>copy(sandbox.hospitalWorkGet_({token:'alice',...p}));
const post=p=>copy(sandbox.hospitalWorkPost_({token:'alice',operationId:crypto.randomUUID(),...p}));
assert.equal(get({action:'work_bootstrap'}).success,false,'explicit setup required');
sandbox.setupHospitalWork();sandbox.setupHospitalWork();assert.equal(handover.data.length,4,'initializer preserves source');
assert.equal(get({action:'work_bootstrap',token:''}).success,false,'auth enforced');
const boot=get({action:'work_bootstrap'});
const form={hospitalKey:boot.hospitals[0].key,symptom:'누수',cs:'CS A',engineer:'엔지니어 A',sales:'영업 A',status:'방문예정',registeredAt:'2026-10-02T09:00',visitAt:'2026-10-05T14:00',deadline:''};
const create={action:'work_save',form,operationId:crypto.randomUUID()};
const first=post(create);assert.equal(first.success,true);const id=first.request.id;
assert.deepEqual(post({...create,token:'alice'}),first,'durable retry same response');
assert.equal(post({...create,form:{...form,symptom:'altered'}}).success,false,'same operation cannot change payload');
assert.equal(get({action:'work_bootstrap'}).requests.length,1);
assert.equal(post({action:'work_save',form:{...form,registeredAt:'2026-02-30T09:00'}}).success,false,'invalid actual date');
assert.equal(post({action:'work_save',form:{...form,engineer:'존재하지 않음'}}).success,false,'engineer source validated');
assert.equal(post({action:'work_save',form:{...form,hospitalKey:'wrong'}}).success,false,'hospital source validated');
const duplicate=post({action:'work_save',form});assert.equal(duplicate.duplicate,true);assert.equal(duplicate.candidates.length,1);
const other=post({action:'work_save',form:{...form,symptom:'다른 요청'},acknowledgeDuplicates:true});assert.equal(other.success,true);
const update=post({action:'work_save',id,baseRevision:1,form:{...form,visitAt:'2026-10-06T14:00'},acknowledgeDuplicates:true});assert.equal(update.success,true,JSON.stringify(update));
const stale=post({action:'work_save',id,baseRevision:1,form});assert.equal(stale.conflict,true);assert.equal(stale.current.visitAt,'2026-10-06T14:00');
assert.equal(post({action:'work_complete',requestId:id,baseRevision:2}).success,false,'completion requires imported result');
const comment=post({action:'work_history_add',requestId:id,body:'병원에서 연락'});assert.equal(comment.success,true);
const deny=post({action:'work_history_update',token:'bob',requestId:id,historyId:comment.history.id,baseHistoryRevision:1,body:'다른 직원 수정'});assert.equal(deny.success,false);
const edited=post({action:'work_history_update',requestId:id,historyId:comment.history.id,baseHistoryRevision:1,body:'수정 댓글'});assert.equal(edited.success,true);
assert.equal(post({action:'work_history_update',requestId:id,historyId:comment.history.id,baseHistoryRevision:1,body:'충돌 댓글'}).conflict,true);
const candidates=get({action:'work_handover_candidates',requestId:id});assert.equal(candidates.success,true,JSON.stringify(candidates));assert.equal(candidates.data.length,2,'exact hospital excludes branch');
assert.ok(candidates.data.every(x=>!('photos' in x)&&!('snPhoto' in x)),'text only');
const source=get({action:'work_handover_detail',requestId:id,recordId:'report-1'}).source;
assert.equal(source.result,'정상');assert.equal(source.remark,'추가 관찰');
let current=get({action:'work_detail',id}).request;
const saveResult={action:'work_result_save',requestId:id,baseRevision:current.revision,recordId:source.recordId,sourceVersion:source.version,memo:'CS 확인',complete:true};
const imported=post(saveResult);assert.equal(imported.success,true);assert.equal(imported.request.status,'완료');assert.equal(imported.request.cs,'CS A');assert.equal(imported.request.visitAt,'2026-10-06T14:00','planned visit preserved');
assert.equal(imported.history.source.engineer,'엔지니어 A');
const linkedElsewhere=post({...saveResult,requestId:other.request.id,baseRevision:other.request.revision});assert.equal(linkedElsewhere.success,false,'cannot link one result to two tasks');
handover.data[1][8]='원본 수정';
const staleSource=post({...saveResult,baseRevision:imported.request.revision,baseHistoryRevision:1});assert.equal(staleSource.success,false,'source changed after preview');
const changed=get({action:'work_handover_detail',requestId:id,recordId:'report-1'}).source;
const refreshed=post({...saveResult,sourceVersion:changed.version,baseRevision:imported.request.revision,baseHistoryRevision:1,complete:false});assert.equal(refreshed.success,true);assert.equal(refreshed.request.status,'완료','refresh does not reopen completion');
assert.equal(get({action:'work_detail',id}).history.filter(x=>x.kind==='result').length,1,'result reimport updates one card');
assert.ok(get({action:'work_detail',id}).logs.some(x=>x.before?.body==='병원에서 연락'),'old comment preserved in audit');
const legacy=candidates.data.find(x=>x.recordId.startsWith('legacy_'));
const legacyImported=post({action:'work_result_save',requestId:other.request.id,baseRevision:other.request.revision,recordId:legacy.recordId,sourceVersion:legacy.version,memo:''});assert.equal(legacyImported.success,true);assert.ok(!legacyImported.history.source.recordId.startsWith('legacy_'),'legacy gets durable source ID');
assert.equal(handover.data[3][12],legacyImported.history.source.recordId);
// Simulate sheet write interruption after durable journal prepare, then retry the exact operation.
failSheet='업무처리이력';
const interrupted={action:'work_history_add',operationId:crypto.randomUUID(),requestId:id,body:'중단 후 복구'};
const interruptedResponse=post(interrupted);assert.equal(interruptedResponse.retrySameOperation,true);
const recovered=post(interrupted);assert.equal(recovered.success,true);
assert.deepEqual(post(interrupted),recovered);
assert.equal(get({action:'work_detail',id}).history.filter(x=>x.body==='중단 후 복구').length,1,'recovery exactly once');
assert.equal(sheets.get('업무변경로그').data.some(r=>r[3]==='prepared'),false);
assert.equal(post({action:'work_save',form:{...form,symptom:''}}).retrySameOperation,false,'validation error is definite failure');
assert.ok(read('auth.js').includes("'hospital-work.html':{ tool: 'hospitalwork', level: 1 }"));
assert.ok(read('index.html').includes('data-toolid="hospitalwork"'));
assert.ok(!/setInterval|visibilitychange|window\.onfocus/.test(read('js/baz-work-manager.js')),'no polling or focus sync');
assert.equal(lockHeld,false);
// Automatic linking uses visit date (not registration date), exact hospital, and one-to-one matches.
const autoRequest=(day,extra={})=>{const saved=post({action:'work_save',form:{...form,visitAt:day+'T14:00',...extra},acknowledgeDuplicates:true});assert.equal(saved.success,true,JSON.stringify(saved));return saved.request;};
const addSource=(day,extra={})=>{
 const s={hospital:'샘플병원',engineer:'엔지니어 B',gubun:'A/S',result:'정상',sn:'SN1',recordId:crypto.randomUUID(),...extra};
 const row=[day,s.hospital,s.engineer,s.gubun,'점검','누수','','0','자동 연결 현장 내용',s.result,'자동 연결 비고',s.sn,s.recordId];handover.data.push(row);return row;
};
const hook=(hospital,day)=>copy(sandbox.hwLock_(()=>sandbox.hospitalWorkHandoverSaved_(hospital,day)));
const journalCount=()=>sheets.get('업무변경로그').data.length;
const auto=autoRequest('2026-10-10');
addSource('2026-10-02',{recordId:'registration-date-only'});
assert.equal(get({action:'work_detail',id:auto.id}).request.status,'방문예정','registration date must not match');
const autoSource=addSource('2026-10-10');
addSource('2026-10-10',{hospital:'샘플병원 분점'});addSource('2026-10-10',{gubun:'점검'});
assert.equal(hook('샘플병원','2026-10-10').completed,1,'post-save hook completes exact visit match');
let autoDetail=get({action:'work_detail',id:auto.id});
assert.equal(autoDetail.request.status,'완료');assert.equal(autoDetail.request.cs,'CS A');assert.equal(autoDetail.request.visitAt,auto.visitAt);
assert.equal(autoDetail.history[0].source.recordId,autoSource[12]);assert.equal(autoDetail.history[0].source.engineer,'엔지니어 B');assert.equal(autoDetail.history[0].auto,true);
assert.ok(autoDetail.logs.some(x=>x.kind==='result_auto'),'automatic completion is audited');
const autoRevision=autoDetail.request.revision,afterAuto=journalCount();
hook('샘플병원','2026-10-10');get({action:'work_bootstrap'});get({action:'work_sync'});
assert.equal(journalCount(),afterAuto,'repeated synchronization does not duplicate result or audit');
assert.equal(get({action:'work_detail',id:auto.id}).request.revision,autoRevision);
const reopened=post({action:'work_save',id:auto.id,baseRevision:autoRevision,form:{...form,visitAt:auto.visitAt,status:'처리중'},acknowledgeDuplicates:true});assert.equal(reopened.success,true);
const reopenedDetail=get({action:'work_detail',id:auto.id});assert.equal(reopenedDetail.request.status,'처리중');assert.equal(reopenedDetail.autoMatch.skipped[0].reason,'reopened','old auto result cannot close explicitly reopened work');
// Existing source before request creation is picked up by sync without a new Handover write.
addSource('2026-10-11');const preexisting=autoRequest('2026-10-11');
const synced=get({action:'work_sync'});assert.ok(synced.autoMatch.completed.some(x=>x.requestId===preexisting.id));
assert.equal(synced.requests.find(x=>x.id===preexisting.id).status,'완료');
const ambiguous=autoRequest('2026-10-12');addSource('2026-10-12');addSource('2026-10-12');
assert.equal(get({action:'work_detail',id:ambiguous.id}).autoMatch.skipped[0].reason,'sources');
assert.equal(get({action:'work_detail',id:ambiguous.id}).request.status,'방문예정');
const duplicate1=autoRequest('2026-10-13'),duplicate2=autoRequest('2026-10-13',{visitAt:'2026-10-13T18:00'});addSource('2026-10-13');
assert.equal(get({action:'work_detail',id:duplicate1.id}).autoMatch.skipped[0].reason,'requests');
assert.equal(get({action:'work_detail',id:duplicate2.id}).request.status,'방문예정');
const mismatch=autoRequest('2026-10-14');addSource('2026-10-14',{sn:'SN-other'});
assert.equal(get({action:'work_detail',id:mismatch.id}).autoMatch.skipped[0].reason,'sn');
const incomplete=autoRequest('2026-10-15');addSource('2026-10-15',{result:''});
assert.equal(get({action:'work_detail',id:incomplete.id}).autoMatch.skipped[0].reason,'result');
const held=autoRequest('2026-10-16',{status:'보류'});addSource('2026-10-16');assert.equal(get({action:'work_detail',id:held.id}).request.status,'보류');
const cancelled=autoRequest('2026-10-17',{status:'취소'});addSource('2026-10-17');assert.equal(get({action:'work_detail',id:cancelled.id}).request.status,'취소');
const noVisit=autoRequest('2026-10-18',{visitAt:'',status:'접수'});addSource('2026-10-18');assert.equal(get({action:'work_detail',id:noVisit.id}).request.status,'접수');
const duplicateId=autoRequest('2026-10-19');addSource('2026-10-19',{recordId:'duplicate-source-id'});addSource('2026-10-20',{recordId:'duplicate-source-id'});
assert.equal(get({action:'work_detail',id:duplicateId.id}).autoMatch.skipped[0].reason,'id');
// A manually selected result and memo remain authoritative; the same source can finish review.
const preserve=autoRequest('2026-10-21'),memoRow=addSource('2026-10-22');
const memoSource=get({action:'work_handover_detail',requestId:preserve.id,recordId:memoRow[12]}).source;
const memoImport=post({action:'work_result_save',requestId:preserve.id,baseRevision:preserve.revision,recordId:memoSource.recordId,sourceVersion:memoSource.version,memo:'유지할 고객센터 메모'});
assert.equal(memoImport.success,true);
const moved=post({action:'work_save',id:preserve.id,baseRevision:memoImport.request.revision,form:{...form,visitAt:'2026-10-22T14:00',status:'결과확인'},acknowledgeDuplicates:true});assert.equal(moved.success,true);
const preserved=get({action:'work_detail',id:preserve.id});assert.equal(preserved.request.status,'완료');assert.equal(preserved.history.length,1);assert.equal(preserved.history[0].memo,'유지할 고객센터 메모');
const linked=autoRequest('2026-10-22',{status:'방문예정'});
// Completed same-day requests continue to participate in ambiguity checks.
assert.equal(get({action:'work_detail',id:linked.id}).autoMatch.skipped[0].reason,'requests');
// Legacy IDs and partial automatic writes recover through the same durable journal.
const legacyAuto=autoRequest('2026-10-23'),legacyRow=addSource('2026-10-23',{recordId:''});failSheet='업무처리이력';
assert.throws(()=>hook('샘플병원','2026-10-23'),/simulated interrupted projection/);
assert.ok(legacyRow[12]&&!legacyRow[12].startsWith('legacy_'),'stable source ID assigned before projection');
const recoveredAuto=get({action:'work_detail',id:legacyAuto.id});assert.equal(recoveredAuto.success,true);assert.equal(recoveredAuto.request.status,'완료');assert.equal(recoveredAuto.history.length,1);
assert.equal(sheets.get('업무변경로그').data.some(r=>r[3]==='prepared'),false);
// Run actual Handover doPost: auxiliary failure must still return source-save success.
const realSave=autoRequest('2026-10-24');failSheet='업무처리이력';const realReqId=crypto.randomUUID();
const payload={token:'alice',reqId:realReqId,date:'2026-10-24',hosp:'샘플병원',fse:'엔지니어 B',gubun:'A/S',sn:'SN1',result:'수리',detail:'실제 doPost 저장',cost:'0'};
const realResponse=JSON.parse(sandbox.doPost({postData:{contents:JSON.stringify(payload)}}).text);
assert.equal(realResponse.success,true,JSON.stringify(realResponse));assert.equal(realResponse.workAuto.pending,true);
assert.equal(handover.data.filter(r=>r[12]===realReqId).length,1,'source written once despite auto failure');
assert.equal(get({action:'work_detail',id:realSave.id}).request.status,'완료','next read recovers failed auxiliary completion');
const realRetry=JSON.parse(sandbox.doPost({postData:{contents:JSON.stringify(payload)}}).text);assert.equal(realRetry.success,true);assert.equal(handover.data.filter(r=>r[12]===realReqId).length,1);
const unauthorizedTarget=autoRequest('2026-10-25');addSource('2026-10-25');
assert.equal(get({action:'work_detail',id:unauthorizedTarget.id,token:''}).success,false);
assert.equal(sandbox.hwRequest_(unauthorizedTarget.id).status,'방문예정','unauthenticated read cannot trigger completion');
const immediateTarget=autoRequest('2026-10-26');
const immediatePayload={...payload,reqId:crypto.randomUUID(),date:'2026-10-26'};
const immediateResponse=JSON.parse(sandbox.doPost({postData:{contents:JSON.stringify(immediatePayload)}}).text);
assert.equal(immediateResponse.success,true);assert.equal(immediateResponse.workAuto.completed,1);
assert.equal(sandbox.hwRequest_(immediateTarget.id).status,'완료','Handover save completes request before any subsequent browser read');
const manualCandidate=get({action:'work_handover_candidates',requestId:ambiguous.id}).data.find(s=>s.date==='2026-10-12');
const manualFallback=post({action:'work_result_save',requestId:ambiguous.id,baseRevision:ambiguous.revision,recordId:manualCandidate.recordId,sourceVersion:manualCandidate.version,complete:true});
assert.equal(manualFallback.success,true,'ambiguous matches still support manual selection/completion');
// Reference reuse still checks live ACL, runs reconciliation, and supports forced refresh.
const originalDb=sandbox.getHospDBRich_,originalMaster=sandbox.getMaster_;let dbParams=[],masterParams=[];
sandbox.getHospDBRich_=p=>{dbParams.push(p);return originalDb(p);};sandbox.getMaster_=p=>{masterParams.push(p);return originalMaster(p);};
const withoutRefs=get({action:'work_bootstrap',omitReferences:'1'});assert.equal(withoutRefs.success,true);assert.equal(withoutRefs.referencesIncluded,false);assert.ok(!withoutRefs.hospitals);assert.equal(dbParams.length,0);assert.equal(masterParams.length,0);
const normalRefs=get({action:'work_bootstrap'});assert.equal(normalRefs.referencesIncluded,true);assert.equal(dbParams.at(-1).force,'0');
const forceRefs=get({action:'work_bootstrap',omitReferences:'1',force:'1'});assert.equal(forceRefs.referencesIncluded,true);assert.equal(dbParams.at(-1).force,'1');assert.equal(masterParams.at(-1).force,'1');
const originalMenu=sandbox.menuGet_;sandbox.menuGet_=()=>({menu:[{id:'hospitalwork',level:3}]});
assert.equal(get({action:'work_bootstrap',omitReferences:'1'}).success,false,'cached references never bypass live menu ACL');sandbox.menuGet_=originalMenu;
const postRead=JSON.parse(sandbox.doPost({postData:{contents:JSON.stringify({action:'work_detail',token:'alice',id:immediateTarget.id})}}).text);assert.equal(postRead.success,true);assert.equal(postRead.request.status,'완료');
// Thousands of unrelated journal/history rows must not be transferred for a single detail.
for(let i=0;i<1000;i++){
  sheets.get('업무처리이력').data.push(['unrelated-h'+i,'unrelated-job'+i,JSON.stringify({id:'unrelated-h'+i,requestId:'unrelated-job'+i,kind:'comment',body:'irrelevant'})]);
  sheets.get('업무변경로그').data.push(['unrelated-op'+i,'actor','hash','committed',JSON.stringify({kind:'comment_add',request:{id:'unrelated-job'+i}}),'{}','time']);
}
readRanges=[];const indexed=get({action:'work_detail',id:immediateTarget.id});assert.equal(indexed.success,true);assert.equal(indexed.history.length,1);assert.equal(indexed.logs.length,postRead.logs.length);
const detailCells=readRanges.filter(x=>['업무처리이력','업무변경로그'].includes(x.sheet)).reduce((n,x)=>n+x.rows*x.cols,0);
assert.ok(detailCells<30,'detail transfers matched history/journal cells: '+detailCells);
readRanges=[];const activeDetail=get({action:'work_detail',id:incomplete.id});assert.equal(activeDetail.autoMatch.skipped[0].reason,'result');
assert.ok(!readRanges.some(x=>x.sheet==='업무처리이력'&&x.rows>100),'active detail auto linking also limits history transfer');
console.log('hospital-work performance fixture: 1,000 unrelated history/log rows, detail history/log transferred cells='+detailCells+' (TextFinder search stays in Sheets).');
assert.equal(lockHeld,false);
console.log('hospital-work: manual workflow plus visit-date auto completion, exact hospital/AS match, duplicates, SN, missing result/date, hold/cancel, stable IDs, memo preservation, idempotent sync, actual Handover save and auxiliary failure recovery passed.');
