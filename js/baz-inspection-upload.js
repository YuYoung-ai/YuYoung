(function(root){
  'use strict';
  const MAX_BYTES=7*1024*1024;
  function create(options){
    const doc=options.document||document,status=doc.getElementById('pdfUploadStatus'),retry=doc.getElementById('pdfUploadRetry'),link=doc.getElementById('pdfOpenLink'),newButton=doc.getElementById('doneNew');
    let current=null;
    // Keep the generating account outside request payloads and saved task data.
    const preparations=new WeakMap();
    function checkAccount(owner){if(options.token()!==owner){const e=new Error('로그인 계정이 변경되었습니다. 다시 내역서를 열어 확인하세요.');e.noRetry=true;throw e;}}
    function message(s,text){if(current===s)status.textContent=text;}
    function progress(s,stage,value){s.stages[stage]=value;if(current===s&&options.onProgress)options.onProgress({...s.stages},s.context);}
    async function call(action,payload,owner){
      const measured=root.BazPerf?root.BazPerf.start(action):function(){};
      // Never use the Deno API, even as an error fallback: PDF bytes stay on Google's path.
      const url=new URL(options.url);if(url.origin!=='https://script.google.com'||!/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname))throw new Error('PDF 저장 서버 주소를 확인하세요.');
      const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),action==='inspection_pdf_resolve'?30000:120000);
      try{
        checkAccount(owner);
        let response,data;
        try{
          response=await (options.fetch||fetch)(url.href,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,action,token:owner}),signal:ctl.signal});
          checkAccount(owner);
          if(response.ok===false){const e=new Error('저장 서버 응답 오류 ('+response.status+').');e.transient=response.status===408||response.status===429||response.status>=500;e.noRetry=!e.transient;throw e;}
          data=await response.json();
        }catch(e){
          checkAccount(owner);
          if(e.name==='AbortError'){const timeout=new Error('응답 대기 시간이 지났습니다. 같은 파일로 다시 시도해 주세요.');timeout.transient=true;throw timeout;}
          if(e.transient==null&&!e.noRetry)e.transient=true;
          throw e;
        }
        checkAccount(owner);
        if(!data||typeof data.success!=='boolean'){const e=new Error('저장 서버 응답을 확인하지 못했습니다. 같은 파일로 다시 시도해 주세요.');e.transient=true;throw e;}
        if(!data.success){const e=new Error(data.error||'PDF 저장 응답을 확인하지 못했습니다.');e.sourceConflict=!!data.sourceConflict;e.noRetry=!!data.conflict;throw e;}return data;
      }
      finally{clearTimeout(timer);measured();}
    }
    function sourceContext(context,resolved){
      if(!resolved.recordId||typeof resolved.recordId!=='string')throw new Error('AS 처리 현황의 기록 ID를 확인하지 못했습니다.');
      if(context.recordId&&context.recordId!==resolved.recordId){const e=new Error('AS 처리 현황의 연결 기록이 다릅니다. 원본을 확인한 뒤 다시 생성하세요.');e.sourceConflict=true;throw e;}
      return {...context,recordId:resolved.recordId,sourceBasis:resolved.sourceBasis,sourcePdfRevision:context.sourcePdfRevision??resolved.pdf?.revision??0};
    }
    function payload(context){const {sourcePreparationError,...rest}=context;return rest;}
    function encoded(blob){return new Promise((resolve,reject)=>{
      const reader=new FileReader(),timer=setTimeout(()=>finish(new Error('PDF 파일 읽기가 지연되고 있습니다. 같은 파일로 다시 시도해 주세요.')),30000);let settled=false;
      function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);reader.onload=reader.onerror=null;if(reader.readyState===1)reader.abort();error?reject(error):resolve(value);}
      reader.onload=()=>finish(null,String(reader.result).split(',')[1]);reader.onerror=()=>finish(new Error('PDF 파일을 읽지 못했습니다. 같은 파일로 다시 시도해 주세요.'));reader.readAsDataURL(blob);
    });}
    async function run(s){
      if(s.busy)return;s.busy=true;retry.hidden=true;newButton.disabled=true;
      try{
       checkAccount(s.owner);
       if(!s.saved){
        if(s.blob.size>MAX_BYTES)throw new Error('Drive 자동 저장은 최대 7MB입니다. 사진을 줄이고 다시 생성하세요.');
        if(s.context.sourcePreparationError&&!s.preparationRetryable){const e=new Error(s.context.sourcePreparationError+' 원본을 확인한 뒤 PDF를 다시 생성하세요.');e.noRetry=true;throw e;}
        if(!s.context.hospital||!s.context.date)throw new Error('병원명과 점검일을 확인하세요.');
        message(s,'PDF 생성 완료 · AS 처리 현황을 확인하는 중…');
        // Resolve again only after a transient pre-render failure, or for an
        // unprepared caller. Once fixed, the original revision survives every retry.
        if(s.context.sourcePreparationError||!s.context.recordId){
          s.context=sourceContext(payload(s.context),await call('inspection_pdf_resolve',payload(s.context),s.owner));
          s.preparationRetryable=false;
        }
        if(s.baseRevision==null)s.baseRevision=s.context.sourcePdfRevision??0;
        if(!s.sha256){
          const bytes=await s.blob.arrayBuffer();s.sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
        }
        if(!s.base64)s.base64=await encoded(s.blob);
        message(s,'Google Drive에 PDF를 저장하는 중…');
        progress(s,'drive','working');
        s.saved=await call('inspection_pdf_upload',{...payload(s.context),uploadId:s.uploadId,filename:s.filename,bytes:s.blob.size,sha256:s.sha256,base64:s.base64,baseRevision:s.baseRevision},s.owner);
        s.base64=null;s.blob=null;
       }
        const saved=s.saved,safe=new URL(saved.pdf.url);if(safe.origin!=='https://drive.google.com'||!/^\/file\/d\/[A-Za-z0-9_-]+\/view$/.test(safe.pathname))throw new Error('PDF 링크 응답이 올바르지 않습니다.');
        progress(s,'drive','done');progress(s,'handover','done');
        checkAccount(s.owner);
        if(!s.recorded){await options.onSaved(saved,s.context);s.recorded=true;}
        checkAccount(s.owner);
        if(current===s){link.href=safe.href;link.hidden=false;}
        if(options.confirmAttachment&&s.context.requestId){
          progress(s,'comment','working');message(s,'PDF 저장 완료 · 접수 댓글 첨부를 확인하는 중…');
          await options.confirmAttachment(saved,s.context);checkAccount(s.owner);progress(s,'comment','done');message(s,'PDF 생성·Drive 저장·AS 처리 현황 연결·접수 댓글 첨부 완료');
        }else message(s,saved.warning||'Google Drive·AS 처리 현황 저장 완료 · 접수 동기화 후 댓글에서 AS/점검 내역서를 확인하세요.');
      }catch(e){if(s.context.sourcePreparationError&&!e.transient)s.preparationRetryable=false;progress(s,s.saved?'comment':'drive','error');message(s,(s.saved?'PDF는 Drive와 AS 처리 현황에 저장되었습니다. ':'PDF는 생성되었습니다. ')+(e.message||'저장 확인 실패'));if(current===s){retry.textContent=s.saved?'댓글 연결 다시 시도':s.context.sourcePreparationError&&s.preparationRetryable?'원본 확인·저장 다시 시도':'Drive 저장 다시 시도';retry.hidden=(!!s.context.sourcePreparationError&&!s.preparationRetryable)||!!e.sourceConflict||!!e.noRetry;}}
      finally{s.busy=false;if(current===s)newButton.disabled=false;}
    }
    retry.addEventListener('click',()=>current?run(current):undefined);
    return {async prepare(context){
      const owner=options.token();let prepared,retryable=false;
      try{prepared=sourceContext(context,await call('inspection_pdf_resolve',context,owner));}
      catch(e){retryable=!!e.transient&&!e.sourceConflict&&!e.noRetry;prepared={...context,sourcePreparationError:e.message||'AS 처리 현황 원본 확인 실패'};}
      preparations.set(prepared,{owner,retryable});return prepared;
    },publish(blob,filename,context){const prepared=preparations.get(context);link.hidden=true;current={blob,filename,context:{...context},owner:prepared?prepared.owner:options.token(),preparationRetryable:!!prepared?.retryable,uploadId:crypto.randomUUID(),busy:false,stages:{pdf:'done'}};return run(current);},resume(saved,context){link.hidden=true;current={saved,recorded:true,context:{...context},owner:options.token(),busy:false,stages:{pdf:'done',drive:'done',handover:'done'}};return run(current);},reset(){current=null;status.textContent='';retry.hidden=true;link.hidden=true;newButton.disabled=false;if(options.onProgress)options.onProgress({},{});}};
  }
  root.BazInspectionUpload={create,MAX_BYTES};
})(typeof window!=='undefined'?window:this);
