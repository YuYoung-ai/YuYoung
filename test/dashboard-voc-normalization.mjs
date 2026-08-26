/* 로딩부터 원인 분석·누수 분석·처리이력까지 누수 VOC 표기 통일 회귀 테스트.
   실행: node test/dashboard-voc-normalization.mjs */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src=fs.readFileSync(new URL('../dashboard-pc.html',import.meta.url),'utf8');
function grab(name){
  const at=src.indexOf('function '+name+'(');
  if(at<0)throw new Error('함수 없음: '+name);
  let depth=0;
  for(let i=src.indexOf('{',at);i<src.length;i++){
    if(src[i]==='{')depth++;
    else if(src[i]==='}'&&--depth===0)return src.slice(at,i+1);
  }
  throw new Error('함수 끝 없음: '+name);
}
const names=['boot','normD','costNum','paidType_','hpCleanKey_','hpIsLeakVoc_',
  'isOK','exDim','exDimCompare','exVocTypeCompare_','exHistoryRows_'];
// UI·병원 DB 결합만 대체하고 실제 boot/집계/이력 함수 원문을 실행한다.
const D=new Function(`
  var RAW=[], DATA_READY=false, calls=[];
  var document={getElementById:function(){return {style:{},textContent:''};}};
  function enrichNcare(){} function applyViewVisibility(){} function initCombos(){}
  function initExecFilterBar(){} function ncareCheck(){}
  function buildFilters(){calls.push(RAW.map(function(r){return r.type;}));}
  function apply(){}
  ${names.map(grab).join('\n')}
  return {${names.join(',')},rows:function(){return RAW;},calls:calls};
`)();
const canonical='노즐 누수(약액 유입)';
const types=[canonical,'노즐누수(약액유입)',' 노즐 누수 ( 약액 유입 ) ',
  '노즐\t누수(약액\u00a0유입)','노즐 누수','케이블 불량','',null];
let pass=0;
function ck(name,actual,expected){assert.deepEqual(actual,expected,name);pass++;console.log('✅ '+name);}
for(const fromCache of [false,true]){
  const label=fromCache?'캐시':'서버';
  const data=types.map((type,i)=>({type,date:'2026-08-10',hosp:'A병원',gubun:i===2?'점검':'A/S'}));
  D.boot({data,updated:'test'},fromCache);
  const rows=D.rows();
  ck(label+': 공백·괄호 주변·탭·NBSP 변형을 표준 이름으로 통일',rows.slice(0,4).map(r=>r.type),Array(4).fill(canonical));
  ck(label+': 괄호 없는 노즐 누수·다른 유형·빈 값은 그대로 유지',rows.slice(4).map(r=>r.type),types.slice(4));
  ck(label+': 원본 기록 수를 줄이거나 중복 추가하지 않음',rows.length,types.length);
  ck(label+': 필터 UI를 만들기 전에 표준화 완료',D.calls.at(-1),rows.map(r=>r.type));
  const cause=D.exVocTypeCompare_(rows,null).filter(t=>t.k===canonical);
  ck(label+': 원인 분석에 하나의 항목으로 A/S·점검 4건 합산',cause.map(t=>t.cur),[4]);
  ck(label+': 원인 분석과 누수 분석의 건수 일치',cause[0].cur,rows.filter(D.hpIsLeakVoc_).length);
  ck(label+': 표준 항목의 처리이력에 모든 공백 변형 포함',D.exHistoryRows_(rows,'type',canonical,false).length,4);
  ck(label+': A/S 전용 이력은 기존 구분 기준 유지',D.exHistoryRows_(rows,'type',canonical,true).length,3);
  ck(label+': 괄호 없는 노즐 누수는 별도 처리이력 유지',D.exHistoryRows_(rows,'type','노즐 누수',false).length,1);
}
const current=D.rows();
D.boot({data:[{type:'노즐누수(약액유입)',date:'2026-08-03'}]},false);
const previous=D.rows();
const comparison=D.exVocTypeCompare_(current,previous).find(t=>t.k===canonical);
ck('이전 기간도 같은 표준 이름으로 비교',comparison,{k:canonical,cur:4,prev:1,d:3});
ck('이전 기간 처리이력과 비교 건수 일치',D.exHistoryRows_(previous,'type',canonical,false).length,comparison.prev);
console.log(`통과 ${pass}/${pass}`);
