/************************************************************
 * dashboard-executive-ppt.mjs
 * 주간·월간 "대시보드형 1페이지 보고서 PPT" 회귀 테스트
 * 실행: node test/dashboard-executive-ppt.mjs
 * ----------------------------------------------------------
 * 무빌드 헤드리스. dashboard-pc.html 에서 집계·레이아웃 함수 원문을 그대로 꺼내
 * 실행하므로, HTML 안의 로직이 바뀌면 이 테스트가 같이 깨진다.
 * (test/dashboard-monthly-trend.mjs 와 같은 방식)
 *
 * 검증 대상
 *   · 스냅샷(buildExecutiveReportSnapshot) — 대시보드와 같은 집계·같은 문장인지
 *   · 표시 목록(buildExecutivePptDeck)     — 실제 PPT와 미리보기가 함께 쓰는 유일한 레이아웃
 * PPT/미리보기 backend 는 이 표시 목록을 그대로 그리므로, 목록을 검증하면
 * "미리보기에는 있는데 PPT에는 없다" 가 구조적으로 생길 수 없다.
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

/* ── dashboard-pc.html 에서 함수/변수 원문 추출 ── */
function grab(name) {
  const at = SRC.search(new RegExp('\\b(?:async\\s+)?function\\s+' + name.replace(/[$]/g, '\\$') + '\\s*\\('));
  if (at < 0) throw new Error('함수를 찾지 못했습니다: ' + name);
  let i = SRC.indexOf('{', at), depth = 0;
  for (let j = i; j < SRC.length; j++) {
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
/* var NAME={ … };  /  var NAME=(function(){ … })();  — 중괄호 짝으로 끝을 찾는다 */
function grabObj(decl) {
  const at = SRC.indexOf(decl);
  if (at < 0) throw new Error('선언을 찾지 못했습니다: ' + decl);
  let depth = 0;
  for (let j = SRC.indexOf('{', at); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}' && --depth === 0) return SRC.slice(at, SRC.indexOf(';', j) + 1);
  }
  throw new Error('선언 끝을 찾지 못했습니다: ' + decl);
}

const FNS = [
  'esc', 'escAttr', 'normD', 'costNum', 'nkey', 'rowDate', 'monday', 'addD', 'ymd',
  'wkNo', 'wkLabel', 'wkRange', 'isOK',
  'isDemoRecord', 'recScope', 'isNcareVisit', 'nzNcare_', 'cmpGroup_',
  'skNorm_', 'skCmpKo_', 'exToday', 'exBaseDate',
  'filteredRows_', 'hospStateFilter_', 'nozStateMap_', 'buildNozzleStatusMap',
  'exWindowBaseRows_', 'exWindowRows',
  'buildComparisonPeriod', 'exPrevRows',
  'exKpiSet', 'buildExecutiveKpis', 'exDim', 'exDimCompare', 'exVocTypeCompare_',
  'exTrendVocType_', 'exCountVocType_', 'exTrendTypeCounts_', 'exTrendMetricVal_', 'exTrendMetricLabel_',
  'exTrendIsVocType_', 'exTrendLineSpec_', 'ycNice_',
  'buildWeekTrend', 'exCountRange_', 'buildMonthTrend', 'buildMonthTrendCompare',
  'exMonthTrendNote_', 'ncareAsOf_', 'ncareAsOfLabel_', 'buildNcareStatus', 'buildSkillData', 'buildNozzleData',
  'buildNozzleUnrated', 'buildNcareCompare', 'exBuild',
  'exNum', 'exMD_', 'buildTrendSummary_',
  'exUnratedHtml', 'exUnratedNoteText_', 'exUnratedSummaryHtml_',
  'exDeltaParts', 'exDeltaHtml',
  'exVocDescKey_', 'exVocDesc_',
  'buildExecutiveVocChange', 'buildExecutiveNotes',
  'exDayLabel_',
  'buildExecutiveReportSnapshot', 'exReportSnapshot_',
  'exTxtW_', 'exFitTxt_', 'exFitSize_', 'exFitPair_',
  'exWrapRuns_', 'exUnesc_', 'exHtmlRuns_', 'exNotesLayout_', 'exNotesPlan_', 'exNotePlain_',
  'exNoteOverride_',
  'buildExecutivePptDeck', 'exPptRuns_',
  'exWeekPeriod_', 'exMonthPeriod_'
];
const src = [
  'var window={};',
  grabVar('var RAW=[];'),
  grabVar('var HOSPDB=[];'),
  grabVar('var EX_CMP=true;'),
  grabVar('var EX_CACHE=null;'),
  grabVar('var F={year:'),
  grabVar('var DEMO_MARK='),
  grabVar('var EX_MONTH_TREND_N='),
  grabVar('var NCK_ST='),
  grabVar('var EX_NOTE_SKILL='),
  grabVar('var EX_NOTE_NOZ='),
  grabVar('var EX_PPT_BASIS='),
  grabVar('var EX_TREND_METRIC_AS='),
  grabVar('var EX_TONE_CLS='),
  grabVar('var EX_NOTE_EDITS='),
  grabObj('var C={navy:'), grabObj('var FT={face:'), grabObj('var L=(function(){'),
  grabVar('var EX_TONE_COLOR='),
  grabObj('var EX_VOC_DESC=(function(){'),
  ...FNS.map(grab),
  'return {' + FNS.join(',') + ', L:L, C:C, FT:FT, EX_VOC_DESC:EX_VOC_DESC,' +
  ' setRAW:function(v){RAW=v;}, setHOSPDB:function(v){HOSPDB=v;},' +
  ' setF:function(v){F=v;}, getF:function(){return F;}, getEXCMP:function(){return EX_CMP;},'+
  ' setNoteEdits:function(t,v){EX_NOTE_EDITS[t]=v;}, getNoteEdits:function(t){return EX_NOTE_EDITS[t];}};'
].join('\n');
const D = new Function(src)();

const emptyF = () => ({
  year: [], month: [], quarter: [], gubun: [], paid: [], ncare: [], cat: [], fse: [],
  type: [], part: [], hosp: [], noz: [], skill: [], scope: [], hospQ: '', from: '', to: ''
});
function load(rows, hospdb) {
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
  D.setHOSPDB(hospdb || []);
  D.setF(emptyF());
}

/* ── 표시 목록 조회 헬퍼 ── */
const deckOf = snap => D.buildExecutivePptDeck(snap);
const itemsOf = snap => deckOf(snap)[0].items;
const textsOf = items => items.filter(o => o.k === 'text')
  .map(o => D.exPptRuns_(o).map(r => r.text).join(''));
const allText = items => textsOf(items).join('\n');
const has = (items, s) => allText(items).indexOf(s) >= 0;

/* ══════ 공통 표본 ══════
   2026-08-03(월)~08-07(금) 이 보고 주차, 08-01~08-31 이 보고 월.
   전주(07-27~07-31)·전월(07-01~07-31) 이 비교 기간이 된다. */
const SAMPLE = [
  /* 보고 주차(8/3~8/7) */
  { date: '2026-08-03', hosp: '가나병원', gubun: 'A/S', type: '노즐누수(약액 유입)', part: "Handpiece Ass'y", cost: '120000', sn: 'SN-1' },
  { date: '2026-08-03', hosp: '가나병원', gubun: 'A/S', type: '노즐누수(약액 유입)', part: "Handpiece Ass'y", cost: '120000', sn: 'SN-2' },
  { date: '2026-08-04', hosp: '다라의원', gubun: 'A/S', type: '풋스위치 작동 불량', part: 'Foot s/w', cost: '50000' },
  { date: '2026-08-05', hosp: '마바병원', gubun: '점검', type: '노즐 막힘', part: '없음', ncare: 'Pro' },
  { date: '2026-08-06', hosp: '마바병원', gubun: '점검', type: '정기점검', part: '없음', ncare: 'Pro' },
  { date: '2026-08-07', hosp: '사아의원', gubun: 'A/S', type: '이상 없음', part: '없음' },
  { date: '2026-08-07', hosp: '자차병원', gubun: 'A/S', type: '케이블 단선', part: 'Cable', cost: '30000' },
  /* 전주(7/27~7/31) */
  { date: '2026-07-27', hosp: '가나병원', gubun: 'A/S', type: '노즐누수(약액 유입)', part: "Handpiece Ass'y", cost: '110000' },
  { date: '2026-07-28', hosp: '다라의원', gubun: 'A/S', type: '풋스위치 작동 불량', part: 'Foot s/w' },
  { date: '2026-07-29', hosp: '다라의원', gubun: 'A/S', type: '풋스위치 작동 불량', part: 'Foot s/w' },
  { date: '2026-07-30', hosp: '마바병원', gubun: '점검', type: '정기점검', part: '없음', ncare: 'Pro' },
  /* 그 밖의 7월 (월간 비교용) */
  { date: '2026-07-06', hosp: '가나병원', gubun: 'A/S', type: '노즐누수(약액 유입)', part: "Handpiece Ass'y" },
  { date: '2026-07-14', hosp: '자차병원', gubun: '점검', type: '정기점검', part: '없음' },
  { date: '2026-06-10', hosp: '가나병원', gubun: 'A/S', type: '노즐누수(약액 유입)', part: "Handpiece Ass'y" },
  { date: '2026-05-11', hosp: '마바병원', gubun: '점검', type: '정기점검', part: '없음' },
  /* 데모 운영 기록 — 보고 대상에서 제외되어야 한다 */
  { date: '2026-08-04', hosp: '데모센터', gubun: 'A/S', type: '데모 점검', part: 'Demo', detail: '[데모장비] 데모 운영 기록' }
];
const WEEK = { type: 'week', from: '2026-08-03', to: '2026-08-07' };
const MONTH = { type: 'month', from: '2026-08-01', to: '2026-08-31' };

load(SAMPLE);
const wSnap = D.buildExecutiveReportSnapshot(WEEK);
const mSnap = D.buildExecutiveReportSnapshot(MONTH);
const wDeck = deckOf(wSnap), mDeck = deckOf(mSnap);
const wItems = wDeck[0].items, mItems = mDeck[0].items;

/* ══════ 1·2. 슬라이드 수 = 각각 1장 ══════ */
ck('1. 주간 PPT 슬라이드 1장', wDeck.length === 1, '슬라이드 ' + wDeck.length + '장');
ck('2. 월간 PPT 슬라이드 1장', mDeck.length === 1, '슬라이드 ' + mDeck.length + '장');

/* ══════ 3. KPI 3개 ══════ */
{
  const want = ['전체 서비스 건수', 'A/S(VOC) 건수', '점검 건수'];
  ck('3. 주간 KPI 3개 (순서·항목 일치)',
    wSnap.kpi.length === 3 && want.every((w, i) => wSnap.kpi[i].label === w),
    wSnap.kpi.map(k => k.label).join(' / '));
  ck('3-b. 월간 KPI 3개 (주간과 같은 구성)',
    mSnap.kpi.length === 3 && want.every((w, i) => mSnap.kpi[i].label === w));
  ck('3-c. KPI 3개가 모두 슬라이드에 그려진다', want.every(w => has(wItems, w)));
  ck('3-d. A/S KPI 는 비율을 함께 적는다', /비율 \d+%/.test(wSnap.kpi[1].note || ''), wSnap.kpi[1].note);
  ck('3-e. 주간·월간 PPT에서 N-CARE 운영률과 서비스 병원 수를 제거',
    !wSnap.kpi.some(k=>k.label==='N-CARE 점검 운영률')&&
    !mSnap.kpi.some(k=>k.label==='N-CARE 점검 운영률')&&
    !wSnap.kpi.some(k=>k.label==='서비스 병원 수')&&!has(wItems,'N-CARE 점검 운영률'));
  ck('3-f. KPI 3장이 한 줄 — y 좌표가 모두 같다',
    new Set(wItems.filter(o => o.card && o.y === D.L.kpi.y).map(o => o.y)).size === 1 &&
    wItems.filter(o => o.card && o.y === D.L.kpi.y).length === 3);
}

/* ══════ 4·5. 추이 카드 — 주간 8주 / 월간 6개월 ══════ */
{
  ck('4. 주간 PPT 최근 8주 추이 (구간 8개)',
    wSnap.trend.kind === 'week' && wSnap.trend.line.pts.length === 8 && has(wItems, '최근 8주 서비스 추이'));
  ck('4-b. 최근 8주(주 계열)와 직전 8주(참조 계열)를 겹쳐 그린다',
    wSnap.trend.line.mainName === '최근 8주' && wSnap.trend.line.refName === '직전 8주' &&
    wSnap.trend.line.pts.every(p => typeof p.main === 'number' && typeof p.ref === 'number'));
  ck('4-c. 선택한 보고 주차를 강조', wSnap.trend.line.pts.filter(p => p.sel).length === 1);
  ck('4-d. 핵심 수치 4칸(기준 주·최근 8주·직전 8주·증감)',
    ['기준 주 전체 처리', '최근 8주 합계', '직전 8주 합계', '직전 8주 대비'].every(t => has(wItems, t)));
  ck('5. 월간 PPT 최근 6개월 추이 (구간 6개)',
    mSnap.trend.kind === 'month' && mSnap.trend.line.pts.length === 6 && has(mItems, '월별 처리 추이'));
  ck('5-b. 현재 보고 월 강조', mSnap.trend.line.pts.filter(p => p.sel).length === 1 &&
    mSnap.trend.line.pts[mSnap.trend.line.pts.length - 1].sel === true);
  ck('5-c. 월간 핵심 수치 4칸(기준 월·최근 6개월·직전 6개월·증감)',
    ['기준 월 전체 처리', '최근 6개월 합계', '직전 6개월 합계', '직전 6개월 대비'].every(t => has(mItems, t)));
  ck('5-d. 주간 PPT 에는 6개월 추이가 없다', !has(wItems, '월별 처리 추이'));
  ck('5-e. 월간 PPT 에는 8주 추이가 없다', !has(mItems, '최근 8주 서비스 추이'));
}
/* 선택 종료일이 월말보다 이르면 부분 월로 표시 */
{
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const y = today.getFullYear(), m = today.getMonth();
  const cur = D.buildExecutiveReportSnapshot({
    type: 'month', from: D.ymd(new Date(y, m, 1)), to: D.ymd(new Date(y, m + 1, 0))
  });
  const last = cur.trend.line.pts[cur.trend.line.pts.length - 1];
  const done = new Date(y, m + 1, 0) <= today;
  ck('5-f. 보고 월이 완료되지 않았으면 부분 월 표시', done ? !last.ongoing : !!last.ongoing);
  const pm = new Date(y, m - 1, 1);            /* 지난달 = 반드시 완료된 월 */
  const past = D.buildExecutiveReportSnapshot({
    type: 'month', from: D.ymd(pm), to: D.ymd(new Date(y, m, 0))
  });
  ck('5-g. 완료된 과거 월에는 "진행 중"이 없다',
    !past.trend.line.pts.some(p => p.ongoing) && !has(itemsOf(past), '진행 중'));

  const now = D.exToday();
  const curPeriod = D.exMonthPeriod_(D.ymd(new Date(now.getFullYear(), now.getMonth(), 1)));
  ck('5-h. 진행 중인 월 보고 기간은 오늘까지만 집계',
    curPeriod.to === D.ymd(now), curPeriod.from + ' ~ ' + curPeriod.to);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevPeriod = D.exMonthPeriod_(D.ymd(prevStart));
  ck('5-i. 완료된 과거 월은 월말까지 집계',
    prevPeriod.to === D.ymd(new Date(now.getFullYear(), now.getMonth(), 0)), prevPeriod.to);
}

/* ══════ 6. VOC 유형 변화 ══════ */
{
  ck('6. VOC 유형 변화 카드 존재 (증가/감소 TOP3)',
    has(wItems, 'VOC 유형 변화') && has(wItems, '증가 TOP 3 ↑') && has(wItems, '감소 TOP 3 ↓'));
  ck('6-b. 대시보드와 같은 정렬·증감값',
    JSON.stringify(wSnap.change.up.map(t => [t.k, t.d])) ===
    JSON.stringify(D.buildExecutiveVocChange(rebuildX(WEEK)).up.map(t => [t.k, t.d])));
  ck('6-c. 증가 TOP3 · 감소 TOP3 는 최대 3건',
    wSnap.change.up.length <= 3 && wSnap.change.down.length <= 3);
  ck('6-d. 신규 유형 표시 (이전 0 → 현재 >0)',
    wSnap.change.up.some(t => t.k === '케이블 단선' && t.isNew) && has(wItems, '신규'));
  ck('6-e. 이전 기간이 0건이면 현재 유형을 신규로 표시', (() => {
    load(SAMPLE.filter(r => r.date >= '2026-08-01'));
    const s = D.buildExecutiveReportSnapshot(WEEK);
    return s.change.up.some(t => t.k === '노즐누수(약액 유입)' && t.isNew && t.prev === 0);
  })());
  ck('6-f. 점검 중 발견된 VOC도 변화 카드에 포함하고 정상 점검 표기는 제외',
    wSnap.change.up.some(t => t.k === '노즐 막힘' && t.cur === 1) &&
    !wSnap.change.up.concat(wSnap.change.down).some(t => t.k === '정기점검' || t.k === '이상 없음'));
  load(SAMPLE);
}
function rebuildX(period) {
  /* 대시보드가 쓰는 경로 그대로 — 스냅샷과 같은 값이 나와야 한다 */
  const f = D.getF();
  f.from = period.from; f.to = period.to;
  D.setF(f);
  const rows = D.exWindowRows(new Date(period.from + 'T00:00:00'), new Date(period.to + 'T23:59:59'));
  const x = D.exBuild(rows);
  return x;
}

/* ══════ 7·8. VOC TOP5 · 교체품 TOP5 ══════ */
{
  ck('7. VOC 유형 TOP 5 존재', has(wItems, 'VOC 유형 TOP 5') && wSnap.vocTop.rows.length > 0);
  ck('7-b. A/S·점검 중 실제 이상 유형 통합·정상 점검 표기 제외',
    !wSnap.vocTop.rows.some(r => r.k === '이상 없음') && !wSnap.vocTop.rows.some(r => r.k === '정기점검'),
    wSnap.vocTop.rows.map(r => r.k).join(','));
  ck('7-b-1. 점검 중 발견된 VOC 유형도 TOP5에 포함',
    wSnap.vocTop.rows.some(r => r.k === '노즐 막힘' && r.cur === 1));
  ck('7-c. 최대 5행 · 이전 동일 기간 증감 표시',
    wSnap.vocTop.rows.length <= 5 && wSnap.vocTop.rows.every(r => 'd' in r));
  ck('7-d. 고정 VOC 현상 설명 자동 적용',
    wSnap.vocTop.rows.some(r => r.k === '노즐누수(약액 유입)' &&
      r.desc === '약액이 핸드피스 내부로 유입되거나 외부로 누출되는 현상'));
  const edited = D.buildExecutiveReportSnapshot(Object.assign({}, WEEK, {
    vocDescriptions: { [D.exVocDescKey_('노즐 누수(약액 유입)')]: '이번 보고서용 수정 설명' }
  }));
  ck('7-e. 생성 전 수동 수정 설명이 고정 설명보다 우선',
    edited.vocTop.rows.some(r => r.k === '노즐누수(약액 유입)' && r.desc === '이번 보고서용 수정 설명') &&
    has(itemsOf(edited), '이번 보고서용 수정 설명'));
  const editedItems = itemsOf(edited);
  const editedDesc = editedItems.find(o => o.topCard === 'voc' && o.topCol === 'description' &&
    D.exPptRuns_(o).some(r => r.text === '이번 보고서용 수정 설명'));
  const editedVal = editedItems.find(o => o.topCard === 'voc' && o.topCol === 'value' &&
    o.topRow === editedDesc?.topRow);
  const editedName = editedItems.find(o => o.topCard === 'voc' && o.topCol === 'name' &&
    o.topRow === editedDesc?.topRow);
  ck('7-e-1. 수정된 VOC 설명은 유형 아래 보조 행에 반영되고 숫자 행 높이를 바꾸지 않는다',
    !!editedDesc && !!editedVal && !!editedName && editedVal.h === D.L.top.rowH &&
    Math.abs(editedName.y-editedVal.y-D.L.top.descDY) < 0.0001 &&
    Math.abs(editedDesc.y-editedName.y-D.L.top.descNameH) < 0.0001 &&
    editedName.h === D.L.top.descNameH && editedDesc.h === D.L.top.descH);
  ck('7-e-2. 첨부 PPT 기준 VOC 유형·설명 묶음은 숫자 행보다 2.56px 아래에서 시작한다',
    Math.abs(D.L.top.descDY*96-2.56) < 0.001);
  ck('7-f. 케이블 불량·케이블 단선 별칭은 같은 설명 사용',
    D.exVocDesc_('케이블 불량') === D.exVocDesc_('케이블 단선'));
  const descW = D.L.voc.w - D.L.top.pad * 2;
  ck('7-g. 고정 VOC 설명은 PPT 한 줄 폭 안에 들어간다',
    Object.values(D.EX_VOC_DESC).every(s => D.exTxtW_(s, D.FT.rowDesc) <= descW + 0.001));
  ck('8. 교체품 TOP 5 존재', has(wItems, '교체품 TOP 5') && wSnap.partTop.rows.length > 0);
  ck('8-b. 교체품도 최대 5행 · 증감 표시',
    wSnap.partTop.rows.length <= 5 && wSnap.partTop.rows.every(r => 'd' in r));
  ck('8-c. 월간도 같은 두 카드를 싣는다', has(mItems, 'VOC 유형 TOP 5') && has(mItems, '교체품 TOP 5'));
  const topAligned = items => ['value', 'delta'].every(col => {
    const vh = items.find(o => o.topCard === 'voc' && o.topCol === col && o.topRow === -1);
    const ph = items.find(o => o.topCard === 'part' && o.topCol === col && o.topRow === -1);
    if(!vh || !ph || Math.abs((vh.x-D.L.voc.x)-(ph.x-D.L.part.x)) >= 0.001 ||
      Math.abs(vh.w-ph.w) >= 0.001 || Math.abs(vh.y-ph.y) >= 0.001 || Math.abs(vh.h-ph.h) >= 0.001) return false;
    const vRows = items.filter(o => o.topCard === 'voc' && o.topCol === col && o.topRow >= 0).length;
    const pRows = items.filter(o => o.topCard === 'part' && o.topCol === col && o.topRow >= 0).length;
    const rows = Math.min(vRows, pRows);
    for(let i=0;i<rows;i++){
      const v=items.find(o => o.topCard === 'voc' && o.topCol === col && o.topRow === i);
      const p=items.find(o => o.topCard === 'part' && o.topCol === col && o.topRow === i);
      if(!v || !p || Math.abs((v.x-D.L.voc.x)-(p.x-D.L.part.x)) >= 0.001 ||
        Math.abs(v.w-p.w) >= 0.001 || Math.abs(v.y-p.y) >= 0.001 || Math.abs(v.h-p.h) >= 0.001) return false;
    }
    return true;
  });
  ck('8-c-1. 주간 VOC TOP5 건수·증감 열이 교체품 TOP5와 행·열 기준으로 정렬된다', topAligned(wItems));
  ck('8-c-2. 월간 VOC TOP5 건수·증감 열이 교체품 TOP5와 행·열 기준으로 정렬된다', topAligned(mItems));

  load([
    { date:'2026-08-04', hosp:'현재병원', gubun:'A/S', type:'출력 약함', part:'Current part' },
    { date:'2026-07-28', hosp:'이전병원', gubun:'A/S', type:'이전 기간 전용 유형', part:'Old part' }
  ]);
  const positiveOnly = D.buildExecutiveReportSnapshot(WEEK);
  ck('8-d. VOC TOP5에서 현재 0건 항목 제외',
    positiveOnly.vocTop.rows.every(r => r.cur > 0) &&
    !positiveOnly.vocTop.rows.some(r => r.k === '이전 기간 전용 유형'));
  ck('8-e. 교체품 TOP5에서 현재 0개 항목 제외',
    positiveOnly.partTop.rows.every(r => r.cur > 0) &&
    !positiveOnly.partTop.rows.some(r => r.k === 'Old part'));
  load(SAMPLE);
}

/* ══════ 9. 특이사항 ══════ */
{
  ck('9. 특이사항 카드 존재', has(wItems, '특이사항') && wSnap.notes.items.length > 0);
  ck('9-b. 월간에도 특이사항 존재', has(mItems, '특이사항') && mSnap.notes.items.length > 0);
  ck('9-c. 특이사항의 기간·사실 기반 보조 문구 제거',
    wSnap.notes.basis === '' && mSnap.notes.basis === '' &&
    !has(wItems, '사실 기반') && !has(mItems, '사실 기반'));
  ck('9-d. 특이사항 4건 이상은 좌우 2열 구분선으로 균형 배치',
    wSnap.notes.items.length >= 4 && wItems.some(o => o.k === 'rect' &&
      o.w === 0.01 && o.y === D.L.notes.listY && o.h > 1));
}

/* ══════ 10~13. 기존 PPT 항목 제외 ══════ */
{
  const wt = allText(wItems), mt = allText(mItems);
  ck('10. Call 현황 미포함', !/Call/i.test(wt) && !/Call/i.test(mt));
  ck('11. 재고 현황 미포함', !/재고/.test(wt) && !/재고/.test(mt) &&
    !/Handpiece \(Repair\)/.test(wt));
  ck('12. 고장 상세 미포함', !/고장 상세/.test(wt) && !/고장 상세/.test(mt));
  ck('13. 별도 N-CARE 가입등급 페이지 미생성',
    wDeck.length === 1 && mDeck.length === 1 &&
    !/N-care 서비스 현황/.test(wt) && !/N-care 서비스 현황/.test(mt) &&
    !/CurePass/.test(wt) && !/가입 병원 수/.test(wt));
  ck('13-b. 점검 유형 별도 페이지 없음', !/점검 유형/.test(wt) && !/점검 유형/.test(mt));
  ck('13-c. 모달에 수기 입력 항목이 남아 있지 않다',
    !/id="wkDetail"/.test(SRC) && !/id="mnDetail"/.test(SRC) &&
    !/id="inv1"/.test(SRC) && !/id="callInInp"/.test(SRC) && !/id="mnCallInInp"/.test(SRC));
  ck('13-d. 모달에는 기간 선택·VOC 설명·특이사항 확인·미리보기·PPT 생성만 남는다',
    /id="wkSel"/.test(SRC) && /previewWeeklyPPT\(\)/.test(SRC) && /id="wkGo"/.test(SRC) &&
    /id="wkVocDescRows"/.test(SRC) && /id="mnVocDescRows"/.test(SRC) &&
    /id="wkNoteRows"/.test(SRC) && /id="mnNoteRows"/.test(SRC) &&
    /id="mnSel"/.test(SRC) && /previewMonthlyPPT\(\)/.test(SRC) && /id="mnGo"/.test(SRC));
}

/* ══════ 14·15. 집계 기준 ══════ */
{
  /* 보고 주차 원본 8행 중 데모 1행이 빠져 7건 — 병원명·유형도 슬라이드에 남지 않는다 */
  ck('14. 데모 운영 기록 제외 (8행 중 데모 1행 제외 → 7건)',
    !has(wItems, '데모센터') && !has(wItems, '데모 점검') &&
    wSnap.kpi[0].value === '7', '전체 ' + wSnap.kpi[0].value + '건');
  /* 8/3 가나병원 장비 2대 → 2건 (병원명+날짜 dedupe 금지) */
  load([
    { date: '2026-08-05', hosp: '가나병원', gubun: 'A/S', type: '노즐누수', sn: 'SN-1' },
    { date: '2026-08-05', hosp: '가나병원', gubun: 'A/S', type: '노즐누수', sn: 'SN-2' }
  ]);
  const s2 = D.buildExecutiveReportSnapshot(WEEK);
  ck('15. 같은 병원·같은 날짜 장비 2대 → 2건',
    s2.kpi[0].value === '2' && s2.kpi[1].value === '2' && s2.kpi[2].value === '0',
    '전체 ' + s2.kpi[0].value + ' / A/S ' + s2.kpi[1].value + ' / 점검 ' + s2.kpi[2].value);
  ck('15-b. 추이 선도 같은 기준(2건)',
    s2.trend.line.pts[s2.trend.line.pts.length - 1].main === 2);
  load(SAMPLE);
}

/* ══════ 16. 대시보드 KPI == PPT KPI ══════ */
{
  const x = rebuildX(WEEK);
  const k = x.kpi.cur, p = x.kpi.prev, cmp = x.cmp;
  const dash = [
    [String(D.exNum(k.total)), D.exDeltaParts(k.total, p ? p.total : null, '건', 'neutral', cmp).text],
    [String(D.exNum(k.as)), D.exDeltaParts(k.as, p ? p.as : null, '건', 'bad', cmp).text],
    [String(D.exNum(k.insp)), D.exDeltaParts(k.insp, p ? p.insp : null, '건', 'neutral', cmp).text]
  ];
  const ppt = wSnap.kpi.map(kp => [kp.value, kp.delta ? kp.delta.text : null]);
  ck('16. 대시보드 공통 핵심 KPI와 PPT KPI가 값·증감 문구까지 동일',
    JSON.stringify(dash) === JSON.stringify(ppt),
    JSON.stringify(dash) + ' vs ' + JSON.stringify(ppt));
  ck('16-b. A/S 비율도 대시보드와 동일', wSnap.kpi[1].note === '비율 ' + k.asRate + '%');
}

/* ══════ 17. 대시보드 특이사항 == PPT 특이사항 ══════ */
{
  const x = rebuildX(WEEK);
  const dashNotes = D.buildExecutiveNotes(x);
  ck('17. 대시보드 특이사항 문장과 PPT 특이사항 문장이 완전히 동일',
    JSON.stringify(dashNotes) === JSON.stringify(wSnap.notes.items),
    dashNotes.length + '문장 vs ' + wSnap.notes.items.length + '문장');
  /* 슬라이드에 실제로 그려진 문장(태그 제거)이 같은지 */
  const plain = s => D.exHtmlRuns_(s).map(r => r.text).join('');
  const drawn = allText(wItems);
  ck('17-b. 특이사항 문장이 슬라이드에 그려진다',
    dashNotes.every(n => {
      const t = plain(n).replace(/\s+/g, '');
      return drawn.replace(/\s+/g, '').indexOf(t) >= 0;
    }));
  ck('17-c. PPT 전용 특이사항 문장을 새로 만들지 않는다 (문장 수 동일)',
    wSnap.notes.items.length === dashNotes.length);
}

/* ══════ 18. 데이터 0건 ══════ */
{
  load([]);
  const z = D.buildExecutiveReportSnapshot(WEEK);
  const zm = D.buildExecutiveReportSnapshot(MONTH);
  const zi = itemsOf(z);
  ck('18. 데이터 0건이어도 주간 1페이지 정상 생성',
    deckOf(z).length === 1 && zi.length > 0);
  ck('18-b. 데이터 0건이어도 월간 1페이지 정상 생성', deckOf(zm).length === 1);
  ck('18-c. 0건이면 KPI 는 0 · 특이사항은 안내 문구',
    z.kpi[0].value === '0' && z.notes.items.length === 1 &&
    /데이터가 없습니다/.test(z.notes.items[0]), z.notes.items[0]);
  ck('18-d. 0건에도 회사 제목·로고·푸터는 유지',
    has(zi, '주간업무보고') && zi.some(o => o.k === 'logo') && has(zi, 'BAZ BIOMEDIC'));
  ck('18-e. 0건에도 빈 카드 안내가 그려진다',
    has(zi, 'A/S 기록 없음') && has(zi, '교체품 기록 없음'));
  load(SAMPLE);
}

/* ══════ 19. 긴 이름 — 잘림·겹침 없음 ══════ */
{
  const LONG_H = '의료법인 성심의료재단 강남세브란스부속 제2진료협력병원 본관';
  const LONG_T = '핸드피스 노즐 어셈블리 약액 유입에 의한 간헐적 분사 불량 및 압력 저하 현상';
  const LONG_P = 'Handpiece Assembly Complete Set (Nozzle + Cable + Connector) Rev.3';
  load([
    { date: '2026-08-03', hosp: LONG_H, gubun: 'A/S', type: LONG_T, part: LONG_P, cost: '999999999' },
    { date: '2026-08-04', hosp: LONG_H, gubun: 'A/S', type: LONG_T, part: LONG_P, cost: '999999999' },
    { date: '2026-07-28', hosp: LONG_H, gubun: 'A/S', type: '노즐누수', part: 'Foot s/w' }
  ]);
  const s3 = D.buildExecutiveReportSnapshot(WEEK);
  const i3 = itemsOf(s3);
  const over = i3.filter(o => o.k === 'text')
    .filter(o => {
      const runs = D.exPptRuns_(o);
      const w = runs.reduce((a, r) => a + D.exTxtW_(r.text, r.size), 0);
      return w > o.w + 0.005;
    });
  ck('19. 긴 병원명·VOC 유형·교체품명이 있어도 칸을 넘지 않는다 (말줄임 적용)',
    over.length === 0, over.slice(0, 3).map(o => JSON.stringify(D.exPptRuns_(o).map(r => r.text).join('')) + ' w=' + o.w).join(' | '));
  ck('19-c. 긴 유형명은 말줄임으로 표기된다', has(i3, '…'));
  load(SAMPLE);
}

/* ══════ 슬라이드 밖 요소 · 카드 겹침 ══════ */
function boundsCheck(items, tag) {
  const P = D.L.page;
  const out = items.filter(o => o.k !== 'line'
    ? (o.x < -0.001 || o.y < -0.001 || o.x + o.w > P.w + 0.001 || o.y + (o.h || 0) > P.h + 0.001)
    : (o.x < -0.001 || o.x + o.w > P.w + 0.001 || o.y < -0.001 || o.y > P.h + 0.001));
  ck(tag + ' 슬라이드(16:9) 밖으로 나간 요소 없음', out.length === 0,
    out.slice(0, 3).map(o => o.k + ' ' + [o.x, o.y, o.w, o.h].join(',')).join(' | '));
}
function overlapCheck(items, tag) {
  const cards = items.filter(o => o.card);
  const bad = [];
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    const a = cards[i], b = cards[j];
    if (a.x < b.x + b.w - 0.001 && b.x < a.x + a.w - 0.001 &&
      a.y < b.y + b.h - 0.001 && b.y < a.y + a.h - 0.001) bad.push([i, j]);
  }
  ck(tag + ' 카드끼리 겹치지 않음', bad.length === 0, JSON.stringify(bad.slice(0, 3)));
}
boundsCheck(wItems, '주간 ·');
boundsCheck(mItems, '월간 ·');
overlapCheck(wItems, '주간 ·');
overlapCheck(mItems, '월간 ·');
ck('16:9 비율(13.33 × 7.5 inch)', Math.abs(D.L.page.w / D.L.page.h - 16 / 9) < 0.002);

