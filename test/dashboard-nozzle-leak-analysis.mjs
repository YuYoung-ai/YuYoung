/************************************************************
 * 보고 모드 · 노즐 누수 연관 분석 회귀 테스트
 * 실행: node test/dashboard-nozzle-leak-analysis.mjs
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
const FNS=['normD','skNorm_','skCmpKo_','hpCleanKey_','hpIsLeakVoc_','nlDateKey_','nlYmdKey_',
  'nlDateLabel_','nlEducationState_','nlLatestStates_','nlSummarizeGroup_','buildNozzleLeakAnalysis_','nlIsRiskGroup_'];
const D=new Function(FNS.map(grab).join('\n')+'\nreturn {'+FNS.join(',')+'};')();
function rows(a){return a.map(r=>{const o=Object.assign({hosp:'',type:'',nozzleReuse:'',nsFill:'',nsAmt:'',jet:''},r);const d=D.normD(o.date);o._y=d.y;o._m=d.m;o._d=d.d;o._q=d.q;return o;});}

const cohort=rows([
  {date:'2026-08-20',hosp:'A병원',type:'노즐 누수(약액 유입)'},
  {date:'2026-08-20',hosp:'B병원',type:'노즐누수(약액유입)'},
  {date:'2026-08-21',hosp:'B병원',type:' 노즐 누수 (약액 유입) '},
  {date:'2026-08-22',hosp:'C병원',type:'케이블 불량'},
  {date:'2026-08-23',hosp:'D병원',type:'노즐 누수(약액 유입)'},
  {date:'2026-08-24',hosp:'E병원',type:'출력 약함'},
  {date:'2026-08-25',hosp:'F병원',type:'노즐 누수(약액 유입)'}
]);
const history=rows([
  {date:'2026-07-01',hosp:'A병원',nozzleReuse:'O',nsFill:'X'},
  {date:'2026-08-10',hosp:'A병원',nozzleReuse:'X',nsFill:'O',nsAmt:'적정',jet:'정상'},
  {date:'2026-08-03',hosp:'B병원',nozzleReuse:'O',nsFill:'X'},
  {date:'2026-08-04',hosp:'C병원',nozzleReuse:'X',nsAmt:'부족'},
  /* 같은 날짜에는 뒤에 기록된 평가가 최종 상태 */
  {date:'2026-08-05',hosp:'E병원',nozzleReuse:'O',nsFill:'X'},
  {date:'2026-08-05',hosp:'E병원',nozzleReuse:'X',nsFill:'O',nsAmt:'적정',jet:'정상'},
  {date:'2026-08-06',hosp:'F병원',nozzleReuse:'X',nsFill:'O',nsAmt:'적정',jet:'정상'},
  /* 분석 종료일 뒤 기록은 과거 상태를 바꾸면 안 된다 */
  {date:'2026-09-01',hosp:'F병원',nozzleReuse:'O',nsFill:'X'}
]).concat(cohort);
const A=D.buildNozzleLeakAnalysis_(cohort,history,20260831);

ck('1. 노즐 누수(약액 유입) 표기 공백 차이를 같은 VOC로 집계',A.leaks===5,'leaks='+A.leaks);
ck('1-1. 대상 VOC 판정을 내부 세척 분석과 같은 함수로 공유',
  !/function nlVocKey_|function nlIsLeak_/.test(SRC)&&grab('isHandpieceCleaning_').includes('hpIsLeakVoc_(r)')
  &&D.hpIsLeakVoc_({type:'노즐 누수(약액 유입)'})===true&&D.hpIsLeakVoc_({type:'노즐 누수'})===false);
