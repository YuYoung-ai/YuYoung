/************************************************************
 * 상세 분석 · 핸드피스 내부 세척 효과 분석 회귀 테스트
 * 실행: node test/dashboard-handpiece-cleaning.mjs
 ************************************************************/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const SRC=fs.readFileSync(path.join(HERE,'..','dashboard-pc.html'),'utf8');
let pass=0,total=0;const fails=[];
function ck(name,cond,detail=''){total++;if(cond)pass++;else fails.push(name+(detail?' — '+detail:''));console.log(cond?'✅':'❌',name,detail);}
function grab(name){
  const at=SRC.search(new RegExp('\\bfunction\\s+'+name.replace(/[$]/g,'\\$')+'\\s*\\('));
  if(at<0)throw new Error('함수 없음: '+name);let depth=0;
  for(let j=SRC.indexOf('{',at);j<SRC.length;j++){
    if(SRC[j]==='{')depth++;else if(SRC[j]==='}'&&--depth===0)return SRC.slice(at,j+1);
  }throw new Error('함수 끝 없음: '+name);
}
function grabVar(decl){const at=SRC.indexOf(decl);if(at<0)throw new Error('선언 없음: '+decl);return SRC.slice(at,SRC.indexOf('\n',at));}
const FNS=['esc','normD','nkey','skCmpKo_','rowDate','ymd','isDemoRecord','recScope','exToday',
  'hpCleanKey_','hpIsLeakVoc_','hpCleanVal_','isHandpieceCleaning_','hpCleanAsOf_','hpCleanDays_','hpCleanStatus_',
  'summarizeHandpieceCleanEvents_','buildHandpieceCleaningAnalysis_','filterHandpieceCleaningEvents_',
  'hpCleanTable_','hpCleanKpis_','hpCleanWarning_'];
const src=[grabVar('var DEMO_MARK='),...FNS.map(grab),'return {'+FNS.join(',')+'};'].join('\n');
const D=new Function(src)();
function rows(a){return a.map(r=>{const o=Object.assign({hosp:'',sn:'',fse:'',gubun:'A/S',type:'',part:'',detail:''},r);const d=D.normD(o.date);o._y=d.y;o._m=d.m;o._d=d.d;o._q=d.q;return o;});}

const cohort=rows([
  {date:'2026-08-01',hosp:'A병원',sn:'SN-1',fse:'김기사',type:'노즐 누수(약액 유입)',part:'내부 세척',detail:'내부 세척\nJET TEST 정상'},
  {date:'2026-08-01',hosp:'A병원',sn:'SN-1',fse:'김기사',type:'노즐누수(약액 유입)',part:'내부 세척',detail:'같은 날 추가 기록'},
  {date:'2026-08-02',hosp:'A병원',sn:'SN-2',fse:'이기사',type:'노즐누수(약액 유입)',part:'내부 세척',detail:'세척 완료'},
  {date:'2026-08-03',hosp:'B병원',sn:'',fse:'김기사',type:'노즐 누수(약액 유입)',part:'내부 세척',detail:'장비번호 미입력'},
  {date:'2026-08-04',hosp:'C병원',sn:'SN-3',type:'노즐 누수(약액 유입)',part:'내부 세척'},
  {date:'2026-08-05',hosp:'D병원',sn:'SN-4',type:'케이블 불량',part:'내부 세척'},
  {date:'2026-08-06',hosp:'E병원',sn:'SN-5',type:'노즐 누수(약액 유입)',part:"Handpiece Ass'y"},
  {date:'2026-08-07',hosp:'데모센터',sn:'D-1',type:'노즐 누수(약액 유입)',part:'내부 세척',detail:'[데모장비]\n내부 세척'}
]);
const later=rows([
  {date:'2026-08-01',hosp:'A병원',sn:'SN-1',type:'노즐 누수(약액 유입)',part:'내부 세척',detail:'같은 날 — 재발 아님'},
  {date:'2026-08-10',hosp:'A병원',sn:'SN-1',type:'노즐 누수(약액 유입)',detail:'동일 장비 재접수'},
  {date:'2026-08-08',hosp:'A병원',sn:'SN-9',type:'노즐 누수(약액 유입)',detail:'다른 장비'},
  {date:'2026-08-09',hosp:'B병원',sn:'B-2',type:'노즐 누수(약액 유입)',detail:'병원 단위 추정 재접수'},
  {date:'2026-08-15',hosp:'C병원',sn:'SN-3',type:'출력 약함',detail:'다른 VOC'},
  {date:'2026-09-05',hosp:'A병원',sn:'SN-2',type:'노즐 누수(약액 유입)',detail:'선택 기간 밖 후속 재접수'}
]);
const all=cohort.concat(later);
const A=D.buildHandpieceCleaningAnalysis_(cohort,all,'2026-09-10',new Date('2026-09-30T00:00:00'));

