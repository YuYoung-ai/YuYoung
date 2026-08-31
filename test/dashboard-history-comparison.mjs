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
  'exHistoryStart_','exHistoryPrevious_','exHistoryComparisonNote_','exHistoryComparisonMeta_',
  'exHistoryElapsed_','exHistorySort_','exHistoryDataset_','exHistoryGrouped_',
  'exHistoryRows_','exHistoryCostRows_','exCostSum_','exCostChip_','exHistoryCostSort_',
  'exHistoryField_','exHistoryUnique_','exHistoryCounts_','exHistoryBreakdownHtml_',
  'exHistoryFilter_','exHistoryOption_','exHistoryCell_','exHistoryDetail_',
  'exTypeExampleNorm_','exTypeExampleKey_','exHistoryTable_','exHistoryControls_',
  'exHistoryKpiRows_','exHistoryHospitalCount_','exHistoryKpiChip_','exHistoryResultHtml_',
  'exApplyHistoryFilters_','exResetHistoryFilters_','exShowHistory_',
  'exApplyHistoryCountChip_','exToggleHistorySalesCounts_',
  'exExcelDate_','exHistoryExportData_','exHistoryExcelLines_','exBuildHistoryComparisonWorkbook_',
  'exportHistoryComparisonExcel_','exExcelDownload_'];
const stubs=`
var F={},RAW=[],EX_ROWS=[],EX_CACHE=null,EX_HISTORY_STATE=null,EX_LEAK_STATE=null;
var YC_CLEAN_SAVING_UNIT=281200,DEMO_MARK=/\\[\\s*데모\\s*장비\\s*\\]/;
function hospitalSales_(){return '';}
function exSavingEvidenceHtml_(){return '';}
function exHistoryPhotoPanel_(){return '';}
function exSyncHistoryTypeExample_(){}
function exSelectHistory_(){}
function exHistoryRowKey_(){return true;}
function exBuild(){throw new Error('캐시 이외 집계 금지');}
function buildNozzleLeakCurrent_(){return {};}
function nlKpiData_(){return {label:'누수 대상',rows:EX_CACHE.rows};}
`;
const methods=FNS.map(grab).join('\n');
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
const F={from:'2026-08-10',to:'2026-08-15',year:[],month:[],quarter:[],part:['내부 세척'],fse:['현재담당']};
const cur=[row('a1','2026-08-12'),row('b1','2026-08-14','나병원'),row('a2','2026-08-15'),
  row('c1','2026-08-13','다병원'),row('missing','2026-08-11',''),
  row('other','2026-08-12','가병원',{type:'풋스위치 작동 불량',part:'Foot s/w'})];
const raw=[...cur,
  row('a-old','2026-06-01'),
  row('a-prev','2026-07-20',' 가 병원 ',{fse:'이전담당',part:"Handpiece Ass'y",sn:'HP-002',_cost:281200,detail:'누수 발생 · 핸드피스 교체'}),
  row('a-tie','2026-07-20','가병원',{gubun:'점검',part:'점검',sn:'HP-003',detail:'추가 장비 누수 확인'}),
  row('b-prev','2025-12-31','나병원',{detail:'누수 확인 및 부품 교체',part:'부품 교체'}),
  row('other-prev','2026-07-01','가병원',{type:'풋 스위치 불량',part:'Foot s/w'}),
  row('wrong-hosp','2026-08-09','다른병원'),
  row('wrong-type','2026-08-09','가병원',{type:'노즐 누수'}),
  row('demo','2026-08-09','가병원',{detail:'[데모장비]'}),
  row('boundary','2026-08-10'),row('future','2026-08-16'),
  row('invalid','2026-02-31','다병원')];
