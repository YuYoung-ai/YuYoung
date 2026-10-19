/* Handover replacement inventory v1.
 * Non-serial parts use explicit product tabs, complete unit issues and a durable
 * source-book queue. Handpiece keeps invRecordHandpieceUsage_ unchanged.
 * Install: setupReplacementInventory() once, then update the existing web app.
 */
var INV_REPLACEMENT = {
  VERSION: 1, QUEUE: '교체품 반영대기', BATCH: 20,
  EXCLUDE: ['없음','재체결','내부 세척','대체장비입고'],
  PARTS: ["없음","Handpiece Ass'y","Foot-SW Ass'y","Foot-SW Connector(장비)","Top Cover Ass'y","Main Board","RFID Module","LCD + Raspberry Pi Ass'y","SD Card","HP / SD Card","On / Off Swich","On / Off Key","Emergency Switch","Power Adaptor","Power Cable","Water Tank","Water Pump","Caster","Arm","Arm Holder","AC Cord","Cradle (거치대)","Nozzle","Nozzle Spanner","Perm-Holder","Piston (V 1.0)","Piston (V 1.1)","Piston (V 1.2)","Bush Bobbin","Spring","Plunger (V 1.2.1)","Plunger (V 1.2.2)","Adaptor(1.0)","Adaptor(1.1)","Damper","Spacer","Wrench Bolt (수평)","Wrench Bolt (수직)","대체장비입고","재체결","내부 세척","Spring(1.0)","Power Key","Plunger(1.2.1)","HP-Cradle Ass'y(거치대)","Adaptor","Holder","Water tank Ass'y","RFID Module A'ssy","Fan","Foot-SW cable","Foot-SW Ass'y (Repair)"],
  HEADERS: ['품명','불출처','입고일','입고처','입고수량','SN','출고일','출고처','출고수량','SN','사용일','사용자','사용처','사용수량','SN','ERP회수처리','리페어 출고 일자','비고',
            '원본 기록 ID','반영 상태','원본 교체품','재고 구분','반영 일시','반영 메모'],
  TRACK: ['원본 기록 ID','반영 상태','원본 교체품','재고 구분','반영 일시','반영 메모'],
  QUEUE_HEADERS: ['기록 ID','처리일','교체품','품목','재고 구분','담당 FSE','병원명','요청 수량','상태','대상 시트','대상 행','메시지','최종 확인','요청 본문']
};
function invPartKey_(s){ return String(s||'').trim().replace(/\s+/g,'').toLowerCase(); }
function invExcluded_(part){
  var key=invPartKey_(part);
  return !key || INV_REPLACEMENT.EXCLUDE.some(function(p){return invPartKey_(p)===key;});
}
function invPartConfig_(part){
  var raw=String(part||'').trim(), key=invPartKey_(raw);
  if(invExcluded_(raw)) return null;
  var partName=INV_REPLACEMENT.PARTS.filter(function(p){return invPartKey_(p)===key;})[0] || raw;
  if(key===invPartKey_("HP-Cradle Ass'y(거치대)"))partName='Cradle (거치대)';
  if(key===invPartKey_("Handpiece Ass'y"))return {part:partName,kind:'handpiece'};
  var known={};
  known[invPartKey_("Foot-SW Ass'y")]=['CS 재고 수량(풋스위치)','새제품',['풋스위치신형']];
  known[invPartKey_("Foot-SW Ass'y (Repair)")]=['CS 재고 수량(풋스위치 Repair)','Repair',['풋스위치신형']];
  known[invPartKey_('Foot-SW Connector(장비)')]=['CS 재고 수량(Foot Switch Connector(F))','새제품',['풋스위치 커넥터(장비쪽)']];
  known[invPartKey_('Cradle (거치대)')]=['CS 재고 수량(HP 거치대)','새제품',['핸드피스 거치대',"HP-Cradle Ass'y(거치대)"]];
  known[invPartKey_("HP-Cradle Ass'y(거치대)")]=known[invPartKey_('Cradle (거치대)')];
  known[invPartKey_('Power Cable')]=['CS 재고 수량(Power Cable)','새제품',['장비 파워 케이블']];
  var cfg=known[key], title=cfg?cfg[0]:'CS 재고 수량('+partName.replace(/[\\\/?*\[\]:]/g,'·')+')';
  if(title.length>100) throw new Error('재고 탭 이름이 너무 깁니다: '+partName);
  return {part:partName,kind:'part',sheet:title,condition:cfg?cfg[1]:'새제품',names:[partName].concat(cfg?cfg[2]:[])};
}
function invColumn_(headers,name){return headers.indexOf(name)+1;}
function invQueueSheet_(){
  var sh=ss_().getSheetByName(INV_REPLACEMENT.QUEUE);
  if(!sh){
    sh=ss_().insertSheet(INV_REPLACEMENT.QUEUE);
    sh.getRange(1,1,1,INV_REPLACEMENT.QUEUE_HEADERS.length).setValues([INV_REPLACEMENT.QUEUE_HEADERS]);
    sh.setFrozenRows(1);
  }
  var headers=sh.getRange(1,1,1,INV_REPLACEMENT.QUEUE_HEADERS.length).getDisplayValues()[0];
  if(headers.join('|')!==INV_REPLACEMENT.QUEUE_HEADERS.join('|'))throw new Error('교체품 반영대기 헤더가 변경되었습니다.');
  return sh;
}
function invFindId_(sh,start,col,id){
  var n=sh.getLastRow()-start+1;
  if(n<1)return 0;
  var hit=sh.getRange(start,col,n,1).createTextFinder(id).matchEntireCell(true).findNext();
  return hit?hit.getRow():0;
}
function invEnsurePartSheet_(book,cfg){
  // Exact title only: never substring-match a different product or Repair tab.
  var sh=book.getSheetByName(cfg.sheet);
  if(!sh){
    sh=book.insertSheet(cfg.sheet);
    if(sh.getMaxColumns()<24)sh.insertColumnsAfter(sh.getMaxColumns(),24-sh.getMaxColumns());
    sh.getRange(1,1,1,2).setValues([[cfg.part,'입출고 정보를 먼저 등록하세요. 한 행은 출고 1개입니다.']]);
    sh.getRange(3,1,1,2).setValues([['CS 사무실 재고','=SUM(E10:E)-SUM(I10:I)']]);
    sh.getRange(9,1,1,24).setValues([INV_REPLACEMENT.HEADERS]);
    sh.setFrozenRows(9);
  }
  var m=findLedgerCols_(sh);
  if(!m)throw new Error(cfg.sheet+'의 품명/사용일 헤더를 찾을 수 없습니다.');
  var width=Math.max(sh.getLastColumn(),24), h=sh.getRange(m.row,1,1,width).getDisplayValues()[0];
  INV_REPLACEMENT.TRACK.forEach(function(name){
    if(invColumn_(h,name))return;
    // Reserve empty tail cells without replacing any existing column.
    var at=Math.max(18,h.reduce(function(last,v,i){return String(v).trim()?i+1:last;},0))+1;
    if(at>sh.getMaxColumns())sh.insertColumnsAfter(sh.getMaxColumns(),at-sh.getMaxColumns());
    sh.getRange(m.row,at).setValue(name);h[at-1]=name;
  });
  return {sheet:sh,map:m,headers:h};
}
function invPartRequest_(p,cfg){
  var id=String(p.reqId||'').trim();
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(id))throw new Error('재고 반영에 유효한 기록 ID가 필요합니다.');
  var req={reqId:id,date:String(p.date||Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd')).trim(),
    hosp:String(p.hosp||'').trim(),fse:String(p.fse||'').trim(),part:String(p.part||'').trim(),
    canonical:cfg.part,sheet:cfg.sheet,condition:cfg.condition,qty:1};
  if(!req.hosp||!req.fse||!/^\d{4}-\d{2}-\d{2}$/.test(req.date))throw new Error('재고 반영 병원·담당자·처리일을 확인하세요.');
  return req;
}
function invQueueUpdate_(sh,row,req,status,result){
  var values=[req.reqId,req.date,req.part,req.canonical,req.condition,req.fse,req.hosp,1,status,
    req.sheet,result.row||'',result.msg||'',new Date().toISOString(),JSON.stringify(req)];
  sh.getRange(row,1,1,values.length).setValues([values.map(safeCell_)]);
}
function invQueueRequest_(req){
  var sh=invQueueSheet_(), row=invFindId_(sh,2,1,req.reqId);
  if(row){
    var old=String(sh.getRange(row,14).getValue()||'');
    if(old!==JSON.stringify(req))throw new Error('동일 기록 ID의 교체품 내용이 다릅니다. 재고 이력을 확인하세요.');
  }else{
    row=sh.getLastRow()+1;
    if(row>sh.getMaxRows())sh.insertRowAfter(sh.getMaxRows());
    invQueueUpdate_(sh,row,req,'대기',{msg:'입출고 확인 대기'});
  }
  return {sheet:sh,row:row};
}
function invUsageMatches_(sh,row,m,req){
  var vals=sh.getRange(row,1,1,sh.getLastColumn()).getDisplayValues()[0];
  return String(vals[m['사용일']-1]).trim()!=='' &&
    String(vals[m['사용자']-1]).trim()===req.fse &&
    String(vals[m['사용처']-1]).trim()===req.hosp &&
    Number(vals[m['사용수량']-1])===1;
}
function invApplyPart_(book,req,cfg){
  var target=invEnsurePartSheet_(book,cfg), sh=target.sheet, m=target.map, h=target.headers;
  var required=['품명','불출처','입고일','입고처','입고수량','출고일','출고처','출고수량','사용일','사용자','사용처','사용수량'];
  var cols={}; h.forEach(function(v,i){if(v&&!cols[v])cols[v]=i+1;});
  var missing=required.filter(function(k){return !cols[k];});
  if(missing.length)throw new Error(cfg.sheet+' 필수 열 없음: '+missing.join(', '));
  var idCol=cols['원본 기록 ID'], existing=invFindId_(sh,m.row+1,idCol,req.reqId);
  if(existing){
    if(!invUsageMatches_(sh,existing,m,req))return {done:false,pending:false,review:true,row:existing,
      msg:'재고['+cfg.sheet+'] 기록 ID는 있으나 사용내역이 변경됐습니다. 관리자 확인 필요'};
    return {done:true,pending:false,row:existing,sheet:cfg.sheet,msg:'재고['+cfg.sheet+'] 기존 반영 확인 (행 '+existing+')'};
  }
  var n=sh.getLastRow()-m.row, width=Math.max(sh.getLastColumn(),24), issues=[], chosen=0;
  var vals=n>0?sh.getRange(m.row+1,1,n,width).getDisplayValues():[];
  for(var i=0;i<vals.length;i++){
    var v=vals[i], row=m.row+1+i;
    if(v[idCol-1])continue;
    if(!cfg.names.some(function(name){return invPartKey_(name)===invPartKey_(v[cols['품명']-1]);}))continue;
    if(String(v[cols['출고처']-1]).trim()!==req.fse)continue;
    // Any existing use field is occupied; do not repair/overwrite legacy partial rows.
    if(['사용일','사용자','사용처','사용수량'].some(function(k){return String(v[cols[k]-1]||'').trim()!=='';}))continue;
    var absent=['불출처','입고일','입고처','입고수량','출고일','출고처','출고수량'].filter(function(k){return String(v[cols[k]-1]||'').trim()==='';});
    if(absent.length){if(issues.length<3)issues.push(row+'행 '+absent.join('/'));continue;}
    var inQty=Number(String(v[cols['입고수량']-1]).replace(/,/g,'')), outQty=Number(String(v[cols['출고수량']-1]).replace(/,/g,''));
    if(!(inQty>=1)||outQty!==1){if(issues.length<3)issues.push(row+'행 수량 확인(출고 1개씩 행 분리)');continue;}
    chosen=row;break;
  }
  if(!chosen)return {done:false,pending:true,sheet:cfg.sheet,
    msg:'재고 반영대기 ['+cfg.sheet+']: '+(issues.length?issues.join('; '):req.fse+' 담당자 출고분·필수 입출고 정보를 등록하세요.')};
  // Usage and record ID are written in the same range operation. Preserve all
  // unrelated cells and formulas between those columns, including ERP checkboxes.
  var useCols=['사용일','사용자','사용처','사용수량'], all=useCols.concat(INV_REPLACEMENT.TRACK).map(function(k){return cols[k];});
  var start=Math.min.apply(null,all), end=Math.max.apply(null,all), rng=sh.getRange(chosen,start,1,end-start+1);
  var write=rng.getValues()[0], formulas=rng.getFormulas()[0];
  formulas.forEach(function(f,i){if(f)write[i]=f;});
  var data={'사용일':req.date,'사용자':req.fse,'사용처':req.hosp,'사용수량':1,'원본 기록 ID':req.reqId,
    '반영 상태':'완료','원본 교체품':req.part,'재고 구분':req.condition,'반영 일시':new Date().toISOString(),'반영 메모':'Handover 자동 반영'};
  Object.keys(data).forEach(function(k){write[cols[k]-start]=safeCell_(data[k]);});
  try{rng.setValues([write]);}
  catch(err){
    // An uncertain write may already be committed: check its durable marker before retry.
    if(invFindId_(sh,m.row+1,idCol,req.reqId)!==chosen||!invUsageMatches_(sh,chosen,m,req))throw err;
  }
  return {done:true,pending:false,row:chosen,sheet:cfg.sheet,msg:'재고['+cfg.sheet+'] '+req.fse+' → '+req.hosp+' 반영 (행 '+chosen+')'};
}
function invRecordUsage_(p){
  if(invExcluded_(p.part))return {done:false,pending:false,excluded:true,msg:''};
  var cfg=invPartConfig_(p.part);
  if(cfg.kind==='handpiece')return invRecordHandpieceUsage_(p);
  var req,queue;
  try{
    req=invPartRequest_(p,cfg);
    queue=invQueueRequest_(req); // Source book is durable even if target access fails.
    var result=invApplyPart_(invOpen_(),req,cfg);
    invQueueUpdate_(queue.sheet,queue.row,req,result.done?'완료':result.review?'확인필요':'대기',result);
    return result;
  }catch(e){
    var failure={done:false,pending:!!queue,review:!queue,msg:(queue?'재고 반영대기: ':'재고 확인필요 — 대기목록 저장 실패: ')+String(e)};
    if(queue)try{invQueueUpdate_(queue.sheet,queue.row,req,'대기',failure);}catch(ignore){}
    return failure;
  }
}
function syncReplacementInventory(){
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(1000))return {busy:true};
  try{
    var queue=invQueueSheet_(), n=queue.getLastRow()-1, done=0, pending=0, checked=0;
    if(n<1)return {checked:0,done:0,pending:0};
    var rows=queue.getRange(2,1,n,14).getDisplayValues().map(function(v,i){return {v:v,row:i+2};}), book=null;
    // Old unresolved entries must not starve later requests on every trigger run.
    rows.sort(function(a,b){return String(a.v[12]).localeCompare(String(b.v[12]));});
    for(var i=0;i<rows.length&&checked<INV_REPLACEMENT.BATCH;i++){
      if(rows[i].v[8]!=='대기')continue;
      checked++;
      var req=null, validated=false;
      try{
        req=JSON.parse(rows[i].v[13]);
        var cfg=invPartConfig_(req.part);
        if(!cfg||cfg.kind!=='part'||cfg.sheet!==req.sheet)throw new Error('대기 품목/대상 시트 확인 필요');
        if(req.reqId!==rows[i].v[0]||JSON.stringify(invPartRequest_(req,cfg))!==JSON.stringify(req))throw new Error('대기 요청 본문 확인 필요');
        validated=true;
        if(!book)book=invOpen_();
        var result=invApplyPart_(book,req,cfg);
        invQueueUpdate_(queue,rows[i].row,req,result.done?'완료':result.review?'확인필요':'대기',result);
        if(result.done)done++;else pending++;
      }catch(e){
        pending++;
        try{
          if(validated)invQueueUpdate_(queue,rows[i].row,req,'대기',{msg:String(e)});
          else{queue.getRange(rows[i].row,9).setValue('확인필요');queue.getRange(rows[i].row,12).setValue(String(e));}
        }catch(ignore){}
      }
    }
    return {checked:checked,done:done,pending:pending};
  }finally{lock.releaseLock();}
}
function setupReplacementInventory(){
  var lock=LockService.getScriptLock();lock.waitLock(20000);
  try{
    var book=invOpen_(), created=[], seen={};
    INV_REPLACEMENT.PARTS.forEach(function(part){
      var cfg=invPartConfig_(part);
      if(!cfg||cfg.kind!=='part'||seen[cfg.sheet])return;
      seen[cfg.sheet]=true;invEnsurePartSheet_(book,cfg);created.push(cfg.sheet);
    });
    invQueueSheet_();
    if(!ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='syncReplacementInventory';})){
      ScriptApp.newTrigger('syncReplacementInventory').timeBased().everyMinutes(5).create();
    }
    return {success:true,inventorySchema:INV_REPLACEMENT.VERSION,sheets:created.length,trigger:'5분'};
  }finally{lock.releaseLock();}
}