/* ══════ 20. 미리보기 == 실제 PPT ══════ */
{
  /* 미리보기와 PPT 는 buildExecutivePptDeck() 결과 하나만 그린다 — 같은 스냅샷이면 같은 목록 */
  const a = JSON.stringify(deckOf(wSnap)), b = JSON.stringify(deckOf(wSnap));
  ck('20. 미리보기와 실제 PPT 가 같은 표시 목록을 쓴다 (결정적·동일)', a === b);
  ck('20-b. 미리보기 backend 와 PPT backend 가 같은 목록을 입력받는다',
    /buildExecutivePptDeck\(snap\)\.forEach\(function\(sl\)\{\s*var holder/.test(SRC.replace(/\n/g, ' ')) === false
      ? /exPreviewReport/.test(SRC) && /exMakeReportPPT/.test(SRC)
      : true);
  ck('20-c. 두 backend 모두 exPptRuns_() 로 같은 텍스트를 읽는다',
    (SRC.match(/exPptRuns_\(o\)/g) || []).length >= 2);
  const mA = JSON.stringify(deckOf(mSnap)), mB = JSON.stringify(deckOf(mSnap));
  ck('20-d. 월간도 동일', mA === mB);
}

/* ══════ 21. 회사 제목·로고·푸터 ══════ */
{
  ck('21. 회사 기본 양식 제목 문구 유지', has(wItems, 'CS팀 주간업무보고') &&
    has(mItems, 'CS팀 월간업무보고'));
  ck('21-b. 회사 기본 양식의 필드 현황·보고기간 표기',
    /필드 현황 \(8월 1주차\) 8월 3일 ~ 8월 7일/.test(allText(wItems)) &&
    /필드 현황 \(8월\) 8월 1일 ~ 8월 31일/.test(allText(mItems)));
  ck('21-c. 우측 BAZ 로고 유지',
    wItems.some(o => o.k === 'logo' && o.x > 11.5) && mItems.some(o => o.k === 'logo'));
  ck('21-d. 상단 네이비 제목 영역 · 하단 네이비 푸터',
    wItems.some(o => o.k === 'rect' && o.fill === D.C.navy && o.y === D.L.header.barY) &&
    wItems.some(o => o.k === 'rect' && o.fill === D.C.navy && o.y === D.L.foot.y));
  ck('21-e. BAZ BIOMEDIC 표기 유지', has(wItems, 'BAZ BIOMEDIC') && has(mItems, 'BAZ BIOMEDIC'));
  ck('21-f. 흰색 본문 배경 (다크모드여도 라이트 양식)',
    wItems[0].k === 'rect' && wItems[0].fill === D.C.white &&
    wItems[0].w === D.L.page.w && wItems[0].h === D.L.page.h);
  ck('21-g. 회사 글꼴(맑은 고딕) 유지', D.FT.face === '맑은 고딕');
}

/* ══════ 22. 파일명 규칙 ══════ */
{
  ck('22. 주간 파일명 규칙 유지', wSnap.fileName === '주간업무보고_2026년8월1주차.pptx', wSnap.fileName);
  ck('22-b. 월간 파일명 규칙 유지', mSnap.fileName === '월간업무보고_2026년8월.pptx', mSnap.fileName);
}

/* ══════ 추가 권장 문구 ══════ */
{
  ck('P1. 집계 기준 문구를 제목 근처에 작게 표기',
    wSnap.basis === '처리일 기준 · 고객 서비스 · 데모 운영 제외' &&
    wItems.some(o => o.k === 'text' && o.y === D.L.header.basisY &&
      D.exPptRuns_(o)[0].text === wSnap.basis));
  ck('P2. 기준 문구는 별도 카드가 아니다',
    !wItems.some(o => o.card && o.y === D.L.header.basisY));
}

/* ══════ 데이터 단일화 — 스냅샷이 대시보드 상태를 바꾸지 않는다 ══════ */
{
  load(SAMPLE);
  const f = D.getF();
  f.from = '2026-07-01'; f.to = '2026-07-31';
  D.setF(f);
  const before = JSON.stringify({ from: D.getF().from, to: D.getF().to, cmp: D.getEXCMP() });
  D.buildExecutiveReportSnapshot(WEEK);
  const after = JSON.stringify({ from: D.getF().from, to: D.getF().to, cmp: D.getEXCMP() });
  ck('S1. 스냅샷 생성이 화면 기간(F)·비교 토글을 되돌린다', before === after, before + ' vs ' + after);
  load(SAMPLE);
}

/* ══════ 레이아웃 비율 (권장 레이아웃) ══════ */
{
  const W = D.L.W;
  const tr = D.L.trend.w / W, ch = D.L.change.w / W;
  ck('R1. 추이 60~65% · VOC 변화 35~40%',
    tr >= 0.60 && tr <= 0.65 && ch >= 0.35 && ch <= 0.40,
    (tr * 100).toFixed(1) + '% / ' + (ch * 100).toFixed(1) + '%');
  /* 하단은 상단 열 경계를 그대로 잇는다 — 특이사항이 VOC 유형 변화 바로 아래에 정렬된다 */
  ck('R2. 특이사항 x·폭이 VOC 유형 변화와 정확히 동일',
    Math.abs(D.L.notes.x - D.L.change.x) < 0.001 &&
    Math.abs(D.L.notes.w - D.L.change.w) < 0.001,
    'notes x=' + D.L.notes.x.toFixed(3) + ' w=' + D.L.notes.w.toFixed(3) +
    ' / change x=' + D.L.change.x.toFixed(3) + ' w=' + D.L.change.w.toFixed(3));
  ck('R3. KPI 3장이 본문 폭을 정확히 채운다',
    Math.abs(D.L.kpi.w * 3 + D.L.kpi.gap * 2 - W) < 0.001);
  ck('R4. TOP5 두 장 + gap 이 서비스 추이 카드 폭과 정확히 동일',
    Math.abs(D.L.voc.w + D.L.gap + D.L.part.w - D.L.trend.w) < 0.001,
    D.L.voc.w.toFixed(3) + ' + ' + D.L.gap + ' + ' + D.L.part.w.toFixed(3) +
    ' vs ' + D.L.trend.w.toFixed(3));
  ck('R5. 두 TOP5 카드가 개편 전(3.45 / 2.95)보다 넓다',
    D.L.voc.w > 3.45 && D.L.part.w > 2.95,
    'voc=' + D.L.voc.w.toFixed(2) + ' part=' + D.L.part.w.toFixed(2));
  ck('R6. 하단 카드가 왼쪽부터 빈틈없이 이어진다',
    Math.abs(D.L.voc.x - D.L.page.left) < 0.001 &&
    Math.abs(D.L.part.x - (D.L.voc.x + D.L.voc.w + D.L.gap)) < 0.001 &&
    Math.abs(D.L.notes.x + D.L.notes.w - D.L.page.right) < 0.001);
}

/* ══════ 특이사항 자동 배치 (글자를 무조건 줄이지 않는다) ══════ */
{
  const short = ['짧은 문장 하나입니다.'];
  const laid = D.exNotesLayout_(short, 5.9, 1.48);
  ck('N1. 여유가 있으면 본문 최대 크기(9pt) 유지', laid.size === D.FT.note, 'size=' + laid.size);
  const many = Array.from({ length: 14 }, (_, i) =>
    (i + 1) + '. 매우 긴 특이사항 문장으로 카드 높이를 넘기도록 만든 검증용 문장입니다. 숫자 ' + (i * 37) + '건.');
  const laid2 = D.exNotesLayout_(many, 5.9, 1.48);
  const bottom = laid2.lines.length ? laid2.lines[laid2.lines.length - 1].y + laid2.lh : 0;
  ck('N2. 문장이 많아도 카드 높이를 넘지 않는다', bottom <= 1.48 + 0.001, 'h=' + bottom.toFixed(3));
  ck('N3. 최소 본문 크기(8pt) 아래로는 줄이지 않는다', laid2.size >= 8, 'size=' + laid2.size);
  ck('N4. 넘칠 때는 남은 건수를 알린다',
    laid2.lines.map(l => l.runs.map(r => r.text).join('')).join('').indexOf('외 ') >= 0);
  ck('N5. 증감 강조(<b class="ex-up">)는 빨강으로 옮긴다',
    D.exHtmlRuns_('전주보다 A/S가 <b class="ex-up">3건 증가</b>했습니다.')
      .some(r => r.color === D.C.red && r.text === '3건 증가'));
  ck('N6. 감소 강조는 초록으로 옮긴다',
    D.exHtmlRuns_('전주보다 A/S가 <b class="ex-down">3건 감소</b>했습니다.')
      .some(r => r.color === D.C.green));
  const wrappedNewlines = D.exWrapRuns_([{ text: '첫 줄\r\n둘째 줄', bold: false, color: null }], 10, 9);
  ck('N7. CR은 무시하고 LF는 실제 새 줄로 분리한다',
    wrappedNewlines.length === 2 &&
    wrappedNewlines.map(line => line.map(r => r.text).join('')).join('|') === '첫 줄|둘째 줄');
}

/* ══════ 텍스트 한 줄 유지 (제목·KPI 숫자·표 내용) ══════ */
{
  const singleLine = items => items.filter(o => o.k === 'text').every(o => {
    const runs = D.exPptRuns_(o);
    return runs.every(r => r.text.indexOf('\n') < 0);
  });
  ck('T1. 주간 — 의도치 않은 줄바꿈 문자 없음', singleLine(wItems));
  ck('T2. 월간 — 의도치 않은 줄바꿈 문자 없음', singleLine(mItems));
  const fits = items => items.filter(o => o.k === 'text').filter(o => {
    const runs = D.exPptRuns_(o);
    const w = runs.reduce((a, r) => a + D.exTxtW_(r.text, r.size), 0);
    return w > o.w + 0.005;
  });
  ck('T3. 주간 — 모든 텍스트가 자기 칸 안에 들어간다', fits(wItems).length === 0,
    fits(wItems).slice(0, 3).map(o => D.exPptRuns_(o).map(r => r.text).join('')).join(' | '));
  ck('T4. 월간 — 모든 텍스트가 자기 칸 안에 들어간다', fits(mItems).length === 0,
    fits(mItems).slice(0, 3).map(o => D.exPptRuns_(o).map(r => r.text).join('')).join(' | '));
}

/* ══════ 기존 대시보드 기능 유지 확인(원문 기준) ══════ */
{
  ck('K1. 보고 모드 ① 주간 핵심보고 유지', /① 주간 핵심보고/.test(SRC) && /function renderExecutiveSummary/.test(SRC));
  ck('K2. 상세 분석·토요일 당직 분석 유지',
    /function renderDetailedDashboard/.test(SRC) && /토요일/.test(SRC));
  ck('K3. 대시보드가 buildExecutiveNotes() 결과를 그대로 쓴다',
    /var s=buildExecutiveNotes\(x, \{up:up, monthNote:mNote\}\);/.test(SRC));
  ck('K4. 회사 로고 자산 참조 유지', /logo\.png/.test(SRC));
  ck('K5. PPT 라이브러리 로드 경로 유지', /pptxgenjs@3\.12\.0/.test(SRC));
}

/* ══════ PPT 특이사항 편집 (목표 3) ══════
   자동 생성 원천은 buildExecutiveNotes() 하나뿐이고, 편집 결과는 이 PPT에만 반영된다. */
{
  load(SAMPLE);
  const snapOf = (period, notes) => D.buildExecutiveReportSnapshot(
    notes === undefined ? Object.assign({}, period)
                        : Object.assign({}, period, { notes: notes }));

  /* 대시보드 자동 특이사항 (비교용 기준값) */
  const autoW = snapOf(WEEK).notes.items;
  const autoM = snapOf(MONTH).notes.items;
  ck('E1. 수정하지 않으면 자동 특이사항과 정확히 동일 (주간)',
    JSON.stringify(snapOf(WEEK).notes.items) === JSON.stringify(autoW) && autoW.length > 0,
    autoW.length + '문장');
  ck('E1-b. 수정하지 않으면 자동 특이사항과 정확히 동일 (월간)',
    JSON.stringify(snapOf(MONTH).notes.items) === JSON.stringify(autoM) && autoM.length > 0);
  ck('E1-c. 편집 전에는 자동 문장의 HTML 강조가 그대로 보존된다',
    autoW.some(t => /<b[ >]/.test(t)), autoW[0]);
  ck('E1-d. override 없음은 edited=false 로 구분된다', snapOf(WEEK).notes.edited === false);

  /* 한 문장만 수정 */
  const edited1 = autoW.slice();
  edited1[1] = D.esc('현장 재방문이 필요한 병원 2곳을 다음 주에 우선 처리합니다.');
  const s1 = snapOf(WEEK, edited1);
  ck('E2. 한 문장 수정 시 그 문장만 바뀐다',
    s1.notes.items[1] === edited1[1] &&
    s1.notes.items.filter((t, i) => i !== 1 && t !== autoW[i]).length === 0,
    s1.notes.items[1]);
  ck('E2-b. 수정된 스냅샷은 edited=true', s1.notes.edited === true);
  ck('E2-c. 수정 문장이 실제 표시 목록(PPT)에 그려진다',
    allText(itemsOf(s1)).replace(/\s+/g, '')
      .indexOf('현장 재방문이 필요한 병원 2곳을 다음 주에 우선 처리합니다.'.replace(/\s+/g, '')) >= 0);

  /* 빈 문장 제외 — exNoteOverride_ 가 걸러낸다 */
  D.setNoteEdits('week', [autoW[0], '', '   ', autoW[3] || autoW[0]]);
  const ov = D.exNoteOverride_('week');
  ck('E3. 비운 문장은 override 에서 제외된다', ov.length === 2, JSON.stringify(ov.length));
  ck('E3-b. 빈 문장을 제외한 목록만 PPT에 실린다',
    snapOf(WEEK, ov).notes.items.length === 2);

  /* 전부 제거 */
  D.setNoteEdits('week', autoW.map(() => ''));
  const none = D.exNoteOverride_('week');
  ck('E4. 전부 지우면 override 는 빈 배열', Array.isArray(none) && none.length === 0);
  const emptySnap = snapOf(WEEK, none);
  const emptyItems = itemsOf(emptySnap);
  ck('E4-b. 전부 제거해도 카드 제목은 유지되고 본문은 "특이사항 없음"',
    has(emptyItems, '특이사항') && has(emptyItems, '특이사항 없음'),
    allText(emptyItems).indexOf('특이사항 없음') >= 0 ? 'ok' : 'missing');
  ck('E4-c. 전부 제거해도 슬라이드는 1장, 다른 카드는 그대로',
    deckOf(emptySnap).length === 1 && has(emptyItems, 'VOC 유형 TOP 5') &&
    has(emptyItems, '교체품 TOP 5') && has(emptyItems, 'BAZ BIOMEDIC'));

  /* 손대지 않은 상태 복귀 */
  D.setNoteEdits('week', null);
  ck('E5. 되돌리면 override 가 undefined 로 돌아간다', D.exNoteOverride_('week') === undefined);
  ck('E5-b. 되돌린 뒤 자동 특이사항과 다시 정확히 동일',
    JSON.stringify(snapOf(WEEK).notes.items) === JSON.stringify(autoW));

  /* 대시보드 자동 특이사항은 영향 없음 */
  D.setNoteEdits('week', ['편집된 문장']);
  const xNow = (() => {
    const f = D.getF(); f.from = WEEK.from; f.to = WEEK.to; D.setF(f);
    return D.exBuild(D.exWindowRows(new Date(WEEK.from + 'T00:00:00'),
      new Date(WEEK.to + 'T23:59:59')));
  })();
  ck('E6. 대시보드 자동 특이사항(buildExecutiveNotes)은 편집에 영향받지 않는다',
    JSON.stringify(D.buildExecutiveNotes(xNow)) === JSON.stringify(autoW));
  ck('E6-b. 월간 편집이 주간에 섞이지 않는다',
    D.exNoteOverride_('month') === undefined && D.exNoteOverride_('week').length === 1);
  D.setNoteEdits('week', null);

  /* 미리보기 == 실제 PPT (같은 스냅샷 → 같은 표시 목록) */
  const eW = autoW.slice(); eW[0] = D.esc('주간 편집 확인 문장');
  const eM = autoM.slice(); eM[0] = D.esc('월간 편집 확인 문장');
  ck('E7. 편집 반영 후에도 미리보기와 실제 PPT 표시 목록이 동일 (주간)',
    JSON.stringify(deckOf(snapOf(WEEK, eW))) === JSON.stringify(deckOf(snapOf(WEEK, eW))));
  ck('E7-b. 주간·월간 모두 편집이 반영된다',
    allText(itemsOf(snapOf(WEEK, eW))).indexOf('주간 편집 확인 문장') >= 0 &&
    allText(itemsOf(snapOf(MONTH, eM))).indexOf('월간 편집 확인 문장') >= 0);
  ck('E7-c. 편집해도 슬라이드는 여전히 1장',
    deckOf(snapOf(WEEK, eW)).length === 1 && deckOf(snapOf(MONTH, eM)).length === 1);

  /* 편집 텍스트 escape */
  const evil = D.esc('<b onclick="x">주입</b> & "따옴표"');
  const sE = snapOf(WEEK, [evil]);
  ck('E8. 편집 텍스트는 escape 되어 스냅샷에 들어간다',
    sE.notes.items[0].indexOf('<b onclick') < 0 && sE.notes.items[0].indexOf('&lt;b') >= 0);
  ck('E8-b. escape 된 문장은 태그가 아니라 글자로 그려진다',
    allText(itemsOf(sE)).indexOf('<b onclick="x">주입</b>') >= 0);
  const vocEditorSrc = grab('exRefreshVocDescEditor_');
  ck('E8-c. VOC 설명 편집기 속성은 따옴표까지 escape 한다',
    /title="'\+escAttr\(r\.k\)/.test(vocEditorSrc) &&
    /data-key="'\+escAttr\(k\)/.test(vocEditorSrc) &&
    /value="'\+escAttr\(v\)/.test(vocEditorSrc));

  /* 평문 변환 — 편집 입력창에 넣을 값 */
  ck('E9. exNotePlain_ 은 강조 태그만 벗기고 문장은 유지',
    D.exNotePlain_('전주보다 A/S가 <b class="ex-up">3건 증가</b>했습니다.')
      === '전주보다 A/S가 3건 증가했습니다.');
  ck('E9-b. escape 된 편집 문장도 원래 글자로 되읽는다',
    D.exNotePlain_(D.esc('A & B <C>')) === 'A & B <C>');

  /* 자동 생성 함수를 새로 만들지 않았는지 */
  ck('E10. PPT 전용 자동 특이사항 생성 함수를 만들지 않았다',
    (SRC.match(/function buildExecutiveNotes\(/g) || []).length === 1 &&
    /snap\.notes\.items/.test(SRC) &&
    !/function build(Ppt|Report)Notes/.test(SRC));
  ck('E11. 편집 내용은 저장하지 않는다 (localStorage·시트 미사용)',
    !/localStorage[^\n]*NOTE|EX_NOTE_EDITS[^\n]*localStorage/.test(SRC));
  ck('E12. 보고 기간이 바뀌면 편집이 초기화된다',
    /function exOnReportPeriodChange_\(type\)\{[\s\S]{0,200}EX_NOTE_EDITS\[type\]=null;/.test(SRC));
  load(SAMPLE);
}

/* ══════ 특이사항 1열/2열 자동 선택 (목표 4) ══════ */
{
  const T = D.L.notes, boxH = T.y + T.h - T.listPadB - T.listY;
  const one = D.exNotesPlan_(['짧은 문장 하나.'], T, boxH);
  ck('P1. 항목이 1개면 1열', one.cols === 1);
  const many = Array.from({ length: 6 }, (_, i) =>
    (i + 1) + '. 보고 기간 중 확인된 사실을 적는 특이사항 문장입니다. 값 ' + (i * 13) + '건.');
  const plan = D.exNotesPlan_(many, T, boxH);
  ck('P2. 문장 수만 보고 무조건 2열로 만들지 않는다 (넘침이 적은 쪽 선택)',
    plan.cols === 1 || plan.cols === 2, 'cols=' + plan.cols + ' dropped=' + plan.dropped);
  ck('P3. 8pt 아래로 줄이지 않는다', plan.size >= 8, 'size=' + plan.size);
  const bottom = c => {
    const l = plan.lays[c];
    return l && l.lines.length ? l.lines[l.lines.length - 1].y + l.lh : 0;
  };
  ck('P4. 어느 열도 카드 높이를 넘지 않는다',
    bottom(0) <= boxH + 0.001 && bottom(1) <= boxH + 0.001,
    bottom(0).toFixed(3) + ' / ' + bottom(1).toFixed(3) + ' <= ' + boxH.toFixed(3));
  const huge = Array.from({ length: 20 }, (_, i) =>
    (i + 1) + '. 카드 높이를 확실히 넘기도록 만든 아주 긴 특이사항 검증 문장입니다. 값 ' + (i * 37) + '건.');
  const hp = D.exNotesPlan_(huge, T, boxH);
  ck('P5. 넘치면 남은 항목 수를 알린다', hp.dropped > 0 &&
    hp.lays.some(l => l && l.lines.map(x => x.runs.map(r => r.text).join('')).join('').indexOf('외 ') >= 0),
    'dropped=' + hp.dropped);
}

/* ══════ V. 추이 그래프 — 이번 구간 ↔ 직전 같은 길이 구간을 겹쳐 본다 (연간 비교분석 탭 방식) ══════ */
{
  /* 16주 표본: 앞 8주(직전 구간)는 평평하고, 뒤 8주(최근 구간)에서 노즐누수는 늘고 케이블은 준다 */
  const rows = [];
  const mondays = [];
  for (let i = 15; i >= 0; i--) {
    const d = new Date('2026-08-03T00:00:00'); d.setDate(d.getDate() - 7 * i); mondays.push(D.ymd(d));
  }
  mondays.forEach((w, i) => {
    const day = k => { const x = new Date(w + 'T00:00:00'); x.setDate(x.getDate() + k); return D.ymd(x); };
    const recent = i >= 8, j = i - 8;
    const leak = recent ? j + 2 : 2;            /* 최근 8주 2→9 (합 44) · 직전 8주 2 (합 16) */
    const cable = recent ? 9 - j : 9;           /* 최근 8주 9→2 (합 44) · 직전 8주 9 (합 72) */
    for (let k = 0; k < leak; k++) rows.push({ date: day(k % 5), hosp: '가나병원', gubun: 'A/S', type: '노즐누수(약액 유입)' });
    for (let k = 0; k < cable; k++) rows.push({ date: day(k % 5), hosp: '다라의원', gubun: 'A/S', type: '케이블 단선' });
    rows.push({ date: day(1), hosp: '마바병원', gubun: '점검', type: '정기점검' });
    rows.push({ date: day(2), hosp: '사아의원', gubun: 'A/S', type: '이상 없음' });
  });
  load(rows);
  const snapOf = f => D.buildExecutiveReportSnapshot(Object.assign({ vocFocus: f }, WEEK));
  const plain = snapOf('');
  const leak = snapOf('노즐누수(약액 유입)');
  const cable = snapOf('케이블 단선');
  const asOnly = snapOf('__as__');
  const inspOnly = snapOf('__insp__');

  ck('V1. 유형 목록은 추이 구간(8주)에서 실제로 센 유형만 담는다',
    plain.vocOptions.length === 2 &&
    plain.vocOptions.every(o => o.k !== '정기점검' && o.k !== '이상 없음'),
    plain.vocOptions.map(o => o.k + ':' + o.n).join(' / '));
  ck('V1-b. 목록 건수는 그 유형의 최근 8주 합계와 같다',
    plain.vocOptions.find(o => o.k === '노즐누수(약액 유입)').n === leak.trend.line.sum,
    'options=' + plain.vocOptions[0].n + ' line.sum=' + leak.trend.line.sum);

  ck('V2. 겹치는 두 계열은 최근 8주와 직전 8주다',
    leak.trend.line.mainName === '최근 8주' && leak.trend.line.refName === '직전 8주' &&
    leak.trend.line.pts.map(p => p.main).join(',') === '2,3,4,5,6,7,8,9' &&
    leak.trend.line.pts.every(p => p.ref === 2),
    leak.trend.line.pts.map(p => p.main + '/' + p.ref).join(' '));
  ck('V2-b. 차이 막대는 같은 주차끼리(최근 − 직전)',
    leak.trend.line.deltas.join(',') === '0,1,2,3,4,5,6,7',
    JSON.stringify(leak.trend.line.deltas));
  ck('V3. 합계 비교로 증가·감소를 판정',
    leak.trend.line.cmp.dir === 'up' && leak.trend.line.sum === 44 && leak.trend.line.prevSum === 16 &&
    cable.trend.line.cmp.dir === 'down' && cable.trend.line.prevSum === 72,
    leak.trend.line.cmp.label + ' / ' + cable.trend.line.cmp.label);
  ck('V3-b. 직전 구간이 0건이면 증감률을 내지 않는다', (() => {
    load(rows.filter(r => new Date(r.date) >= new Date('2026-06-15')));
    const only8 = snapOf('노즐누수(약액 유입)');
    load(rows);
    return only8.trend.line.prevSum === 0 && only8.trend.line.cmp.pct === null &&
           only8.trend.line.cmp.foot.includes('직전 구간 0건');
  })());

  ck('V4. 드롭다운으로 전체·A/S·점검·유형 중 무엇을 셀지 고른다',
    plain.trend.line.pts.every((p, i) => p.main === asOnly.trend.line.pts[i].main + inspOnly.trend.line.pts[i].main) &&
    inspOnly.trend.line.pts.every(p => p.main === 1) &&
    asOnly.trend.line.metricLabel === 'A/S(VOC)' && inspOnly.trend.line.metricLabel === '점검' &&
    plain.trend.line.metricLabel === '전체 처리(A/S·점검)');
  ck('V5. 카드 제목·기준 줄이 무엇을 어느 기간과 견주는지 밝힌다',
    leak.trend.title.includes('노즐누수(약액 유입)') && leak.trend.title.includes('직전 8주 대비') &&
    leak.trend.basis.includes('집계 대상 노즐누수(약액 유입)') && leak.trend.basis.includes('↔'),
    leak.trend.title);
  ck('V6. 유형 선택은 추이 카드에만 적용된다 (기존 KPI 3장·TOP5·특이사항은 전체 기준)',
    JSON.stringify(leak.kpi.slice(0, 3)) === JSON.stringify(plain.kpi) &&
    JSON.stringify(leak.vocTop) === JSON.stringify(plain.vocTop) &&
    JSON.stringify(leak.partTop) === JSON.stringify(plain.partTop) &&
    JSON.stringify(leak.notes) === JSON.stringify(plain.notes));
  ck('V6-b. 고른 VOC 유형의 보고 기간 건수를 KPI 줄에 한 장 더 싣는다', (() => {
    const c = leak.kpi[3];
    /* 8/3~8/7 주에 노즐누수 9건(최근 8주 마지막 구간) · 전주 8건 */
    return leak.kpi.length === 4 && c.key === 'vocFocus' && c.label === '노즐누수(약액 유입)' &&
      c.value === '9' && c.unit === '건' && /▲ 1건/.test(c.delta.text) && c.delta.tone === 'up' &&
      c.value === String(leak.trend.line.last.main) &&
      c.note === '비율 ' + Math.round(9 / Number(leak.kpi[0].value.replace(/,/g, '')) * 100) + '%';
  })(), JSON.stringify(leak.kpi[3]));
  ck('V6-c. 전체·A/S·점검을 고르면 KPI 는 3장 그대로 (이미 있는 카드와 겹치지 않는다)',
    plain.kpi.length === 3 && asOnly.kpi.length === 3 && inspOnly.kpi.length === 3);
  ck('V6-d. KPI 4장도 한 줄 — y 좌표가 같고 본문 폭을 꽉 채운다', (() => {
    const cards = itemsOf(leak).filter(o => o.card && o.y === D.L.kpi.y);
    if (cards.length !== 4) return false;
    const P = D.L.page, K = D.L.kpi;
    const last = cards[cards.length - 1];
    return cards.every(c => Math.abs(c.w - K.widthFor(4)) < 0.001) &&
      Math.abs(cards[0].x - P.left) < 0.001 &&
      Math.abs(last.x + last.w - P.right) < 0.01;
  })());
  ck('V6-e. 카드 숫자는 추이 그래프와 같은 유형 판정을 쓴다',
    D.exCountVocType_([{ gubun: 'A/S', type: '노즐누수(약액 유입)' }, { gubun: '점검', type: '노즐누수(약액 유입)' },
                       { gubun: 'A/S', type: '이상 없음' }, { gubun: '설치', type: '노즐누수(약액 유입)' }],
                      '노즐누수(약액 유입)') === 2);

  /* 표시 목록 — 연간 탭과 같은 구성(선·점·차이 막대)이 실제로 그려지는지 */
  const fi = itemsOf(leak);
  const segs = fi.filter(o => o.k === 'seg'), dots = fi.filter(o => o.k === 'dot');
  ck('V7. 막대그래프가 아니라 꺾은선으로 그린다 (구간 사이 선 + 점)',
    segs.length >= 7 * 2 && dots.length === 16, 'seg=' + segs.length + ' dot=' + dots.length);
  ck('V7-b. 직전 구간은 파선으로 구분한다', segs.some(o => o.dash) && segs.some(o => !o.dash));
  ck('V8. 차이 막대는 증가 빨강 · 감소 초록', (() => {
    const up = itemsOf(leak), dn = itemsOf(cable);
    return up.some(o => o.k === 'rect' && o.fill === D.C.red) &&
           dn.some(o => o.k === 'rect' && o.fill === D.C.green);
  })());
  ck('V9. 두 기간의 값을 모두 숫자로 적는다 (인쇄물에는 마우스오버가 없다)',
    leak.trend.line.pts.every(p => has(fi, String(p.main)) && has(fi, String(p.ref))));
  ck('V10. 선·점·차이 막대가 카드 안에 머문다', (() => {
    const T = D.L.trend, top = T.y, bot = T.y + T.h;
    return segs.concat(dots).every(o => o.k === 'seg'
      ? (o.y1 >= top && o.y1 <= bot && o.y2 >= top && o.y2 <= bot)
      : (o.cy - o.r >= top && o.cy + o.r <= bot));
  })());
  ck('V11. 핵심 수치 4칸(기준 주·최근 합계·직전 합계·증감)',
    leak.trend.stats.length === 4 &&
    has(fi, '최근 8주 합계') && has(fi, '직전 8주 합계') && has(fi, '직전 8주 대비'));

  /* 진행 중 구간 — 아직 기간이 덜 차 견줄 수 없다 */
  const today = D.exToday(), mon = D.monday(today);
  if (today < D.addD(mon, 4)) {
    load(rows.concat([{ date: D.ymd(mon), hosp: '가나병원', gubun: 'A/S', type: '노즐누수(약액 유입)' }]));
    const cur = D.buildExecutiveReportSnapshot({
      type: 'week', from: D.ymd(mon), to: D.ymd(today), vocFocus: '노즐누수(약액 유입)' });
    const pts = cur.trend.line.pts;
    ck('V12. 진행 중인 주는 차이 막대를 내지 않는다',
      pts[pts.length - 1].ongoing && cur.trend.line.deltas[pts.length - 1] === null);
  }

  /* ── 값 라벨 자리 ──
     두 선이 교차하거나 값이 붙으면 숫자가 서로/점 위에 겹쳐 읽을 수 없게 된다.
     교차·동일값·0·최댓값이 모두 들어간 표본으로 라벨 자리를 검사한다. */
  {
    const PL = D.L.trend.plot, lineBot = PL.top + PL.h;
    const lay = snap => {
      const v = itemsOf(snap).filter(o => o.trendVal);
      const by = {};
      v.forEach(o => { (by[o.trendIdx] = by[o.trendIdx] || {})[o.trendVal] = o; });
      return { all: v, by: by };
    };
    /* 최근 8주 ↔ 직전 8주가 여러 번 교차하고 0·최댓값·같은 값이 섞인 표본 */
    const CUR = [9, 20, 9, 13, 8, 6, 9, 6], PREV = [9, 7, 6, 6, 5, 10, 8, 0];
    const rows2 = [];
    const mon2 = [];
    for (let i = 15; i >= 0; i--) {
      const d = new Date('2026-08-03T00:00:00'); d.setDate(d.getDate() - 7 * i); mon2.push(D.ymd(d));
    }
    mon2.forEach((w, i) => {
      const day = k => { const x = new Date(w + 'T00:00:00'); x.setDate(x.getDate() + k); return D.ymd(x); };
      const n = i >= 8 ? CUR[i - 8] : PREV[i];
      for (let k = 0; k < n; k++) rows2.push({ date: day(k % 5), hosp: '가나병원', gubun: 'A/S', type: '노즐누수(약액 유입)' });
    });
    load(rows2);
    const cross = D.buildExecutiveReportSnapshot(Object.assign({ vocFocus: '노즐누수(약액 유입)' }, WEEK));
    const L2 = lay(cross);
    ck('V14. 구간마다 두 계열의 값을 모두 적는다',
      L2.all.length === 16 && cross.trend.line.pts.every((p, i) =>
        L2.by[i].main.t === String(p.main) && L2.by[i].ref.t === String(p.ref)));
    ck('V14-b. 같은 구간의 두 숫자가 세로로 겹치지 않는다', (() => {
      return cross.trend.line.pts.every((p, i) => {
        const a = L2.by[i].main, b = L2.by[i].ref;
        return Math.abs((a.y + a.h / 2) - (b.y + b.h / 2)) >= PL.numH - 0.001;
      });
    })(), cross.trend.line.pts.map((p, i) =>
      p.main + '/' + p.ref + ':' + (L2.by[i].main.y < L2.by[i].ref.y ? '↑' : '↓')).join(' '));
    ck('V14-c. 값이 큰 쪽이 위, 작은 쪽이 아래에 온다 (자리가 있는 구간)',
      cross.trend.line.pts.every((p, i) => {
        if (p.main === p.ref) return true;
        const hi = p.main > p.ref ? L2.by[i].main : L2.by[i].ref;
        const lo = p.main > p.ref ? L2.by[i].ref : L2.by[i].main;
        return hi.y < lo.y;
      }));
    ck('V14-d. 숫자가 증감 밴드·카드 밖으로 나가지 않는다',
      L2.all.every(o => o.y >= PL.top - PL.headPad - 0.001 &&
                        o.y + o.h <= lineBot + PL.labPad + 0.001));
    ck('V14-e. 증감 막대는 실제 최대 차이에 맞춰 그린다 (작은 차이가 눌리지 않는다)', (() => {
      const dmax = Math.max.apply(null, cross.trend.line.deltas.filter(d => d != null).map(Math.abs));
      return has(itemsOf(cross), '+' + dmax) && has(itemsOf(cross), '−' + dmax);
    })());
    load(rows);
  }

  /* 월간도 같은 방식 — 직전 6개월과 겹친다 */
  const mLeak = D.buildExecutiveReportSnapshot(Object.assign({ vocFocus: '노즐누수(약액 유입)' }, MONTH));
  ck('V13. 월간은 최근 6개월과 직전 6개월을 겹친다',
    mLeak.trend.line.mainName === '최근 6개월' && mLeak.trend.line.refName === '직전 6개월' &&
    mLeak.trend.line.pts.length === 6 && mLeak.trend.line.pts.every(p => typeof p.ref === 'number'),
    mLeak.trend.title);
  load(SAMPLE);
}

console.log('\n──────────────────────────────');
console.log(`통과 ${pass}/${total}`);
if (fails.length) { console.log('실패:'); fails.forEach(f => console.log(' -', f)); process.exit(1); }
console.log('모든 테스트 통과 ✅');
