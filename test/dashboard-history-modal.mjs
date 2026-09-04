/************************************************************
 * dashboard-history-modal.mjs
 * dashboard-pc.html 처리이력 모달 회귀 테스트
 * 실행: node test/dashboard-history-modal.mjs
 * ----------------------------------------------------------
 * 무빌드 헤드리스. dashboard-pc.html 원문에서 함수를 꺼내
 * 최소 DOM 스텁 위에서 실제 모달 흐름을 그대로 돌린다.
 *
 * 커버리지
 *   · 열 헤더 정렬(처리일·병원·경과일·동일비교·비용) · null 마지막 · 동률 안정 정렬
 *   · period all 그룹 정렬(내부 cur→prev→same 유지, 경과일 최솟값·비용 합계)
 *   · 정렬 후 행 선택·복사가 실제 클릭한 item 을 가리킴
 *   · 검색 AND/-제외/단독 -/IME 조합/디바운스 취소·flush
 *   · 병원 롤업용 경과일 계산(모집단·중복 제거 단위·평균/중앙값/최단/30일)
 *   · 병원별 롤업(정규화·누락 분리·동률 VOC·비용 0원과 미입력)
 *   · 필터 상태 유지(재오픈·dim 전환·병원DB 지연·정렬/보기 유지)
 *   · 대량 렌더 제한(200행)과 통계·복사의 독립
 ************************************************************/
import fs from 'node:fs';
import assert from 'node:assert/strict';

const SRC=fs.readFileSync(new URL('../dashboard-pc.html',import.meta.url),'utf8');
export function grab(name){
  const at=SRC.search(new RegExp('\\b(?:async\\s+)?function\\s+'+name+'\\s*\\('));
  assert.ok(at>=0,'함수를 찾지 못함: '+name);
  let depth=0;
  for(let i=SRC.indexOf('{',at);i<SRC.length;i++){
    if(SRC[i]==='{') depth++;
    else if(SRC[i]==='}'&&!--depth) return SRC.slice(at,i+1);
  }
  throw new Error(name);
}
const RUNTIME=(()=>{const a=SRC.indexOf('EX_HISTORY_RUNTIME_BEGIN'),b=SRC.indexOf('EX_HISTORY_RUNTIME_END');
  return SRC.slice(SRC.indexOf('*/',a)+2, SRC.lastIndexOf('/*',b));})();

const FNS=['nkey','rowDate','ymd','esc','escAttr','skCmpKo_','exNum','isOK','costNum',
  'hpCleanKey_','hpIsLeakVoc_','hpCleanDays_','isHandpieceCleaning_','vocTypeCanonical_',
  'isDemoRecord','recScope','exPeriodLabel','exHistoryVal_','exHistoryPairKey_',
  'exHistoryValidDate_','exHistoryPeriodLabel_','exHistoryPrevious_','exHistoryComparisonNote_',
  'exHistoryViewOf_','exHistoryCopyLabel_','exHistoryViewBtn_',
  'skNorm_','nlDateLabel_','exBaseDate','exHistoryCycleOpenHtml_','exCycleAttachStates_','exCycleStateSplit_',
  'exToggleCycleShort_',
  'exCycleStateBadges_','exCycleSideText_','exCycleStateChips_','exHistoryCyclesShown_',
  'exCycleTh_','exCycleGuideHtml_',
  'nlDateKey_','exKeyDiff_','exRiskStateAt_','exRiskTimelines_','exRiskIntervals_','exRiskSummary_',
  'exRiskHold_','exRiskGapText_',
  'exBuildLeakRisk_','exRiskVerdict_','exRiskPct_','exRiskDay_','exRiskRow_',
  'exChangePoint_','exChangeSide_','exBuildLeakChange_','exChangeKeyDate_','exChangeGainText_',
  'exCardFullBtn_','exToggleCardFull_','exCloseCardFull_','exArmIsHandpiecePart_',
  'exCauseArmPartsHtml_','exCauseArmGroup_','exCauseArmMetric_',
  'exTrendRate_','exTrendSpanText_','exTrendMonthKey_','exTrendShift_','exTrendBreak_',
  'exHospTrend_','exTrendRow_','exHospTrendHtml_',
  'exHistoryCycleKey_','exHistoryCycleAvg_','exHistoryCycleTrend_','exHistoryCycles_',
  'exHistoryCycleSummary_','exHistoryCycleGapsHtml_','exHistoryCycleTrendHtml_',
  'exHistoryCycleSummaryHtml_','exHistoryCycleTable_','exHistoryCycleTsv_',
  'exHistoryComparisonMeta_','exHistoryElapsed_','exHistorySort_','exHistoryCostSort_',
  'exHistoryDataset_','exHistoryGroupList_','exHistoryGroupRows_','exHistoryGrouped_',
  'exHistoryRows_','exHistoryCostRows_','exCostSum_','exCostChip_',
  'exHistoryField_','exHistoryUnique_','exHistoryCounts_','exHistoryBreakdownHtml_',
  'exHistoryParseQuery_','exHistorySearchText_','exHistoryMatchToken_','exHistoryMatchQuery_','exHistoryFilter_',
  'exHistoryComposeStart_','exHistoryComposeEnd_','exHistoryCancelSearch_','exHistoryFlushSearch_','exHistoryQueryInput_',
  'exHistorySortValue_','exHistoryGroupSortValue_','exHistoryCmp_','exHistoryTieCmp_',
  'exHistorySortItems_','exHistorySortGroups_','exSortHistory_','exHistorySortTh_',
  'exHistoryAnalysisFilter_','exHistoryValidDays_','exHistoryStatSummary_','exHistoryAnalyze_','exHistoryRollup_',
  'exHistoryDayText_',
  'exArmOfPart_','exArmOf_','exArmRecurrence_','exArmSummary_','exArmVerdict_',
  'exCauseArmMetric_','exCauseArmGroup_','exCauseArmRows_','exCauseArmTable_',
  'hpCleanVal_','hpCleanAsOf_','exToday',
  'exHistoryRollupTable_','exHistoryRollupTsv_',
  'exHistoryCopyValue_','exHistoryTsvCell_','exHistoryRowCopyText_','exHistoryRowsTsv_',
  'exClipboardFallback_','exClipboardWrite_','exHistoryItemById_','exCopyHistoryRow_','exHistoryRowCopyClick_',
  'exCopyHistoryTsv_','exOpenHospitalTimeline_','exHospitalHistoryUrl_',
  'exHospHistoryRows_','exHospPanelShell_','exHospPanelHtml_','exRenderHospPanel_',
  'exOpenHospPanel_','exCloseHospPanel_','exHospPanelMore_',
  'exCaptureHistoryUi_','exHistoryOptionExists_','exRestoreHistoryUi_','exCloseHistoryExample_','exHistoryRestoreSelection_',
  'exHistoryMoreHtml_','exHistoryShowMore_','exHistoryFilterChanged_','exHistoryTable_',
  'exHistoryDimValue_','exHistoryToolbarHtml_','exHistorySyncToolbar_','exSetHistoryView_','exSwitchHistoryDim_',
  'exHistoryOption_','exHistoryCell_','exHistoryDetail_','exTypeExampleNorm_','exTypeExampleKey_',
  'exHistoryControls_','exHistoryKpiRows_','exHistoryHospitalCount_','exHistoryKpiChip_','exHistoryResultHtml_',
  'exApplyHistoryFilters_','exResetHistoryFilters_','exRestoreHistoryModalUi_','exShowHistory_',
  'exRefreshHistoryForHospitalDB_','exSelectHistory_','exHistoryRowKey_','exSyncHistoryTypeExample_',
  'exHistoryExportData_','exExcelDate_','exHistoryPhotoPanel_','openExList','toggleExListFullscreen_','closeExList'];

/* ── 최소 DOM ── */
function decode(s){
  return String(s==null?'':s).replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
}
function makeDom(){
  const els=Object.create(null);
  let rowCache=Object.create(null);
  function mk(tag,id){
    const el={tagName:String(tag).toUpperCase(),id:id||'',textContent:'',value:'',hidden:false,disabled:false,
      _attrs:Object.create(null),_cls:Object.create(null),options:[],children:[],_html:''};
    el.classList={
      add:(...cs)=>{cs.forEach(c=>{el._cls[c]=1;});}, remove:(...cs)=>{cs.forEach(c=>{delete el._cls[c];});},
      toggle:(c,on)=>{ if(on===undefined) on=!el._cls[c]; if(on) el._cls[c]=1; else delete el._cls[c]; },
      contains:c=>!!el._cls[c]
    };
    el.setAttribute=(k,v)=>{el._attrs[k]=String(v);};
    el.getAttribute=k=>(k in el._attrs?el._attrs[k]:null);
    el.removeAttribute=k=>{delete el._attrs[k];};
    el.appendChild=c=>{el.children.push(c); if(el.tagName==='SELECT') el.options.push(c); return c;};
    el.removeChild=c=>{el.children=el.children.filter(x=>x!==c); return c;};
    el.focus=()=>{el.focused=true;}; el.select=()=>{}; el.setSelectionRange=()=>{};
    el.querySelector=sel=>{
      if(el.id==='hstHospPanel'&&/hst-hosp-close/.test(sel)&&/hst-hosp-close/.test(el._html)){
        if(!el._close) el._close=mk('button');
        return el._close;
      }
      return null;
    };
    el.style={};
    Object.defineProperty(el,'innerHTML',{
      get(){return el._html;},
      set(v){
        el._html=String(v==null?'':v);
        if(el.id==='hstTableHost') rowCache=Object.create(null);
        /* 도구 막대는 모달을 연 뒤 innerHTML 로 채워진다 — 그 안의 select 도 실제처럼 등록한다 */
        if(el.id==='hstToolbar') parseControls(el._html);
      }
    });
    Object.defineProperty(el,'selectedOptions',{get(){return el.options.filter(o=>o.value===el.value);}});
    return el;
  }
  function ensure(id,tag){ if(!els[id]) els[id]=mk(tag||'div',id); return els[id]; }
  /* 모달 HTML 에서 select/input 을 실제 option 목록과 함께 만든다 —
     "새 dim 에 존재하지 않는 option" 검증이 실제 동작과 같아야 한다. */
  function parseControls(html){
    const re=/<select id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g;
    let m;
    while((m=re.exec(html))){
      const sel=mk('select',m[1]);
      let om, ore=/<option value="([^"]*)"([^>]*)>([\s\S]*?)<\/option>/g;
      while((om=ore.exec(m[2]))){
        const opt=mk('option'); opt.value=decode(om[1]); opt.textContent=decode(om[3]);
        sel.options.push(opt);
        if(/\sselected/.test(om[2])) sel.value=opt.value;
      }
      if(!sel.value&&sel.options.length) sel.value=sel.options[0].value;
      els[m[1]]=sel;
    }
    let im, ire=/<input id="([^"]+)"/g;
    while((im=ire.exec(html))) els[im[1]]=mk('input',im[1]);
  }
  function buildDom(html){
    for(const k of Object.keys(els)) delete els[k];
    rowCache=Object.create(null);
    parseControls(html);
    ['hstView','hstTableHost','hstCount','hstBreakdown','hstToolbar','hstViewNote','hstCopyTsv','hstHospPanel',
     'hstPhotoPanel','hstPhotoStrip','hstPhotoStatus','hstPhotoTitle','hstPhotoBody','hstPhotoToggle',
     'exListTitle','exListSub','exListBody','exListBox','exListModal','toast'].forEach(id=>ensure(id));
    ensure('exListFullscreen','button');
    els.hstPhotoPanel.hidden=true;
  }
  function rowEl(id){
    if(!rowCache[id]){ const el=mk('tr'); el.setAttribute('data-hst-id',id); rowCache[id]=el; }
    return rowCache[id];
  }
  const viewBtns=[mk('button'),mk('button')];
  viewBtns[0].setAttribute('data-hst-view','rows');
  viewBtns[1].setAttribute('data-hst-view','hosp');
  const document={
    body:mk('body'),
    getElementById:id=>els[id]||null,
    createElement:tag=>mk(tag),
    execCommand:()=>document._copyOk,
    _copyOk:true,
    querySelector(sel){
      const m=/tr\[data-hst-id="([^"]+)"\]/.exec(sel);
      if(m){
        const host=els.hstTableHost;
        return (host&&host.innerHTML.indexOf('data-hst-id="'+m[1]+'"')>=0)?rowEl(m[1]):null;
      }
      return null;
    },
    querySelectorAll(sel){
      if(sel.indexOf('data-hst-view')>=0) return viewBtns;
      if(sel.indexOf('hst-selected')>=0)
        return Object.keys(rowCache).map(k=>rowCache[k]).filter(el=>el.classList.contains('hst-selected'));
      return [];
    }
  };
  return {document,els,buildDom,rowEl,viewBtns,ensure};
}