ck('1. 노즐 누수 + 내부 세척 + 고객 서비스만 세척 사례',A.events.length===5,'events='+A.events.length);
ck('2. VOC 유형 공백 차이는 같은 값으로 처리',cohort.slice(0,2).every(D.isHandpieceCleaning_));
ck('3. 다른 VOC의 내부 세척 제외',!A.events.some(e=>e.hosp==='D병원'));
ck('4. 실제 교체품 기록 제외',!A.events.some(e=>e.hosp==='E병원'));
ck('5. 데모 운영 기록 제외',!A.events.some(e=>e.hosp==='데모센터'));
ck('6. 같은 병원·날짜 복수 세척은 원본 행대로 유지',A.events.filter(e=>e.hosp==='A병원'&&D.ymd(e.cleanDate)==='2026-08-01').length===2);

const sn1=A.events.find(e=>e.sn==='SN-1');
const sn2=A.events.find(e=>e.sn==='SN-2');
const b=A.events.find(e=>e.hosp==='B병원');
const c=A.events.find(e=>e.hosp==='C병원');
ck('7. 같은 날 동일 VOC는 재발에서 제외',D.ymd(sn1.recurrenceDate)==='2026-08-10');
ck('8. 동일 병원·동일 장비·동일 VOC만 재발',sn1.recurrence&&sn1.days===9);
ck('9. 다른 장비번호의 동일 VOC는 재발 아님',D.ymd(sn2.recurrenceDate)==='2026-09-05');
ck('10. 선택 기간 밖 후속 기록도 RAW 전체에서 재발 검색',sn2.recurrence&&sn2.days===34);
ck('11. 장비번호 미입력은 병원 단위 추정',b.recurrence&&b.confidence==='병원 단위 추정'&&D.ymd(b.recurrenceDate)==='2026-08-09');
ck('12. 다른 VOC 유형은 재발 아님',!c.recurrence&&c.days===37);
ck('13. 재발/14일/30일 상태 구간',sn1.status==='재발'&&c.status==='30일 이상 무재발');
ck('14. 데이터 품질에 장비번호 미입력 포함',A.quality.some(q=>q.issue==='장비번호 미입력'&&q.event.hosp==='B병원'));
ck('15. 같은 병원·날짜 복수 세척 확인 항목 포함',A.quality.some(q=>q.issue==='같은 병원·같은 날짜 복수 세척'));

const clamped=D.buildHandpieceCleaningAnalysis_(cohort,all,'2026-12-31',new Date('2026-09-30T00:00:00'));
ck('16. 미래 기준일은 오늘로 제한',D.ymd(clamped.asOf)==='2026-09-30');
const early=D.buildHandpieceCleaningAnalysis_(cohort,all,'2026-08-05',new Date('2026-09-30T00:00:00'));
ck('17. 기준일 뒤 세척 사례와 재발 기록 제외',early.events.every(e=>e.cleanDate<=early.asOf)&&early.summary.recurrence===0);

