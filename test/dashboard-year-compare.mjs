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
  'ycAlignedMd_','ycAlignedRange_','ycPeriods_','ycRangeStat_','ycDayDiff_','ycSum_','ycPeriodData_'];
const code=[
  "var EX_YC_LEFT=null,EX_YC_RIGHT=null,EX_YC_MODE='aligned',EX_YC_CUSTOM=null,EX_YC_ALIGN_FROM=[1,1],EX_YC_ALIGN_TO=null;",
  'var YC_DAY=86400000,YC_CLEAN_SAVING_UNIT=281200,TEST_ROWS=[];',
  "function exBaseDate(){return new Date('2026-08-18T00:00:00');}",
  "function recScope(){return 'customer';}",
  'function exWindowRows(a,b){return TEST_ROWS.filter(function(r){var d=rowDate(r);return d&&d>=a&&d<=b;});}',
  ...FNS.map(grab),
  'return {'+FNS.join(',')+',setMode:function(v){EX_YC_MODE=v;},setCustom:function(v){EX_YC_CUSTOM=v;},setAligned:function(a,b){EX_YC_ALIGN_FROM=a;EX_YC_ALIGN_TO=b;},setRows:function(v){TEST_ROWS=v;}};'
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

console.log('\n──────────────────────────────');console.log(`통과 ${pass}/${total}`);
if(fails.length){console.log('실패:');fails.forEach(x=>console.log(' -',x));process.exit(1);}console.log('모든 테스트 통과 ✅');
