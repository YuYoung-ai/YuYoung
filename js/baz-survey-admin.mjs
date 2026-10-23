import {api,el} from './baz-survey-api.mjs';
import {DEFINITION} from './baz-survey-schema.mjs';
import {createBuilder} from './baz-survey-builder.mjs';
import {createIssuer} from './baz-survey-issuer.mjs';
import {createResults} from './baz-survey-results.mjs';
const $=s=>document.querySelector(s),status=$('#status');
let data={campaigns:[],hospitals:[]},activeTab='campaigns',salesSettings;
const stateText={draft:'초안',open:'접수 중',closed:'종료'};
function notice(text,error=false){status.textContent=text;status.classList.toggle('error',error);}
function action(id,fn){$(id).addEventListener('click',async()=>{const b=$(id);b.disabled=true;try{await fn();}catch(e){notice(e.message,true);}finally{b.disabled=false;}});}
function option(v,text){const n=el('option','',text);n.value=v;return n;}
function fill(select,items,blank){const previous=select.value;select.replaceChildren();if(blank!==undefined)select.append(option('',blank));for(const [v,t]of items)select.append(option(v,t));if(items.some(x=>x[0]===previous))select.value=previous;}
function localTime(ms){return ms==null?'':new Date(ms+9*3600000).toISOString().slice(0,16);}
function parseTime(v){return v?Date.parse(v+':00+09:00'):null;}
function when(ms){return ms==null?'—':new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(ms));}
function showTab(tab){activeTab=tab;history.replaceState(null,'','#'+tab);for(const n of document.querySelectorAll('[data-tab]'))n.setAttribute('aria-selected',String(n.dataset.tab===tab));for(const id of ['issue','campaigns','results','sales-settings'])$('#'+id).hidden=id!==tab;$('#page-title').textContent=({campaigns:'CS 고객 설문 관리',results:'고객만족도 조사 결과','sales-settings':'영업팀 접속 설정',issue:'QR · 안내 문자'})[tab];$('#export-results').hidden=tab!=='results';if(tab==='results'&&!results.hasData())results.load().catch(e=>notice(e.message,true));}
function showSub(tab){for(const n of document.querySelectorAll('[data-campaign-tab]'))n.setAttribute('aria-selected',String(n.dataset.campaignTab===tab));$('#campaign-create').hidden=tab!=='create';$('#campaign-period').hidden=tab!=='period';}
document.querySelectorAll('[data-tab]').forEach(n=>n.addEventListener('click',()=>showTab(n.dataset.tab)));
document.querySelectorAll('[data-campaign-tab]').forEach(n=>n.addEventListener('click',()=>showSub(n.dataset.campaignTab)));
const builder=createBuilder({root:$('#question-editor'),titleInput:$('#new-title'),introInput:$('#new-intro'),heading:$('#builder-heading'),count:$('#question-count'),onStatus:notice});
const issuer=createIssuer($('#issue'),{call:(path,p)=>api('/staff/'+path,p,true),onStatus:notice,admin:true});
const results=createResults({root:$('#result-content'),dialog:$('#result-detail'),filter,onStatus:notice});
function editCampaign(){const c=data.campaigns.find(c=>c.id===$('#edit-campaign').value);$('#edit-title').value=c?.title||'';$('#edit-state').value=c?.state||'draft';$('#starts').value=localTime(c?.startsAt);$('#ends').value=localTime(c?.endsAt);$('#save-campaign').disabled=!c;$('#edit-definition').disabled=!c||c.state!=='draft';$('#definition-summary').textContent=c?`문항 ${c.definition.questions.length}개 · 문항 구성은 회차별로 보관됩니다.`:'등록한 조사가 없습니다.';}
function renderLists(){const items=data.campaigns.map(c=>[c.id,`${c.title} · ${stateText[c.state]}`]);fill($('#edit-campaign'),items);fill($('#result-campaign'),items);fill($('#template-campaign'),items,'기본 8문항');editCampaign();results.invalidate();issuer.setCampaigns(data.campaigns);}
async function bootstrap(){data=await api('/staff/bootstrap',{},true);renderLists();notice(data.campaigns.some(c=>c.state==='open')?'접수 중인 조사가 있습니다. 결과 통계에서 응답을 확인할 수 있습니다.':'접수 중인 조사가 없습니다. 초안을 등록한 뒤 접수 기간·상태에서 접수를 시작해 주세요.');}
async function loadHospitalNames(){issuer.setNames([]);issuer.setHelp('입점병원 목록을 불러오고 있습니다.');try{const p=await api('/staff/directory',{},true);issuer.setNames(p.names);}catch{issuer.setHelp('입점병원 목록을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.');}}
function resetBuilder(def=DEFINITION,title='',editing=null){builder.load(def,title,editing);$('#create-campaign').textContent=editing?'초안 문항 변경 저장':'조사 초안 등록';}
function discardOkay(){return !builder.dirty||window.confirm('작성 중인 문항을 바꾸고 선택한 문항 구성을 불러올까요?');}
action('#load-template',()=>{if(!discardOkay())return;const c=data.campaigns.find(c=>c.id===$('#template-campaign').value);resetBuilder(c?.definition||DEFINITION,c?c.title+' (복사)':'');notice('문항 구성을 불러왔습니다. 편집 후 새 조사로 등록해 주세요.');});
action('#new-builder',()=>{if(discardOkay())resetBuilder();});action('#add-question',()=>builder.add());
action('#preview-survey',()=>{builder.preview($('#preview-content'));$('#survey-preview').showModal();});$('#close-preview').addEventListener('click',()=>$('#survey-preview').close());
action('#create-campaign',async()=>{const editing=builder.editing,payload={title:$('#new-title').value,definition:builder.definition(),...(editing?{campaignId:editing.id,expectedUpdatedAt:editing.updatedAt}:{})};const p=await api('/staff/'+(editing?'campaign-definition':'campaign-create'),payload,true),id=editing?.id||p.campaign.id;builder.saved();await bootstrap();$('#edit-campaign').value=id;editCampaign();resetBuilder();showSub('period');notice(editing?'초안 문항을 저장했습니다.':'새 조사를 초안으로 등록했습니다. 접수 기간과 상태를 설정해 주세요.');});
$('#edit-campaign').addEventListener('change',editCampaign);
action('#edit-definition',()=>{const c=data.campaigns.find(c=>c.id===$('#edit-campaign').value);if(!c||!discardOkay())return;resetBuilder(c.definition,c.title,{id:c.id,updatedAt:c.updatedAt});showSub('create');notice('초안 문항을 수정하고 변경 내용을 저장해 주세요.');});
action('#save-campaign',async()=>{const c=$('#edit-campaign').value;await api('/staff/campaign-update',{campaignId:c,title:$('#edit-title').value,state:$('#edit-state').value,startsAt:parseTime($('#starts').value),endsAt:parseTime($('#ends').value)},true);await bootstrap();$('#edit-campaign').value=c;editCampaign();notice('조사 설정을 저장했습니다.');});
const salesUrl=new URL('survey-sales.html',location.href).href;$('#sales-url').value=salesUrl;
action('#copy-sales-url',async()=>{await navigator.clipboard.writeText(salesUrl);notice('영업팀 전용 페이지 URL을 복사했습니다.');});
async function loadSalesSettings(){salesSettings=await api('/staff/sales-settings',{},true);$('#sales-access-state').textContent=!salesSettings.configured?'공용 비밀번호가 아직 설정되지 않았습니다. 비밀번호를 설정하면 영업팀이 접속할 수 있습니다.':`영업팀 접속 ${salesSettings.enabled?'사용 중':'중지'} · 최근 변경 ${when(salesSettings.updatedAt)}`;$('#toggle-sales').disabled=!salesSettings.configured;$('#toggle-sales').textContent=salesSettings.enabled?'영업팀 접속 중지':'영업팀 접속 다시 사용';}
$('#sales-password-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.currentTarget.querySelector('button');if($('#sales-password').value!==$('#sales-password-confirm').value){notice('비밀번호와 확인 입력이 일치하지 않습니다.',true);return;}b.disabled=true;try{await api('/staff/sales-password',{password:$('#sales-password').value},true);$('#sales-password-form').reset();await loadSalesSettings();notice('공용 비밀번호를 저장했습니다. 기존 영업팀 접속은 모두 해제되었습니다.');}catch(e){notice(e.message,true);}finally{b.disabled=false;}});
action('#toggle-sales',async()=>{await api('/staff/sales-state',{enabled:!salesSettings.enabled},true);await loadSalesSettings();notice('영업팀 접속 설정을 변경했습니다.');});
function filter(){const from=$('#from').value,until=$('#until').value;return {campaignId:$('#result-campaign').value,from:from?Date.parse(from+'T00:00:00+09:00'):undefined,until:until?Date.parse(until+'T00:00:00+09:00')+86400000:undefined};}
$('#result-filter-form').addEventListener('submit',async e=>{e.preventDefault();const b=$('#load-results');b.disabled=true;try{await results.load();}catch(e){notice(e.message,true);}finally{b.disabled=false;}});
for(const id of ['#result-campaign','#from','#until'])$(id).addEventListener('change',()=>results.invalidate());
action('#export-results',async()=>{const r=await api('/staff/export',filter(),true,true),url=URL.createObjectURL(await r.blob()),a=el('a');a.href=url;a.download='고객만족도-응답-'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice('선택한 조건의 응답 CSV를 내려받았습니다.');});
action('#refresh',async()=>{await bootstrap();await Promise.all([loadHospitalNames(),loadSalesSettings()]);if(activeTab==='results')await results.load();});
try{await bootstrap();const requested=location.hash.slice(1);if(['campaigns','results','sales-settings','issue'].includes(requested))showTab(requested);loadHospitalNames();loadSalesSettings().catch(e=>notice(e.message,true));}catch(e){notice(e.message,true);}
