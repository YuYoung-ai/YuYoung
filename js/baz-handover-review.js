(function(root){
'use strict';
const labels={hospitalName:'병원명',date:'처리일',sn:'장비 S/N',engineer:'실제 처리자',gubun:'구분',cat:'대분류',type:'유형',part:'교체품',cost:'교체비용',detail:'처리 내용',result:'처리 결과',remark:'특이사항',nozzleReuse:'노즐 재사용',nsFill:'NS 충진 여부',nsAmt:'NS 충진량',jet:'젯 분사 판단'};
const api=root.BazWorkAPI,auth=root.BazAuth,$=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let config=null,current=null,sequence=0,busy=false;
function account(){return auth.name();}function storage(id){return 'baz_review_v2_'+encodeURIComponent(account())+'_'+id;}
function readLocal(id){try{return JSON.parse(localStorage.getItem(storage(id))||'null');}catch{return null;}}
function persist(){if(!current)return;try{localStorage.setItem(storage(current.recordId),JSON.stringify({body:values(),baseReviewVersion:current.baseReviewVersion,baseBodyVersion:current.baseBodyVersion,operation:current.operation||null}));}catch{message('이 PC의 저장 공간이 부족합니다. 화면을 닫지 말고 저장하세요.');}}
function values(){const body={};for(const field of Object.keys(labels))body[field]=$('review-fields').querySelector('[name="'+field+'"]').value;return body;}
function message(text){$('review-message').textContent=text;}
function setBusy(value){busy=value;for(const input of $('review-form').querySelectorAll('input,textarea,select'))input.disabled=value||!!current?.operation||!current?.canReview;$('review-save').disabled=value||!current?.canReview;$('review-apply').disabled=value||!!current?.operation||!current?.canReview;$('review-receipt').disabled=value;}
function fill(body){for(const field of Object.keys(labels))$('review-fields').querySelector('[name="'+field+'"]').value=body[field]||'';}
function render(data,draft){
 const fields=Object.keys(labels).map(field=>'<label class="field">'+labels[field]+(field==='gubun'?'<select name="gubun"><option>A/S</option><option>점검</option></select>':['detail','result','remark'].includes(field)?'<textarea name="'+field+'" rows="4"></textarea>':'<input name="'+field+'"'+(field==='date'?' type="date"':'')+'>')+'</label>');
 $('review-fields').innerHTML=fields.join('');fill(draft?.body||data.published);
 $('review-original').textContent=Object.keys(labels).map(f=>labels[f]+': '+(data.original[f]||'미기록')).join('\n');
 $('review-status').textContent=(data.reviewVersion?'검수 완료 v'+data.reviewVersion+' · '+data.reviewedBy+' · '+data.reviewedAt:'미검수 · '+data.provenance)+(data.mirrorPending?' · 시트 반영 대기':' · 보고서 적용 v'+data.appliedVersion);
 $('review-record').textContent='기록 ID '+data.recordId+(data.requestId?' · 연결된 접수 유지':' · 접수 미연결 기록');
 $('review-identity-confirm').checked=false;$('review-save').textContent=draft?.operation?'동일 작업 저장 결과 확인 / 재시도':'Handover 저장';
 $('review-comparison').textContent='';$('review-rebase').hidden=true;$('review-history').textContent='';$('review-history-more').hidden=true;
 message(draft?'저장 전 변경 · 이 계정과 기록의 입력을 복원했습니다.':'✓는 입력 적용, Handover 저장은 서버 확정·공유입니다.');setBusy(false);
}
async function refreshConfig(){const name=account(),data=await api.get('work_review_config',{});if(account()!==name)return;if(!data.success)throw new Error(data.error);config=data;$('review-control').hidden=auth.cachedLevel()<3;$('review-admin-identity').textContent=data.identityUid||'계정 식별자가 없습니다. 다시 로그인하세요.';$('review-activate').hidden=!data.canReview||data.enabled;$('review-inbox-open').disabled=!data.canReview;$('review-config-status').textContent=data.enabled?'본문 검수 사용 중':data.configured?'기존 대기열 전환 확인 후 활성화할 수 있습니다.':'Deno의 HANDOVER_REVIEW_ADMIN_UID에 아래 인증 계정 ID를 설정하세요.';}
async function open(recordId,requestId){
 if(current&&$('handover-review-dialog').open&&readLocal(current.recordId)&&!root.confirm('저장 전 입력은 이 PC에 보관됩니다. 다른 기록을 여시겠습니까?'))return;
 const seq=++sequence,name=account(),data=await api.get('work_review_get',{recordId,requestId:requestId||''});if(seq!==sequence||account()!==name)return;if(!data.success)throw new Error(data.error);
 const draft=readLocal(recordId);current={...data,account:name,baseReviewVersion:draft?.baseReviewVersion??data.reviewVersion,baseBodyVersion:draft?.baseBodyVersion||data.bodyVersion,operation:draft?.operation||null};
 render(data,draft);if(!$('handover-review-dialog').open)$('handover-review-dialog').showModal();
}
async function saved(result){
 if(!current||current.account!==account()||result.recordId!==current.recordId)return;
 localStorage.removeItem(storage(current.recordId));current.operation=null;
 const id=current.recordId,requestId=current.requestId;await open(id,requestId);
 message('서버에 본문 전체가 저장되었습니다. 다른 사용자는 다음 최신 조회부터 확인할 수 있습니다.');
 if(root.BazHandoverReview.onSaved)await root.BazHandoverReview.onSaved(result,requestId);
}
async function checkReceipt(){if(!current?.operation)return false;const name=current.account,op=current.operation,data=await api.get('work_review_receipt',{operationId:op.operationId});if(account()!==name)return false;if(!data.success)throw new Error(data.error);if(data.found){await saved(data.result);return true;}return false;}
async function save(event){
 event.preventDefault();if(busy||!current?.canReview)return;const name=current.account;
 if(!current.operation){current.operation={recordId:current.recordId,requestId:current.requestId||'',baseReviewVersion:current.baseReviewVersion,baseBodyVersion:current.baseBodyVersion,body:values(),confirmIdentity:$('review-identity-confirm').checked,operationId:api.id()};persist();}
 setBusy(true);message('저장 결과 확인 중…');
 try{
 const op=current.operation;if(await checkReceipt())return;
 const data=await api.post('work_review_save',op);if(account()!==name)return;
 if(data.success){await saved(data);return;}
 if(data.conflict){current.operation=null;persist();current.latest=data.current;$('review-comparison').textContent=Object.keys(labels).map(f=>labels[f]+'\n내 입력: '+(op.body[f]||'미기록')+'\n서버: '+(data.current.published[f]||'미기록')).join('\n\n');$('review-rebase').hidden=false;message(data.error);return;}
 if(data.retrySameOperation){message(data.error+' 같은 작업으로 재시도하세요.');return;}
 current.operation=null;persist();message(data.error||'저장하지 못했습니다. 입력은 유지됩니다.');
 }catch(e){message('저장 결과 확인 중 · '+e.message+' 입력과 제출 작업은 보존됩니다.');try{await checkReceipt();}catch{}}
 finally{setBusy(false);}
}
async function inbox(page){const data=await api.get('work_review_inbox',{pageCursor:page||''});if(!data.success)throw new Error(data.error);$('review-inbox-list').innerHTML=data.items.map(item=>'<button type="button" data-review-record="'+esc(item.recordId)+'" data-review-request="'+esc(item.requestId)+'">'+esc(item.date+' · '+item.hospitalName+' · '+item.sn)+' · '+(item.reviewVersion?'검수 v'+item.reviewVersion:'미검수')+(item.requestId?'':' · 접수 미연결')+'</button>').join('');$('review-inbox-more').hidden=!data.pageCursor;$('review-inbox-more').onclick=()=>inbox(data.pageCursor);if(!$('review-inbox').open)$('review-inbox').showModal();}
function initialise(){
 if(!$('review-control'))return;
 async function history(page){const id=current?.recordId,name=account();if(!id)return;const data=await api.get('work_review_history',{recordId:id,requestId:current.requestId||'',pageCursor:page||''});if(id!==current?.recordId||name!==account())return;if(!data.success)throw new Error(data.error);$('review-history').textContent=(data.items||[]).map(item=>'검수 v'+item.version+' · '+item.actor+' · '+item.at+'\n'+item.changes.map(f=>(labels[f]||f)+'\n이전: '+(item.before[f]||'미기록')+'\n저장: '+(item.after[f]||'미기록')).join('\n')).join('\n\n')||'아직 저장된 검수 이력이 없습니다.';$('review-history-more').hidden=!data.pageCursor;$('review-history-more').onclick=()=>history(data.pageCursor).catch(e=>message(e.message));}
 $('review-history-load').onclick=()=>history().catch(e=>message(e.message));
 $('review-form').onsubmit=save;$('review-fields').oninput=()=>{persist();message('저장 전 변경 · 아직 공유되지 않았습니다.');};
 $('review-apply').onclick=()=>{persist();message('✓ 입력 적용 완료 · Handover 저장 전까지 공유본은 유지됩니다.');};
 $('review-close').onclick=()=>{if(current&&readLocal(current.recordId)&&!root.confirm('저장 전 변경은 이 PC에 보관됩니다. 닫으시겠습니까?'))return;$('handover-review-dialog').close();};
 $('handover-review-dialog').addEventListener('cancel',event=>{if(busy||current?.operation||current&&readLocal(current.recordId)&&!root.confirm('저장 전 입력을 보관하고 닫으시겠습니까?'))event.preventDefault();});
 $('review-receipt').onclick=async()=>{try{if(!await checkReceipt())message('아직 확정된 영수증이 없습니다. 동일 작업으로 저장을 다시 시도할 수 있습니다.');}catch(e){message(e.message);}};
 $('review-rebase').onclick=()=>{if(!current?.latest)return;current.baseReviewVersion=current.latest.reviewVersion;current.baseBodyVersion=current.latest.bodyVersion;delete current.operation;persist();$('review-rebase').hidden=true;message('최신 본문을 기준으로 내 입력을 유지했습니다. 다시 비교한 뒤 저장하세요.');};
 $('review-inbox-open').onclick=()=>inbox().catch(e=>{$('review-config-status').textContent=e.message;});$('review-inbox-close').onclick=()=>$('review-inbox').close();
 $('review-config-refresh').onclick=()=>refreshConfig().catch(e=>{$('review-config-status').textContent=e.message;});
 $('review-activate').onclick=async()=>{try{const data=await api.post('work_review_activate',{});if(!data.success)throw new Error(data.error);await refreshConfig();}catch(e){$('review-config-status').textContent=e.message;}};
 root.addEventListener('beforeunload',event=>{if(current&&readLocal(current.recordId)){event.preventDefault();event.returnValue='';}});
 refreshConfig().catch(()=>{});
}
root.BazHandoverReview={open,refreshConfig,initialise,onSaved:null};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialise,{once:true});else initialise();
})(window);
