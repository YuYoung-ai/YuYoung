/************************************************************
 * dashboard-card-history.mjs
 * 보고 모드 카드 항목 클릭 → 처리 이력 조회 회귀 테스트
 * 실행: node test/dashboard-card-history.mjs
 * ----------------------------------------------------------
 * 무빌드 헤드리스. dashboard-pc.html 에서 함수 원문을 그대로 꺼내 실행한다.
 * (test/dashboard-executive-ppt.mjs 와 같은 방식)
 *
 * 핵심 확인
 *   · 이력 필터는 카드 집계(exDim)와 완전히 같은 기준을 쓴다
 *     → 카드의 cur/prev 수치와 이력 배열 길이가 항상 일치한다(중복 제거 없음)
 *   · 현재 기간(x.rows)·비교 기간(x.prev)을 분리해 보여준다
 *   · 카드 클릭·모달 열기에는 fetch/GAS/loadData 가 없다
 *     (원본 행을 선택할 때만 정적 유형 예시 매니페스트를 최초 1회 읽는다)
 ************************************************************/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', 'dashboard-pc.html'), 'utf8');

let pass = 0, total = 0;
const fails = [];
const ck = (n, c, d) => {
  total++;
  if (c) pass++; else fails.push(n + (d ? ' — ' + d : ''));
  console.log((c ? '✅' : '❌'), n, d || '');
};

function grab(name) {
  const at = SRC.search(new RegExp('\\b(?:async\\s+)?function\\s+' + name.replace(/[$]/g, '\\$') + '\\s*\\('));
  if (at < 0) throw new Error('함수를 찾지 못했습니다: ' + name);
  let depth = 0;
  for (let j = SRC.indexOf('{', at); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}' && --depth === 0) return SRC.slice(at, j + 1);
  }
  throw new Error('본문 끝을 찾지 못했습니다: ' + name);
}
function grabVar(decl) {
  const at = SRC.indexOf(decl);
  if (at < 0) throw new Error('선언을 찾지 못했습니다: ' + decl);
  return SRC.slice(at, SRC.indexOf('\n', at));
}

const FNS = [
  'esc', 'escAttr', 'normD', 'costNum', 'nkey', 'hospitalSales_', 'rowDate', 'monday', 'addD', 'ymd', 'isOK',
  'hpCleanKey_', 'hpIsLeakVoc_', 'isHandpieceCleaning_',
  'isDemoRecord', 'recScope', 'isNcareVisit', 'nzNcare_', 'cmpGroup_',
  'skNorm_', 'skCmpKo_', 'exToday', 'exBaseDate',
  'filteredRows_', 'hospStateFilter_', 'nozStateMap_', 'buildNozzleStatusMap',
  'exWindowBaseRows_', 'exWindowRows', 'buildComparisonPeriod', 'exPrevRows',
  'exKpiSet', 'buildExecutiveKpis', 'exDim', 'exDimCompare', 'exVocTypeCompare_',
  'ncareAsOf_', 'ncareAsOfLabel_', 'buildNcareStatus', 'buildSkillData', 'buildNozzleData', 'buildNozzleUnrated',
  'buildNcareCompare', 'exBuild', 'exNum', 'exPeriodLabel', 'exDeltaSmall', 'exBars',
  'exListGroup', 'exHistoryRows_', 'exHistorySort_', 'exHistoryDataset_', 'exHistoryVal_',
  'exHistoryField_', 'exHistoryUnique_', 'exHistoryCounts_', 'exHistoryBreakdownHtml_', 'exHistoryFilter_', 'exHistoryOption_', 'exHistoryCell_',
  'exHistoryDetail_', 'exTypeExampleNorm_', 'exTypeExampleKey_',
  'exHistoryTable_', 'exHistoryControls_', 'exCmpRangeText_',
  'exHistoryKpiRows_', 'exHistoryHospitalCount_', 'exHistoryKpiChip_',
  'buildExecutiveVocChange'
];
const src = [
  'var window={};',
  'var EX_HISTORY_STATE=null;',
  grabVar('var RAW=[];'), grabVar('var HOSPDB=[];'),
  grabVar('var EX_CMP=true;'), grabVar('var EX_CACHE=null;'),
  grabVar('var YC_CLEAN_SAVING_UNIT='),
  grabVar('var F={year:'), grabVar('var DEMO_MARK='), grabVar('var NCK_ST='),
  ...FNS.map(grab),
  'return {' + FNS.join(',') +
  ', setRAW:function(v){RAW=v;}, setF:function(v){F=v;}, getF:function(){return F;},' +
  ' resetCache:function(){EX_CACHE=null;}};'
].join('\n');
const D = new Function(src)();

