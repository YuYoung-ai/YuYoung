// 실행: node test/dashboard-history-comparison.mjs
// --fixture=<경로> 옵션은 운영 데이터/인증 없이 실제 모달 함수·CSS로 UI 검증용 HTML을 만든다.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const SRC=fs.readFileSync(new URL('../dashboard-pc.html',import.meta.url),'utf8');
function grab(name){
  const at=SRC.search(new RegExp('\\b(?:async\\s+)?function\\s+'+name+'\\s*\\('));
  assert.ok(at>=0,name);
  let depth=0;
  for(let i=SRC.indexOf('{',at);i<SRC.length;i++){
    if(SRC[i]==='{') depth++;
    else if(SRC[i]==='}'&&!--depth) return SRC.slice(at,i+1);
  }
  throw new Error(name);
}
const FNS=['nkey','rowDate','ymd','esc','escAttr','skCmpKo_','exNum','isOK',
  'hpCleanKey_','hpIsLeakVoc_','hpCleanDays_','isHandpieceCleaning_','vocTypeCanonical_',
  'isDemoRecord','recScope','exPeriodLabel','exHistoryVal_','exHistoryPairKey_',
  'exHistoryValidDate_','exHistoryPeriodLabel_','exHistoryPrevious_','exHistoryComparisonNote_','exHistoryComparisonMeta_',
  'exHistoryElapsed_','exHistorySort_','exHistoryDataset_','exHistoryGrouped_',
  'exHistoryRows_','exHistoryCostRows_','exCostSum_','exCostChip_','exHistoryCostSort_',
  'exHistoryField_','exHistoryUnique_','exHistoryCounts_','exHistoryBreakdownHtml_',
  'exHistoryFilter_','exHistoryOption_','exHistoryCell_','exHistoryDetail_',
  'exTypeExampleNorm_','exTypeExampleKey_','exHistoryTable_','exHistoryControls_',
  'exHistoryKpiRows_','exHistoryHospitalCount_','exHistoryKpiChip_','exHistoryResultHtml_',
  'exApplyHistoryFilters_','exResetHistoryFilters_','exShowHistory_',
  'exApplyHistoryCountChip_','exToggleHistorySalesCounts_',
  'exExcelDate_','exHistoryExportData_','exHistoryExcelLines_','exBuildHistoryComparisonWorkbook_',
  'exportHistoryComparisonExcel_','exExcelDownload_',
  /* 처리이력 모달 개선(정렬·검색·통계·롤업·복사·상태 유지) */
  'exHistoryGroupList_','exHistoryGroupRows_',
  'exHistoryParseQuery_','exHistorySearchText_','exHistoryMatchToken_','exHistoryMatchQuery_',
  'exHistoryComposeStart_','exHistoryComposeEnd_','exHistoryCancelSearch_','exHistoryFlushSearch_','exHistoryQueryInput_',
  'exHistorySortValue_','exHistoryGroupSortValue_','exHistoryCmp_','exHistoryTieCmp_',
  'exHistorySortItems_','exHistorySortGroups_','exSortHistory_','exHistorySortTh_',
  'exHistoryAnalysisFilter_','exHistoryValidDays_','exHistoryStatSummary_','exHistoryAnalyze_','exHistoryRollup_',
  'exHistoryDayText_','exHistoryStatBlock_','exHistoryStatsHtml_','exHistoryRollupTable_','exHistoryRollupTsv_',
  'exHistoryCopyValue_','exHistoryTsvCell_','exHistoryRowCopyText_','exHistoryRowsTsv_',
  'exClipboardFallback_','exClipboardWrite_','exHistoryItemById_','exCopyHistoryRow_','exHistoryRowCopyClick_',
  'exCopyHistoryTsv_','exOpenHospitalTimeline_',
  'exCaptureHistoryUi_','exHistoryOptionExists_','exRestoreHistoryUi_','exCloseHistoryExample_','exHistoryRestoreSelection_',
  'exHistoryMoreHtml_','exHistoryShowMore_','exHistoryFilterChanged_',
  'exHistoryDimValue_','exHistoryToolbarHtml_','exHistorySyncToolbar_','exSetHistoryView_','exSwitchHistoryDim_',
  'exRestoreHistoryModalUi_'];
/* 새로 추가된 모듈 수준 상태(EX_HISTORY_PAGE·정렬 기본 방향 등)를 원문 그대로 가져온다 */
const RUNTIME=(()=>{const a=SRC.indexOf('EX_HISTORY_RUNTIME_BEGIN'),b=SRC.indexOf('EX_HISTORY_RUNTIME_END');
  return SRC.slice(SRC.indexOf('*/',a)+2, SRC.lastIndexOf('/*',b));})();

