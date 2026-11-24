(function(root){
 'use strict';
 const MAX_BYTES=7*1024*1024;
 function id(){if(typeof crypto.randomUUID==='function')return crypto.randomUUID();const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;return Array.from(b,(n,i)=>([4,6,8,10].includes(i)?'-':'')+n.toString(16).padStart(2,'0')).join('');}
 async function hash(blob){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');}
 async function ownerKey(token){
  let identity=token;try{const p=JSON.parse(atob(token.split('.')[0].replace(/-/g,'+').replace(/_/g,'/')));if(/^[gp]:[A-Za-z0-9_-]{43}$/.test(p.u))identity=p.u;}catch{}
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity))),b=>b.toString(16).padStart(2,'0')).join('');
 }
 function create(options){
  const doc=options.document||document,status=doc.getElementById('pdfUploadStatus'),retry=doc.getElementById('pdfUploadRetry'),link=doc.getElementById('pdfOpenLink'),newButton=doc.getElementById('doneNew');
  const outbox=options.outbox||null,preparations=new WeakMap();let current=null,transferChain=Promise.resolve();const active=new Set();
  function visible(s){return current===s&&(!options.isCurrent||options.isCurrent(s.context));}
  function select(s){if(!options.isCurrent||options.isCurrent(s.context)){current=s;link.hidden=true;}return s;}
  function checkAccount(owner){if(options.token()!==owner){const e=new Error('로그인 계정이 변경되었습니다. 다시 내역서를 열어 확인하세요.');e.noRetry=true;throw e;}}
  function message(s,text){
   if(!visible(s))return;
   status.textContent=text;
   options.onStatus?.(text);
  }
  function progress(s,stage,value){s.stages[stage]=value;if(visible(s)&&options.onProgress)options.onProgress({...s.stages},s.context);}
  function notice(s,text){message(s,text+(s.storageWarning?' · 이 기기에 재전송 파일을 보관하지 못했습니다. 화면을 닫기 전에 PDF를 따로 저장하세요.':''));}
  async function persist(s){
   if(!outbox)return;try{if(!s.ownerKey)s.ownerKey=await ownerKey(s.owner);checkAccount(s.owner);
    await outbox.put({key:s.ownerKey+':'+s.uploadId,owner:s.ownerKey,blob:s.blob||null,filename:s.filename,context:{...s.context},uploadId:s.uploadId,sha256:s.sha256||'',baseRevision:s.baseRevision??null,saved:s.saved||null,recorded:!!s.recorded,recovering:!!s.recovering,uploadAttempted:!!s.uploadAttempted,preparationRetryable:!!s.preparationRetryable,autoResumeEligible:!!s.autoResumeEligible,needsTarget:!!s.needsTarget,stages:{...s.stages},updatedAt:Date.now()});s.storageWarning=false;
   }catch{s.storageWarning=true;}
  }
  function sourceContext(context,resolved){
   if(typeof resolved.recordId!=='string'||!resolved.recordId.trim()){const e=new Error('원본 확인 응답이 불완전합니다. 같은 PDF로 원본 확인·저장을 다시 시도해 주세요.');e.transient=true;throw e;}
   if(context.recordId&&context.recordId!==resolved.recordId){const e=new Error('AS 처리 현황의 연결 기록이 다릅니다. 원본을 확인한 뒤 다시 생성하세요.');e.sourceConflict=true;throw e;}
   if(context.requireSourceBasis){
    if(!context.sourceBasis||context.sourceBasis.fingerprint!==resolved.sourceBasis?.fingerprint||context.sourceBasis.format!==resolved.sourceBasis?.format){const e=new Error('생성 기준 원본을 확인할 수 없거나 Handover 내용이 변경되었습니다. PDF는 보관됩니다. 기록 연결 변경에서 원본을 확인한 뒤 다시 생성하세요.');e.sourceConflict=true;throw e;}
    if(context.sourcePdfRevision!=null&&Number(context.sourcePdfRevision)!==Number(resolved.pdf?.revision||0)){const e=new Error('생성 준비 이후 다른 PDF가 저장되었습니다. 보관된 파일과 최신 문서를 확인한 뒤 다시 생성하세요.');e.sourceConflict=true;throw e;}
   }
   return {...context,recordId:resolved.recordId,sourceBasis:context.sourceBasis||resolved.sourceBasis,sourcePdfRevision:context.sourcePdfRevision??resolved.pdf?.revision??0,sourcePrepared:true};
  }
  function payload(context){const {sourcePreparationError,attachmentApplicable,requireSheetLink,...rest}=context;return rest;}
  async function prepareContext(context,owner){
   let prepared=sourceContext(payload(context),await call('inspection_pdf_resolve',payload(context),owner));
   if(options.prepareContext)prepared={...prepared,...await options.prepareContext(prepared)};
   checkAccount(owner);return prepared;
  }
  async function call(action,data,owner,s){
   const measured=root.BazPerf?.start(action),url=new URL(options.url);
   if(url.origin!=='https://script.google.com'||!/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname))throw new Error('PDF 저장 서버 주소를 확인하세요.');
   // Google ContentService redirects the response to another origin. Keep each
   // transport distinct from warm-up GETs and stale browser redirect caches;
   // uploadId/hash/baseRevision in the body remain fixed across retries.
   url.searchParams.set('pdfRequest',id());
   const duration=action==='inspection_pdf_job_status'?10000:action==='inspection_pdf_job_resume'?20000:action==='inspection_pdf_job_submit'?35000:action==='inspection_pdf_resolve'||action==='inspection_pdf_job_source'?30000:120000;
   const ctl=new AbortController(),expires=Date.now()+duration;let timer,rejectLocal,serverMs;
   const timeout=new Promise((_,reject)=>{rejectLocal=reject;});
   function cancel(){ctl.abort();const e=new Error('응답 대기 시간이 지났거나 전송 확인을 중단했습니다. 같은 파일로 다시 확인해 주세요.');e.transient=true;rejectLocal(e);}
   timer=setTimeout(cancel,duration);
   if(s){s.cancel=cancel;s.expires=expires;}
   try{
    checkAccount(owner);
    const result=await Promise.race([timeout,(async()=>{
     const response=await (options.fetch||fetch)(url.href,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...data,action,token:owner}),signal:ctl.signal,cache:'no-store',credentials:'omit'});checkAccount(owner);
     if(response.ok===false){const e=new Error('저장 서버 응답 오류 ('+response.status+').');e.transient=response.status===408||response.status===429||response.status>=500;e.noRetry=!e.transient;throw e;}
     const value=await response.json();checkAccount(owner);return value;
    })()]);
    serverMs=result?.serverMs;
    if(!result||typeof result.success!=='boolean'){const e=new Error('저장 서버 응답을 확인하지 못했습니다. 같은 파일로 다시 시도해 주세요.');e.transient=true;throw e;}
    if(!result.success){const e=new Error(result.error||'PDF 저장 응답을 확인하지 못했습니다.');e.code=result.code||'';e.sourceConflict=!!result.sourceConflict||['SOURCE_REQUIRED','SOURCE_CHANGED','VERSION_CHANGED','TARGET_CHANGED'].includes(e.code);e.noRetry=!!result.conflict||['WRONG_OWNER','INVALID_JOB','INVALID_FILE'].includes(e.code);e.transient=!e.sourceConflict&&!e.noRetry&&(!!result.retryable||e.code==='LOCK_BUSY'||/(잠금.*시간\s*초과|lock.*(?:timeout|timed out)|timed out.*lock)/i.test(e.message));throw e;}
    return result;
   }catch(e){checkAccount(owner);if(e.name==='AbortError'||e.transient==null&&!e.noRetry)e.transient=true;throw e;}
   finally{clearTimeout(timer);if(s){s.cancel=null;s.expires=0;}measured?.({bytes:data.bytes,serverMs,jobId:data.uploadId});}
  }
  function encoded(blob,s){return new Promise((resolve,reject)=>{
   const reader=new FileReader();let settled=false;const timer=setTimeout(()=>finish(new Error('PDF 파일 읽기가 지연되고 있습니다. 같은 파일로 다시 시도해 주세요.')),30000);
   function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);reader.onload=reader.onerror=null;if(reader.readyState===1)reader.abort();if(s){s.cancel=null;s.expires=0;}error?reject(error):resolve(value);}
   if(s){s.cancel=()=>finish(new Error('파일 읽기를 다시 확인해 주세요. 같은 PDF로 재시도할 수 있습니다.'));s.expires=Date.now()+30000;}
   reader.onload=()=>finish(null,String(reader.result).split(',')[1]);reader.onerror=()=>finish(new Error('PDF 파일을 읽지 못했습니다. 같은 파일로 다시 시도해 주세요.'));reader.readAsDataURL(blob);
  });}
  function safeLink(saved){const u=new URL(saved.pdf.url);if(u.origin!=='https://drive.google.com'||!/^\/file\/d\/[A-Za-z0-9_-]+\/view$/.test(u.pathname)||u.username||u.password||u.hash)throw new Error('PDF 링크 응답이 올바르지 않습니다.');return u.href;}
  function retryable(e){return !e.noRetry&&!e.sourceConflict&&!!(e.pending||e.transient||e.timeout||e.unknown||e.name==='TypeError');}
  async function pause(ms){if(options.delay)return options.delay(ms);return new Promise(resolve=>setTimeout(resolve,ms));}
  async function receipt(s){
   const resolved=await call('inspection_pdf_resolve',payload(s.context),s.owner,s);
   sourceContext({...s.context,requireSourceBasis:false},resolved);
   if(resolved.pdf?.sha256===s.sha256){
    const saved={success:true,recordId:resolved.recordId,pdf:resolved.pdf};safeLink(saved);s.saved=saved;s.blob=null;s.base64=null;s.autoResumeEligible=true;await persist(s);return true;
   }
   if(Number(resolved.pdf?.revision||0)>Number(s.baseRevision||0)){
    const conflict=new Error('다른 내역서가 최신 문서로 저장되었습니다. 원래 PDF는 기기에 보관되어 있습니다. 접수에서 최신 문서를 확인하세요.');conflict.noRetry=true;throw conflict;
   }
   return false;
  }
  async function reconcile(s){
   // A browser deadline does not stop Apps Script. Poll metadata, never send
   // another file while the original server write may still be completing.
   for(let attempt=0;attempt<3;attempt++){
    checkAccount(s.owner);
    if(attempt){notice(s,'전송 응답이 늦어 저장 결과를 다시 확인하는 중… ('+(attempt+1)+'/3)');await pause(attempt===1?2000:5000);}
    try{if(await receipt(s))return true;}catch(e){checkAccount(s.owner);if(!retryable(e))throw e;}
   }
   return false;
  }
  async function confirm(s,budget){
   let rejectLocal;const ctl=new AbortController(),local=new Promise((_,reject)=>{rejectLocal=reject;});
   const cancel=()=>{ctl.abort();const e=new Error('댓글 연결 결과를 다시 확인해 주세요. PDF를 다시 전송할 필요는 없습니다.');e.pending=true;e.budgetExhausted=true;rejectLocal(e);};
   // Read (20s), canonical Handover refresh (35s), repair (35s), read-back
   // after an uncertain write (20s) share one bounded confirmation budget.
   const ms=Math.min(120000,budget||120000),timer=setTimeout(cancel,ms);s.cancel=cancel;s.expires=Date.now()+ms;
   if(visible(s)){retry.hidden=false;retry.textContent='댓글 연결 다시 확인';}
   try{return await Promise.race([local,options.confirmAttachment(s.saved,s.context,{signal:ctl.signal})]);}finally{clearTimeout(timer);s.cancel=null;s.expires=0;}
  }
  async function jobRequest(s,action,data){
   const result=await call('inspection_pdf_job_'+action,{uploadId:s.uploadId,...data},s.owner,s);
   if(result.state!=='missing'&&(result.jobId!==s.uploadId||result.recordId!==s.context.recordId||result.sha256!==s.sha256||s.context.requestId&&(result.requestId||result.state==='complete')&&result.requestId!==s.context.requestId)){
    const error=new Error('전송 결과가 현재 내역서와 일치하지 않습니다.');error.noRetry=true;throw error;
   }
   return result;
  }
  async function showJob(s,result){
   if(result.state==='missing')return;
   if(result.requestId)s.context.requestId=result.requestId;
   if(result.received){s.base64=null;progress(s,'drive','done');}
   if(result.pdf){
    s.saved={success:true,recordId:result.recordId,pdf:result.pdf};
    const href=safeLink(s.saved);if(visible(s)){link.href=href;link.hidden=false;}
    s.blob=null;
    progress(s,'handover','done');
   }
   if(result.state==='complete'&&result.commentAttached)progress(s,'comment','done');
   if(result.state!=='complete')await persist(s);
  }
  async function executeJob(s,automatic){
   let result={state:'missing'};
   if(s.uploadAttempted||!s.blob){
    notice(s,'같은 PDF의 서버 저장 결과를 확인하는 중…');
    result=await jobRequest(s,'status');
    await showJob(s,result);
   }
   if(!automatic&&!s.blob&&s.context.deliveryUploadId&&result.state==='receiving'&&!result.processing){
    result=await jobRequest(s,'resume',{requestId:s.context.requestId||''});
    await showJob(s,result);
   }
   if(!result.received&&result.state!=='blocked'&&!automatic&&s.blob){
    if(s.blob.size>MAX_BYTES){const error=new Error('PDF는 최대 7MB까지 전송할 수 있습니다.');error.noRetry=true;throw error;}
    if(s.context.requireSheetLink&&!s.linkConfirmed){
     notice(s,'PDF 생성 완료 · 시트 원본과 접수 연결을 확인하는 중…');
     progress(s,'handover','working');
     try{
      if(s.initialSheetLink){
       const failure=await s.initialSheetLink;
       s.initialSheetLink=null;
       if(failure)throw failure;
      }else await options.repairTarget(s.context);
      checkAccount(s.owner);
      s.linkConfirmed=true;
     }catch(cause){
      const error=new Error(cause.message||'시트 원본과 접수 연결을 확인해 주세요.');
      error.pending=true;
      error.sheetLink=true;
      throw error;
     }
    }
    const prepared=root.BazPerf?.start('pdf_delivery_prepare');
    let base64;
    try{
     s.sha256=s.sha256||await hash(s.blob);
     s.uploadAttempted=true;
     await persist(s);
     base64=await encoded(s.blob,s);
    }finally{prepared?.({bytes:s.blob.size,jobId:s.uploadId});}
    notice(s,'PDF 저장 및 접수 댓글 연결 중…');progress(s,'drive','working');
    result=await jobRequest(s,'submit',{...payload(s.context),filename:s.filename,bytes:s.blob.size,sha256:s.sha256,base64,baseRevision:s.context.sourcePdfRevision});
    await showJob(s,result);
   }
   if(result.received&&result.state!=='complete'&&(result.state!=='blocked'||!automatic&&result.code==='COMMENT_DELETED')){
    notice(s,'PDF 수신 완료 · 서버가 Handover와 접수 댓글을 연결하는 중…');
    progress(s,result.pdf?'comment':'handover','working');
    let uncertain=false;
    async function resumeJob(){
     try{result=await jobRequest(s,'resume',{requestId:s.context.requestId||''});await showJob(s,result);}
     catch(error){if(!retryable(error))throw error;uncertain=true;}
    }
    if(!result.processing)await resumeJob();
    if(!automatic&&!result.processing&&result.code==='TARGET_PENDING'&&s.context.requestId&&visible(s)&&options.repairTarget){
     notice(s,'원래 접수의 Handover 연결을 다시 확인하는 중…');
     try{await options.repairTarget({...s.context});checkAccount(s.owner);await resumeJob();}
     catch(error){if(!retryable(error))throw error;error.pending=true;throw error;}
    }
    if(uncertain||result.processing||result.code==='LOCK_BUSY'){
     for(const delay of [1000,2000,3000]){
      await pause(delay);if(!visible(s))break;
      try{result=await jobRequest(s,'status');await showJob(s,result);}
      catch(error){if(!retryable(error))throw error;continue;}
      if(result.state==='complete'||result.state==='blocked'||result.code==='TARGET_PENDING'&&!result.processing)break;
     }
    }
   }
   if(result.state==='complete'&&result.commentAttached&&s.saved){
    s.deliveryConfirmed=true;
    if(!s.recorded){
     const measured=root.BazPerf?.start('pdf_delivery_local_save');
     try{await options.onSaved(s.saved,s.context);s.recorded=true;}
     catch(error){
      checkAccount(s.owner);
      await persist(s);
      notice(s,'Drive 저장·Handover 연결·댓글 첨부 완료 · 기기 보관을 다시 확인해 주세요. '+error.message);
      if(visible(s)){retry.hidden=false;retry.textContent='기기 연결 정보 다시 보관';}
      return;
     }
     finally{measured?.({jobId:s.uploadId});}
    }
    s.complete=true;s.autoResumeEligible=false;
    notice(s,'PDF 생성·Drive 저장·Handover 연결·접수 댓글 첨부 완료');
    if(visible(s))retry.hidden=true;
    if(outbox&&s.ownerKey)try{await outbox.remove(s.ownerKey+':'+s.uploadId);}catch{}
    return;
   }
   const waitingForTarget=result.code==='TARGET_PENDING'&&!s.context.requestId;
   s.needsTarget=waitingForTarget;
   const error=new Error(waitingForTarget?'Drive에 PDF를 보관했습니다. 이 현장 기록을 기존 접수에 연결하면 서버가 댓글 첨부를 이어갑니다.':result.message||(result.received?'서버에서 같은 PDF의 연결을 계속 확인합니다.':'원래 PDF의 수신을 확인하지 못했습니다. 이어서 전송을 눌러 주세요.'));
   error.pending=result.state!=='blocked';
   error.sourceConflict=['SOURCE_CHANGED','VERSION_CHANGED','TARGET_CHANGED'].includes(result.code);
   error.noRetry=result.state==='blocked'&&result.code!=='COMMENT_DELETED';
   throw error;
  }
  async function execute(s,automatic){
   s.busy=true;if(visible(s)){retry.hidden=true;retry.disabled=true;newButton.disabled=false;}
   try{
    checkAccount(s.owner);if(!s.uploadId)s.uploadId=id();
    if(s.context.transferVersion===2){
     try{await executeJob(s,automatic);}
     catch(error){
      if(automatic||!retryable(error)||error.pending)throw error;
      await pause(1200);
      await executeJob(s,false);
     }
     return;
    }
    if(s.recovering){
     message(s,'Google Drive에 이미 저장된 PDF 정보를 확인하는 중…');
     const resolved=await call('inspection_pdf_resolve',payload(s.context),s.owner,s);
     let context=sourceContext(s.context,resolved);
     if(!resolved.pdf){const e=new Error('이 Handover 기록에서 저장된 PDF를 찾지 못했습니다. 원본 기록과 Drive 링크를 확인하세요.');e.noRetry=true;throw e;}
     if(options.prepareContext)context={...context,...await options.prepareContext(context)};
     checkAccount(s.owner);const saved={success:true,recordId:resolved.recordId,pdf:resolved.pdf};safeLink(saved);
     s.context=context;s.saved=saved;s.filename=resolved.pdf.filename||'AS/점검 내역서';s.recovering=false;
     if(visible(s)&&options.onRecovered)options.onRecovered({saved,filename:s.filename,context});progress(s,'pdf','done');await persist(s);
    }
    if(!s.saved){
     if(!s.blob)throw new Error('재전송할 PDF가 없습니다. 저장한 파일을 확인하거나 다시 생성하세요.');
     if(s.blob.size>MAX_BYTES){const e=new Error('Drive 자동 저장은 최대 7MB입니다. 사진을 줄이고 다시 생성하세요.');e.noRetry=true;throw e;}
     await persist(s);
     if(s.context.sourcePreparationError&&!s.preparationRetryable){const e=new Error(s.context.sourcePreparationError+' 원본을 확인한 뒤 PDF를 다시 생성하세요.');e.noRetry=true;throw e;}
     if(!s.context.hospital||!s.context.date)throw new Error('병원명과 점검일을 확인하세요.');
     message(s,'PDF 생성 완료 · AS 처리 현황을 확인하는 중…');
     if(s.context.sourcePreparationError||!s.context.recordId||s.context.sourcePrepared===false){s.context=await prepareContext(s.context,s.owner);s.preparationRetryable=false;}
     if(s.baseRevision==null)s.baseRevision=s.context.sourcePdfRevision??0;
     if(!s.sha256)s.sha256=await hash(s.blob);
     // Keep the original receipt and Blob durable before a possibly ambiguous write.
     await persist(s);
     if(s.uploadAttempted){
      notice(s,'이전 전송의 Drive 저장 결과를 먼저 확인하는 중…');
      if(!await receipt(s)&&automatic){const pending=new Error('아직 저장 결과가 확인되지 않았습니다. 같은 PDF를 보관하고 있습니다. 저장 확인·재시도로 이어갈 수 있습니다.');pending.pending=true;throw pending;}
     }
     if(!s.saved){
     if(!s.base64)s.base64=await encoded(s.blob,s);
     notice(s,'Google Drive에 PDF를 저장하는 중…');progress(s,'drive','working');
     // A click cannot stop Apps Script after it has accepted the write. Wait
     // for this attempt's response/deadline before allowing the same-file retry.
     s.uploadAttempted=true;await persist(s);
     let saved;
     try{saved=await call('inspection_pdf_upload',{...payload(s.context),uploadId:s.uploadId,filename:s.filename,bytes:s.blob.size,sha256:s.sha256,base64:s.base64,baseRevision:s.baseRevision},s.owner,s);}
     catch(e){
      checkAccount(s.owner);
      if(!retryable(e))throw e;
      s.autoResumeEligible=true;await persist(s);
      notice(s,'Drive 응답이 늦어 실제 저장 결과를 확인하는 중… PDF를 다시 전송하지 않습니다.');
      if(!await reconcile(s)){e.pending=true;throw e;}
      saved=s.saved;
     }
     if(saved.recordId&&saved.recordId!==s.context.recordId){const e=new Error('저장된 원본 ID가 다릅니다. 파일을 확인하세요.');e.noRetry=true;throw e;}
     safeLink(saved);s.saved=saved;
     s.base64=null;s.blob=null;await persist(s);
     }
    }
    const href=safeLink(s.saved);progress(s,'drive','done');progress(s,'handover','done');checkAccount(s.owner);
    if(visible(s)){link.href=href;link.hidden=false;}
    let localRecordError=null;
    if(!s.recorded){try{await options.onSaved(s.saved,s.context);s.recorded=true;}catch(e){checkAccount(s.owner);localRecordError=e;}await persist(s);}
    checkAccount(s.owner);
    if(options.confirmAttachment){
     progress(s,'comment','working');notice(s,'PDF 저장 완료 · 접수 댓글 첨부를 확인하는 중…');
     const previousRequest=s.context.requestId,deadline=Date.now()+120000;let result;
     for(let attempt=0;;attempt++){
      try{result=await confirm(s,deadline-Date.now());checkAccount(s.owner);break;}
      catch(e){
       checkAccount(s.owner);const delay=attempt===0?2000:5000;
       if(!retryable(e)||e.budgetExhausted||attempt>=2||deadline-Date.now()<delay+10000)throw e;
       progress(s,'comment','pending');notice(s,'PDF는 저장되었습니다. 댓글 연결 반영을 다시 확인하는 중… ('+(attempt+1)+'/2)');await persist(s);await pause(delay);
      }
     }
     if(s.context.requestId&&s.context.requestId!==previousRequest){try{await options.onSaved(s.saved,s.context);s.recorded=true;localRecordError=null;}catch(e){checkAccount(s.owner);s.recorded=false;localRecordError=e;}}
     if(result?.applicable===false){progress(s,'comment','skipped');notice(s,'PDF 저장 완료 · 연결된 접수가 없어 댓글 첨부 대상이 없습니다.');}
     else{progress(s,'comment','done');notice(s,'PDF 생성·Drive 저장·AS 처리 현황 연결·접수 댓글 첨부 완료');}
    }else{progress(s,'comment','skipped');notice(s,s.saved.warning||'Google Drive·AS 처리 현황 저장 완료 · 접수 동기화 후 댓글에서 AS/점검 내역서를 확인하세요.');}
    if(localRecordError){s.autoResumeEligible=true;s.nextAutoResumeAt=Date.now()+5000;await persist(s);notice(s,'서버 저장·댓글 확인은 완료되었습니다. 기기의 연결 정보 보관만 다시 확인해 주세요. '+(localRecordError.message||''));if(visible(s)){retry.hidden=false;retry.textContent='기기 연결 정보 다시 보관';}return;}
    s.complete=true;s.autoResumeEligible=false;if(visible(s))retry.hidden=true;
    if(outbox&&s.ownerKey)try{await outbox.remove(s.ownerKey+':'+s.uploadId);}catch{}
   }catch(e){
    s.autoResumeEligible=!s.needsTarget&&retryable(e);s.nextAutoResumeAt=Date.now()+5000;
    if(s.context.sourcePreparationError&&!e.transient)s.preparationRetryable=false;
    if(e.sheetLink){progress(s,'handover','pending');}
    else if(s.context.transferVersion===2&&e.sourceConflict){progress(s,'source','blocked');}
    else progress(s,s.saved?'comment':s.context.transferVersion===2&&s.stages.drive==='done'?'handover':'drive',e.pending||s.context.transferVersion===2&&s.stages.drive==='done'&&retryable(e)?'pending':'error');
    await persist(s);
    notice(s,(s.saved?'PDF는 Drive와 AS 처리 현황에 저장되었습니다. ':'PDF는 생성되었습니다. ')+(e.message||'저장 확인 실패'));
    if(visible(s)){retry.textContent=s.saved?'댓글 연결 다시 시도':s.context.sourcePreparationError&&s.preparationRetryable?'원본 확인·저장 다시 시도':s.uploadAttempted?'저장 확인·재시도':'Drive 저장 다시 시도';retry.hidden=(!!s.context.sourcePreparationError&&!s.preparationRetryable)||!!e.sourceConflict||!!e.noRetry;}
    if(visible(s)&&s.context.transferVersion===2&&!e.noRetry&&!e.sourceConflict){retry.hidden=false;retry.textContent=s.needsTarget&&options.chooseTarget?'기존 접수 연결':'이어서 전송';}
   }finally{s.base64=null;s.busy=false;if(visible(s)){newButton.disabled=false;retry.disabled=false;}}
  }
  function run(s,automatic){
   if(s.busy)return s.running;
   s.busy=true;if(!s.uploadId)s.uploadId=id();active.add(s);
   if(active.size>1)notice(s,'PDF 생성 완료 · 앞선 문서의 전송이 끝나면 이 파일을 전송합니다.');
   // Persist every newly generated Blob before waiting for another document's
   // transfer. Network writes are serialized, local PDF rendering is independent.
   const queued=root.BazPerf?.start('pdf_delivery_queue'),checkpoint=persist(s);
   s.running=transferChain.catch(()=>{}).then(async()=>{
    await checkpoint;
    queued?.({jobId:s.uploadId});
    return execute(s,automatic);
   }).finally(()=>{
    s.busy=false;active.delete(s);
    if(Number.isFinite(s.startedAt)){
     const metric=(s.deliveryConfirmed||s.complete&&s.stages.comment==='done')&&visible(s)?'pdf_delivery_total':'pdf_delivery_incomplete';
     root.BazPerf?.start(metric,s.startedAt)({bytes:s.originalBytes,jobId:s.uploadId});
     s.startedAt=null;
    }
    if(options.onIdle&&options.token()===s.owner)try{options.onIdle(s.context);}catch{}
    if(s.complete&&s.stages.comment==='done'&&visible(s)&&options.token()===s.owner)options.onComplete?.(s.context);
   });
   transferChain=s.running;return s.running;
  }
  async function retryCurrent(){
   const s=current;
   if(!s||!visible(s)||s.busy)return;
   if(s.needsTarget&&options.chooseTarget){
    return options.chooseTarget(s.context,async requestId=>{
     checkAccount(s.owner);
     if(!visible(s)||s.busy)return;
     s.context.requestId=requestId;s.needsTarget=false;
     await run(s);
    });
   }
   return run(s);
  }
  retry.addEventListener('click',retryCurrent);
  // Safari may suspend timers/network while sharing or locking the screen.
  function resume(){const s=current;if(!s||!visible(s))return;if(s?.busy&&s.cancel&&Date.now()>=s.expires)s.cancel();else if(s&&!s.busy&&!s.complete&&s.autoResumeEligible&&Date.now()>=(s.nextAutoResumeAt||0)&&(s.resumeAttempts||0)<3){s.resumeAttempts=(s.resumeAttempts||0)+1;run(s,true);}}
  if(doc.addEventListener)doc.addEventListener('visibilitychange',()=>{if(!doc.hidden)resume();});
  if(root.addEventListener)root.addEventListener('pageshow',resume);
  if(root.addEventListener)root.addEventListener('online',resume);
  return {
   retry:retryCurrent,
   async source(context){
    try{return (await call('inspection_pdf_job_source',context,options.token())).receipt;}
    catch(error){if(error.code==='DELIVERY_DISABLED'||/지원하지 않는 PDF 요청/.test(error.message))return null;throw error;}
   },
   async restoreServer(context){
    if(!context.recordId||current?.busy||options.isCurrent&&!options.isCurrent(context))return false;
    const previous=current,owner=options.token();
    let result;
    const id=context.deliveryUploadId;
    try{result=await call(id?'inspection_pdf_job_status':'inspection_pdf_job_lookup',
      id?{uploadId:id}:{recordId:context.recordId,hospital:context.hospital,date:context.date,sn:context.sn},owner);}
    catch(error){if(error.code==='DELIVERY_DISABLED'||/지원하지 않는 PDF 요청/.test(error.message))return false;throw error;}
    if(!result.received&&!(id&&result.state==='receiving')||id&&result.jobId!==id||
      result.recordId!==context.recordId||current!==previous||options.isCurrent&&!options.isCurrent(context)||
      context.requestId&&result.requestId&&context.requestId!==result.requestId)return false;
    const s=select({context:{...context,transferVersion:2,requestId:result.requestId||context.requestId},owner,uploadId:result.jobId,sha256:result.sha256,
      filename:result.filename,uploadAttempted:true,needsTarget:result.code==='TARGET_PENDING'&&!result.requestId&&!context.requestId,stages:{pdf:'done'},busy:false});
    if(visible(s)&&options.onRecovered)options.onRecovered({filename:s.filename,saved:result.pdf?{pdf:result.pdf}:null,bytes:result.bytes});
    await showJob(s,result);
    if(!visible(s))return false;
    notice(s,result.message||(result.received?'서버에 보관된 PDF입니다. 남은 단계의 결과를 확인하세요.':
      '기존 전송 ID로 이 장비의 PDF 수신 여부를 확인할 수 있습니다.'));
    retry.hidden=result.state==='blocked'&&result.code!=='COMMENT_DELETED';retry.textContent=s.needsTarget&&options.chooseTarget?'기존 접수 연결':'이어서 전송';return true;
   },
   async prepare(context){const owner=options.token();let prepared,retryable=false;try{prepared=await prepareContext(context,owner);}catch(e){retryable=!!e.transient&&!e.sourceConflict&&!e.noRetry;prepared={...context,sourcePreparationError:e.message||'AS 처리 현황 원본 확인 실패'};}preparations.set(prepared,{owner,retryable});return prepared;},
   isBusy(){return active.size>0;},
   recover(context){if(current?.busy&&current.context.taskId===context.taskId&&visible(current))return current.running;return run(select({recovering:true,context:{...context},owner:options.token(),busy:false,stages:{pdf:'waiting',drive:'working'}}));},
   publish(blob,filename,context,startedAt,initialSheetLink){
    if(current?.busy&&current.blob===blob&&current.context.taskId===context.taskId&&visible(current))return current.running;
    const p=preparations.get(context),s=select({blob,filename,context:{...context},owner:p?p.owner:options.token(),
      uploadId:context.deliveryUploadId||undefined,preparationRetryable:!!p?.retryable,busy:false,stages:{pdf:'done'},startedAt,originalBytes:blob.size,initialSheetLink});
    progress(s,'drive','waiting');
    return run(s);
   },
   resume(saved,context){if(current?.busy&&current.context.taskId===context.taskId&&visible(current))return current.running;return run(select({saved,recorded:true,context:{...context},owner:options.token(),busy:false,stages:{pdf:'done',drive:'done',handover:'done'}}));},
   async restore(context,settings){
    if(!outbox||current?.busy||options.isCurrent&&!options.isCurrent(context))return false;const previous=current,token=options.token();let job;
    try{job=await outbox.find(await ownerKey(token),context);}catch{return false;}
    checkAccount(token);
    if(!job||context.deliveryUploadId&&job.uploadId!==context.deliveryUploadId||current!==previous||
      options.isCurrent&&!options.isCurrent(context))return false;
    const requestId=job.context.requestId||(
      context.recordId&&context.recordId===job.context.recordId?context.requestId:'');
    current={...job,ownerKey:job.owner,owner:token,context:{...job.context,requestId,sessionEpoch:context.sessionEpoch},
      needsTarget:!requestId&&!!job.needsTarget,uploadAttempted:!!(job.uploadAttempted||!job.saved&&job.sha256),busy:false};
    // Earlier clients classified this incomplete success response as a terminal
    // failure. Recheck the real source before sending the preserved file.
    if(!current.saved&&/^(AS 처리 현황의 기록 ID를 확인하지 못했습니다\.|.*잠금.*시간\s*초과.*)$/.test(current.context.sourcePreparationError||''))current.preparationRetryable=true;
    if(visible(current)&&options.onRecovered)options.onRecovered({...job,context:current.context});progress(current,job.saved?'comment':'drive','pending');notice(current,'이전에 중단된 전송입니다. 같은 파일로 저장·댓글 연결을 다시 확인할 수 있습니다.');
    retry.hidden=false;retry.textContent=current.needsTarget&&options.chooseTarget?'기존 접수 연결':current.context.transferVersion===2?'이어서 전송':job.saved?'댓글 연결 다시 시도':'저장 확인·재시도';if(job.saved){link.href=safeLink(job.saved);link.hidden=false;}current.autoResumeEligible=false;return true;
   },
   reset(){current=null;status.textContent='';retry.hidden=true;link.hidden=true;newButton.disabled=false;if(options.onProgress)options.onProgress({},{});}
  };
 }
 root.BazInspectionUpload={create,MAX_BYTES};
})(typeof window!=='undefined'?window:this);