const emptyF = () => ({
  year: [], month: [], quarter: [], gubun: [], paid: [], ncare: [], cat: [], fse: [],
  type: [], part: [], hosp: [], noz: [], skill: [], scope: [], hospQ: '', from: '', to: ''
});
function load(rows, period) {
  D.setRAW(rows.map(r => {
    const o = Object.assign({
      hosp: '', fse: '', gubun: '', cat: '', type: '', part: '', cost: '', detail: '',
      sn: '', nsFill: '', nsAmt: '', jet: '', nozzleReuse: ''
    }, r);
    const dd = D.normD(o.date);
    o._y = dd.y; o._m = dd.m; o._d = dd.d; o._q = dd.q; o._cost = D.costNum(o.cost);
    o.ncare = o.ncare || '미가입'; o.paid = o.paid || '';
    return o;
  }));
  D.setF(Object.assign(emptyF(), period || {}));
  D.resetCache();
  return D.exBuild(D.exWindowRows(
    new Date(period.from + 'T00:00:00'), new Date(period.to + 'T23:59:59')));
}

/* 특수문자·따옴표가 섞인 유형명을 일부러 포함한다 */
const ODD_TYPE = '노즐 "누수" & <급수> \'A\'';
const SAMPLE = [
  /* 현재 기간 2026-08-03 ~ 08-07 */
  { date: '2026-08-05', hosp: '나병원', gubun: 'A/S', type: '노즐누수', part: "Handpiece Ass'y", fse: '김프로', detail: '내부 세척\n정상 동작 확인' },
  { date: '2026-08-05', hosp: '가병원', gubun: 'A/S', type: '노즐누수', part: "Handpiece Ass'y", fse: '이기사', detail: '핸드피스 교체' },
  { date: '2026-08-07', hosp: '다병원', gubun: 'A/S', type: '노즐누수', part: '없음', fse: '김프로', detail: '누수 부위 확인 및 세척' },
  { date: '2026-08-04', hosp: '라병원', gubun: 'A/S', type: ODD_TYPE, part: 'Cable Set' },
  { date: '2026-08-06', hosp: '마병원', gubun: 'A/S', type: '이상 없음', part: '없음' },
  { date: '2026-08-06', hosp: '바병원', gubun: '점검', type: '노즐누수', part: "Handpiece Ass'y" },
  /* 비교 기간(전주) 2026-07-27 ~ 07-31 */
  { date: '2026-07-28', hosp: '가병원', gubun: 'A/S', type: '노즐누수', part: "Handpiece Ass'y" },
  { date: '2026-07-29', hosp: '사병원', gubun: 'A/S', type: '풋스위치 불량', part: 'Foot s/w' },
  { date: '2026-07-30', hosp: '아병원', gubun: 'A/S', type: '풋스위치 불량', part: 'Foot s/w' },
  { date: '2026-07-30', hosp: '자병원', gubun: 'A/S', type: '풋스위치 불량', part: 'Cable Set' },
  /* 데모 기록 — 모집단에서 이미 빠진다 */
  { date: '2026-08-05', hosp: '데모센터', gubun: 'A/S', type: '노즐누수', part: 'Demo', detail: '[데모장비] 데모' }
];
const WEEK = { from: '2026-08-03', to: '2026-08-07' };
const x = load(SAMPLE, WEEK);

const vocTop = D.exDimCompare(x.rows, x.prev, 'type', true);
const vocTopAll = D.exVocTypeCompare_(x.rows, x.prev);
const partTop = D.exDimCompare(x.rows, x.prev, 'part', false);
const change = D.buildExecutiveVocChange(x);
const curOf = (dim, k, onlyAS) => D.exHistoryRows_(x.rows, dim, k, onlyAS);
const prevOf = (dim, k, onlyAS) => D.exHistoryRows_(x.prev, dim, k, onlyAS);

