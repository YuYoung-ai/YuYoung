/** PDF bytes travel only between the browser and this Google Apps Script/Drive.
 * Add to the existing Handover project; do not create a new web-app URL.
 * PDF links and small metadata are carried by the existing Handover/KV bridge.
 */
var INSPECTION_PDF={MAX_BYTES:7*1024*1024,FOLDER_NAME:'AS_점검_내역서',LINK:'PDF 링크',META:'PDF 정보'};
/** Editor-only smoke check: a synthetic 7MB PDF, no Handover row or KV request. */
function verifyInspectionPdfDrive(){
  var text='%PDF-1.4\n',offsets=[0],contents='BT /F1 16 Tf 50 790 Td (7 MB PDF storage verification) Tj ET\n';
  var objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>','<< /Length '+contents.length+' >>\nstream\n'+contents+'endstream','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  objects.forEach(function(o,i){offsets.push(text.length);text+=(i+1)+' 0 obj\n'+o+'\nendobj\n';});var xref=text.length;
  text+='xref\n0 6\n0000000000 65535 f \n';offsets.slice(1).forEach(function(n){text+=('0000000000'+n).slice(-10)+' 00000 n \n';});text+='trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
  text+=' '.repeat(INSPECTION_PDF.MAX_BYTES-text.length);var blob=Utilities.newBlob(text,'application/pdf','PDF_7MB_저장확인.pdf'),file=null;
  try{file=inspectionPdfFolder_().createFile(blob);var bytes=file.getBlob().getBytes();if(bytes.length!==INSPECTION_PDF.MAX_BYTES||inspectionPdfHash_(bytes)!==inspectionPdfHash_(blob.getBytes()))throw new Error('Drive 파일 검증 실패');Logger.log(JSON.stringify({success:true,bytes:bytes.length,fileId:file.getId(),folderId:inspectionPdfFolder_().getId()}));return '7MB PDF 저장·검증 완료';}
  finally{if(file)file.setTrashed(true);}
}
function setupInspectionPdf(){
  var lock=LockService.getScriptLock();lock.waitLock(15000);
  try{
    var sh=hwSS_().getSheetByName(CONFIG.SHEET_NAME),hdr=findHeader_(sh);
    if(!hdr)throw new Error('Handover 헤더를 찾지 못했습니다.');
    [INSPECTION_PDF.LINK,INSPECTION_PDF.META].forEach(function(name){
      if(colBy_(hdr,[name]))return;
      var col=sh.getLastColumn()+1;if(col>sh.getMaxColumns())sh.insertColumnsAfter(sh.getMaxColumns(),col-sh.getMaxColumns());
      sh.getRange(hdr.row,col).setValue(name).setFontWeight('bold');hdr=findHeader_(sh);
    });
    var link=colBy_(hdr,[INSPECTION_PDF.LINK]),meta=colBy_(hdr,[INSPECTION_PDF.META]);
    sh.setColumnWidth(link,230);sh.hideColumns(meta);
    inspectionPdfFolder_();return 'PDF 링크: '+link+'열 / PDF 정보: '+meta+'열 · '+INSPECTION_PDF.FOLDER_NAME;
  }finally{lock.releaseLock();}
}
function inspectionPdfFolder_(){
  var props=PropertiesService.getScriptProperties(),id=props.getProperty('INSPECTION_PDF_FOLDER_ID');
  if(id)return DriveApp.getFolderById(id);
  var folder=DriveApp.createFolder(INSPECTION_PDF.FOLDER_NAME);props.setProperty('INSPECTION_PDF_FOLDER_ID',folder.getId());return folder;
}
function inspectionPdfHash_(bytes){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
function inspectionPdfStored_(raw,strict){
  var value=pickH_(raw,[INSPECTION_PDF.META]);if(!value)return null;
  var p;try{p=JSON.parse(value);}catch(e){if(strict)throw new Error('PDF 정보 형식이 잘못되었습니다.');return null;}
  if(!p.fileId||!/^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/view(?:\?resourcekey=[A-Za-z0-9_-]+)?$/.test(p.url||'')||p.url.indexOf('/'+p.fileId+'/')<0||!p.sha256||!p.revision){if(strict)throw new Error('PDF 파일 정보를 확인하세요.');return null;}
  return {fileId:String(p.fileId),url:String(p.url),filename:String(p.filename||'AS_점검_내역서.pdf').slice(0,240),bytes:Number(p.bytes)||0,sha256:String(p.sha256),revision:Number(p.revision),uploadedAt:String(p.uploadedAt||''),uploadedBy:String(p.uploadedBy||''),uploadId:String(p.uploadId||'')};
}
// No URL is accepted from the browser; the server creates the Drive URL itself.
function inspectionPdfSource_(raw){return inspectionPdfStored_(raw);}
function inspectionPdfRecord_(p){
  var sh=hwSS_().getSheetByName(CONFIG.SHEET_NAME),hdr=findHeader_(sh),col=hdr&&colBy_(hdr,REC_ID_COLS);
  if(!col)throw new Error('Handover 기록 ID 열이 없습니다.');
  var hit;
  if(p.recordId){
    var found=sh.getLastRow()>hdr.row?sh.getRange(hdr.row+1,col,sh.getLastRow()-hdr.row,1).createTextFinder(String(p.recordId)).matchEntireCell(true).findAll():[];
    if(found.length!==1)throw new Error(found.length?'Handover 기록 ID가 중복되어 있습니다.':'해당 Handover 기록이 없습니다. 먼저 현장 처리 내용을 시트에 기록하세요.');
    var row=found[0].getRow(),values=sh.getRange(row,1,1,sh.getLastColumn()).getDisplayValues()[0],raw={_row:row};
    hdr.headers.forEach(function(h,i){if(h)raw[h]=values[i];});hit={raw:raw,source:hwSource_(raw)};
  }else{
    var matches=hwSources_(String(p.hospital||'')).filter(function(x){return x.source.date===_issueDateNorm_(p.date)&&['A/S','점검'].indexOf(x.source.gubun)>=0&&inspectionPdfSerialMatch_(x.source.sn,p.sn);});
    if(matches.length!==1)throw new Error(matches.length?'같은 병원·날짜·S/N의 기록이 여러 건입니다. Handover의 내역서 이어쓰기로 해당 기록을 선택하세요.':'일치하는 Handover 기록이 없습니다. 먼저 현장 처리 내용을 시트에 기록한 뒤 내역서 이어쓰기를 사용하세요.');
    hit=matches[0];hwKvStableSource_(hit);
  }
  var s=hit.source;
  if(hwSourceName_(s.hospitalName)!==hwSourceName_(p.hospital)||s.date!==_issueDateNorm_(p.date)||!inspectionPdfSerialMatch_(s.sn,p.sn)||['A/S','점검'].indexOf(s.gubun)<0)throw new Error('내역서와 Handover의 병원·처리일·S/N이 다릅니다. 원본 기록을 확인하세요.');
  var link=colBy_(hdr,[INSPECTION_PDF.LINK]),meta=colBy_(hdr,[INSPECTION_PDF.META]);
  if(!link||!meta)throw new Error('PDF 열 초기화가 필요합니다. setupInspectionPdf를 실행하세요.');
  return {sheet:sh,row:hit.raw._row,linkCol:link,metaCol:meta,source:s,pdf:inspectionPdfStored_(hit.raw,true)};
}
function inspectionPdfSerialMatch_(a,b){
  function split(v){return String(v||'').normalize('NFKC').toUpperCase().split(/[,;\s/|、，]+/).filter(Boolean);}
  var aa=split(a),bb=split(b);return aa.length&&bb.length?aa.some(function(sn){return bb.indexOf(sn)>=0;}):!aa.length&&!bb.length;
}
function inspectionPdfActor_(p){
  var auth=typeof bazVerifyLocal_==='function'?bazVerifyLocal_(p.token||''):null;
  if(!auth||!auth.ok||Number(auth.level)<1)throw new Error('로그인이 필요합니다. 다시 로그인하세요.');return auth;
}
function inspectionPdfPublish_(hit,pdf){
  // Metadata is the durable receipt: a lost response retries the same file, not a new upload.
  hit.sheet.getRange(hit.row,hit.metaCol).setValue(JSON.stringify(pdf));
  hit.sheet.getRange(hit.row,hit.linkCol).setValue(pdf.url);SpreadsheetApp.flush();
  try{bazDropHandoverCaches_(hit.source.hospitalName);}catch(e){}
  var queued=false,warning='';
  try{hospitalWorkHandoverSaved_(hit.source.hospitalName,hit.source.date);queued=true;}
  catch(e){warning='PDF는 저장되었습니다. Handover 연동을 다시 실행하면 댓글에 반영됩니다.';Logger.log('[inspection-pdf] queue: '+String(e.message||e));}
  return {success:true,recordId:hit.source.recordId,pdf:pdf,queued:queued,warning:warning};
}
function inspectionPdfPost_(p){
  var result=inspectionPdfStore_(p);
  if(result.success&&p.action==='inspection_pdf_upload'&&hwKvMode_()){
    try{var delivered=hwKvDeliverSources_(result.recordId);hwKvPublishStatus_(delivered.error,delivered.failedIds);result.queued=false;result.warning=delivered.error||'';}
    catch(e){result.warning='PDF는 저장되었습니다. Handover 연동 재시도 또는 동기화 후 댓글을 확인하세요.';}
  }
  return result;
}
function inspectionPdfStore_(p){
  var lock=null,file=null,committed=false;
  try{
    var actor=inspectionPdfActor_(p);
    if(p.action!=='inspection_pdf_resolve'&&p.action!=='inspection_pdf_upload'&&p.action!=='inspection_pdf_probe')throw new Error('지원하지 않는 PDF 요청입니다.');
    if(p.action==='inspection_pdf_probe'&&Number(actor.level)<3)throw new Error('전송 검증은 관리자만 실행할 수 있습니다.');
    var bytes=null;
    if(p.action==='inspection_pdf_upload'||p.action==='inspection_pdf_probe'){
      if(!/^[A-Za-z0-9_-]{8,90}$/.test(String(p.uploadId||'')))throw new Error('PDF 전송 식별자가 없습니다.');
      if(!Number.isInteger(Number(p.bytes))||p.bytes<1||p.bytes>INSPECTION_PDF.MAX_BYTES)throw new Error('PDF는 최대 7MB까지 저장할 수 있습니다.');
      if(!/^[a-f0-9]{64}$/.test(p.sha256||''))throw new Error('PDF 검증 값이 없습니다.');
      var encoded=String(p.base64||'');if(encoded.length>Math.ceil(INSPECTION_PDF.MAX_BYTES/3)*4||!/^[-A-Za-z0-9+/]*={0,2}$/.test(encoded))throw new Error('PDF 전송 데이터가 잘못되었습니다.');
      bytes=Utilities.base64Decode(encoded);
      if(bytes.length!==Number(p.bytes)||inspectionPdfHash_(bytes)!==p.sha256||bytes.slice(0,5).map(function(x){return String.fromCharCode((x+256)%256);}).join('')!=='%PDF-')throw new Error('PDF가 손상되었거나 파일 크기가 다릅니다.');
    }
    if(p.action==='inspection_pdf_probe'){
      // Synthetic administrator check only. No Handover/KV data and no public sharing.
      file=inspectionPdfFolder_().createFile(Utilities.newBlob(bytes,'application/pdf','PDF_7MB_전송확인.pdf'));
      try{var back=file.getBlob().getBytes();if(back.length!==bytes.length||inspectionPdfHash_(back)!==p.sha256)throw new Error('Drive 전송 검증 실패');return {success:true,bytes:back.length,sha256:p.sha256,fileId:file.getId()};}
      finally{file.setTrashed(true);file=null;}
    }
    lock=LockService.getScriptLock();lock.waitLock(20000);
    var hit=inspectionPdfRecord_(p);
    if(p.action==='inspection_pdf_resolve')return {success:true,recordId:hit.source.recordId,pdf:hit.pdf};
    if(hit.pdf&&hit.pdf.sha256===p.sha256){committed=true;return inspectionPdfPublish_(hit,hit.pdf);}
    if(Number(p.baseRevision||0)!==Number(hit.pdf&&hit.pdf.revision||0))return {success:false,conflict:true,error:'다른 PDF가 먼저 저장되었습니다. 최신 정보를 확인한 뒤 다시 생성하세요.'};
    var filename=String(p.filename||'').replace(/[<>:/\\|?*"\x00-\x1f]/g,'').trim().slice(0,240);
    if(!filename||!(/\.pdf$/i.test(filename)))throw new Error('PDF 파일명을 확인하세요.');
    // The large Drive transfer must not hold the shared Handover save lock.
    lock.releaseLock();lock=null;
    file=inspectionPdfFolder_().createFile(Utilities.newBlob(bytes,'application/pdf',filename));
    file.setDescription('Handover 기록 ID: '+hit.source.recordId+' / 전송 ID: '+p.uploadId);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW);
    var key=typeof file.getResourceKey==='function'?file.getResourceKey():'';
    lock=LockService.getScriptLock();lock.waitLock(20000);hit=inspectionPdfRecord_(p);
    if(hit.pdf&&hit.pdf.sha256===p.sha256)return inspectionPdfPublish_(hit,hit.pdf);
    if(Number(p.baseRevision||0)!==Number(hit.pdf&&hit.pdf.revision||0))return {success:false,conflict:true,error:'다른 PDF가 먼저 저장되었습니다. 최신 정보를 확인한 뒤 다시 생성하세요.'};
    var pdf={fileId:file.getId(),url:'https://drive.google.com/file/d/'+file.getId()+'/view'+(key?'?resourcekey='+key:''),filename:filename,bytes:bytes.length,sha256:p.sha256,revision:Number(hit.pdf&&hit.pdf.revision||0)+1,uploadedAt:new Date().toISOString(),uploadedBy:actor.name,uploadId:p.uploadId};
    // Set the durable receipt first; if the visible link write fails, retry repairs it.
    hit.sheet.getRange(hit.row,hit.metaCol).setValue(JSON.stringify(pdf));committed=true;
    return inspectionPdfPublish_(hit,pdf);
  }catch(e){
    return {success:false,error:String(e.message||e)};
  }finally{if(lock){try{lock.releaseLock();}catch(ignore){}}if(file&&!committed){try{file.setTrashed(true);}catch(ignore){}}}
}
