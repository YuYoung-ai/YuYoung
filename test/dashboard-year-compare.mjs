/************************************************************
 * 연간 비교분석 기간·절감액 회귀 테스트
 * 실행: node test/dashboard-year-compare.mjs
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
const FNS=['monday','addD','ymd','rowDate','hpCleanKey_','hpIsLeakVoc_','isHandpieceCleaning_',
  'ycDate_','ycRange_','ycDefaultSideRange_','ycEnsureCustom_','ycMdCmp_','ycMdInYear_',
  'ycAlignedMd_','ycAlignedRange_','ycPeriods_','ycRangeStat_','ycDayDiff_','ycSum_','ycPeriodData_',
  'esc','escAttr','exNum','ycMD_','ycMetricVal_','ycMetricLabel_','ycNice_','ycPartialDays_',
  'ycLinePath_','ycLineGeom_','ycWeekTip_','ycLineSvg_'];
const code=[
  "var EX_YC_LEFT=null,EX_YC_RIGHT=null,EX_YC_MODE='aligned',EX_YC_CUSTOM=null,EX_YC_ALIGN_FROM=[1,1],EX_YC_ALIGN_TO=null;",
  "var EX_YC_METRIC='all';",
  'var YC_DAY=86400000,YC_CLEAN_SAVING_UNIT=281200,TEST_ROWS=[];',
  "function exBaseDate(){return new Date('2026-08-18T00:00:00');}",
  "function recScope(){return 'customer';}",
  'function exWindowRows(a,b){return TEST_ROWS.filter(function(r){var d=rowDate(r);return d&&d>=a&&d<=b;});}',
  ...FNS.map(grab),
  'return {'+FNS.join(',')+',setMode:function(v){EX_YC_MODE=v;},setCustom:function(v){EX_YC_CUSTOM=v;},setAligned:function(a,b){EX_YC_ALIGN_FROM=a;EX_YC_ALIGN_TO=b;},setRows:function(v){TEST_ROWS=v;},setMetric:function(v){EX_YC_METRIC=v;}};'
].join('\n');
const D=new Function(code)();
const ys={l:2025,r:2026,opts:[2025,2026]};

let p=D.ycPeriods_(ys);
ck('1. 기본 동월·동일일은 왼쪽도 2025-08-18에서 종료',D.ymd(p.l.from)==='2025-01-01'&&D.ymd(p.l.to)==='2025-08-18');
ck('2. 기본 동월·동일일 오른쪽은 2026-08-18에서 종료',D.ymd(p.r.from)==='2026-01-01'&&D.ymd(p.r.to)==='2026-08-18');

D.setAligned([1,1],[7,18]);p=D.ycPeriods_(ys);
ck('3. 왼쪽 2025-07-18 설정이 오른쪽 2026-07-18로 자동 연동',D.ymd(p.l.to)==='2025-07-18'&&D.ymd(p.r.to)==='2026-07-18');
D.setAligned([2,1],[2,29]);
const leap=D.ycPeriods_({l:2024,r:2025,opts:[2024,2025]});
ck('4. 상대 연도에 2월 29일이 없으면 말일로 보정',D.ymd(leap.l.to)==='2024-02-29'&&D.ymd(leap.r.to)==='2025-02-28');

D.setMode('custom');D.setCustom({l:{from:'2025-01-01',to:'2025-12-31'},r:{from:'2026-01-01',to:'2026-07-31'}});
p=D.ycPeriods_(ys);
ck('5. 직접 기간은 좌우 범위를 독립적으로 유지',D.ymd(p.l.to)==='2025-12-31'&&D.ymd(p.r.to)==='2026-07-31');
const L=D.ycPeriodData_(2025,p.l,p.mode),R=D.ycPeriodData_(2026,p.r,p.mode);
ck('6. 직접 기간 월 차트는 12개월 대 7개월로 생성',L.months.length===12&&R.months.length===7,L.months.length+' / '+R.months.length);

function row(date,gubun,type,part,hosp){const d=new Date(date+'T00:00:00');return {_y:d.getFullYear(),_m:d.getMonth()+1,_d:d.getDate(),gubun,type,part,hosp};}
D.setRows([
  row('2026-01-02','A/S','노즐 누수(약액 유입)','내부 세척','A병원'),
  row('2026-02-03','A/S','노즐누수(약액 유입)','내부세척','B병원'),
  row('2026-03-04','A/S','노즐 누수(약액 유입)',"Handpiece Ass'y",'C병원'),
  row('2026-04-05','A/S','케이블 불량','내부 세척','D병원'),
  row('2026-08-01','A/S','노즐 누수(약액 유입)','내부 세척','E병원')
]);
const s=D.ycRangeStat_(p.r);
ck('7. 절감 건수는 대상 VOC이면서 내부 세척인 기록만 집계',s.clean===2,'clean='+s.clean);
ck('8. 추정 절감액은 1건당 281,200원',s.saving===562400,'saving='+s.saving);
ck('9. 직접 기간 종료일 밖 기록 제외',s.n===4,'n='+s.n);
ck('10. 카드 명칭과 산정 기준이 화면에 명시',SRC.includes("ycKpiTile_('추정 교체비용 절감액'")&&SRC.includes('내부 세척 1건당 281,200원'));
ck('11. 비교 방식 두 가지가 화면에 제공',SRC.includes('동월·동일일</button>')&&SRC.includes('직접 기간</button>'));
ck('12. 기본 모드는 왼쪽 날짜 입력과 오른쪽 자동 연동 표시',SRC.includes("ycSetAlignedDate(\\'from\\'")&&SRC.includes('자동 연동 시작일')&&SRC.includes('readonly title="왼쪽 기간의 월·일이 자동 적용됩니다"'));

/* ══════ 주 추이 겹친 선 그래프 ══════
   좌우 2패널 묶음 막대로는 53주에서 막대가 200개를 넘어 비교가 안 됐다.
   한 좌표축에 두 기간을 겹치고 아래에 차이 막대를 둔다. */
