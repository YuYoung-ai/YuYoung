import {api,el,button} from './baz-survey-api.mjs';
import {SCALE} from './baz-survey-schema.mjs';
const $=s=>document.querySelector(s),status=$('#status');
let data={campaigns:[],hospitals:[]},currentHospital,currentLink,activeTab='issue',resultPage=0,loadedFilter;
const stateText={draft:'초안',open:'접수 중',closed:'종료'};
function notice(text,error=false){status.textContent=text;status.classList.toggle('error',error);}
function action(id,fn){$(id).addEventListener('click',async()=>{const b=$(id);b.disabled=true;try{await fn();}catch(e){notice(e.message,true);}finally{b.disabled=false;}});}
function option(v,text){const n=el('option','',text);n.value=v;return n;}
function fill(select,items,blank){const previous=select.value;select.replaceChildren();if(blank!==undefined)select.append(option('',blank));for(const [v,t]of items)select.append(option(v,t));if(items.some(x=>x[0]===previous))select.value=previous;}
function localTime(ms){return ms==null?'':new Date(ms+9*3600000).toISOString().slice(0,16);}
function parseTime(v){return v?Date.parse(v+':00+09:00'):null;}
function when(ms){return ms==null?'—':new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(ms));}
function showTab(tab){activeTab=tab;for(const n of document.querySelectorAll('[data-tab]'))n.setAttribute('aria-selected',String(n.dataset.tab===tab));for(const id of ['issue','campaigns','results'])$('#'+id).hidden=id!==tab;}
document.querySelectorAll('[data-tab]').forEach(n=>n.addEventListener('click',()=>showTab(n.dataset.tab)));
function editCampaign(){const c=data.campaigns.find(c=>c.id===$('#edit-campaign').value);$('#edit-title').value=c?.title||'';$('#edit-state').value=c?.state||'draft';$('#starts').value=localTime(c?.startsAt);$('#ends').value=localTime(c?.endsAt);$('#save-campaign').disabled=!c;}
function renderLists(){
 const items=data.campaigns.map(c=>[c.id,`${c.title} · ${stateText[c.state]}`]);
 fill($('#delivery-campaign'),items,'조사를 선택하세요');const open=data.campaigns.find(c=>c.state==='open');if(open)$('#delivery-campaign').value=open.id;
 fill($('#edit-campaign'),items);fill($('#result-campaign'),items);editCampaign();
 fill($('#result-hospital'),data.hospitals.map(h=>[h.id,h.name]),'전체 병원');
 const names=new Set(data.hospitals.map(h=>h.name));$('#hospital-list').replaceChildren(...[...names].map(n=>option(n,n)));
 for(const n of document.querySelectorAll('.admin-only'))n.hidden=data.level<2;
 if(data.level<2&&activeTab!=='issue')showTab('issue');
}
async function bootstrap(){data=await api('/staff/bootstrap',{},true);renderLists();notice(data.campaigns.some(c=>c.state==='open')?'접수 중인 조사가 있습니다. 병원별 링크를 만들어 전달해 주세요.':data.level>=2?'접수 중인 조사가 없습니다. 조사 관리에서 초안을 만들고 접수를 시작해 주세요.':'접수 중인 조사가 없습니다. 관리자에게 조사 개설을 요청해 주세요.');}
async function loadHospitalNames(){
 $('#hospital-help').textContent='기존 병원 목록을 확인하고 있습니다. 직접 입력도 가능합니다.';
 try{
  let directory;try{const p=await api('/staff/directory',{},true);if(!Array.isArray(p.names))throw Error();directory=p.names;}
  catch{const url=window.BazAuth.withToken(window.BazSurveyConfig.hospitalDb+'?action=hospdbrich');const r=await fetch(url,{signal:AbortSignal.timeout(15000),cache:'no-store'});const p=await r.json();if(!p.success||!Array.isArray(p.data))throw Error();directory=p.data.map(h=>h.name);}
  const names=new Set([...data.hospitals.map(h=>h.name),...directory.filter(n=>typeof n==='string'&&n.trim())]);$('#hospital-list').replaceChildren(...[...names].sort((a,b)=>a.localeCompare(b,'ko')).map(n=>option(n,n)));$('#hospital-help').textContent='기존 병원 목록을 불러왔습니다. 목록에 없으면 직접 입력할 수 있습니다.';
 }catch{$('#hospital-help').textContent='기존 병원 목록을 연결하지 못했습니다. 병원명을 직접 입력해도 사용할 수 있습니다.';}
}
function sms(){return `[BAZ 고객만족도 조사]\n${currentHospital.name} 원장님, 안녕하세요.\n더 나은 제품과 서비스를 위해 원장님의 의견을 듣고자 합니다.\n약 2분이면 참여하실 수 있습니다.\n아래 링크에서 설문에 참여해 주세요.\n${currentLink}\n참여해 주셔서 감사합니다.`;}
async function copy(text){await navigator.clipboard.writeText(text);notice('복사했습니다.');}
function download(blob,name){const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
action('#make-link',async()=>{
 const p=await api('/staff/hospital-save',{name:$('#hospital-name').value},true);currentHospital=p.hospital;const i=data.hospitals.findIndex(h=>h.id===currentHospital.id);if(i<0)data.hospitals.push(currentHospital);else data.hospitals[i]=currentHospital;
 currentLink=window.BazSurveyConfig.customerPage+'#h='+currentHospital.code;
 $('#issued').hidden=false;$('#link-output').textContent=currentLink;$('#qr-hospital').textContent=currentHospital.name;$('#qr').hidden=false;$('#qr-placeholder').hidden=true;
 await window.BazQrEncoder.toCanvas($('#qr'),currentLink,{width:280,margin:2,errorCorrectionLevel:'M'});$('#sms-text').value=sms();$('#hospital-state').hidden=data.level<2;$('#hospital-state').textContent=currentHospital.active?'이 병원 링크 중지':'이 병원 링크 다시 사용';
 fill($('#result-hospital'),data.hospitals.map(h=>[h.id,h.name]),'전체 병원');notice(currentHospital.active?'병원 전용 QR과 링크를 생성했습니다.': '중지된 병원 링크입니다. 다시 사용을 선택하면 고객이 접속할 수 있습니다.',!currentHospital.active);
});
action('#copy-link',()=>copy(currentLink));action('#copy-sms',()=>copy($('#sms-text').value));
action('#download-qr',()=>new Promise((resolve,reject)=>$('#qr').toBlob(blob=>{if(!blob){reject(Error('QR 저장을 다시 시도해 주세요.'));return;}download(blob,`고객설문-QR-${currentHospital.name.replace(/[<>:"/\\|?*]/g,'_')}.png`);notice('QR 이미지를 저장했습니다.');resolve();},'image/png')));
action('#record-delivery',async()=>{await api('/staff/delivery',{campaignId:$('#delivery-campaign').value,hospitalId:currentHospital.id,channel:$('#channel').value},true);notice('전달 이력을 기록했습니다. 문자 발송은 회사 발송 수단에서 직접 진행해 주세요.');});
action('#hospital-state',async()=>{await api('/staff/hospital-state',{hospitalId:currentHospital.id,active:!currentHospital.active},true);currentHospital.active=!currentHospital.active;$('#hospital-state').textContent=currentHospital.active?'이 병원 링크 중지':'이 병원 링크 다시 사용';notice(currentHospital.active?'병원 링크를 다시 사용할 수 있습니다.':'병원 링크를 중지했습니다. 기존 응답은 보관됩니다.');});
action('#create-campaign',async()=>{const p=await api('/staff/campaign-create',{title:$('#new-title').value},true);await bootstrap();$('#edit-campaign').value=p.campaign.id;editCampaign();$('#new-title').value='';notice('조사 초안을 만들었습니다. 상태와 기간을 설정한 뒤 저장해 주세요.');});
$('#edit-campaign').addEventListener('change',editCampaign);
action('#save-campaign',async()=>{const c=$('#edit-campaign').value;await api('/staff/campaign-update',{campaignId:c,title:$('#edit-title').value,state:$('#edit-state').value,startsAt:parseTime($('#starts').value),endsAt:parseTime($('#ends').value)},true);await bootstrap();$('#edit-campaign').value=c;editCampaign();notice('조사 설정을 저장했습니다.');});
function filter(){const from=$('#from').value,until=$('#until').value;return {campaignId:$('#result-campaign').value,hospitalId:$('#result-hospital').value||undefined,from:from?Date.parse(from+'T00:00:00+09:00'):undefined,until:until?Date.parse(until+'T00:00:00+09:00')+86400000:undefined};}
function stat(title,value,detail){const n=el('div','stat');n.append(el('span','help',title),el('strong','',value),el('small','',detail));return n;}
function table(headers,rows){const wrap=el('div','table-wrap'),t=el('table'),head=el('thead'),tr=el('tr');headers.forEach(h=>tr.append(el('th','',h)));head.append(tr);const body=el('tbody');for(const row of rows){const r=el('tr');for(const text of row)r.append(el('td','comment',String(text??'')));body.append(r);}t.append(head,body);wrap.append(t);return wrap;}
async function loadResults(page=0){
 const filters=filter(),p=await api('/staff/results',{...filters,page},true);loadedFilter=JSON.stringify(filters);resultPage=page;const root=$('#result-content'),tot=p.totals;root.replaceChildren();
 const cards=el('div','stats-cards');cards.append(stat('응답 병원',`${tot.hospitals}곳`,'선택한 응답 기간 기준'),stat('전달 기록',`${tot.sent}곳`,'해당 회차 전체 전달 병원'),stat('응답률',tot.rate==null?'—':tot.rate.toFixed(1)+'%',`전달 기록 중 응답 ${tot.sentResponded}곳`),stat('개선 의견',`${tot.comments}건`,'선택한 응답 기간 기준'));root.append(cards,el('p','help','응답률 = 전달 이력이 있는 병원 중 조회 기간에 응답한 병원 ÷ 해당 회차 전달 병원. 전달 이력이 없는 현장 응답도 응답 병원 수와 문항 통계에는 포함됩니다.'));
 const charts=el('div','charts');for(const [index,q]of p.campaign.definition.questions.entries()){
  if(q.type==='text')continue;const n=el('article','chart');n.append(el('h3','',`${index+1}. ${q.title}`));const distribution=p.distributions[q.id],counts=new Map(distribution.map(v=>[v.value,Number(v.count)])),opts=q.type==='rating'?SCALE:q.options;
  if(q.type==='rating'){const count=distribution.reduce((s,v)=>s+v.count,0),sum=distribution.reduce((s,v)=>s+Number(v.value)*v.count,0),good=(counts.get(4)||0)+(counts.get(5)||0);n.append(el('div','summary',count?`평균 ${(sum/count).toFixed(2)} / 5점 · 만족 이상 ${(good/count*100).toFixed(1)}%`:'아직 응답이 없습니다.'));}
  else n.append(el('div','summary',q.type==='multiple'?'복수 선택 · 응답 병원 기준 (비율 합계가 100%를 넘을 수 있습니다.)':`응답 ${tot.responses}건 기준`));
  opts.forEach((label,i)=>{const key=q.type==='rating'?i+1:label,count=counts.get(key)||0,pct=tot.responses?count/tot.responses*100:0,row=el('div','bar-row'),track=el('div','bar-track'),bar=el('span');bar.style.width=pct+'%';track.append(bar);row.append(el('span','',label),track,el('span','value',`${count}건 · ${pct.toFixed(0)}%`));n.append(row);});charts.append(n);
 }root.append(charts,el('h2','','병원별 응답 · 개선 의견'),el('p','help',`총 ${tot.responses}건 · ${page+1}페이지 · 한 번에 50건 표시`));
 root.append(table(['병원 / 제출시각','만족도 (가격·품질·납기·서비스·편의성)','구입 정보 / 개선 의견'],p.responses.map(r=>[r.name+'\n'+when(r.submitted_at),['price','quality','delivery','service','usability'].map(k=>r.answers[k]+'점').join(' / '),`인지 경로: ${r.answers.source}${r.answers.sourceOther?' ('+r.answers.sourceOther+')':''}\n구입 이유: ${r.answers.purchase.join(', ')}\n의견: ${r.answers.comment||'작성하지 않음'}`])));
 const paging=el('div','actions');if(page>0)paging.append(button('이전 50건',()=>pageResults(page-1),'secondary'));if(p.hasMore)paging.append(button('다음 50건',()=>pageResults(page+1),'secondary'));root.append(paging,el('h2','','전달 이력'),el('p','help','해당 회차의 최근 전달 병원 최대 200곳을 표시합니다. 응답 기간 필터는 이 목록에 적용되지 않습니다.'));
 root.append(table(['병원','전달 방식 / 일시','참여 여부'],p.deliveries.map(d=>[d.name,({sms:'문자',onsite:'현장 QR',other:'기타'}[d.channel])+' / '+when(d.delivered_at),d.submitted_at?'응답 완료 · '+when(d.submitted_at):'미응답'])));
 if(!tot.responses)root.prepend(el('p','empty','아직 선택한 조건의 응답이 없습니다.'));notice('통계를 불러왔습니다.');
}
async function pageResults(page){try{if(loadedFilter!==JSON.stringify(filter())){await loadResults(0);return;}await loadResults(page);}catch(e){notice(e.message,true);}}
action('#load-results',()=>loadResults(0));
action('#export-results',async()=>{const r=await api('/staff/export',filter(),true,true);download(await r.blob(),'고객만족도-응답-'+new Date().toISOString().slice(0,10)+'.csv');notice('선택한 조건의 응답 CSV를 내려받았습니다.');});
action('#refresh',async()=>{await bootstrap();await loadHospitalNames();});
try{await bootstrap();loadHospitalNames();}catch(e){notice(e.message,true);}