function build(){
  const dom=makeDom();
  const log={toasts:[],opened:null,windows:[],photo:[],clipboard:[]};
  const clipboard={ok:true,fail:false,text:null,calls:0};
  const navigator={clipboard:{writeText(t){
    clipboard.calls++;
    if(clipboard.fail) return Promise.reject(new Error('denied'));
    clipboard.text=t; return Promise.resolve();
  }}};
  const window={open:(u,t,f)=>{
    const w={opener:{},focus(){w.focused=true;},focused:false};
    log.windows.push({url:u,target:t,features:f,win:w});
    return w;
  }};
  const stubs=`
var F={},RAW=[],EX_ROWS=[],EX_CACHE=null,EX_HISTORY_STATE=null,EX_LEAK_STATE=null,HOSPDB=[];
var EX_HISTORY_PHOTO_SEQ=0,SALES={};
var EX_ARM_LABEL={repair:'내부수리',swap:'Handpiece 교체'};
var EX_HOSP_PANEL_PAGE=40;
var localStorage={_v:{},getItem:function(k){return (k in this._v)?this._v[k]:null;},
  setItem:function(k,v){this._v[k]=String(v);},removeItem:function(k){delete this._v[k];}};
var YC_CLEAN_SAVING_UNIT=281200,DEMO_MARK=/\\[\\s*데모\\s*장비\\s*\\]/;
function hospitalSales_(name){ return SALES[nkey(name)]||''; }
function exSavingEvidenceHtml_(){return '';}
function exBuild(){throw new Error('캐시 이외 집계 금지');}
function buildNozzleLeakCurrent_(){return {};}
function nlKpiData_(){return {label:'누수 대상',rows:EX_CACHE.rows};}
function exSetHistoryPhotoExpanded_(expanded){
  if(EX_HISTORY_STATE) EX_HISTORY_STATE.typeExampleExpanded=!!expanded;
  var body=document.getElementById('hstPhotoBody'); if(body) body.hidden=!expanded;
}
function exLoadHistoryTypeExample_(it){
  if(!EX_HISTORY_STATE) return;
  EX_HISTORY_STATE.selectedExampleItem=it;
  EX_HISTORY_STATE.selectedItemId=(it&&it.id)||'';
  EX_HISTORY_STATE.selectedKey=exTypeExampleKey_(it&&it.r);
  var panel=document.getElementById('hstPhotoPanel'); if(panel) panel.hidden=false;
  log.photo.push(EX_HISTORY_STATE.selectedItemId);
}
function toast(m){ log.toasts.push(m); }
/* 노즐·교육 상태 조회는 RAW 전체를 훑는 누수 분석 함수라 여기서는 주입해 쓴다 */
var EX_TEST_STATES={nozzle:{},skill:{}};
function exCycleHospStates_(){ return EX_TEST_STATES; }
`;
  const body=stubs+'\n'+RUNTIME+'\n'+FNS.map(grab).join('\n')+`
return {${FNS.join(',')},
  state:()=>EX_HISTORY_STATE, setState:s=>{EX_HISTORY_STATE=s;},
  prefs:()=>EX_HISTORY_PREFS, clearPrefs:()=>{EX_HISTORY_PREFS=null;},
  photoSeq:()=>EX_HISTORY_PHOTO_SEQ,
  searchPending:()=>!!EX_HISTORY_SEARCH_TIMER,
  page:()=>EX_HISTORY_PAGE,
  setSales:m=>{SALES=m;},
  setStates:v=>{EX_TEST_STATES=v;},
  set:(rows,raw,f)=>{RAW=raw;F=f||{};EX_CACHE={rows:rows,prev:[]};}};
`;
  const D=new Function('document','window','navigator','log','openExListHook',body.replace(
    /function openExList\(title, sub, html, wide\)\{/,
    'function openExList(title, sub, html, wide){ openExListHook(title,sub,html,wide);'
  ))(dom.document,window,navigator,log,(t,s,h,w)=>{ log.opened={title:t,sub:s,html:h,wide:w}; dom.buildDom(h); });
  D.dom=dom; D.log=log; D.clipboard=clipboard; D.win=window;
  return D;
}

/* ── 픽스처 ── */
const row=(id,day,hosp,extra={})=>{
  const [y,m,d]=day.split('-').map(Number);
  return {id,date:day,_y:y,_m:m,_d:d,_q:Math.ceil(m/3),hosp,gubun:'A/S',
    type:'노즐 누수(약액 유입)',cat:'핸드피스',part:'내부 세척',fse:'김프로',sn:'HP-001',
    detail:'누수 확인 후 내부 세척',cost:'',_cost:0,...extra};
};
const F={from:'2026-01-01',to:'2026-08-31',year:[],month:[]};
/* 경과일 17 / 82 / 없음 / 1 / 30 / 31 — 1일·30일 포함, 31일 제외 경계를 담는다 */
const CUR=[
  row('a','2026-08-31','가병원'),
  row('b','2026-08-20','나병원',{part:"Handpiece Ass'y"}),
  row('c','2026-08-13','다병원',{type:'풋스위치 작동 불량',part:'Foot s/w'}),
  row('d','2026-08-25','라병원'),
  row('e','2026-08-10','마병원'),
  row('f','2026-08-09','바병원')
];
const PREV=[
  row('a-p','2026-08-14','가병원'),
  row('b-p','2026-05-30','나병원',{part:'내부 세척'}),
  row('d-p','2026-08-24','라병원'),
  row('e-p','2026-07-11','마병원'),
  row('f-p','2026-07-09','바병원')
];
const RAW=CUR.concat(PREV);

function open(D,rows,raw,dim,name){
  D.set(rows,raw||RAW,F);
  D.exShowHistory_(dim||'kpiTotal',name);
  return D.state();
}
function renderedIds(D){
  const html=D.dom.els.hstTableHost.innerHTML;
  return [...html.matchAll(/data-hst-id="([^"]+)"/g)].map(m=>m[1])
    .filter((v,i,a)=>a.indexOf(v)===i);
}
function rowIds(D){ return (D.state().filtered||[]).map(it=>it.r.id); }
function setVal(D,id,v){ const el=D.dom.els[id]; if(el) el.value=v; }
const ymdOf=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');

let count=0;
const ck=(label,fn)=>{fn();count++;console.log('✅ '+label);};
const ckA=async(label,fn)=>{await fn();count++;console.log('✅ '+label);};

/* ══════ 1. 정렬 ══════ */
ck('1. 사용자가 정렬하기 전에는 기존 기본 정렬(처리일 최신순)과 완전히 같다',()=>{
  const D=build(); open(D,CUR);
  assert.equal(D.state().sort,null);
  assert.deepEqual(rowIds(D),['a','d','b','c','e','f']);
  assert.deepEqual(renderedIds(D),D.state().filtered.map(it=>it.id));
});
ck('2. 처리일 첫 클릭은 내림차순, 재클릭은 오름차순',()=>{
  const D=build(); open(D,CUR);
  D.exSortHistory_('date');
  assert.deepEqual(D.state().sort,{key:'date',dir:'desc'});
  assert.deepEqual(rowIds(D),['a','d','b','c','e','f']);
  D.exSortHistory_('date');
  assert.equal(D.state().sort.dir,'asc');
  assert.deepEqual(rowIds(D),['f','e','c','b','d','a']);
});
ck('3. 병원 첫 클릭은 오름차순(가나다), 재클릭은 내림차순',()=>{
  const D=build(); open(D,CUR);
  D.exSortHistory_('hosp');
  assert.deepEqual(D.state().sort,{key:'hosp',dir:'asc'});
  assert.deepEqual(rowIds(D),['a','b','c','d','e','f']);
  D.exSortHistory_('hosp');
  assert.deepEqual(rowIds(D),['f','e','d','c','b','a']);
});
ck('4. 비교 경과일 첫 클릭은 오름차순이며 비교 불가는 항상 마지막',()=>{
  const D=build(); open(D,CUR);
  D.exSortHistory_('elapsed');
  assert.deepEqual(rowIds(D),['d','a','e','f','b','c']);   /* 1,17,30,31,82,null */
  D.exSortHistory_('elapsed');
  assert.deepEqual(rowIds(D),['b','f','e','a','d','c']);   /* 내림차순에도 null 은 끝 */
});
ck('5. 동일비교 경과일 정렬도 같은 규칙이며 동일비교 없음은 마지막',()=>{
  const D=build(); open(D,CUR);
  D.exSortHistory_('same');
  assert.deepEqual(rowIds(D).slice(0,4),['d','a','e','f']);
  assert.deepEqual(rowIds(D).slice(4).sort(),['b','c']);
  D.exSortHistory_('same');
  assert.deepEqual(rowIds(D).slice(0,4),['f','e','a','d']);
  assert.deepEqual(rowIds(D).slice(4).sort(),['b','c']);
});
ck('6. 교체비용 정렬은 비용 열이 실제 표시되는 조회에서만 동작한다',()=>{
  const paid=[row('p1','2026-08-05','가병원',{cost:'100,000',_cost:100000}),
              row('p2','2026-08-06','나병원',{cost:'500,000',_cost:500000}),
              row('p3','2026-08-07','다병원',{cost:'50,000',_cost:50000})];
  const D=build(); open(D,paid,paid.concat(PREV),'cost');
  assert.equal(D.state().showCost,true);
  D.exSortHistory_('cost');
  assert.deepEqual(D.state().sort,{key:'cost',dir:'desc'});
  assert.deepEqual(rowIds(D),['p2','p1','p3']);
  D.exSortHistory_('cost');
  assert.deepEqual(rowIds(D),['p3','p1','p2']);
  const N=build(); open(N,CUR);
  N.exSortHistory_('cost');
  assert.equal(N.state().sort,null,'비용 열이 없는 조회에서는 비용 정렬을 제공하지 않는다');
});
ck('7. 처리일 오류·병원명 누락 행은 오름·내림 모두 마지막',()=>{
  const rows=CUR.concat([row('bad','2026-02-31','사병원'),row('noh','2026-08-18','')]);
  const D=build(); open(D,rows,rows.concat(PREV));
  D.exSortHistory_('date');
  assert.equal(rowIds(D)[rowIds(D).length-1],'bad');
  D.exSortHistory_('date');
  assert.equal(rowIds(D)[rowIds(D).length-1],'bad');
  D.exSortHistory_('hosp');
  assert.equal(rowIds(D)[rowIds(D).length-1],'noh');
  D.exSortHistory_('hosp');
  assert.equal(rowIds(D)[rowIds(D).length-1],'noh');
});
ck('8. 동률은 처리일 내림차순 → 병원명 오름차순 → 기존 item 순번으로 안정 정렬',()=>{
  /* 유형을 모두 다르게 둬 병원·VOC 쌍이 겹치지 않게 하고, 비교 이력은 주지 않아 전원 동률 */
  const tie=[row('t1','2026-08-10','나병원',{type:'유형B'}),row('t2','2026-08-12','가병원',{type:'유형A'}),
             row('t3','2026-08-10','가병원',{type:'유형C'}),row('t4','2026-08-12','나병원',{type:'유형D'}),
             row('t5','2026-08-12','가병원',{type:'유형E'}),row('t6','2026-08-12','가병원',{type:'유형F'})];
  const D=build(); open(D,tie,tie);
  const expected=['t2','t5','t6','t4','t3','t1'];   /* 처리일 ↓ → 병원 ↑ → 기존 순번 */
  D.exSortHistory_('elapsed');
  assert.deepEqual(rowIds(D),expected);
  const desc=D.exHistorySortItems_(D.state().items,{key:'elapsed',dir:'desc'},D.state().comparison);
  assert.deepEqual(desc.map(it=>it.r.id),expected,'방향이 달라도 동률 순서는 같다');
  const shuffled=D.state().items.slice().reverse();
  const again=D.exHistorySortItems_(shuffled,{key:'elapsed',dir:'asc'},D.state().comparison);
  assert.deepEqual(again.map(it=>it.r.id),expected,'입력 순서가 달라도 기존 순번으로 안정 정렬');
});
ck('9. period all 정렬은 그룹 단위이며 그룹 내부 cur→prev→same 순서를 유지한다',()=>{
  const D=build(); open(D,CUR);
  setVal(D,'hstPeriod','all'); D.exApplyHistoryFilters_();
  D.exSortHistory_('hosp');
  const ids=rowIds(D);
  assert.equal(ids[0],'a'); assert.equal(ids[1],'a-p');
  const items=D.state().filtered;
  for(let i=0;i<items.length;i++){
    if(items[i].period!=='cur'){
      const prevItem=items[i-1];
      assert.ok(prevItem&&prevItem.period!=='same','같은 그룹 안에서 cur → prev → same 순서');
    }
  }
  assert.equal(new Set(items.map(it=>it.r)).size,items.length,'같은 원본이 두 역할이어도 한 번만 표시');
});
ck('10. 그룹 정렬값은 cur 처리일 최댓값·유효 경과일 최솟값·cur 비용 합계',()=>{
  const D=build(); open(D,CUR);
  setVal(D,'hstPeriod','all'); D.exApplyHistoryFilters_();
  const groups=D.exHistoryGroupList_(D.state().items);
  const g=groups.find(x=>x.cur.length&&x.cur[0].r.hosp==='가병원');
  assert.equal(D.exHistoryGroupSortValue_(g,'elapsed',D.state().comparison),17);
  /* 같은 최신일 cur 복수 행: 경과일 최솟값과 비용 합계 */
  const multi=[row('m1','2026-08-31','가병원',{part:'내부 세척',cost:'1000',_cost:1000}),
               row('m2','2026-08-31','가병원',{part:"Handpiece Ass'y",cost:'2000',_cost:2000})];
  const raw=multi.concat([row('m-old','2026-08-01','가병원',{part:"Handpiece Ass'y"}),
                          row('m-mid','2026-08-20','가병원',{part:'내부 세척'})]);
  const E=build(); open(E,multi,raw);
  const eg=E.exHistoryGroupList_(E.state().items)[0];
  assert.equal(E.exHistoryGroupSortValue_(eg,'elapsed',E.state().comparison),11,'8/31−8/20 = 11일 최솟값');
  assert.equal(E.exHistoryGroupSortValue_(eg,'cost',E.state().comparison),3000,'cur 비용 합계');
  assert.equal(E.exHistoryGroupSortValue_(eg,'date',E.state().comparison),
    new Date('2026-08-31T00:00:00').getTime(),'cur 처리일 최댓값');
});
ck('11. 정렬 후에도 행 선택은 실제 클릭한 item 을 가리킨다',()=>{
  const D=build(); open(D,CUR);
  D.exSortHistory_('hosp'); D.exSortHistory_('hosp');   /* 병원 내림차순 */
  const ids=renderedIds(D);
  assert.deepEqual(ids,D.state().filtered.map(it=>it.id),'렌더 순서 = filtered 순서');
  const clicked=ids[2];
  const tr=D.dom.rowEl(clicked);
  D.exSelectHistory_(clicked,tr);
  assert.equal(D.state().selectedExampleItem.id,clicked);
  assert.equal(D.state().selectedExampleItem.r.id,D.state().filtered[2].r.id);
  assert.equal(D.state().selectedExampleItem.r.hosp,'라병원');
});
ck('12. 정렬 후 복사 결과도 클릭한 item 과 일치한다',()=>{
  const D=build(); open(D,CUR);
  D.exSortHistory_('elapsed');
  const clicked=renderedIds(D)[0];                        /* 경과일 1일 = 라병원 */
  const text=D.exHistoryRowCopyText_(D.exHistoryItemById_(clicked));
  assert.ok(text.startsWith('라병원 | 2026-08-25 |'),text);
});
ck('13. 헤더에 aria-sort 와 방향 표시가 붙고 접근 가능한 버튼이다',()=>{
  const D=build(); open(D,CUR);
  let html=D.dom.els.hstTableHost.innerHTML;
  assert.ok(html.includes('aria-sort="none"'));
  assert.ok(html.includes('aria-label="처리일 기준 내림차순 정렬"'));
  D.exSortHistory_('date');
  html=D.dom.els.hstTableHost.innerHTML;
  assert.ok(html.includes('aria-sort="descending"'));
  assert.ok(html.includes('aria-label="처리일 기준 오름차순 정렬"'),'재클릭 방향을 안내');
  assert.ok(html.includes('type="button"'));
});

/* ══════ 2. 검색 ══════ */
ck('14. 공백으로 구분한 일반 키워드는 AND 로 좁힌다',()=>{
  const D=build(); open(D,CUR);
  setVal(D,'hstQuery','가병원 누수'); D.exApplyHistoryFilters_();
  assert.deepEqual(rowIds(D),['a']);
  setVal(D,'hstQuery','가병원 풋스위치'); D.exApplyHistoryFilters_();
  assert.deepEqual(rowIds(D),[]);
});
ck('15. "-키워드" 는 제외 조건이다',()=>{
  const D=build(); open(D,CUR);
  setVal(D,'hstQuery','-풋스위치'); D.exApplyHistoryFilters_();
  assert.deepEqual(rowIds(D),['a','d','b','e','f']);
  setVal(D,'hstQuery','누수 -가병원 -나병원'); D.exApplyHistoryFilters_();
  assert.deepEqual(rowIds(D),['d','c','e','f'],'다병원은 처리 내용에 "누수"가 있어 남는다');
});
ck('16. 단독 "-" 는 무시하고, 대소문자·앞뒤·연속 공백은 정규화한다',()=>{
  const D=build();
  assert.deepEqual(D.exHistoryParseQuery_('-'),{include:[],exclude:[],empty:true,text:'-'});
  assert.deepEqual(D.exHistoryParseQuery_('  가  나 '),{include:['가','나'],exclude:[],empty:false,text:'가 나'});
  assert.deepEqual(D.exHistoryParseQuery_('A -B'),{include:['a'],exclude:['b'],empty:false,text:'a -b'});
  open(D,CUR);
  setVal(D,'hstQuery','  -   가병원  '); D.exApplyHistoryFilters_();
  assert.deepEqual(rowIds(D),['a'],'단독 - 는 무시되고 "가병원"은 일반 키워드로 남는다');
  setVal(D,'hstQuery','- -가병원'); D.exApplyHistoryFilters_();
  assert.deepEqual(rowIds(D),['d','b','c','e','f'],'붙여 쓴 -가병원 만 제외 조건');
  setVal(D,'hstQuery','HP-001'); D.exApplyHistoryFilters_();
  assert.equal(rowIds(D).length,6,'하이픈이 안에 있는 토큰은 제외 조건이 아니다');
});
ck('17. 검색 대상은 처리일·병원명·장비번호·구분·현장/영업 담당자·VOC·교체품·처리 내용',()=>{
  const D=build();
  D.setSales({[D.nkey('가병원')]:'영업가'});
  open(D,CUR);
  const cases=[['2026-08-31',1],['가병원',1],['HP-001',6],['a/s',6],['김프로',6],
    ['영업가',1],['풋스위치',1],["handpiece ass'y",1],['foot',1],['내부 세척',6]];
  for(const [q,n] of cases){
    setVal(D,'hstQuery',q); D.exApplyHistoryFilters_();
    assert.equal(rowIds(D).length,n,q+' → '+rowIds(D).length);
  }
});
await ckA('18. 한글 IME 조합 중에는 검색하지 않고 compositionend 이후 실행한다',async()=>{
  const D=build(); open(D,CUR);
  D.exHistoryComposeStart_();
  setVal(D,'hstQuery','ㄱ');
  D.exHistoryQueryInput_();
  assert.equal(D.searchPending(),false,'조합 중에는 timer 도 걸지 않는다');
  setVal(D,'hstQuery','가병원');
  D.exHistoryComposeEnd_();
  assert.equal(D.searchPending(),true,'조합이 끝나면 디바운스가 시작된다');
  assert.deepEqual(rowIds(D).length,6,'아직 반영 전');
  await new Promise(r=>setTimeout(r,260));
  assert.deepEqual(rowIds(D),['a'],'디바운스 후 반영');
});
await ckA('19. 디바운스 대기 중 모달을 닫으면 이전 timer 가 취소된다',async()=>{
  const D=build(); open(D,CUR);
  setVal(D,'hstQuery','가병원'); D.exHistoryQueryInput_();
  assert.equal(D.searchPending(),true);
  D.closeExList();
  assert.equal(D.searchPending(),false);
  assert.equal(D.state(),null);
  await new Promise(r=>setTimeout(r,260));
  assert.equal(D.state(),null,'닫힌 뒤 실행되어 새 상태를 만들지 않는다');
});
await ckA('20. 디바운스 대기 중 dim 을 바꾸면 이전 검색이 새 모집단을 덮지 않는다',async()=>{
  const D=build(); open(D,CUR);
  setVal(D,'hstQuery','가병원'); D.exHistoryQueryInput_();
  const before=D.state().seq;
  D.exSwitchHistoryDim_('kpiAs');
  assert.equal(D.searchPending(),false,'dim 전환이 대기 중 timer 를 취소');
  assert.ok(D.state().seq>before,'새 open sequence');
  await new Promise(r=>setTimeout(r,260));
  assert.equal(D.state().dim,'kpiAs');
});
await ckA('21. 늦게 실행된 이전 검색은 새로 열린 처리이력 상태를 덮지 않는다',async()=>{
  const D=build(); open(D,CUR);
  setVal(D,'hstQuery','가병원'); D.exHistoryQueryInput_();
  const stale=D.state();
  stale.seq=stale.seq+100;                      /* 다른 조회가 열린 상황을 흉내 */
  await new Promise(r=>setTimeout(r,260));
  assert.equal(rowIds(D).length,6,'대기 중이던 검색이 적용되지 않는다');
});
ck('22. 복사·Excel 직전에는 대기 중인 검색을 즉시 반영한다',()=>{
  const D=build(); open(D,CUR);
  setVal(D,'hstQuery','가병원'); D.exHistoryQueryInput_();
  assert.equal(rowIds(D).length,6);
  D.exCopyHistoryTsv_();
  assert.deepEqual(rowIds(D),['a'],'복사 직전 flush');
  assert.equal(D.searchPending(),false);
  setVal(D,'hstQuery','나병원'); D.exHistoryQueryInput_();
  assert.ok(grab('exportHistoryComparisonExcel_').includes('exHistoryFlushSearch_()'),'Excel 진입에도 flush');
  D.exHistoryFlushSearch_();
  assert.deepEqual(rowIds(D),['b']);
});
ck('23. 팩싯 칩의 자기 그룹 제외 계산은 기존 동작을 유지한다',()=>{
  const D=build(); open(D,CUR);
  setVal(D,'hstType','풋스위치 작동 불량'); D.exApplyHistoryFilters_();
  const html=D.dom.els.hstBreakdown.innerHTML;
  const voc=html.slice(html.indexOf('VOC 유형별 건수'));
  assert.match(voc,/노즐 누수\(약액 유입\) <b>5건<\/b>/,'자기 그룹 조건은 빼고 센다');
  assert.ok(html.includes('aria-pressed="true"'));
});

/* ══════ 3. 경과일 요약 통계 ══════ */
ck('24. 분석 모집단은 표의 기간 선택과 무관하게 최신 선택(cur)으로 고정한다',()=>{
  const D=build(); open(D,CUR);
  const base=D.state().analysis.general.cases;
  assert.equal(base,6);
  for(const p of ['prev','same','all']){
    setVal(D,'hstPeriod',p); D.exApplyHistoryFilters_();
    assert.equal(D.state().analysis.general.cases,6,p+' 에서도 통계가 0 으로 사라지지 않는다');
  }
});
ck('25. 평균·중앙값(홀수)·최단·30일 이내 건수와 비율',()=>{
  const D=build(); open(D,CUR);
  const g=D.state().analysis.general;
  assert.equal(g.cases,6); assert.equal(g.comparable,5);
  assert.equal(g.avg,32.2);                    /* (1+17+30+31+82)/5 */
  assert.equal(g.median,30);                   /* 홀수 → 가운데 값 */
  assert.equal(g.min,1);
  assert.equal(g.within30,3);                  /* 1·17·30 — 31일은 제외 */
  assert.equal(g.within30Ratio,60);
});
ck('26. 동일비교 통계는 별도 단위로 계산하며 짝수 개 중앙값은 가운데 두 값 평균',()=>{
  const D=build(); open(D,CUR);
  const s=D.state().analysis.same;
  assert.equal(s.cases,6); assert.equal(s.comparable,4);   /* 17·1·30·31 */
  assert.equal(s.median,23.5);                 /* (17+30)/2 */
  assert.equal(s.avg,19.8);
  assert.equal(s.min,1);
  assert.equal(s.within30,3);
  assert.equal(s.within30Ratio,75);
});
ck('27. 같은 최신일의 복수 cur 행으로 통계가 부풀지 않는다(일반 비교 중복 제거)',()=>{
  const rows=[row('x1','2026-08-31','가병원',{part:'내부 세척'}),
              row('x2','2026-08-31','가병원',{part:"Handpiece Ass'y"}),
              row('x3','2026-08-31','가병원',{part:'내부 세척',sn:'HP-002'})];
  const raw=rows.concat([row('x-old','2026-08-20','가병원',{part:'내부 세척'})]);
  const D=build(); open(D,rows,raw);
  const a=D.state().analysis;
  assert.equal(a.general.cases,1,'병원+VOC+선택일 단위로 1사례');
  assert.equal(a.general.comparable,1);
  assert.equal(a.general.median,11);
  assert.equal(a.same.cases,2,'병원+VOC+교체품+선택일 단위로 2사례');
  assert.equal(a.same.comparable,1,"Handpiece Ass'y 는 동일비교 이력 없음");
});
ck('28. 동일 원본이 prev 와 same 역할을 함께 해도 한 통계에서 두 번 세지 않는다',()=>{
  const D=build(); open(D,CUR);
  const shared=D.state().items.filter(it=>it.period==='prev'&&it.sameComparison);
  assert.ok(shared.length>0,'두 역할을 동시에 하는 원본이 있다');
  assert.equal(D.state().analysis.general.cases,6);
  assert.equal(D.state().analysis.general.comparable,5);
  const units=D.state().analysis.units;
  assert.equal(new Set(units.map(u=>u.key)).size,units.length,'단위 키 중복 없음');
});
ck('29. 비교 없음·교체품 없음은 0 이 아니라 —(null) 로 남는다',()=>{
  const D=build();
  const lone=[row('only','2026-08-31','가병원',{part:''})];
  open(D,lone,lone);
  const a=D.state().analysis;
  assert.equal(a.general.cases,1); assert.equal(a.general.comparable,0);
  assert.equal(a.general.avg,null); assert.equal(a.general.median,null);
  assert.equal(a.general.min,null); assert.equal(a.general.within30,null);
  assert.equal(a.same.cases,1); assert.equal(a.same.comparable,0);
  assert.ok(D.exHistoryDayText_(null,'일').includes('—'));
});
ck('30. 처리일 오류·병원명/VOC 누락 사례는 분석 대상에 세되 비교 가능에서는 빠진다',()=>{
  const rows=CUR.concat([row('bad','2026-02-31','가병원'),row('noh','2026-08-18',''),
                         row('novoc','2026-08-17','아병원',{type:''})]);
  const D=build(); open(D,rows,rows.concat(PREV));
  const a=D.state().analysis;
  assert.equal(a.general.cases,9,'각각 독립 사례로 남는다');
  assert.equal(a.general.comparable,5,'비교 가능 수는 그대로');
  const bad=a.units.filter(u=>!u.valid);
  assert.equal(bad.length,3);
  assert.ok(bad.every(u=>u.days===null));
});
ck('31. 유효 경과일은 1일 이상이며 1일·30일은 포함, 31일은 제외한다',()=>{
  const D=build();
  assert.equal(D.exHistoryValidDays_(0),null);
  assert.equal(D.exHistoryValidDays_(1),1);
  const s=D.exHistoryStatSummary_([1,30,31,null]);
  assert.equal(s.cases,4); assert.equal(s.comparable,3);
  assert.equal(s.within30,2); assert.equal(s.min,1);
});
ck('32. 처리이력 모달에서는 일반·동일비교 경과일 요약 카드를 그리지 않는다',()=>{
  const D=build(); open(D,CUR);
  assert.ok(!D.log.opened.html.includes('id="hstStats"'));
  assert.ok(!D.log.opened.html.includes('일반 비교 경과일'));
  assert.ok(!D.log.opened.html.includes('동일비교 경과일'));
  assert.ok(!D.log.opened.html.includes('경과일 분석'));
});
ck('33. 개별 근거 조회용 비교·동일비교 경과일 열은 유지한다',()=>{
  const D=build(); open(D,CUR);
  const html=D.dom.els.hstTableHost.innerHTML;
  assert.ok(html.includes('비교 경과일'));
  assert.ok(html.includes('동일비교 경과일'));
  assert.ok(D.log.opened.html.includes('비교 근거 원본 Excel'));
});

/* ══════ 4. 병원별 롤업 ══════ */
ck('34. 병원별 보기는 통계와 같은 분석 결과를 쓰고 병원명은 기존 정규화 규칙을 따른다',()=>{
  const rows=[row('h1','2026-08-31',' 가 병원 '),row('h2','2026-08-20','가병원',{type:'풋스위치 작동 불량'}),
              row('h3','2026-08-10','나병원')];
  const raw=rows.concat([row('h1-p','2026-08-25','가병원'),row('h3-p','2026-08-05','나병원')]);
  const D=build(); open(D,rows,raw);
  D.exSetHistoryView_('hosp');
  const rollup=D.state().rollup;
  assert.equal(rollup.length,2,'공백만 다른 병원명은 한 곳으로 묶인다');
  const ga=rollup.find(r=>D.nkey(r.hosp)==='가병원');
  assert.equal(ga.cases,2);
  assert.equal(D.ymd(ga.last),'2026-08-31','최근 처리일');
  assert.equal(ga.comparable,1); assert.equal(ga.median,6); assert.equal(ga.within30,1);
  const total=D.state().analysis.general.cases;
  assert.equal(rollup.reduce((a,r)=>a+r.cases,0),total,'롤업 합계 = 분석 사례 수');
});
ck('35. 병원명 누락 행은 하나의 가짜 병원으로 합치지 않고 데이터 오류로 분리한다',()=>{
  const rows=[row('n1','2026-08-31',''),row('n2','2026-08-30',''),row('ok','2026-08-20','가병원')];
  const D=build(); open(D,rows,rows);
  D.exSetHistoryView_('hosp');
  const rollup=D.state().rollup;
  assert.equal(rollup.filter(r=>r.error).length,2,'누락 사례가 각각 분리된다');
  assert.equal(rollup[rollup.length-1].error,true,'데이터 오류 행은 뒤로');
  const html=D.dom.els.hstTableHost.innerHTML;
  assert.ok(html.includes('병원명 미입력 · 데이터 오류'));
});
ck('36. 최다 VOC 동률은 축약 표시하고 tooltip 에 전체를 담는다',()=>{
  const rows=[row('v1','2026-08-31','가병원',{type:'노즐 누수(약액 유입)'}),
              row('v2','2026-08-30','가병원',{type:'풋스위치 작동 불량'})];
  const D=build(); open(D,rows,rows);
  D.exSetHistoryView_('hosp');
  const r=D.state().rollup[0];
  assert.equal(r.topTypes.length,2);
  assert.equal(r.topLabel,'공동 2개');
  assert.ok(r.topTitle.includes('노즐 누수(약액 유입)')&&r.topTitle.includes('풋스위치 작동 불량'));
  assert.ok(D.dom.els.hstTableHost.innerHTML.includes('공동 2개'));
});
ck('37. 비교 가능 사례가 없으면 중앙값은 —, 있으면 중앙값을 주 지표로 쓴다',()=>{
  const rows=[row('m1','2026-08-31','가병원')];
  const D=build(); open(D,rows,rows);
  D.exSetHistoryView_('hosp');
  assert.equal(D.state().rollup[0].median,null);
  assert.equal(D.state().rollup[0].comparable,0);
  assert.ok(D.dom.els.hstTableHost.innerHTML.includes('—'));
  assert.ok(grab('exHistoryRollupTable_').includes('재발 간격 중앙값'));
});
ck('38. 비용 원본이 빈값이면 —, 실제 0원이면 ₩0 으로 구분한다',()=>{
  const zero=[row('z','2026-08-31','가병원',{cost:'0',_cost:0})];
  const blank=[row('n','2026-08-31','나병원',{cost:'',_cost:0})];
  const paid=[row('p','2026-08-31','다병원',{cost:'100,000',_cost:100000})];
  const rows=zero.concat(blank,paid);
  const D=build(); open(D,rows,rows);
  D.exSetHistoryView_('hosp');
  const by=n=>D.state().rollup.find(r=>r.hosp===n);
  assert.equal(by('가병원').costFilled,1); assert.equal(by('가병원').cost,0);
  assert.equal(by('나병원').costFilled,0);
  assert.equal(by('다병원').cost,100000);
  const html=D.dom.els.hstTableHost.innerHTML;
  assert.ok(html.includes('₩0')&&html.includes('₩100,000')&&html.includes('—'));
  const visible=html.replace(/title="[^"]*"/g,'');
  assert.ok(visible.includes('>최신 선택 비용 합계<'));
  assert.ok(!visible.includes('누적비용'),'화면 표기에 누적비용을 쓰지 않는다');
});
ck('39. 병원별 보기 진입은 예시 패널을 숨기고 진행 중인 비동기 요청을 무효화한다',()=>{
  const D=build(); open(D,CUR);
  const id=renderedIds(D)[0];
  D.exSelectHistory_(id,D.dom.rowEl(id));
  assert.equal(D.dom.els.hstPhotoPanel.hidden,false);
  const seq=D.photoSeq();
  D.exSetHistoryView_('hosp');
  assert.ok(D.photoSeq()>seq,'예시자료 요청 sequence 무효화');
  assert.equal(D.dom.els.hstPhotoPanel.hidden,true);
  assert.equal(D.state().selectedItemId,'');
  assert.ok(!D.dom.els.hstTableHost.innerHTML.includes('exSelectHistory_'),'롤업 행 클릭으로 예시자료가 열리지 않는다');
});
ck('40. 병원별 보기에서 period select 는 비활성화되고 행 보기로 돌아가면 기존 period 를 복원한다',()=>{
  const D=build(); open(D,CUR);
  setVal(D,'hstPeriod','all'); D.exApplyHistoryFilters_();
  D.exSetHistoryView_('hosp');
  assert.equal(D.dom.els.hstPeriod.disabled,true);
  assert.equal(D.dom.els.hstPeriod.value,'cur');
  assert.equal(D.state().period,'cur');
  assert.ok(D.dom.els.hstViewNote.textContent.includes('최신 선택 기준'));
  D.exSetHistoryView_('rows');
  assert.equal(D.dom.els.hstPeriod.disabled,false);
  assert.equal(D.dom.els.hstPeriod.value,'all','행 보기로 돌아갈 때 기존 period 복원');
});
ck('41. 롤업 TSV 와 비교 근거 원본 Excel 의 범위는 서로 독립이다',()=>{
  const D=build(); open(D,CUR);
  const excelRows=D.exHistoryExportData_(D.state()).records.length;
  D.exSetHistoryView_('hosp');
  const tsv=D.exHistoryRollupTsv_(D.state().rollup).split('\n');
  assert.equal(tsv[0].split('\t')[0],'병원');
  assert.equal(tsv[0].split('\t').length,8);
  assert.equal(tsv.length-1,D.state().rollup.length);
  assert.notEqual(tsv.length-1,excelRows,'Excel 은 비교·동일비교 원본까지 보존');
  const after=D.exHistoryExportData_(D.state()).records.length;
  assert.ok(after>0,'Excel 은 롤업 보기에서도 비교 근거 원본을 유지');
  assert.ok(SRC.includes('비교 근거 원본 Excel'));
});

/* ══════ 5. 복사 ══════ */
await ckA('42. 행 복사는 지정 형식·한 줄·빈값 미입력으로 정규화한다',async()=>{
  const rows=[row('c1','2026-08-31','가병원',{detail:'누수 확인\t후\n내부 세척',part:'없음',fse:''})];
  const D=build(); open(D,rows,rows);
  const it=D.state().items[0];
  const text=D.exHistoryRowCopyText_(it);
  assert.equal(text,'가병원 | 2026-08-31 | HP-001 | A/S | 미입력 | 노즐 누수(약액 유입) | 미입력 | 누수 확인 후 내부 세척');
  assert.equal(text.indexOf('\n'),-1); assert.equal(text.indexOf('\t'),-1);
  D.exCopyHistoryRow_(it.id);
  await new Promise(r=>setTimeout(r,0));
  assert.equal(D.clipboard.text,text);
  assert.ok(D.log.toasts.some(t=>t.includes('복사')));
});
await ckA('43. clipboard 실패 시 textarea/execCommand fallback 으로 되돌아간다',async()=>{
  const D=build(); open(D,CUR);
  D.clipboard.fail=true; D.dom.document._copyOk=true;
  let ok=await D.exClipboardWrite_('x');
  assert.equal(ok,true,'fallback 성공');
  D.dom.document._copyOk=false;
  ok=await D.exClipboardWrite_('x');
  assert.equal(ok,false);
  D.exCopyHistoryRow_(D.state().items[0].id);
  await new Promise(r=>setTimeout(r,0));
  assert.ok(D.log.toasts.some(t=>t.includes('❌')),'실패도 toast 로 알린다');
});
await ckA('44. 필터 결과 TSV 는 렌더된 행이 아니라 전체 결과를 헤더와 함께 복사한다',async()=>{
  const many=[]; for(let i=0;i<320;i++) many.push(row('m'+i,'2026-08-'+String((i%28)+1).padStart(2,'0'),'병원'+i));
  const D=build(); open(D,many,many);
  assert.equal(renderedIds(D).length,200,'화면은 200행');
  D.exCopyHistoryTsv_();
  await new Promise(r=>setTimeout(r,0));
  const lines=D.clipboard.text.split('\n');
  assert.equal(lines.length,321,'헤더 1 + 전체 320행');
  assert.equal(lines[0].split('\t')[0],'기간');
  assert.ok(lines[0].includes('장비번호')&&lines[0].includes('처리 내용'));
});
ck('45. 복사 버튼과 병원 링크는 부모 행 클릭으로 전파되지 않는다',()=>{
  const D=build(); open(D,CUR);
  let stopped=0,prevented=0;
  const e={stopPropagation:()=>{stopped++;},preventDefault:()=>{prevented++;},target:{}};
  D.exHistoryRowCopyClick_(e,{getAttribute:()=>D.state().items[0].id});
  assert.equal(stopped,1); assert.equal(prevented,1);
  D.exOpenHospPanel_(e,{getAttribute:()=>'가병원'});
  assert.equal(stopped,2,'병원 링크도 행 클릭으로 전파되지 않는다');
  assert.equal(D.log.windows.length,0,'병원 링크는 새 창을 띄우지 않는다');
  D.exOpenHospitalTimeline_(e,{getAttribute:()=>'가 병원 (본원)'});
  const opened=D.log.windows[0];
  assert.equal(opened.url,'hospital-pc.html?hosp='+encodeURIComponent('가 병원 (본원)')+'&view=hist');
  assert.ok(opened.url.includes('%20'),'공백 인코딩');
  assert.ok(/%E[0-9A-F]/i.test(opened.url),'한글 인코딩');
  assert.equal(decodeURIComponent(opened.url.split('hosp=')[1].split('&')[0]),'가 병원 (본원)','괄호까지 원문 복원');
  /* 행 안의 버튼에서 올라온 Enter/Space 는 행 선택으로 처리하지 않는다 */
  const tr=D.dom.rowEl('hr0');
  assert.equal(D.exHistoryRowKey_({keyCode:13,target:{}},'hr0',tr),true);
});
ck('46. 복사 버튼은 type=button 과 구체적인 aria-label 을 갖는다',()=>{
  const D=build(); open(D,CUR);
  const html=D.dom.els.hstTableHost.innerHTML;
  assert.match(html,/<button type="button" class="hst-copy"[^>]*aria-label="가병원 2026-08-31 처리 이력 한 줄로 복사"/);
  assert.match(html,/class="hst-hosp-link"[^>]*aria-label="가병원 처리 이력 오른쪽 패널로 열기"/);
  assert.ok(D.dom.els.hstToolbar.innerHTML.includes('aria-label="현재 필터 결과 전체를 헤더 포함 TSV로 복사"'));
});

/* ══════ 6. 필터 상태 유지 · dim 전환 ══════ */
ck('47. 닫았다 다시 열면 마지막 조회 설정이 유지되고 선택 예시자료는 초기화된다',()=>{
  const D=build(); open(D,CUR);
  setVal(D,'hstGubun','A/S'); setVal(D,'hstQuery','누수');
  D.exSortHistory_('hosp');
  D.exSetHistoryView_('hosp'); D.exSetHistoryView_('rows');
  const id=renderedIds(D)[0];
  D.exSelectHistory_(id,D.dom.rowEl(id));
  D.exHistoryShowMore_();
  assert.equal(D.state().renderLimit,400);
  D.closeExList();
  assert.ok(D.prefs());
  open(D,CUR);
  assert.equal(D.dom.els.hstGubun.value,'A/S');
  assert.equal(D.dom.els.hstQuery.value,'누수');
  assert.deepEqual(D.state().sort,{key:'hosp',dir:'asc'},'정렬 유지');
  assert.equal(D.state().view,'rows','보기 상태 유지');
  assert.equal(D.state().selectedItemId,'','선택된 예시자료는 유지하지 않는다');
  assert.equal(D.state().renderLimit,200,'렌더된 더 보기 개수는 유지하지 않는다');
  assert.equal(D.dom.els.hstPhotoPanel.hidden,true);
});
ck('48. dim 전환은 모집단·comparison 을 다시 계산하고 전역 필터 F 는 그대로 둔다',()=>{
  const D=build(); open(D,CUR,RAW,'typeAll','노즐 누수(약액 유입)');
  const before=JSON.stringify(F);
  assert.equal(D.state().originDim,'typeAll');
  assert.equal(D.state().originName,'노즐 누수(약액 유입)');
  D.exSwitchHistoryDim_('kpiTotal');
  assert.equal(D.state().dim,'kpiTotal');
  assert.equal(D.state().originDim,'typeAll','name 이 필요한 진입은 "현재 조회"로 보존');
  assert.equal(JSON.stringify(F),before,'대시보드 전역 필터 F 는 변하지 않는다');
  assert.ok(D.dom.els.hstDim.options.map(o=>o.value).join(',')
    .startsWith('__current__,kpiTotal,kpiAs,kpiInsp,cost'),'VOC·교체품을 다시 나열하지 않는다');
  D.exSwitchHistoryDim_('__current__');
  assert.equal(D.state().dim,'typeAll');
  assert.equal(D.state().name,'노즐 누수(약액 유입)');
});
ck('49. dim 전환에서는 새 모집단에 실제 존재하는 option 만 유지한다',()=>{
  const rows=CUR.concat([row('insp','2026-08-18','자병원',{gubun:'점검',type:'점검 전용 유형',fse:'점검담당'})]);
  const D=build(); open(D,rows,rows.concat(PREV));
  setVal(D,'hstType','점검 전용 유형'); setVal(D,'hstFse','점검담당'); setVal(D,'hstQuery','누수');
  D.exApplyHistoryFilters_();
  D.exSwitchHistoryDim_('kpiAs');                 /* A/S 만 남아 점검 전용 값이 사라진다 */
  assert.equal(D.dom.els.hstType.value,'all','없는 VOC 는 유지하지 않는다');
  assert.equal(D.dom.els.hstFse.value,'all','없는 담당자는 유지하지 않는다');
  assert.equal(D.dom.els.hstQuery.value,'누수','검색어는 가능한 경우 유지');
  assert.ok(!D.dom.els.hstType.options.some(o=>o.value==='점검 전용 유형'),'없는 값을 동적으로 삽입하지 않는다');
});
ck('50. 병원DB 지연 갱신은 기존 값을 최대한 유지한다(없는 option 도 되살린다)',()=>{
  const D=build(); open(D,CUR);
  D.dom.els.hstSales.options.push({value:'영업가',textContent:'영업가'});
  setVal(D,'hstSales','영업가'); setVal(D,'hstQuery','누수');
  D.exSortHistory_('hosp');
  const seq=D.state().seq;
  assert.equal(D.exRefreshHistoryForHospitalDB_(seq),true);
  assert.equal(D.dom.els.hstSales.value,'영업가','새 목록에 없어도 유지');
  assert.equal(D.dom.els.hstQuery.value,'누수');
  assert.deepEqual(D.state().sort,{key:'hosp',dir:'asc'});
});
ck('51. 병원DB 지연 도착 중 사용자가 dim 을 다시 바꿨다면 갱신을 건너뛴다',()=>{
  const D=build(); open(D,CUR);
  const stale=D.state().seq;
  D.exSwitchHistoryDim_('kpiAs');
  assert.equal(D.exRefreshHistoryForHospitalDB_(stale),false,'옛 응답이 새 dim 을 덮지 않는다');
  assert.equal(D.state().dim,'kpiAs');
  assert.equal(D.exRefreshHistoryForHospitalDB_(D.state().seq),true);
  assert.equal(D.state().dim,'kpiAs');
});
ck('52. 캡처·복원·검증은 하나의 공통 함수를 쓴다(병원DB·dim 전환·재오픈 공용)',()=>{
  for(const n of ['exRefreshHistoryForHospitalDB_','exSwitchHistoryDim_'])
    assert.ok(grab(n).includes('exCaptureHistoryUi_'),n);
  assert.ok(grab('exRestoreHistoryModalUi_').includes('exRestoreHistoryUi_'));
  assert.ok(grab('closeExList').includes('exCaptureHistoryUi_'));
  assert.ok(grab('exRestoreHistoryUi_').includes('exHistoryOptionExists_'));
  const noComment=t=>t.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
  assert.ok(!/localStorage|sessionStorage/.test(noComment(grab('exCaptureHistoryUi_')+grab('closeExList')+grab('exRestoreHistoryUi_'))),
    '마지막 조회 설정을 localStorage 에 저장하지 않는다');
});

/* ══════ 7. 대량 렌더 제한 ══════ */
ck('53. 수천 items 에서도 최초 200행만 렌더하고 표시 범위를 명시한다',()=>{
  const many=[]; for(let i=0;i<1243;i++) many.push(row('b'+i,'2026-08-'+String((i%28)+1).padStart(2,'0'),'병원'+i));
  const D=build(); open(D,many,many);
  assert.equal(D.state().filtered.length,1243);
  assert.equal(renderedIds(D).length,200);
  const html=D.dom.els.hstTableHost.innerHTML;
  assert.match(html,/200 \/ 전체 1,243행 표시/);
  assert.ok(html.includes('행 더 보기'));
});
ck('54. "더 보기"는 200행씩 늘리고 필터·정렬·dim 전환은 200으로 되돌린다',()=>{
  const many=[]; for(let i=0;i<600;i++) many.push(row('b'+i,'2026-08-'+String((i%28)+1).padStart(2,'0'),'병원'+i));
  const D=build(); open(D,many,many);
  D.exHistoryShowMore_();
  assert.equal(renderedIds(D).length,400);
  D.exHistoryShowMore_();
  assert.equal(renderedIds(D).length,600);
  assert.ok(!D.dom.els.hstTableHost.innerHTML.includes('행 더 보기'),'끝까지 그리면 버튼이 사라진다');
  D.exHistoryShowMore_();
  D.exSortHistory_('hosp');
  assert.equal(renderedIds(D).length,200,'정렬 시 초기화');
  D.exHistoryShowMore_();
  setVal(D,'hstQuery','병원1'); D.exApplyHistoryFilters_();
  assert.equal(D.state().renderLimit,200,'필터 변경 시 초기화');
  D.exHistoryShowMore_();
  D.exSwitchHistoryDim_('kpiAs');
  assert.equal(D.state().renderLimit,200,'dim 전환 시 초기화');
});
await ckA('55. 정렬은 전체 결과에 먼저 적용하고, 통계·팩싯·복사는 200행 제한과 무관하다',async()=>{
  const many=[]; for(let i=0;i<500;i++) many.push(row('b'+i,'2026-08-'+String((i%28)+1).padStart(2,'0'),'병원'+String(i).padStart(3,'0')));
  const D=build(); open(D,many,many);
  D.exSortHistory_('hosp'); D.exSortHistory_('hosp');       /* 병원 내림차순 */
  assert.equal(renderedIds(D).length,200);
  assert.equal(D.state().filtered[0].r.hosp,'병원499','정렬은 전체 필터 결과 기준');
  assert.equal(D.state().analysis.general.cases,500,'통계는 전체 기준');
  assert.equal(D.state().rollup.length,500,'롤업도 전체 기준으로 계산해 둔다');
  assert.ok(!D.dom.els.hstTableHost.innerHTML.includes('최신 선택 비용 합계'),'행 보기에서는 롤업 표를 그리지 않는다');
  D.exCopyHistoryTsv_();
  await new Promise(r=>setTimeout(r,0));
  assert.equal(D.clipboard.text.split('\n').length,501,'복사는 전체 기준');
  assert.equal(D.exHistoryExportData_(D.state()).records.length>200,true,'Excel 도 전체 기준');
  const counts=D.dom.els.hstBreakdown.innerHTML;
  assert.ok(counts.includes('500건'),'팩싯도 전체 기준');
});
ck('56. 가상 스크롤을 도입하지 않는다',()=>{
  assert.ok(!/virtual\s*scroll|IntersectionObserver/i.test(grab('exHistoryTable_')));
  assert.ok(grab('exHistoryTable_').includes('items.slice(0,limit)'));
});

/* ══════ 8. 기존 동작 호환 ══════ */
ck('57. 기존 exHistoryPrevious_ 의 선택·비교·동일비교 판정과 기본 정렬은 그대로다',()=>{
  const D=build();
  const c=D.exHistoryPrevious_(CUR,RAW);
  assert.equal(c.sourceCount,6); assert.equal(c.total,6);
  assert.equal(c.matched,5); assert.equal(c.sameMatched,4);
  assert.deepEqual(c.rows.map(r=>r.id).sort(),['a-p','b-p','d-p','e-p','f-p']);
  assert.deepEqual(D.exHistorySort_(CUR).map(r=>r.id),['a','d','b','c','e','f']);
});
ck('58. 집계 기준을 두 곳에서 만들지 않는다 — 롤업은 통계 units 만 사용한다',()=>{
  const rollup=grab('exHistoryRollup_');
  assert.ok(rollup.includes('analysis&&analysis.units'));
  assert.ok(!/exHistoryPrevious_|hpCleanDays_|exHistoryFilter_/.test(rollup),'재발 기준을 다시 만들지 않는다');
  const apply=grab('exApplyHistoryFilters_');
  assert.equal((apply.match(/exHistoryAnalyze_/g)||[]).length,1);
  assert.ok(apply.indexOf('exHistoryAnalyze_')<apply.indexOf('exHistoryRollup_'),'통계 → 롤업 순서');
});
ck('59. 파생 순서: 필터 → 정렬 → filtered 저장 → 통계 → 롤업 → 렌더 → 팩싯 → 선택 복원',()=>{
  const a=grab('exApplyHistoryFilters_');
  const at=s=>{const i=a.indexOf(s);assert.ok(i>=0,s);return i;};
  assert.ok(at('exHistoryFilter_(EX_HISTORY_STATE.items,opt)')<at('exHistorySortGroups_'));
  assert.ok(at('exHistorySortItems_')<at('EX_HISTORY_STATE.filtered=filtered'));
  assert.ok(at('EX_HISTORY_STATE.filtered=filtered')<at('exHistoryAnalyze_'));
  assert.ok(at('exHistoryAnalyze_')<at('exHistoryRollup_'));
  assert.ok(at('exHistoryRollup_')<at('host.innerHTML'));
  assert.ok(at('host.innerHTML')<at('exHistoryRestoreSelection_'));
});
ck('60. 표준 참고 예시 표시가 더 명확해졌고 실제 현장사진 연결은 추가하지 않았다',()=>{
  const panel=grab('exHistoryPhotoPanel_');
  assert.ok(panel.includes('표준 참고 예시 · 실제 처리 기록 사진이 아닙니다'));
  assert.ok(panel.includes('실제 처리 기록이 아닌'));
  assert.ok(!/현장\s*사진 연결|realPhoto|사진 업로드/.test(SRC.slice(SRC.indexOf('function exHistoryTable_'))));
});
ck('61. 정렬·필터 변경으로 선택 item 이 사라지면 예시 패널을 닫고, 남으면 복원한다',()=>{
  const D=build(); open(D,CUR);
  const id=renderedIds(D).find(x=>D.exHistoryItemById_(x).r.id==='c');
  D.exSelectHistory_(id,D.dom.rowEl(id));
  assert.equal(D.state().selectedItemId,id);
  D.exSortHistory_('hosp');
  assert.equal(D.state().selectedItemId,id,'정렬만으로는 사라지지 않는다');
  assert.ok(D.dom.rowEl(id).classList.contains('hst-selected'),'새 위치에 선택 상태 복원');
  setVal(D,'hstQuery','가병원'); D.exApplyHistoryFilters_();
  assert.equal(D.state().selectedItemId,'','결과에서 사라지면 예시 패널을 닫는다');
  assert.equal(D.dom.els.hstPhotoPanel.hidden,true);
});

/* ══════ 9. 처리이력 분석 UI 제거 ══════ */
ck('62. 경과일 분석 토글·본문·전용 상태를 제거한다',()=>{
  const D=build(); open(D,CUR);
  assert.ok(!/hstStatsToggle|hstStatsBody|EX_HISTORY_STATS_OPEN/.test(SRC));
  assert.equal(D.dom.document.getElementById('hstStats'),null);
});
ck('63. 필터·정렬 뒤에도 제거된 분석 카드가 다시 생기지 않는다',()=>{
  const D=build(); open(D,CUR);
  setVal(D,'hstQuery','가병원'); D.exApplyHistoryFilters_();
  D.exSortHistory_('hosp');
  assert.ok(!D.log.opened.html.includes('일반 비교 경과일'));
  assert.ok(!D.log.opened.html.includes('동일비교 경과일'));
});

/* ══════ 10. 병원 링크는 "이력만" 새 창 ══════ */
ck('66. 병원 링크는 병원 화면 전체가 아니라 이력만 여는 view=hist 주소를 쓴다',()=>{
  const D=build();
  assert.equal(D.exHospitalHistoryUrl_('가 병원 (본원)'),
    'hospital-pc.html?hosp='+encodeURIComponent('가 병원 (본원)')+'&view=hist');
  open(D,CUR);
  assert.ok(grab('exHospPanelHtml_').includes('exOpenHospitalTimeline_(event,this)'),
    '새 창은 패널 안 "전체 병원 화면 열기" 버튼에서만 연다');
  D.exOpenHospitalTimeline_(null,{getAttribute:()=>'가병원'});
  const w=D.log.windows[0];
  assert.ok(w.url.endsWith('&view=hist'));
  assert.equal(w.target,'bazHospHistory','이름 있는 창이라 여러 번 눌러도 창이 쌓이지 않는다');
  assert.ok(/width=\d+/.test(w.features)&&/height=\d+/.test(w.features),'이력 창 크기 지정');
  assert.ok(!/noopener/.test(w.features),'크기 지정이 무시되지 않도록 noopener 를 쓰지 않는다');
  assert.equal(w.win.opener,null,'대신 연 뒤 opener 를 끊는다');
  assert.equal(w.win.focused,true);
});
ck('67. 병원명이 없으면 창을 열지 않고, 팝업이 막히면 안내한다',()=>{
  const D=build(); open(D,CUR);
  D.exOpenHospitalTimeline_(null,{getAttribute:()=>'  '});
  assert.equal(D.log.windows.length,0);
  assert.ok(D.log.toasts.some(t=>t.includes('병원명이 없어')));
  D.win.open=()=>null;
  D.exOpenHospitalTimeline_(null,{getAttribute:()=>'가병원'});
  assert.ok(D.log.toasts.some(t=>t.includes('팝업이 차단')));
});

/* ══════ 11. 조치 방법별 재발 — 내부수리 vs Handpiece 교체 ══════ */
const LEAK='노즐 누수(약액 유입)';
const act=(id,day,hosp,part,extra={})=>row(id,day,hosp,{type:LEAK,cat:'핸드피스',part,...extra});
ck('68. 교체품 표기로 나눈다 — 내부세척=수리, 핸드피스 표기=교체, 다른 부품·미입력=제외',()=>{
  const D=build();
  assert.equal(D.exArmOfPart_('내부 세척'),'repair');
  assert.equal(D.exArmOfPart_('내부세척'),'repair','공백 표기 차이를 흡수');
  assert.equal(D.exArmOfPart_('내부 수리'),'repair');
  assert.equal(D.exArmOfPart_("Handpiece Ass'y"),'swap');
  assert.equal(D.exArmOfPart_("handpiece ass'y"),'swap','대소문자 차이를 흡수');
  assert.equal(D.exArmOfPart_("Handpiece Ass'y.1"),'swap','표기 변형도 핸드피스');
  assert.equal(D.exArmOfPart_("HP Ass'y"),'swap');
  /* 핸드피스가 아닌 부품 교체는 이 비교의 대상이 아니다 — 교체품 TOP 5 와 어긋나던 원인 */
  assert.equal(D.exArmOfPart_('Spring(1.0)'),'other');
  assert.equal(D.exArmOfPart_('풋스위치'),'other');
  assert.equal(D.exArmOfPart_('노즐'),'other');
  assert.equal(D.exArmOfPart_(''),'other');
  assert.equal(D.exArmOfPart_('없음'),'other');
  /* 표기가 다른 부품이어도 HP S/N 이 적혀 있으면 핸드피스를 갈아 끼운 것이다 */
  assert.equal(D.exArmOf_({part:'Spring(1.0)',hpOut:'HP-77'}),'swap');
  assert.equal(D.exArmOf_({part:'Spring(1.0)'}),'other');
  assert.equal(D.exArmOf_({part:'내부 세척',hpOut:'HP-77'}),'repair','표기 우선');
});
ck('69. 조치 이후 첫 동일 증상만 재발로 세고, 같은 날은 재발이 아니다',()=>{
  const D=build();
  const rows=[act('r1','2026-06-01','가병원','내부 세척',{sn:'HP-1'})];
  const raw=rows.concat([
    act('same','2026-06-01','가병원','내부 세척',{sn:'HP-1'}),      /* 같은 날 — 제외 */
    act('r1-a','2026-06-21','가병원','내부 세척',{sn:'HP-1'}),      /* 첫 재발 */
    act('r1-b','2026-07-30','가병원','내부 세척',{sn:'HP-1'})       /* 두 번째 — 세지 않음 */
  ]);
  const a=D.exArmRecurrence_(rows,raw,'2026-08-31');
  assert.equal(a.repair.total,1);
  assert.equal(a.repair.recur,1);
  assert.equal(a.repair.min,20,'6/1 → 6/21 = 20일');
  assert.equal(a.events[0].days,20);
  assert.equal(D.ymd(a.events[0].recurrenceDate),'2026-06-21');
});
ck('70. 장비번호가 있으면 장비 단위, 없으면 병원 단위 추정으로 표시한다',()=>{
  const D=build();
  const rows=[act('sn1','2026-06-01','가병원','내부 세척',{sn:'HP-1'}),
              act('nosn','2026-06-01','나병원','내부 세척',{sn:''})];
  const raw=rows.concat([
    act('other-dev','2026-06-10','가병원','내부 세척',{sn:'HP-9'}),   /* 다른 장비 — 재발 아님 */
    act('any-dev','2026-06-15','나병원','내부 세척',{sn:'HP-7'})      /* 장비번호 없어 병원 단위로 인정 */
  ]);
  const a=D.exArmRecurrence_(rows,raw,'2026-08-31');
  const byHosp=n=>a.events.find(e=>e.hosp===n);
  assert.equal(byHosp('가병원').recurrence,false,'다른 장비는 같은 장비의 재발이 아니다');
  assert.equal(byHosp('가병원').confidence,'장비 기준');
  assert.equal(byHosp('나병원').recurrence,true);
  assert.equal(byHosp('나병원').confidence,'병원 단위 추정');
  assert.equal(a.repair.estimated,1);
});
ck('71. 아직 재발 없는 건은 평균에서 빼되 건수와 관찰일로 남긴다',()=>{
  const D=build();
  const rows=[act('a','2026-06-01','가병원','내부 세척',{sn:'HP-1'}),
              act('b','2026-06-01','나병원','내부 세척',{sn:'HP-2'}),
              act('c','2026-08-01','다병원','내부 세척',{sn:'HP-3'})];
  const raw=rows.concat([act('a-r','2026-06-11','가병원','내부 세척',{sn:'HP-1'})]);
  const a=D.exArmRecurrence_(rows,raw,'2026-08-31');
  assert.equal(a.repair.total,3);
  assert.equal(a.repair.recur,1);
  assert.equal(a.repair.none,2,'아직 재발 없는 건');
  assert.equal(a.repair.avg,10,'재발한 건만으로 평균');
  assert.equal(a.repair.rate,33.3);
  assert.equal(a.repair.watchAvg,60.5,'무재발 관찰일 평균 — (91+30)/2');
});
ck('72. 두 조치군에 같은 지표를 적용하고 중앙값은 짝수 개면 가운데 두 값 평균',()=>{
  const D=build();
  const rows=[
    act('p1','2026-01-01','가병원','내부 세척',{sn:'H1'}),
    act('p2','2026-01-01','나병원','내부 세척',{sn:'H2'}),
    act('s1','2026-01-01','다병원',"Handpiece Ass'y",{sn:'H3'}),
    act('s2','2026-01-01','라병원',"Handpiece Ass'y",{sn:'H4'})];
  const raw=rows.concat([
    act('p1r','2026-01-11','가병원','내부 세척',{sn:'H1'}),   /* 10일 */
    act('p2r','2026-01-31','나병원','내부 세척',{sn:'H2'}),   /* 30일 */
    act('s1r','2026-01-13','다병원','내부 세척',{sn:'H3'}),   /* 12일 */
    act('s2r','2026-02-02','라병원','내부 세척',{sn:'H4'})]); /* 32일 */
  const a=D.exArmRecurrence_(rows,raw,'2026-08-31');
  assert.deepEqual([a.repair.total,a.repair.recur,a.repair.rate],[2,2,100]);
  assert.deepEqual([a.swap.total,a.swap.recur,a.swap.rate],[2,2,100]);
  assert.equal(a.repair.median,20);   /* (10+30)/2 */
  assert.equal(a.swap.median,22);     /* (12+32)/2 */
  assert.equal(a.repair.min,10); assert.equal(a.swap.min,12);
});
ck('73. 대상 VOC·병원명·처리일이 유효한 조치만 모집단에 들어간다',()=>{
  const D=build();
  const rows=[
    act('ok','2026-06-01','가병원','내부 세척',{sn:'H1'}),
    act('voc','2026-06-01','나병원','내부 세척',{sn:'H2',type:'풋스위치 작동 불량'}),
    act('nohosp','2026-06-01','','내부 세척',{sn:'H3'}),
    act('bad','2026-02-31','다병원','내부 세척',{sn:'H4'}),
    act('nopart','2026-06-01','라병원','',{sn:'H5'}),
    act('none','2026-06-01','마병원','없음',{sn:'H6'})];
  const a=D.exArmRecurrence_(rows,rows,'2026-08-31');
  assert.equal(a.repair.total,1);
  assert.equal(a.swap.total,0);
  assert.deepEqual(a.events.map(e=>e.row.id),['ok'],'다른 VOC·병원명 없음·처리일 오류·교체품 미입력은 제외');
});
ck('74. 판정 문구는 안전한 범위까지만 말한다 — 확정 표현을 쓰지 않는다',()=>{
  const D=build();
  const rows=[act('p','2026-01-01','가병원','내부 세척',{sn:'H1'}),
              act('s','2026-01-01','나병원',"Handpiece Ass'y",{sn:'H2'})];
  const raw=rows.concat([act('pr','2026-01-21','가병원','내부 세척',{sn:'H1'}),
                         act('sr','2026-01-21','나병원','내부 세척',{sn:'H2'})]);
  const a=D.exArmRecurrence_(rows,raw,'2026-08-31');
  const v=D.exArmVerdict_(a);
  assert.ok(v.includes('교체 후에도'));
  assert.ok(v.includes('내부수리를 원인으로 지목')&&v.includes('재발 방지를 이유로 교체를 우선'));
  assert.ok(!/차이가 없다|절대|입증|증명/.test(v),'확정 표현 없음');
});
ck('75. 처리이력 모달에서는 두 조치군 카드를 제거하되 Excel 계산 결과는 조회당 한 번 재사용한다',()=>{
  const rows=[act('p','2026-06-01','가병원','내부 세척',{sn:'H1'}),
              act('s','2026-06-01','나병원',"Handpiece Ass'y",{sn:'H2'})];
  const raw=rows.concat([act('pr','2026-06-21','가병원','내부 세척',{sn:'H1'})]);
  const D=build(); open(D,rows,raw);
  assert.ok(!D.log.opened.html.includes('조치 방법별 재발 — 내부수리 vs Handpiece 교체'));
  const first=D.state().arm;
  setVal(D,'hstQuery','가병원'); D.exApplyHistoryFilters_();
  assert.equal(D.state().arm,first,'필터를 바꿔도 같은 결과 객체를 재사용');
  assert.ok(grab('exApplyHistoryFilters_').includes('if(!EX_HISTORY_STATE.arm)'));
});
ck('76. 사례가 없으면 판정 문구는 자료 부족으로 표시한다',()=>{
  const D=build(); open(D,CUR);
  const a=D.exArmRecurrence_([],RAW,'2026-08-31');
  assert.match(D.exArmVerdict_(a),/사례가 아직 부족/);
});
ck('77-a. HP_SN 은 교체할 때만 적으므로 매칭 조건이 아니라 확정 표시로만 쓴다',()=>{
  const D=build();
  const swap=act('sw','2026-06-01','가병원',"Handpiece Ass'y",{sn:'EQ-1',hpIn:'HP-0417',hpOut:'HP-0902'});
  /* 재발을 내부수리로 처리하면 HP_SN(IN) 이 비어 있다 — 조건으로 걸면 이 재발을 통째로 놓친다 */
  const repairRecur=act('sw-r','2026-06-21','가병원','내부 세척',{sn:'EQ-1'});
  let a=D.exArmRecurrence_([swap],[swap,repairRecur],'2026-08-31');
  assert.equal(a.swap.recur,1,'IN 이 비어도 재발로 잡는다');
  assert.equal(a.events[0].days,20);
  assert.equal(a.events[0].confirmed,false);
  assert.equal(a.events[0].confidence,'장비 기준');
  /* 재발도 교체로 처리돼 IN 이 찍히면 같은 핸드피스임이 일련번호로 확정된다 */
  const swapRecur=act('sw-r2','2026-06-21','가병원',"Handpiece Ass'y",{sn:'EQ-1',hpIn:'HP-0902',hpOut:'HP-1130'});
  a=D.exArmRecurrence_([swap],[swap,swapRecur],'2026-08-31');
  assert.equal(a.events[0].confirmed,true);
  assert.equal(a.events[0].confidence,'핸드피스 확정');
  assert.equal(a.swap.confirmed,1);
  assert.equal(a.swap.estimated,0,'확정 건은 병원 단위 추정으로 세지 않는다');
  /* 다른 핸드피스가 들어온 재발은 확정하지 않는다 */
  const otherHp=act('sw-r3','2026-06-21','가병원',"Handpiece Ass'y",{sn:'EQ-1',hpIn:'HP-7777',hpOut:'HP-8888'});
  a=D.exArmRecurrence_([swap],[swap,otherHp],'2026-08-31');
  assert.equal(a.events[0].confirmed,false);
  assert.equal(a.events[0].confidence,'장비 기준');
});
ck('77-b. 교체품 표기가 비어도 HP_SN 이 있으면 교체로 보정한다',()=>{
  const D=build();
  assert.equal(D.exArmOf_({part:'',hpOut:'HP-1'}),'swap');
  assert.equal(D.exArmOf_({part:'없음',hpIn:'HP-1'}),'swap');
  assert.equal(D.exArmOf_({part:'내부 세척',hpOut:'HP-1'}),'repair','교체품 표기를 우선한다');
  assert.equal(D.exArmOf_({part:'',hpIn:'',hpOut:''}),'other');
});
ck('77. 이번 범위에 교육·노즐 재사용·구간 분류를 넣지 않는다',()=>{
  const body=grab('exArmRecurrence_')+grab('exArmSummary_')+grab('exArmVerdict_')+grab('exCauseArmGroup_');
  assert.ok(!/nozzleReuse|nsFill|nsAmt|\bjet\b|초기|중기|장기/.test(body));
});
ck('77-c. 원인분석은 기존 두 카드 자리를 전폭 조치 방법별 재발 카드로 사용한다',()=>{
  assert.ok(SRC.includes('id="exCauseArmCard"'));
  assert.ok(!SRC.includes('id="exRepeatCard"')&&!SRC.includes('id="exNcCmpCard"'));
  assert.match(SRC,/#exCauseArmCard\{grid-column:1\/-1\}/);
  const body=grab('renderExecutiveCause');
  assert.ok(body.includes('exArmRecurrence_(x.rows,RAW,null)'),'처리이력·Excel과 같은 계산 재사용');
  assert.ok(body.includes("exCauseArmGroup_('repair'")&&body.includes("exCauseArmGroup_('swap'"));
});
ck('77-d. 최단 경과일과 같은 일수의 건수를 세고 해당 이력만 조회한다',()=>{
  const D=build();
  const rows=[act('s1','2026-01-01','가병원',"Handpiece Ass'y",{sn:'H1'}),
              act('s2','2026-01-02','나병원',"Handpiece Ass'y",{sn:'H2'}),
              act('s3','2026-01-03','다병원',"Handpiece Ass'y",{sn:'H3'})];
  const raw=rows.concat([act('s1r','2026-01-11','가병원','내부 세척',{sn:'H1'}),
                         act('s2r','2026-01-12','나병원','내부 세척',{sn:'H2'}),
                         act('s3r','2026-01-23','다병원','내부 세척',{sn:'H3'})]);
  const a=D.exArmRecurrence_(rows,raw,'2026-08-31');
  assert.equal(a.swap.min,10);assert.equal(a.swap.minCount,2);
  const shortest=D.exCauseArmRows_(a,'swap','shortest');
  assert.equal(shortest.length,2);assert.ok(shortest.every(e=>e.days===10));
});
ck('77-e. 카드 모든 지표가 이력 버튼이며 평균·중앙값은 재발 전체, 무재발은 관찰 이력으로 연결된다',()=>{
  const D=build();
  const rows=[act('p','2026-01-01','가병원','내부 세척',{sn:'H1'}),act('n','2026-02-01','나병원','내부 세척',{sn:'H2'})];
  const a=D.exArmRecurrence_(rows,rows.concat([act('pr','2026-01-11','가병원','내부 세척',{sn:'H1'})]),'2026-08-31');
  const html=D.exCauseArmGroup_('repair',a.repair);
  ['all','recur','rate','shortest','average','median','none'].forEach(m=>assert.ok(html.includes("'repair','"+m+"'"),m));
  assert.equal(D.exCauseArmRows_(a,'repair','average').length,1);
  assert.equal(D.exCauseArmRows_(a,'repair','median').length,1);
  assert.equal(D.exCauseArmRows_(a,'repair','none')[0].row.id,'n');
  const table=D.exCauseArmTable_(D.exCauseArmRows_(a,'repair','all'));
  ['조치 방법','조치일','병원','장비번호','조치 내용','첫 재발일','경과일','재발 처리 내용','판정 기준'].forEach(x=>assert.ok(table.includes(x),x));
});

/* ══════ 12. 병원 이력 우측 패널 ══════ */
ck('78. 병원 링크는 새 창 대신 우측 패널을 연다',()=>{
  const D=build(); open(D,CUR);
  assert.equal(D.dom.els.hstHospPanel.hidden,true,'기본은 닫힘');
  D.exOpenHospPanel_(null,{getAttribute:()=>'가병원'});
  assert.equal(D.log.windows.length,0,'새 창 없음');
  assert.equal(D.dom.els.hstHospPanel.hidden,false);
  const html=D.dom.els.hstHospPanel.innerHTML;
  assert.ok(html.includes('가병원'));
  assert.ok(html.includes('전체 병원 화면 열기'),'필요하면 전체 화면으로 갈 수 있다');
  assert.ok(html.includes('aria-label="병원 이력 패널 닫기"'));
  assert.equal(D.state().hospPanel.name,'가병원');
});
ck('79. 표의 필터·정렬과 무관하게 그 병원의 전체 이력을 보여 준다',()=>{
  const D=build(); open(D,CUR);
  const rows=D.exHospHistoryRows_('가병원');
  const inTable=D.state().filtered.filter(it=>D.nkey(it.r.hosp)==='가병원').length;
  assert.ok(rows.length>inTable,'표에 보이는 행보다 많다 (비교 원본까지 포함)');
  assert.ok(rows.every(r=>D.nkey(r.hosp)==='가병원'));
  const dates=rows.map(r=>D.ymd(D.rowDate(r)));
  assert.deepEqual(dates.slice().sort().reverse(),dates,'최신순 정렬');
  assert.deepEqual(D.exHospHistoryRows_(''),[],'병원명이 없으면 빈 목록');
  assert.deepEqual(D.exHospHistoryRows_('없는병원'),[]);
});
ck('80. 공백만 다른 병원명도 같은 병원으로 묶어 찾는다',()=>{
  const D=build(); open(D,CUR);
  assert.equal(D.exHospHistoryRows_(' 가 병원 ').length,D.exHospHistoryRows_('가병원').length);
});
ck('81. 같은 병원을 다시 누르면 닫히고, 다른 병원을 누르면 바뀐다',()=>{
  const D=build(); open(D,CUR);
  D.exOpenHospPanel_(null,{getAttribute:()=>'가병원'});
  D.exOpenHospPanel_(null,{getAttribute:()=>'가병원'});
  assert.equal(D.state().hospPanel,null,'토글로 닫힘');
  assert.equal(D.dom.els.hstHospPanel.hidden,true);
  D.exOpenHospPanel_(null,{getAttribute:()=>'가병원'});
  D.exOpenHospPanel_(null,{getAttribute:()=>'나병원'});
  assert.equal(D.state().hospPanel.name,'나병원');
  assert.ok(D.dom.els.hstHospPanel.innerHTML.includes('나병원'));
  D.exCloseHospPanel_();
  assert.equal(D.dom.els.hstHospPanel.hidden,true);
});
ck('82. 필터·정렬을 바꿔도 열린 패널은 그대로 유지된다',()=>{
  const D=build(); open(D,CUR);
  D.exOpenHospPanel_(null,{getAttribute:()=>'가병원'});
  setVal(D,'hstQuery','나병원'); D.exApplyHistoryFilters_();
  assert.equal(D.state().hospPanel.name,'가병원','표에서 사라져도 패널은 남는다');
  assert.equal(D.dom.els.hstHospPanel.hidden,false);
  D.exSortHistory_('hosp');
  assert.equal(D.dom.els.hstHospPanel.hidden,false);
});
ck('83. 긴 이력은 40건씩 끊어 보여 주고 더 보기로 늘린다',()=>{
  const many=[]; for(let i=0;i<95;i++) many.push(row('m'+i,'2026-08-'+String((i%28)+1).padStart(2,'0'),'큰병원',{type:'유형'+i}));
  const D=build(); open(D,many,many);
  D.exOpenHospPanel_(null,{getAttribute:()=>'큰병원'});
  const count1=(D.dom.els.hstHospPanel.innerHTML.match(/hst-hosp-item/g)||[]).length;
  assert.equal(count1,40);
  assert.ok(D.dom.els.hstHospPanel.innerHTML.includes('40 / 전체 95건'));
  D.exHospPanelMore_();
  assert.equal((D.dom.els.hstHospPanel.innerHTML.match(/hst-hosp-item/g)||[]).length,80);
  D.exHospPanelMore_();
  assert.equal((D.dom.els.hstHospPanel.innerHTML.match(/hst-hosp-item/g)||[]).length,95);
  assert.ok(!D.dom.els.hstHospPanel.innerHTML.includes('건 더 보기'));
});
ck('84. 패널은 이미 받아 둔 RAW 만 읽고 추가 통신을 하지 않는다',()=>{
  const body=grab('exHospHistoryRows_')+grab('exRenderHospPanel_')+grab('exOpenHospPanel_');
  assert.ok(!/fetch\(|gvRetry\(|loadData\(|script\.google/.test(body));
  assert.ok(grab('exHospHistoryRows_').includes('RAW'));
  assert.ok(grab('exApplyHistoryFilters_').includes('exRenderHospPanel_()'));
});
ck('85. 모달을 닫았다 열면 패널은 유지되지 않는다',()=>{
  const D=build(); open(D,CUR);
  D.exOpenHospPanel_(null,{getAttribute:()=>'가병원'});
  D.closeExList();
  open(D,CUR);
  assert.equal(D.state().hospPanel,null);
  assert.equal(D.dom.els.hstHospPanel.hidden,true);
});
ck('86. 표와 패널을 가로로 나누고 좁은 화면에서는 아래로 내린다',()=>{
  assert.match(SRC,/\.hst-main\{display:flex;flex:1 1 auto/);
  assert.match(SRC,/\.hst-hosp-panel\{flex:0 0 clamp\(280px,30%,400px\)/);
  assert.match(SRC,/\.hst-main\{flex-direction:column;border-top:0/,'모바일에서 세로 배치');
  assert.ok(SRC.includes('<div class="hst-main">'));
  /* 분석 카드가 없어 위쪽 조회 조건은 자연 높이, 표가 남은 영역을 쓴다 */
  assert.match(SRC,/\.hst-top\{flex:0 0 auto;min-height:0/);
  assert.match(SRC,/\.hst-main\{display:flex;flex:1 1 auto;min-height:136px/);
  assert.ok(SRC.includes('<div class="hst-view" id="hstView">'));
});

ck('87. 제거된 분석 영역의 주 영역 전환·크기 조절 코드도 남기지 않는다',()=>{
  assert.ok(!/exHistoryFocus_|exToggleHistoryStats_|exHistorySplit/.test(SRC));
  assert.ok(!/data-focus="stats"|hst-split|is-split|--hst-top-h/.test(SRC));
});
ck('88. 처리이력은 전체화면으로 열리고 버튼은 모달 상태를 유지한 채 크기만 전환한다',()=>{
  const D=build(); open(D,CUR);
  D.exOpenHospPanel_(null,{getAttribute:()=>'가병원'});
  const state=D.state(),filtered=state.filtered,panel=state.hospPanel;
  const btn=D.dom.els.exListFullscreen,box=D.dom.els.exListBox;
  /* 기본값이 전체화면 — 표와 병원 이력을 함께 보려면 카드 크기로는 둘 다 잘린다 */
  assert.equal(btn.hidden,false);assert.equal(btn.getAttribute('aria-pressed'),'true');
  assert.equal(box.classList.contains('is-fullscreen'),true);
  assert.ok(btn.textContent.includes('원래 크기'));
  assert.equal(D.toggleExListFullscreen_(),false);
  assert.equal(box.classList.contains('is-fullscreen'),false);
  assert.equal(btn.getAttribute('aria-pressed'),'false');assert.ok(btn.textContent.includes('전체화면'));
  assert.equal(D.state(),state);assert.equal(D.state().filtered,filtered);assert.equal(D.state().hospPanel,panel);
  assert.equal(D.toggleExListFullscreen_(true),true);
  assert.equal(box.classList.contains('is-fullscreen'),true);
});
ck('88-1. 고른 창 크기는 다시 그려도(조회 대상 전환·재오픈) 유지된다',()=>{
  const D=build(); open(D,CUR);
  /* 스텁 DOM 은 모달을 열 때마다 요소를 다시 만든다 — 열고 난 뒤의 요소를 본다 */
  D.toggleExListFullscreen_(false);        /* 원래 크기를 고르면 */
  open(D,CUR);                             /* 다시 열어도 카드 크기 */
  assert.equal(D.dom.els.exListBox.classList.contains('is-fullscreen'),false);
  assert.equal(D.dom.els.exListFullscreen.getAttribute('aria-pressed'),'false');
  D.toggleExListFullscreen_(true);
  open(D,CUR);
  assert.equal(D.dom.els.exListBox.classList.contains('is-fullscreen'),true);
  assert.equal(D.dom.els.exListFullscreen.getAttribute('aria-pressed'),'true');
});
ck('89. 일반 명단에는 전체화면 버튼을 숨기고 닫을 때 확대 상태를 정리한다',()=>{
  const D=build(); open(D,CUR);
  D.toggleExListFullscreen_(true);D.closeExList();
  assert.equal(D.dom.els.exListBox.classList.contains('is-fullscreen'),false);
  assert.equal(D.dom.els.exListFullscreen.hidden,true);
  D.openExList('일반 명단','', '<div>목록</div>',false);
  assert.equal(D.dom.els.exListFullscreen.hidden,true);
  assert.equal(D.toggleExListFullscreen_(),false);
});
ck('90. 전체화면은 여백 없이 화면 전체를 채우고 Esc로 복귀한다',()=>{
  assert.match(SRC,/\.ex-list-box\.history\.is-fullscreen\{position:fixed;inset:0;/);
  assert.match(SRC,/\.ex-list-box\.history\.is-fullscreen\{padding:10px\}/,'좁은 화면 여백');
  assert.ok(!/inset:8px/.test(SRC),'전체화면에 가장자리 여백을 남기지 않는다');
  assert.match(SRC,/if\(box&&box\.classList\.contains\('is-fullscreen'\)\)\{ toggleExListFullscreen_\(false\); return; \}/);
  assert.match(SRC,/exCloseCardFull_\(\);/,'Esc 는 카드 전체화면도 닫는다');
});
ck('91. 조회 조건은 맨 위에서 높이를 적게 쓰고 표·병원 이력이 화면을 차지한다',()=>{
  const D=build(); open(D,CUR);
  const html=D.log.opened.html;
  /* 조회 조건(보기 전환·필터·건수 카드)이 요약·안내보다 먼저 나온다 */
  assert.ok(html.indexOf('<div class="hst-ctlzone">')<html.indexOf('class="hst-summary"'));
  assert.ok(html.indexOf('hstToolbar')<html.indexOf('class="hst-summary"'));
  assert.ok(html.indexOf('id="hstBreakdown"')<html.indexOf('class="hst-summary"'));
  assert.ok(html.indexOf('<div class="hst-ctlzone">')<html.indexOf('<div class="hst-top">'));
  /* 높이 비중을 묶고 넘치면 이 영역 안에서만 스크롤한다 */
  assert.match(SRC,/\.hst-ctlzone\{flex:0 0 auto;min-height:0;max-height:max\(140px,15vh\);overflow-y:auto/);
  assert.match(SRC,/\.hst-ctlzone\{max-height:none;overflow:visible\}/,'좁은 화면은 자연 높이');
  /* 전체화면에서는 병원 이력 패널을 넓게 쓴다 */
  assert.match(SRC,/\.ex-list-box\.history\.is-fullscreen \.hst-hosp-panel\{flex:0 0 clamp\(300px,30%,560px\)\}/);
});
ck('92. 전체화면은 요약·안내를 감추고 건수·비교 근거 Excel 은 조회 조건 줄에 남긴다',()=>{
  const D=build(); open(D,CUR);
  const html=D.log.opened.html;
  /* 건수와 Excel 버튼은 조회 조건(.hst-ctlzone) 안, 요약 칩보다 위에 있다 */
  const zone=html.indexOf('<div class="hst-ctlzone">'), summary=html.indexOf('class="hst-summary"');
  assert.ok(html.indexOf('id="hstCount"')>zone&&html.indexOf('id="hstCount"')<summary);
  assert.ok(html.indexOf('id="hstExportExcel"')>zone&&html.indexOf('id="hstExportExcel"')<summary);
  /* 요약 줄에는 칩만 남고, 결과 줄에는 정렬 설명만 남는다 */
  assert.ok(html.indexOf('id="hstExportExcel"')<html.indexOf('선택 기간 <b>'),'Excel 버튼은 요약 칩보다 앞');
  assert.match(SRC,/<div class="hst-result"><span id="hstViewNote">/);
  /* 필터를 바꿔도 옮긴 건수 표시가 갱신된다(요소는 id 로 찾는다) */
  D.dom.els.hstQuery.value='없는키워드'; D.exApplyHistoryFilters_();
  assert.match(D.dom.els.hstCount.innerHTML,/0건/);
  /* PC 전체화면에서만 요약·비교 안내·결과 줄을 감춘다(좁은 화면은 그대로 둔다) */
  assert.match(SRC,/@media\(min-width:821px\)\{[\s\S]{0,600}?\.ex-list-box\.history\.is-fullscreen \.hst-summary,\s*\.ex-list-box\.history\.is-fullscreen \.hst-compare-note,\s*\.ex-list-box\.history\.is-fullscreen \.hst-result\{display:none\}/);
  /* 예시자료 패널은 감추지 않는다 — 행을 선택했을 때만 열린다 */
  assert.ok(!/is-fullscreen \.hst-photo-panel\{display:none\}/.test(SRC));
  assert.match(SRC,/<section class="hst-photo-panel" id="hstPhotoPanel" hidden/);
});

/* ══════ 재발 주기 (병원 · VOC · 장비번호) ══════ */
/* 가병원 HP-001: 08-01 → 04 → 09(같은 날 2건) → 19  = 간격 3 · 5 · 10
   가병원 HP-002: 08-02 → 22                          = 간격 20
   나병원 S/N 미입력: 08-03 → 13                      = 간격 10
   다병원 · 가병원 풋스위치: 1회뿐이라 주기 없음 */
const CYC=[
  row('c1','2026-08-01','가병원'),
  row('c2','2026-08-04','가병원'),
  row('c3','2026-08-09','가병원'),
  row('c4','2026-08-09','가병원',{fse:'박프로'}),
  row('c5','2026-08-19','가병원'),
  row('c6','2026-08-02','가병원',{sn:'HP-002'}),
  row('c7','2026-08-22','가병원',{sn:'HP-002'}),
  row('c8','2026-08-03','나병원',{sn:''}),
  row('c9','2026-08-13','나병원',{sn:''}),
  row('c10','2026-08-05','다병원'),
  row('c11','2026-08-06','가병원',{type:'풋스위치 작동 불량',part:'Foot s/w'})
];
const cyc=(D,opt)=>D.exHistoryCycles_(D.state().sourceRows,opt||{});

ck('93. 재발 간격은 연속 발생 사이를 오래된 것부터 재고 같은 날 여러 건은 1회로 접는다',()=>{
  const D=build(); open(D,CYC);
  const rows=cyc(D);
  const g=rows.find(r=>r.sn==='HP-001'&&r.hosp==='가병원');
  assert.deepEqual(g.gaps,[3,5,10]);
  assert.equal(g.count,4,'08-09 두 건은 1회 발생');
  assert.equal(g.avg,6);assert.equal(g.median,5);
  assert.equal(g.min,3);assert.equal(g.max,10);
  assert.equal(g.lastGap,10);assert.equal(g.span,18);
});
ck('94. 장비번호가 다르면 다른 주기, S/N 미입력은 병원 단위 한 묶음',()=>{
  const D=build(); open(D,CYC);
  const rows=cyc(D);
  const hp2=rows.find(r=>r.sn==='HP-002');
  assert.deepEqual(hp2.gaps,[20]);
  const none=rows.find(r=>r.hosp==='나병원');
  assert.equal(none.sn,'');assert.deepEqual(none.gaps,[10]);
  /* 1회만 발생한 조합은 목록에서 빠지고 개수만 요약에 남는다 */
  assert.ok(!rows.some(r=>r.hosp==='다병원'));
  assert.ok(!rows.some(r=>r.type==='풋스위치 작동 불량'));
  assert.equal(rows.length,3);
  assert.equal(D.exHistoryCycleSummary_(rows).single,2);
  /* 발생 많은 순 → 최근 간격 짧은 순 */
  assert.deepEqual(rows.map(r=>r.hosp+'/'+(r.sn||'—')),['가병원/HP-001','나병원/—','가병원/HP-002']);
});
ck('95. 추세는 앞 절반·뒤 절반 평균을 견주고 간격 2개 미만은 판단하지 않는다',()=>{
  const D=build();
  assert.deepEqual(D.exHistoryCycleTrend_([3,5,10]),{dir:'up',diff:7,early:3,late:10});
  assert.deepEqual(D.exHistoryCycleTrend_([10,3]),{dir:'down',diff:-7,early:10,late:3});
  assert.equal(D.exHistoryCycleTrend_([5,5]).dir,'flat');
  assert.equal(D.exHistoryCycleTrend_([20]).dir,'none');
  assert.equal(D.exHistoryCycleTrend_([]).dir,'none');
  /* 홀수면 가운데 간격은 어느 쪽에도 넣지 않는다 */
  assert.deepEqual(D.exHistoryCycleTrend_([2,100,8]),{dir:'up',diff:6,early:2,late:8});
});
ck('96. 주기 모집단은 선택 기간 원본이고 상단 조회 조건을 그대로 따른다',()=>{
  const D=build(); open(D,CYC);
  /* PREV 는 RAW 에만 있고 선택 기간 원본이 아니다 — 주기에 섞이지 않는다 */
  assert.ok(!cyc(D).some(r=>r.hosp==='바병원'));
  /* VOC 유형 필터를 걸면 그 유형만 남는다(풋스위치는 1회뿐이라 결과 없음) */
  assert.equal(cyc(D,{type:'풋스위치 작동 불량'}).length,0);
  assert.equal(cyc(D,{type:'노즐 누수(약액 유입)'}).length,3);
  /* 검색어도 같은 규칙으로 적용된다 */
  assert.equal(cyc(D,{q:'나병원'}).length,1);
});
ck('97. 재발 주기 보기로 바꾸면 표·복사·기간 선택이 함께 바뀐다',()=>{
  const D=build(); open(D,CYC);
  D.exSetHistoryView_('cycle');
  assert.equal(D.state().view,'cycle');
  assert.equal(D.state().cycles.length,3);
  const html=D.dom.els.hstTableHost.innerHTML;
  assert.match(html,/hst-table cycle/);
  assert.match(html,/hst-th-sub">중앙값 · 평균/,'통계 용어는 부제로 남긴다');
  assert.match(html,/<th[^>]*>재발 간격<span/,'지표명은 보고서 표기로');
  assert.match(html,/재발 간격 추이/);
  assert.match(html,/지표 정의/,'처음 보는 사람을 위한 안내');
  assert.match(html,/hst-trend up[^>]*>개선 ▲/,'재발 간격이 늘어난 조합은 추이 배지로 표시');
  assert.match(D.dom.els.hstCount.innerHTML,/3개<\/b> 조합/);
  assert.equal(D.dom.els.hstPeriod.disabled,true,'주기 보기는 기간 선택을 잠근다');
  assert.equal(D.dom.els.hstCopyTsv.textContent,'재발 주기 TSV 복사');
  assert.match(D.dom.els.hstViewNote.textContent,/재발 주기/);
  /* 행 보기로 돌아오면 원래 상태가 복원된다 */
  D.exSetHistoryView_('rows');
  assert.equal(D.dom.els.hstPeriod.disabled,false);
  assert.equal(D.dom.els.hstCopyTsv.textContent,'필터 결과 TSV 복사');
  assert.match(D.dom.els.hstTableHost.innerHTML,/data-hst-id=/);
});
ck('98. 재발 주기 TSV 는 화면과 같은 순서로 간격·추세까지 담는다',()=>{
  const D=build(); open(D,CYC);
  D.exSetHistoryView_('cycle');
  const lines=D.exHistoryCycleTsv_(D.state().cycles).split('\n');
  assert.equal(lines.length,4);
  assert.match(lines[0],/^병원\t노즐 상태\t노즐 평가일\t교육 상태\t교육 평가일\tVOC 유형\t장비번호\t발생 횟수/);
  const first=lines[1].split('\t');
  assert.equal(first[0],'가병원');assert.equal(first[6],'HP-001');
  assert.equal(first[1],'노즐 미평가');assert.equal(first[2],'','평가가 없으면 평가일도 빈칸');
  assert.equal(first[3],'교육 미평가');
  assert.equal(first[7],'4');assert.equal(first[11],'3, 5, 10');
  assert.equal(first[16],'10','마지막으로 끝난 간격');
  assert.equal(first[17],'12','기준일 2026-08-31 − 마지막 발생 08-19');
  assert.equal(first[19],'2026-08-31','기준일');
  assert.equal(first[20],'간격 길어짐(빈도 감소)');
  assert.equal(lines[2].split('\t')[6],'S/N 미입력');
});

/* ══════ 병원 · VOC 발생 빈도 추이 ══════ */
/* 가병원 노즐 누수: 첫 발생 2023-09-05
   1년차 6회 · 2년차 3회 · 3년차(6개월 진행) 1회 — 쓸수록 줄어드는 흐름 */
const TREND=[
  row('t1','2023-09-05','가병원'), row('t2','2023-10-01','가병원'), row('t3','2023-11-02','가병원'),
  row('t4','2024-01-10','가병원'), row('t5','2024-03-03','가병원'), row('t6','2024-06-20','가병원'),
  row('t7','2024-10-10','가병원'), row('t8','2025-02-02','가병원'), row('t9','2025-04-15','가병원'),
  row('t10','2026-01-20','가병원'),
  row('t10b','2026-01-20','가병원',{fse:'박프로'}),          /* 같은 날 두 번째 기록 */
  row('t11','2024-05-05','가병원',{type:'풋스위치 작동 불량'}),/* 다른 VOC — 섞이면 안 된다 */
  row('t12','2025-05-05','나병원')                            /* 다른 병원 */
];
const AS_OF='2026-03-05';

ck('99. 추이는 그 VOC 최초 발생일부터 연차·연도별로 세고 같은 날 여러 건은 1회로 본다',()=>{
  const D=build(); open(D,CUR,TREND);
  const t=D.exHospTrend_('가병원',LEAK,AS_OF);
  assert.equal(t.total,10,'같은 날 2건은 1회 · 다른 VOC·다른 병원 제외');
  assert.equal(ymdOf(t.first),'2023-09-05');
  assert.equal(ymdOf(t.last),'2026-01-20');
  assert.equal(t.spanText,'2년 6개월');
  assert.deepEqual(t.years.map(y=>y.n+':'+y.count),['1:6','2:3','3:1']);
  assert.equal(t.years[2].partial,true,'진행 중인 연차');
  assert.equal(t.years[0].rate,0.5,'1년차 6회 → 0.5회/월');
  assert.deepEqual(t.calendar,[{year:2023,count:3},{year:2024,count:4},{year:2025,count:2},{year:2026,count:1}]);
  /* VOC 를 주지 않으면 그 병원의 전체 VOC 기준 */
  assert.equal(D.exHospTrend_('가병원','',AS_OF).total,11);
});
ck('100. 최근 12개월과 직전 12개월을 견줘 감소율과 현재 빈도를 낸다',()=>{
  const D=build(); open(D,CUR,TREND);
  const t=D.exHospTrend_('가병원',LEAK,AS_OF);
  assert.equal(t.recent12,2);assert.equal(t.prev12,3);
  assert.equal(t.changePct,33,'2회 / 3회 → 33% 감소');
  assert.equal(t.recent6,1);
  assert.equal(t.lastGap,280,'2025-04-15 → 2026-01-20');
  assert.equal(t.sinceLast,44,'2026-01-20 이후 경과');
  /* 직전 12개월 구간이 통째로 첫 발생 이전이면 비교하지 않는다 */
  const young=D.exHospTrend_('나병원','',AS_OF);
  assert.equal(young.prev12,null);assert.equal(young.changePct,null);
});
ck('101. 전환 시점은 앞뒤 구간이 충분하고 앞 구간에 3회 이상 있을 때만 말한다',()=>{
  const D=build();
  const b=D.exHospTrend_.length&&null;    /* 계산 함수만 단독으로 확인한다 */
  const dates=['2023-09-05','2023-10-01','2023-11-02','2024-01-10','2024-03-03','2024-06-20',
    '2024-10-10','2025-02-02','2025-04-15','2026-01-20'].map(v=>new Date(v));
  const br=D.exTrendBreak_(dates,dates[0],new Date(AS_OF));
  assert.ok(br,'줄어드는 흐름에서는 전환 시점을 찾는다');
  assert.match(br.key,/^\d{4}-\d{2}$/);
  assert.ok(br.before>br.after&&br.dropPct>=40);
  /* 기록이 적거나(구간 미달) 줄지 않으면 전환 시점을 말하지 않는다 */
  assert.equal(D.exTrendBreak_([new Date('2026-01-01')],new Date('2026-01-01'),new Date(AS_OF)),null);
  const flat=[];
  for(let i=0;i<12;i++) flat.push(new Date(2025,i,10));
  assert.equal(D.exTrendBreak_(flat,flat[0],new Date(2025,11,31)),null,'꾸준하면 전환 없음');
});
ck('102. 병원 링크가 VOC 를 넘겨 패널이 그 VOC 기준 추이를 그린다',()=>{
  const D=build(); open(D,CUR,TREND);
  const btn=k=>({getAttribute:key=>key==='data-hosp'?'가병원':(key==='data-type'?k:'')});
  D.exOpenHospPanel_(null,btn(LEAK));
  assert.equal(D.state().hospPanel.type,LEAK);
  const html=D.dom.els.hstHospPanel.innerHTML;
  assert.match(html,/발생 빈도 추이/);
  assert.match(html,/연차별/);assert.match(html,/연도별/);assert.match(html,/전환 시점/);assert.match(html,/현재 빈도/);
  assert.match(html,/첫 발생 2023-09-05/);
  /* 같은 병원·같은 VOC 를 다시 누르면 닫히고, 다른 VOC 면 그 VOC 로 다시 연다 */
  D.exOpenHospPanel_(null,btn(LEAK));
  assert.equal(D.state().hospPanel,null);
  D.exOpenHospPanel_(null,btn(LEAK));
  D.exOpenHospPanel_(null,btn('풋스위치 작동 불량'));
  assert.equal(D.state().hospPanel.type,'풋스위치 작동 불량');
  /* 표의 병원 버튼에도 VOC 가 실린다 */
  assert.match(D.dom.els.hstTableHost.innerHTML,/data-type="노즐 누수\(약액 유입\)"/);
});

ck('103. 진행 중인 간격은 마지막 발생 이후 기준일까지를 따로 센다',()=>{
  const D=build(); open(D,CYC);
  /* 기준일을 직접 주면 오늘과 무관하게 같은 값이 나온다 */
  const rows=D.exHistoryCycles_(D.state().sourceRows,{},'2026-09-30');
  const g=rows.find(r=>r.sn==='HP-001');
  assert.equal(g.lastGap,10,'끝난 간격은 그대로');
  assert.equal(g.openGap,42,'2026-08-19 → 09-30');
  assert.equal(g.openRatio,8.4,'중앙값 5일의 8.4배');
  /* 기준일을 주지 않으면 오늘과 선택 기간 종료일 중 이른 날(F.to=2026-08-31)을 쓴다 */
  const base=D.exHistoryCycles_(D.state().sourceRows,{})[0];
  assert.equal(ymdOf(base.base),'2026-08-31');
  /* 진행 중인 간격은 평균·중앙값·추세에 섞이지 않는다 */
  assert.deepEqual(g.gaps,[3,5,10]);
  assert.equal(g.median,5);assert.equal(g.trend.dir,'up');
  /* 화면에서도 끝난 간격과 구분해 붙이고, 중앙값을 넘으면 표시한다 */
  D.exSetHistoryView_('cycle');
  const html=D.dom.els.hstTableHost.innerHTML;
  assert.match(html,/hst-gap-open/);
  assert.match(html,/일<\/b>/);
  assert.match(html,/평소 주기 초과 무재발/);
  assert.match(html,/최근 재발 간격/);
  assert.match(html,/최종 발생 후 경과/);
});

ck('104. 교체군은 핸드피스 표기만 세고, 카드에 표기 내역을 적어 교체품 TOP 5 와 맞춘다',()=>{
  const D=build();
  /* 노즐 누수 조치 6건 — 핸드피스 4 · 내부세척 1 · 스프링 1 */
  const rows=[
    act('s1','2026-06-01','가병원',"Handpiece Ass'y",{sn:'HP-1'}),
    act('s2','2026-06-02','나병원',"Handpiece Ass'y",{sn:'HP-2'}),
    act('s3','2026-06-03','다병원',"Handpiece Ass'y.1",{sn:'HP-3'}),
    act('s4','2026-06-04','라병원','Spring(1.0)',{sn:'HP-4',hpOut:'HP-OUT'}),  /* S/N 보정으로 교체 */
    act('o1','2026-06-05','마병원','Spring(1.0)',{sn:'HP-5'}),                 /* 다른 부품 → 기타 */
    act('c1','2026-06-06','바병원','내부 세척',{sn:'HP-6'})
  ];
  const a=D.exArmRecurrence_(rows,rows,'2026-08-31');
  assert.equal(a.swap.total,4,'핸드피스 3 + S/N 보정 1');
  assert.equal(a.repair.total,1);
  assert.equal(a.events.length,5,'스프링 1건은 분류에서 빠져 기타로 남는다');
  /* 표기 내역이 교체품 TOP 5 와 대조할 수 있게 나온다 */
  assert.deepEqual(a.swap.parts.map(p=>p.label+':'+p.n),
    ["Handpiece Ass'y:2","Handpiece Ass'y.1:1","Spring(1.0):1"]);
  const html=D.exCauseArmGroup_('swap',a.swap);
  assert.match(html,/표기 내역/);
  assert.match(html,/Handpiece Ass'y <b>2<\/b>/);
  assert.equal(D.exCauseArmGroup_('repair',a.repair).includes('내부 세척'),true);
});

/* 짧은 주기 × 노즐·교육 상태
   가병원 간격 5·10 (중앙값 7.5 → 짧음) · 사병원 간격 60·90 (중앙값 75 → 김) */
const STATE_ROWS=[
  row('n1','2026-06-01','가병원'), row('n2','2026-06-06','가병원'), row('n3','2026-06-16','가병원'),
  row('n4','2026-01-05','사병원'), row('n5','2026-03-06','사병원'), row('n6','2026-06-04','사병원')
];
const STATES={nozzle:{'가병원':{state:'reuse',key:20260502},'사병원':{state:'single',key:20260410}},
              skill:{'가병원':{state:'need',key:20260502},'사병원':{state:'good',key:20260410}}};

ck('105. 조합에 병원 노즐·교육 상태를 붙이고 간격 중앙값으로 짧은 주기를 가른다',()=>{
  const D=build(); D.setStates(STATES); open(D,STATE_ROWS);
  const rows=cyc(D);
  const a=rows.find(r=>r.hosp==='가병원'), b=rows.find(r=>r.hosp==='사병원');
  assert.deepEqual(a.gaps,[5,10]);assert.equal(a.median,7.5);
  assert.equal(a.nozzle,'reuse');assert.equal(a.skill,'need');
  assert.equal(a.shortCycle,true,'중앙값 7.5일 < 30일');
  assert.deepEqual(b.gaps,[60,90]);assert.equal(b.median,75);
  assert.equal(b.nozzle,'single');assert.equal(b.skill,'good');
  assert.equal(b.shortCycle,false);
  /* 평가가 없는 병원은 미평가로 남는다 — 없는 상태를 좋은 쪽으로 넘겨 짚지 않는다 */
  D.setStates({nozzle:{},skill:{}});
  const none=cyc(D)[0];
  assert.equal(none.nozzle,'unknown');assert.equal(none.skill,'none');
});
ck('106. 짧은 주기 병원과 그 밖의 병원을 노즐·교육으로 나눠 세고 비율은 평가된 병원만 쓴다',()=>{
  const D=build(); D.setStates(STATES); open(D,STATE_ROWS);
  const sum=D.exHistoryCycleSummary_(cyc(D));
  assert.equal(sum.short.hospitals,1);assert.equal(sum.short.reuse,1);assert.equal(sum.short.need,1);
  assert.equal(sum.short.reuseRate,100);assert.equal(sum.short.needRate,100);
  assert.equal(sum.long.hospitals,1);assert.equal(sum.long.reuse,0);assert.equal(sum.long.need,0);
  assert.equal(sum.long.reuseRate,0);assert.equal(sum.long.needRate,0);
  /* 미평가는 분모에서 빠진다 — 비율이 희석되지 않는다 */
  D.setStates({nozzle:{'가병원':{state:'reuse'}},skill:{}});
  const s2=D.exHistoryCycleSummary_(cyc(D));
  assert.equal(s2.short.reuseRate,100);assert.equal(s2.short.needRate,null,'교육 평가가 없으면 비율 없음');
  assert.equal(s2.long.nozzleUnknown,1);
});
ck('107. 짧은 주기만 보기 토글이 표·건수·복사를 함께 바꾼다',()=>{
  const D=build(); D.setStates(STATES); open(D,STATE_ROWS);
  D.exSetHistoryView_('cycle');
  assert.equal(D.state().cycles.length,2);
  assert.match(D.dom.els.hstTableHost.innerHTML,/재발 간격 30일 미만/);
  assert.match(D.dom.els.hstTableHost.innerHTML,/사병원/);
  D.exToggleCycleShort_();
  assert.equal(D.state().cycleShortOnly,true);
  const html=D.dom.els.hstTableHost.innerHTML;
  assert.ok(html.includes('가병원')&&!html.includes('사병원'),'짧은 주기 조합만 남는다');
  assert.match(D.dom.els.hstCount.innerHTML,/1개<\/b> 조합 · 재발 간격 30일 미만/);
  assert.equal(D.exHistoryCyclesShown_(D.state()).length,1,'복사도 화면과 같은 목록');
  D.exToggleCycleShort_();
  assert.equal(D.state().cycleShortOnly,false);
  assert.match(D.dom.els.hstTableHost.innerHTML,/사병원/);
});
ck('108. 행에는 노즐·교육 배지를 병원 아래 붙이고 짧은 주기 행을 표시한다',()=>{
  const D=build(); D.setStates(STATES); open(D,STATE_ROWS);
  D.exSetHistoryView_('cycle');
  const html=D.dom.els.hstTableHost.innerHTML;
  assert.match(html,/hst-state bad" title="노즐 재사용 · 2026.05.02 평가/);
  assert.match(html,/노즐 재사용<i>26.05.02<\/i>/,'배지에 평가일을 짧게 붙인다');
  assert.match(html,/hst-state bad" title="교육 미흡 · 2026.05.02 평가/);
  assert.match(html,/hst-state good" title="노즐 1회 사용 · 2026.04.10 평가/);
  assert.match(html,/hst-cycle-row is-short/);
  /* TSV 에도 상태가 실린다 */
  const first=D.exHistoryCycleTsv_(cyc(D)).split('\n')[1].split('\t');
  assert.equal(first[0],'가병원');assert.equal(first[1],'노즐 재사용');assert.equal(first[3],'교육 미흡');
  assert.equal(first[2],'2026.05.02','handover 에 O/X 를 적은 날');
});

/* ══════ 재발 요인 분석 (교육 × 노즐 재사용) ══════ */
const leak=(id,day,hosp,extra={})=>row(id,day,hosp,{type:LEAK,cat:'핸드피스',...extra});
/* 조사 기록 — 방문일에 노즐 O/X 와 숙련도 3항목을 적는다 */
const survey=(id,day,hosp,reuse,bad)=>row(id,day,hosp,{type:'점검',gubun:'점검',
  nozzleReuse:reuse, nsFill:bad?'X':'O', nsAmt:'적정', jet:'양호'});

ck('109. 재발 구간은 발생일 사이로 끊고 같은 날은 1회, 마지막 구간은 관찰 중으로 남긴다',()=>{
  const D=build();
  const rows=[leak('a1','2026-06-01','가병원'),leak('a2','2026-06-01','가병원'),
              leak('a3','2026-06-11','가병원'),leak('a4','2026-07-01','가병원')];
  const A=D.exBuildLeakRisk_(rows,rows,'2026-08-01');
  const iv=A.intervals.filter(x=>x.hosp==='가병원');
  assert.equal(iv.length,3,'발생 3일 → 구간 3개(마지막은 관찰 중)');
  assert.deepEqual(iv.map(x=>x.days),[10,20,31]);
  assert.deepEqual(iv.map(x=>x.recurred),[true,true,false]);
  assert.equal(A.total.recurred,2);assert.equal(A.total.watching,1);
});
ck('110. 30일 재발률의 분모는 30일을 다 관찰한 구간만이다',()=>{
  const D=build();
  /* 20일 만에 재발(포함) · 40일 관찰 중(포함) · 10일밖에 관찰 못 한 구간(제외) */
  const rows=[leak('b1','2026-06-01','가병원'),leak('b2','2026-06-21','가병원'),
              leak('c1','2026-05-01','나병원'),
              leak('d1','2026-07-22','다병원')];
  const A=D.exBuildLeakRisk_(rows,rows,'2026-08-01');
  const r30=A.total.rates[30];
  assert.equal(r30.denom,3,'20일 재발 + 나병원 92일 관찰 + 가병원 41일 관찰');
  assert.equal(r30.hit,1);
  assert.equal(r30.rate,33.3);
  /* 기준일은 3·5·10·20·30일 다섯 개다 */
  assert.deepEqual(Object.keys(A.total.rates).map(Number).sort((a,b)=>a-b),[3,5,10,20,30]);
  assert.equal(A.total.rates[10].hit,0,'10일 안에 재발한 구간은 없다');
  assert.equal(A.total.rates[20].hit,1,'20일 만의 재발은 20일 기준에 포함');
});
ck('111. 구간의 교육·노즐 상태는 구간 시작일 기준이고 이후 조사는 소급되지 않는다',()=>{
  const D=build();
  const rows=[survey('s1','2026-05-01','가병원','O',true),      /* 재사용 · 교육 미흡 */
              leak('e1','2026-06-01','가병원'),
              leak('e2','2026-06-15','가병원'),
              survey('s2','2026-06-20','가병원','X',false),     /* 이후 개선 */
              leak('e3','2026-07-20','가병원')];
  const A=D.exBuildLeakRisk_(rows,rows,'2026-09-01');
  const iv=A.intervals;
  assert.deepEqual(iv.map(x=>x.skill+'/'+x.nozzle),
    ['need/reuse','need/reuse','good/single'],'6/20 조사는 그 뒤 구간부터');
  const g=k=>A.groups.find(x=>x.key===k);
  assert.equal(g('need_reuse').intervals,2);
  assert.equal(g('good_single').intervals,1);
  /* 조사 이력이 없는 병원은 4집단에서 빼고 따로 센다 */
  const A2=D.exBuildLeakRisk_([leak('f1','2026-06-01','바병원'),leak('f2','2026-06-10','바병원')],
                              [leak('f1','2026-06-01','바병원')],'2026-09-01');
  assert.equal(A2.unknown.intervals,2);
  assert.equal(A2.groups.reduce((a,x)=>a+x.intervals,0),0);
});
ck('112. 기준군 대비 배수와 판정 문장은 표본이 얇으면 단정하지 않는다',()=>{
  const D=build();
  const rows=[survey('s1','2026-01-01','가병원','O',true),
              leak('g1','2026-02-01','가병원'),leak('g2','2026-02-11','가병원')];
  const A=D.exBuildLeakRisk_(rows,rows,'2026-09-01');
  assert.match(D.exRiskVerdict_(A),/표본이 아직 얇습니다/);
  /* 기준군 대비 배수는 30일 재발률의 비다 */
  const g=A.groups.find(x=>x.key==='need_reuse');
  assert.equal(A.groups[0].base,true);
  assert.equal(g.ratio,null,'기준군 재발률이 없으면 배수도 없다');
});

ck('113. 누적 재발률은 앞 기준을 포함하고, 그 구간에서 새로 난 건수도 함께 센다',()=>{
  const D=build();
  /* 2일·4일·8일 만에 재발한 세 구간 */
  const rows=[leak('p1','2026-01-01','가병원'),leak('p2','2026-01-03','가병원'),
              leak('p3','2026-02-01','나병원'),leak('p4','2026-02-05','나병원'),
              leak('p5','2026-03-01','다병원'),leak('p6','2026-03-09','다병원')];
  const A=D.exBuildLeakRisk_(rows,rows,'2026-09-01');
  const r=A.total.rates;
  assert.equal(r[3].hit,1,'3일 칸 = 1~3일 → 2일 재발 1건');
  assert.equal(r[5].hit,2,'5일 칸은 누적 — 2일과 4일');
  assert.equal(r[5].bucket,1,'그 구간(4~5일) 신규는 1건');
  assert.equal(r[10].hit,3,'10일 칸은 2·4·8일 모두 포함');
  assert.equal(r[10].bucket,1,'그 구간(6~10일) 신규는 8일 1건');
  assert.equal(r[3].from,1);assert.equal(r[5].from,4);assert.equal(r[10].from,6);
  assert.equal(r[20].bucket,0,'11~20일 사이 재발은 없다');
});
ck('114. 개선 시점은 나쁜 상태 뒤 처음 좋아진 조사일이고, 전후는 구간 시작일로 가른다',()=>{
  const D=build();
  const rows=[
    survey('v1','2026-01-05','가병원','O',true),     /* 재사용 · 교육 미흡 */
    leak('q1','2026-01-10','가병원'),
    leak('q2','2026-01-22','가병원'),                /* 개선 전 간격 12일 */
    leak('q3','2026-02-03','가병원'),                /* 개선 전 간격 12일 */
    survey('v2','2026-02-10','가병원','X',false),    /* 개선 */
    leak('q4','2026-04-15','가병원'),                /* 개선 후 시작 구간 */
    leak('q5','2026-07-20','가병원')                 /* 96일 만에 재발 */
  ];
  const C=D.exBuildLeakChange_(rows,rows,'2026-09-01');
  assert.equal(C.rows.length,1);
  const r=C.rows[0];
  assert.equal(r.hosp,'가병원');
  assert.equal(D.exChangeKeyDate_(r.at),'2026-02-10');
  assert.equal(r.label,'교육 개선 + 재사용 중단');
  /* 개선일에 걸친 구간(2/3 시작 → 4/15 종료)은 시작일이 개선 전이므로 "개선 전"에 넣는다.
     긴 간격이 개선 전으로 잡혀 개선 폭을 작게 보이게 하는 쪽이라 결론이 부풀지 않는다. */
  assert.equal(r.before.intervals,3,'1/10 · 1/22 · 2/3 시작 구간');
  assert.deepEqual([r.before.median,r.before.recurred],[12,3]);
  assert.equal(r.after.intervals,2,'4/15 재발 구간 + 7/20 이후 관찰 중');
  assert.equal(r.after.maxWatch,43,'7/20 → 9/1 · 개선 후 시작이라 그대로 센다');
  assert.equal(r.after.recurred,1);
  assert.equal(r.after.watching,1);
  assert.equal(r.after.median,96,'4/15 → 7/20');
  assert.equal(r.gain,84);assert.equal(r.ratio,8);
  assert.equal(C.summary.before,12);assert.equal(C.summary.after,96);
});
ck('115. 개선 이력이 없거나 한쪽 구간이 비면 전후 비교에서 뺀다',()=>{
  const D=build();
  /* 계속 미흡·재사용 — 개선 시점 없음 */
  const a=[survey('w1','2026-01-01','나병원','O',true),
           leak('r1','2026-02-01','나병원'),leak('r2','2026-02-20','나병원')];
  assert.equal(D.exBuildLeakChange_(a,a,'2026-09-01').rows.length,0);
  /* 개선은 했지만 그 전에 구간이 없다 */
  const b=[survey('w2','2026-01-01','다병원','O',true),
           survey('w3','2026-01-20','다병원','X',false),
           leak('r3','2026-02-01','다병원'),leak('r4','2026-03-01','다병원')];
  assert.equal(D.exBuildLeakChange_(b,b,'2026-09-01').rows.length,0);
});
ck('116. 개선 후 재발이 없으면 중앙값 대신 관찰 중으로 적는다',()=>{
  const D=build();
  const rows=[survey('u1','2026-01-05','라병원','O',true),
              leak('t1','2026-01-10','라병원'),leak('t2','2026-01-25','라병원'),
              survey('u2','2026-02-01','라병원','X',false)];
  const C=D.exBuildLeakChange_(rows,rows,'2026-09-01');
  const r=C.rows[0];
  assert.equal(r.after.intervals,1);assert.equal(r.after.recurred,0);
  assert.equal(r.after.median,null);
  assert.equal(r.after.maxWatch,212,'개선일 2/1 → 기준일 9/1 · 개선 이후 경과분만 센다');
  assert.equal(r.gain,null,'중앙값이 없으면 증감을 숫자로 말하지 않는다');
  assert.match(D.exChangeGainText_(r),/개선 후 무재발/);
  assert.equal(C.summary.noRecurAfter,1);
});

ck('117. 카드 단위 전체화면은 그 카드만 덮고 Esc 로 되돌아온다',()=>{
  const D=build();
  /* 스텁 DOM 에 카드 하나를 만들어 토글만 확인한다 */
  const card=D.dom.ensure('exLeakRiskCard'), btn=D.dom.ensure('exLeakRiskCardFull','button');
  assert.match(D.exCardFullBtn_('exLeakRiskCard'),/id="exLeakRiskCardFull"/);
  assert.equal(D.exToggleCardFull_('exLeakRiskCard'),true);
  assert.equal(card.classList.contains('is-full'),true);
  assert.equal(btn.getAttribute('aria-pressed'),'true');
  assert.ok(btn.textContent.includes('원래 크기'));
  assert.equal(D.exToggleCardFull_('exLeakRiskCard',false),false);
  assert.equal(card.classList.contains('is-full'),false);
  assert.ok(btn.textContent.includes('전체화면'));
  /* 원인 분석 3장 + 재발 원인 2장이 모두 버튼을 갖는다 */
  ['exTypeCard','exPartCard','exCauseArmCard','exLeakRiskCard','exLeakChangeCard'].forEach(id=>{
    assert.match(SRC,new RegExp("exCardFullBtn_\\('"+id+"'\\)"),id+' 전체화면 버튼');
  });
  assert.match(SRC,/\.ex-card\.is-full\{position:fixed;inset:0/);
});
ck('118. 재발 원인은 별도 탭이고 원인 분석 탭 배치는 그대로 둔다',()=>{
  /* 두 분석 카드는 새 탭(exPaneRisk)에만 있다 */
  assert.match(SRC,/<section class="ex-pane" id="exPaneRisk">\s*<div class="ex-card" id="exLeakRiskCard"><\/div>\s*<div class="ex-card" id="exLeakChangeCard"><\/div>/);
  assert.match(SRC,/data-tab="risk">⑤ 재발 원인</);
  assert.match(SRC,/data-tab="year">⑥ 연간 비교분석</);
  /* 원인 분석 탭은 예전 두 줄 배치 그대로 — 카드가 0 높이로 눌리지 않는다 */
  assert.match(SRC,/#exPaneCause\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);grid-template-rows:minmax\(0,1fr\) minmax\(0,1\.15fr\)\}/);
  assert.ok(!/id="exPaneCause"[\s\S]{0,400}exLeakRiskCard/.test(SRC),'원인 분석 탭에는 재발 요인 카드가 없다');
  /* 탭 전환·렌더 분기에 risk 가 등록돼 있다 */
  assert.match(SRC,/\['summary','cause','actions','leak','risk','year'\]/);
  assert.match(SRC,/risk:'exPaneRisk'/);
  assert.match(SRC,/EX_TAB==='risk'\)  renderExecutiveRisk\(x\)/);
  assert.match(SRC,/#exPaneRisk\{grid-template-columns:1fr;grid-auto-rows:auto;align-content:start;overflow-y:auto\}/);
});

console.log('처리이력 모달 검증 통과 '+count+'/'+count);
