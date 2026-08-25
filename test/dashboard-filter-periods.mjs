/************************************************************
 * dashboard-filter-periods.mjs
 * 보고 탭 기간 기준·부분 주·필터 계약 회귀 테스트
 * 실행: node test/dashboard-filter-periods.mjs
 ************************************************************/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.join(HERE,'..');
const SRC=fs.readFileSync(path.join(ROOT,'dashboard-pc.html'),'utf8');
const SW=fs.readFileSync(path.join(ROOT,'sw.js'),'utf8');
let pass=0,total=0; const fails=[];
function ck(name,ok,detail){
  total++; if(ok) pass++; else fails.push(name+(detail?' — '+detail:''));
  console.log(ok?'✅':'❌',name,detail||'');
}
function grab(name){
  const at=SRC.search(new RegExp('\\bfunction\\s+'+name.replace(/[$]/g,'\\$')+'\\s*\\('));
  if(at<0) throw new Error('함수를 찾지 못했습니다: '+name);
  let depth=0;
  for(let i=SRC.indexOf('{',at);i<SRC.length;i++){
    if(SRC[i]==='{') depth++;
    else if(SRC[i]==='}'&&--depth===0) return SRC.slice(at,i+1);
  }
  throw new Error('본문 끝을 찾지 못했습니다: '+name);
}
function grabVar(decl){
  const at=SRC.indexOf(decl); if(at<0) throw new Error('선언을 찾지 못했습니다: '+decl);
  return SRC.slice(at,SRC.indexOf('\n',at));
}
const FNS=['normD','costNum','paidType_','rowDate','monday','addD','ymd','exToday','exBaseDate',
  'isDemoRecord','recScope','filteredRows_','hospStateFilter_','exWindowBaseRows_','exWindowRows','buildWeekTrend'];
const runtime=[
  grabVar('var RAW=[];'),grabVar('var F={year:'),grabVar('var DEMO_MARK='),
  ...FNS.map(grab),
  'return {'+FNS.join(',')+',setRAW:function(v){RAW=v;},setF:function(v){F=v;}};'
].join('\n');
const D=new Function(runtime)();
const emptyF=()=>({year:[],month:[],quarter:[],gubun:[],paid:[],ncare:[],cat:[],fse:[],
  type:[],part:[],hosp:[],noz:[],skill:[],scope:[],hospQ:'',from:'',to:''});
function load(rows,over){
  D.setRAW(rows.map(r=>{
    const o=Object.assign({hosp:'',fse:'',gubun:'',paid:'',ncare:'미가입',cat:'',type:'',part:'',detail:''},r);
    const d=D.normD(o.date); o._y=d.y;o._m=d.m;o._d=d.d;o._q=d.q;o._cost=D.costNum(o.cost);o.paid=D.paidType_(o.cost);return o;
  }));
  D.setF(Object.assign(emptyF(),over||{}));
}

