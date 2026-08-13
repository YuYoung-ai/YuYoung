/************************************************************
 * gas-sync-p0.mjs
 * GAS 호출·새로고침 P0 회귀 테스트
 * 실행: node test/gas-sync-p0.mjs
 ************************************************************/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const read=n=>fs.readFileSync(path.join(HERE,'..',n),'utf8');
const D=read('dashboard-pc.html');
const H=read('hospital-pc.html');
const O=read('handover.html');

let pass=0,total=0; const fails=[];
function ck(name,cond){ total++; if(cond){pass++;console.log('✅',name);}else{fails.push(name);console.log('❌',name);} }
function grab(src,name){
  const at=src.search(new RegExp('\\b(?:async\\s+)?function\\s+'+name.replace(/[$]/g,'\\$&')+'\\s*\\('));
  if(at<0) throw new Error('함수를 찾지 못했습니다: '+name);
  let depth=0;
  for(let j=src.indexOf('{',at);j<src.length;j++){
    if(src[j]==='{') depth++;
    else if(src[j]==='}'&&--depth===0) return src.slice(at,j+1);
  }
  throw new Error('함수 끝을 찾지 못했습니다: '+name);
}
function inlineSyntax(name,src){
  const scripts=[...src.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(m=>m[1]).filter(s=>s.trim());
  scripts.forEach(s=>new Function(s));
  ck(name+' 인라인 JavaScript 문법',scripts.length>0);
}

inlineSyntax('dashboard-pc',D);
inlineSyntax('hospital-pc',H);
inlineSyntax('handover',O);

const dLoad=grab(D,'loadData'),dBoot=grab(D,'boot'),dHosp=grab(D,'loadHospDB'),dGv=grab(D,'gv');
ck('대시보드: 연속 새로고침은 진행 중 Promise 공유',/if\(DASH_LOAD_IN_FLIGHT\) return DASH_LOAD_IN_FLIGHT/.test(dLoad));
ck('대시보드: 전체 로드당 병원 DB 호출 지점 1개',(dLoad.match(/loadHospDB\(/g)||[]).length===1);
ck('대시보드: 캐시·시트 boot에서 병원 DB 재호출 없음',!/\bloadHospDB\(/.test(dBoot));
ck('대시보드: 병원 DB 요청도 진행 중 Promise 공유',/if\(HOSPDB_IN_FLIGHT\) return HOSPDB_IN_FLIGHT/.test(dHosp));
ck('대시보드: 보조 GAS 조회에도 20초 타임아웃',/fetchTimeout\(_u, 20000\)/.test(dGv));
ck('대시보드: 수동 갱신 성공은 전체+병원 DB 완료 후 표시',
  /Promise\.all\(\[allP,hospP\]\)/.test(dLoad)&&/if\(force\) toast\(v\[0\]&&v\[1\]!==false/.test(dLoad));

const hBoot=grab(H,'bazBootSync'),hPull=grab(H,'pcProgPull'),
      hCycle=grab(H,'pcPollCycle_'),hRecent=grab(H,'pcLoadRecent');
ck('병원 화면: 새로고침 버튼은 실제 Promise 완료를 기다림',
  /Promise\.resolve\(window\.bazRefreshAll\(\)\)\.then/.test(H)&&!/setTimeout\(done,\s*900\)/.test(H));
ck('병원 화면: 새로고침은 주요 GAS 결과를 한 번에 판정',
  /return Promise\.all\(\[bootP,visitP,recentP\]\)/.test(H));
ck('병원 화면: bootstrap 폴백은 구버전일 때만 실행',
  /if\(e && e\.kind==='bootstrap-unsupported'\)/.test(hBoot)&&/동기화 실패 — 캐시 유지/.test(hBoot));
ck('병원 화면: bootstrap 중복 요청 방지',
  /if\(BAZ_BOOT_IN_FLIGHT\) return BAZ_BOOT_IN_FLIGHT/.test(hBoot));
ck('병원 화면: progress 폴링 중복 요청 방지',
  /if\(pcProgInFlight\) return pcProgInFlight/.test(hPull));
ck('병원 화면: 다음 폴링은 현재 요청 종료 후 예약',
  /then\(function\(v\)\{\s*pcPollCycleInFlight=null; pcPollSchedule\(\)/.test(hCycle));
ck('병원 화면: 최근 처리 전체 조회도 Promise 공유',
  /return pcRecentPromise\|\|Promise\.resolve\(false\)/.test(hRecent));
ck('병원 화면: 첫 폴링도 동일한 직렬 실행 경로 사용',
  /setTimeout\(pcProgWake, 250\)/.test(H)&&!/setTimeout\(pcProgPull, 250\)/.test(H));

const oBoot=grab(O,'bootHandover'),oTpl=grab(O,'loadContentTpl');
ck('인계 화면: 부팅 시 별도 ping 중복 호출 제거',!/\bgasPing\(/.test(oBoot));
ck('인계 화면: 네트워크·타임아웃 실패 시 개별 호출 증폭 없음',
  oBoot.indexOf("if(res.kind!=='json')")>=0&&oBoot.indexOf('loadLiveDB()')>oBoot.indexOf("if(res.kind!=='json')"));
ck('인계 화면: 통합 API 미지원 구버전만 호환 폴백',
  /bootstrap 미지원[\s\S]*Promise\.all\(\[loadLiveDB\(\),masterSync\(\),loadContentTpl\(\)\]\)/.test(oBoot));
ck('인계 화면: 템플릿 2개 호출 완료를 추적 가능',
  /return Promise\.all\(\[tpl,auto\]\)/.test(oTpl));

console.log('\n──────────────────────────────');
console.log('통과 '+pass+'/'+total);
if(fails.length){fails.forEach(f=>console.log(' -',f));process.exit(1);}
console.log('모든 테스트 통과 ✅');
