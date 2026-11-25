/** Durable PDF delivery within the existing Handover project. */
var INSPECTION_DELIVERY_SHEET='점검PDF전송';
var INSPECTION_DELIVERY_FIELDS='id,name,size,sha256Checksum,trashed,appProperties';
var INSPECTION_DELIVERY_RETRY_WINDOW=24*60*60*1000;
var INSPECTION_DELIVERY_MULTIPART_LIMIT=5000000;

function inspectionDeliveryError_(code,message){
  var error=new Error(message);error.code=code;return error;
}
function inspectionDeliveryMeasure_(timing,name,run){
  var start=Date.now();
  try{return run();}finally{timing[name]=(timing[name]||0)+Date.now()-start;}
}
function inspectionDeliveryTimings_(prior,current){
  var stages={};
  ['jobRead','validateBytes','lockWait','lockHeld','source','target','driveId','driveUpload','driveVerify','driveLink','sheetLinkCheck',
    'sheetLink','cacheDrop','driveShare','jobWrite','comment','workTarget','workRegistration','workConfirmation'].forEach(function(name){
    var before=prior?.[name],elapsed=current?.[name];
    if(Number.isFinite(before)||Number.isFinite(elapsed))
      stages[name]=(Number.isFinite(before)?before:0)+(Number.isFinite(elapsed)?elapsed:0);
  });
  return stages;
}
function inspectionDeliveryLog_(id,action,timing,start,job){
  try{Logger.log(JSON.stringify({
    event:'inspection_delivery',jobId:id,action:action,state:job?.state||'',code:job?.code||'',
    bytes:job?.bytes||0,totalMs:Date.now()-start,stagesMs:timing
  }));}catch(ignore){}
}
function inspectionDeliveryLocked_(run,timing){
  var lock=inspectionDeliveryMeasure_(timing,'lockWait',inspectionPdfLock_);
  try{return inspectionDeliveryMeasure_(timing,'lockHeld',run);}finally{lock.releaseLock();}
}
function inspectionDeliveryTable_(){
  return hwKvSheet_(INSPECTION_DELIVERY_SHEET,['jobId','state','nextAt','json','recordId','retryUntil']);
}
function inspectionDeliveryRow_(table,id){
  var n=table.getLastRow()-1;
  var match=n>0?table.getRange(2,1,n,1).createTextFinder(id).matchEntireCell(true).findNext():null;
  return match?match.getRow():0;
}
function inspectionDeliveryRead_(table,row){
  return row?JSON.parse(table.getRange(row,4).getValue()):null;
}
function inspectionDeliveryWrite_(table,row,job,timing){
  var due=Math.max(job.nextAt||0,job.leaseUntil||0);
  inspectionDeliveryMeasure_(timing,'jobWrite',function(){
    table.getRange(row,1,1,6).setValues([[job.id,job.state,due,JSON.stringify(job),job.context.recordId,job.retryUntil||job.createdAt+INSPECTION_DELIVERY_RETRY_WINDOW]]);
    SpreadsheetApp.flush();
  });
}
function inspectionDeliveryCheckpoint_(job,lease,release,timing){
  inspectionDeliveryLocked_(function(){
    var table=inspectionDeliveryTable_(),row=inspectionDeliveryRow_(table,job.id),current=inspectionDeliveryRead_(table,row);
    if(current?.lease!==lease)throw inspectionDeliveryError_('LOCK_BUSY','다른 작업에서 저장 결과를 확인하고 있습니다.');
    if(release){
      delete job.lease;delete job.leaseUntil;
      // Roll up the run in the existing durable write. The response/log also
      // measures this final write and lock hold after they have finished.
      job.stageTimings=inspectionDeliveryTimings_(current.stageTimings,timing);
    }
    inspectionDeliveryWrite_(table,row,job,timing);
  },timing);
}
function inspectionDeliveryActor_(p){
  var actor;
  try{actor=inspectionPdfActor_(p);}catch(e){throw inspectionDeliveryError_('AUTH_REQUIRED',e.message);}
  var payload=JSON.parse(bazB64uDecode_(p.token.split('.')[0]));
  actor.owner=/^[gp]:[A-Za-z0-9_-]{43}$/.test(payload.u||'')?payload.u:'staff:'+actor.name;
  return actor;
}
function inspectionDeliveryLookup_(table,recordId,owner){
  var count=table.getLastRow()-1;
  if(count<1)return null;
  var matches=table.getRange(2,5,count,1).createTextFinder(recordId).matchEntireCell(true).findAll();
  for(var i=matches.length-1;i>=0;i--){
    var job=inspectionDeliveryRead_(table,matches[i].getRow());
    if(job.owner===owner&&job.received&&job.state!=='complete')return job;
  }
  return null;
}
function inspectionDeliveryReceipt_(hit){
  return {
    recordId:hit.source.recordId,
    source:hit.source,
    version:hit.source.version,
    pdfRevision:hit.pdf?hit.pdf.revision:0,
    basis:{
      standard:inspectionPdfBasis_(hit.source,'standard'),
      simplified:inspectionPdfBasis_(hit.source,'simplified')
    }
  };
}
function inspectionDeliveryDrive_(path,options){
  var response=UrlFetchApp.fetch('https://www.googleapis.com/'+path,Object.assign({
    headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true,followRedirects:false
  },options||{}));
  var code=response.getResponseCode();
  if(code===404||code===409)return {code:code};
  if(code<200||code>=300)throw inspectionDeliveryError_('DRIVE_PENDING','Drive 응답을 다시 확인하고 있습니다.');
  return {code:code,value:response.getContentText()?JSON.parse(response.getContentText()):{},headers:response.getAllHeaders()};
}
function inspectionDeliveryFile_(job){
  var result=inspectionDeliveryDrive_('drive/v3/files/'+job.fileId+'?fields='+INSPECTION_DELIVERY_FIELDS);
  if(result.code===404)return null;
  return inspectionDeliveryVerifyFile_(job,result.value);
}
function inspectionDeliveryVerifyFile_(job,file){
  if(file?.trashed||file?.id!==job.fileId||Number(file.size)!==job.bytes||file.appProperties?.inspectionJob!==job.id)
    throw inspectionDeliveryError_('FILE_CONFLICT','Drive 파일과 전송 정보가 일치하지 않습니다.');
  var checksum=file.sha256Checksum||inspectionPdfHash_(DriveApp.getFileById(job.fileId).getBlob().getBytes());
  if(checksum!==job.sha256)throw inspectionDeliveryError_('FILE_CONFLICT','Drive 파일 검증 값이 일치하지 않습니다.');
  return file;
}
function inspectionDeliveryUpload_(job,bytes,fresh,timing){
  function verify(){
    return inspectionDeliveryMeasure_(timing,'driveVerify',function(){return inspectionDeliveryFile_(job);});
  }
  if(!fresh){
    var existing=verify();
    if(existing)return existing;
  }
  if(!bytes)return null;
  var folderId=PropertiesService.getScriptProperties().getProperty('INSPECTION_PDF_FOLDER_ID')||inspectionPdfFolder_().getId();
  var metadata={id:job.fileId,name:job.filename,mimeType:'application/pdf',
    parents:[folderId],appProperties:{inspectionJob:job.id}};
  if(job.bytes<=INSPECTION_DELIVERY_MULTIPART_LIMIT){
    var result=inspectionDeliveryMeasure_(timing,'driveUpload',function(){
      var boundary='inspection_'+Utilities.getUuid();
      var prefix='--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(metadata)+
        '\r\n--'+boundary+'\r\nContent-Type: application/pdf\r\n\r\n';
      var suffix='\r\n--'+boundary+'--\r\n';
      return inspectionDeliveryDrive_('upload/drive/v3/files?uploadType=multipart&fields='+INSPECTION_DELIVERY_FIELDS,{
        method:'post',contentType:'multipart/related; boundary='+boundary,
        payload:Utilities.newBlob(prefix).getBytes().concat(bytes,Utilities.newBlob(suffix).getBytes())
      });
    });
    var file=result.value;
    if(file?.id&&file.size!=null&&file.appProperties?.inspectionJob&&file.sha256Checksum)
      return inspectionDeliveryVerifyFile_(job,file);
  }else{
    inspectionDeliveryMeasure_(timing,'driveUpload',function(){inspectionDeliveryResumable_(job,bytes,metadata);});
  }
  var stored=verify();
  if(!stored)throw inspectionDeliveryError_('DRIVE_PENDING','Drive 파일 수신을 다시 확인하고 있습니다.');
  return stored;
}
function inspectionDeliveryResumable_(job,bytes,metadata){
  var started=inspectionDeliveryDrive_('upload/drive/v3/files?uploadType=resumable',{
    method:'post',contentType:'application/json',payload:JSON.stringify(metadata),
    headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken(),'X-Upload-Content-Type':'application/pdf','X-Upload-Content-Length':String(job.bytes)}
  });
  if(started.code!==409){
    var locationKey=Object.keys(started.headers||{}).filter(function(key){return key.toLowerCase()==='location';})[0];
    var uploadUrl=locationKey&&String(started.headers[locationKey]);
    if(!/^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?/.test(uploadUrl||''))throw inspectionDeliveryError_('DRIVE_PENDING','Drive 업로드 주소를 다시 확인해 주세요.');
    var uploaded=UrlFetchApp.fetch(uploadUrl,{method:'put',contentType:'application/pdf',payload:bytes,muteHttpExceptions:true,followRedirects:false});
    var code=uploaded.getResponseCode();
    if((code<200||code>=300)&&code!==409)throw inspectionDeliveryError_('DRIVE_PENDING','Drive 파일 수신을 다시 확인하고 있습니다.');
  }
}
function inspectionDeliveryBytes_(p){
  var encoded=String(p.base64||'');
  if(!Number.isSafeInteger(p.bytes)||p.bytes<5||p.bytes>INSPECTION_PDF.MAX_BYTES||encoded.length>Math.ceil(INSPECTION_PDF.MAX_BYTES/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    throw inspectionDeliveryError_('INVALID_FILE','PDF 크기와 파일 형식을 확인하세요.');
  var bytes=Utilities.base64Decode(encoded);
  if(bytes.length!==p.bytes||inspectionPdfHash_(bytes)!==p.sha256||bytes.slice(0,5).map(function(x){return String.fromCharCode(x&255);}).join('')!=='%PDF-')
    throw inspectionDeliveryError_('INVALID_FILE','PDF가 손상되었습니다. 보관한 원래 파일을 확인하세요.');
  return bytes;
}
function inspectionDeliverySource_(context){
  return inspectionPdfRecord_({recordId:context.recordId,hospital:context.hospital,date:context.date,sn:context.sn});
}
function inspectionDeliveryVerifySource_(job,hit){
  var basis=inspectionPdfBasis_(hit.source,job.format);
  if(basis.fingerprint!==job.fingerprint||job.sourceVersion&&job.sourceVersion!==hit.source.version)
    throw inspectionDeliveryError_('SOURCE_CHANGED','Handover 원본이 변경되었습니다. 현재 원본을 확인한 뒤 새 PDF를 생성하세요.');
  if(hit.pdf?.uploadId===job.id){
    if(hit.pdf.fileId!==job.fileId||hit.pdf.sha256!==job.sha256||hit.pdf.revision!==job.baseRevision+1)
      throw inspectionDeliveryError_('FILE_CONFLICT','기존 시트 PDF가 이 전송 정보와 일치하지 않습니다.');
  }else if(Number(hit.pdf?.revision||0)!==job.baseRevision)
    throw inspectionDeliveryError_('VERSION_CHANGED','다른 PDF가 먼저 저장되었습니다. 최신 문서를 확인하세요.');
}
function inspectionDeliveryTarget_(job,hit){
  return hwKvCall_('inspection_target',{
    recordId:job.context.recordId,requestId:job.context.requestId,
    context:{hospitalName:hit.source.hospitalName,date:hit.source.date,sn:hit.source.sn||''}
  });
}
function inspectionDeliveryReserve_(actor,p,filename,lease,timing){
  var format=p.pdfFormat==='simplified'?'simplified':'standard';
  if(!/^[a-zA-Z0-9_-]{8,90}$/.test(p.recordId||'')||!/^[a-f0-9]{64}$/.test(p.sourceBasis?.fingerprint||'')||p.sourceBasis.format!==format)
    throw inspectionDeliveryError_('SOURCE_REQUIRED','Handover 원본과 연결한 후 PDF를 생성하세요.');
  var context={recordId:p.recordId,requestId:String(p.requestId||''),hospital:String(p.hospital||''),date:String(p.date||''),sn:String(p.sn||'')};
  var job={
    id:p.uploadId,owner:actor.owner,author:actor.name,filename:filename,bytes:p.bytes,sha256:p.sha256,context:context,
    format:format,fingerprint:p.sourceBasis.fingerprint,sourceVersion:String(p.sourceVersion||''),
    baseRevision:Number(p.baseRevision||0),state:'receiving',nextAt:Date.now()+10000,attempts:0,createdAt:Date.now()
  };
  var hit=inspectionDeliveryMeasure_(timing,'source',function(){return inspectionDeliverySource_(context);});
  inspectionDeliveryVerifySource_(job,hit);
  var generated=inspectionDeliveryMeasure_(timing,'driveId',function(){
    return inspectionDeliveryDrive_('drive/v3/files/generateIds?count=1&space=drive');
  });
  job.fileId=generated.value?.ids?.[0];
  if(!/^[a-zA-Z0-9_-]+$/.test(job.fileId||''))throw inspectionDeliveryError_('DRIVE_PENDING','Drive 파일 식별자를 다시 확인해 주세요.');
  return inspectionDeliveryLocked_(function(){
    var table=inspectionDeliveryTable_(),row=inspectionDeliveryRow_(table,job.id);
    if(row)return {job:inspectionDeliveryRead_(table,row)};
    // The first lease and the fixed file ID must survive before any upload.
    job.lease=lease;
    job.leaseUntil=Date.now()+7*60*1000;
    inspectionDeliveryWrite_(table,table.getLastRow()+1,job,timing);
    return {job:job,hit:hit};
  },timing);
}
function inspectionDeliveryView_(job){
  if(!job)return {success:true,state:'missing'};
  return {success:true,jobId:job.id,state:job.state,recordId:job.context.recordId,requestId:job.context.requestId,
    filename:job.filename,bytes:job.bytes,sha256:job.sha256,received:!!job.received,
    pdf:job.pdf||null,code:job.code||'',message:job.message||'',processing:Number(job.leaseUntil||0)>Date.now(),
    checkedAt:job.checkedAt||null,
    commentAttached:job.state==='complete'&&!!job.context.requestId};
}
function inspectionDeliveryAdvance_(id,force,bytes,expectedRequestId,timing,reserved){
  var fresh=!!reserved?.hit;
  var lease=fresh?reserved.job.lease:Utilities.getUuid();
  var job=fresh?reserved.job:inspectionDeliveryLocked_(function(){
    var table=inspectionDeliveryTable_(),row=inspectionDeliveryRow_(table,id),current=inspectionDeliveryRead_(table,row);
    if(!current||current.state==='complete'||current.state==='blocked'&&!(force&&current.code==='COMMENT_DELETED')||current.leaseUntil>Date.now()||!force&&current.nextAt>Date.now())return current;
    if(force)current.retryUntil=Date.now()+INSPECTION_DELIVERY_RETRY_WINDOW;
    current.lease=lease;current.leaseUntil=Date.now()+7*60*1000;
    inspectionDeliveryWrite_(table,row,current,timing);return current;
  },timing);
  if(!job||job.lease!==lease)return job;
  try{
    if(!job.received){
      if(!inspectionDeliveryUpload_(job,bytes,fresh,timing)){
        job.state='receiving';
        job.nextAt=Date.now()+Math.min(3600000,60000*Math.pow(2,Math.min(6,job.attempts++)));
        return job;
      }
      job.received=true;job.state='drive';job.attempts=0;
      inspectionDeliveryCheckpoint_(job,lease,false,timing);
    }
    var hit=reserved?.hit||inspectionDeliveryMeasure_(timing,'source',function(){return inspectionDeliverySource_(job.context);});
    var target=inspectionDeliveryMeasure_(timing,'target',function(){return inspectionDeliveryTarget_(job,hit);});
    if(!target.ready)throw inspectionDeliveryError_(target.code,target.message);
    if(expectedRequestId&&target.requestId!==expectedRequestId)throw inspectionDeliveryError_('INVALID_JOB','원래 전송과 접수 연결이 다릅니다.');
    if(!job.context.requestId)job.context.requestId=target.requestId;
    inspectionDeliveryVerifySource_(job,hit);
    var file,key='';
    if(!job.shared||!job.pdf)inspectionDeliveryMeasure_(timing,'driveLink',function(){
      file=DriveApp.getFileById(job.fileId);
      key=file.getResourceKey()||'';
    });
    var durableHandover=false;
    job.pdf=inspectionDeliveryLocked_(function(){
      var current=inspectionDeliveryMeasure_(timing,'source',function(){return inspectionDeliverySource_(job.context);});
      var pdf=current.pdf;
      inspectionDeliveryVerifySource_(job,current);
      if(pdf?.uploadId===job.id&&job.state==='handover'&&job.shared&&job.pdf?.url===pdf.url){
        var intact=inspectionDeliveryMeasure_(timing,'sheetLinkCheck',function(){
          return current.sheet.getRange(current.row,current.linkCol).getDisplayValue()===pdf.url;
        });
        if(intact){durableHandover=true;return pdf;}
      }
      if(pdf?.uploadId!==job.id){
        pdf={fileId:job.fileId,url:'https://drive.google.com/file/d/'+job.fileId+'/view'+(key?'?resourcekey='+key:''),
          filename:job.filename,bytes:job.bytes,sha256:job.sha256,revision:job.baseRevision+1,
          uploadedAt:new Date(job.createdAt).toISOString(),uploadedBy:job.author,uploadId:job.id,
          sourceBasis:inspectionPdfBasis_(current.source,job.format)};
      }
      // One write when the two columns are adjacent. The stable PDF receipt
      // repairs either column if a previous execution stopped after writing it.
      inspectionDeliveryMeasure_(timing,'sheetLink',function(){
        if(current.linkCol+1===current.metaCol)current.sheet.getRange(current.row,current.linkCol,1,2).setValues([[pdf.url,JSON.stringify(pdf)]]);
        else{
          current.sheet.getRange(current.row,current.metaCol).setValue(JSON.stringify(pdf));
          current.sheet.getRange(current.row,current.linkCol).setValue(pdf.url);
        }
        SpreadsheetApp.flush();
      });
      return pdf;
    },timing);
    try{inspectionDeliveryMeasure_(timing,'cacheDrop',function(){bazDropHandoverCaches_(hit.source.hospitalName);});}catch(ignore){}
    if(!job.shared){
      inspectionDeliveryMeasure_(timing,'driveShare',function(){file.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW);});
      job.shared=true;
    }
    job.state='handover';
    if(!durableHandover)inspectionDeliveryCheckpoint_(job,lease,false,timing);
    var result=inspectionDeliveryMeasure_(timing,'comment',function(){
      return hwKvCall_('inspection_complete',{recordId:job.context.recordId,requestId:job.context.requestId,revision:job.pdf.revision,sha256:job.sha256,
        document:{recordId:job.context.recordId,requestId:job.context.requestId,pdf:job.pdf,context:{hospitalName:hit.source.hospitalName,date:hit.source.date,sn:hit.source.sn||''}}});
    });
    ['target','registration','confirmation'].forEach(function(name){
      var elapsed=result.stageTimings?.[name+'Ms'];
      if(Number.isFinite(elapsed)&&elapsed>=0)timing['work'+name[0].toUpperCase()+name.slice(1)]=elapsed;
    });
    if(!result.complete)throw inspectionDeliveryError_(result.code,result.message);
    if(result.requestId!==job.context.requestId||result.recordId!==job.context.recordId||result.sha256!==job.sha256||
      result.revision!==job.pdf.revision||result.fileId!==job.pdf.fileId||!Number.isFinite(Date.parse(result.checkedAt||'')))
      throw inspectionDeliveryError_('SERVICE_PENDING','접수 댓글의 최종 확인 결과를 다시 확인하고 있습니다.');
    job.checkedAt=result.checkedAt;
    job.state='complete';job.nextAt=0;job.code='';job.message='';
  }catch(e){
    if(e.code==='INVALID_JOB')throw e;
    job.code=e.code||(e.sourceConflict||e.sourceMissing?'SOURCE_CHANGED':'SERVICE_PENDING');
    job.message=e.code?e.message:'저장 결과를 다시 확인하고 있습니다.';
    if(['SOURCE_CHANGED','VERSION_CHANGED','FILE_CONFLICT','COMMENT_DELETED','TARGET_CHANGED'].indexOf(job.code)>=0){
      job.state='blocked';job.nextAt=0;
    }else{
      job.attempts++;
      job.nextAt=Date.now()+Math.min(3600000,15000*Math.pow(2,Math.min(8,job.attempts)));
    }
  }finally{
    inspectionDeliveryCheckpoint_(job,lease,true,timing);
  }
  return job;
}
function inspectionDeliveryPost_(p){
  var start=Date.now(),timing={},shouldLog=false,job,errorCode;
  try{
    var actor=inspectionDeliveryActor_(p);
    var intakeEnabled=PropertiesService.getScriptProperties().getProperty('INSPECTION_DELIVERY_V2')==='enabled';
    if(p.action==='inspection_pdf_job_source'){
      if(!intakeEnabled)throw inspectionDeliveryError_('DELIVERY_DISABLED','새 전송 작업이 아직 활성화되지 않았습니다.');
      if(!/^[A-Za-z0-9_-]{8,90}$/.test(p.recordId||''))throw inspectionDeliveryError_('SOURCE_REQUIRED','Handover 기록 ID를 확인하세요.');
      return {success:true,receipt:inspectionDeliveryReceipt_(inspectionDeliverySource_(p))};
    }
    if(p.action==='inspection_pdf_job_lookup'){
      inspectionDeliverySource_(p);
      return inspectionDeliveryView_(inspectionDeliveryLookup_(inspectionDeliveryTable_(),p.recordId,actor.owner));
    }
    if(['inspection_pdf_job_submit','inspection_pdf_job_status','inspection_pdf_job_resume'].indexOf(p.action)<0||!/^[A-Za-z0-9_-]{8,90}$/.test(p.uploadId||''))
      throw inspectionDeliveryError_('INVALID_JOB','전송 작업을 확인하세요.');
    job=inspectionDeliveryMeasure_(timing,'jobRead',function(){
      var table=inspectionDeliveryTable_();
      return inspectionDeliveryRead_(table,inspectionDeliveryRow_(table,p.uploadId));
    });
    if(job&&job.owner!==actor.owner)throw inspectionDeliveryError_('WRONG_OWNER','파일을 작성한 계정으로 로그인하세요.');
    if(p.action==='inspection_pdf_job_status')return inspectionDeliveryView_(job);
    if(p.action==='inspection_pdf_job_resume'){
      var expected=String(p.requestId||'');
      if(expected&&(!/^[A-Za-z0-9_-]{8,90}$/.test(expected)||job?.context.requestId&&job.context.requestId!==expected))
        throw inspectionDeliveryError_('INVALID_JOB','원래 전송과 접수 연결이 다릅니다.');
      if(!job||job.state==='complete'||job.leaseUntil>Date.now())return inspectionDeliveryView_(job);
      shouldLog=true;
      job=inspectionDeliveryAdvance_(job.id,true,null,expected,timing);
      return Object.assign(inspectionDeliveryView_(job),{serverMs:Date.now()-start,stageTimings:inspectionDeliveryTimings_(null,timing)});
    }
    if(!job&&!intakeEnabled)throw inspectionDeliveryError_('DELIVERY_DISABLED','새 전송 접수가 일시 중지되었습니다. 보관한 PDF로 다시 시도하세요.');
    var filename=String(p.filename||'').replace(/[<>:/\\|?*"\x00-\x1f]/g,'').trim().slice(0,240);
    if(!/\.pdf$/i.test(filename)||!/^[a-f0-9]{64}$/.test(p.sha256||''))throw inspectionDeliveryError_('INVALID_FILE','PDF 파일명과 검증 값을 확인하세요.');
    if(p.requestId&&(typeof p.requestId!=='string'||!/^[A-Za-z0-9_-]{8,90}$/.test(p.requestId)))
      throw inspectionDeliveryError_('INVALID_JOB','원래 전송과 접수 연결이 다릅니다.');
    shouldLog=true;
    var bytes=inspectionDeliveryMeasure_(timing,'validateBytes',function(){return inspectionDeliveryBytes_(p);});
    var reserved;
    if(!job){
      reserved=inspectionDeliveryReserve_(actor,p,filename,Utilities.getUuid(),timing);
      job=reserved.job;
    }
    if(job.owner!==actor.owner||job.sha256!==p.sha256||job.context.recordId!==p.recordId||p.requestId&&job.context.requestId!==p.requestId)
      throw inspectionDeliveryError_('INVALID_JOB','같은 전송 ID에 다른 문서나 연결을 제출할 수 없습니다.');
    job=inspectionDeliveryAdvance_(job.id,true,bytes,p.requestId,timing,reserved);
    return Object.assign(inspectionDeliveryView_(job),{serverMs:Date.now()-start,stageTimings:inspectionDeliveryTimings_(null,timing)});
  }catch(e){
    errorCode=e.code||(e.sourceConflict?'SOURCE_CHANGED':'SERVICE_PENDING');
    return {success:false,code:errorCode,error:e.message,retryable:['LOCK_BUSY','SERVICE_PENDING','DRIVE_PENDING','TARGET_PENDING'].indexOf(errorCode)>=0};
  }finally{
    if(shouldLog)inspectionDeliveryLog_(p.uploadId,p.action,timing,start,errorCode?{...job,code:errorCode}:job);
  }
}
function processInspectionDeliveries(){
  var start=Date.now(),table=inspectionDeliveryTable_(),count=table.getLastRow()-1;
  if(count<1)return;
  var expiry=table.getRange(2,6,count,1).getValues();
  var pending=table.getRange(2,1,count,3).getValues().filter(function(row,index){
    return row[1]!=='complete'&&row[1]!=='blocked'&&Number(row[2])<=start&&Number(expiry[index][0])>start;
  }).sort(function(a,b){return Number(a[2])-Number(b[2]);}).slice(0,8);
  pending.forEach(function(row){
    if(Date.now()-start>90000)return;
    var id=String(row[0]),jobStart=Date.now(),timing={},job;
    try{job=inspectionDeliveryAdvance_(id,false,null,'',timing);}catch(e){Logger.log('inspection delivery: '+(e.code||'SERVICE_PENDING'));}
    finally{inspectionDeliveryLog_(id,'background',timing,jobStart,job);}
  });
}
function installInspectionDeliveryTrigger(){
  if(!ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='processInspectionDeliveries';}))
    ScriptApp.newTrigger('processInspectionDeliveries').timeBased().everyMinutes(1).create();
}
/** Editor-only setup. Checks the private Drive folder and bridge before enabling intake. */
function activateInspectionDelivery(){
  if(!hwKvMode_())throw new Error('업무 KV 연결 설정을 확인하세요.');
  var folderId=PropertiesService.getScriptProperties().getProperty('INSPECTION_PDF_FOLDER_ID');
  if(!/^[A-Za-z0-9_-]+$/.test(folderId||''))throw new Error('기존 PDF 저장 폴더를 확인하세요.');
  var folder=inspectionDeliveryDrive_('drive/v3/files/'+folderId+'?fields=id,capabilities(canAddChildren)');
  if(!folder.value?.capabilities?.canAddChildren)throw new Error('PDF 저장 폴더 쓰기 권한을 확인하세요.');
  var generated=inspectionDeliveryDrive_('drive/v3/files/generateIds?count=1&space=drive');
  if(!generated.value?.ids?.length)throw new Error('Drive 파일 식별자 발급을 확인하세요.');
  var bridge=hwKvCall_('inspection_target',{recordId:'inspection_probe_'+Utilities.getUuid(),requestId:''});
  if(bridge.code!=='TARGET_PENDING')throw new Error('Deno 내역서 연결 준비를 확인하세요.');
  inspectionDeliveryLocked_(inspectionDeliveryTable_,{});
  installInspectionDeliveryTrigger();
  PropertiesService.getScriptProperties().setProperty('INSPECTION_DELIVERY_V2','enabled');
  Logger.log('점검 내역서 전송 활성화 · Drive 사전 확인, Deno 연결, 서버 재개 트리거 확인');
}
