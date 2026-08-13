/************************************************************
 * gas-sync-p1-p2.mjs
 * GAS 강제 최신 조회(P1)·리비전 조건부 동기화(P2) 회귀 테스트
 ************************************************************/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const read=n=>fs.readFileSync(path.join(HERE,'..',n),'utf8');
const D=read('dashboard-pc.html');
const H=read('hospital-pc.html');
const O=read('handover.html');
const G=read('handover_gas.gs');
const SW=read('sw.js');

let pass=0,total=0; const fails=[];
function ck(name,cond){ total++; if(cond){pass++;console.log('✅',name);}else{fails.push(name);console.log('❌',name);} }
function grab(src,name){
  const at=src.search(new RegExp('\\bfunction\\s+'+name.replace(/[$]/g,'\\$&')+'\\s*\\('));
  if(at<0) throw new Error('함수를 찾지 못했습니다: '+name);
  let depth=0;
  for(let j=src.indexOf('{',at);j<src.length;j++){
    if(src[j]==='{') depth++;
    else if(src[j]==='}'&&--depth===0) return src.slice(at,j+1);
  }
  throw new Error('함수 끝을 찾지 못했습니다: '+name);
}

const gAll=grab(G,'getAll_'),gHosp=grab(G,'getHospDB_'),gRich=grab(G,'getHospDBRich_'),
      gIssue=grab(G,'getIssueHist_'),gBoot=grab(G,'getBootstrap_');
const dFetch=grab(D,'fetchAllRetry'),dHosp=grab(D,'loadHospDB'),
      hBoot=grab(H,'bazBootSync'),hRecent=grab(H,'pcLoadRecent');
ck('P1 서버: all force 요청은 캐시 조회를 건너뜀',/!syncForce_\(p\)/.test(gAll));
ck('P1 서버: hospdb force 요청은 캐시 조회를 건너뜀',/!syncForce_\(p\)/.test(gHosp));
ck('P1 서버: hospdbrich force 요청은 캐시 조회를 건너뜀',/!syncForce_\(p\)/.test(gRich));
ck('P1 서버: issuehist force 요청은 캐시 조회를 건너뜀',/!syncForce_\(p\)/.test(gIssue));
ck('P1 서버: bootstrap이 force 파라미터를 하위 조회에 전달',/getHospDBRich_\(p,'hrev'\)/.test(gBoot)&&/getIssueHist_\(p,'irev'\)/.test(gBoot));
ck('P1 대시보드: 수동 새로고침이 all force=1 사용',/force\?'&force=1'/.test(dFetch));
ck('P1 대시보드: 수동 새로고침이 hospdb force=1 사용',/force\?\{force:1\}/.test(dHosp));
ck('P1 병원 화면: bootstrap 강제 조회',/force\?'&force=1'/.test(hBoot));
ck('P1 병원 화면: 최근 처리 all 강제 조회',/force\?'&force=1'/.test(hRecent));
ck('P1 경합: 일반 요청 중 강제 새로고침을 후속 실행',
  /force && !DASH_LOAD_FORCE/.test(D)&&/force && !BAZ_BOOT_FORCE/.test(H)&&/force && !pcRecentForce/.test(H));

