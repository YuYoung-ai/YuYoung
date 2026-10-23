import {el,button} from './baz-survey-api.mjs';
import {DEFINITION,SCALE,validateDefinition,otherOption} from './baz-survey-schema.mjs';
const types=[['single','단일 선택'],['multiple','복수 선택'],['rating','5점 만족도'],['text','서술형']];
export function createBuilder({root,titleInput,introInput,heading,count,onStatus}){
 let questions=structuredClone(DEFINITION.questions),editing=null,dirty=false;
 introInput.value=DEFINITION.intro;
 function field(label,input){const n=el('label','field',label);n.append(input);return n;}
 function change(){dirty=true;}
 titleInput.addEventListener('input',change);introInput.addEventListener('input',change);
 function draw(){root.replaceChildren();count.textContent=questions.length+'문항';heading.textContent=editing?'등록한 초안 문항 수정':'새 조사 만들기';
  questions.forEach((q,i)=>{const card=el('article','question-card'),head=el('div','section-heading'),controls=el('div','mini-actions');head.append(el('strong','',`문항 ${i+1}`));
   const up=button('↑ 위로',()=>move(i,-1),'secondary'),down=button('↓ 아래로',()=>move(i,1),'secondary');up.disabled=i===0;down.disabled=i===questions.length-1;controls.append(up,down,button('삭제',()=>{if(questions.length===1){onStatus('최소 한 문항은 남겨 주세요.',true);return;}questions.splice(i,1);change();draw();},'danger'));head.append(controls);
   const title=el('textarea');title.rows=2;title.maxLength=300;title.value=q.title;title.addEventListener('input',()=>{q.title=title.value;change();});
   const type=el('select');type.setAttribute('aria-label',`${i+1}번 응답 방식`);for(const [v,t]of types){const o=el('option','',t);o.value=v;type.append(o);}type.value=q.type;type.addEventListener('change',()=>{q.type=type.value;if(['single','multiple'].includes(q.type)&&!q.options)q.options=['선택지 1','선택지 2'];if(q.type==='text'){q.max=q.max||1000;q.placeholder=q.placeholder||'';}if(!['single','multiple'].includes(q.type))delete q.otherOption;change();draw();});
   const required=el('input');required.type='checkbox';required.checked=!!q.required;required.addEventListener('change',()=>{q.required=required.checked;change();});const req=el('label','checkline');req.append(required,document.createTextNode('필수 응답'));
   const row=el('div','question-controls');row.append(field(`${i+1}번 응답 방식`,type),req);card.append(head,field(`${i+1}번 질문`,title),row);
   if(['single','multiple'].includes(q.type)){
    const options=el('textarea');options.rows=4;options.value=(q.options||[]).join('\n');options.addEventListener('input',()=>{q.options=options.value.split('\n');change();});card.append(field(`${i+1}번 선택지 (한 줄에 하나씩 · 2~12개)`,options));
    const other=el('input');other.type='checkbox';other.checked=!!otherOption(q);other.addEventListener('change',()=>{if(other.checked){q.otherOption='기타';if(!q.options.includes('기타'))q.options.push('기타');}else{delete q.otherOption;if(q.id==='source')q.id='q_'+crypto.randomUUID().replaceAll('-','').slice(0,16);}change();draw();});const label=el('label','checkline');label.append(other,document.createTextNode('‘기타’ 선택 시 추가 입력란 표시'));card.append(label);
   }else if(q.type==='rating')card.append(el('p','help',SCALE.join(' / ')));
   const advanced=el('details'),summary=el('summary','','보조 안내 설정');advanced.append(summary);const hint=el('textarea');hint.rows=2;hint.maxLength=500;hint.value=q.hint||'';hint.addEventListener('input',()=>{q.hint=hint.value;change();});advanced.append(field(`${i+1}번 보조 안내`,hint));
   if(q.type==='text'){const placeholder=el('input');placeholder.type='text';placeholder.maxLength=300;placeholder.value=q.placeholder||'';placeholder.addEventListener('input',()=>{q.placeholder=placeholder.value;change();});const max=el('input');max.type='number';max.min=1;max.max=2000;max.value=q.max||1000;max.addEventListener('input',()=>{q.max=Number(max.value);change();});advanced.append(field(`${i+1}번 입력란 안내`,placeholder),field(`${i+1}번 최대 글자 수`,max));}card.append(advanced);root.append(card);
  });
 }
 function move(i,by){[questions[i],questions[i+by]]=[questions[i+by],questions[i]];change();draw();}
 function load(def,title='',edit=null){questions=structuredClone(def.questions);titleInput.value=title;introInput.value=def.intro||'';editing=edit;dirty=false;draw();}
 function add(){if(questions.length>=30){onStatus('문항은 최대 30개까지 만들 수 있습니다.',true);return;}questions.push({id:'q_'+crypto.randomUUID().replaceAll('-','').slice(0,16),type:'single',title:'',required:true,options:['선택지 1','선택지 2']});change();draw();root.lastChild.scrollIntoView({behavior:'smooth',block:'center'});root.lastChild.querySelector('textarea').focus({preventScroll:true});}
 function definition(){return validateDefinition({intro:introInput.value,questions:questions.map(q=>({...q,...(q.options?{options:q.options.map(s=>s.trim()).filter(Boolean)}:{})}))});}
 function preview(container){const def=definition();container.replaceChildren(el('h3','',titleInput.value||'고객만족도 조사'),el('p','help',def.intro));for(const [i,q]of def.questions.entries()){const n=el('article','preview-question');n.append(el('h3','',`Q${i+1}. ${q.title}`),el('span','badge',q.required?'필수':'선택'));if(q.hint)n.append(el('p','help',q.hint));if(q.type==='text'){const t=el('textarea');t.placeholder=q.placeholder;t.disabled=true;n.append(t);}else{const choices=q.type==='rating'?SCALE:q.options;for(const text of choices){const label=el('label','choice'),input=el('input');input.type=q.type==='multiple'?'checkbox':'radio';input.disabled=true;label.append(input,document.createTextNode(text));n.append(label);}}container.append(n);}}
 draw();window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
 return {load,add,definition,preview,get editing(){return editing;},get dirty(){return dirty;},saved(){dirty=false;}};
}