/* ══════ 1. 카드 수치 == 이력 건수 (중복 제거 없음) ══════ */
{
  const bad = vocTopAll.filter(t => curOf('type', t.k, false).length !== t.cur
    || prevOf('type', t.k, false).length !== t.prev);
  ck('1. VOC 유형 TOP5 — 카드 cur/prev 와 이력 길이 일치',
    vocTopAll.length > 0 && bad.length === 0,
    bad.map(t => t.k + ' cur=' + t.cur + '/' + curOf('type', t.k, false).length).join(', '));
  const badP = partTop.filter(t => curOf('part', t.k, false).length !== t.cur
    || prevOf('part', t.k, false).length !== t.prev);
  ck('2. 교체품 TOP5 — 카드 cur/prev 와 이력 길이 일치',
    partTop.length > 0 && badP.length === 0,
    badP.map(t => t.k).join(', '));
  /* 같은 병원·같은 유형이라도 원본 행 수만큼 나온다 */
  ck('3. 같은 유형 3건이면 이력도 3건 (dedupe 안 함)',
    curOf('type', '노즐누수', true).length === 3);
}

/* ══════ 2. VOC 유형 변화 — 증가/감소 유형 모두 조회 가능 ══════ */
{
  const up = change.up, down = change.down;
  ck('4. VOC 변화 증가 유형 이력 조회', up.length > 0 &&
    up.every(t => curOf('type', t.k, false).length === t.cur), up.map(t => t.k).join(','));
  const zeroCur = down.filter(t => t.cur === 0);
  ck('5. 감소 유형 중 현재 0건도 비교 기간 이력이 조회된다',
    zeroCur.length > 0 && zeroCur.every(t => curOf('type', t.k, false).length === 0
      && prevOf('type', t.k, false).length === t.prev),
    zeroCur.map(t => t.k + ' prev=' + t.prev).join(','));
  ck('6. 현재/비교 기간이 분리된다 (같은 유형이 양쪽에 다르게 존재)',
    curOf('type', '노즐누수', false).length === 4 && prevOf('type', '노즐누수', false).length === 1);
}

/* ══════ 3. 집계 기준이 카드와 완전히 같다 ══════ */
{
  ck('7. VOC 변화·TOP5 이력 모두 점검 중 발견된 실제 이상 유형을 포함',
    curOf('part', "Handpiece Ass'y", false).some(r => r.gubun === '점검') &&
    curOf('type', '노즐누수', false).length === 4 &&
    vocTopAll.some(t => t.k==='노즐누수' && t.cur===4));
  ck('8. "이상 없음" 계열은 VOC 이력에서 제외', curOf('type', '이상 없음', true).length === 0);
  ck('9. 빈 값·"없음" 은 항목으로 세지 않는다',
    curOf('part', '없음', false).length === 0 && curOf('part', '', false).length === 0);
  ck('10. 데모 운영 기록은 모집단에서 이미 빠져 이력에도 없다',
    curOf('type', '노즐누수', false).every(r => r.hosp !== '데모센터'));
  ck('11. 교체품은 정확히 일치하는 이름만 (부분 일치 금지)',
    curOf('part', 'Handpiece', false).length === 0 &&
    curOf('part', "Handpiece Ass'y", false).length === 3);
}

/* ══════ 4. 정렬 ══════ */
{
  const sorted = D.exHistorySort_(curOf('type', '노즐누수', false));
  const days = sorted.map(r => D.ymd(D.rowDate(r)));
  ck('12. 최신 처리일 우선 정렬', days.join(',') === '2026-08-07,2026-08-06,2026-08-05,2026-08-05', days.join(','));
  ck('13. 같은 날짜는 병원명 가나다순',
    sorted[2].hosp === '가병원' && sorted[3].hosp === '나병원',
    sorted.map(r => r.hosp).join(','));
  ck('14. 원본 배열을 변형하지 않는다 (slice 후 정렬)',
    D.exHistoryRows_(x.rows, 'type', '노즐누수', false)[0].hosp === '나병원');
}

