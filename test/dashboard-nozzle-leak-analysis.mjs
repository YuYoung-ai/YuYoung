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
  'nlHeatRate_','nlHeatLowestRate_','esc','escAttr','exNum','nlKpiDefs_','nlKpiData_','nlKpiHtml_'];
const D=new Function(FNS.map(grab).join('\n')+'\nreturn {'+FNS.join(',')
  +',addKpi:function(def){var base=nlKpiDefs_;nlKpiDefs_=function(){return base().concat([def]);};}};')();
ck('포함 안내: 별도 집계 기준 버튼과 설명 함수는 제거',!SRC.includes('exShowLeakBasis_')&&!SRC.includes('nl-kpi-basis'));
ck('포함 안내: 전체와 교차분석의 미평가 포함 여부를 구분',
  grab('nlKpiDefs_').includes('A/S·점검 포함 · 미평가 포함')&&!SRC.includes('구분 필터 선택 시 해당 구분만 집계')
  &&grab('renderExecutiveLeak').includes('두 평가가 모두 있는 병원만 분석 · 미평가 제외'));
ck('교차표 안내: 분석 대상 누수 비중을 제거하고 그룹 병원 대비 발생률만 사용',
  !SRC.includes('분석 대상 누수 중 비중')&&!SRC.includes('function nlHeatShare_')
  &&grab('renderExecutiveLeak').includes("bestText='그룹 병원 대비 발생 비율은 '")
  &&!grab('renderExecutiveLeak').includes('topShare'));
ck('교차표 우선순위: 큰 숫자는 그룹 병원 대비 발생 비율, 아래는 누수 건수',
  grab('nlHeatHtml_').includes("'<b>'+(a.hospitals? rate+'<u>%</u>'")
  &&grab('nlHeatHtml_').includes('<span class="sub">누수 ')
  &&grab('renderExecutiveLeak').includes('큰 숫자·색 = 그룹 병원 대비 발생 비율 · 아래 = 누수 건수'));
ck('확장: 카드 정의 목록이 렌더링과 이력 조회의 공통 진입점',
  grab('renderExecutiveLeak').includes('nlKpiDefs_().map')&&grab('exShowHistory_').includes('nlKpiData_(EX_LEAK_STATE||buildNozzleLeakCurrent_(),dim.slice(5))'));
ck('가독성: 제목 13px·수치 32px 고정, 카드 수 증가 시 줄바꿈·세로 스크롤',
  /\.nl-kpi \.nl-label\{[^}]*font-size:13px/.test(SRC)&&/\.nl-kpi b\{[^}]*font-size:32px/.test(SRC)
  &&/\.nl-kpis\{[^}]*repeat\(auto-fit,minmax\(220px,1fr\)\)/.test(SRC)
  &&/#exPaneLeak\{[^}]*minmax\(260px,[^}]*overflow-y:auto/.test(SRC));
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
const metrics=D.nlKpiDefs_().map(def=>D.nlKpiData_(A,def.key));
ck('이력: 5개 카드의 행 수가 기존 합계 및 그룹 집계와 일치',
  metrics.map(m=>m.value).join(',')===[A.leaks,A.nozzle.reuse.leaks,A.nozzle.single.leaks,A.skill.good.leaks,A.skill.need.leaks].join(','));
ck('이력: 원본 행을 유지해 같은 병원 복수 누수 기록을 각각 표시',
  D.nlKpiData_(A,'reuse').rows.length===2&&D.nlKpiData_(A,'reuse').rows[0]===cohort[1]);
ck('이력: 평가 기록·다른 VOC는 제외하고 선택 기간의 누수만 조회',
  metrics.every(m=>m.rows.every(r=>cohort.includes(r)&&D.hpIsLeakVoc_(r))));
ck('이력: 전체에는 미평가 포함, 평가 그룹에는 임의 편입하지 않음',
  D.nlKpiData_(A,'total').rows.some(r=>r.hosp==='D병원')&&metrics.slice(1).every(m=>!m.rows.some(r=>r.hosp==='D병원')));
ck('이력: 모든 카드가 표준 data-hist-dim 이벤트·네이티브 버튼을 사용',
  metrics.every(m=>{const html=D.nlKpiHtml_(m);return html.startsWith('<button type="button"')&&html.includes('data-hist-dim="leak:'+m.key+'"')&&!html.includes('onclick=');}));
ck('표기: 공백 통합 집계는 유지하되 안내에서 띄어쓰기 설명은 제외',
  metrics[0].value===5&&!D.nlKpiHtml_(metrics[0]).includes('띄어쓰기'));
ck('표기: 건수와 포함 안내를 같은 줄에 배치하고 좁을 때만 줄바꿈',
  D.nlKpiHtml_(metrics[0]).includes('<span class="nl-kpi-value"><b>5<u>건</u></b><span class="nl-kpi-meta">')
  &&/\.nl-kpi-value\{[^}]*display:flex[^}]*flex-wrap:wrap/.test(SRC));
ck('이력: 알 수 없는 카드 키는 전체 이력으로 확대하지 않고 차단',D.nlKpiData_(A,'not-a-card')===null);
const empty=D.buildNozzleLeakAnalysis_([],[],20260831);
ck('이력: 0건 카드도 동일한 필터 조회 버튼과 빈 목록 제공',
  D.nlKpiData_(empty,'total').value===0&&D.nlKpiData_(empty,'reuse').rows.length===0&&!D.nlKpiHtml_(D.nlKpiData_(empty,'need')).includes('disabled'));
D.addKpi({key:'unrated',label:'사용방식 미평가',group:['nozzle','unknown']});
const extra=D.nlKpiData_(A,'unrated');
ck('확장: 정의만 추가한 새 카드도 같은 행·건수·이력 버튼 생성',
  extra.value===A.nozzle.unknown.leaks&&extra.rows[0]===cohort[4]&&D.nlKpiHtml_(extra).includes('data-hist-dim="leak:unrated"'));

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
