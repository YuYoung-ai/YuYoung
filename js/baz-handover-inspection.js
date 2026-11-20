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
 const deviceSlots=[0,1,2];
 const sharedFields=['hospital','receiveDate','receiver','inspectDate','csName'];
 const requestKey=(owner,requestId)=>'baz_handover_inspection_v1:'+owner+':'+requestId;
 function hasPending(storage,owner,requestId){
  if(!owner)return false;
  try{return storage.getItem(requestKey(owner,requestId)+':pending-devices')==='yes';}catch{return false;}
 }
 function mountDevices(options){
  const panel=document.createElement('section'),heading=document.createElement('h2');
  const devices=document.createElement('div'),controls=document.createElement('div'),status=document.createElement('p');
  const add=document.createElement('button'),remove=document.createElement('button'),pdf=document.createElement('a');
  panel.id='combinedDevices';panel.className='work-flow-panel';heading.textContent='점검 장비';
  devices.className='combined-device-tabs';devices.setAttribute('role','group');devices.setAttribute('aria-label','장비 선택');
  controls.className='combined-device-actions';
  add.type=remove.type='button';add.textContent='+ 장비 추가';remove.textContent='작성 대상에서 빼기';
  add.onclick=options.add;remove.onclick=options.remove;
  pdf.textContent='선택 장비 PDF 보기';pdf.target='_blank';pdf.rel='noopener noreferrer';
  status.setAttribute('role','status');status.hidden=true;
  controls.append(add,remove,pdf);panel.append(heading,devices,controls,status);
  document.querySelector('.combined-form-columns').before(panel);
  return {
   render(slots,active,busy){
    devices.replaceChildren(...slots.map(slot=>{
     const tab=document.createElement('button');
     tab.type='button';tab.dataset.deviceSlot=slot.index;tab.setAttribute('aria-pressed',String(slot.index===active));
     tab.textContent=['장비 '+(slot.index+1),slot.sn,slot.complete?'발행 완료':''].filter(Boolean).join(' · ');
     tab.disabled=busy;tab.onclick=()=>options.select(slot.index);return tab;
    }));
    const selected=slots.find(slot=>slot.index===active);
    add.disabled=busy;add.hidden=slots.length>=deviceSlots.length;
    remove.disabled=busy;remove.hidden=!selected?.removable;
    pdf.hidden=!selected?.pdfUrl;
    if(selected?.pdfUrl)pdf.href=selected.pdfUrl;else pdf.removeAttribute('href');
   },
   status(message){status.textContent=message;status.hidden=!message;}
  };
 }
 function mountLayout(){
  document.body.classList.add('combined-inspection');
  const stylesheet=document.createElement('link');
  stylesheet.rel='stylesheet';stylesheet.href='css/baz-handover-inspection.css?v=358';
  document.head.append(stylesheet);
  const theme=document.querySelector('.baz-theme-floating[data-baz-theme-toggle]');
  if(theme){
   theme.classList.remove('baz-theme-floating');
   document.querySelector('.save-bar').append(theme);
  }

  const reception=document.getElementById('receptionCard'),action=document.getElementById('actionCard');
  const front=document.createElement('div');
  front.className='combined-form-columns';
  reception.before(front);
  front.append(reception,action);
  reception.querySelector('h2').textContent='접수·장비 정보';
  action.querySelector('h2').textContent='조치·처리 정보';
  reception.querySelector('.card-body').prepend(document.getElementById('hospFieldGroup').closest('.row-2'));

  const oldProduct=document.getElementById('product'),productGroup=document.getElementById('productSel');
  const product=document.createElement('select');
  product.id=oldProduct.id;
  productGroup.previousElementSibling.htmlFor=product.id;
  product.add(new Option('제품 선택',''));
  for(const choice of productGroup.querySelectorAll('[data-product]')){
   product.add(new Option(choice.dataset.product,choice.dataset.product));
  }
  product.value=oldProduct.value;
  oldProduct.remove();
  productGroup.replaceWith(product);

  const name=document.getElementById('csName'),nameLabel=name.previousElementSibling;
  const signatureLabel=document.createElement('span');
  signatureLabel.className='combined-signature-label';
  signatureLabel.textContent='CS 담당자 서명';
  name.before(signatureLabel);
  nameLabel.htmlFor=name.id;
  name.style.removeProperty('margin-bottom');
  const nameField=document.createElement('div'),row=document.createElement('div');
  nameField.className='field-group';row.className='row-2';
  nameField.append(nameLabel,name);
  row.append(document.getElementById('inspectDate').closest('.field-group'),nameField);
  document.getElementById('recentCard').before(row);
  document.getElementById('nextDate').closest('.row-2').remove();

  const photo=document.getElementById('photoCard'),format=document.getElementById('pdfFormatCard'),sign=document.getElementById('signCard');
  format.querySelector('option[value="simplified"]').textContent='간소화 양식 — 담당자·서명 제외';
  const hospitalName=document.getElementById('hospitalName');
  const hospitalNameLabel=hospitalName.previousElementSibling;
  hospitalNameLabel.htmlFor=hospitalName.id;
  hospitalName.style.removeProperty('margin-bottom');
  const hospitalSignatureLabel=signatureLabel.cloneNode(false);
  hospitalSignatureLabel.textContent='병원 담당자 서명';
  hospitalName.before(hospitalSignatureLabel);
  const hospitalNameField=document.createElement('div'),signatureRow=sign.querySelector('.row-2');
  hospitalNameField.className='field-group';
  hospitalNameField.append(hospitalNameLabel,hospitalName);
  signatureRow.classList.add('combined-signature-grid');
  signatureRow.before(hospitalNameField);

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
  const key=requestKey(owner,requestId);
  const groupKey=key+':devices',primaryTask='handover-'+requestId;
  const taskIdFor=slot=>slot===0?primaryTask:primaryTask+'-device-'+(slot+1);
  const entryKey=taskId=>taskId===primaryTask?key:key+':'+taskId;
  const entry=taskId=>JSON.parse(storage.getItem(entryKey(taskId))||'null');
  let request,records=[];

  function slots(){
   const stored=JSON.parse(storage.getItem(groupKey)||'null');
   return [0,...deviceSlots.slice(1).filter(slot=>stored?.includes(slot)||entry(taskIdFor(slot)))];
  }

  function setSlots(selected){
   checkAccount();
   storage.setItem(groupKey,JSON.stringify(selected));
  }

  function markPending(pending){
   const marker=key+':pending-devices';
   try{
    checkAccount();
    if(pending&&!storage.getItem(marker))storage.setItem(marker,'yes');
    else if(!pending&&storage.getItem(marker))storage.removeItem(marker);
   }catch{}
  }

  async function readRequest(){
   checkAccount();
   const result=await api.get('work_document_status',{requestId});
   checkAccount();
   if(!result.success||result.request?.id!==requestId||result.request.deletedAt||result.request.status==='취소')
    throw new Error(result.error||'접수 정보를 확인하지 못했습니다.');
   records=result.records||[];
   if(!slots().some(slot=>entry(taskIdFor(slot)))&&records.length)
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

  function toHandover(draft,fields,previous,taskId){
   const b=draft.basic;
   const sn=flow.serials(b.serialNo),assigned=flow.serials(request.sn);
   if(!flow.sameInspectionIdentity({hospital:b.hospital},{hospital:request.hospitalName}))
    throw new Error('접수의 병원명을 확인하세요.');
   if(sn.length!==1)
    throw new Error('장비 S/N을 한 개만 입력하세요.');
   if(taskId===primaryTask&&assigned.length&&!assigned.includes(sn[0]))
    throw new Error('장비 1에는 접수에 등록된 S/N을 입력하세요.');
   if(records.some(record=>record.recordId!==previous?.id&&record.date===b.inspectDate&&flow.serials(record.sn).includes(sn[0])))
    throw new Error('이 접수에 같은 처리일과 S/N의 현장 기록이 있습니다. 기존 내역서를 확인하세요.');
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

  function validateDraft(draft,fields,taskId){
   checkAccount();
   if(!request)throw new Error('접수를 다시 불러와 주세요.');
   if(!draft.types.includes('A/S')&&!draft.types.includes('장비 점검'))
    throw new Error('A/S 또는 장비 점검을 선택해 주세요.');
   const previous=entry(taskId),form=toHandover(draft,fields,previous,taskId);
   if(previous){
    const payload=handover.buildPayload(form,{reqId:previous.id});
    delete payload.token;
    if(JSON.stringify(previous.payload)!==JSON.stringify(payload))
     throw new Error('시트 전송 당시와 입력이 다릅니다. 전송한 내용을 복원하거나 기존 접수에서 원본을 확인하세요.');
   }
   return {previous,form};
  }

  async function prepare(draft,fields,taskId){
   const {previous,form}=validateDraft(draft,fields,taskId);
   const journal=entryKey(taskId);
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key+'|'+taskId));
   const id=Array.from(new Uint8Array(digest).slice(0,16),byte=>byte.toString(16).padStart(2,'0')).join('');
   const payload=handover.buildPayload(form,{reqId:id});
   delete payload.token;
   if(previous?.id!==undefined&&previous.id!==id)throw new Error('이 접수의 통합 초안을 다시 열어 주세요.');
   let entry=previous||{id,payload,state:'pending'};
   const finishSheet=measure('pdf_delivery_sheet');
   let receipt;
   try{
    if(entry.state==='pending'){
     storage.setItem(journal,JSON.stringify(entry));
     if(previous){
      const status=new URL(url);
      status.search=new URLSearchParams({action:'savecheck',reqId:id});
      const checked=await transport(auth.withToken(status.href));
      if(!checked.success||checked.reqId!==id)throw new Error('시트의 기존 저장 상태를 확인하지 못했습니다.');
      if(checked.found)receipt=accept(checked.result,id);
      else if(draft.handover?.recordId===id)receipt=draft.handover.deliveryReceipt;
      else entry=await submit(payload,id,journal);
     }else entry=await submit(payload,id,journal);
     receipt=receipt||entry.receipt;
     entry={...entry,id,payload,state:'confirmed'};
     storage.setItem(journal,JSON.stringify(entry));
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

  async function submit(payload,id,journal){
   checkAccount();
   const result=await transport(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
    body:JSON.stringify({...payload,token:auth.token()})});
   checkAccount();
   if(result?.success===false){
    storage.removeItem(journal);
   }
   return {receipt:accept(result,id)};
  }
  async function pdfStatus(context){
   const result=await api.get('work_document_status',{requestId,recordId:context.recordId});
   checkAccount();
   if(!result.success||result.request?.id!==requestId||result.source?.recordId!==context.recordId||
      !flow.sameInspectionIdentity(context,result.source))
    throw new Error('이 장비의 기존 PDF 저장 결과를 확인하지 못했습니다.');
   return result;
  }

  function rememberPdf(recordId,taskId,uploadId){
   const saved=entry(taskId);
   if(saved?.id!==recordId||saved.state!=='confirmed')throw new Error('시트 저장 결과를 다시 확인해 주세요.');
   const savedId=saved.uploadId||uploadId;
   storage.setItem(entryKey(taskId),JSON.stringify({...saved,pdfStarted:true,...(savedId?{uploadId:savedId}:{})}));
   return savedId;
  }
  return {readRequest,prepare,validateDraft,taskIdFor,slots,setSlots,entry,pdfStatus,rememberPdf,markPending};
 }
 root.BazHandoverInspection={create,mountFields,mountLayout,mountDevices,deviceSlots,sharedFields,hasPending};
})(window);