ck('2. 선택 기간 방문 병원을 분모로 유지',A.hospitals===6,'hospitals='+A.hospitals);
ck('3. 병원별 마지막 노즐 평가를 사용',A.details.find(x=>x.hosp==='A병원').nozzle==='single');
ck('4. 같은 날짜는 뒤에 기록된 노즐 평가를 사용',A.details.find(x=>x.hosp==='E병원').nozzle==='single');
ck('5. 분석 종료일 뒤 평가는 제외',A.details.find(x=>x.hosp==='F병원').nozzle==='single');
ck('6. 병원별 마지막 교육 평가를 사용',A.details.find(x=>x.hosp==='A병원').skill==='good');
ck('7. 같은 날짜는 뒤에 기록된 교육 평가를 사용',A.details.find(x=>x.hosp==='E병원').skill==='good');
ck('8. 평가가 없는 병원은 미평가로 분리',A.details.find(x=>x.hosp==='D병원').nozzle==='unknown'&&A.details.find(x=>x.hosp==='D병원').skill==='none');
ck('9. 재사용 그룹 건수·병원당 건수',A.nozzle.reuse.hospitals===1&&A.nozzle.reuse.leaks===2&&A.nozzle.reuse.perHospital===2);
ck('10. 1회 사용 그룹 건수·병원당 건수',A.nozzle.single.hospitals===4&&A.nozzle.single.leaks===2&&A.nozzle.single.perHospital===0.5);
ck('11. 노즐 미평가 누수를 비교군에 강제 편입하지 않음',A.nozzle.unknown.hospitals===1&&A.nozzle.unknown.leaks===1);
ck('12. 교육 양호·미흡 그룹 분리',A.skill.good.hospitals===3&&A.skill.good.leaks===2&&A.skill.need.hospitals===2&&A.skill.need.leaks===2);
ck('13. 교육 미평가 누수 별도 집계',A.skill.none.hospitals===1&&A.skill.none.leaks===1);
ck('14. 재사용×교육 미흡 교차분석',A.matrix.reuse.need.hospitals===1&&A.matrix.reuse.need.leaks===2);
ck('15. 1회 사용×교육 양호 교차분석',A.matrix.single.good.hospitals===3&&A.matrix.single.good.leaks===2);
ck('16. 상세목록은 누수 건수 우선 정렬',A.details[0].hosp==='B병원'&&A.details[0].leaks===2);
ck('17. 평가일을 화면용 날짜로 보존',A.details.find(x=>x.hosp==='A병원').nozzleDate==='2026.08.10');

ck('18. 보고 모드에 ④ 누수 분석 탭과 전용 패널 존재',/data-tab="leak">④ 누수 분석/.test(SRC)&&/id="exPaneLeak"/.test(SRC));
ck('19. 탭 전환 허용 목록과 패널 맵에 leak 포함',grab('setExecTab').includes("'leak'")&&grab('setExecTab').includes("leak:'exPaneLeak'"));
ck('20. 활성 누수 탭만 전용 렌더러 호출',/if\(EX_TAB==='leak'\)\s+renderExecutiveLeak\(\)/.test(grab('renderExecutiveDashboard')));
ck('21. 전용 분석은 VOC 유형 필터를 제외',grab('buildNozzleLeakCurrent_').includes("ignoreType:true")&&grab('filteredRows_').includes('!ignoreType'));
ck('22. 원인 확정이 아닌 연관 경향 안내',grab('renderExecutiveLeak').includes('직접 원인을 확정하지 않습니다'));
ck('22-1. 집계 대상 VOC 범위를 화면에 명시',
  grab('renderExecutiveLeak').includes('대상 VOC는 핸드피스 ‘노즐 누수(약액 유입)’ 한 가지입니다'));
ck('23. 그래프와 교차표 클릭 시 병원 명단 연결',grab('renderExecutiveLeak').includes('nlBarsHtml_')&&grab('renderExecutiveLeak').includes('nlHeatHtml_')&&/function exShowLeakGroup/.test(SRC));
ck('24. 모바일에서 분석 영역을 한 열로 전환',/body\.ex-narrow \.nl-grid,body\.ex-narrow \.nl-bottom\{grid-template-columns:1fr\}/.test(SRC));
/* span 은 기본이 inline 이라 display:block 이 없으면 width·height 가 무시돼 막대가 0×0 으로 사라진다 */
ck('25. 비교 막대 트랙·채움을 블록으로 그린다',/\.nl-bar-track\{display:block;/.test(SRC)&&/\.nl-bar-fill\{display:block;/.test(SRC));
ck('26. 경고색을 배열 순서가 아닌 위험군 기준으로 부여',
  grab('nlBarsHtml_').includes('nlIsRiskGroup_(g.key)')&&!/i===1\?' alert'/.test(SRC)
  &&D.nlIsRiskGroup_('reuse')===true&&D.nlIsRiskGroup_('need')===true
  &&D.nlIsRiskGroup_('single')===false&&D.nlIsRiskGroup_('good')===false);
/* 배경만 덮으면 밝은 테두리가 어두운 셀 위에 남는다 */
ck('27. 다크모드 히트맵은 배경과 테두리를 함께 낮춘다',
  ['hot1','hot2','hot3','hot4'].every(c=>new RegExp('body\\.dark \\.nl-heat\\.'+c+'\\{background:#[0-9A-F]{6};border-color:#[0-9A-F]{6}\\}').test(SRC)));

console.log('\n──────────────────────────────');console.log(`통과 ${pass}/${total}`);
if(fails.length){console.log('실패:');fails.forEach(x=>console.log(' -',x));process.exit(1);}console.log('모든 테스트 통과 ✅');