/* ══════ 5. 표 표시 — 열 구조·처리 내용 ══════ */
{
  const items = D.exHistoryDataset_(curOf('type', '노즐누수', false), prevOf('type', '노즐누수', false));
  const table = D.exHistoryTable_(items);
  ck('15. 선택·비교 기간 원본 행을 하나의 표 데이터로 합친다',
    items.length === 5 && items.filter(x => x.period === 'cur').length === 4 &&
    items.filter(x => x.period === 'prev').length === 1);
  ck('16. 표에 기간·처리일·병원·구분·담당자·VOC 유형·교체품·처리 내용 열이 있다',
    ['기간','처리일','병원','구분','담당자','VOC 유형','교체품','처리 내용']
      .every(t => table.indexOf(t) >= 0));
  ck('17. 처리 내용 원본 줄바꿈을 보존해 표시',
    table.indexOf('내부 세척<br>정상 동작 확인') >= 0 && table.indexOf('누수 부위 확인 및 세척') >= 0);
  ck('18. 값이 없는 교체품은 대시로 표시하고 "없음" 문자열은 숨긴다',
    table.indexOf('>없음<') < 0 && table.indexOf('class="muted">–</span>') >= 0);
  ck('19. 처리 내용이 없으면 명확한 빈 상태를 표시',
    D.exHistoryDetail_('').indexOf('처리 내용 없음') >= 0);
}

/* ══════ 6. 팝업 내부 필터 ══════ */
{
  const items = D.exHistoryDataset_(
    D.exHistorySort_(x.rows), D.exHistorySort_(x.prev));
  ck('20. 선택/비교 기간 필터',
    D.exHistoryFilter_(items,{period:'cur'}).every(v => v.period === 'cur') &&
    D.exHistoryFilter_(items,{period:'prev'}).every(v => v.period === 'prev'));
  ck('21. 구분 필터 — 교체품 이력에서 A/S·점검 구분 가능',
    D.exHistoryFilter_(items,{gubun:'점검'}).length === 1 &&
    D.exHistoryFilter_(items,{gubun:'점검'})[0].r.hosp === '바병원');
  ck('22. 담당자 필터',
    D.exHistoryFilter_(items,{fse:'김프로'}).length === 2 &&
    D.exHistoryFilter_(items,{fse:'김프로'}).every(v => v.r.fse === '김프로'));
  ck('23. 병원명 검색', D.exHistoryFilter_(items,{q:'다병원'}).length === 1);
  ck('24. 처리 내용 검색',
    D.exHistoryFilter_(items,{q:'정상 동작'}).length === 1 &&
    D.exHistoryFilter_(items,{q:'정상 동작'})[0].r.hosp === '나병원');
  ck('25. 필터 옵션은 중복 제거·가나다순',
    D.exHistoryUnique_(items,'fse').join(',') === '김프로,이기사');
  ck('25-b. VOC 유형 필터',
    D.exHistoryFilter_(items,{type:'노즐누수'}).length === 5 &&
    D.exHistoryFilter_(items,{type:'노즐누수'}).every(v => v.r.type === '노즐누수'));
  const controls=D.exHistoryControls_(items,true);
  ck('26. 기간·구분·VOC 유형·담당자·검색·초기화 컨트롤 존재',
    ['hstPeriod','hstGubun','hstType','hstFse','hstQuery','exResetHistoryFilters_']
      .every(t => controls.indexOf(t) >= 0));
  ck('26-b. 처리 이력 기간 기본값은 선택 기간',
    controls.indexOf('value="cur" selected') >= 0 &&
    controls.indexOf('value="cur" selected') < controls.indexOf('value="all"'));
  ck('26-c. 비교 기간이 없어도 선택 기간 기본값과 전체 기간 선택지는 유지',
    D.exHistoryControls_(items,false).indexOf('value="cur" selected') >= 0 &&
    D.exHistoryControls_(items,false).indexOf('value="prev"') < 0 &&
    D.exHistoryControls_(items,false).indexOf('value="all"') >= 0);
}

