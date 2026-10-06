/** Deno KV migration and durable Sheet/Handover bridge. Same existing GAS project. */
var HW_KV_URL='https://yuyoung.yuyoung-ai.deno.net';
var HW_KV_LOG='업무KV변경로그',HW_KV_CONTROL='업무연동관리',HW_KV_QUEUE='업무Handover대기';
function hwKvMode_(){return !!PropertiesService.getScriptProperties().getProperty('HOSPITAL_WORK_KV_STAGE');}
function hwKvSign_(body){
 var secret=bazTokenConf_().secret;if(!secret)throw new Error('기존 토큰 서명 설정을 확인하세요.');
 return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature('baz-work-bridge-v1\n'+JSON.stringify(body),secret,Utilities.Charset.UTF_8)).replace(/=+$/,'');
}
function hwKvCall_(verb,payload){
 var body={action:'work_bridge',verb:verb,at:Date.now(),nonce:Utilities.getUuid(),payload:payload||{}};body.signature=hwKvSign_(body);
 var response=UrlFetchApp.fetch(HW_KV_URL,{method:'post',contentType:'text/plain;charset=utf-8',payload:JSON.stringify(body),muteHttpExceptions:true});
 var out;try{out=JSON.parse(response.getContentText());}catch(e){throw new Error('Deno 연동 응답을 확인하지 못했습니다.');}
 if(!out.success)throw new Error(out.error||'Deno 연동 실패');return out;
}
/** Read-only health check, including non-ASCII payload signing. */
function checkHospitalWorkKv(){
 var out=hwKvCall_('status',{probe:'한글 · A/S · 점검 · 😀'});Logger.log(JSON.stringify(out));return out;
}
function hwKvSheet_(name,headers){
 var sh=hwSS_().getSheetByName(name)||hwSS_().insertSheet(name);
 if(!sh.getLastRow()){sh.getRange(1,1,1,headers.length).setValues([headers]);sh.setFrozenRows(1);}
 else if(JSON.stringify(sh.getRange(1,1,1,headers.length).getDisplayValues()[0])!==JSON.stringify(headers))throw new Error(name+' 헤더가 다릅니다. 기존 내용을 유지하고 중단했습니다.');return sh;
}
function hwKvPrepareSheets_(){
 hwKvSheet_(HW_KV_LOG,['eventId','seq','actor','kind','event','createdAt']);
 hwKvSheet_(HW_KV_CONTROL,['항목','값']);
 hwKvSheet_(HW_KV_QUEUE,['eventKey','recordId','version','json','state','createdAt']);
}
function hwKvControl_(key,value){var sh=hwKvSheet_(HW_KV_CONTROL,['항목','값']),n=sh.getLastRow()-1,c=n>0?sh.getRange(2,1,n,1).createTextFinder(key).matchEntireCell(true).findNext():null;sh.getRange(c?c.getRow():sh.getLastRow()+1,1,1,2).setValues([[key,safeCell_(String(value))]]);}
function hwKvRefs_(){
 var raw=getHospDBRich_({force:'1'});if(!raw.success)throw new Error(raw.error);
 var stored={};hwRows_(HW.HOSPITALS,3).forEach(function(row){stored[row[1]]=JSON.parse(row[2]);});
 var hospitals=raw.data.map(function(h){var key=hwKey_(h);return {id:stored[key]?stored[key].id:'hosp_'+hwHash_(key),key:key,name:h.name,sn:h.sn||'',region:h.region||'',sales:h.sales||'',asType:h.asType||'',ncare:h.ncare||''};});
 var master=getMaster_({force:'1'}),minimum=1;(menuGet_().menu||[]).forEach(function(m){if(m.id==='hospitalwork')minimum=Number(m.level)||1;});
 return {hospitals:hospitals,references:{engineers:master.fse||[],minimumLevel:minimum,referenceCheckedAt:new Date().toISOString()}};
}
function hwKvStableSource_(hit){
 hit.source.observedAt=new Date().toISOString();
 if(hit.source.recordId.indexOf('legacy_')!==0)return;
 var sh=hwSS_().getSheetByName(CONFIG.SHEET_NAME),hdr=findHeader_(sh),col=colBy_(hdr,REC_ID_COLS);
 if(!col)throw new Error('Handover 기록 ID 열이 없습니다.');
 var old=String(sh.getRange(hit.raw._row,col).getValue()||'').trim();
 if(old){hit.source.recordId=old;return;}
 var id=Utilities.getUuid();sh.getRange(hit.raw._row,col).setValue(id);hit.source.recordId=id;
}
function hwKvQueueSources_(hospital,date){
 var matches=hwSources_(hospital).filter(function(x){return x.source.date===_issueDateNorm_(date)&&['A/S','점검'].indexOf(x.source.gubun)>=0;}),sh=hwKvSheet_(HW_KV_QUEUE,['eventKey','recordId','version','json','state','createdAt']);
 matches.forEach(function(hit){hwKvStableSource_(hit);var s=hit.source,id=s.recordId+'_'+s.version,n=sh.getLastRow()-1,existing=n>0?sh.getRange(2,1,n,1).createTextFinder(id).matchEntireCell(true).findNext():null;if(!existing)sh.getRange(sh.getLastRow()+1,1,1,6).setValues([[id,s.recordId,s.version,JSON.stringify(s),'pending',new Date().toISOString()].map(safeCell_)]);});
}
function hwKvHash_(value){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(value),Utilities.Charset.UTF_8).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
function hwKvManifest_(data){var out={};['requests','history','operations'].forEach(function(k){var rows=data[k].map(function(x){if(k==='operations')return {id:x.id,actor:x.actor,fingerprint:x.fingerprint,response:x.response};return x;}).sort(function(a,b){return String(a.id).localeCompare(String(b.id),'en');});out[k]={count:rows.length,hash:hwKvHash_(rows)};});return out;}
function hwKvSnapshot_(){
 return {requests:hwRows_(HW.REQUESTS,2).map(function(x){return JSON.parse(x[1]);}),history:hwRows_(HW.HISTORY,3).map(function(x){return JSON.parse(x[2]);}),operations:hwRows_(HW.LOG,7).map(function(x){return {id:x[0],actor:x[1],fingerprint:x[2],state:x[3],event:JSON.parse(x[4]),response:JSON.parse(x[5]),createdAt:x[6]};})};
}
/** Run once after the compatible Deno build. Retrying finishes trigger setup safely. */
function hwKvFinishMigration_(props){
 props.setProperty('HOSPITAL_WORK_KV_STAGE','active');
 if(!ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='syncHospitalWorkKv';}))ScriptApp.newTrigger('syncHospitalWorkKv').timeBased().everyMinutes(5).create();
 hwKvControl_('KV 전환',new Date().toISOString());hwKvControl_('검증 결과',props.getProperty('HOSPITAL_WORK_KV_MANIFEST')||'');
 syncHospitalWorkKv();return 'KV 전환 완료';
}
function migrateHospitalWorkToKv(){
 hwResetContext_();hwKvPrepareSheets_();var props=PropertiesService.getScriptProperties(),state=hwKvCall_('status',{});
 if(state.ready){
  if(!props.getProperty('HOSPITAL_WORK_KV_STAGE')||state.migrationId!==props.getProperty('HOSPITAL_WORK_KV_MIGRATION_ID'))throw new Error('기존 KV의 이전 식별자가 다릅니다. 운영 데이터를 유지하고 중단했습니다.');
  return hwKvFinishMigration_(props);
 }
 var data=hwLock_(function(){hwRecover_();props.setProperty('HOSPITAL_WORK_KV_STAGE','migrating');return hwKvSnapshot_();});
 // Snapshot-only backup; original sheets and GAS journal are never cleared.
 var stamp=Utilities.formatDate(new Date(),'Asia/Seoul','yyyyMMdd_HHmmss');
 [HW.REQUESTS,HW.HISTORY,HW.LOG,HW.HOSPITALS].forEach(function(name){var sh=hwSS_().getSheetByName(name);sh.copyTo(hwSS_()).setName(name+'_KV전환백업_'+stamp);});
 var reference=hwKvRefs_(),migrationId='migration_'+stamp,manifest=hwKvManifest_(data);
 props.setProperty('HOSPITAL_WORK_KV_MIGRATION_ID',migrationId);props.setProperty('HOSPITAL_WORK_KV_MANIFEST',JSON.stringify(manifest));
 ['requests','history','operations'].forEach(function(name){for(var i=0;i<data[name].length;i+=10){var payload={migrationId:migrationId};payload[name]=data[name].slice(i,i+10);hwKvCall_('seed',payload);}});
 for(var j=0;j<reference.hospitals.length;j+=50)hwKvCall_('seed',{migrationId:migrationId,hospitals:reference.hospitals.slice(j,j+50)});
 hwKvCall_('seed',{migrationId:migrationId,references:reference.references});
 var checked=hwKvCall_('status',{});
 if(JSON.stringify(checked.manifest)!==JSON.stringify(manifest))throw new Error('건수·내용 검증 불일치. KV 활성화를 중단했습니다.');
 hwKvCall_('activate',{manifest:manifest});hwKvFinishMigration_(props);
 return 'KV 전환 완료 · 접수 '+manifest.requests.count+'건 · 이력 '+manifest.history.count+'건';
}
function hwKvPurge_(r){
 var history=hwSheet_(HW.HISTORY),n=history.getLastRow()-1;
 if(n>0)history.getRange(2,2,n,1).createTextFinder(r.id).matchEntireCell(true).findAll().sort(function(a,b){return b.getRow()-a.getRow();}).forEach(function(c){history.deleteRow(c.getRow());});
 hwPut_(HW.REQUESTS,r.id,[r.id,JSON.stringify(r)]);
 // Keep journal identifiers for idempotency, but discard the old request payloads.
 var journal=hwKvSheet_(HW_KV_LOG,['eventId','seq','actor','kind','event','createdAt']),jn=journal.getLastRow()-1;
 if(jn>0)journal.getRange(2,5,jn,1).createTextFinder(JSON.stringify(r.id)).matchEntireCell(false).findAll().forEach(function(c){var e=JSON.parse(c.getValue());if(e.request&&e.request.id===r.id)c.setValue(JSON.stringify({id:e.id,seq:e.seq,actor:e.actor,at:e.at,kind:'purge',request:r}));});
 var legacy=hwSheet_(HW.LOG),ln=legacy.getLastRow()-1;
 if(ln>0)legacy.getRange(2,5,ln,1).createTextFinder(JSON.stringify(r.id)).matchEntireCell(false).findAll().forEach(function(c){var e=JSON.parse(c.getValue());if(e.request&&e.request.id===r.id)legacy.getRange(c.getRow(),5,1,2).setValues([[JSON.stringify({kind:'purge',request:r}),JSON.stringify({success:false,purged:true,deleted:true,error:'영구 삭제된 접수입니다.'})]]);});
}
function hwKvApply_(events){
 return hwLock_(function(){
  var sh=hwKvSheet_(HW_KV_LOG,['eventId','seq','actor','kind','event','createdAt']),ack=[];
  events.sort(function(a,b){return a.seq-b.seq;}).forEach(function(ev){
   var n=sh.getLastRow()-1,done=n>0?sh.getRange(2,1,n,1).createTextFinder(ev.id).matchEntireCell(true).findNext():null;
   if(!done){
    var original=hwRequest_(ev.request.id),stored=ev;
    if(ev.request.purgedAt||original&&original.purgedAt){var marker=original&&original.purgedAt&&(!ev.request.purgedAt||Number(original.revision)>Number(ev.request.revision))?original:ev.request;hwKvPurge_(marker);stored={id:ev.id,seq:ev.seq,actor:ev.actor,at:ev.at,kind:'purge',request:marker};}
    else{
     if(ev.hospital)hwPut_(HW.HOSPITALS,ev.hospital.id,[ev.hospital.id,ev.hospital.key,JSON.stringify(ev.hospital)]);
     if(ev.history){var old=hwHistory_(ev.history.id);if(!old||Number(old.revision)<=Number(ev.history.revision))hwPut_(HW.HISTORY,ev.history.id,[ev.history.id,ev.history.requestId,JSON.stringify(ev.history)]);}
     if(!original||Number(original.revision)<=Number(ev.request.revision))hwPut_(HW.REQUESTS,ev.request.id,[ev.request.id,JSON.stringify(ev.request)]);
    }
    SpreadsheetApp.flush();sh.getRange(sh.getLastRow()+1,1,1,6).setValues([[ev.id,ev.seq,ev.actor,stored.kind,JSON.stringify(stored),ev.at].map(safeCell_)]);SpreadsheetApp.flush();
   }
   ack.push({id:ev.id,seq:ev.seq});
  });return ack;
 });
}
/** One background worker. Empty runs do not read/transfer the full Handover history. */
function syncHospitalWorkKv(){
 hwResetContext_();var props=PropertiesService.getScriptProperties();if(props.getProperty('HOSPITAL_WORK_KV_STAGE')!=='active')return 'KV 미활성';
 var started=Date.now();try{
  var pending=hwKvCall_('pending',{}),batches=0;
  while(pending.events.length&&batches<5&&Date.now()-started<120000){hwKvCall_('ack',{items:hwKvApply_(pending.events)});batches++;if(!pending.more)break;pending=hwKvCall_('pending',{});}
  // Recover missing save-hook events by rechecking only visit-date pairs in current work.
  hwLock_(function(){var pairs={},seen={};hwRows_(HW.REQUESTS,2).forEach(function(x){var r=JSON.parse(x[1]);if(!r.deletedAt&&r.status!=='취소'&&r.status!=='완료'&&r.visitAt)pairs[hwAutoPair_(r.hospitalName,r.visitAt.slice(0,10))]=true;});hwAutoSources_(pairs).forEach(function(hit){var pair=hwAutoPair_(hit.source.hospitalName,hit.source.date);if(!seen[pair]){seen[pair]=true;hwKvQueueSources_(hit.source.hospitalName,hit.source.date);}});});
  var queue=hwKvSheet_(HW_KV_QUEUE,['eventKey','recordId','version','json','state','createdAt']),n=queue.getLastRow()-1,rows=n>0?queue.getRange(2,5,n,1).createTextFinder('pending').matchEntireCell(true).findAll().slice(0,20):[];
  if(rows.length){var sources=rows.map(function(c){var old=JSON.parse(queue.getRange(c.getRow(),4).getValue()),hits=hwSources_(old.hospitalName).filter(function(x){return x.source.recordId===old.recordId;});if(hits.length!==1)throw new Error('연동 원본의 기록 ID가 중복되었거나 삭제됐습니다.');hwKvStableSource_(hits[0]);return hits[0].source;});hwKvCall_('sources',{sources:sources});hwLock_(function(){rows.forEach(function(c){queue.getRange(c.getRow(),5).setValue('sent');});});}
  // Check reference/ACL changes each run; only transfer changed snapshots.
  var refs=hwKvRefs_(),refsHash=hwKvHash_({hospitals:refs.hospitals,engineers:refs.references.engineers,minimumLevel:refs.references.minimumLevel});
  if(refsHash!==props.getProperty('HOSPITAL_WORK_KV_REFS_HASH')){hwKvCall_('references',refs);props.setProperty('HOSPITAL_WORK_KV_REFS_HASH',refsHash);}
  hwKvControl_('마지막 성공',new Date().toISOString());hwKvControl_('소요 ms',Date.now()-started);hwKvControl_('반영 대기',pending.more?'추가 반영 대기 있음':'이번 배치 반영 완료');hwKvControl_('오류','');
  return '업무 연동 완료';
 }catch(e){hwKvControl_('오류',String(e.message||e));throw e;}
}
