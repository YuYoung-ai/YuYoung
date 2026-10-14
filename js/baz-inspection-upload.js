(function(root){
  'use strict';
  const MAX_BYTES=7*1024*1024;
  function create(options){
    const doc=options.document||document,status=doc.getElementById('pdfUploadStatus'),retry=doc.getElementById('pdfUploadRetry'),link=doc.getElementById('pdfOpenLink'),newButton=doc.getElementById('doneNew');
    let current=null;
    function message(s,text){if(current===s)status.textContent=text;}
    async function call(action,payload){
      // Never use the Deno API, even as an error fallback: PDF bytes stay on Google's path.
      const url=new URL(options.url);if(url.origin!=='https://script.google.com'||!/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname))throw new Error('PDF 저장 서버 주소를 확인하세요.');
      const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),120000);
      try{
        const response=await (options.fetch||fetch)(url.href,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,action,token:options.token()}),signal:ctl.signal});
        const data=await response.json();if(!data||!data.success)throw new Error(data&&data.error||'PDF 저장 응답을 확인하지 못했습니다.');return data;
      }catch(e){if(e.name==='AbortError')throw new Error('응답 대기 시간이 지났습니다. 같은 파일로 다시 시도해 주세요.');throw e;}
      finally{clearTimeout(timer);}
    }
    async function run(s){
      if(s.busy)return;s.busy=true;retry.hidden=true;link.hidden=true;newButton.disabled=true;
      try{
        if(s.blob.size>MAX_BYTES)throw new Error('Drive 자동 저장은 최대 7MB입니다. 사진을 줄이고 다시 생성하세요.');
        if(!s.context.hospital||!s.context.date)throw new Error('병원명과 점검일을 확인하세요.');
        message(s,'PDF 생성 완료 · Handover 기록을 확인하는 중…');
        const resolved=await call('inspection_pdf_resolve',s.context);
        s.context.recordId=resolved.recordId;
        if(!s.sha256){
          const bytes=await s.blob.arrayBuffer();s.sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
          s.base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('PDF 파일을 읽지 못했습니다.'));reader.readAsDataURL(s.blob);});
        }
        message(s,'Google Drive에 PDF를 저장하는 중…');
        const saved=await call('inspection_pdf_upload',{...s.context,uploadId:s.uploadId,filename:s.filename,bytes:s.blob.size,sha256:s.sha256,base64:s.base64,baseRevision:resolved.pdf&&resolved.pdf.revision||0});
        const safe=new URL(saved.pdf.url);if(safe.origin!=='https://drive.google.com'||!/^\/file\/d\/[A-Za-z0-9_-]+\/view$/.test(safe.pathname))throw new Error('PDF 링크 응답이 올바르지 않습니다.');
        await options.onSaved(saved,s.context);
        if(current===s){link.href=safe.href;link.hidden=false;}
        message(s,saved.warning||'Google Drive·Handover 저장 완료 · 접수 동기화 후 댓글에서 AS/점검 내역서를 확인하세요.');
        s.base64=null;s.blob=null;
      }catch(e){message(s,'PDF는 생성되었습니다. '+(e.message||'Drive 저장 실패'));if(current===s)retry.hidden=false;}
      finally{s.busy=false;if(current===s)newButton.disabled=false;}
    }
    retry.addEventListener('click',()=>current?run(current):undefined);
    return {publish(blob,filename,context){current={blob,filename,context:{...context},uploadId:crypto.randomUUID(),busy:false};return run(current);},reset(){current=null;status.textContent='';retry.hidden=true;link.hidden=true;newButton.disabled=false;}};
  }
  root.BazInspectionUpload={create,MAX_BYTES};
})(typeof window!=='undefined'?window:this);