/* ══════ 6-b. 주간 핵심보고 KPI 카드별 처리 이력 ══════ */
{
  const totalRows=D.exHistoryKpiRows_(x.rows,'kpiTotal');
  const asRows=D.exHistoryKpiRows_(x.rows,'kpiAs');
  const inspRows=D.exHistoryKpiRows_(x.rows,'kpiInsp');
  const hospRows=D.exHistoryKpiRows_(x.rows,'kpiHosp');
  ck('26-d. 전체·A/S·점검 KPI 이력 범위가 카드 집계와 일치',
    totalRows.length===x.kpi.cur.total && asRows.length===x.kpi.cur.as && inspRows.length===x.kpi.cur.insp,
    'total='+totalRows.length+' as='+asRows.length+' insp='+inspRows.length);
  ck('26-e. 서비스 병원 카드는 중복 제거 병원 수와 처리 건수를 함께 표시',
    D.exHistoryHospitalCount_(hospRows)===x.kpi.cur.hosp && D.exHistoryKpiChip_(hospRows,'kpiHosp')==='6곳 · 처리 6건');
  const currentItems=D.exHistoryDataset_(totalRows,[]);
  const breakdown=D.exHistoryBreakdownHtml_(currentItems);
  ck('26-f. 필터 결과에 구분 건수와 VOC 유형별 건수를 표시',
    breakdown.includes('구분 건수')&&breakdown.includes('A/S <b>5건</b>')&&breakdown.includes('점검 <b>1건</b>')
    &&breakdown.includes('VOC 유형별 건수')&&breakdown.includes('노즐누수 <b>4건</b>'));
  ck('26-f2. 구분·VOC 유형 건수는 공통 클릭 필터 버튼으로 렌더링',
    breakdown.includes('onclick="exApplyHistoryCountChip_(this)"')
    &&breakdown.includes('data-hst-count-key="gubun"')&&breakdown.includes('data-hst-count-key="type"'));
  const facetItems=[
    {period:'cur',r:{gubun:'A/S',type:'노즐누수'}},
    {period:'cur',r:{gubun:'점검',type:'케이블 불량'}}
  ];
  const selectedBreakdown=D.exHistoryBreakdownHtml_(facetItems,{period:'cur',gubun:'A/S',type:'all',fse:'all',q:''});
  ck('26-f3. 다른 구분 버튼은 유지하고 0건 VOC 유형 칩은 숨긴다',
    selectedBreakdown.includes('data-hst-count-value="점검"')
    &&!selectedBreakdown.includes('data-hst-count-value="케이블 불량"')
    &&selectedBreakdown.includes('노즐누수 <b>1건</b>'));
  const selectedZero=D.exHistoryBreakdownHtml_(facetItems,{period:'cur',gubun:'A/S',type:'케이블 불량'});
  ck('26-f3-b. 선택된 유형도 다른 조건에서 0건이면 칩을 숨기고 드롭다운 후보는 유지',
    !selectedZero.includes('data-hst-count-key="type" data-hst-count-value="케이블 불량"')
    &&D.exHistoryControls_(facetItems,false).includes('value="케이블 불량"'));
  const typeOnly=D.exHistoryBreakdownHtml_(facetItems,{period:'cur',type:'노즐누수'});
  ck('26-f3-c. 유형 자체 조건은 제외하므로 다른 양수 유형으로 계속 전환 가능',
    typeOnly.includes('케이블 불량 <b>1건</b>')&&typeOnly.includes('노즐누수 <b>1건</b>'));
  const prevOnly=[...facetItems,{period:'prev',r:{gubun:'A/S',type:'비교기간전용'}}];
  ck('26-f3-d. 기간·담당자·검색 변경에 따른 0건 유형도 숨기고 조건 해제 시 복원',
    !D.exHistoryBreakdownHtml_(prevOnly,{period:'cur'}).includes('비교기간전용')
    &&D.exHistoryBreakdownHtml_(prevOnly,{period:'all'}).includes('비교기간전용 <b>1건</b>')
    &&!D.exHistoryBreakdownHtml_(facetItems,{fse:'없는담당자'}).includes('data-hst-count-key="type"')
    &&D.exHistoryBreakdownHtml_(facetItems,{q:'일치하지않음'}).includes('해당 기록 없음'));
  ck('26-f4. 선택 칩은 강조·해제 상태를 접근성 속성과 함께 표시',
    /class="hst-count-chip is-active"[^>]*data-hst-count-value="A\/S"[^>]*aria-pressed="true"/.test(selectedBreakdown)
    &&selectedBreakdown.includes('A/S 필터 해제')&&selectedBreakdown.includes('hst-count-clear'));
  ck('26-g. 빈 구분·VOC 유형도 미입력으로 집계해 합계에서 빠지지 않는다',
    D.exHistoryCounts_([{period:'cur',r:{gubun:'',type:''}}],'type')[0].k==='미입력');
  const missingItems=[{period:'cur',r:{gubun:'',type:'',hosp:'미입력병원'}}];
  ck('26-g2. 미입력 건수도 클릭 가능한 필터 값으로 제공',
    D.exHistoryBreakdownHtml_(missingItems).includes('data-hst-count-value="__missing__"')
    &&D.exHistoryControls_(missingItems,false).includes('value="__missing__"')
    &&D.exHistoryFilter_(missingItems,{type:'__missing__'}).length===1);
  const summarySrc=grab('renderExecutiveSummary');
  ck('26-h. 남은 주간 핵심보고 건수 KPI 카드가 모두 처리 이력 버튼이다',
    ['kpiTotal','kpiAs','kpiInsp'].every(dim=>summarySrc.includes("hist:'"+dim+"'"))&&
    !summarySrc.includes("hist:'kpiHosp'"));
  const showSrc=grab('exShowHistory_');
  ck('26-i. KPI 이력은 기존 집계 캐시를 재사용하고 카드별 범위를 적용',
    showSrc.includes("['kpiTotal','kpiAs','kpiInsp','kpiHosp','kpiSaving']")
    &&showSrc.includes('exHistoryKpiRows_(x.rows,dim)')&&showSrc.includes("hospitalMetric:dim==='kpiHosp'"));
  const savingRows=D.exHistoryKpiRows_([
    {gubun:'A/S',type:'노즐 누수(약액 유입)',part:'내부 세척',hosp:'절감A'},
    {gubun:'A/S',type:'노즐누수(약액유입)',part:'내부세척',hosp:'절감B'},
    {gubun:'A/S',type:'케이블 불량',part:'내부 세척',hosp:'제외'}
  ],'kpiSaving');
  ck('26-j. 추정 절감액 이력은 연간 비교와 같은 내부 세척 판정을 사용',
    savingRows.length===2&&D.exHistoryKpiChip_(savingRows,'kpiSaving')==='₩562,400 · 내부 세척 2건');
  ck('26-k. 주간 핵심보고에 절감액 KPI와 처리 이력 연결을 추가',
    summarySrc.includes("label:'추정 교체비용 절감액'")&&summarySrc.includes("hist:'kpiSaving'")
    &&showSrc.includes("savingMetric:dim==='kpiSaving'"));
  ck('26-l. 추정 절감액 카드는 교체비용 합계 바로 오른쪽에 배치',
    summarySrc.indexOf("label:'교체비용 합계'")<summarySrc.indexOf("label:'추정 교체비용 절감액'")
    &&!summarySrc.includes("label:'N-CARE 점검 운영률'"));
  ck('26-l2. 주간 핵심보고 KPI에서 N-Care 운영률과 서비스 병원 수 카드 제거',
    !summarySrc.includes('ncareAsOfLabel_()')&&!summarySrc.includes('30일 이내 점검')&&
    !summarySrc.includes("label:'서비스 병원 수'"));
  const chipSrc=grab('exApplyHistoryCountChip_');
  ck('26-m. 건수 칩은 해당 select만 바꾸고 공통 필터 적용 함수를 호출',
    chipSrc.includes("key==='gubun'?'hstGubun'")&&chipSrc.includes("key==='type'?'hstType'")
    &&chipSrc.includes('exApplyHistoryFilters_()'));
  ck('26-n. 같은 칩 재클릭은 전체로 해제하고 다른 칩은 즉시 전환',
    chipSrc.includes('select.value===value')&&chipSrc.includes("select.value=selected?'all':value"));
  ck('26-o. 요약 버튼은 필터 결과가 아니라 원본 목록으로 계속 렌더링',
    grab('exApplyHistoryFilters_').includes('exHistoryBreakdownHtml_(EX_HISTORY_STATE.items,opt)'));
}