const stubs=`
var F={},RAW=[],EX_ROWS=[],EX_CACHE=null,EX_HISTORY_STATE=null,EX_LEAK_STATE=null;
var YC_CLEAN_SAVING_UNIT=281200,DEMO_MARK=/\\[\\s*데모\\s*장비\\s*\\]/;
function hospitalSales_(){return '';}
function exSavingEvidenceHtml_(){return '';}
function exHistoryPhotoPanel_(){return '';}
function exSyncHistoryTypeExample_(){}
function exSelectHistory_(){}
function exHistoryRowKey_(){return true;}
function exSetHistoryPhotoExpanded_(){}
function exLoadHistoryTypeExample_(){}
function toast(){}
var EX_HISTORY_PHOTO_SEQ=0;
function exBuild(){throw new Error('캐시 이외 집계 금지');}
function buildNozzleLeakCurrent_(){return {};}
function nlKpiData_(){return {label:'누수 대상',rows:EX_CACHE.rows};}
`;
const methods=RUNTIME+'\n'+FNS.map(grab).join('\n');
const D=new Function(stubs+`
var elements={},opened=null;
var document={getElementById:id=>elements[id]||null};
function openExList(title,sub,html){opened={title,sub,html};}
`+methods+`
return {${FNS.join(',')},elements,state:()=>EX_HISTORY_STATE,opened:()=>opened,
  setState:s=>EX_HISTORY_STATE=s,
  set:(cur,raw,f)=>{RAW=raw;F=f;EX_CACHE={rows:cur,prev:[{hosp:'관계없는 전주 병원'}]};}};
`)();
const date=s=>new Date(s+'T00:00:00');
const row=(id,day,hosp='가병원',extra={})=>{
  const [y,m,d]=day.split('-').map(Number);
  return {id,date:day,_y:y,_m:m,_d:d,_q:Math.ceil(m/3),hosp,gubun:'A/S',
    type:'노즐 누수(약액 유입)',cat:'핸드피스',part:'내부 세척',fse:'현재담당',sn:'HP-001',
    detail:'누수 확인 후 내부 세척\n동작 확인',_cost:0,...extra};
};
const F={from:'2026-01-01',to:'2026-08-31',year:[],month:[],quarter:[],part:[],fse:[]};
// 사용자 예시와 같은 날짜/조치 구조. 운영 병원 데이터는 사용하지 않는다.
const cur=[row('a1','2026-08-31'),row('a2','2026-08-14'),
  row('a3','2026-04-09','가병원',{part:"Handpiece Ass'y"}),
  row('b1','2026-08-31','나병원'),row('b2','2026-06-25','나병원',{part:"Handpiece Ass'y",fse:'이전담당',_cost:281200}),
  row('b3','2026-05-30','나병원'),row('c1','2026-08-13','다병원'),
  row('missing','2026-08-11',''),
  row('other','2026-08-12','가병원',{type:'풋스위치 작동 불량',part:'Foot s/w'})];
const raw=[...cur,
  row('a-old','2025-01-06','가병원',{part:"Handpiece Ass'y"}),
  row('other-prev','2025-07-01','가병원',{type:'풋 스위치 불량',part:'Foot s/w'}),
  row('wrong-hosp','2026-08-30','다른병원'),
  row('wrong-type','2026-08-30','가병원',{type:'노즐 누수'}),
  row('demo','2026-08-30','가병원',{detail:'[데모장비]'}),
  row('future','2026-09-01'),row('invalid','2026-02-31','다병원')];
