(function(root){
 'use strict';
 const fields=[
  ['result','처리 결과 직접 지정 (선택)'],
  ['hpOut','HP 회수품 S/N'],
  ['wVer','HP 회수품 버전'],
  ['hpIn','HP 교체품 S/N'],
  ['uVer','HP 교체품 버전'],
  ['nozzleDate','노즐 제조일자']
 ];
 function mountLayout(){
  document.body.classList.add('combined-inspection');
  const stylesheet=document.createElement('link');
  stylesheet.rel='stylesheet';stylesheet.href='css/baz-handover-inspection.css?v=353';
  document.head.append(stylesheet);

  const reception=document.getElementById('receptionCard'),action=document.getElementById('actionCard');
  const front=document.createElement('div');
  front.className='combined-form-columns';
  reception.before(front);
  front.append(reception,action);
  reception.querySelector('h2').textContent='접수·장비 정보';
  action.querySelector('h2').textContent='조치·처리 정보';
  reception.querySelector('.card-body').prepend(document.getElementById('hospFieldGroup').closest('.row-2'));

  const name=document.getElementById('csName'),nameLabel=name.previousElementSibling;
  const signatureLabel=document.createElement('label');
  signatureLabel.textContent='CS 담당자 서명';
  name.before(signatureLabel);
  nameLabel.htmlFor=name.id;
  const nameField=document.createElement('div'),row=document.createElement('div');
  nameField.className='field-group';row.className='row-2';
  nameField.append(nameLabel,name);
  row.append(document.getElementById('inspectDate').closest('.field-group'),nameField);
  document.getElementById('recentCard').before(row);

  const photo=document.getElementById('photoCard'),format=document.getElementById('pdfFormatCard'),sign=document.getElementById('signCard');
  const closing=document.createElement('div'),publishing=document.createElement('div');
  closing.className='combined-form-columns';
  photo.before(closing);
  closing.append(photo,publishing);
  publishing.append(format,sign);
 }
 function mountFields(after,saved){
  const panel=document.createElement('details'),heading=document.createElement('summary');
  heading.textContent='Handover 추가 정보';
  const grid=document.createElement('div');
  grid.className='combined-extra-fields';
  panel.append(heading,grid);
  for(const [name,label] of fields){
   const row=document.createElement('label'),input=document.createElement('input');
   row.className='field-group';
   row.textContent=label;
   input.dataset.handoverField=name;
   input.id='combined-'+name;
   input.type='text';
   input.maxLength=100;
   input.value=saved?.[name]||'';
   row.append(input);
   grid.append(row);
  }
  if(Object.values(saved||{}).some(Boolean))panel.open=true;
  after.after(panel);
 }
 function create(options){
  const {requestId,storage,owner,checkAccount,auth,api,flow,session,handover,url,source,link,measure}=options;
  const key='baz_handover_inspection_v1:'+owner+':'+requestId;
  let request;

  async function readRequest(){
   checkAccount();
   const result=await api.get('work_document_status',{requestId});
   checkAccount();
   if(!result.success||result.request?.id!==requestId||result.request.deletedAt)
    throw new Error(result.error||'접수 정보를 확인하지 못했습니다.');
   const existing=JSON.parse(storage.getItem(key)||'null');
   if(!existing&&result.records?.length)
    throw new Error('이 접수에 저장된 현장 기록이 있습니다. 접수 관리에서 기존 내역서를 이어서 작성하세요.');
   request=result.request;
   return request;
  }

  async function transport(url,options){
   const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),20000);
   try{
    const response=await fetch(url,{...options,cache:'no-store',signal:ctl.signal});
    if(!response.ok)throw new Error('시트 응답을 확인하지 못했습니다.');
    return await response.json();
   }finally{clearTimeout(timer);}
  }

  function toHandover(draft,fields,previous){
   const b=draft.basic;
   const sn=flow.serials(b.serialNo),assigned=flow.serials(request.sn);
   if(!flow.sameInspectionIdentity({hospital:b.hospital},{hospital:request.hospitalName}))
    throw new Error('접수의 병원명을 확인하세요.');
   if(sn.length!==1||assigned.length&&!assigned.includes(sn[0]))
    throw new Error('이 접수에서 처리한 장비 S/N 한 개를 입력하세요.');
   if(!b.inspectDate||!b.actionDetail.trim())throw new Error('처리일과 실제 조치 내용을 입력하세요.');
   const cost=handover.parseCost(b.cost);
   if(!cost.ok||(draft.pay==='유상')!==(cost.value>0))throw new Error('유상·무상과 비용을 확인하세요.');
   const [verUI,verHP]=String(b.version||'').split(/\s*\/\s*/,2);
   const selected=Object.values(draft.results||{});
   const result=b.handoverFields?.result||(previous?previous.payload.result:
    ['교체','수리','정상'].find(value=>selected.includes(value))||'');
   const form={...b.handoverFields,date:b.inspectDate,hosp:request.hospitalName,fse:b.csName||request.engineer||auth.name(),
    gubun:draft.types.includes('A/S')?'A/S':'점검',sn:sn[0],verUI,verHP,cat:b.asCat,
    subLabel:fields.item,code:fields.code,part:b.replacedPart,cost:b.cost,result,
    detail:b.actionDetail,remark:b.recommend};
   const valid=handover.validate(form);
   if(!valid.ok)throw new Error(valid.first.msg);
   return form;
  }

  async function prepare(draft,fields,taskId){
   checkAccount();
   if(!request)throw new Error('접수를 다시 불러와 주세요.');
   if(!draft.types.includes('A/S')&&!draft.types.includes('장비 점검'))
    throw new Error('A/S 또는 장비 점검을 선택해 주세요.');
   const previous=JSON.parse(storage.getItem(key)||'null');
   const form=toHandover(draft,fields,previous);
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key+'|'+taskId));
   const id=Array.from(new Uint8Array(digest).slice(0,16),byte=>byte.toString(16).padStart(2,'0')).join('');
   const payload=handover.buildPayload(form,{reqId:id});
   delete payload.token;
   if(previous?.id!==undefined&&previous.id!==id)throw new Error('이 접수의 통합 초안을 다시 열어 주세요.');
   let entry=previous||{id,payload,state:'pending'};
   if(JSON.stringify(entry.payload)!==JSON.stringify(payload))
    throw new Error('시트 전송 당시와 입력이 다릅니다. 전송한 내용을 복원하거나 기존 접수에서 원본을 확인하세요.');
   const finishSheet=measure('pdf_delivery_sheet');
   let receipt;
   try{
    if(entry.state==='pending'){
     storage.setItem(key,JSON.stringify(entry));
     if(previous){
      const status=new URL(url);
      status.search=new URLSearchParams({action:'savecheck',reqId:id});
      const checked=await transport(auth.withToken(status.href));
      if(!checked.success||checked.reqId!==id)throw new Error('시트의 기존 저장 상태를 확인하지 못했습니다.');
      if(checked.found)receipt=accept(checked.result,id);
      else if(draft.handover?.recordId===id)receipt=draft.handover.deliveryReceipt;
      else entry=await submit(payload,id);
     }else entry=await submit(payload,id);
     receipt=receipt||entry.receipt;
     entry={...entry,id,payload,state:'confirmed'};
     storage.setItem(key,JSON.stringify(entry));
    }
    const identity={hospital:form.hosp,date:form.date,sn:form.sn};
    receipt=receipt||await source({recordId:id,...identity});
    checkAccount();
    const previousReceipt=draft.handover?.deliveryReceipt;
    if(previousReceipt?.basis?.standard?.fingerprint!==undefined&&
       previousReceipt.basis.standard.fingerprint!==receipt?.basis?.standard?.fingerprint)
     throw new Error('시트의 원본 내용이 변경되었습니다. 서명과 변경 내용을 기존 내역서에서 확인하세요.');
    const reference=session.sourceReference({requestId,recordId:id,identity},receipt,draft.basic,flow);
    return {reference,linking:Promise.resolve().then(()=>link({requestId,recordId:id,...identity}))};
   }finally{finishSheet();}
  }

  function accept(data,id){
   const result=handover.classifySaveResult('json',data);
   if(result.state!==handover.SAVE.SUCCESS||data.recordId&&data.recordId!==id)
    throw new Error(result.error||'시트 기록 ID를 확인할 수 없습니다.');
   if(result.warnings.length)options.warn(result.warnings.join(' · '));
   return result.inspectionReceipt;
  }

  async function submit(payload,id){
   checkAccount();
   const result=await transport(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify({...payload,token:auth.token()})});
   checkAccount();
   if(result?.success===false){
    storage.removeItem(key);
   }
   return {receipt:accept(result,id)};
  }
  function pdfStarted(){return !!JSON.parse(storage.getItem(key)||'null')?.pdfStarted;}
  function rememberPdf(recordId){
   const entry=JSON.parse(storage.getItem(key)||'null');
   if(entry?.id!==recordId||entry.state!=='confirmed')throw new Error('시트 저장 결과를 다시 확인해 주세요.');
   storage.setItem(key,JSON.stringify({...entry,pdfStarted:true}));
  }
  return {readRequest,prepare,pdfStarted,rememberPdf};
 }
 root.BazHandoverInspection={create,mountFields,mountLayout};
})(window);
