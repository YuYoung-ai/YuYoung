(function(){
 'use strict';
 function initialise(){
  var flow=window.BazWorkFlow,api=window.BazWorkAPI,target=flow.route(location.search),account=BazAuth.name();
  var box=document.getElementById('inspectionWorkFlow'),message=document.getElementById('inspectionWorkFlowMessage'),actions=document.getElementById('inspectionWorkFlowActions');
  function button(label,run){var b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=run;actions.appendChild(b);}
  function back(requestId){var a=document.createElement('a');a.textContent='접수로 돌아가기';a.href=flow.url('hospital-work.html',requestId);actions.appendChild(a);}
  async function prepareContext(context){
   var status=await api.get('work_document_status',{requestId:context.requestId,recordId:context.recordId});if(!status.success||!status.sourceLinked)throw new Error(status.error||'원본의 접수 연결을 먼저 확인하세요.');
  }
  async function confirmAttachment(saved,context){
   if(BazAuth.name()!==account)throw new Error('로그인 계정이 변경되었습니다. 다시 접수에서 열어 주세요.');
   var params={requestId:context.requestId,recordId:context.recordId,sha256:saved.pdf.sha256};
   var status=await api.get('work_document_status',params);
   if(!status.success||!status.commentAttached){
    await api.post('work_document_retry',{requestId:context.requestId,recordId:context.recordId});
    status=await api.get('work_document_status',params);
   }
   if(!status.success)throw new Error(status.error||'접수 첨부 확인 실패');
   if(status.documentChanged){var changed=new Error('다른 내역서가 최신 문서로 저장되었습니다. 접수에서 최신 문서를 확인하세요.');changed.noRetry=true;throw changed;}
   if(status.commentDeleted){var deleted=new Error('내역서 댓글이 삭제되어 있습니다. 접수의 댓글 이력을 확인하세요.');deleted.noRetry=true;throw deleted;}
   if(!status.commentAttached)throw new Error('접수 댓글 연결이 대기 중입니다. 파일을 다시 전송하지 않고 연결만 재시도할 수 있습니다.');
  }
  function progress(state){
   var list=document.getElementById('pdfFlowStages');list.replaceChildren();
   flow.documentSteps(state).forEach(function(item){var li=document.createElement('li');li.dataset.state=item.state;li.textContent=item.label;var span=document.createElement('span');span.textContent={done:'완료',working:'확인 중',error:'재시도 필요',waiting:'대기'}[item.state];li.appendChild(span);list.appendChild(li);});
  }
  function refresh(reference,note){
   actions.replaceChildren();
   if(!reference?.requestId){box.hidden=true;return;}
   box.hidden=false;message.textContent=note||'이 내역서는 접수의 현장 기록에 연결됩니다. 입력 내용은 자동 보존됩니다.';back(reference.requestId);
   if(uploadedPdfDocument){
    var url=new URL(uploadedPdfDocument.url);if(url.origin==='https://drive.google.com'&&/^\/file\/d\/[A-Za-z0-9_-]+\/view$/.test(url.pathname)){var a=document.createElement('a');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent='저장된 내역서 열기';actions.prepend(a);}
    button('저장·댓글 연결 확인',function(){document.getElementById('doneOverlay').classList.add('show');pdfPublisher.resume({success:true,recordId:reference.recordId,pdf:uploadedPdfDocument},{requestId:reference.requestId,recordId:reference.recordId,hospital:v('hospital'),date:v('inspectDate'),sn:v('serialNo'),taskId:_currentTaskId});});
   }
  }
  async function start(){
   if(!target?.recordId){refresh(handoverReference);return;}
   box.hidden=false;message.textContent='접수와 최신 현장 기록을 확인하는 중…';actions.replaceChildren();
   var initialTask=_currentTaskId,edited=false;
   function track(){edited=true;}document.querySelector('.wrap').addEventListener('input',track,{once:true});document.querySelector('.wrap').addEventListener('change',track,{once:true});
   document.getElementById('generateBtn').addEventListener('click',track,{once:true});
   try{
    var status=await api.get('work_document_status',{requestId:target.requestId,recordId:target.recordId});if(!status.success||status.request?.id!==target.requestId||status.source?.recordId!==target.recordId)throw new Error(status.error||'접수와 원본 연결 정보가 다릅니다.');
    if(BazAuth.name()!==account)throw new Error('로그인 계정이 변경되었습니다.');
    function apply(){
     var existing=loadTasks().filter(function(t){return t.data?.handover?.recordId===target.recordId&&(!t.data.handover.requestId||t.data.handover.requestId===target.requestId);}).sort(function(a,b){return b.updatedAt-a.updatedAt;})[0];
     if(existing){if(!openTask(existing.id))throw new Error('현재 작업을 보관하지 못했습니다.');handoverReference={...handoverReference,requestId:target.requestId};if(!String(existing.data?.basic?.receiver||'').trim()&&status.request.sales)document.getElementById('receiver').value=status.request.sales;else fillInspectionSales(status.request.sales);saveCurrentTask();message.textContent='이 현장 기록의 기존 내역서를 이어서 열었습니다. 작성 중인 내용·사진·서명을 유지하며 비어 있는 영업 담당자는 접수·병원 DB에서 보완합니다.';}
     else{if(!newTask({keepRoute:true}))throw new Error('현재 작업을 보관하지 못했습니다.');applyFormData(flow.inspectionData(status.source,status.request));if(status.source.pdf)uploadedPdfDocument=status.source.pdf;saveCurrentTask();message.textContent='병원·장비·접수일·영업 담당자·실제 처리일·처리 내용을 불러왔습니다. 점검 결과와 사진을 확인하세요.';}
     refresh(handoverReference,message.textContent);
    }
    if((_currentTaskId!==initialTask)||edited){message.textContent='작성 중인 내용을 유지했습니다. 접수의 내역서는 현재 작업을 보관한 뒤 열 수 있습니다.';back(target.requestId);button('현재 작업 보관 후 내역서 열기',function(){if(saveCurrentTask())apply();});}
    else apply();
   }catch(e){message.textContent='접수·현장 기록을 확인하지 못했습니다. 작성 내용은 유지됩니다. '+e.message;back(target.requestId);button('다시 불러오기',start);}
  }
  window.BazInspectionFlow={prepareContext:prepareContext,confirmAttachment:confirmAttachment,progress:progress,refresh:refresh};
  start();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialise,{once:true});else initialise();
})();