let count=0;
const ck=(label,fn)=>{fn();count++;console.log('✅ '+label);};
const ids=items=>items.map(x=>(x&&x.r)?x.r.id:x.id);
const c=D.exHistoryPrevious_(cur,raw);
const dataset=()=>D.exHistoryDataset_(c.selected,c.rows,null,c.sameRows);
ck('병원·VOC별 선택 기간 내 최신 발생일만 선택, 과거 선택 후보 제거',()=>{
  assert.deepEqual(ids(D.exHistorySort_(c.selected)),['a1','b1','c1','other','missing']);
  assert.equal(c.sourceCount,9);assert.equal(c.total,4);assert.equal(c.matched,3);assert.equal(c.sameMatched,3);
  assert.deepEqual(c.unmatched.map(p=>p.hosp),['다병원']);assert.equal(c.missing,1);
});
ck('비교는 선택 기간 경계가 아닌 최신 선택일 직전: 8/31의 비교는 8/14',()=>{
  assert.deepEqual(ids(c.rows),['a2','b2','other-prev']);
  assert.ok(!ids(c.rows).includes('a-old'));assert.ok(!ids(c.rows).includes('a3'));
});
ck('동일비교는 같은 병원·VOC·교체품의 최근 이력: 다른 조치는 건너뜀',()=>{
  assert.deepEqual(ids(c.sameRows),['a2','b3','other-prev']);
  assert.equal(c.rows[1].part,"Handpiece Ass'y");assert.equal(c.sameRows[1].part,'내부 세척');
});
ck('다른 병원/유형, 데모, 미래, 잘못된 날짜는 비교 대상 아님',()=>{
  for(const id of ['wrong-hosp','wrong-type','demo','future','invalid'])
    assert.ok(!ids(c.rows.concat(c.sameRows)).includes(id),id);
});
ck('상단 담당자·교체품 필터와 달라도 비교 원본 보존, 연도 밖 검색',()=>{
  assert.equal(c.rows[1].fse,'이전담당');assert.equal(c.rows[1]._cost,281200);
  assert.equal(c.rows[2].date,'2025-07-01');
});
ck('전체 기간은 최신 선택 → 비교 → 동일비교 순, 두 비교 역할 중복 행 없음',()=>{
  const all=D.exHistoryGrouped_(dataset());
  assert.deepEqual(ids(all),['a1','a2','b1','b2','b3','c1','other','other-prev','missing']);
  assert.equal(new Set(all.map(it=>it.r)).size,all.length);
  assert.equal(D.exHistoryPeriodLabel_(all[1]),'비교 · 동일비교');
  assert.equal(D.exHistoryPeriodLabel_(all[3]),'비교');assert.equal(D.exHistoryPeriodLabel_(all[4]),'동일비교');
});
ck('동일비교 전용 조회에 공유 비교행도 포함, 병원 검색과 결합',()=>{
  assert.deepEqual(ids(D.exHistoryFilter_(dataset(),{period:'same'})).sort(),['a2','b3','other-prev']);
  assert.deepEqual(ids(D.exHistoryFilter_(dataset(),{period:'same',q:'나병원'})),['b3']);
  assert.deepEqual(ids(D.exHistoryFilter_(dataset(),{period:'prev',q:'나병원'})),['b2']);
});
ck('선택 8/31−비교 8/14 = 17일, 동일비교도 17일',()=>{
  D.setState({comparison:c});const it={period:'cur',r:cur[0]};
  assert.equal(D.exHistoryElapsed_(it),17);assert.equal(D.exHistoryElapsed_(it,'same'),17);
});
ck('교체품이 다른 경우 비교 67일 / 동일비교 93일을 각각 계산',()=>{
  D.setState({comparison:c});const it={period:'cur',r:cur[3]};
  assert.equal(D.exHistoryElapsed_(it),67);assert.equal(D.exHistoryElapsed_(it,'same'),93);
  assert.equal(D.exHistoryElapsed_({period:'prev',r:cur[4]}),null);
  assert.equal(D.exHistoryElapsed_({period:'same',r:cur[5]},'same'),null);
  assert.equal(D.exHistoryElapsed_({period:'cur',r:cur[6]}),null);
});
ck('윤년을 포함한 날짜 차이 계산',()=>assert.equal(D.hpCleanDays_(date('2024-02-28'),date('2024-03-01')),2));
ck('전체 데이터 조회도 최신 기준 비교 가능, 기간 시작일을 필요로 하지 않음',()=>{
  D.set(cur,raw,{});D.exShowHistory_('kpiTotal');
  assert.deepEqual(ids(D.state().comparison.rows),ids(c.rows));
  D.set(cur,raw,{...F,from:'2026-08-01'});D.exShowHistory_('kpiTotal');
  assert.deepEqual(ids(D.state().comparison.rows),ids(c.rows));
});
ck('같은 날 최신 원본과 직전일 복수 행 보존, 당일 접수는 직전으로 간주하지 않음',()=>{
  const latest=row('latest','2026-08-31'),tie=row('tie','2026-08-31','가병원',{part:'점검'}),
    prev=row('prev','2026-08-14'),prevTie=row('prevTie','2026-08-14','가병원',{part:'점검'});
  const result=D.exHistoryPrevious_([prev,latest,tie],[prev,latest,tie,prevTie]);
  assert.deepEqual(ids(result.selected),['latest','tie']);assert.deepEqual(ids(result.rows),['prev','prevTie']);
  assert.deepEqual(ids(result.sameRows),['prev','prevTie']);
  assert.equal(D.exHistoryDataset_(result.selected,result.rows,null,result.sameRows).length,4);
});
ck('교체품 공백 정규화, 없는 교체품 및 부분 일치 배제',()=>{
  const a=row('selected','2026-08-31'),space=row('space','2026-08-14',' 가 병원 ',{part:'내부세척'}),
    partial=row('partial','2026-08-20','가병원',{part:'내부 세척 추가'});
  const result=D.exHistoryPrevious_([a],[a,space,partial]);
  assert.deepEqual(ids(result.rows),['partial']);assert.deepEqual(ids(result.sameRows),['space']);
  const missingPart=D.exHistoryPrevious_([{...a,part:'없음'}],[{...space,part:'없음'}]);
  assert.equal(missingPart.rows.length,1);assert.equal(missingPart.sameRows.length,0);
});
ck('누락/잘못된 날짜는 계산 제외, 유효한 같은 병원의 다른 접수와 구분',()=>{
  const bad=row('bad','2026-02-31');const result=D.exHistoryPrevious_([cur[0],bad],raw);
  assert.equal(result.invalid,1);assert.ok(ids(result.selected).includes('bad'));
  D.setState({comparison:result});assert.equal(D.exHistoryElapsed_({period:'cur',r:bad}),null);
  assert.ok(D.exHistoryComparisonMeta_({period:'cur',r:bad}).includes('처리일 오류'));
});
ck('병원·유형 정규화는 별칭까지, 병원 부분 일치로 합치지 않음',()=>{
  assert.equal(D.exHistoryPairKey_(row('x','2026-08-01',' 가 병원 ')),D.exHistoryPairKey_(cur[0]));
  assert.notEqual(D.exHistoryPairKey_(row('x','2026-08-01','가병원 분원')),D.exHistoryPairKey_(cur[0]));
  assert.equal(D.exHistoryPairKey_({hosp:'가병원',type:'없음'}),'');
});
ck('빈 선택 결과에 관계없는 비교 이력 표시 안 함',()=>{
  const result=D.exHistoryPrevious_([],raw);assert.equal(result.selected.length,0);
  assert.equal(result.rows.length,0);assert.equal(result.sameRows.length,0);
});
ck('입력 배열 및 원본 행 불변, 참조를 보존',()=>{
  const before=JSON.stringify(raw);D.exHistoryPrevious_(cur,raw);
  assert.equal(JSON.stringify(raw),before);assert.equal(c.rows[0],cur[1]);
});
ck('미일치 안내와 HTML 이스케이프, 두 경과일 머리글·강조 표시',()=>{
  const note=D.exHistoryComparisonNote_(c);assert.ok(note.includes('병원명/VOC 유형 누락 1건'));
  const evil=D.exHistoryPrevious_([row('evil','2026-08-12','<img src=x>')],[]);
  assert.ok(D.exHistoryComparisonNote_(evil).includes('&lt;img src=x&gt;'));
  D.setState({comparison:c,period:'all'});
  const table=D.exHistoryTable_(D.exHistoryGrouped_(dataset()));
  assert.ok(table.includes('17일'));assert.ok(table.includes('67일'));assert.ok(table.includes('93일'));
  assert.ok(table.includes('동일비교 경과일'));assert.ok(table.includes('비교 이력 없음'));
  assert.ok(table.includes('hst-paired-prev'));assert.ok(table.includes('hst-paired-same'));
});
ck('실제 모달에서 원본 건수와 최신 선택 건수를 구분, 동일비교 옵션 제공',()=>{
  D.set(cur,raw,F);D.exShowHistory_('kpiTotal');
  assert.deepEqual(ids(D.state().items.filter(it=>it.period==='cur')),ids(D.exHistorySort_(c.selected)));
  assert.ok(D.opened().html.includes('>동일비교</option>'));
  assert.ok(D.opened().sub.includes('최신 선택 5건'));assert.ok(D.opened().html.includes('원본 9건'));
});
ck('전체 기간 필터는 두 비교를 최신 선택 밑에 표시, 초기화 시 최신만 복구',()=>{
  D.elements.hstPeriod={value:'all'};D.elements.hstTableHost={};D.exApplyHistoryFilters_();
  assert.deepEqual(ids(D.state().filtered),['a1','a2','b1','b2','b3','c1','other','other-prev','missing']);
  assert.ok(D.elements.hstTableHost.innerHTML.includes('17일'));
  D.exResetHistoryFilters_();assert.equal(D.elements.hstPeriod.value,'cur');assert.equal(D.state().filtered.length,5);
});
ck('절감액은 최신 선택 세척만 합산하고 두 비교 이력은 합산 제외',()=>{
  D.set(cur,raw,F);D.exShowHistory_('kpiSaving');const all=D.state().items;
  assert.equal(all.filter(it=>it.period==='cur').length,4);
  assert.ok(D.exHistoryResultHtml_(all,all).includes((4*281200).toLocaleString()));
  assert.ok(D.exHistoryResultHtml_(all.filter(it=>it.period!=='cur'),all).includes('₩0'));
});
ck('교체품/비용/A/S/점검/VOC/누수 진입점 모두 선택일 직전 조회 적용',()=>{
  const paid={...cur[0],_cost:100};
  for(const [dim,name] of [['part','내부 세척'],['cost'],['kpiAs'],['kpiInsp'],['typeAll',paid.type],['leak:total']]){
    const selected=dim==='kpiInsp'?[{...paid,gubun:'점검'}]:[paid];
    D.set(selected,raw,F);D.exShowHistory_(dim,name);
    assert.deepEqual(ids(D.state().comparison.rows),['a2'],dim);
    assert.deepEqual(ids(D.state().comparison.sameRows),['a2'],dim);
  }
});
ck('팝업 조회/필터 변경은 전역 필터와 카드 원본을 변경하지 않음',()=>{
  const f=JSON.stringify(F),r=JSON.stringify(raw);D.set(cur,raw,F);D.exShowHistory_('kpiTotal');
  D.elements.hstPeriod.value='all';D.exApplyHistoryFilters_();
  assert.equal(JSON.stringify(F),f);assert.equal(JSON.stringify(raw),r);
});
ck('엑셀은 화면 필터로 숨은 비교도 함께 내보내며 선택과 두 비교일을 보존',()=>{
  D.set(cur,raw,F);D.exShowHistory_('kpiTotal');const state=D.state();
  state.filtered=[state.items.find(it=>it.r.id==='b1')];const data=D.exHistoryExportData_(state);
  assert.equal(data.records.length,3);assert.deepEqual(data.records.map(r=>r.period),['선택','비교','동일비교']);
  assert.equal(data.records[0].days,67);assert.equal(data.records[0].sameDays,93);
  assert.equal(data.records[0].date.toISOString(),'2026-08-31T00:00:00.000Z');
  assert.equal(data.records[0].previous.toISOString(),'2026-06-25T00:00:00.000Z');
  assert.equal(data.records[0].sameDate.toISOString(),'2026-05-30T00:00:00.000Z');
  state.filtered=[state.items.find(it=>it.r.id==='a2')];
  assert.deepEqual(D.exHistoryExportData_(state).records.map(r=>r.period),['선택','비교 · 동일비교']);
  state.filtered=[];assert.equal(D.exHistoryExportData_(state).records.length,0);
});
ck('대시보드의 전체 인라인 스크립트 구문 검사',()=>{
  const scripts=[...SRC.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.some(s=>s[1].includes('exShowHistory_')));
  scripts.forEach((s,i)=>new vm.Script(s[1],{filename:'dashboard-inline-'+i+'.js'}));
});
console.log(`통과 ${count}/${count}`);
const fixture=process.argv.find(a=>a.startsWith('--fixture='));
if(fixture){
  const css=SRC.match(/<style>([\s\S]*?)<\/style>/)[1];
  const modal=SRC.slice(SRC.indexOf('<div class="modal" id="exListModal">'),SRC.indexOf('<!-- 연간 비교분석 전체화면'));
  fs.writeFileSync(fixture.slice('--fixture='.length),`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>처리이력 비교 — 합성 데이터 검증</title><style>${css}</style></head><body>
  <p>합성 데이터로 검증하는 처리이력 조회 화면입니다.</p>${modal}
  <script>${stubs}\n${methods}\n${grab('openExList')}\n${grab('closeExList')}
  var EX_HISTORY_PHOTO_SEQ=0;
  function toast(message){document.getElementById('fixtureNotice').textContent=message;}
  function loadHpExcelLib_(){return Promise.resolve();}
  F=${JSON.stringify(F)};RAW=${JSON.stringify(raw.map(r=>({...r,type:D.vocTypeCanonical_(r.type)})))};EX_CACHE={rows:${JSON.stringify(cur)}};
  exShowHistory_('kpiTotal');
  </script><div id="fixtureNotice" role="status"></div><script src="vendor/exceljs.min.js"></script></body></html>`);
  console.log('UI fixture: '+fixture.slice('--fixture='.length));
}
export {D,F,cur,raw,grab};
