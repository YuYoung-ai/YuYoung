import {el} from './baz-survey-api.mjs?v=292';
import {directoryNames,matchingNames,runBatch,manifestCsv,PURPOSES,issuedAsHospital,issuedHospital} from './baz-survey-bulk-core.mjs?v=292';
import {printFont,stickerCanvas,stickerPdf,qrArchive,saveBlob,printStickers} from './baz-survey-bulk-export.mjs?v=294';

export function createBulkIssuer(root,{call,onStatus,onBusy=()=>{},purpose='survey',issue,mode='all',onIssued=()=>{},onManage=()=>{},onOperation}){
 const settings=PURPOSES[purpose];if(!settings)throw Error('QR 목적을 확인하세요.');
 root.innerHTML=`
 <div class="section-heading"><div><p class="eyebrow">HOSPITAL QR · ${mode==='library'?'MANAGE & PRINT':'CREATE'}</p><h2>${settings.title} ${mode==='library'?'QR 관리 · 인쇄':'QR 일괄 생성'}</h2><p class="help">${mode==='library'?'보관된 QR을 선택해 인쇄를 준비하세요. 인쇄해도 병원의 기존 QR 주소는 유지됩니다.':`병원을 선택해 전용 QR을 준비하세요. ${purpose==='as'?'같은 QR로 접수와 진행 상황을 확인합니다. QR 제작만으로 접수·예약이 시작되지는 않습니다.':'기존 주소는 그대로 유지되며 다음 조사에도 재사용할 수 있습니다.'}`}</p></div><span class="badge">스티커 32 × 25mm</span></div>
 <div class="bulk-summary"><div><span>${mode==='library'?'보관된 QR':'입점병원'}</span><strong data-bulk="total">0곳</strong></div><div><span>선택 병원</span><strong data-bulk="selected">0곳</strong></div><div><span>선택 중 생성 완료</span><strong data-bulk="ready">0곳</strong></div><div><span>선택 제작 수량</span><strong data-bulk="copies">0장</strong></div></div>
 <div class="bulk-layout"><div class="bulk-directory">
 <fieldset data-bulk="controls" class="bulk-fieldset"><legend class="bulk-sr">병원 선택 및 제작 수량</legend>
 <label class="field">병원 검색<input data-bulk="search" type="text" placeholder="병원명을 입력하세요" maxlength="100"></label>
 <div class="bulk-select-tools"><button class="secondary" type="button" data-bulk="select-all">전체 병원 선택</button><button class="secondary" type="button" data-bulk="select-matches">검색 결과 선택</button><button class="secondary" type="button" data-bulk="clear">선택 해제</button><label class="checkline"><input data-bulk="selected-only" type="checkbox">선택 병원만 보기</label></div>
 <div class="bulk-quantity"><label class="field">공통 제작 수량<input data-bulk="quantity" type="number" min="1" max="9999" step="1" value="2"></label><button class="secondary" type="button" data-bulk="apply-quantity">선택 병원에 적용</button></div>
 <p data-bulk="directory-status" class="help" role="status">입점병원 목록을 불러오고 있습니다.</p>
 <div class="bulk-table-wrap"><table class="bulk-table"><thead><tr><th><input data-bulk="page-all" type="checkbox" aria-label="현재 페이지 병원 전체 선택"></th><th scope="col">병원명</th><th scope="col">수량</th><th scope="col">QR 상태</th><th scope="col">확인</th>${purpose==='as'?'<th scope="col">운영 상태</th><th scope="col">URL</th><th scope="col">QR 이미지 저장</th>':''}</tr></thead><tbody data-bulk="rows"></tbody></table></div>
 <div class="bulk-pager"><span data-bulk="page-label" class="help"></span><div><button class="secondary" type="button" data-bulk="prev">이전</button><button class="secondary" type="button" data-bulk="next">다음</button></div></div>
 </fieldset>
 <div class="bulk-generate"><button data-bulk="generate" class="primary" type="button" disabled>선택 병원 QR 생성</button><button data-bulk="retry" class="secondary" type="button" disabled>실패 병원 재시도</button><button data-bulk="cancel" class="secondary" type="button" hidden>생성 중지</button></div>
 <div data-bulk="progress-area" class="bulk-progress" hidden><progress data-bulk="progress" max="1" value="0" aria-label="QR 생성 진행률"></progress><p data-bulk="progress-text" class="help" role="status"></p></div>
 </div><aside class="bulk-output">
 <h3>인쇄용 스티커 미리보기</h3><p class="help">32 × 25mm · 제목·안내 문구 → 중앙 QR → 병원명 → Curejet</p>
 <div class="bulk-preview"><img data-bulk="preview" alt="선택 병원의 스티커 미리보기" hidden><p data-bulk="preview-empty" class="help">QR 생성 후 병원의<br>미리보기를 눌러 주세요.</p></div>
 <p data-bulk="preview-name" class="bulk-preview-name"></p><a data-bulk="open" class="bulk-open" target="_blank" rel="noopener noreferrer" hidden>QR 연결 화면 확인 ↗</a><label class="field" data-bulk="print-name-field" hidden>인쇄 병원명<input data-bulk="print-name" type="text" maxlength="100"><span class="help">긴 병원명은 인쇄할 이름을 줄일 수 있습니다. QR 연결 정보는 유지됩니다.</span></label><p data-bulk="preview-error" class="error" role="status"></p>
 <div class="bulk-downloads"><button data-bulk="print" class="primary" type="button" disabled>선택 수량으로 인쇄</button><button data-bulk="pdf" class="primary" type="button" disabled>스티커 PDF 내려받기</button><button data-bulk="zip" class="secondary" type="button" disabled>QR 이미지 묶음 ZIP</button><button data-bulk="csv" class="secondary" type="button" disabled>제작 수량표 CSV</button><button data-bulk="select-ready" class="secondary" type="button" disabled>생성 완료 병원만 선택</button></div>
 <p data-bulk="download-help" class="help">선택한 병원의 QR 생성을 모두 마치면 파일을 저장할 수 있습니다.</p>
 <div class="notice"><strong>인쇄 · 배포 안내</strong><ul><li>PDF는 병원당 한 페이지입니다. 출력 매수는 수량표로 지정하세요.</li><li>원본 크기 100%로 출력하고, 인쇄 업체의 도련·재단 규격을 확인하세요.</li><li>${purpose==='as'?'운영 전 병원도 미리 제작할 수 있습니다. 접수 준비 중이면 병원 화면에 안내됩니다.':'접수 중인 조사가 없어도 미리 제작할 수 있습니다.'}</li>${purpose==='survey'?'<li>파일 생성은 전달 이력에 포함되지 않습니다. 실제 전달 후 기존 QR · 안내 문자 메뉴에서 기록하세요.</li>':'<li>예약 공개·접수 운영·엔지니어 배정은 직원 관리에서 별도로 설정합니다.</li>'}</ul></div>
 </aside></div>`;
 const $=id=>root.querySelector(`[data-bulk="${id}"]`),selected=new Set(),records=new Map(),quantities=new Map(),printNames=new Map(),directory=new Map();
 root.dataset.bulkMode=mode;
 if(mode==='create'){
  $('pdf').parentElement.hidden=true;$('print-name-field').hidden=true;
  const manage=el('button','primary bulk-manage-next','생성된 QR 관리 · 인쇄 준비 →');manage.type='button';manage.addEventListener('click',onManage);$('download-help').after(manage);
  $('download-help').textContent='생성한 QR은 서버에 보관됩니다. 생성된 QR 관리에서 병원을 선택해 인쇄 자료를 준비하세요.';
 }
 if(mode==='library'){$('generate').parentElement.hidden=true;$('retry').hidden=true;}
 let names=[],page=0,directoryReady=false,busy=false,running=false,cancelled=false,previewName='',previewVersion=0;
 const label=name=>directory.get(name)?.name||name;
 const eligible=name=>directory.get(name)?.eligible!==false;
 const matching=()=>{const query=$('search').value.normalize('NFKC').trim().toLocaleLowerCase();return names.filter(n=>(!query||[label(n),directory.get(n)?.sn,directory.get(n)?.region].join(' ').normalize('NFKC').toLocaleLowerCase().includes(query)));};
 const PAGE_SIZE=50,quantity=name=>quantities.get(name)||2;
 const chosen=()=>names.filter(n=>selected.has(n));
 const ready=()=>chosen().filter(n=>records.get(n)?.ok);
 const visible=()=>matching().filter(n=>!$('selected-only').checked||selected.has(n));
 const snapshot=()=>chosen().map(name=>({...records.get(name).hospital,printName:printNames.get(name)||records.get(name).hospital.name,quantity:quantity(name)}));
 function count(){
  const all=chosen(),done=ready(),failed=all.filter(n=>records.get(n)?.ok===false),total=all.reduce((sum,n)=>sum+quantity(n),0);
  $('total').textContent=names.length+'곳';$('selected').textContent=all.length+'곳';$('ready').textContent=done.length+'곳';$('copies').textContent=total.toLocaleString('ko-KR')+'장';
  $('controls').disabled=busy;$('generate').disabled=busy||!directoryReady||!all.length;$('retry').disabled=busy||!directoryReady||!failed.length;$('cancel').hidden=!running;$('cancel').disabled=cancelled;
  for(const id of ['print','pdf','zip','csv'])$(id).disabled=busy||!directoryReady||!all.length||done.length!==all.length;
  $('print-name').disabled=busy;$('select-ready').disabled=busy||!directoryReady||!names.some(n=>records.get(n)?.ok);
  $('download-help').textContent=mode==='create'?'생성한 QR은 서버에 보관됩니다. 생성된 QR 관리에서 병원을 선택해 인쇄 자료를 준비하세요.':all.length&&done.length===all.length?`${all.length}곳 · ${total.toLocaleString('ko-KR')}장 제작 자료를 저장합니다. PDF는 ${all.length}페이지입니다.`:all.length?`선택 ${all.length}곳 중 완료 ${done.length}곳 · 실패 ${failed.length}곳. 모두 생성하거나 생성 완료 병원만 선택하세요.`:mode==='library'?'인쇄할 병원을 선택하세요. 기존 QR을 그대로 사용합니다.':'병원을 선택하고 QR을 생성해 주세요.';
 }
 function render(){
  const list=visible(),pages=Math.max(1,Math.ceil(list.length/PAGE_SIZE));page=Math.min(page,pages-1);const shown=list.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
  $('rows').replaceChildren();
  for(const name of shown){
   const tr=el('tr'),td=el('td'),check=el('input');check.type='checkbox';check.disabled=!eligible(name);check.checked=selected.has(name);check.setAttribute('aria-label',label(name)+' 선택');check.addEventListener('change',()=>{if(check.checked)selected.add(name);else selected.delete(name);render();});td.append(check);tr.append(td);
   tr.append(el('td','bulk-hospital',label(name)));const detail=directory.get(name);if(detail){const info=el('small','bulk-hospital-meta',[detail.region,detail.sn,detail.id].filter(Boolean).join(' · '));tr.lastChild.append(info);if(!eligible(name))tr.lastChild.append(el('small','bulk-row-error',detail.reason||'병원 연결 확인 필요'));}const qtyTd=el('td'),qty=el('input');qty.type='number';qty.min='1';qty.max='9999';qty.step='1';qty.value=quantity(name);qty.setAttribute('aria-label',label(name)+' 제작 수량');qty.addEventListener('change',()=>{const v=Number(qty.value);if(!Number.isInteger(v)||v<1||v>9999){qty.value=quantity(name);onStatus('제작 수량은 1~9999 사이의 정수로 입력해 주세요.',true);return;}quantities.set(name,v);count();});qtyTd.append(qty);tr.append(qtyTd);
   const r=records.get(name),state=el('td'),badge=el('span','bulk-state '+(r?.ok?'complete':r?.ok===false?'failed':''),r?.ok?'생성 완료':r?.ok===false?'확인 필요':r?.pending?'대기 중':'준비 전');state.append(badge);if(detail?.issuedAt){const at=new Date(detail.issuedAt);if(Number.isFinite(at.getTime()))state.append(el('small','bulk-hospital-meta','생성 '+new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(at)));}if(r?.error){const error=el('small','bulk-row-error',r.error);state.append(error);}tr.append(state);
   const action=el('td'),preview=el('button','secondary','미리보기');preview.type='button';preview.disabled=!r?.ok;preview.setAttribute('aria-label',label(name)+' 스티커 미리보기');preview.addEventListener('click',()=>showPreview(name));action.append(preview);tr.append(action);
   if(purpose==='as'){
    const operating=el('td'),select=el('select');select.setAttribute('aria-label',label(name)+' 운영 상태');
    for(const [value,text] of [['preparing','준비 중'],['open','운영 중'],['paused','접수 중지']]){const option=el('option','',text);option.value=value;select.append(option);}
    select.value=detail?.operationState||(detail?.intakeConfigured?'open':'preparing');select.disabled=!r?.ok||!onOperation;
    select.addEventListener('change',async()=>{const old=detail.operationState|| (detail.intakeConfigured?'open':'preparing');select.disabled=true;try{await onOperation(name,select.value);detail.operationState=select.value;onStatus(label(name)+' 운영 상태를 저장했습니다.');}catch(e){select.value=old;onStatus(e.message,true);}finally{select.disabled=false;}});operating.append(select);tr.append(operating);
    const urlCell=el('td');if(r?.ok){const link=el('a','bulk-open','접수 URL');link.href=r.hospital.qrUrl;link.target='_blank';link.rel='noopener noreferrer';urlCell.append(link);const copy=el('button','secondary','복사');copy.type='button';copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(r.hospital.qrUrl);onStatus('접수 URL을 복사했습니다.');}catch{onStatus('주소를 복사하지 못했습니다. 접수 URL을 열어 복사하세요.',true);}});urlCell.append(copy);}tr.append(urlCell);
    const imageCell=el('td'),save=el('button','secondary','QR 이미지 저장');save.type='button';save.disabled=!r?.ok;save.addEventListener('click',async()=>{save.disabled=true;try{const canvas=document.createElement('canvas');await window.BazQrEncoder.toCanvas(canvas,r.hospital.qrUrl,{width:600,margin:4,errorCorrectionLevel:'M',color:{dark:'#000000',light:'#ffffff'}});const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('QR 이미지를 만들지 못했습니다.');saveBlob(blob,label(name).replace(/[\\/:*?"<>|]/g,'_')+'-AS접수-QR.png');}catch(e){onStatus(e.message,true);}finally{save.disabled=false;}});imageCell.append(save);tr.append(imageCell);
   }
   $('rows').append(tr);
  }
  if(!shown.length){const tr=el('tr'),td=el('td','empty',directoryReady?(names.length?'검색 결과가 없습니다.':'등록된 입점병원 목록이 없습니다.'):'병원 목록을 확인하고 있습니다.');td.colSpan=purpose==='as'?8:5;tr.append(td);$('rows').append(tr);}
  const selectable=shown.filter(eligible),checked=selectable.filter(n=>selected.has(n)).length;$('page-all').checked=!!selectable.length&&checked===selectable.length;$('page-all').indeterminate=checked>0&&checked<selectable.length;$('page-all').disabled=!selectable.length;
  $('prev').disabled=page===0;$('next').disabled=page>=pages-1;$('page-label').textContent=`검색 ${list.length}곳 · ${page+1} / ${pages}페이지 · 선택은 검색·페이지를 바꿔도 유지됩니다.`;count();
 }
 async function showPreview(name){
  previewName=name;$('preview-name').textContent=label(name);$('open').href=records.get(name).hospital.qrUrl||records.get(name).hospital.surveyUrl;$('open').hidden=false;$('print-name-field').hidden=false;$('print-name').value=printNames.get(name)||records.get(name).hospital.name;
  if(mode==='create')$('print-name-field').hidden=true;await drawPreview();
 }
 async function drawPreview(){
  const version=++previewVersion,r=records.get(previewName);$('preview-error').textContent='';$('preview').hidden=true;$('preview-empty').hidden=false;
  if(!r?.ok)return;
  try{await printFont();if(version!==previewVersion)return;const c=stickerCanvas({...r.hospital,printName:printNames.get(previewName)||r.hospital.name});$('preview').src=c.toDataURL('image/png');$('preview').alt=label(previewName)+' '+settings.title+' 전용 스티커, 32 × 25mm, 하단 Curejet';$('preview').hidden=false;$('preview-empty').hidden=true;}
  catch(e){if(version===previewVersion)$('preview-error').textContent=e.message;}
 }
 function lock(value){busy=value;onBusy(value);count();}
 async function generate(retry=false){
  if(busy||!directoryReady||mode==='library')return;const target=chosen().filter(n=>(!retry||records.get(n)?.ok===false)&&(mode!=='create'||!records.get(n)?.ok));if(!target.length){onStatus('이미 생성된 QR입니다. 생성된 QR 관리에서 인쇄 자료를 준비하세요.');return;}
  cancelled=false;running=true;for(const n of target)records.set(n,{pending:true});lock(true);render();if(target.includes(previewName)){previewVersion++;$('preview').hidden=true;$('preview-empty').hidden=false;}
  $('progress-area').hidden=false;$('progress').max=target.length;$('progress').value=0;$('progress-text').textContent=`0 / ${target.length}곳 생성 중…`;
  try{
   const batch=await runBatch(target,{issue:issue|| (async name=>(await call('hospital-save',{name})).hospital),...(purpose==='as'?{validate:(hospital,id)=>issuedAsHospital(hospital,directory.get(id))}:{}),onResult:(name,r)=>{if(r.ok)r.hospital={...r.hospital,purpose};records.set(name,r);},onProgress:(n,total)=>{$('progress').value=n;$('progress-text').textContent=`${n} / ${total}곳 처리 · 완료 ${target.filter(x=>records.get(x)?.ok).length}곳`;render();},shouldStop:()=>cancelled});
   const done=target.filter(n=>records.get(n)?.ok).length,failed=target.filter(n=>records.get(n)?.ok===false).length;
   const message=`${batch.stopped?'생성이 중지되었습니다. ':''}${target.length}곳 중 완료 ${done}곳 · 실패 ${failed}곳 · 미처리 ${target.length-batch.completed}곳`;
   $('progress-text').textContent=message;onStatus(batch.authError?message+'\n로그인 상태와 관리자 권한을 확인해 주세요.':message,!!failed||!!batch.authError);
   if(!records.get(previewName)?.ok)previewName=target.find(n=>records.get(n)?.ok)||'';
   onIssued();if(previewName)await showPreview(previewName);
  }catch(e){onStatus(e.message,true);}finally{for(const n of target)if(records.get(n)?.pending)records.delete(n);running=false;lock(false);render();}
 }
 async function download(type){
  if(busy||!directoryReady||!chosen().length||ready().length!==chosen().length)return;
  const items=snapshot(),date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());lock(true);
  try{
   const progress=(n,total)=>onStatus(`${type==='pdf'?'스티커 PDF':'QR 묶음'} 준비 중 ${n} / ${total}곳…`);
   if(type==='print'){await printStickers(items,progress);onStatus('선택한 병원의 제작 수량대로 인쇄 창을 열었습니다.');return;}
   let blob,file;if(type==='pdf'){blob=await stickerPdf(items,progress);file=`${settings.prefix}_스티커_32x25mm_${date}.pdf`;}else if(type==='zip'){blob=await qrArchive(items,progress);file=`${settings.prefix}_QR_${date}.zip`;}else{blob=new Blob([manifestCsv(items)],{type:'text/csv;charset=utf-8'});file=`${settings.prefix}_제작수량표_${date}.csv`;}
   saveBlob(blob,file);onStatus(`${items.length}곳의 ${type==='pdf'?'32 × 25mm 스티커 PDF':type==='zip'?'QR 이미지 묶음':'제작 수량표'}를 저장했습니다.${type==='pdf'?' 제작 수량표도 함께 전달해 주세요.':''}`);
  }catch(e){onStatus(e.message,true);}finally{lock(false);}
 }
 let searchTimer;$('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{page=0;render();},120);});$('selected-only').addEventListener('change',()=>{page=0;render();});
 $('select-all').addEventListener('click',()=>{names.filter(eligible).forEach(n=>selected.add(n));render();});
 $('select-matches').addEventListener('click',()=>{matching().filter(eligible).forEach(n=>selected.add(n));render();});
 $('clear').addEventListener('click',()=>{selected.clear();render();});
 $('select-ready').addEventListener('click',()=>{selected.clear();names.filter(n=>records.get(n)?.ok).forEach(n=>selected.add(n));render();});
 $('page-all').addEventListener('change',()=>{const checked=$('page-all').checked;visible().slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).filter(eligible).forEach(n=>checked?selected.add(n):selected.delete(n));render();});
 $('prev').addEventListener('click',()=>{page--;render();});$('next').addEventListener('click',()=>{page++;render();});
 $('apply-quantity').addEventListener('click',()=>{const v=Number($('quantity').value);if(!Number.isInteger(v)||v<1||v>9999){onStatus('제작 수량은 1~9999 사이의 정수로 입력해 주세요.',true);return;}chosen().forEach(n=>quantities.set(n,v));render();});
 $('print-name').addEventListener('input',()=>{if(previewName){printNames.set(previewName,$('print-name').value.trim()||records.get(previewName).hospital.name);drawPreview();}});
 $('generate').addEventListener('click',()=>generate());$('retry').addEventListener('click',()=>generate(true));$('cancel').addEventListener('click',()=>{cancelled=true;$('cancel').disabled=true;$('progress-text').textContent='진행 중인 요청을 마친 뒤 중지합니다…';});
 for(const id of ['print','pdf','zip','csv'])$(id).addEventListener('click',()=>download(id));
 render();
 return {
  setLoading(){directoryReady=false;$('directory-status').textContent='입점병원 목록을 불러오고 있습니다.';count();},
  setHospitals(values){for(const h of values||[]){if(records.has(h.id)&&records.get(h.id).hospital?.name!==h.name){records.delete(h.id);printNames.delete(h.id);}}directory.clear();for(const h of values||[])if(h?.id&&h?.name)directory.set(h.id,h);this.setNames([...directory.keys()]);},
  setNames(values){names=purpose==='as'?values.filter(n=>directory.has(n)).sort((a,b)=>label(a).localeCompare(label(b),'ko')):directoryNames(values);const allowed=new Set(names);for(const n of selected)if(!allowed.has(n)||!eligible(n))selected.delete(n);for(const n of records.keys())if(!allowed.has(n)||!eligible(n))records.delete(n);directoryReady=true;$('directory-status').textContent=`입점병원 ${names.length}곳 · 검색 결과 선택은 모든 검색 페이지에 적용됩니다.`;if(!allowed.has(previewName)||!records.get(previewName)?.ok){previewName='';previewVersion++;$('preview').hidden=true;$('preview-empty').hidden=false;$('print-name-field').hidden=true;$('preview-name').textContent='';$('open').hidden=true;}render();},
  setIssued(values){
   if(mode==='library'){records.clear();directory.clear();for(const h of values||[])directory.set(purpose==='as'?h.id:h.name,{...h,eligible:h.active!==false&&h.eligible!==false});this.setNames([...directory.keys()]);}
   for(const h of values||[]){const id=purpose==='as'?h.id:h.name;if(!names.includes(id))continue;const entry=directory.get(id);if(entry)directory.set(id,{...entry,issuedAt:h.issuedAt,operationState:h.operationState,intakeConfigured:h.intakeConfigured});
    try{if(h.active===false||h.eligible===false)throw Error(h.reason||'중지된 병원 링크입니다.');const hospital=purpose==='as'?issuedAsHospital(h,directory.get(id)):{...issuedHospital(h,id),purpose};records.set(id,{ok:true,hospital});}catch(e){records.set(id,{ok:false,error:e.message});}
   }render();
  },
  setError(message){directoryReady=false;$('directory-status').textContent=message;count();}
 };
}