const W=(i,n,as,insp,opt)=>Object.assign({i:i,y:2025,mon:new Date(2025,0,6+7*i),to:new Date(2025,0,12+7*i),
  viewFrom:new Date(2025,0,6+7*i),viewTo:new Date(2025,0,12+7*i),n:n,as:as,insp:insp,cur:false,future:false},opt||{});

ck('13. 눈금은 정수로 올림된다',(()=>{const a=D.ycNice_(37,4);return a.max>=37&&a.step===Math.round(a.step)&&a.max%a.step===0;})(),
  JSON.stringify(D.ycNice_(37,4)));
ck('14. 값이 0이어도 눈금이 무너지지 않는다',D.ycNice_(0,3).max===1);

ck('15. 미도래 주에서 선이 끊긴다(0으로 잇지 않는다)',
  D.ycLinePath_([{x:0,y:1},null,{x:2,y:3}])==='M0.0 1.0M2.0 3.0');
ck('16. 이어지는 구간은 한 선으로 그린다',
  D.ycLinePath_([{x:0,y:1},{x:1,y:2}])==='M0.0 1.0L1.0 2.0');

ck('17. 부분 주(경계에서 잘린 주)를 일수로 가려낸다',
  D.ycPartialDays_(W(0,5,3,2))===7 &&
  D.ycPartialDays_({mon:new Date(2025,0,6),to:new Date(2025,0,12),viewFrom:new Date(2025,0,6),viewTo:new Date(2025,0,9)})===4);

ck('18. 지표 토글이 계열을 바꾼다',(()=>{const w=W(0,10,7,3);
  D.setMetric('all');const a=D.ycMetricVal_(w);
  D.setMetric('as');const b=D.ycMetricVal_(w);
  D.setMetric('insp');const c=D.ycMetricVal_(w);D.setMetric('all');
  return a===10&&b===7&&c===3;})());