ck('18. 상태 필터',D.filterHandpieceCleaningEvents_(A.events,{status:'recur'}).every(e=>e.recurrence));
ck('19. 병원·장비번호·처리 내용 검색',
  D.filterHandpieceCleaningEvents_(A.events,{q:'C병원'}).length===1&&
  D.filterHandpieceCleaningEvents_(A.events,{q:'SN-2'}).length===1&&
  D.filterHandpieceCleaningEvents_(A.events,{q:'JET TEST'}).length===1);
ck('20. 병원 단위 추정 필터',D.filterHandpieceCleaningEvents_(A.events,{status:'estimated'}).length===1);

const table=D.hpCleanTable_(A.events);
ck('21. 표에 근거 열과 처리 내용 표시',
  ['세척일','병원','장비번호','담당자','처리 내용','경과일','이후 동일 VOC','판정 기준','상태','JET TEST 정상'].every(x=>table.includes(x)));
ck('22. 카드 DOM과 Excel 생성 버튼 존재',/id="hpCleanCard"/.test(SRC)&&/id="hpCleanExport"/.test(SRC));
ck('23. 상세 분석 렌더러가 카드 렌더 호출',/renderHandpieceCleaningCard_\(rows\)/.test(grab('renderDetailedDashboard')));
ck('24. Excel은 카드에 표시된 필터 결과를 사용',/var events=HP_CLEAN_STATE\.shown\|\|\[\]/.test(grab('exportHandpieceCleaningExcel')));
ck('25. Excel 4개 시트 생성',
  ['분석 요약','세척 경과 상세','재발 이력','데이터 품질'].every(n=>SRC.includes("addWorksheet('"+n+"'")));
ck('26. Excel에 자동 필터·고정 헤더·날짜 형식',/autoFilter/.test(grab('exportHandpieceCleaningExcel'))&&/state:'frozen'/.test(grab('exportHandpieceCleaningExcel'))&&/yyyy-mm-dd/.test(grab('exportHandpieceCleaningExcel')));
ck('27. 요약 수치는 상세 시트 참조 수식과 결과값 포함',/formula:/.test(grab('exportHandpieceCleaningExcel'))&&/result:summary\./.test(grab('exportHandpieceCleaningExcel')));
ck('28. Excel 파일명에 세척 기간·기준일 포함',/핸드피스_내부세척_효과분석_/.test(grab('exportHandpieceCleaningExcel'))&&/기준일/.test(grab('exportHandpieceCleaningExcel')));
ck('29. 기존 교체품 집계와 PPT 로직은 분석 함수에서 변경하지 않음',
  !/exDim|buildExecutiveReportSnapshot|buildExecutivePptDeck/.test(grab('buildHandpieceCleaningAnalysis_')));

const missingHospRows=rows([{date:'2026-08-01',hosp:'',sn:'SN-X',type:'노즐 누수(약액 유입)',part:'내부 세척',detail:'병원명 누락'}]);
const missing=D.buildHandpieceCleaningAnalysis_(missingHospRows,missingHospRows,'2026-09-10',new Date('2026-09-30T00:00:00'));
ck('30. 병원명 누락 사례는 재접수 없음 통계에서 제외하고 판정 불가',
  missing.events[0].status==='판정 불가'&&missing.summary.evaluable===0&&missing.summary.noRecurrence===0);
ck('31. 병원명 누락은 데이터 품질과 화면 경고에 표시',
  missing.quality.some(q=>q.issue==='병원명 미입력')&&D.hpCleanWarning_(missing.summary).includes('판정하지 않았습니다'));
ck('32. Excel 요약 수식도 판정 불가 사례를 무재발 통계에서 제외',
  /COUNTIFS\([^\n]+판정 불가/.test(grab('exportHandpieceCleaningExcel'))&&/재접수 없음 \/ 판정 가능 사례/.test(grab('exportHandpieceCleaningExcel')));

console.log('\n──────────────────────────────');console.log(`통과 ${pass}/${total}`);
if(fails.length){console.log('실패:');fails.forEach(x=>console.log(' -',x));process.exit(1);}console.log('모든 테스트 통과 ✅');
