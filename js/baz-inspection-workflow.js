(function(){
 'use strict';
 function initialise(){
  var flow=window.BazWorkFlow,api=window.BazWorkAPI,target=flow.route(location.search),account=BazAuth.name();
  var box=document.getElementById('inspectionWorkFlow'),message=document.getElementById('inspectionWorkFlowMessage'),actions=document.getElementById('inspectionWorkFlowActions');
  function button(label,run){var b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=run;actions.appendChild(b);}
  function back(requestId){var a=document.createElement('a');a.textContent='접수로 돌아가기';a.href=flow.url('hospital-work.html',requestId);actions.appendChild(a);}
  async function prepareContext(context){
   target=flow.route(location.search);
   if(BazAuth.name()!==account){var changed=new Error('로그인 계정이 변경되었습니다. 다시 접수에서 열어 주세요.');changed.noRetry=true;throw changed;}
   var requestId=context.requestId||'';
   if(target?.recordId&&context.recordId===target.recordId)requestId=requestId||target.requestId;
   if(target?.recordId&&context.recordId!==target.recordId){var mismatch=new Error('현재 작성 내용과 접수의 원본 ID가 다릅니다. 접수 내역서를 다시 불러오세요.');mismatch.noRetry=true;throw mismatch;}
   var status;try{status=await api.get('work_document_status',{requestId:requestId,recordId:context.recordId});}catch(e){e.transient=true;throw e;}
   if(!status.success&&status.retryable&&requestId&&window.BazInspectionRelink)status=await window.BazInspectionRelink.ensureLink({...context,requestId});
   if(!status.success){var error=new Error(status.error||'원본의 접수 연결을 먼저 확인하세요.');error.noRetry=!status.retryable;error.transient=!!status.retryable;throw error;}
   if(!status.request)return {...context,attachmentApplicable:false};
   if(requestId&&status.request.id!==requestId){var wrong=new Error('원본의 접수 연결이 다릅니다.');wrong.noRetry=true;throw wrong;}
   return {...context,requestId:status.request.id,attachmentApplicable:true};
  }
  async function confirmAttachment(saved,context,options){
   if(BazAuth.name()!==account)throw new Error('로그인 계정이 변경되었습니다. 다시 접수에서 열어 주세요.');
   var transport=options||{},params={requestId:context.requestId,recordId:context.recordId,sha256:saved.pdf.sha256};
   async function readStatus(){try{return await api.get('work_document_status',params,transport);}catch(e){if(!e.aborted&&!transport.signal?.aborted)e.pending=true;throw e;}}
   function validate(status){
    if(!status.success){var failed=new Error(status.error||'접수 첨부 확인 실패');failed.pending=!!status.retryable;failed.noRetry=!!status.deleted;throw failed;}
    if(status.documentChanged){var changed=new Error('다른 내역서가 최신 문서로 저장되었습니다. 접수에서 최신 문서를 확인하세요.');changed.noRetry=true;throw changed;}
    if(status.commentDeleted){var deleted=new Error('내역서 댓글이 삭제되어 있습니다. 접수의 댓글 이력을 확인하세요.');deleted.noRetry=true;throw deleted;}
    if(context.requestId&&status.request?.id&&status.request.id!==context.requestId){var wrong=new Error('내역서와 접수의 연결이 다릅니다.');wrong.noRetry=true;throw wrong;}
    return status;
   }
   function complete(status){
    validate(status);
    if(status.attachmentApplicable===false)return {applicable:false};
    if(!status.commentAttached){var pending=new Error('PDF는 저장되어 있고 접수 연결 정보가 아직 반영되지 않았습니다. PDF 재전송 없이 댓글 연결만 다시 확인할 수 있습니다.');pending.pending=true;throw pending;}
    context.requestId=status.request?.id||context.requestId;return {applicable:true};
   }
   // A previously completed write needs only a read; do not run repair/push jobs.
   var status=validate(await readStatus());
   if(status.commentAttached||status.attachmentApplicable===false)return complete(status);
   if(!status.pdfStored&&status.request?.id){
    // Recover authoritative metadata from the existing saved Handover row.
    // The browser never supplies a file URL or uploads the PDF again.
    var refreshed;try{refreshed=await api.get('work_handover_detail',{requestId:status.request.id,recordId:context.recordId},transport);}catch(e){if(!e.aborted&&!transport.signal?.aborted)e.pending=true;throw e;}
    if(!refreshed.success){var delayed=new Error(refreshed.error||'저장된 내역서 정보를 다시 확인해 주세요.');delayed.pending=true;throw delayed;}
   }
   try{status=await api.post('work_document_retry',params,transport);}
   catch(e){
    if(e.aborted||transport.signal?.aborted)throw e;
    // A timeout/lost response does not prove the write failed. Read back once
    // rather than issuing overlapping repairs against the same document.
    try{status=await readStatus();}
    catch(readError){readError.pending=true;throw readError;}
   }
   return complete(status);
  }
  function progress(state){
   var done=state.drive==='done'&&state.handover==='done'&&(state.comment==='done'||state.comment==='skipped'),needs=Object.values(state).some(function(s){return s==='error'||s==='pending';});
   var title=document.getElementById('doneTitle'),icon=document.getElementById('doneIcon'),lead=document.getElementById('doneLead');
   if(title)title.textContent=done?'점검 내역서 저장 완료':state.drive==='done'?'PDF 저장 완료 · 댓글 연결 '+(needs?'확인 필요':'확인 중'):'PDF 생성 완료 · 저장 '+(needs?'확인 필요':'확인 중');
   if(icon)icon.textContent=done?'✅':needs?'⚠️':'⏳';
   if(lead)lead.textContent=done?'확인된 저장 결과입니다.':state.drive==='done'?'저장된 PDF를 유지하고 댓글 연결만 확인합니다.':'전송이 지연되면 같은 PDF의 저장 결과를 다시 확인합니다.';
   var list=document.getElementById('pdfFlowStages');list.replaceChildren();
   flow.documentSteps(state).forEach(function(item){var li=document.createElement('li');li.dataset.state=item.state;li.textContent=item.label;var span=document.createElement('span');span.textContent={done:'완료',working:'확인 중',error:'재시도 필요',pending:'확인 대기',skipped:'연결 접수 없음',waiting:'대기'}[item.state];li.appendChild(span);list.appendChild(li);});
  }
  function refresh(reference,note){
   actions.replaceChildren();
   box.hidden=false;message.textContent=note||(reference?.requestId?'이 내역서는 접수의 현장 기록에 연결됩니다. 입력 내용은 자동 보존됩니다.':'이 기기에 보관된 미완료 PDF가 있으면 같은 파일로 전송을 다시 확인할 수 있습니다.');if(reference?.requestId)back(reference.requestId);
   button('Handover 기록 연결 변경',function(){window.BazInspectionRelink.open();});
   if(reference?.recordId){var ids=document.createElement('p');ids.textContent='기록 ID: '+reference.recordId+' · 접수 ID: '+(reference.requestId||'자동 확인');actions.appendChild(ids);}
   button('중단된 전송 복구',async function(){try{if(await pdfPublisher.restore({...reference,hospital:v('hospital'),date:v('inspectDate'),sn:v('serialNo'),taskId:_currentTaskId}))document.getElementById('doneOverlay').classList.add('show');else showToast('현재 병원·처리일·S/N에 맞는 미완료 전송이 없습니다.');}catch(e){showToast(e.message);}});
   if(reference?.recordId)button('저장된 PDF·댓글 복구',function(){document.getElementById('doneOverlay').classList.add('show');pdfPublisher.recover({requestId:reference.requestId,recordId:reference.recordId,hospital:v('hospital'),date:v('inspectDate'),sn:v('serialNo'),taskId:_currentTaskId});});
   if(uploadedPdfDocument){
    var url=new URL(uploadedPdfDocument.url);if(url.origin==='https://drive.google.com'&&/^\/file\/d\/[A-Za-z0-9_-]+\/view$/.test(url.pathname)){var a=document.createElement('a');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent='저장된 내역서 열기';actions.prepend(a);}
    if(reference?.recordId)button('저장·댓글 연결 확인',function(){document.getElementById('doneOverlay').classList.add('show');pdfPublisher.resume({success:true,recordId:reference.recordId,pdf:uploadedPdfDocument},{requestId:reference.requestId,recordId:reference.recordId,hospital:v('hospital'),date:v('inspectDate'),sn:v('serialNo'),taskId:_currentTaskId});});
   }
  }
  async function start(){
   try{await window.inspectionStorageReady;}catch{return;}
   if(!target?.recordId){refresh(handoverReference);return;}
   box.hidden=false;message.textContent='접수와 최신 현장 기록을 확인하는 중…';actions.replaceChildren();
   var initialTask=_currentTaskId,edited=false;
   function track(){edited=true;}document.querySelector('.wrap').addEventListener('input',track,{once:true});document.querySelector('.wrap').addEventListener('change',track,{once:true});
   document.getElementById('generateBtn').addEventListener('click',track,{once:true});
   try{
    var status=await api.get('work_document_status',{requestId:target.requestId,recordId:target.recordId});if(!status.success||status.request?.id!==target.requestId||status.source?.recordId!==target.recordId)throw new Error(status.error||'접수와 원본 연결 정보가 다릅니다.');
    if(BazAuth.name()!==account)throw new Error('로그인 계정이 변경되었습니다.');
    async function apply(){
     var existing=loadTasks().filter(function(t){return t.data?.handover?.recordId===target.recordId&&(!t.data.handover.requestId||t.data.handover.requestId===target.requestId);}).sort(function(a,b){return b.updatedAt-a.updatedAt;})[0];
     if(existing){if(!await openTask(existing.id))throw new Error('현재 작업을 보관하지 못했습니다.');handoverReference={...handoverReference,requestId:target.requestId};if(!String(existing.data?.basic?.receiver||'').trim()&&status.request.sales)document.getElementById('receiver').value=status.request.sales;else fillInspectionSales(status.request.sales);if(!await saveCurrentTask())throw new Error('초안 저장에 실패했습니다.');message.textContent='이 현장 기록의 기존 내역서를 이어서 열었습니다. 작성 중인 내용·사진·서명을 유지하며 비어 있는 영업 담당자는 접수·병원 DB에서 보완합니다.';}
     else{if(!await newTask({keepRoute:true}))throw new Error('현재 작업을 보관하지 못했습니다.');applyFormData(flow.inspectionData(status.source,status.request));if(status.source.pdf)uploadedPdfDocument=status.source.pdf;if(!await saveCurrentTask())throw new Error('초안 저장에 실패했습니다.');message.textContent='병원·장비·접수일·영업 담당자·실제 처리일·처리 내용을 불러왔습니다. 점검 결과와 사진을 확인하세요.';}
     refresh(handoverReference,message.textContent);
    }
    if((_currentTaskId!==initialTask)||edited){message.textContent='작성 중인 내용을 유지했습니다. 접수의 내역서는 현재 작업을 보관한 뒤 열 수 있습니다.';back(target.requestId);button('현재 작업 보관 후 내역서 열기',async function(){if(await saveCurrentTask())await apply();});}
    else await apply();
   }catch(e){message.textContent='접수·현장 기록을 확인하지 못했습니다. 작성 내용은 유지됩니다. '+e.message;back(target.requestId);button('다시 불러오기',start);}
  }
  window.BazInspectionFlow={prepareContext:prepareContext,confirmAttachment:confirmAttachment,progress:progress,refresh:refresh};
  window.inspectionWorkflowReady=start();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialise,{once:true});else initialise();
})();
