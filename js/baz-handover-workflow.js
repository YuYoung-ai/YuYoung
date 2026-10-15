(function(){
 'use strict';
 function initialise(){
 var flow=window.BazWorkFlow,api=window.BazWorkAPI,target=flow.route(location.search);
 var account=BazAuth.name(),archive=document.getElementById('workFlowArchives');
 var archived=Object.keys(localStorage).filter(function(k){return k.startsWith('baz_handover_draft_archive_'+encodeURIComponent(account)+'_');}).sort().reverse();
 if(archived.length){archive.hidden=false;var list=archive.querySelector('div');archived.forEach(function(k){try{var d=JSON.parse(localStorage.getItem(k));var b=document.createElement('button');b.type='button';b.textContent=(d.form?.hosp||'병원 미기록')+' · '+(d.form?.date||'날짜 미기록');b.onclick=function(){if(!confirm('현재 작성 내용도 보관한 뒤 이 초안을 열까요?'))return;var current=BazHandover.loadDraft(localStorage);if(current&&BazHandover.draftHasContent(current))localStorage.setItem('baz_handover_draft_archive_'+encodeURIComponent(account)+'_'+Date.now(),JSON.stringify(current));BazHandover.saveDraft(localStorage,d.form,{workflow:d.workflow});location.href=d.workflow?.requestId?flow.url('handover.html',d.workflow.requestId):'handover.html';};list.appendChild(b);}catch(e){}});}
 if(!target)return;
 var box=document.getElementById('workFlow'),message=document.getElementById('workFlowMessage'),actions=document.getElementById('workFlowActions');
 var key='baz_handover_workflow_v1_'+encodeURIComponent(account)+'_'+target.requestId;
 var ctx={requestId:target.requestId},initial=BazHandover.snapshot(readForm()),linking=false,ready=false,userEdited=false;
 ['input','change'].forEach(function(type){document.addEventListener(type,function(event){if(event.target.closest('.wrap')&&!event.target.closest('#workFlow'))userEdited=true;});});
 box.hidden=false;
 function persist(){try{localStorage.setItem(key,JSON.stringify({...ctx,account:account}));return true;}catch(e){return false;}}
 function text(value){message.textContent=value;}
 function buttons(items){actions.replaceChildren();items.forEach(function(item){var b=document.createElement('button');b.type='button';b.textContent=item.label;b.addEventListener('click',item.run);actions.appendChild(b);});}
 function context(){return ready?{requestId:ctx.requestId,recordId:RECORD_ID||SAVED_RECORD_ID||''}:null;}
 function saved(){return !!(ctx.linked&&ctx.recordId&&ctx.recordId===SAVED_RECORD_ID);}
 function refreshContinue(){var b=document.getElementById('btnCont');if(b)b.disabled=!(saved()&&SAVED_SNAPSHOT&&!BazHandover.isDirty(SAVED_SNAPSHOT,readForm()));}
 function pendingState(state){
  if(!ready)return true;
  if(['saving','checking','unknown'].includes(state)&&LAST_SAVE_PAYLOAD){var p={...LAST_SAVE_PAYLOAD};delete p.token;ctx.pendingSave={payload:p,snapshot:LAST_SENT_SNAPSHOT};return persist();}
  return true;
 }
 function reset(){if(!ready)return;delete ctx.recordId;delete ctx.savedForm;delete ctx.pendingLink;delete ctx.pendingSave;ctx.linked=false;persist();text('이 접수의 새 현장 기록입니다. 실제 처리일과 처리 장비를 확인하세요.');}
 async function link(){
  if(linking||!ctx.recordId)return;linking=true;refreshContinue();buttons([]);text('현장 기록 저장 완료 · 해당 접수에 연결하는 중…');
  try{
   if(BazAuth.name()!==account)throw new Error('로그인 계정이 변경되었습니다. 다시 접수에서 시작하세요.');
   if(!ctx.pendingLink){
    var source=await api.get('work_handover_detail',{requestId:ctx.requestId,recordId:ctx.recordId});if(!source.success||!source.source||!source.workDetail?.request)throw new Error(source.error||'저장된 원본 확인 실패');
    var status=await api.get('work_document_status',{requestId:ctx.requestId,recordId:ctx.recordId});
    if(status.success&&status.sourceLinked){ctx.linked=true;persist();text('현장 기록 저장·접수 연결 완료 · 내역서를 이어서 작성하세요.');buttons([{label:'내역서 이어쓰기',run:contToInspection}]);return;}
    var old=source.workDetail.history.find(function(h){return h.kind==='result'&&h.source.recordId===ctx.recordId;});
    ctx.pendingLink={requestId:ctx.requestId,recordId:ctx.recordId,sourceVersion:source.source.version,baseRevision:source.workDetail.request.revision,baseHistoryRevision:old?.revision||0,operationId:api.id()};
    if(!persist())throw new Error('연결 재시도 정보를 보관하지 못했습니다. 접수 화면에서 원본을 연결하세요.');
   }
   var result=await api.post('work_field_result_link',ctx.pendingLink);
   if(!result.success){if(!result.retrySameOperation){delete ctx.pendingLink;persist();}throw new Error(result.error||'접수 연결 실패');}
   ctx.linked=true;delete ctx.pendingLink;persist();text('현장 기록 저장·접수 연결 완료 · 내역서를 이어서 작성하세요.');buttons([{label:'내역서 이어쓰기',run:contToInspection}]);
  }catch(e){text('현장 기록은 저장되었습니다. '+e.message);buttons([{label:'접수 연결 다시 시도',run:link},{label:'접수 확인',run:function(){location.href=flow.url('hospital-work.html',ctx.requestId);}}]);}
  finally{linking=false;refreshContinue();}
 }
 function onSaved(recordId,form){if(!ready||!flow.valid(recordId))return;ctx.recordId=recordId;ctx.savedForm=BazHandover.snapshot(form);ctx.linked=false;delete ctx.pendingSave;delete ctx.pendingLink;persist();link();}
 function applyRequest(request){
  ready=true;ctx.request=request;
  var draft=BazHandover.loadDraft(localStorage),ownDraft=draft?.workflow?.requestId===request.id;
  var cache;try{cache=JSON.parse(localStorage.getItem(key)||'null');}catch(e){}
  if(cache?.account===account&&cache.requestId===request.id){
   ctx={...cache,request};
   if(ctx.pendingSave){
    restoreDraft(ownDraft?draft:{form:ctx.pendingSave.snapshot});LAST_SAVE_PAYLOAD={...ctx.pendingSave.payload,token:BazAuth.token()};LAST_REQ_ID=LAST_SAVE_PAYLOAD.reqId;RECORD_ID=LAST_REQ_ID;LAST_SENT_SNAPSHOT=ctx.pendingSave.snapshot;
    setSaveState(BazHandover.SAVE.UNKNOWN);text('이 접수의 이전 기록 저장 결과를 확인해야 합니다. 같은 기록으로 확인·재시도합니다.');buttons([{label:'기록 여부 확인',run:recheckSave}]);return;
   }
   if(ctx.recordId&&ctx.savedForm){
    restoreDraft(ownDraft?draft:{form:ctx.savedForm});SAVED_RECORD_ID=ctx.recordId;SAVED_SNAPSHOT=BazHandover.snapshot(ctx.savedForm);setSaveState(BazHandover.SAVE.SUCCESS);enableCopy(!BazHandover.isDirty(SAVED_SNAPSHOT,readForm()));link();return;
   }
  }
  if(draft?.workflow?.requestId===request.id){restoreDraft(draft);if(flow.valid(draft.workflow.recordId))RECORD_ID=draft.workflow.recordId;}
  else{
   restoreDraft({form:flow.reportForm(request)});
   ['detail','remark'].forEach(function(id){setVal(id,'');});
   ['cat','sub','result'].forEach(function(id){var select=document.getElementById(id);if(!Array.from(select.options).some(function(o){return o.value==='';})){var blank=document.createElement('option');blank.value='';blank.textContent='선택하세요';select.prepend(blank);}select.value='';});
  }
  if(flow.serials(request.sn).length>1&&!draft?.form?.sn){var select=document.getElementById('sn');if(!Array.from(select.options).some(function(o){return o.value==='';})){var blank=document.createElement('option');blank.value='';blank.textContent='처리 장비를 선택하세요';select.prepend(blank);}select.value='';}
  render();
  persist();text(request.hospitalName+' · 배정 '+(request.engineer||'미지정')+' · 방문 예정 '+(request.visitAt||'미정')+'\n접수 증상: '+request.symptom+'\n실제 처리일·처리 장비를 확인하고 기록하세요.');buttons([]);
 }
 async function start(){
  text('접수 정보를 불러오는 중…');buttons([]);
  try{
   var result=await api.get('work_document_status',{requestId:target.requestId});if(!result.success||result.request?.id!==target.requestId)throw new Error(result.error||'접수 연결 정보가 다릅니다.');
   await window.handoverBoot;
   var draft=BazHandover.loadDraft(localStorage),other=draft&&BazHandover.draftHasContent(draft)&&draft.workflow?.requestId!==target.requestId;
   var changed=userEdited&&BazHandover.isDirty(initial,readForm());
   if(other||changed){
    text('작성 중인 현장 기록을 보존했습니다. 이 접수로 시작하면 기존 내용은 별도 초안으로 보관됩니다.');
    buttons([{label:'이 접수 작성',run:function(){
     var preserved=changed?{v:1,at:Date.now(),form:BazHandover.snapshot(readForm())}:draft;
     try{localStorage.setItem('baz_handover_draft_archive_'+encodeURIComponent(account)+'_'+Date.now(),JSON.stringify(preserved));}catch(e){text('기존 초안을 보관하지 못했습니다. 먼저 현재 내용을 저장하세요.');return;}
     // Confirmed choice: reset inputs before applying another request, not the old source.
     ready=false;startNewRecord();applyRequest(result.request);
    }},{label:'기존 초안 이어쓰기',run:function(){if(changed)BazHandover.saveDraft(localStorage,readForm());else if(draft)restoreDraft(draft);location.href=!changed&&draft?.workflow?.requestId?flow.url('handover.html',draft.workflow.requestId):'handover.html';}}]);
   }else applyRequest(result.request);
  }catch(e){text('접수 정보를 확인하지 못했습니다. '+e.message);buttons([{label:'다시 불러오기',run:start}]);}
 }
 window.BazHandoverFlow={context:context,onSaved:onSaved,canContinue:saved,pendingState:pendingState,reset:reset};
 start();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialise,{once:true});else initialise();
})();
