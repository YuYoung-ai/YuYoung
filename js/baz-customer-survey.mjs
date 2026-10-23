import {api,el,button} from './baz-survey-api.mjs';
import {SCALE,validateAnswers,validateAnswer,otherOption,otherKey} from './baz-survey-schema.mjs';
const root=document.querySelector('#survey'),code=new URLSearchParams(location.hash.slice(1)).get('h');
let context,answers={},step=0,submissionId,storageKey,busy=false;
function panel(){const p=el('section','panel');root.replaceChildren(p);return p;}
function message(title,copy,done=false){const p=panel();if(done){p.classList.add('completion');const label=el('div','step-label'),line=el('div','progress-line'),fill=el('span');label.append(el('span','','설문 완료'),el('strong','','100%'));fill.style.width='100%';line.append(fill);p.append(label,line,el('div','success-icon','✓'));}p.append(el('h1','',title),el('p','muted',copy));}
function save(){try{sessionStorage.setItem(storageKey,JSON.stringify({answers,step,submissionId}));}catch{}}
function welcome(){const p=panel(),def=context.campaign.definition,count=def.questions.length;p.append(el('p','muted',context.campaign.title),el('p','eyebrow','YOUR VOICE, OUR NEXT STEP'),el('div','hospital-tag',context.hospital),el('h1','','더 나은 제품과 서비스,\n의견에서 시작합니다.'),el('p','welcome-copy',def.intro||'사용하시면서 느끼신 점을 들려주세요.'));
 const facts=el('div','facts');for(const [big,small]of[[`${count}문항`,'간단한 선택과 의견'],[`약 ${Math.max(1,Math.ceil(count/4))}분`,'편한 시간에 참여']]){const f=el('span');f.append(el('strong','',big),document.createTextNode(small));facts.append(f);}p.append(facts,button('설문 시작하기',()=>render(true),'primary wide'),el('p','privacy','응답은 병원별로 수집되며, 제품·서비스 개선에 활용됩니다. 이번 조사에는 병원당 1회 참여하실 수 있습니다.'));
}
function render(focus=false){const def=context.campaign.definition,q=def.questions[step],p=panel();
 const percent=Math.round(step/def.questions.length*100),top=el('div','step-label');top.append(el('span','',context.hospital),el('strong','',`${step+1} / ${def.questions.length} · ${percent}%`));const progress=el('div','progress-line'),fill=el('span');fill.style.width=percent+'%';progress.append(fill);
 const title=el('h2','question');title.append(el('span','question-number','Q'+(step+1)),document.createTextNode(q.title));title.tabIndex=-1;const guide=q.hint||(q.type==='text'?'느끼신 점을 편하게 작성해 주세요.':q.type==='multiple'?'해당하는 항목을 모두 선택해 주세요. (복수 선택)':'해당하는 항목을 하나 선택해 주세요.');
 p.append(top,progress,el('p','eyebrow',q.type==='text'?'YOUR IDEAS':'CUSTOMER SURVEY'),title,el('span','badge',q.required?'필수 응답':'선택 · 응답하지 않아도 제출할 수 있어요'),el('p','help',guide));
 const options=el('div','options'),error=el('p','error');error.setAttribute('role','alert');
 const extra=el('label','field','기타 내용 (선택)'),extraKey=otherKey(q),hasOther=otherOption(q);const selectedOther=()=>hasOther&&(Array.isArray(answers[q.id])?answers[q.id].includes(hasOther):answers[q.id]===hasOther);extra.hidden=!selectedOther();const extraInput=el('input');extraInput.type='text';extraInput.maxLength=100;extraInput.value=answers[extraKey]||'';extraInput.placeholder='기타 내용을 알려주세요';extraInput.addEventListener('input',()=>{answers[extraKey]=extraInput.value;save();});extra.append(extraInput);
 if(q.type==='text'){
  const t=el('textarea');t.placeholder=q.placeholder||'';t.maxLength=q.max;t.value=answers[q.id]||'';t.setAttribute('aria-label',q.title+(q.required?' (필수)':' (선택)'));const count=el('div','counter');const update=()=>{answers[q.id]=t.value;count.textContent=`${t.value.length} / ${q.max}자`;save();};t.addEventListener('input',update);update();options.append(t,count);
 }else{
  const values=q.type==='rating'?SCALE:q.options;
  values.forEach((text,i)=>{const value=q.type==='rating'?i+1:text,label=el('label','choice'),input=el('input');input.type=q.type==='multiple'?'checkbox':'radio';input.name=q.id;input.value=String(value);input.checked=q.type==='multiple'?(answers[q.id]||[]).includes(value):answers[q.id]===value;
   input.addEventListener('change',()=>{answers[q.id]=q.type==='multiple'?Array.from(options.querySelectorAll('input:checked'),n=>n.value):value;error.textContent='';extra.hidden=!selectedOther();save();});label.append(input,el('span','',text));if(q.type==='rating')label.append(el('span','score',`${value}점`));options.append(label);
  });
  if(!q.required)options.append(button('이 문항 응답 지우기',()=>{answers[q.id]=q.type==='multiple'?[]:null;save();render();},'secondary'));
 }
 const actions=el('div','actions');if(step>0)actions.append(button('이전',()=>{step--;save();render(true);},'secondary'));
 const submitText='설문 마치기';
 const next=button(step===def.questions.length-1?submitText:'다음',async()=>{
  if(busy)return;try{validateAnswer(q,answers[q.id]);}catch(e){error.textContent=e.message;return;}
  if(step<def.questions.length-1){step++;save();render(true);return;}
  try{const clean=validateAnswers(def,answers);busy=true;actions.querySelectorAll('button').forEach(b=>b.disabled=true);next.textContent='제출 중…';error.textContent='';await api('/public/submit',{code,campaignId:context.campaign.id,definitionVersion:def.version,submissionId,answers:clean});try{sessionStorage.removeItem(storageKey);}catch{}message('응답이 완료되었습니다.','바쁘신 중에도 설문에 참여해 주셔서 진심으로 감사드립니다.\n남겨주신 의견은 더 나은 제품과 서비스를 만드는 데 소중히 활용하겠습니다.',true);}
  catch(e){if(e.code==='SURVEY_CHANGED'){message('설문이 업데이트되었습니다.',e.message);root.firstChild.append(button('새 설문 확인하기',()=>location.reload(),'primary wide'));return;}if(e.status===409){message('이번 조사에 이미 참여하셨습니다.','응답이 정상적으로 접수된 병원입니다. 참여해 주셔서 감사합니다.',true);return;}error.textContent=e.message;actions.querySelectorAll('button').forEach(b=>b.disabled=false);next.textContent=submitText;}
  finally{busy=false;}
 });next.setAttribute('aria-label',step===def.questions.length-1?submitText:'다음');actions.append(next);p.append(options,extra,error,actions);if(q.type==='text')p.append(el('p','privacy','환자 정보나 개인 연락처 등 개인정보는 적지 말아 주세요.'));
 if(focus)title.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});
}
async function start(){try{
 if(!code||!/^[a-f0-9]{48}$/.test(code)){message('병원 전용 링크로 접속해 주세요.','안내 문자에 포함된 주소 또는 전달받은 QR로 접속하실 수 있습니다.');return;}
 context=await api('/public/resolve',{code});document.querySelector('.brand span').textContent=context.campaign.title;if(context.completed){message('이번 조사에 이미 참여하셨습니다.','참여해 주셔서 감사합니다. 소중한 의견을 제품과 서비스 개선에 참고하겠습니다.',true);return;}
 storageKey='baz-survey-draft:'+code+':'+context.campaign.id+':'+context.campaign.definition.version;submissionId=crypto.randomUUID();try{const draft=JSON.parse(sessionStorage.getItem(storageKey));if(draft&&typeof draft.answers==='object'&&draft.answers&&!Array.isArray(draft.answers)&&/^[a-f0-9-]{36}$/.test(draft.submissionId)){answers=draft.answers;step=Math.max(0,Math.min(context.campaign.definition.questions.length-1,Number(draft.step)||0));submissionId=draft.submissionId;}}catch{}welcome();
 }catch(e){message('설문을 확인해 주세요.',e.message);if(![404,410].includes(e.status))root.firstChild.append(button('다시 확인',start,'primary wide'));}}
start();
