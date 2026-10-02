import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8');
let failSheet='',lockHeld=false;
class Range{
  constructor(sheet,row,col,rows=1,cols=1){Object.assign(this,{sheet,row,col,rows,cols});}
  getDisplayValues(){return this.getValues().map(r=>r.map(x=>String(x??'')));}
  getValues(){return Array.from({length:this.rows},(_,r)=>Array.from({length:this.cols},(_,c)=>this.sheet.data[this.row+r-1]?.[this.col+c-1]??''));}
  getValue(){return this.getValues()[0][0];}
  setValues(values){if(this.sheet.name===failSheet){failSheet='';throw new Error('simulated interrupted projection');}values.forEach((v,r)=>{this.sheet.data[this.row+r-1]??=[];v.forEach((x,c)=>{this.sheet.data[this.row+r-1][this.col+c-1]=x;});});return this;}
  setValue(v){return this.setValues([[v]]);}
  getRow(){return this.row;}
  createTextFinder(text){let exact=false;const matches=()=>{const out=[];this.getDisplayValues().forEach((r,i)=>r.forEach((v,c)=>{if(exact?v===text:v.includes(text))out.push(new Range(this.sheet,this.row+i,this.col+c));}));return out;};return {matchEntireCell(v){exact=v;return this;},findNext(){return matches()[0]||null;},findAll(){return matches();}};}
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
console.log('hospital-work: auth, source validation, duplicate warning, revision conflicts, comments, exact Handover mapping, source revisions, legacy IDs, durable interruption recovery passed.');