let count=0;
const ck=(label,fn)=>{fn();count++;console.log('✅ '+label);};
let c=D.exHistoryPrevious_(cur,raw,D.exHistoryStart_(F));
const ids=items=>items.map(x=>x.id||x.r.id);
ck('병원·VOC 조합별 가장 최근 발생일과 같은 날 복수 원본을 모두 보존',()=>{
  assert.deepEqual(ids(c.rows),['a-prev','a-tie','b-prev','other-prev']);
  assert.equal(c.total,4);assert.equal(c.matched,3);assert.equal(c.missing,1);
  assert.deepEqual(c.unmatched.map(p=>p.hosp),['다병원']);
});
ck('다른 병원/유형, 데모, 선택 시작일/이후, 잘못된 날짜 제외',()=>{
  for(const id of ['wrong-hosp','wrong-type','demo','boundary','future','invalid','a-old'])
    assert.ok(!ids(c.rows).includes(id),id);
});
ck('현재 교체품/담당자/구분과 달라도 과거 처리 근거 보존',()=>{
  assert.equal(c.rows[0].part,"Handpiece Ass'y");assert.equal(c.rows[0].fse,'이전담당');
  assert.ok(c.rows.some(r=>r.gubun==='점검'));
});
ck('이전 주 밖/연도 밖의 직전 발생도 검색',()=>assert.equal(c.rows.find(r=>r.id==='b-prev').date,'2025-12-31'));
ck('동일 날짜 원본 보존, 입력 배열 및 원본 행 불변',()=>{
  const before=JSON.stringify(raw);D.exHistoryPrevious_(cur,raw,date(F.from));
  assert.equal(JSON.stringify(raw),before);assert.equal(c.rows[0],raw[7]);
});
ck('유형 별칭 및 병원 공백은 정규화하되 부분 일치로 병원을 합치지 않음',()=>{
  assert.equal(D.exHistoryPairKey_(row('x','2026-08-01',' 가 병원 ')),D.exHistoryPairKey_(cur[0]));
  assert.notEqual(D.exHistoryPairKey_(row('x','2026-08-01','가병원 분원')),D.exHistoryPairKey_(cur[0]));
  assert.equal(D.exHistoryPairKey_({hosp:'가병원',type:'없음'}),'');
});
ck('전체 기간에서 같은 병원·VOC의 선택 행 바로 아래 직전 행 배치',()=>{
  const all=D.exHistoryGrouped_(D.exHistoryDataset_(cur,c.rows));
  assert.deepEqual(ids(all),['a2','a1','a-prev','a-tie','b1','b-prev','c1','other','other-prev','missing']);
  assert.equal(new Set(all.map(it=>it.r)).size,cur.length+c.rows.length);
});
ck('기간별 조회와 검색 뒤 그룹화도 행 누락/복제 없음',()=>{
  const all=D.exHistoryDataset_(cur,c.rows);
  assert.equal(D.exHistoryGrouped_(D.exHistoryFilter_(all,{period:'prev'})).length,4);
  assert.deepEqual(ids(D.exHistoryGrouped_(D.exHistoryFilter_(all,{q:'HP-003'}))),['a-tie']);
  assert.ok(ids(D.exHistoryFilter_(all,{q:'가병원'})).includes('a-prev'));
});
ck('경과일은 선택 처리일 − 직전 처리일, 같은 조합의 선택일마다 개별 계산',()=>{
  D.setState({comparison:c});
  assert.equal(D.exHistoryElapsed_({period:'cur',r:cur[0]}),23);
  assert.equal(D.exHistoryElapsed_({period:'cur',r:cur[2]}),26);
  assert.equal(D.exHistoryElapsed_({period:'cur',r:cur[1]}),226);
  assert.equal(D.exHistoryElapsed_({period:'cur',r:cur[3]}),null);
  assert.equal(D.exHistoryElapsed_({period:'prev',r:c.rows[0]}),null);
});
ck('윤년을 포함한 경과일 계산',()=>assert.equal(D.hpCleanDays_(date('2024-02-28'),date('2024-03-01')),2));
ck('원본에 데이터가 없는 기간 첫날도 실제 선택 시작일 유지',()=>assert.equal(D.ymd(D.exHistoryStart_(F)),'2026-08-10'));
ck('연·월·분기와 상단 기간의 교집합 시작일',()=>{
  assert.equal(D.ymd(D.exHistoryStart_({from:'2026-01-15',to:'2026-12-31',month:['8'],quarter:['3']})),'2026-08-01');
  assert.equal(D.ymd(D.exHistoryStart_({year:['2025','2026'],month:['3'],quarter:['1']})),'2025-03-01');
  assert.equal(D.ymd(D.exHistoryStart_({from:'2025-12-15',month:['1']})),'2026-01-01');
  assert.equal(D.exHistoryStart_({from:'2026-08-10',to:'2026-08-15',quarter:['1']}),null);
});
ck('시작일/연도가 없는 전체 데이터 조회는 임의의 첫 접수일을 사용하지 않음',()=>{
  assert.equal(D.exHistoryStart_({}),null);assert.equal(D.exHistoryStart_({to:'2026-08-15',month:['8']}),null);
  assert.deepEqual(D.exHistoryPrevious_(cur,raw,null).rows,[]);
});
ck('선택 결과 0건일 때 관계없는 전주 병원을 대신 표시하지 않음',()=>{
  assert.equal(D.exHistoryPrevious_([],raw,date(F.from)).rows.length,0);
});
ck('미일치/누락 안내와 HTML 이스케이프',()=>{
  const note=D.exHistoryComparisonNote_(c);
  assert.ok(note.includes('직전 이력 없음 1쌍'));assert.ok(note.includes('병원명/VOC 유형 누락 1건'));
  const evil=D.exHistoryPrevious_([row('evil','2026-08-12','<img src=x>')],[],date(F.from));
  assert.ok(D.exHistoryComparisonNote_(evil).includes('&lt;img src=x&gt;'));
  D.setState({comparison:c,period:'all'});
  const table=D.exHistoryTable_(D.exHistoryGrouped_(D.exHistoryDataset_(cur,c.rows)));
  assert.ok(table.includes('23일'));assert.ok(table.includes('직전 이력 없음'));assert.ok(table.includes('장비번호: HP-002'));
  assert.ok(table.includes('hst-paired-prev'));assert.ok(table.includes('선택 처리일 − 직전 처리일'));
});
ck('실제 모달 진입: 전주 비교 캐시를 사용하지 않고 선택 카드 모집단 유지',()=>{
  D.set(cur,raw,F);D.exShowHistory_('kpiTotal');
  assert.deepEqual(ids(D.state().items.filter(it=>it.period==='cur')),ids(D.exHistorySort_(cur)));
  assert.deepEqual(ids(D.state().items.filter(it=>it.period==='prev')).sort(),ids(c.rows).sort());
  assert.ok(D.opened().html.includes('>전체 기간</option>'));
  assert.ok(D.opened().sub.includes('카드 증감과 별도'));
});
ck('전체 기간 필터 적용 경로에서 바로 아래 배치 + 경과일 렌더링',()=>{
  D.elements.hstPeriod={value:'all'};D.elements.hstTableHost={};
  D.exApplyHistoryFilters_();
  assert.deepEqual(ids(D.state().filtered),['a2','a1','a-prev','a-tie','b1','b-prev','c1','other','other-prev','missing']);
  assert.ok(D.elements.hstTableHost.innerHTML.includes('26일'));
  D.exResetHistoryFilters_();assert.equal(D.elements.hstPeriod.value,'cur');assert.equal(D.state().filtered.length,cur.length);
});
ck('내부 세척 절감액에서 직전 교체/점검 행은 금액 산정 제외',()=>{
  D.set(cur,raw,F);D.exShowHistory_('kpiSaving');
  const all=D.state().items, prev=all.filter(it=>it.period==='prev');
  assert.equal(all.filter(it=>it.period==='cur').length,5);
  assert.ok(prev.some(it=>it.r.part==="Handpiece Ass'y"));
  const h=D.exHistoryResultHtml_(all,all);
  assert.ok(h.includes((5*281200).toLocaleString()));
  assert.ok(D.exHistoryResultHtml_(prev,all).includes('₩0'));
});
ck('교체품/비용/A/S/점검/VOC/누수 진입점 모두 동일 직전 조회 적용',()=>{
  const paid=row('paid','2026-08-12','가병원',{_cost:100,part:'내부 세척'});
  for(const [dim,name] of [['part','내부 세척'],['cost'],['kpiAs'],['kpiInsp'],['typeAll',paid.type],['leak:total']]){
    const selected=dim==='kpiInsp'?[{...paid,gubun:'점검'}]:[paid];
    D.set(selected,raw,F);D.exShowHistory_(dim,name);
    assert.deepEqual(ids(D.state().items.filter(it=>it.period==='prev')),['a-prev','a-tie'],dim);
  }
});
ck('비교 모달을 열고 필터를 바꿔도 전역 필터와 원본은 변경하지 않음',()=>{
  const f=JSON.stringify(F), r=JSON.stringify(raw);
  D.set(cur,raw,F);D.exShowHistory_('kpiTotal');D.elements.hstPeriod.value='all';D.exApplyHistoryFilters_();
  assert.equal(JSON.stringify(F),f);assert.equal(JSON.stringify(raw),r);
});
ck('대시보드의 전체 인라인 스크립트 구문 검사',()=>{
  const scripts=[...SRC.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.some(s=>s[1].includes('exShowHistory_')));
  scripts.forEach((s,i)=>new vm.Script(s[1],{filename:'dashboard-inline-'+i+'.js'}));
});
ck('현재 조회 병원·VOC의 선택/직전 양쪽 원본을 엑셀로 내보냄',()=>{
  D.set(cur,raw,F);D.exShowHistory_('kpiTotal');
  const state=D.state();state.filtered=[state.items.find(it=>it.r.id==='a1')];
  const data=D.exHistoryExportData_(state);
  assert.equal(data.records.length,4);assert.deepEqual(data.records.map(r=>r.period),['선택','선택','직전','직전']);
  assert.deepEqual(data.records.slice(0,2).map(r=>r.days),[26,23]);
  assert.equal(data.records[2].part,"Handpiece Ass'y");
  assert.equal(data.records[0].date.toISOString(),'2026-08-15T00:00:00.000Z');
  state.filtered=[];assert.equal(D.exHistoryExportData_(state).records.length,0);
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
