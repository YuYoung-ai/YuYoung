/************************************************************
 * 추정 교체비용 절감액 근거자료 회귀 테스트
 * 실행: node test/dashboard-saving-evidence.mjs
 ************************************************************/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.join(HERE,'..');
const SRC=fs.readFileSync(path.join(ROOT,'dashboard-pc.html'),'utf8');
const SW=fs.readFileSync(path.join(ROOT,'sw.js'),'utf8');
let pass=0,total=0;const fails=[];
function ck(name,cond,detail=''){total++;if(cond)pass++;else fails.push(name+(detail?' — '+detail:''));console.log(cond?'✅':'❌',name,detail);}
function grab(name){
  const at=SRC.search(new RegExp('\\bfunction\\s+'+name.replace(/[$]/g,'\\$')+'\\s*\\('));
  if(at<0)throw new Error('함수 없음: '+name);let depth=0;
  for(let j=SRC.indexOf('{',at);j<SRC.length;j++){
    if(SRC[j]==='{')depth++;else if(SRC[j]==='}'&&--depth===0)return SRC.slice(at,j+1);
  }throw new Error('함수 끝 없음: '+name);
}

const names=[1,2,3,4].map(n=>'handpiece-quality-review-0'+n+'.png');
const files=names.map(n=>path.join(ROOT,'assets','cleaning-evidence',n));
ck('1. 근거자료 PNG 4장이 저장소에 존재',files.every(fs.existsSync));
const meta=files.map((f,i)=>{const b=fs.readFileSync(f);return {name:names[i],png:b.slice(1,4).toString()==='PNG',w:b.readUInt32BE(16),h:b.readUInt32BE(20),size:b.length};});
ck('2. 네 자료 모두 원본 1322×748 PNG를 보존',meta.every(x=>x.png&&x.w===1322&&x.h===748),JSON.stringify(meta));
ck('3. 근거자료 전체 용량은 초기 로딩에 부담이 없는 1.5MB 미만',meta.reduce((s,x)=>s+x.size,0)<1500000);

const htmlFn=grab('exSavingEvidenceHtml_'), showFn=grab('exShowHistory_');
ck('4. 절감액 처리 이력에만 상단 근거자료 영역을 추가',
  showFn.includes("dim==='kpiSaving'?exSavingEvidenceHtml_():''")&&htmlFn.includes('절감액 산정 근거자료'));
ck('5. 미리보기 4장은 lazy·비동기 디코딩으로 실제 이력 열람 시 로드',
  /loading="lazy" decoding="async"/.test(htmlFn)&&!SW.includes('handpiece-quality-review'));
ck('6. 281,208원 근거와 대시보드 281,200원 절사 기준을 함께 명시',
  htmlFn.includes('281,200원')&&htmlFn.includes('281,208원 절사'));
ck('7. 전체화면 뷰어는 이전·다음·원본·전체화면·닫기를 제공',
  ['exStepSavingEvidence_(-1)','exStepSavingEvidence_(1)','원본 열기','exToggleSavingEvidenceFullscreen_()','exCloseSavingEvidence_()']
    .every(x=>grab('exSavingEvidenceViewer_').includes(x)));
ck('8. Escape·좌우 방향키로 뷰어를 조작',
  ['Escape','ArrowLeft','ArrowRight'].every(x=>grab('exSavingEvidenceKey_').includes(x)));
ck('9. 뷰어를 닫으면 전체화면·문서 스크롤 상태와 이미지 요청을 정리',
  grab('exCloseSavingEvidence_').includes('document.exitFullscreen')&&grab('exCloseSavingEvidence_').includes("classList.remove('hst-evidence-open')")
  &&grab('exCloseSavingEvidence_').includes("removeAttribute('src')"));
const tileFn=grab('ycKpiTile_'), barFn=grab('ycBarHtml_');
ck('10. 연간 비교 절감액 카드도 같은 근거자료 뷰어를 여는 버튼',
  tileFn.includes('yc-kpi-evidence')&&tileFn.includes('exOpenSavingEvidence_(0)')
  &&/ycKpiTile_\('추정 교체비용 절감액',[\s\S]*?,true,true\)/.test(barFn));
ck('11. PC 전체화면 오버레이와 모바일 가로 미리보기 레이아웃 존재',
  /\.hst-evidence-viewer\{position:fixed;inset:0;z-index:80/.test(SRC)
  &&/@media\(max-width:820px\)[\s\S]*?\.hst-evidence-strip\{display:flex;overflow-x:auto\}/.test(SRC));
ck('12. 서비스워커 캐시 버전을 v153으로 갱신',SW.includes("CACHE_VERSION = 'baz-cs-v153'"));

console.log('\n──────────────────────────────');console.log(`통과 ${pass}/${total}`);
if(fails.length){console.log('실패:');fails.forEach(x=>console.log(' -',x));process.exit(1);}console.log('모든 테스트 통과 ✅');