/* P2 계약은 구현 후 아래 검사가 활성화된다. */
ck('P2 서버: 데이터 리비전 생성 헬퍼',/function syncRevOf_\(/.test(G));
ck('P2 서버: 일치 리비전은 nochange 응답',/nochange:true/.test(G));
ck('P2 서버: 전체·병원·이력 캐시 메타데이터 관리',
  /syncMetaPut_\('handover_all'/.test(G)&&/syncMetaPut_\('handover_hospdb'/.test(G)&&
  /syncMetaPut_\('handover_hospdb_rich'/.test(G)&&/syncMetaPut_\('handover_issuehist'/.test(G));
ck('P2 대시보드: 캐시 rev를 조건부 요청에 사용',/DASH_DATA_REV/.test(D)&&/nochange/.test(D));
ck('P2 병원 화면: 병원DB·이슈이력 rev를 bootstrap에 전달',/HDB_CACHE_REV/.test(H)&&/ISSUE_CACHE_REV/.test(H)&&/hrev/.test(H)&&/irev/.test(H));
ck('P2 병원 화면: 최근 처리 rev 조건부 요청',/PC_RECENT_REV/.test(H)&&/nochange/.test(H));
ck('P2 병원 화면: 본문 캐시 없이 rev만 남으면 전체 재조회',
  /if\(!\(cached && cached\.length\)\)[\s\S]{0,180}PC_RECENT_REV=''/.test(hRecent));
ck('P2 인계 화면: 부트스트랩 본문 캐시가 있을 때만 rev 전송',
  /baz_handover_bootstrap/.test(O)&&/bootCache\?'&rev='/.test(O)&&/d\.nochange && bootCache/.test(O));
ck('P2 서버: 인계 부트스트랩 묶음도 rev·nochange 캐시',
  /syncNochange_\('handover_bootstrap'/.test(G)&&/syncMetaPut_\('handover_bootstrap'/.test(G));
/* 번호를 박아 두면 다른 페이지를 고쳐 캐시를 올릴 때마다 이 검사가 깨진다
   (sw.js 자체가 "수정할 때마다 반드시 올리라"고 요구한다). 하한만 확인한다. */
ck('배포: 서비스워커 캐시 버전 갱신(≥127)', Number((SW.match(/baz-cs-v(\d+)/)||[])[1]||0) >= 127);

/* 콜드스타트 회귀: 무거운 강제 호출을 직렬화하고 일시 404/HTML만 1회 재시도한다. */
const dLoad=grab(D,'loadData'), dTimeout=grab(D,'fetchTimeout'), dGvRetry=grab(D,'gvRetry'),
      hGet=grab(H,'bazGet'), hGetRetry=grab(H,'bazGetRetry'), hRefresh=H.slice(H.indexOf('window.bazRefreshAll=function'),H.indexOf('window.bazRefreshAll=function')+1800);
ck('콜드스타트: 대시보드 hospdb 완료 후 all 조회',/Promise\.resolve\(hospP\)\.then/.test(dLoad));
ck('콜드스타트: 대시보드 HTTP 오류 분류',/!r\.ok[\s\S]*kind:'http'/.test(dTimeout));
ck('콜드스타트: 대시보드 일시 오류 제한 재시도',/gasTransient_\(e\)/.test(dFetch)&&/tries>1/.test(dGvRetry));
ck('콜드스타트: 병원 화면 HTTP 오류 분류',/!r\.ok[\s\S]*kind:'http'/.test(hGet));
ck('콜드스타트: 병원 화면 일시 오류 제한 재시도',/tries>1/.test(hGetRetry)&&/bazTransient_\(e\)/.test(hGetRetry));
ck('콜드스타트: 병원 화면 bootstrap 후 all 조회',/Promise\.resolve\(bootP\)\.then/.test(hRefresh));
ck('콜드스타트: 최초 병원 화면도 bootstrap 준비를 기다림',/window\.bazBootReady=bazBootSync\(false\)/.test(H)&&/Promise\.resolve\(bootReady\)\.then/.test(hRecent));

/* 메타 경로는 GAS 전역을 작은 mock으로 대체해 실제 반환 계약도 실행한다. */
const helperNames=['syncForce_','syncRevParam_','syncMetaGet_','syncMetaPut_','syncNochange_','syncNochangeFrom_','syncCacheDrop_'];
const helperSrc=helperNames.map(n=>grab(G,n)).join('\n');
const mem={};
const helpers=new Function('Utilities','bazCacheGet_','bazCachePut_','bazCacheDrop_',
  helperSrc+'\nreturn {'+helperNames.map(n=>n+':'+n).join(',')+'};')(
  {},k=>mem[k]||null,(k,v)=>{mem[k]=v;},k=>{delete mem[k];});
helpers.syncMetaPut_('sample',{rev:'abc',updated:'2026-08-13 10:00',count:7},300);
const same=helpers.syncNochange_('sample',{rev:'abc'},'rev');
ck('P2 실행: 같은 rev면 데이터 없이 nochange',same&&same.nochange===true&&same.rev==='abc'&&same.count===7);
ck('P2 실행: 다른 rev면 전체 조회 진행',helpers.syncNochange_('sample',{rev:'def'},'rev')===null);
ck('P1 실행: force=1이면 rev가 같아도 전체 조회 진행',helpers.syncNochange_('sample',{force:'1',rev:'abc'},'rev')===null);
mem.sample='payload'; helpers.syncCacheDrop_('sample');
ck('P2 실행: 데이터 캐시와 rev 메타를 함께 무효화',!mem.sample&&!mem.sample__meta);

console.log('\n──────────────────────────────');
console.log('통과 '+pass+'/'+total);
if(fails.length){fails.forEach(f=>console.log(' -',f));process.exit(1);}
console.log('모든 테스트 통과 ✅');
