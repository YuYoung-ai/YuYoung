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
export function validateAnswers(def,input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('답변을 확인해 주세요.');
 const allowed=new Set(def.questions.map(q=>q.id).concat('sourceOther'));
 if(Object.keys(input).some(k=>!allowed.has(k)))throw Error('설문에 없는 답변이 포함되어 있습니다.');
 const out={};
 for(const q of def.questions){const v=input[q.id];
  if(q.type==='single'){if(!q.options.includes(v))throw Error('응답하지 않은 문항이 있습니다.');out[q.id]=v;}
  else if(q.type==='multiple'){if(!Array.isArray(v)||!v.length||v.length>q.options.length||new Set(v).size!==v.length||v.some(x=>!q.options.includes(x)))throw Error('구입 이유를 하나 이상 선택해 주세요.');out[q.id]=q.options.filter(x=>v.includes(x));}
  else if(q.type==='rating'){if(!Number.isInteger(v)||v<1||v>5)throw Error('만족도를 1~5점 중 선택해 주세요.');out[q.id]=v;}
  else if(q.type==='text'){if(v!==undefined&&typeof v!=='string')throw Error('의견 내용을 확인해 주세요.');out[q.id]=(v||'').trim();if(out[q.id].length>q.max)throw Error('의견은 '+q.max+'자 이내로 작성해 주세요.');}
  else throw Error('설문 버전을 확인해 주세요.');
 }
 if(input.sourceOther!==undefined&&typeof input.sourceOther!=='string')throw Error('기타 경로를 확인해 주세요.');
 out.sourceOther=out.source==='기타'?(input.sourceOther||'').trim():'';
 if(out.sourceOther.length>100)throw Error('기타 경로는 100자 이내로 작성해 주세요.');
 return out;
}
