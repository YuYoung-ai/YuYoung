export const DEFINITION={version:'2026-10-v1',title:'고객만족도 조사',intro:'서비스 개선을 위한 의견을 들려주세요.',questions:[
 {id:'source',type:'single',title:'당사를 어떤 경로로 알게 되셨습니까?',required:true,options:['전시회','카탈로그','지인 소개','기타']},
 {id:'purchase',type:'multiple',title:'당사 제품을 구입하신 이유는 무엇입니까?',required:true,options:['품질','가격','기능과 사양','디자인']},
 {id:'price',type:'rating',title:'동종업계 제품과 비교했을 때, 당사 제품의 가격에 얼마나 만족하십니까?',required:true},
 {id:'quality',type:'rating',title:'사용하신 제품의 품질에 얼마나 만족하십니까?',required:true},
 {id:'delivery',type:'rating',title:'제품의 납기 준수에 얼마나 만족하십니까?',required:true},
 {id:'service',type:'rating',title:'당사의 서비스에 얼마나 만족하십니까?',required:true},
 {id:'usability',type:'rating',title:'제품의 사용 편의성에 얼마나 만족하십니까?',required:true},
 {id:'comment',type:'text',title:'제품이나 서비스에서 바라는 점을 편하게 들려주세요.',required:false,hint:'짧은 한마디도 좋습니다. 남겨주신 의견은 담당자가 확인하고 제품과 서비스 개선에 참고하겠습니다.',placeholder:'좋았던 점이나 아쉬웠던 점, 앞으로 바라는 점을 자유롭게 적어주세요.',max:1000}
]};
export const SCALE=['매우 불만족','불만족','보통','만족','매우 만족'];
export function otherOption(q){return q.otherOption||(q.id==='source'&&q.options?.includes('기타')?'기타':null);}
export function otherKey(q){return q.id==='source'?'sourceOther':q.id+'Other';}
export function validateDefinition(input){
 if(!input||!Array.isArray(input.questions)||input.questions.length<1||input.questions.length>30)throw Error('문항은 1~30개로 구성해 주세요.');
 const text=(v,max,label)=>{if(typeof v!=='string'||v.trim().length>max)throw Error(label+' 내용을 확인해 주세요.');return v.trim();};
 const out={version:'custom',title:'고객만족도 조사',intro:text(input.intro??DEFINITION.intro,1000,'설문 안내'),questions:[]},keys=new Set();
 for(const [i,raw]of input.questions.entries()){
  if(!raw||typeof raw.id!=='string'||!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(raw.id)||['constructor','prototype','sourceOther'].includes(raw.id)||keys.has(raw.id))throw Error('문항 식별자가 올바르지 않습니다.');
  const q={id:raw.id,type:raw.type,title:text(raw.title,300,`${i+1}번 문항`),required:raw.required!==false};keys.add(q.id);
  if(!q.title||!['single','multiple','rating','text'].includes(q.type))throw Error(`${i+1}번 문항의 제목과 응답 방식을 확인해 주세요.`);
  if(['single','multiple'].includes(q.type)){
   if(!Array.isArray(raw.options)||raw.options.length<2||raw.options.length>12)throw Error(`${i+1}번 선택지는 2~12개로 입력해 주세요.`);
   q.options=raw.options.map(v=>text(v,80,`${i+1}번 선택지`));if(q.options.some(v=>!v)||new Set(q.options).size!==q.options.length)throw Error(`${i+1}번 선택지의 빈 항목이나 중복을 확인해 주세요.`);
   if(raw.otherOption){if(!q.options.includes(raw.otherOption))throw Error('기타 입력 항목을 선택지에 포함해 주세요.');q.otherOption=raw.otherOption;}
  }
  if(q.type==='text'){q.max=raw.max??1000;if(!Number.isInteger(q.max)||q.max<1||q.max>2000)throw Error('서술형 글자 수는 1~2,000자로 설정해 주세요.');q.placeholder=text(raw.placeholder??'',300,'입력란 안내');}
  if(raw.hint)q.hint=text(raw.hint,500,'보조 안내');out.questions.push(q);
 }
 for(const q of out.questions)if(otherOption(q)){const key=otherKey(q);if(keys.has(key))throw Error('기타 입력란과 문항 식별자가 겹칩니다.');keys.add(key);}
 return out;
}
export function validateAnswer(q,value){
 const empty=value===undefined||value===null||value===''||(Array.isArray(value)&&!value.length);
 if(empty){if(q.required)throw Error(q.type==='text'?'내용을 입력해 주세요.':'해당하는 항목을 선택해 주세요.');return q.type==='multiple'?[]:q.type==='rating'?null:'';}
 if(q.type==='single'){if(!q.options.includes(value))throw Error('선택한 항목을 확인해 주세요.');return value;}
 if(q.type==='multiple'){if(!Array.isArray(value)||value.length>q.options.length||new Set(value).size!==value.length||value.some(x=>!q.options.includes(x)))throw Error('중복 없이 해당하는 항목을 선택해 주세요.');return q.options.filter(x=>value.includes(x));}
 if(q.type==='rating'){if(!Number.isInteger(value)||value<1||value>5)throw Error('만족도를 1~5점 중 선택해 주세요.');return value;}
 if(q.type==='text'){if(typeof value!=='string'||value.length>q.max)throw Error('내용은 '+q.max+'자 이내로 작성해 주세요.');const v=value.trim();if(q.required&&!v)throw Error('내용을 입력해 주세요.');return v;}
 throw Error('설문 버전을 확인해 주세요.');
}
export function validateAnswers(def,input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('답변을 확인해 주세요.');
 const allowed=new Set(def.questions.flatMap(q=>otherOption(q)?[q.id,otherKey(q)]:[q.id]));
 if(Object.keys(input).some(k=>!allowed.has(k)))throw Error('설문에 없는 답변이 포함되어 있습니다.');
 const out={};
 for(const q of def.questions)out[q.id]=validateAnswer(q,input[q.id]);
 for(const q of def.questions){if(!otherOption(q))continue;const key=otherKey(q),v=input[key];if(v!==undefined&&typeof v!=='string')throw Error('기타 내용을 확인해 주세요.');const selected=Array.isArray(out[q.id])?out[q.id].includes(otherOption(q)):out[q.id]===otherOption(q);out[key]=selected?(v||'').trim():'';if(out[key].length>100)throw Error('기타 내용은 100자 이내로 작성해 주세요.');
 }
 return out;
}