{
  const today=D.exToday(),future=D.addD(today,30);
  load([],{to:D.ymd(future)});
  ck('1. 미래 종료일의 보고 기준일은 오늘로 제한',D.ymd(D.exBaseDate())===D.ymd(today));
}
{
  load([
    {date:'2026-08-19',hosp:'A',gubun:'A/S'},
    {date:'2026-08-20',hosp:'A',gubun:'A/S'},
    {date:'2026-08-21',hosp:'A',gubun:'점검'}
  ],{from:'2026-08-17',to:'2026-08-19'});
  const last=D.buildWeekTrend().at(-1);
  ck('2. 수요일 종료 시 목·금 기록을 최신 주에서 제외',last.n===1&&last.as===1&&last.insp===0,
    JSON.stringify({n:last.n,as:last.as,insp:last.insp}));
  ck('2-b. 최신 주 표시 범위도 선택 종료일까지',D.ymd(last.to)==='2026-08-19'&&last.partial===true);
}
ck('2-c. 월간 보고서도 오늘이 아닌 선택 종료일로 부분 월 판정',
  /var ongoing=!!cur\.partial/.test(grab('exReportSnapshot_'))&&/기준일까지/.test(grab('exReportSnapshot_')));
{
  load([
    {date:'2025-08-05',hosp:'A',fse:'김',gubun:'A/S'},
    {date:'2026-08-05',hosp:'B',fse:'김',gubun:'A/S'},
    {date:'2026-08-06',hosp:'C',fse:'이',gubun:'점검'}
  ],{year:['2025'],month:['8'],quarter:['3'],fse:['김']});
  const detail=D.filteredRows_(),report=D.filteredRows_({scope:'customer'});
  ck('3. 상세 분석은 연·월·분기 칩을 계속 적용',detail.length===1&&detail[0]._y===2025);
  ck('3-b. 보고 모드도 연·월·분기 칩을 함께 적용',report.length===1&&report[0]._y===2025&&report[0].fse==='김');
}
{
  load([
    {date:'2026-08-01',hosp:'A',cost:'1,650,000',paid:'무상'},
    {date:'2026-08-02',hosp:'B',cost:'무상',paid:'유상'},
    {date:'2026-08-03',hosp:'C',cost:'',paid:'유상'}
  ],{paid:['유상']});
  const paid=D.filteredRows_();
  ck('4. 교체비용 1원 이상만 유상이며 별도 유무상 표기는 판정에 사용하지 않음',
    D.paidType_('1,650,000')==='유상'&&D.paidType_('무상')==='무상'&&D.paidType_('')==='무상'&&paid.length===1&&paid[0].hosp==='A');
}
ck('5. 보고 상세 필터에 연·월·분기와 유상·무상 및 교체품 선택 UI 존재',
  ['exYear','exMonth','exQuarter','exPaid','exCbPart','exPartSel'].every(id=>SRC.includes('id="'+id+'"'))&&
  /chipGroup\('exYear','year'/.test(grab('buildFilters'))&&/chipGroup\('exPaid','paid', PAID_OPT\)/.test(grab('buildFilters'))&&
  /combo\('exCbPart','exCbPartDrop','part','part'\)/.test(SRC));
ck('5-b. 보고 기본 모집단은 연·월·분기 필터를 제외하지 않음',
  /EX_ROWS=filtered\(\{scope:'customer'\}\)/.test(grab('apply'))&&!/EX_ROWS=filtered\(\{scope:'customer',ignorePeriodChips:true\}\)/.test(grab('apply')));
ck('6. 누수 탭도 유형만 제외하고 연·월·분기 조건은 적용',
  /filteredRows_\(\{scope:'customer',ignoreType:true\}\)/.test(grab('buildNozzleLeakCurrent_'))&&
  !/ignorePeriodChips:true/.test(grab('buildNozzleLeakCurrent_')));
ck('7. 비교 토글을 끄면 월별 전월 비교·특이사항도 중지',
  /mc=EX_CMP\?buildMonthTrendCompare\(mt\):null/.test(grab('renderExecutiveSummary'))&&
  /mNote=EX_CMP\?exMonthTrendNote_\(mc\):null/.test(grab('renderExecutiveSummary')));
ck('8. 역전된 직접 기간은 적용 전에 차단',/from&&to&&from>to/.test(grab('setRange')));
ck('9. 누수·연간 탭의 필터 예외를 상단에 표시',
  /누수 분석: 유형·노즐·교육 상태 필터 제외/.test(SRC)&&/연간 비교: 연·월·분기는 제외/.test(SRC));
ck('10. 배포 캐시 버전 증가',Number((SW.match(/baz-cs-v(\d+)/)||[])[1]||0)>=156);

console.log('\n──────────────────────────────');
console.log(`통과 ${pass}/${total}`);
if(fails.length){fails.forEach(f=>console.log(' -',f));process.exit(1);}
console.log('모든 테스트 통과 ✅');
