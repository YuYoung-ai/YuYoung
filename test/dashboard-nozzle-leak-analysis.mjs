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
  'nlDateLabel_','nozStateMap_','buildSkillData','nlLatestStates_','nlSummarizeGroup_',
  'buildNozzleLeakAnalysis_','buildNozzleData','buildNozzleStatusMap','nzNcare_','nlIsRiskGroup_',
  'nlHeatRate_','nlHeatLowestRate_'];
const D=new Function(FNS.map(grab).join('\n')+'\nreturn {'+FNS.join(',')+'};')();
const basisUI=new Function(['esc','exNum','nlKpiHtml_','exShowLeakBasis_'].map(grab).join('\n')
  +'\nvar lastModal; function openExList(title,sub,html){lastModal={title,sub,html};}'
  +'\nfunction exPeriodLabel(){return "2026.08.10~08.14";}'
  +'\nreturn {card:nlKpiHtml_,open:function(){exShowLeakBasis_();return lastModal;}};')();
const totalCard=basisUI.card('노즐 누수(약액 유입)',5,false,true),basis=basisUI.open();
ck('집계 기준: 전체 누수 카드에 짧은 안내와 키보드 접근 가능한 버튼 제공',
  totalCard.includes('<b>5<u>건</u></b>')&&totalCard.includes('처리기록 합계 · 띄어쓰기 통합')
  &&totalCard.includes('type="button"')&&totalCard.includes('aria-label="노즐 누수 건수 집계 기준 보기"'));
ck('집계 기준: 다른 그룹 KPI에는 전체 합계 설명을 중복 표시하지 않음',
  !basisUI.card('재사용',2,false).includes('nl-kpi-basis')
  &&grab('renderExecutiveLeak').includes("nlKpiHtml_('노즐 누수(약액 유입)',A.leaks,false,true)"));
ck('집계 기준: 현재 선택 기간을 기존 공통 안내창에 표시',basis.sub==='선택 기간: 2026.08.10~08.14'&&basis.title.includes('집계 기준'));
ck('집계 기준: 기록 단위·표기 통합·미평가 포함·기간 밖 제외 설명',
  ['처리기록 1행 = 1건','재방문·복수 기록','괄호 없는','미평가 기록도 전체 건수에 포함','기간 밖 기록은 건수에 미포함'].every(t=>basis.html.includes(t)));
ck('집계 기준: 적용 필터와 원인 분석과의 차이를 명시',
  ['유/무상','영업 담당자','VOC 유형·노즐 재사용·교육 상태 필터는 적용하지 않습니다','원인 분석 탭과는 건수가 다를 수 있습니다'].every(t=>basis.html.includes(t)));
