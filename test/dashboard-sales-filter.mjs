// 병원정보DB 현재 영업 담당자 → 공통 상세필터/처리이력 필터 회귀 검증
import fs from 'node:fs';
import assert from 'node:assert/strict';
const SRC=fs.readFileSync(new URL('../dashboard-pc.html',import.meta.url),'utf8');
function grab(name){
  const at=SRC.search(new RegExp('\\bfunction\\s+'+name+'\\s*\\('));
  assert.ok(at>=0,name);
  let depth=0;
  for(let i=SRC.indexOf('{',at);i<SRC.length;i++){
    if(SRC[i]==='{')depth++;
    else if(SRC[i]==='}'&&!--depth)return SRC.slice(at,i+1);
  }
  throw new Error(name);
}
const FNS=['nkey','hospitalSales_','salesFilterChips_','esc','escAttr','skCmpKo_',
  'normD','costNum','paidType_','rowDate','ymd','isDemoRecord','recScope','isNcareVisit',
  'filteredRows_','hospStateFilter_','filtered','exWindowBaseRows_','exWindowRows','activeCnt',
  'exHistoryVal_','exHistoryField_','exHistoryUnique_','exHistoryCounts_','exHistoryBreakdownHtml_',
  'exHistoryFilter_','exHistoryOption_','exHistoryControls_','exApplyHistoryCountChip_',
  'exNum','exBaseDate','ncareAsOf_','buildNcareStatus','applyHospDB_','enrichNcare'];
const initialF=SRC.match(/var F=([^;]+);/)[1];
const D=new Function(`
  var F=${initialF},RAW=[],HOSPDB=[],DATA_READY=false;
  var DEMO_MARK=/\\[\\s*데모\\s*장비\\s*\\]/;
  var calls={filters:0,apply:0,history:0},elements={};
  var document={getElementById:id=>elements[id],querySelectorAll:()=>[]};
  function buildFilters(){calls.filters++;}
  function apply(){calls.apply++;}
  function exRefreshHistoryForHospitalDB_(){calls.history++;}
  function exApplyHistoryFilters_(){calls.history++;}
  function exToday(){return new Date('2026-08-26T00:00:00');}
  ${FNS.map(grab).join('\n')}
  return {${FNS.join(',')},elements,calls,
    setDB:v=>HOSPDB=v,db:()=>HOSPDB,ready:v=>DATA_READY=v,
    setRows:v=>RAW=v.map(r=>{var d=normD(r.date);return Object.assign({cat:'장비',gubun:'A/S',ncare:'미가입',paid:'무상'},r,{_y:d.y,_m:d.m,_d:d.d,_q:d.q});}),
    setF:v=>F=Object.assign(${initialF},v),F:()=>F,raw:()=>RAW};
`)();
let total=0;
function ck(label,fn){fn();total++;console.log('✅ '+label);}
const DB=[{n:'A 병원',sale:'영업가',ncare:'Basic'},{n:'B병원',sale:'영업나',ncare:'Basic'},
  {n:'C병원',sale:'',ncare:'Basic'},{n:'D병원',sale:'영업가',ncare:'Basic'}];
