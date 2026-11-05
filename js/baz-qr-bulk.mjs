import {api} from './baz-survey-api.mjs?v=292';
import {createBulkIssuer} from './baz-survey-bulk.mjs?v=306';
const $=id=>document.getElementById(id),tabs=[...document.querySelectorAll('.purpose-tabs [role=tab]')],states=new Map();
let active='',libraryPurpose=window.BazAuth?.cachedLevel()>=3?'as':'survey',busy=false;
const message=(text,error=false)=>{$('bulk-status').textContent=text;$('bulk-status').classList.toggle('error',error);};
async function work(action,p={}){
 const result=await window.BazWorkAPI[['qr_issue','qr_hospital_pause'].includes(action)?'post':'get'](action,p);
 if(!result.success)throw Object.assign(Error(result.error||'AS 연결을 확인하지 못했습니다.'),{status:result.status||(/로그인|만료/.test(result.error)?401:/권한|관리자/.test(result.error)?403:undefined)});
 return result;
}
const library=purpose=>purpose==='as'?work('qr_library'):api('/staff/qr-library',{},true);
const current=()=>active==='library'?'library:'+libraryPurpose:active;
function state(key){
 if(states.has(key))return states.get(key);
 const manage=key.startsWith('library:'),purpose=manage?key.slice(8):key,entry={purpose,manage,ready:false,loading:null};
 const panel=$(manage?'library-'+purpose:purpose+'-bulk');
 entry.bulk=createBulkIssuer(panel,{purpose,mode:manage?'library':'create',call:(path,p)=>api('/staff/'+path,p,true),
  ...(purpose==='as'?{onOperation:async(hospitalId,state)=>{await work('qr_hospital_pause',{hospitalId,state});},issue:async id=>(await work('qr_issue',{hospitalId:id})).hospital}:{}),
  onStatus:(text,error)=>{entry.message={text,error};if(current()===key)message(text,error);},
  onManage:()=>{libraryPurpose=purpose;show('library');},
  onIssued:()=>{const saved=states.get('library:'+purpose);if(saved)saved.ready=false;},
  onBusy:value=>{busy=value;tabs.forEach(t=>t.disabled=value);$('bulk-refresh').disabled=value;$('library-purpose').disabled=value;}
 });states.set(key,entry);return entry;
}
async function load(key,force=false){
 const entry=state(key);if(entry.loading)return entry.loading;if(entry.ready&&!force)return;
 entry.bulk.setLoading();if(current()===key)message(entry.manage?'생성된 QR을 불러오는 중…':'병원 목록을 불러오는 중…');
 entry.loading=(async()=>{try{
  if(entry.manage){const data=await library(entry.purpose);entry.bulk.setIssued(data.items);}
  else{
   const [directory,issued]=await Promise.all([entry.purpose==='as'?work('qr_directory'):api('/staff/directory',{},true),library(entry.purpose)]);
   if(entry.purpose==='as')entry.bulk.setHospitals(directory.items);else entry.bulk.setNames(directory.names);
   entry.bulk.setIssued(issued.items);
  }
  entry.ready=true;entry.message={text:entry.manage?'서버에 보관된 QR입니다. 인쇄할 병원을 선택하세요.':'병원별 QR을 생성한 뒤 생성된 QR 관리에서 인쇄를 준비하세요.',error:false};
 }catch(e){entry.bulk.setError(e.message);entry.message={text:e.message,error:true};}
 finally{entry.loading=null;if(current()===key)message(entry.message.text,entry.message.error);}})();return entry.loading;
}
async function show(tab){
 if(busy||!['as','survey','library'].includes(tab))return;active=tab;
 tabs.forEach(t=>{const selected=(t.dataset.purpose||t.dataset.tab)===tab;t.setAttribute('aria-selected',String(selected));t.tabIndex=selected?0:-1;});
 for(const id of ['as','survey','library'])$(id+'-bulk').hidden=id!==tab;
 if(tab==='library'){$('library-purpose').value=libraryPurpose;for(const p of ['as','survey'])$('library-'+p).hidden=p!==libraryPurpose;}
 const purpose=tab==='library'?libraryPurpose:tab,url=new URL(location.href);url.searchParams.set('purpose',purpose);if(tab==='library')url.searchParams.set('tab','library');else url.searchParams.delete('tab');history.replaceState(null,'',url);
 $('bulk-purpose-description').textContent=tab==='library'?'생성 기록 확인 → 병원 선택 → 수량·인쇄 이름 설정 → 인쇄 자료 저장':purpose==='as'?'병원 전용 QR을 서버에 보관합니다. 같은 QR로 접수와 진행 상황을 확인합니다.':'조사 회차가 바뀌어도 계속 사용하는 병원 전용 QR을 생성합니다.';
 const link=$('bulk-manage-link');link.href=purpose==='as'?'hospital-qr.html?manage=1':'survey-admin.html';link.textContent=purpose==='as'?'접수 운영 설정 ↗':'조사·결과 관리 ↗';
 const entry=state(current());message(entry.message?.text||'목록을 불러오는 중…',entry.message?.error);await load(current());
}
tabs.forEach(t=>t.addEventListener('click',()=>show(t.dataset.purpose||t.dataset.tab)));
document.querySelector('.purpose-tabs').addEventListener('keydown',e=>{
 if(busy||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const index=tabs.findIndex(t=>t.getAttribute('aria-selected')==='true');
 const next=tabs[e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];next.click();next.focus();
});
$('library-purpose').addEventListener('change',()=>{if(!busy){libraryPurpose=$('library-purpose').value;show('library');}});
$('bulk-refresh').addEventListener('click',()=>load(current(),true));
function initial(){const q=new URLSearchParams(location.search);if(q.get('purpose')==='survey')libraryPurpose='survey';else if(q.get('purpose')==='as')libraryPurpose='as';show(q.get('tab')==='library'?'library':q.get('purpose')==='survey'?'survey':'as');}
window.addEventListener('popstate',()=>{if(!busy)initial();});initial();