/* ══════ 7. 특수문자·따옴표 안전 ══════ */
{
  ck('27. 따옴표·꺾쇠가 든 유형명도 정확히 매칭', curOf('type', ODD_TYPE, true).length === 1);
  const table = D.exHistoryTable_(D.exHistoryDataset_(curOf('type', ODD_TYPE, true), []));
  ck('28. 이력 표 본문이 escape 된다 (태그 주입 불가)',
    table.indexOf('&lt;급수&gt;') >= 0 && table.indexOf('&amp;') >= 0 &&
    table.indexOf('<급수>') < 0, table.slice(0, 220));
  const html = D.exBars(vocTopAll, { histDim: 'typeAll' });
  const m = html.match(/data-hist-k="([^"]*)"/g) || [];
  /* esc() 는 따옴표를 바꾸지 않으므로 속성에는 escAttr() 를 써야 한다 */
  ck('29. 카드 버튼의 data-hist-k 가 escape 되어 속성이 깨지지 않는다',
    m.length === vocTopAll.length && html.indexOf('data-hist-k="노즐 "누수"') < 0 &&
    html.indexOf('&quot;누수&quot;') >= 0, m.join(' | ').slice(0, 200));
  /* 속성에서 되읽은 값이 원래 유형명과 같아야 이력 조회가 맞는다 */
  const back = m.map(a => a.slice('data-hist-k="'.length, -1))
    .map(v => v.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  ck('29-b. 속성에서 되읽은 값이 원래 유형명과 일치',
    back.indexOf(ODD_TYPE) >= 0 && curOf('type', back[back.indexOf(ODD_TYPE)], false).length === 1);
  ck('30. 표 필터 결과가 0건이면 전용 빈 상태를 표시',
    D.exHistoryTable_([]).indexOf('선택한 필터에 해당하는 처리 이력이 없습니다') >= 0);
  ck('31. 기존 명단의 빈 상태 문구 기능은 그대로',
    D.exListGroup('t', [], null, '해당 기록 없음').indexOf('해당 기록 없음') >= 0 &&
    D.exListGroup('t', [], null).indexOf('해당 병원 없음') >= 0);
}