const ROWS=[
  {date:'2026-08-18',hosp:'A병원',fse:'처리가',type:'누수'},
  {date:'2026-08-19',hosp:'A 병원',fse:'처리나',type:'누수'},
  {date:'2026-08-20',hosp:'B병원',fse:'처리가',type:'케이블'},
  {date:'2026-08-21',hosp:'C병원',fse:'처리가',type:'점검',gubun:'점검'},
  {date:'2026-08-21',hosp:'미등록병원',fse:'처리나',type:'누수',sales:'과거 담당자'},
  {date:'2026-08-11',hosp:'A병원',fse:'처리가',type:'누수'},
  {date:'2025-08-11',hosp:'A병원',fse:'처리가',type:'누수'}
];
D.setDB(DB);D.setRows(ROWS);
ck('정확한 병원명 매칭(공백 허용), 부분 일치나 처리 담당자 추정은 하지 않음',()=>{
  assert.equal(D.hospitalSales_(' A 병원 '),'영업가');assert.equal(D.hospitalSales_('A'),'');
  assert.equal(D.hospitalSales_('미등록병원'),'');
});
ck('rich/compact 필드 호환, 따옴표 포함 담당자·위험 객체 키 안전 처리',()=>{
  D.setDB([{name:'Rich',sales:'영업"<가>'},{n:'Compact',sa:'__proto__'},{n:'Ctor',sale:'constructor'}]);
  assert.equal(D.hospitalSales_(' RICH '),'영업"<가>');assert.equal(D.hospitalSales_('compact'),'__proto__');
  D.elements.exSales={};D.salesFilterChips_('exSales');
  assert.ok(D.elements.exSales.innerHTML.includes('data-v="영업&quot;&lt;가&gt;"'));
});
ck('중복 병원은 같은 담당자이면 유지, 상충 담당자면 임의 분류 안 함',()=>{
  D.setDB([{n:'A',sale:'가'},{n:' A ',sale:'가'},{n:'B',sale:'가'},{n:'B',sale:'나'},{n:'B',sale:'나'}]);
  assert.equal(D.hospitalSales_('A'),'가');assert.equal(D.hospitalSales_('B'),'');
});
ck('DB 교체·담당자 삭제·빈 응답 때 오래된 담당자 인덱스 제거',()=>{
  D.setDB(DB);assert.equal(D.hospitalSales_('A병원'),'영업가');
  D.setDB([{n:'A병원',sale:''}]);assert.equal(D.hospitalSales_('A병원'),'');
  D.setDB([]);assert.equal(D.hospitalSales_('B병원'),'');D.setDB(DB);
});
ck('상세/보고 공통: 영업담당자와 처리담당자·기간 교집합',()=>{
  D.setF({sales:['영업가'],fse:['처리가'],from:'2026-08-17',to:'2026-08-21'});
  assert.equal(D.filtered().length,1);assert.equal(D.filtered({scope:'customer'}).length,1);
  assert.equal(D.activeCnt(),3);
});
ck('이전 기간·추이·연간 비교도 영업담당자 조건을 유지',()=>{
  assert.equal(D.exWindowRows(new Date('2026-08-10'),new Date('2026-08-14T23:59:59')).length,1);
  assert.equal(D.exWindowRows(new Date('2025-08-01'),new Date('2025-08-31T23:59:59')).length,1);
  assert.ok(grab('ycRangeStat_').includes('exWindowRows('));
  assert.ok(grab('buildNozzleLeakCurrent_').includes('filteredRows_('));
});
ck('복수 선택은 합집합, 미지정에는 DB 미등록도 포함',()=>{
  D.setF({sales:['영업가','영업나']});assert.equal(D.filteredRows_().length,5);
  D.setF({sales:['__missing__']});assert.equal(D.filteredRows_().length,2);
  assert.deepEqual(D.filteredRows_().map(r=>r.hosp),['C병원','미등록병원']);
});
ck('관리대상 N-Care 명단도 영업담당자로 제한, 방문 기록 없는 병원 포함',()=>{
  D.setF({sales:['영업가']});const n=D.buildNcareStatus();
  assert.deepEqual(n.list.map(r=>r.hosp),['A 병원','D병원']);assert.equal(n.cnt[4],1);
});
const items=ROWS.map((r,i)=>({r,period:i<5?'cur':'prev'}));
ck('처리이력 영업담당자 필터는 전역 필터를 바꾸지 않음',()=>{
  D.setF({sales:['영업가']});const before=JSON.stringify(D.F());
  const a=D.exHistoryFilter_(items,{sales:'영업나',period:'cur',fse:'처리가'});
  assert.equal(a.length,1);assert.equal(a[0].r.hosp,'B병원');assert.equal(JSON.stringify(D.F()),before);
});
ck('처리이력 담당자별 건수는 고유 병원 수가 아니라 처리행 건수',()=>{
  const counts=D.exHistoryCounts_(items.filter(i=>i.period==='cur'),'sales');
  assert.equal(counts.find(x=>x.k==='영업가').n,2);assert.equal(counts.find(x=>x.k==='미지정').n,2);
  assert.equal(counts.reduce((s,x)=>s+x.n,0),5);
});
ck('영업담당자 건수 카드가 구분 바로 오른쪽, VOC 건수 앞에 배치',()=>{
  const html=D.exHistoryBreakdownHtml_(items,{period:'cur',sales:'영업가'});
  assert.ok(html.indexOf('구분 건수')<html.indexOf('영업 담당자별 건수'));
  assert.ok(html.indexOf('영업 담당자별 건수')<html.indexOf('VOC 유형별 건수'));
  assert.ok(html.includes('data-hst-count-value="영업나"'));
  assert.ok(html.includes('data-hst-count-value="영업가" aria-pressed="true"'));
});
ck('영업담당자 건수만 기본 접힘, 접근 가능한 펼침 버튼 제공',()=>{
  const html=D.exHistoryBreakdownHtml_(items,{period:'cur'});
  assert.ok(html.includes('id="hstSalesCountsList" hidden'));
  assert.ok(html.includes('aria-controls="hstSalesCountsList" aria-expanded="false"'));
  assert.ok(html.includes('펼치기 ▾'));
  assert.equal((html.match(/ hidden/g)||[]).length,1);
  const expanded=D.exHistoryBreakdownHtml_(items,{period:'cur',salesExpanded:true});
  assert.ok(!expanded.includes('id="hstSalesCountsList" hidden'));
  assert.ok(expanded.includes('aria-expanded="true"'));assert.ok(expanded.includes('접기 ▴'));
});
ck('펼침 상태는 모달 내 재필터·DB 갱신 중 유지하고 새 모달에서는 접힘',()=>{
  assert.ok(grab('exApplyHistoryFilters_').includes('salesExpanded:!!EX_HISTORY_STATE.salesCountsExpanded'));
  assert.ok(grab('exRefreshHistoryForHospitalDB_').includes('salesCountsExpanded=!!state.salesCountsExpanded'));
  assert.ok(grab('exShowHistory_').includes('salesCountsExpanded:false'));
  assert.ok(!/exApplyHistoryFilters_\(|fetch\(|gvRetry\(/.test(grab('exToggleHistorySalesCounts_')));
});
ck('담당자 칩은 다른 담당자 후보 유지, 자기 조건 제외·다른 그룹 조건 적용',()=>{
  const html=D.exHistoryBreakdownHtml_(items,{period:'cur',sales:'영업가',type:'케이블'});
  const sales=html.slice(html.indexOf('영업 담당자별 건수'),html.indexOf('VOC 유형별 건수'));
  assert.match(sales,/영업나 <b>1건<\/b>/);assert.match(sales,/영업가 <b>0건<\/b>/);
});
ck('같은 영업담당자 칩 재클릭 해제, 다른 담당자 클릭 전환',()=>{
  D.elements.hstSales={value:'all'};
  const btn=v=>({getAttribute:k=>k==='data-hst-count-key'?'sales':v});
  D.exApplyHistoryCountChip_(btn('영업가'));assert.equal(D.elements.hstSales.value,'영업가');
  D.exApplyHistoryCountChip_(btn('영업나'));assert.equal(D.elements.hstSales.value,'영업나');
  D.exApplyHistoryCountChip_(btn('영업나'));assert.equal(D.elements.hstSales.value,'all');
});
ck('미지정 드롭다운·칩·필터 값 일치',()=>{
  const html=D.exHistoryControls_(items,true);
  assert.ok(html.includes('id="hstSales"'));assert.ok(html.includes('value="__missing__">미지정'));
  assert.equal(D.exHistoryFilter_(items,{period:'cur',sales:'__missing__'}).length,2);
  assert.ok(grab('exResetHistoryFilters_').includes("'hstSales'"));
});
ck('공통 영업담당자 UI는 상세필터에만 추가, 양쪽 모드 및 개수·초기화 연동',()=>{
  assert.ok(SRC.slice(SRC.indexOf('id="exDrawer"'),SRC.indexOf('id="exTabs"')).includes('id="exSales"'));
  assert.ok(SRC.includes('id="fSales"'));
  assert.ok(grab('buildFilters').includes("salesFilterChips_('exSales')"));
  assert.ok(grab('resetFilters').includes('sales:[]'));
  assert.ok(grab('syncExecFilterUI').includes("'sales'"));
});
ck('DB가 이력보다 먼저 도착해도 안전, 늦게 변경되면 N-Care 변화 없이 재필터링',()=>{
  D.ready(false);D.applyHospDB_(DB);const before={...D.calls};
  D.ready(true);D.applyHospDB_(DB.map(h=>({...h,sale:'새 담당자'})));
  assert.equal(D.calls.filters,before.filters+1);assert.equal(D.calls.apply,before.apply+1);
  assert.equal(D.calls.history,before.history+1);assert.equal(D.hospitalSales_('A병원'),'새 담당자');
  assert.ok(!D.raw().some(r=>Object.hasOwn(r,'_sales')));
});
ck('기존 hospdb 요청만 재사용, 필터·건수 클릭에는 추가 통신 없음',()=>{
  assert.equal((grab('loadHospDB').match(/gvRetry\(/g)||[]).length,1);
  assert.ok(grab('loadHospDB').includes("gvRetry('hospdb'"));
  for(const name of ['hospitalSales_','salesFilterChips_','exHistoryFilter_','exApplyHistoryCountChip_'])
    assert.ok(!/fetch\(|gvRetry\(|loadHospDB\(/.test(grab(name)),name);
});
console.log(`\n통과 ${total}/${total}`);
