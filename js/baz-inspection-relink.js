(function(root){
 'use strict';
 const flow=root.BazWorkFlow,api=root.BazWorkAPI;
 function basic(){return {hospital:v('hospital'),inspectDate:v('inspectDate'),serialNo:v('serialNo')};}
 function checked(result){if(!result?.success)throw new Error(result?.error||'연결 정보를 확인하지 못했습니다.');return result;}
 function key(account,recordId,requestId){return 'baz_inspection_link_v1_'+encodeURIComponent(account)+'_'+recordId+'_'+requestId;}
 async function ensureLink(context){
  const account=BazAuth.name(),params={requestId:context.requestId,recordId:context.recordId};
  const detail=checked(await api.get('work_handover_detail',{...params,hospitalName:context.hospital}));
  if(detail.source?.recordId!==context.recordId||!flow.sameInspectionIdentity(context,detail.source))throw new Error('선택한 Handover와 내역서의 병원·처리일·S/N이 다릅니다.');
  if(!context.requestId){const status=await api.get('work_document_status',{recordId:context.recordId});return checked(status.success?status:await api.post('work_document_retry',{recordId:context.recordId}));}
  let status=await api.get('work_document_status',params);
  if(!status.success)status=await api.post('work_document_retry',params);
  if(status.success&&status.sourceLinked)return status;
  if(!status.success&&status.code!=='SOURCE_PENDING'&&!status.retryable)throw new Error(status.error||'다른 접수에 연결된 기록입니다.');
  const request=detail.workDetail?.request;
  if(!request||request.id!==context.requestId)throw new Error('연결할 접수를 확인하지 못했습니다. 접수 관리에서 기록을 연결하세요.');
  const storageKey=key(account,context.recordId,context.requestId);let operation;
  try{operation=JSON.parse(localStorage.getItem(storageKey)||'null');}catch{}
  if(!operation){
   const old=detail.workDetail.history.find(h=>h.kind==='result'&&h.source?.recordId===context.recordId);
   operation={...params,sourceVersion:detail.source.version,baseRevision:request.revision,baseHistoryRevision:old?.revision||0,operationId:api.id()};
   localStorage.setItem(storageKey,JSON.stringify(operation));
  }
  if(BazAuth.name()!==account)throw new Error('로그인 계정이 변경되었습니다. 다시 열어 주세요.');
  const result=await api.post('work_field_result_link',operation);
  if(result.success||!result.retrySameOperation)localStorage.removeItem(storageKey);
  checked(result);return checked(await api.post('work_document_retry',params));
 }
 function open(){
  const account=BazAuth.name(),taskId=_currentTaskId,opened=basic();let selected=null,busy=false;
  const dialog=document.createElement('dialog');dialog.className='work-flow-panel inspection-relink';
  function node(tag,text){const n=document.createElement(tag);if(text)n.textContent=text;dialog.appendChild(n);return n;}
  node('h3','Handover 기록 연결 변경');
  node('p','병원·처리일·S/N과 처리 내용을 확인해 연결하세요. 시트의 기록 ID를 수정할 필요는 없습니다.');
  node('p','현재 병원: '+opened.hospital+' · '+opened.inspectDate+' · '+(opened.serialNo||'S/N 미기록'));
  const current=handoverReference;node('p','현재 기록 ID: '+(current?.recordId||'미연결')+'\n접수 ID: '+(current?.requestId||'자동 확인'));
  const label=node('label','Handover 기록 ID (목록 선택 또는 직접 입력)'),record=node('input');record.id='relink-record-id';label.htmlFor=record.id;record.value=current?.recordId||'';record.autocomplete='off';
  const find=node('button','현재 병원의 기록 찾기');find.type='button';
  const lookup=node('button','입력한 기록 조회');lookup.type='button';
  const list=node('div');list.className='work-flow-records';
  const requestLabel=node('label','연결할 접수 ID 또는 접수 주소 (선택)'),request=node('input');request.id='relink-request-id';requestLabel.htmlFor=request.id;request.value=current?.requestId||'';request.autocomplete='off';
  node('p','접수를 지정하지 않으면 해당 원본의 현재 접수 연결을 확인합니다. 접수 관리의 Handover 연결 관리에서도 원본을 선택할 수 있습니다.');
  const preview=node('p'),status=node('p');status.setAttribute('role','status');
  const apply=node('button','확인한 기록으로 연결');apply.type='button';apply.disabled=true;
  const close=node('button','닫기');close.type='button';close.onclick=()=>dialog.close();
  function guard(){if(BazAuth.name()!==account||_currentTaskId!==taskId||!flow.sameInspectionIdentity(opened,basic()))throw new Error('작성 중인 작업 또는 병원 정보가 변경되었습니다. 창을 닫고 다시 확인하세요.');}
  async function run(fn){if(busy)return;busy=true;record.disabled=request.disabled=find.disabled=lookup.disabled=apply.disabled=true;status.textContent='원본과 연결 정보를 확인하는 중…';try{guard();await fn();}catch(e){status.textContent=e.message;}finally{busy=false;record.disabled=request.disabled=find.disabled=lookup.disabled=false;apply.disabled=!selected;}}
  async function select(recordId){
   selected=null;const detail=checked(await api.get('work_handover_detail',{hospitalName:opened.hospital,recordId}));guard();
   if(detail.source?.recordId!==recordId)throw new Error('조회한 기록 ID가 다릅니다.');
   preview.textContent=[detail.source.sourceHospitalName||detail.source.hospitalName,detail.source.date,detail.source.sn,detail.source.engineer,detail.source.detail,'기록 ID: '+detail.source.recordId].filter(Boolean).join('\n');
   if(!flow.sameInspectionIdentity(opened,detail.source))throw new Error('병원·처리일·S/N이 현재 내역서와 다릅니다. 내역서 입력 또는 원본 선택을 확인하세요.');
   selected=detail.source;record.value=selected.recordId;status.textContent='원본을 확인했습니다. 처리 내용을 확인한 뒤 연결하세요.';
  }
  record.addEventListener('input',()=>{selected=null;apply.disabled=true;});
  lookup.onclick=()=>run(async()=>{if(!flow.valid(record.value.trim()))throw new Error('Handover 기록 ID를 확인하세요.');await select(record.value.trim());});
  find.onclick=()=>run(async()=>{
   if(!opened.hospital)throw new Error('내역서의 병원명을 먼저 입력하세요.');
   const data=checked(await api.get('work_handover_candidates',{hospitalName:opened.hospital}));guard();list.replaceChildren();selected=null;
   const rows=(data.data||[]).filter(s=>s.date===opened.inspectDate);
   rows.forEach(s=>{const b=document.createElement('button');b.type='button';b.textContent=[s.date,s.sn||'S/N 미기록',s.engineer,s.detail?.slice(0,70),s.recordId].filter(Boolean).join(' · ');b.onclick=()=>run(()=>select(s.recordId));list.appendChild(b);});
   status.textContent=rows.length?'처리 내용을 확인할 기록을 선택하세요.':'해당 처리일의 기록이 없습니다. 병원명·처리일 또는 기록 ID를 확인하세요.';
  });
  apply.onclick=()=>run(async()=>{
   if(!selected)throw new Error('연결할 원본을 먼저 조회하세요.');
   let requestId=request.value.trim();if(requestId){try{const u=new URL(requestId);requestId=u.searchParams.get('request')||'';}catch{}if(!flow.valid(requestId))throw new Error('접수 ID 또는 접수 주소를 확인하세요.');}
   const context={hospital:opened.hospital,date:opened.inspectDate,sn:opened.serialNo,recordId:selected.recordId,requestId};
   const linked=await ensureLink(context);guard();
   if(requestId&&linked.request?.id!==requestId)throw new Error('선택한 접수 연결을 확인하지 못했습니다.');
   const previous=handoverReference,previousPdf=uploadedPdfDocument;
   handoverReference={recordId:selected.recordId,requestId:linked.request?.id||'',identity:opened};
   if(previous?.recordId!==selected.recordId)uploadedPdfDocument=null;
   if(!saveCurrentTask()){handoverReference=previous;uploadedPdfDocument=previousPdf;throw new Error('기기에 연결 정보를 저장하지 못했습니다.');}
   history.replaceState(null,'',location.pathname);root.BazInspectionFlow.refresh(handoverReference,'Handover 원본 연결을 확인했습니다. '+(uploadedPdfDocument?'저장·댓글 연결 확인을 눌러 기존 PDF의 첨부를 재시도하세요.':'현재 내용으로 PDF를 생성하면 선택한 원본에 저장됩니다.'));
   dialog.close();showToast('Handover 기록 연결을 변경했습니다.');
  });
  dialog.addEventListener('close',()=>dialog.remove());document.body.appendChild(dialog);dialog.showModal();
 }
 root.BazInspectionRelink={open,ensureLink};
})(window);
