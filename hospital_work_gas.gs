/** 병원 A/S 업무관리. 기존 Handover.gs + baz_token_lib.gs와 같은 프로젝트에 추가.
 * 편집기에서 setupHospitalWork() 1회 실행 후 기존 웹앱 새 버전을 배포한다.
 * 변경로그가 내구성 있는 커밋 저널이며 요청/댓글 시트는 재실행 가능한 투영이다.
 * pending 저널은 다음 요청에서 잠금 안에서 복구한다. SQL 트랜잭션을 가정하지 않는다.
 */
var HW = {
  REQUESTS:'업무요청', HISTORY:'업무처리이력', LOG:'업무변경로그', HOSPITALS:'업무병원',
  STATUSES:['접수','방문예정','처리중','결과확인','완료','보류','취소']
};
// 실행별 시트 핸들만 재사용한다. 행 데이터와 권한은 매 요청 확인한다.
var _hwSS=null, _hwSheets={};
function hwResetContext_(){ _hwSS=null; _hwSheets={}; }
function hwSS_(){
  if(_hwSS) return _hwSS;
  var id=PropertiesService.getScriptProperties().getProperty('HOSPITAL_WORK_SS_ID');
  if(!id) throw new Error('업무관리 초기화가 필요합니다. GAS 편집기에서 setupHospitalWork를 실행하세요.');
  return (_hwSS=SpreadsheetApp.openById(id));
}
function setupHospitalWork(){
  hwResetContext_();
  var lock=LockService.getScriptLock(); lock.waitLock(10000);
  try{
    var props=PropertiesService.getScriptProperties(), id=props.getProperty('HOSPITAL_WORK_SS_ID');
    var ss=id?SpreadsheetApp.openById(id):SpreadsheetApp.getActiveSpreadsheet();
    if(!ss) throw new Error('handover 스프레드시트에 연결된 편집기에서 실행하세요.');
    if(!ss.getSheetByName(CONFIG.SHEET_NAME)) throw new Error('handover 원본 탭이 없는 파일입니다.');
    [[HW.REQUESTS,['id','json']],[HW.HISTORY,['id','requestId','json']],
      [HW.LOG,['operationId','actor','fingerprint','state','event','response','createdAt']],
      [HW.HOSPITALS,['id','key','json']]].forEach(function(spec){
      var sh=ss.getSheetByName(spec[0])||ss.insertSheet(spec[0]);
      if(sh.getLastRow()===0){ sh.getRange(1,1,1,spec[1].length).setValues([spec[1]]); sh.setFrozenRows(1); }
      else if(JSON.stringify(sh.getRange(1,1,1,spec[1].length).getDisplayValues()[0])!==JSON.stringify(spec[1])){
        throw new Error(spec[0]+' 헤더가 다릅니다. 기존 데이터를 지우지 않고 초기화를 중단했습니다.');
      }
    });
    props.setProperty('HOSPITAL_WORK_SS_ID',ss.getId());
    return '업무 전용 탭 준비 완료 · '+ss.getId();
  }finally{ lock.releaseLock(); }
}
function hwSheet_(name){ var sh=_hwSheets[name]||hwSS_().getSheetByName(name); if(!sh) throw new Error(name+' 탭 없음: setupHospitalWork 실행 필요'); return (_hwSheets[name]=sh); }
// 일치한 행만 연속 구간으로 묶어 읽는다.
function hwMatchedRows_(sh,col,text,exact,start,width,first,last){
  first=first||2; last=last||sh.getLastRow(); if(last<first) return [];
  var cells=sh.getRange(first,col,last-first+1,1).createTextFinder(String(text)).matchEntireCell(!!exact).findAll();
  var rows=cells.map(function(c){return c.getRow();}).sort(function(a,b){return a-b;}),out=[];
  for(var i=0;i<rows.length;){
    var begin=rows[i],end=begin;i++;while(i<rows.length&&rows[i]===end+1)end=rows[i++];
    sh.getRange(begin,start,end-begin+1,width).getDisplayValues().forEach(function(v,j){out.push({row:begin+j,values:v});});
  }
  return out;
}
function hwRows_(name,width){ var sh=hwSheet_(name), n=sh.getLastRow()-1; return n>0?sh.getRange(2,1,n,width).getDisplayValues():[]; }
function hwFind_(name,id,col){
  var sh=hwSheet_(name), n=sh.getLastRow()-1;
  if(n<1) return 0;
  var cell=sh.getRange(2,col||1,n,1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return cell?cell.getRow():0;
}
function hwPut_(name,id,values){
  var sh=hwSheet_(name), row=hwFind_(name,id)||sh.getLastRow()+1;
  sh.getRange(row,1,1,values.length).setValues([values.map(safeCell_)]);
}
function hwRequest_(id){ var row=hwFind_(HW.REQUESTS,id); return row?JSON.parse(hwSheet_(HW.REQUESTS).getRange(row,2).getValue()):null; }
function hwHistory_(id){ var row=hwFind_(HW.HISTORY,id); return row?JSON.parse(hwSheet_(HW.HISTORY).getRange(row,3).getValue()):null; }
function hwHash_(value){ return syncRevOf_(value); }
function hwKey_(h){ return [String(h.name||'').trim(),String(h.sn||'').trim(),String(h.region||'').trim()].join('\u001f'); }
function hwText_(v,max,label){ var s=String(v==null?'':v).trim(); if(s.length>max) throw new Error(label+'은 '+max+'자 이하로 입력하세요.'); return s; }
function hwDateTime_(v,required,label){
  var s=String(v||'');
  if(!s&&!required) return '';
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) throw new Error(label+' 날짜와 시간을 확인하세요.');
  var d=new Date(s+':00+09:00');
  if(isNaN(d.getTime())||Utilities.formatDate(d,'Asia/Seoul',"yyyy-MM-dd'T'HH:mm")!==s) throw new Error(label+' 날짜가 올바르지 않습니다.');
  return s;
}
function hwAccess_(p){
  var level=verifyLevel_(p.token||''), min=1;
  var menu=menuGet_(); (menu.menu||[]).forEach(function(m){ if(m.id==='hospitalwork') min=Number(m.level)||1; });
  if(level<min) throw new Error('업무관리 접근 권한이 없거나 로그인이 만료되었습니다.');
  var actor=authName_(p.token||'');
  if(!actor) throw new Error('작성자 확인 실패: 서명 토큰 라이브러리와 로그인을 확인하세요.');
  return {name:actor,level:level};
}
function hwLock_(fn){ var l=LockService.getScriptLock(); l.waitLock(10000); try{ return fn(); }finally{ l.releaseLock(); } }
function hwProject_(ev){
  if(ev.hospital) hwPut_(HW.HOSPITALS,ev.hospital.id,[ev.hospital.id,ev.hospital.key,JSON.stringify(ev.hospital)]);
  if(ev.history) hwPut_(HW.HISTORY,ev.history.id,[ev.history.id,ev.history.requestId,JSON.stringify(ev.history)]);
  if(ev.request) hwPut_(HW.REQUESTS,ev.request.id,[ev.request.id,JSON.stringify(ev.request)]);
  SpreadsheetApp.flush();
}
function hwRecover_(){
  var sh=hwSheet_(HW.LOG), n=sh.getLastRow()-1;
  if(n<1) return;
  var cells=sh.getRange(2,4,n,1).createTextFinder('prepared').matchEntireCell(true).findAll();
  cells.sort(function(a,b){return a.getRow()-b.getRow();}).forEach(function(cell){
    var row=cell.getRow(), ev=JSON.parse(sh.getRange(row,5).getValue());
    hwProject_(ev); sh.getRange(row,4).setValue('committed'); SpreadsheetApp.flush();
  });
}
function hwCommit_(p,who,build){
  return hwLock_(function(){
    try{hwRecover_();}catch(recoveryError){recoveryError.retrySameOperation=true;throw recoveryError;}
    return hwCommitLocked_(p,who,build);
  });
}
// Handover 저장 훅과 조회 복구는 이미 같은 ScriptLock을 보유한다.
function hwCommitLocked_(p,who,build){
  if(hwKvMode_())throw new Error('업무 저장소 전환 중이거나 전환됐습니다. 페이지를 새로고침해 주세요.');
  var op=hwText_(p.operationId,90,'operationId');
  if(!/^[A-Za-z0-9_-]{8,90}$/.test(op)) throw new Error('저장 식별자가 없습니다. 다시 시도하세요.');
  var clean=JSON.parse(JSON.stringify(p)); delete clean.token;
  var fingerprint=hwHash_({actor:who.name,payload:clean});
  var sh=hwSheet_(HW.LOG), prev=hwFind_(HW.LOG,op);
  if(prev){
    var row=sh.getRange(prev,1,1,7).getDisplayValues()[0];
    if(row[1]!==who.name||row[2]!==fingerprint) throw new Error('같은 저장 식별자에 다른 내용이 전달되었습니다.');
    return JSON.parse(row[5]);
  }
  var ev=build(); if(ev.response.success===false) return ev.response;
  var eventBody=JSON.stringify(ev);
  if(eventBody.length>44000) throw new Error('기록이 너무 큽니다. 내용을 줄여주세요.');
  var at=sh.getLastRow()+1;
  try{
    sh.getRange(at,1,1,7).setValues([[op,who.name,fingerprint,'prepared',eventBody,JSON.stringify(ev.response),new Date().toISOString()].map(safeCell_)]);
    SpreadsheetApp.flush();
    hwProject_(ev); sh.getRange(at,4).setValue('committed'); SpreadsheetApp.flush();
  }catch(commitError){commitError.retrySameOperation=true;throw commitError;}
  return ev.response;
}
function hwConflict_(current){ return {response:{success:false,conflict:true,current:current,error:'다른 사용자가 수정했습니다. 최신 내용과 입력 내용을 비교하세요.'}}; }
function hwHospital_(key){
  var raw=getHospDBRich_({force:'1'}); if(!raw.success) throw new Error(raw.error);
  var matches=raw.data.filter(function(h){return hwKey_(h)===key;});
  if(matches.length!==1) throw new Error('병원 원본과 일치하지 않거나 중복입니다. 병원을 다시 선택하세요.');
  var row=hwFind_(HW.HOSPITALS,key,2), h=matches[0];
  return {id:row?String(hwSheet_(HW.HOSPITALS).getRange(row,1).getValue()):Utilities.getUuid(),key:key,name:h.name,sn:h.sn,region:h.region};
}
function hwSave_(p,who){
  return hwCommit_(p,who,function(){
    var old=p.id?hwRequest_(p.id):null;
    if(p.id&&!old) throw new Error('요청을 찾지 못했습니다.');
    if(old&&String(old.revision)!==String(p.baseRevision)) return hwConflict_(old);
    var input=p.form||{}, hosp=hwHospital_(hwText_(input.hospitalKey,500,'병원'));
    var r={id:old?old.id:Utilities.getUuid(),hospitalId:hosp.id,hospitalKey:hosp.key,hospitalName:hosp.name,sn:hosp.sn,region:hosp.region,
      symptom:hwText_(input.symptom,4000,'접수 증상'),cs:hwText_(input.cs,60,'CS 담당자'),engineer:hwText_(input.engineer,60,'엔지니어'),
      sales:hwText_(input.sales,60,'영업 담당자'),registeredAt:hwDateTime_(input.registeredAt,true,'등록일시'),
      visitAt:hwDateTime_(input.visitAt,false,'방문일시'),deadline:hwDateTime_(input.deadline,false,'마감'),status:String(input.status||'접수')};
    if(!r.symptom||!r.cs) throw new Error('접수 증상과 CS 담당자를 입력하세요.');
    if(HW.STATUSES.indexOf(r.status)<0) throw new Error('알 수 없는 상태입니다.');
    if(r.status==='완료'&&(!old||old.status!=='완료')) throw new Error('결과를 등록한 후 완료 처리하세요.');
    if(['방문예정','처리중'].indexOf(r.status)>=0&&(!r.visitAt||!r.engineer)) throw new Error('방문 일시와 엔지니어가 필요합니다. 미정이면 접수 상태로 저장하세요.');
    var engineers=getMaster_({}).fse||[];
    if(r.engineer&&engineers.indexOf(r.engineer)<0&&(!old||old.engineer!==r.engineer)) throw new Error('엔지니어 원본 목록에 없는 이름입니다. 목록을 동기화하세요.');
    if(old&&old.hospitalId!==hosp.id&&hwRows_(HW.HISTORY,3).some(function(x){return x[1]===old.id;})) throw new Error('이력이 있는 요청의 병원은 변경할 수 없습니다. 새 요청을 등록하세요.');
    var all=hwRows_(HW.REQUESTS,2).map(function(x){return JSON.parse(x[1]);});
    var duplicates=all.filter(function(x){return x.id!==r.id&&x.hospitalId===r.hospitalId&&['완료','취소'].indexOf(x.status)<0;});
    var overlaps=all.filter(function(x){return x.id!==r.id&&r.engineer&&r.visitAt&&x.engineer===r.engineer&&x.visitAt===r.visitAt&&['완료','취소'].indexOf(x.status)<0;});
    if((duplicates.length||overlaps.length)&&!p.acknowledgeDuplicates) return {response:{success:false,duplicate:true,candidates:duplicates,overlaps:overlaps,error:'진행 중인 요청 또는 같은 엔지니어의 동일 방문 일시가 있습니다. 확인 후 별도 요청으로 저장하세요.'}};
    var now=new Date().toISOString(); r.createdAt=old?old.createdAt:now; r.createdBy=old?old.createdBy:who.name;
    r.updatedAt=now; r.updatedBy=who.name; r.revision=(old?old.revision:0)+1;
    r.latest=old?old.latest:''; r.completedAt=old&&r.status==='완료'?old.completedAt:''; r.completedBy=old&&r.status==='완료'?old.completedBy:'';
    return {kind:old?'request_update':'request_create',before:old,request:r,hospital:hosp,response:{success:true,request:r}};
  });
}
function hwComment_(p,who){
  return hwCommit_(p,who,function(){
    var r=hwRequest_(p.requestId); if(!r) throw new Error('요청 없음');
    var old=p.historyId?hwHistory_(p.historyId):null;
    if(p.historyId&&(!old||old.requestId!==r.id||old.kind!=='comment')) throw new Error('댓글을 찾지 못했습니다.');
    if(old&&old.author!==who.name&&who.level<3) throw new Error('본인 댓글 또는 관리자만 수정할 수 있습니다.');
    if(old&&String(old.revision)!==String(p.baseHistoryRevision)) return hwConflict_(old);
    var body=hwText_(p.body,4000,'댓글'); if(!body) throw new Error('댓글을 입력하세요.');
    var now=new Date().toISOString(), h={id:old?old.id:Utilities.getUuid(),requestId:r.id,kind:'comment',body:body,
      author:old?old.author:who.name,createdAt:old?old.createdAt:now,updatedAt:now,updatedBy:who.name,revision:(old?old.revision:0)+1};
    var before=JSON.parse(JSON.stringify(r)); r.revision++; r.updatedAt=now;r.updatedBy=who.name;r.latest=body.slice(0,120);
    return {kind:old?'comment_update':'comment_add',before:old,history:h,request:r,requestBefore:before,response:{success:true,request:r,history:h}};
  });
}
function hwSource_(o){
  var s=slim_(o);
  var out={date:_issueDateNorm_(s.date),hospitalName:s.hosp,engineer:s.fse,sn:pickH_(o,['장비SN','장비 SN','장비 S/N','S/N(장비)','SN']),gubun:s.gubun,cat:s.cat,type:s.type,
    part:s.part,cost:s.cost,detail:s.detail,result:pickH_(o,HANDOVER_FIELD_COLS.result)||'',remark:pickH_(o,HANDOVER_FIELD_COLS.remark)||'',
    nozzleReuse:pickH_(o,['노즐 재사용','노즐재사용'])||'',nsFill:s.nsFill||'',nsAmt:s.nsAmt||'',jet:s.jet||''};
  out.version=hwHash_(out); out.recordId=String(pickH_(o,REC_ID_COLS)||'').trim();
  if(!out.recordId) out.recordId='legacy_'+Number(o._row)+'_'+out.version;
  return out;
}
function hwSourceName_(name){return String(name||'').normalize('NFKC').replace(/[\s_]+/g,'').replace(/의원/g,'').toLowerCase();}
function hwSourceAlias_(source,hosp){
  if(source.hospitalName!==hosp){source.sourceHospitalName=source.hospitalName;source.hospitalName=hosp;}return source;
}
function hwSources_(hosp){
  // 직접 최신 원본 읽기: recent의 부분 일치·불완전한 slim 응답·오래된 캐시를 사용하지 않는다.
  var sh=hwSS_().getSheetByName(CONFIG.SHEET_NAME),hdr=sh&&findHeader_(sh);
  if(!hdr) throw new Error('Handover 원본 헤더를 찾지 못했습니다.');
  var col=hdr.headers.indexOf('병원명')+1;if(!col) throw new Error('Handover 병원명 열 없음');
  var requested=String(hosp).trim(),n=lastDataRow_(sh,hdr)-hdr.row,names=n>0?sh.getRange(hdr.row+1,col,n,1).getDisplayValues():[],aliases={};
  names.forEach(function(v){var name=String(v[0]||'').trim();if(hwSourceName_(name)===hwSourceName_(requested))aliases[name]=true;});
  var rows=[];Object.keys(aliases).forEach(function(name){rows=rows.concat(hwMatchedRows_(sh,col,name,true,1,sh.getLastColumn(),hdr.row+1,lastDataRow_(sh,hdr)));});
  return rows.map(function(hit){var o={_row:hit.row};hdr.headers.forEach(function(h,c){if(h)o[h]=hit.values[c];});return o;})
    .filter(function(o){return o['처리일']&&hwSourceName_(o['병원명'])===hwSourceName_(requested);}).map(function(o){return {raw:o,source:hwSourceAlias_(hwSource_(o),requested)};});
}
function hwGetSource_(r,p){
  var matches=hwSources_(r.hospitalName).filter(function(x){
    if(x.source.recordId===p.recordId) return true;
    var legacy=String(p.recordId||'').match(/^legacy_(\d+)_(.+)$/);
    return legacy&&Number(x.raw._row)===Number(legacy[1])&&x.source.version===legacy[2];
  });
  if(matches.length!==1) throw new Error('원본이 없거나 식별자가 중복·변경되었습니다. 다시 불러오세요.');
  if(['A/S','점검'].indexOf(matches[0].source.gubun)<0) throw new Error('A/S 또는 점검 기록을 선택하세요.');
  if(hwKvMode_()&&matches[0].source.recordId.indexOf('legacy_')===0)hwLock_(function(){hwKvStableSource_(matches[0]);});
  return matches[0];
}
function hwResult_(p,who){
  return hwCommit_(p,who,function(){
    var r=hwRequest_(p.requestId); if(!r) throw new Error('요청 없음');
    if(String(r.revision)!==String(p.baseRevision)) return hwConflict_(r);
    var hit=hwGetSource_(r,p), s=hit.source;
    if(s.version!==p.sourceVersion) throw new Error('미리보기 후 Handover 원본이 바뀌었습니다. 다시 불러와 확인하세요.');
    if(s.recordId.indexOf('legacy_')===0){
      var sh=hwSS_().getSheetByName(CONFIG.SHEET_NAME), hdr=findHeader_(sh), col=colBy_(hdr,REC_ID_COLS);
      if(!col){ col=sh.getLastColumn()+1; sh.getRange(hdr.row,col).setValue('기록 ID'); }
      s.recordId=Utilities.getUuid(); sh.getRange(hit.raw._row,col).setValue(s.recordId); SpreadsheetApp.flush(); bazDropHandoverCaches_(r.hospitalName);
    }
    var histories=hwRows_(HW.HISTORY,3).map(function(x){return JSON.parse(x[2]);});
    var same=histories.filter(function(x){return x.kind==='result'&&x.source.recordId===s.recordId;});
    if(same.some(function(x){return x.requestId!==r.id;})) throw new Error('이 Handover 결과는 다른 요청에 연결되어 있습니다. 해당 요청을 먼저 확인하세요.');
    var old=same[0]||null;
    if(old&&String(old.revision)!==String(p.baseHistoryRevision)) return hwConflict_(old);
    var memo=hwText_(p.memo,2000,'고객센터 보완 메모');
    var now=new Date().toISOString(), before=JSON.parse(JSON.stringify(r));
    var h={id:old?old.id:Utilities.getUuid(),requestId:r.id,kind:'result',source:s,body:s.detail,memo:memo,
      author:old?old.author:who.name,createdAt:old?old.createdAt:now,updatedAt:now,updatedBy:who.name,revision:(old?old.revision:0)+1};
    r.revision++;r.updatedAt=now;r.updatedBy=who.name;r.latest=s.result||s.detail.slice(0,120);
    // 원본 갱신으로 이미 완료된 업무를 재개하지 않는다.
    r.status=p.complete||r.status==='완료'?'완료':'결과확인';
    if(p.complete){ r.completedAt=r.completedAt||now;r.completedBy=r.completedBy||who.name; }
    return {kind:'result_save',before:old,requestBefore:before,request:r,history:h,response:{success:true,request:r,history:h}};
  });
}
function hwAutoPair_(name,date){ return JSON.stringify([String(name||'').trim(),String(date||'')]); }
function hwAutoDate_(r){ return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(r.visitAt||'')?r.visitAt.slice(0,10):''; }
function hwAutoSources_(pairs){
  var sh=hwSS_().getSheetByName(CONFIG.SHEET_NAME),hdr=sh&&findHeader_(sh);
  if(!hdr) throw new Error('Handover 원본 헤더를 찾지 못했습니다.');
  var dc=colBy_(hdr,['처리일']),hc=colBy_(hdr,['병원명']),start=Math.min(dc,hc),width=Math.abs(dc-hc)+1,n=sh.getLastRow()-hdr.row;
  if(!dc||!hc) throw new Error('Handover 병원명·처리일 열을 확인하세요.');
  // 전체 보고서 대신 병원명/처리일 열만 읽고, 일치하는 원본 행만 묶어서 읽는다.
  var keys=n>0?sh.getRange(hdr.row+1,start,n,width).getDisplayValues():[],positions=[],hits=[],aliases={};
  Object.keys(pairs).forEach(function(k){var p=JSON.parse(k),normalized=hwAutoPair_(hwSourceName_(p[0]),p[1]);(aliases[normalized]||(aliases[normalized]=[])).push(p[0]);});
  keys.forEach(function(v,i){var names=aliases[hwAutoPair_(hwSourceName_(v[hc-start]),_issueDateNorm_(v[dc-start]))];if(names&&names.length===1)positions.push(hdr.row+1+i);});
  for(var i=0;i<positions.length;){
    var first=positions[i],last=first;i++;
    while(i<positions.length&&positions[i]===last+1){last=positions[i];i++;}
    sh.getRange(first,1,last-first+1,sh.getLastColumn()).getDisplayValues().forEach(function(v,j){
      var raw={_row:first+j};hdr.headers.forEach(function(h,c){if(h)raw[h]=v[c];});
      var source=hwSource_(raw),names=aliases[hwAutoPair_(hwSourceName_(source.hospitalName),source.date)];if(['A/S','점검'].indexOf(source.gubun)>=0&&names&&names.length===1)hits.push({raw:raw,source:hwSourceAlias_(source,names[0])});
    });
  }
  return hits;
}
function hwAutoReconcileLocked_(target){
  if(hwKvMode_())return {completed:[],skipped:[]};
  target=target||{};
  var all=hwRows_(HW.REQUESTS,2).map(function(x){return JSON.parse(x[1]);}),counts=Object.create(null),pairs=Object.create(null);
  all.forEach(function(r){var date=hwAutoDate_(r);if(date&&r.status!=='취소'){var key=hwAutoPair_(r.hospitalName,date);counts[key]=(counts[key]||0)+1;}});
  var eligible=all.filter(function(r){
    var date=hwAutoDate_(r);
    return date&&['접수','방문예정','처리중','결과확인'].indexOf(r.status)>=0&&(!target.requestId||target.requestId===r.id)
      &&(!target.hospitalName||String(r.hospitalName).trim()===String(target.hospitalName).trim())&&(!target.date||date===target.date);
  });
  var summary={completed:[],skipped:[]};if(!eligible.length)return summary;
  eligible.forEach(function(r){pairs[hwAutoPair_(r.hospitalName,hwAutoDate_(r))]=true;});
  var sources=hwAutoSources_(pairs),histories=hwAutoHistories_(eligible,sources);
  var who={name:'Handover 자동 연결',level:0};
  eligible.forEach(function(r){
    var date=hwAutoDate_(r),key=hwAutoPair_(r.hospitalName,date),matches=sources.filter(function(x){return hwAutoPair_(x.source.hospitalName,x.source.date)===key;});
    if(!matches.length)return;
    function skip(reason,message){summary.skipped.push({requestId:r.id,reason:reason,message:message});}
    if(counts[key]!==1){skip('requests','같은 병원·방문일의 업무가 여러 건입니다. Handover 결과를 직접 선택하세요.');return;}
    if(matches.length!==1){skip('sources','같은 병원·처리일의 A/S 기록이 여러 건입니다. Handover 결과를 직접 선택하세요.');return;}
    var hit=matches[0],s=hit.source;
    if(!s.result){skip('result','Handover 처리 결과가 미기록입니다. 원본 확인 후 직접 연결하세요.');return;}
    if(r.sn&&s.sn&&String(r.sn).trim()!==String(s.sn).trim()){skip('sn','접수 장비와 Handover 장비 S/N이 다릅니다. 직접 확인하세요.');return;}
    var resultHistories=histories.filter(function(h){return h.kind==='result'&&h.requestId===r.id;});
    if(resultHistories.some(function(h){return h.auto;})){skip('reopened','자동 완료 후 다시 열린 업무입니다. 기존 결과를 검토 후 완료하세요.');return;}
    if(resultHistories.length>1||resultHistories.some(function(h){return h.source.recordId!==s.recordId;})){skip('existing','이미 선택한 결과가 있습니다. 해당 결과를 검토 후 완료하세요.');return;}
    if(histories.some(function(h){return h.kind==='result'&&h.source.recordId===s.recordId&&h.requestId!==r.id;})){skip('linked','이 Handover 결과는 다른 업무에 연결되어 있습니다.');return;}
    if(s.recordId.indexOf('legacy_')===0){
      var sh=hwSS_().getSheetByName(CONFIG.SHEET_NAME),hdr=findHeader_(sh),col=colBy_(hdr,REC_ID_COLS);
      if(!col){col=sh.getLastColumn()+1;sh.getRange(hdr.row,col).setValue('기록 ID');}
      s.recordId=Utilities.getUuid();sh.getRange(hit.raw._row,col).setValue(s.recordId);SpreadsheetApp.flush();bazDropHandoverCaches_(r.hospitalName);
    }else{
      var sourceSheet=hwSS_().getSheetByName(CONFIG.SHEET_NAME),sourceHeader=findHeader_(sourceSheet),idCol=colBy_(sourceHeader,REC_ID_COLS),n=sourceSheet.getLastRow()-sourceHeader.row;
      if(!idCol||sourceSheet.getRange(sourceHeader.row+1,idCol,n,1).createTextFinder(s.recordId).matchEntireCell(true).findAll().length!==1){skip('id','Handover 기록 ID가 중복되어 자동 연결하지 않았습니다.');return;}
    }
    var old=resultHistories[0]||null,p={action:'work_auto_result',requestId:r.id,recordId:s.recordId,sourceVersion:s.version,visitDate:date,baseRevision:r.revision,
      operationId:'auto_'+hwHash_([r.id,s.recordId,s.version,r.revision])};
    var saved=hwCommitLocked_(p,who,function(){
      var now=new Date().toISOString(),before=JSON.parse(JSON.stringify(r));
      var h={id:old?old.id:Utilities.getUuid(),requestId:r.id,kind:'result',source:s,body:s.detail,memo:old?old.memo||'':'',auto:true,
        author:old?old.author:who.name,createdAt:old?old.createdAt:now,updatedAt:now,updatedBy:who.name,revision:(old?old.revision:0)+1};
      r.revision++;r.updatedAt=now;r.updatedBy=who.name;r.latest=s.result||s.detail.slice(0,120);r.status='완료';r.completedAt=now;r.completedBy=who.name;
      return {kind:'result_auto',before:old,requestBefore:before,request:r,history:h,response:{success:true,request:r,history:h}};
    });
    histories.push(saved.history);summary.completed.push({requestId:r.id,recordId:s.recordId});
  });
  return summary;
}
function hwAutoHistories_(eligible,sources){
  // 상세 1건에서는 해당 업무/원본을 참조하는 이력만 읽는다. 큰 동기화는 한 번에 읽는다.
  if(eligible.length+sources.length>8) return hwRows_(HW.HISTORY,3).map(function(x){return JSON.parse(x[2]);});
  var sh=hwSheet_(HW.HISTORY),rows={};
  eligible.forEach(function(r){hwMatchedRows_(sh,2,r.id,true,3,1).forEach(function(x){rows[x.row]=x.values[0];});});
  sources.forEach(function(s){hwMatchedRows_(sh,3,JSON.stringify(s.source.recordId),false,3,1).forEach(function(x){rows[x.row]=x.values[0];});});
  return Object.keys(rows).map(function(row){return JSON.parse(rows[row]);});
}
// doPost가 원본 행/사진 저장을 확정한 뒤, 기존 ScriptLock 안에서 호출한다.
function hospitalWorkHandoverSaved_(hospitalName,date){
  if(hwKvMode_()){hwKvQueueSources_(hospitalName,date);return {enabled:true,pending:true,completed:0};}
  hwResetContext_();
  if(!PropertiesService.getScriptProperties().getProperty('HOSPITAL_WORK_SS_ID'))return {enabled:false};
  hwRecover_();var summary=hwAutoReconcileLocked_({hospitalName:hospitalName,date:_issueDateNorm_(date)});
  return {enabled:true,completed:summary.completed.length,needsReview:summary.skipped.length};
}
function hwReadWithAuto_(fn,target){return hwRead_(function(){return fn(hwAutoReconcileLocked_(target));});}
function hwComplete_(p,who){
  return hwCommit_(p,who,function(){
    var r=hwRequest_(p.requestId);if(!r) throw new Error('요청 없음');
    if(String(r.revision)!==String(p.baseRevision)) return hwConflict_(r);
    if(!hwRows_(HW.HISTORY,3).some(function(x){return x[1]===r.id&&JSON.parse(x[2]).kind==='result';})) throw new Error('Handover 결과를 등록한 후 완료 처리하세요.');
    var before=JSON.parse(JSON.stringify(r)), now=new Date().toISOString();
    r.status='완료';r.completedAt=r.completedAt||now;r.completedBy=r.completedBy||who.name;r.updatedAt=now;r.updatedBy=who.name;r.revision++;
    return {kind:'complete',before:before,request:r,response:{success:true,request:r}};
  });
}
function hwRead_(fn){ return hwLock_(function(){hwRecover_();return fn();}); }
function hospitalWorkGet_(p){
  hwResetContext_();
  try{
    var who=hwAccess_(p); hwSS_();
    if(hwKvMode_()&&['work_handover_candidates','work_handover_detail'].indexOf(p.action)<0)return {success:false,error:'업무 저장소가 전환됐습니다. 페이지를 새로고침해 주세요.',storage:'kv',upgradeRequired:true};
    if(p.action==='work_bootstrap'){
      var data=hwReadWithAuto_(function(auto){return {requests:hwRows_(HW.REQUESTS,2).map(function(x){return JSON.parse(x[1]);}),autoMatch:auto};});
      var out={success:true,requests:data.requests,autoMatch:data.autoMatch,who:who,updatedAt:new Date().toISOString(),referencesIncluded:false};
      if(String(p.omitReferences||'')!=='1'||String(p.force||'')==='1'){
        var db=getHospDBRich_({force:String(p.force||'')==='1'?'1':'0'});if(!db.success) throw new Error(db.error);
        var master=getMaster_({force:String(p.force||'')==='1'?'1':'0'});
        if(master.success===false) throw new Error(master.error||'담당자 목록 조회 실패');
        out.hospitals=db.data.map(function(h){h.key=hwKey_(h);return h;});out.engineers=master.fse||[];out.referencesIncluded=true;
      }
      return out;
    }
    if(p.action==='work_sync') return hwReadWithAuto_(function(auto){
      var list=hwRows_(HW.REQUESTS,2).map(function(x){return JSON.parse(x[1]);}), rev=hwHash_(list);
      return {success:true,revision:rev,nochange:rev===p.revision,requests:rev===p.revision?null:list,autoMatch:auto,updatedAt:new Date().toISOString()};
    });
    if(p.action==='work_detail') return hwReadWithAuto_(function(auto){
      var r=hwRequest_(p.id);if(!r) throw new Error('요청 없음');
      var history=hwMatchedRows_(hwSheet_(HW.HISTORY),2,r.id,true,3,1).map(function(x){return JSON.parse(x.values[0]);});
      var requests=hwRows_(HW.REQUESTS,2).map(function(x){return JSON.parse(x[1]);}).filter(function(x){return x.hospitalId===r.hospitalId;});
      var logs=hwMatchedRows_(hwSheet_(HW.LOG),5,JSON.stringify(r.id),false,4,2).filter(function(x){return x.values[0]==='committed';}).map(function(x){return JSON.parse(x.values[1]);}).filter(function(x){return x.request&&x.request.id===r.id;}).map(function(x){
        return {kind:x.kind,at:x.request.updatedAt,actor:x.request.updatedBy,before:x.before,requestBefore:x.requestBefore,after:x.history||x.request};
      });
      return {success:true,request:r,history:history,requests:requests,logs:logs,autoMatch:auto,updatedAt:new Date().toISOString()};
    },{requestId:p.id});
    if(p.action==='work_handover_candidates'){
      var kv=hwKvMode_(),r=kv?null:hwRead_(function(){return hwRequest_(p.requestId);});
      var hosp=kv?hwText_(p.hospitalName,120,'병원'):(r?r.hospitalName:hwText_(p.hospitalName,120,'병원'));
      if(!hosp) throw new Error('병원 선택 필요');
      var hits=hwSources_(hosp).filter(function(x){return ['A/S','점검'].indexOf(x.source.gubun)>=0;});
      if(kv){
        hits.forEach(function(hit){hit.source.observedAt=new Date().toISOString();});
        var unstable=hits.filter(function(hit){return hit.source.recordId.indexOf('legacy_')===0;});
        if(unstable.length)hwLock_(function(){unstable.forEach(hwKvStableSource_);});
      }
      var sources=hits.map(function(x){return x.source;}).sort(function(a,b){return b.date.localeCompare(a.date);});
      return {success:true,data:sources.slice(0,100),total:sources.length,updatedAt:new Date().toISOString()};
    }
    if(p.action==='work_handover_detail'){
      var r=hwKvMode_()?{hospitalName:hwText_(p.hospitalName,120,'병원')}:hwRead_(function(){return hwRequest_(p.requestId);});if(!r||!r.hospitalName) throw new Error('요청 없음');
      return {success:true,source:hwGetSource_(r,p).source,updatedAt:new Date().toISOString()};
    }
    throw new Error('알 수 없는 업무 조회');
  }catch(e){return {success:false,error:String(e.message||e)};}
}
function hospitalWorkPost_(p){
  hwResetContext_();
  try{
    var who=hwAccess_(p);
    if(hwKvMode_())return {success:false,error:'업무 저장소가 전환됐습니다. 페이지를 새로고침해 주세요.',storage:'kv',upgradeRequired:true};
    if(p.action==='work_save')return hwSave_(p,who);
    if(p.action==='work_history_add'||p.action==='work_history_update')return hwComment_(p,who);
    if(p.action==='work_result_save')return hwResult_(p,who);
    if(p.action==='work_complete')return hwComplete_(p,who);
    throw new Error('알 수 없는 업무 저장');
  }catch(e){return {success:false,error:String(e.message||e),retrySameOperation:!!e.retrySameOperation};}
}

