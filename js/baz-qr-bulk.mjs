import {api} from './baz-survey-api.mjs?v=292';
import {createBulkIssuer} from './baz-survey-bulk.mjs?v=292';
const status=document.getElementById('bulk-status'),refresh=document.getElementById('bulk-refresh'),tabs=[...document.querySelectorAll('[data-purpose]')],states=new Map();
let active='',busy=false;
const message=(text,error=false)=>{status.textContent=text;status.classList.toggle('error',error);};
async function work(action,p={}){
 const result=await window.BazWorkAPI[action==='qr_issue'?'post':'get'](action,p);if(!result.success){const error=Error(result.error||'AS 연결을 확인하지 못했습니다.');error.status=result.status||(/로그인|만료/.test(result.error)?401:/권한|관리자/.test(result.error)?403:undefined);throw error;}return result;
}
function state(purpose){
 if(states.has(purpose))return states.get(purpose);
 const panel=document.getElementById(purpose+'-bulk'),entry={panel,loading:null,ready:false};
 entry.bulk=createBulkIssuer(panel,{purpose,call:(path,p)=>api('/staff/'+path,p,true),...(purpose==='as'?{issue:async id=>(await work('qr_issue',{hospitalId:id})).hospital}:{}),
  onStatus:(text,error)=>{entry.message={text,error};if(active===purpose)message(text,error);},
  onBusy:value=>{busy=value;tabs.forEach(t=>t.disabled=value);refresh.disabled=value;}});
 states.set(purpose,entry);return entry;
}
async function load(purpose,force=false){
 const entry=state(purpose);if(entry.loading)return entry.loading;if(entry.ready&&!force)return;
 entry.bulk.setLoading();if(active===purpose)message('병원 목록을 불러오는 중…');
 entry.loading=(async()=>{try{
  if(purpose==='as'){const data=await work('qr_directory');entry.bulk.setHospitals(data.items);}else{const data=await api('/staff/directory',{},true);entry.bulk.setNames(data.names);}
  entry.ready=true;entry.message={text:'병원을 선택해 QR을 생성해 주세요.',error:false};
 }catch(e){entry.bulk.setError(e.message);entry.message={text:e.message,error:true};}
 finally{entry.loading=null;if(active===purpose)message(entry.message.text,entry.message.error);}})();return entry.loading;
}
async function show(purpose){
 if(busy||!['as','survey'].includes(purpose))return;
 active=purpose;state(purpose);
 tabs.forEach(t=>{const selected=t.dataset.purpose===purpose;t.setAttribute('aria-selected',String(selected));t.tabIndex=selected?0:-1;});
 for(const id of ['as','survey'])document.getElementById(id+'-bulk').hidden=id!==purpose;
 const url=new URL(location.href);url.searchParams.set('purpose',purpose);history.replaceState(null,'',url);
 document.getElementById('bulk-purpose-description').textContent=purpose==='as'?'같은 병원 QR로 접수와 진행 상황을 확인합니다. 발급 권한: 관리자.':'병원 전용 QR은 조사 회차가 바뀌어도 계속 사용할 수 있습니다.';
 const link=document.getElementById('bulk-manage-link');link.href=purpose==='as'?'hospital-qr.html?manage=1':'survey-admin.html';link.textContent=purpose==='as'?'접수 운영 설정 ↗':'조사·결과 관리 ↗';
 const entry=states.get(purpose);message(entry.message?.text||'병원 목록을 불러오는 중…',entry.message?.error);await load(purpose);
}
tabs.forEach(t=>t.addEventListener('click',()=>show(t.dataset.purpose)));
document.querySelector('.purpose-tabs').addEventListener('keydown',e=>{if(busy||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?tabs[0]:e.key==='End'?tabs[1]:tabs.find(t=>t.dataset.purpose!==active);next.click();next.focus();});
refresh.addEventListener('click',()=>load(active,true));window.addEventListener('popstate',()=>{if(!busy)show(new URLSearchParams(location.search).get('purpose')||'as');});
show(new URLSearchParams(location.search).get('purpose')==='survey'?'survey':'as');
