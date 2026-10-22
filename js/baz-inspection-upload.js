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
  const outbox=options.outbox||null,preparations=new WeakMap();let current=null;
  function checkAccount(owner){if(options.token()!==owner){const e=new Error('로그인 계정이 변경되었습니다. 다시 내역서를 열어 확인하세요.');e.noRetry=true;throw e;}}
  function message(s,text){if(current===s)status.textContent=text;}
  function progress(s,stage,value){s.stages[stage]=value;if(current===s&&options.onProgress)options.onProgress({...s.stages},s.context);}
  function notice(s,text){message(s,text+(s.storageWarning?' · 이 기기에 재전송 파일을 보관하지 못했습니다. 화면을 닫기 전에 PDF를 따로 저장하세요.':''));}
  async function persist(s){
   if(!outbox)return;try{if(!s.ownerKey)s.ownerKey=await ownerKey(s.owner);checkAccount(s.owner);
    await outbox.put({key:s.ownerKey+':'+s.uploadId,owner:s.ownerKey,blob:s.blob||null,filename:s.filename,context:{...s.context},uploadId:s.uploadId,sha256:s.sha256||'',baseRevision:s.baseRevision??null,saved:s.saved||null,recorded:!!s.recorded,preparationRetryable:!!s.preparationRetryable,stages:{...s.stages},updatedAt:Date.now()});s.storageWarning=false;
   }catch{s.storageWarning=true;}
  }
  function sourceContext(context,resolved){
   if(typeof resolved.recordId!=='string'||!resolved.recordId.trim()){const e=new Error('원본 확인 응답이 불완전합니다. 같은 PDF로 원본 확인·저장을 다시 시도해 주세요.');e.transient=true;throw e;}
   if(context.recordId&&context.recordId!==resolved.recordId){const e=new Error('AS 처리 현황의 연결 기록이 다릅니다. 원본을 확인한 뒤 다시 생성하세요.');e.sourceConflict=true;throw e;}
   return {...context,recordId:resolved.recordId,sourceBasis:resolved.sourceBasis,sourcePdfRevision:context.sourcePdfRevision??resolved.pdf?.revision??0};
  }
  function payload(context){const {sourcePreparationError,attachmentApplicable,...rest}=context;return rest;}
  async function prepareContext(context,owner){
   let prepared=sourceContext(payload(context),await call('inspection_pdf_resolve',payload(context),owner));
   if(options.prepareContext)prepared={...prepared,...await options.prepareContext(prepared)};
   checkAccount(owner);return prepared;
  }
  async function call(action,data,owner,s){
   const measured=root.BazPerf?root.BazPerf.start(action):function(){},url=new URL(options.url);
   if(url.origin!=='https://script.google.com'||!/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname))throw new Error('PDF 저장 서버 주소를 확인하세요.');
   // Google ContentService redirects the response to another origin. Keep each
   // transport distinct from warm-up GETs and stale browser redirect caches;
   // uploadId/hash/baseRevision in the body remain fixed across retries.
   url.searchParams.set('pdfRequest',id());
   const ctl=new AbortController(),expires=Date.now()+(action==='inspection_pdf_resolve'?30000:120000);let timer,rejectLocal;
   const timeout=new Promise((_,reject)=>{rejectLocal=reject;});
   function cancel(){ctl.abort();const e=new Error('응답 대기 시간이 지났거나 전송 확인을 중단했습니다. 같은 파일로 다시 확인해 주세요.');e.transient=true;rejectLocal(e);}
   timer=setTimeout(cancel,action==='inspection_pdf_resolve'?30000:120000);
   if(s){s.cancel=cancel;s.expires=expires;}
   try{
    checkAccount(owner);
    const result=await Promise.race([timeout,(async()=>{
     const response=await (options.fetch||fetch)(url.href,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...data,action,token:owner}),signal:ctl.signal,cache:'no-store',credentials:'omit'});checkAccount(owner);
     if(response.ok===false){const e=new Error('저장 서버 응답 오류 ('+response.status+').');e.transient=response.status===408||response.status===429||response.status>=500;e.noRetry=!e.transient;throw e;}
     const value=await response.json();checkAccount(owner);return value;
    })()]);
    if(!result||typeof result.success!=='boolean'){const e=new Error('저장 서버 응답을 확인하지 못했습니다. 같은 파일로 다시 시도해 주세요.');e.transient=true;throw e;}
    if(!result.success){const e=new Error(result.error||'PDF 저장 응답을 확인하지 못했습니다.');e.sourceConflict=!!result.sourceConflict;e.noRetry=!!result.conflict;e.transient=!!result.retryable;throw e;}
    return result;
   }catch(e){checkAccount(owner);if(e.name==='AbortError'||e.transient==null&&!e.noRetry)e.transient=true;throw e;}
   finally{clearTimeout(timer);if(s){s.cancel=null;s.expires=0;}measured();}
  }
  function encoded(blob,s){return new Promise((resolve,reject)=>{
   const reader=new FileReader();let settled=false;const timer=setTimeout(()=>finish(new Error('PDF 파일 읽기가 지연되고 있습니다. 같은 파일로 다시 시도해 주세요.')),30000);
   function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);reader.onload=reader.onerror=null;if(reader.readyState===1)reader.abort();if(s){s.cancel=null;s.expires=0;}error?reject(error):resolve(value);}
   if(s){s.cancel=()=>finish(new Error('파일 읽기를 다시 확인해 주세요. 같은 PDF로 재시도할 수 있습니다.'));s.expires=Date.now()+30000;}
   reader.onload=()=>finish(null,String(reader.result).split(',')[1]);reader.onerror=()=>finish(new Error('PDF 파일을 읽지 못했습니다. 같은 파일로 다시 시도해 주세요.'));reader.readAsDataURL(blob);
  });}
  function safeLink(saved){const u=new URL(saved.pdf.url);if(u.origin!=='https://drive.google.com'||!/^\/file\/d\/[A-Za-z0-9_-]+\/view$/.test(u.pathname)||u.username||u.password||u.hash)throw new Error('PDF 링크 응답이 올바르지 않습니다.');return u.href;}
  async function confirm(s){
   let rejectLocal;const local=new Promise((_,reject)=>{rejectLocal=reject;});
   const cancel=()=>{const e=new Error('댓글 연결 결과를 다시 확인해 주세요. PDF를 다시 전송할 필요는 없습니다.');e.pending=true;rejectLocal(e);};
   const timer=setTimeout(cancel,45000);s.cancel=cancel;s.expires=Date.now()+45000;
   if(current===s){retry.hidden=false;retry.textContent='댓글 연결 다시 확인';}
   try{return await Promise.race([local,options.confirmAttachment(s.saved,s.context)]);}finally{clearTimeout(timer);s.cancel=null;s.expires=0;}
  }
  async function execute(s){
   s.busy=true;if(current===s){retry.hidden=true;newButton.disabled=true;}
   try{
    checkAccount(s.owner);if(!s.uploadId)s.uploadId=id();
    if(!s.saved){
     if(!s.blob)throw new Error('재전송할 PDF가 없습니다. 저장한 파일을 확인하거나 다시 생성하세요.');
     if(s.blob.size>MAX_BYTES){const e=new Error('Drive 자동 저장은 최대 7MB입니다. 사진을 줄이고 다시 생성하세요.');e.noRetry=true;throw e;}
     await persist(s);
     if(s.context.sourcePreparationError&&!s.preparationRetryable){const e=new Error(s.context.sourcePreparationError+' 원본을 확인한 뒤 PDF를 다시 생성하세요.');e.noRetry=true;throw e;}
     if(!s.context.hospital||!s.context.date)throw new Error('병원명과 점검일을 확인하세요.');
     message(s,'PDF 생성 완료 · AS 처리 현황을 확인하는 중…');
     if(s.context.sourcePreparationError||!s.context.recordId){s.context=await prepareContext(s.context,s.owner);s.preparationRetryable=false;}
     if(s.baseRevision==null)s.baseRevision=s.context.sourcePdfRevision??0;
     if(!s.sha256)s.sha256=await hash(s.blob);
     // Keep the original receipt and Blob durable before a possibly ambiguous write.
     await persist(s);if(!s.base64)s.base64=await encoded(s.blob,s);
     notice(s,'Google Drive에 PDF를 저장하는 중…');progress(s,'drive','working');
     if(current===s){retry.hidden=false;retry.textContent='전송 상태 다시 확인';}
     const saved=await call('inspection_pdf_upload',{...payload(s.context),uploadId:s.uploadId,filename:s.filename,bytes:s.blob.size,sha256:s.sha256,base64:s.base64,baseRevision:s.baseRevision},s.owner,s);
     if(saved.recordId&&saved.recordId!==s.context.recordId){const e=new Error('저장된 원본 ID가 다릅니다. 파일을 확인하세요.');e.noRetry=true;throw e;}
     safeLink(saved);s.saved=saved;
     s.base64=null;s.blob=null;await persist(s);
    }
    const href=safeLink(s.saved);progress(s,'drive','done');progress(s,'handover','done');checkAccount(s.owner);
    if(current===s){link.href=href;link.hidden=false;}
    if(!s.recorded){await options.onSaved(s.saved,s.context);s.recorded=true;await persist(s);}
    checkAccount(s.owner);
    if(options.confirmAttachment){
     progress(s,'comment','working');notice(s,'PDF 저장 완료 · 접수 댓글 첨부를 확인하는 중…');
     const previousRequest=s.context.requestId,result=await confirm(s);checkAccount(s.owner);
     if(s.context.requestId&&s.context.requestId!==previousRequest)await options.onSaved(s.saved,s.context);
     if(result?.applicable===false){progress(s,'comment','skipped');notice(s,'PDF 저장 완료 · 연결된 접수가 없어 댓글 첨부 대상이 없습니다.');}
     else{progress(s,'comment','done');notice(s,'PDF 생성·Drive 저장·AS 처리 현황 연결·접수 댓글 첨부 완료');}
    }else{progress(s,'comment','skipped');notice(s,s.saved.warning||'Google Drive·AS 처리 현황 저장 완료 · 접수 동기화 후 댓글에서 AS/점검 내역서를 확인하세요.');}
    s.complete=true;if(current===s)retry.hidden=true;
    if(outbox&&s.ownerKey)try{await outbox.remove(s.ownerKey+':'+s.uploadId);}catch{}
   }catch(e){
    if(s.context.sourcePreparationError&&!e.transient)s.preparationRetryable=false;
    progress(s,s.saved?'comment':'drive',e.pending?'pending':'error');await persist(s);
    notice(s,(s.saved?'PDF는 Drive와 AS 처리 현황에 저장되었습니다. ':'PDF는 생성되었습니다. ')+(e.message||'저장 확인 실패'));
    if(current===s){retry.textContent=s.saved?'댓글 연결 다시 시도':s.context.sourcePreparationError&&s.preparationRetryable?'원본 확인·저장 다시 시도':'Drive 저장 다시 시도';retry.hidden=(!!s.context.sourcePreparationError&&!s.preparationRetryable)||!!e.sourceConflict||!!e.noRetry;}
   }finally{s.busy=false;if(current===s)newButton.disabled=false;}
  }
  function run(s){if(s.busy)return s.running;s.running=execute(s);return s.running;}
  async function retryCurrent(){const s=current;if(!s)return;if(s.busy){if(!s.cancel)return;s.cancel();await s.running;}if(current===s)return run(s);}
  retry.addEventListener('click',retryCurrent);
  // Safari may suspend timers/network while sharing or locking the screen.
  function resume(){const s=current;if(s?.busy&&s.cancel&&Date.now()>=s.expires)s.cancel();}
  if(doc.addEventListener)doc.addEventListener('visibilitychange',()=>{if(!doc.hidden)resume();});
  if(root.addEventListener)root.addEventListener('pageshow',resume);
  return {
   async prepare(context){const owner=options.token();let prepared,retryable=false;try{prepared=await prepareContext(context,owner);}catch(e){retryable=!!e.transient&&!e.sourceConflict&&!e.noRetry;prepared={...context,sourcePreparationError:e.message||'AS 처리 현황 원본 확인 실패'};}preparations.set(prepared,{owner,retryable});return prepared;},
   publish(blob,filename,context){const p=preparations.get(context);link.hidden=true;current={blob,filename,context:{...context},owner:p?p.owner:options.token(),preparationRetryable:!!p?.retryable,busy:false,stages:{pdf:'done'}};progress(current,'drive','waiting');return run(current);},
   resume(saved,context){link.hidden=true;current={saved,recorded:true,context:{...context},owner:options.token(),busy:false,stages:{pdf:'done',drive:'done',handover:'done'}};return run(current);},
   async restore(context){
    if(!outbox||current?.busy)return false;const previous=current,token=options.token();let job;
    try{job=await outbox.find(await ownerKey(token),context);}catch{return false;}
    checkAccount(token);if(!job||current!==previous)return false;
    current={...job,ownerKey:job.owner,owner:token,context:{...job.context},busy:false};
    // Earlier clients classified this incomplete success response as a terminal
    // failure. Recheck the real source before sending the preserved file.
    if(!current.saved&&current.context.sourcePreparationError==='AS 처리 현황의 기록 ID를 확인하지 못했습니다.')current.preparationRetryable=true;
    if(options.onRecovered)options.onRecovered(job);progress(current,job.saved?'comment':'drive','pending');notice(current,'이전에 중단된 전송입니다. 같은 파일로 저장·댓글 연결을 다시 확인할 수 있습니다.');
    retry.hidden=false;retry.textContent=job.saved?'댓글 연결 다시 시도':'Drive 저장 다시 시도';if(job.saved){link.href=safeLink(job.saved);link.hidden=false;}return true;
   },
   reset(){current=null;status.textContent='';retry.hidden=true;link.hidden=true;newButton.disabled=false;if(options.onProgress)options.onProgress({},{});}
  };
 }
 root.BazInspectionUpload={create,MAX_BYTES};
})(typeof window!=='undefined'?window:this);