{
  const ls=[W(0,10,6,4),W(1,12,7,5),W(2,8,5,3)];
  const rs=[W(0,14,9,5),W(1,9,5,4),W(2,8,5,3)];
  const svg=D.ycLineSvg_({ls:ls,rs:rs,ys:{l:2025,r:2026},full:false},900,200);
  ck('19. 선 2개와 주차 수만큼의 히트 영역을 그린다',
    (svg.match(/class="yc-ln /g)||[]).length===2 && (svg.match(/class="yc-hit"/g)||[]).length===3);
  ck('20. 차이 막대는 값이 다른 주에만 (동일한 주는 막대 없음)',
    (svg.match(/class="yc-dbar /g)||[]).length===2,
    (svg.match(/class="yc-dbar /g)||[]).length+'개');
  ck('21. 증가는 up, 감소는 down 으로 색을 가른다',
    svg.includes('yc-dbar up')&&svg.includes('yc-dbar down'));
  ck('22. 툴팁이 양쪽 연도와 차이를 함께 말한다',
    /2025년.*10건.*2026년.*14건.*4건 증가/.test(D.ycWeekTip_(0,ls[0],rs[0],{l:2025,r:2026})),
    D.ycWeekTip_(0,ls[0],rs[0],{l:2025,r:2026}));
  ck('23. 접근성 — 히트 영역마다 aria-label 과 title 이 붙는다',
    (svg.match(/role="img" aria-label=/g)||[]).length===3 && (svg.match(/<title>/g)||[]).length===3);
  ck('24. 색은 SVG 속성이 아니라 CSS 클래스가 준다(다크 모드 자동 추종)',
    !/stroke="(?!none)/.test(svg) && !/fill="(?!none)/.test(svg));
  ck('25. id·defs 를 쓰지 않는다(카드와 전체화면 SVG 가 동시에 존재)',
    !svg.includes('<defs')&&!/\sid="/.test(svg));
}
{
  /* 진행 중인 주는 상대 연도의 완결된 주와 견줄 수 없다 */
  const ls=[W(0,10,6,4),W(1,12,7,5)];
  const rs=[W(0,14,9,5),W(1,3,2,1,{cur:true})];
  const svg=D.ycLineSvg_({ls:ls,rs:rs,ys:{l:2025,r:2026},full:false},900,200);
  ck('26. 진행 중인 주는 증감이 아니라 진행 표식으로 그린다',
    svg.includes('yc-dbar prog')&&!/yc-dbar down[^>]*x="[^"]*"[^>]*height="[1-9]/.test(svg));
  ck('27. 진행 중 구간은 점선으로 잇는다',svg.includes('yc-ln r prog'));
  ck('28. 툴팁이 진행 중임을 밝힌다',
    /진행 중이라 아직 견줄 수 없음/.test(D.ycWeekTip_(1,ls[1],rs[1],{l:2025,r:2026})));
}
{
  /* 좌우 길이가 다르면(직접 기간) 겹치는 구간만 비교한다 */
  const ls=[W(0,10,6,4),W(1,12,7,5),W(2,8,5,3),W(3,9,5,4)];
  const rs=[W(0,14,9,5),W(1,9,5,4)];
  const svg=D.ycLineSvg_({ls:ls,rs:rs,ys:{l:2025,r:2026},full:false},900,200);
  ck('29. x축은 긴 쪽에 맞추고 히트 영역도 그만큼 만든다',(svg.match(/class="yc-hit"/g)||[]).length===4);
  ck('30. 짧은 쪽이 끝난 뒤는 "비교 구간 밖"으로 표시한다',
    svg.includes('yc-band')&&svg.includes('비교 구간 밖'));
  ck('31. 겹치지 않는 구간에는 차이 막대를 만들지 않는다',
    (svg.match(/class="yc-dbar /g)||[]).length===2,
    (svg.match(/class="yc-dbar /g)||[]).length+'개');
}
ck('32. 너무 작으면 그리지 않는다(모달이 닫힌 동안 0×0 방어)',
  D.ycLineSvg_({ls:[W(0,1,1,0)],rs:[W(0,1,1,0)],ys:{l:2025,r:2026},full:false},10,10)==='');
ck('33. 카드보다 전체화면이 더 촘촘한 라벨·굵은 막대를 쓴다',(()=>{
  const a=D.ycLineGeom_(1000,150,53,false), b=D.ycLineGeom_(1000,500,53,true);
  return b.xStep<=a.xStep && b.barW>=a.barW && b.ticks>=a.ticks;})());
ck('34. 24주 창 이동 코드가 남아 있지 않다',
  !SRC.includes('EX_YC_WEEKS')&&!SRC.includes('EX_YC_START')&&!SRC.includes('ycShiftWeeks'));
ck('35. 전체화면은 띄운 뒤에 그린다(display:none 상태 실측 0×0 방지)',(()=>{
  const f=SRC.slice(SRC.indexOf('function openYcFull('));
  return f.indexOf("classList.add('show')") < f.indexOf('ycRenderFull_(');})());
ck('36. 지표 토글 3종(전체·A/S·점검)이 화면에 있다',
  SRC.includes("var seg=['all','전체','as','A/S','insp','점검']")&&SRC.includes('ycSetMetric(')
  &&/function ycSetMetric\(v\)\{[\s\S]*?\['all','as','insp'\]/.test(SRC));

console.log('\n──────────────────────────────');console.log(`통과 ${pass}/${total}`);
if(fails.length){console.log('실패:');fails.forEach(x=>console.log(' -',x));process.exit(1);}console.log('모든 테스트 통과 ✅');