/* ══════ 8. 카드 렌더 — 버튼·데이터 속성 ══════ */
{
  const withBtn = D.exBars(vocTopAll, { histDim: 'typeAll' });
  const noBtn = D.exBars(vocTopAll, {});
  ck('32. histDim 을 주면 각 행이 button 이 된다',
    (withBtn.match(/<button type="button" class="ex-brow ex-row-btn/g) || []).length === vocTopAll.length);
  ck('33. histDim 이 없으면 기존 div 행 그대로 (기존 화면 보존)',
    noBtn.indexOf('<button') < 0 && noBtn.indexOf('data-hist-k') < 0 &&
    (noBtn.match(/class="ex-brow/g) || []).length === vocTopAll.length);
  ck('34. 수치·막대·증감 표시는 두 경우가 같다',
    withBtn.replace(/<button[^>]*>/g, '<div>').replace(/<\/button>/g, '</div>')
      .replace(/<span class="nm"/g, '<div class="nm"').replace(/<span class="tr"/g, '<div class="tr"')
      .replace(/<span class="vl"/g, '<div class="vl"').replace(/<span class="dl"/g, '<div class="dl"')
      .replace(/ex-brow ex-row-btn/g, 'ex-brow')
      .indexOf('노즐누수') >= 0 && noBtn.indexOf('노즐누수') >= 0);
  ck('35. 빈 목록은 기존 빈 상태 그대로', D.exBars([], { histDim: 'type', empty: 'A/S 기록 없음' })
    .indexOf('A/S 기록 없음') >= 0);
}

/* ══════ 9. 카드 클릭·모달 열기에는 네트워크 호출 없음 ══════ */
{
  const bodies = ['exShowHistory_', 'exHistoryRows_', 'exHistorySort_', 'exHistoryDataset_',
    'exHistoryFilter_', 'exHistoryTable_', 'exApplyHistoryFilters_', 'exCmpRangeText_', 'exBars', 'exListGroup']
    .map(n => {
      const at = SRC.search(new RegExp('\\bfunction\\s+' + n + '\\s*\\('));
      let depth = 0;
      for (let j = SRC.indexOf('{', at); j < SRC.length; j++) {
        if (SRC[j] === '{') depth++;
        else if (SRC[j] === '}' && --depth === 0) return SRC.slice(at, j + 1);
      }
      return '';
    }).join('\n');
  ck('36. 카드 클릭·모달 열기 경로에 fetch/GAS/재조회가 없다',
    !/\bfetch\s*\(|\bgv\s*\(|loadData\s*\(|XMLHttpRequest|script\.google/.test(bodies));
  ck('37. 클릭이 전역 필터(F)나 화면을 다시 그리지 않는다',
    !/\bapply\s*\(\)|buildFilters\s*\(\)|F\.(from|to|type|part|hosp)\s*=/.test(bodies));
  ck('38. 이미 만들어 둔 집계(EX_CACHE)를 재사용한다',
    /var x=EX_CACHE\|\|exBuild\(EX_ROWS\)/.test(SRC));
  ck('39. 리스너는 카드 컨테이너에 한 번만 위임 등록된다',
    /\['exKpis','exVocUpCard','exTypeCard','exPartCard','exLeakKpis'\]\.forEach/.test(SRC) &&
    /el\.addEventListener\('click',[\s\S]*?closest\('\[data-hist-dim\]'\)/.test(SRC));
  ck('40. 유형·교체품명을 inline onclick 문자열에 넣지 않는다',
    !/onclick="exShowHistory_/.test(SRC));
  ck('41. 팝업 내부 필터는 전역 필터 F 를 변경하지 않는다',
    !/F\.(from|to|type|part|hosp|fse|gubun)\s*=/.test(grab('exApplyHistoryFilters_')));
  ck('42. 처리 이력 모달은 넓은 표·모바일 카드 CSS를 모두 가진다',
    /\.ex-list-box\.history\{[^}]*max-width:1180px/.test(SRC) &&
    /@media\(max-width:820px\)/.test(SRC) && /\.hst-table td:before/.test(SRC));
  ck('43. 초기 표시와 필터 초기화 모두 선택 기간으로 돌아간다',
    /openExList\(title, sub, html, true\);\s*exApplyHistoryFilters_\(\)/.test(SRC) &&
    /period\.value='cur'/.test(grab('exResetHistoryFilters_')) &&
    /period:val\('hstPeriod','cur'\)/.test(grab('exApplyHistoryFilters_')));
  ck('44. 처리 이력 모달은 PC에서 계산 가능한 고정 높이를 가진다',
    /\.ex-list-box\.history\{[^}]*height:min\(900px,calc\(100vh - 32px\)\)/.test(SRC));
  ck('45. 처리 이력 목록은 항상 세로 스크롤이 가능하다',
    /\.hst-table-wrap\{[^}]*overflow-y:scroll/.test(SRC) &&
    /overscroll-behavior:contain/.test(SRC) && /touch-action:pan-x pan-y/.test(SRC));
  ck('46. 윈도우에서 스크롤바 위치가 눈에 보인다',
    /\.hst-table-wrap::-webkit-scrollbar\{width:12px/.test(SRC) &&
    /scrollbar-color:#94A3B8 #EEF2F7/.test(SRC));
  ck('47. 모바일은 동적 화면 높이를 사용해 목록 영역을 확보한다',
    /@supports\(height:100dvh\)/.test(SRC) &&
    /@media\(max-width:820px\)\{\.ex-list-box\.history\{height:calc\(100dvh - 20px\)\}/.test(SRC));
  const causeSrc=grab('renderExecutiveCause');
  ck('48. VOC 유형·교체품 TOP5는 선택 기간 0건 항목을 제외한다',
    /exVocTypeCompare_\(x\.rows, x\.prev\)[\s\S]{0,100}filter\(function\(t\)\{return t\.cur>0;\}\)\.slice\(0,5\)/.test(causeSrc) &&
    /exDimCompare\(x\.rows, x\.prev, 'part', false\)[\s\S]{0,100}filter\(function\(t\)\{return t\.cur>0;\}\)\.slice\(0,5\)/.test(causeSrc));
  const showHistorySrc=grab('exShowHistory_');
  ck('49. VOC 변화·TOP5 클릭 이력 모두 A/S·점검 통합 기준을 사용한다',
    /dim==='typeAll'\)\?'type':dim/.test(showHistorySrc) &&
    /onlyAS=\(dim==='type'\)/.test(showHistorySrc) && /histDim:'typeAll'/.test(causeSrc) &&
    /data-hist-dim="typeAll"/.test(grab('renderExecutiveSummary')));
}

console.log('\n──────────────────────────────');
console.log(`통과 ${pass}/${total}`);
if (fails.length) { console.log('실패:'); fails.forEach(f => console.log(' -', f)); process.exit(1); }
console.log('모든 테스트 통과 ✅');
