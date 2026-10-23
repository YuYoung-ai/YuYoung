import {api,el,button} from './baz-survey-api.mjs';
import {SCALE,validateAnswers} from './baz-survey-schema.mjs';
const root=document.querySelector('#survey'),code=new URLSearchParams(location.hash.slice(1)).get('h');
let context,answers={},step=0,submissionId,storageKey,busy=false;
function panel(){const p=el('section','panel');root.replaceChildren(p);return p;}
function message(title,copy,done=false){const p=panel();if(done)p.append(el('div','success-icon','✓'));p.append(el('h1','',title),el('p','muted',copy));}
function save(){try{sessionStorage.setItem(storageKey,JSON.stringify({answers,step,submissionId}));}catch{}}
function welcome(){const p=panel();p.append(el('p','eyebrow','YOUR VOICE, OUR NEXT STEP'),el('div','hospital-tag',context.hospital),el('h1','','더 나은 제품과 서비스,\n의견에서 시작합니다.'));
 p.append(el('p','welcome-copy','사용하시면서 느끼신 점을 들려주세요. 원장님의 소중한 의견을 제품과 서비스 개선에 참고하겠습니다.'));
 const facts=el('div','facts');for(const [big,small]of[['8문항','간단한 선택과 의견'],['약 2분','편한 시간에 참여']]){const f=el('span');f.append(el('strong','',big),document.createTextNode(small));facts.append(f);}p.append(facts,button('설문 시작하기',()=>render(true),'primary wide'),el('p','privacy','응답은 병원별로 수집되며, 제품·서비스 개선에 활용됩니다. 이번 조사에는 병원당 1회 참여하실 수 있습니다.'));
 p.prepend(el('p','muted',context.campaign.title));
}
function render(focus=false){const def=context.campaign.definition,q=def.questions[step],p=panel();
 const top=el('div','step-label');top.append(el('span','',context.hospital),el('strong','',`${step+1} / ${def.questions.length}`));const progress=el('div','progress-line'),fill=el('span');fill.style.width=((step+1)/def.questions.length*100)+'%';progress.append(fill);
 const title=el('h2','question',q.title);title.tabIndex=-1;p.append(top,progress,el('p','eyebrow',q.type==='text'?'YOUR IDEAS':'CUSTOMER SURVEY'),title,el('p','help',q.type==='text'?q.hint:q.type==='multiple'?'해당하는 항목을 모두 선택해 주세요. (복수 선택)':'해당하는 항목을 하나 선택해 주세요.'));
 const options=el('div','options'),error=el('p','error');error.setAttribute('role','alert');
 if(q.type==='text'){
  const t=el('textarea');t.placeholder=q.placeholder;t.maxLength=q.max;t.value=answers[q.id]||'';t.setAttribute('aria-label','개선 의견 (선택)');const count=el('div','counter');const update=()=>{answers[q.id]=t.value;count.textContent=`${t.value.length} / ${q.max}자 · 선택 작성`;save();};t.addEventListener('input',update);update();options.append(el('span','badge','선택 · 작성하지 않아도 제출할 수 있어요'),t,count);
 }else{
  const values=q.type==='rating'?SCALE:q.options;
  values.forEach((text,i)=>{const value=q.type==='rating'?i+1:text,label=el('label','choice'),input=el('input');input.type=q.type==='multiple'?'checkbox':'radio';input.name=q.id;input.value=String(value);input.checked=q.type==='multiple'?(answers[q.id]||[]).includes(value):answers[q.id]===value;
   input.addEventListener('change',()=>{answers[q.id]=q.type==='multiple'?Array.from(options.querySelectorAll('input:checked'),n=>n.value):value;error.textContent='';save();if(q.id==='source')other.hidden=answers.source!=='기타';});label.append(input,el('span','',text));if(q.type==='rating')label.append(el('span','score',`${value}점`));options.append(label);
  });
 }
 const other=el('label','field','기타 경로 (선택)');other.hidden=q.id!=='source'||answers.source!=='기타';const otherInput=el('input');otherInput.type='text';otherInput.maxLength=100;otherInput.value=answers.sourceOther||'';otherInput.placeholder='어떤 경로인지 알려주세요';otherInput.addEventListener('input',()=>{answers.sourceOther=otherInput.value;save();});other.append(otherInput);
 const actions=el('div','actions');if(step>0)actions.append(button('이전',()=>{step--;save();render(true);},'secondary'));
 const next=button(step===def.questions.length-1?'의견 전달하고 설문 마치기':'다음',async()=>{
  if(busy)return;
  if(q.type==='multiple'&&!(answers[q.id]||[]).length){error.textContent='하나 이상 선택해 주세요.';return;}
  if(q.type!=='text'&&q.type!=='multiple'&&answers[q.id]===undefined){error.textContent='항목을 선택한 뒤 다음으로 이동해 주세요.';return;}
  if(step<def.questions.length-1){step++;save();render(true);return;}
  try{const clean=validateAnswers(def,answers);busy=true;actions.querySelectorAll('button').forEach(b=>b.disabled=true);next.textContent='제출 중…';error.textContent='';await api('/public/submit',{code,campaignId:context.campaign.id,submissionId,answers:clean});try{sessionStorage.removeItem(storageKey);}catch{}message('소중한 의견 감사합니다.','남겨주신 응답을 잘 받았습니다. 제품과 서비스 개선에 참고하겠습니다.',true);}
  catch(e){if(e.status===409){message('이번 조사에 이미 참여하셨습니다.','응답이 정상적으로 접수된 병원입니다. 참여해 주셔서 감사합니다.',true);return;}error.textContent=e.message;actions.querySelectorAll('button').forEach(b=>b.disabled=false);next.textContent='의견 전달하고 설문 마치기';}
  finally{busy=false;}
 });actions.append(next);p.append(options,other,error,actions);if(q.type==='text')p.append(el('p','privacy','환자 정보나 개인 연락처 등 개인정보는 적지 말아 주세요.'));
 if(focus)title.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});
}
async function start(){try{
 if(!code||!/^[a-f0-9]{48}$/.test(code)){message('병원 전용 링크로 접속해 주세요.','안내 문자에 포함된 주소 또는 전달받은 QR로 접속하실 수 있습니다.');return;}
 context=await api('/public/resolve',{code});if(context.completed){message('이번 조사에 이미 참여하셨습니다.','참여해 주셔서 감사합니다. 소중한 의견을 제품과 서비스 개선에 참고하겠습니다.',true);return;}
 storageKey='baz-survey-draft:'+code+':'+context.campaign.id;submissionId=crypto.randomUUID();try{const draft=JSON.parse(sessionStorage.getItem(storageKey));if(draft&&typeof draft.answers==='object'&&draft.answers&&!Array.isArray(draft.answers)&&/^[a-f0-9-]{36}$/.test(draft.submissionId)){answers=draft.answers;step=Math.max(0,Math.min(context.campaign.definition.questions.length-1,Number(draft.step)||0));submissionId=draft.submissionId;}}catch{}welcome();
 }catch(e){message('설문을 확인해 주세요.',e.message);if(![404,410].includes(e.status))root.firstChild.append(button('다시 확인',start,'primary wide'));}}
start();