ck('집계 기준: 안내를 여는 동작에는 추가 조회나 재집계 없음',
  !/fetch\(|loadData\(|buildNozzleLeakCurrent_\(/.test(grab('exShowLeakBasis_')));
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
const lowRate=D.nlHeatLowestRate_([
  {hospitals:4,affected:4},{hospitals:5,affected:1},{hospitals:3,affected:0},{hospitals:0,affected:0}
]);
ck('27-1. 평가 병원이 있는 비교 그룹 중 최저 발생 비율을 계산',lowRate===0,'lowest='+lowRate);
ck('27-2. 모든 비교 그룹의 비율이 같으면 최저 표시를 생략',
  D.nlHeatLowestRate_([{hospitals:2,affected:1},{hospitals:4,affected:2}])===null);
ck('27-3. 최저 동률은 같은 최저값으로 함께 표시 가능',
  D.nlHeatLowestRate_([{hospitals:2,affected:0},{hospitals:3,affected:0},{hospitals:2,affected:1}])===0);
ck('27-4. 최저 셀에 청록색 테두리·최저 꼬리표와 다크모드 색상을 제공',
  grab('nlHeatHtml_').includes("lowest?' lowest':'")&&grab('nlHeatHtml_').includes('nl-low-mark">최저')
  &&/\.nl-heat\.lowest\{border-color:#168574;/.test(SRC)
  &&/body\.dark \.nl-heat\.lowest\{border-color:#58C7B2;/.test(SRC));
ck('27-5. 교차 카드 네 칸에 같은 최저 기준을 전달',
  (grab('renderExecutiveLeak').match(/nlHeatHtml_\([^)]*,lowestRate\)/g)||[]).length===4
  &&grab('renderExecutiveLeak').includes('var lowestRate=nlHeatLowestRate_(cells)'));

/* ── ③ 관리 대상 카드·노즐/교육 필터와 ④ 누수 분석 탭이 같은 기준을 쓰는지 ──
   예전에는 ③이 "한 번이라도 O 면 재사용"·"같은 날짜는 먼저 기록된 평가",
   ④가 "마지막 유효 평가"라서 같은 병원이 두 탭에서 다른 그룹으로 잡혔다. */
const uni=rows([
  {date:'2026-08-01',hosp:'P병원',nozzleReuse:'O',ncare:'N-Care'},
  {date:'2026-08-10',hosp:'P병원',nozzleReuse:'X',ncare:'N-Care'},   /* 개선 → 마지막 평가는 X */
  {date:'2026-08-02',hosp:'Q병원',nozzleReuse:'X',ncare:'미가입'},
  {date:'2026-08-11',hosp:'Q병원',nozzleReuse:'O',ncare:'미가입'},   /* 악화 → 마지막 평가는 O */
  {date:'2026-08-05',hosp:'R병원',nsFill:'X',ncare:'미가입'},        /* 같은 날 먼저 기록: 미흡 */
  {date:'2026-08-05',hosp:'R병원',nsFill:'O',nsAmt:'적정',jet:'정상',ncare:'미가입'},
  {date:'2026-08-12',hosp:'P병원',type:'노즐 누수(약액 유입)',ncare:'N-Care'}
]);
const uniNz=D.buildNozzleStatusMap(uni),uniSk=D.buildSkillData(uni).status;
const uniA=D.buildNozzleLeakAnalysis_(uni,uni,20260831);
const dOf=h=>uniA.details.find(x=>x.hosp===h);
const uniData=D.buildNozzleData(uni);

ck('28. 개선된 병원을 ③·④ 모두 재사용에서 제외',
  uniNz['p병원']==='noreuse'&&dOf('P병원').nozzle==='single',
  '③='+uniNz['p병원']+' ④='+dOf('P병원').nozzle);
ck('29. 악화된 병원을 ③·④ 모두 재사용으로 판정',
  uniNz['q병원']==='reuse'&&dOf('Q병원').nozzle==='reuse',
  '③='+uniNz['q병원']+' ④='+dOf('Q병원').nozzle);
ck('30. 같은 날짜 교육평가는 ③·④ 모두 나중 기록을 적용',
  uniSk['r병원']==='good'&&dOf('R병원').skill==='good',
  '③='+uniSk['r병원']+' ④='+dOf('R병원').skill);
ck('31. 재사용률·명단도 마지막 평가 기준을 따른다',
  uniData.joined.total===1&&uniData.joined.reuse===0
  &&uniData.nonJoined.reuse===1&&uniData.nonJoined.hospitals[0]==='Q병원',
  JSON.stringify(uniData));
ck('32. 노즐 판정을 한 함수(nozStateMap_)로만 내린다',
  grab('buildNozzleData').includes('nozStateMap_(rows)')
  &&grab('buildNozzleStatusMap').includes('nozStateMap_(rows)')
  &&grab('nlLatestStates_').includes('nozStateMap_(within,asOfKey)')
  &&!/한 번이라도 'O' 면 재사용/.test(SRC));
ck('33. 종료일 이후 평가는 ④ 안에서도 과거 상태를 바꾸지 않는다',
  grab('nlLatestStates_').includes('nlDateKey_(r)<=asOfKey')
  &&grab('nlLatestStates_').includes('buildSkillData(within)'));

console.log('\n──────────────────────────────');console.log(`통과 ${pass}/${total}`);
if(fails.length){console.log('실패:');fails.forEach(x=>console.log(' -',x));process.exit(1);}console.log('모든 테스트 통과 ✅');
