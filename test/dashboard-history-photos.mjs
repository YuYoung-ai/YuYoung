/************************************************************
 * dashboard-history-photos.mjs
 * 처리 이력 유형별 정적 예시 사진 회귀 테스트
 * 실행: node test/dashboard-history-photos.mjs
 ************************************************************/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.join(HERE,'..');
const DASH=fs.readFileSync(path.join(ROOT,'dashboard-pc.html'),'utf8');
const GAS=fs.readFileSync(path.join(ROOT,'handover_gas.gs'),'utf8');
const MANIFEST=JSON.parse(fs.readFileSync(path.join(ROOT,'assets/type-examples/index.json'),'utf8'));

let pass=0,total=0; const fails=[];
function ck(name,ok,detail){
  total++; if(ok) pass++; else fails.push(name+(detail?' — '+detail:''));
  console.log(ok?'✅':'❌',name,detail||'');
}
function grab(src,name){
  const at=src.search(new RegExp('\\bfunction\\s+'+name.replace(/[$]/g,'\\$')+'\\s*\\('));
  if(at<0) throw new Error('함수를 찾지 못했습니다: '+name);
  let depth=0;
  for(let i=src.indexOf('{',at);i<src.length;i++){
    if(src[i]==='{') depth++;
    else if(src[i]==='}'&&--depth===0) return src.slice(at,i+1);
  }
  throw new Error('본문 끝을 찾지 못했습니다: '+name);
}

const norm=new Function(grab(DASH,'exTypeExampleNorm_')+';return exTypeExampleNorm_;')();
const key=new Function(grab(DASH,'exTypeExampleNorm_')+'\n'+grab(DASH,'exTypeExampleKey_')+';return exTypeExampleKey_;')();
const asset=new Function(grab(DASH,'exTypeExampleAssetUrl_')+';return exTypeExampleAssetUrl_;')();
const dataFn=new Function(
  grab(DASH,'exTypeExampleNorm_')+'\n'+grab(DASH,'exTypeExampleLooseKey_')+'\n'+grab(DASH,'exTypeExampleKey_')+'\n'+
  grab(DASH,'exTypeExampleAssetUrl_')+'\n'+grab(DASH,'exTypeExamplePhoto_')+'\n'+
  grab(DASH,'exTypeExampleData_')+';return exTypeExampleData_;')();

ck('1. 유형 키는 대분류|유형으로 만들고 공백을 정규화한다',
  key({cat:' 장비 ',type:'노즐   누수'})==='장비|노즐 누수' && norm('  A   B ')==='A B');
ck('2. 유형이 없으면 예시 키를 만들지 않는다',key({cat:'장비',type:''})==='');
ck('3. 저장소 아래의 지원 사진·영상 형식만 허용한다',
  asset('assets/type-examples/nozzle-leak/symptom-a1.webp')!=='' &&
  asset('assets/type-examples/a/b.jpg')!=='' && asset('assets/type-examples/a/b.png')!=='' &&
  asset('assets/type-examples/media/0123456789ab.mp4')!=='');
ck('4. 경로 탈출·외부 URL·data URL을 거부한다',
  asset('../secret.webp')==='' && asset('assets/type-examples/../secret.webp')==='' &&
  asset('https://example.com/a.webp')==='' && asset('data:image/png;base64,AA')==='' &&
  asset('assets/type-examples/media/0123456789ab.mov')==='');

const sampleManifest={schema:1,items:{
  '장비|노즐 누수':{
    symptom:{src:'assets/type-examples/nozzle-leak/symptom-a1.webp',text:'누수 확인'},
    after:{src:'assets/type-examples/nozzle-leak/after-b2.webp',text:'처리 후 정상'}
  }
}};
const picked=dataFn(sampleManifest,{cat:'장비',type:'노즐 누수'});
ck('5. 매니페스트에서 증상·처리결과 두 예시를 찾는다',
  picked.symptom&&picked.symptom.desc==='누수 확인' && picked.after&&picked.after.desc==='처리 후 정상');
ck('5-b. MP4는 영상 종류로 판정한다',
  dataFn({schema:1,items:{'장비|영상':{symptom:{src:'assets/type-examples/media/0123456789ab.mp4',kind:'video',bytes:1024,duration:8}}}},
    {cat:'장비',type:'영상'}).symptom.kind==='video');
ck('6. 등록되지 않은 유형은 빈 사진 데이터로 판정한다',
  dataFn(sampleManifest,{cat:'장비',type:'미등록'}).missing===true);
ck('7. 등록 매니페스트는 9개 유형과 갱신일을 가진다',
  MANIFEST.schema===1&&MANIFEST.updatedAt==='2026-08-28'&&Object.keys(MANIFEST.items||{}).length===9);
const manifestPhotos=Object.values(MANIFEST.items||{}).flatMap(item=>[item.symptom,item.after].filter(Boolean));
ck('7-b. 매니페스트의 모든 사진 경로가 실제 WebP 파일을 가리킨다',
  manifestPhotos.length===17&&manifestPhotos.every(photo=>photo.src.endsWith('.webp')&&fs.existsSync(path.join(ROOT,photo.src))));
ck('7-c. 체결 강함·약함은 동일 원본 자산을 중복 저장하지 않는다',
  MANIFEST.items['핸드피스|노즐 체결 강함'].symptom.src===MANIFEST.items['핸드피스|노즐 체결 약함'].symptom.src);
ck('7-d. 노즐 누수는 운영 표준 표기인 "노즐 누수(약액 유입)" 키로 등록된다',
  !!MANIFEST.items['핸드피스|노즐 누수(약액 유입)']&&!MANIFEST.items['핸드피스|노즐 누수(약액유입)']);
ck('7-e. 표준 표기와 공백이 빠진 legacy 표기 모두 같은 사진으로 연결된다',
  !!dataFn(MANIFEST,{cat:'핸드피스',type:'노즐 누수(약액 유입)'}).symptom&&
  !!dataFn(MANIFEST,{cat:'핸드피스',type:'노즐 누수(약액유입)'}).symptom);

const panel=grab(DASH,'exHistoryPhotoPanel_');
const select=grab(DASH,'exSelectHistory_');
const loadExample=grab(DASH,'exLoadHistoryTypeExample_');
const toggleExample=grab(DASH,'exToggleHistoryTypeExample_');
const syncType=grab(DASH,'exSyncHistoryTypeExample_');
const show=grab(DASH,'exShowHistory_');
const table=grab(DASH,'exHistoryTable_');
ck('8. 예시자료는 절감 근거자료와 같은 미리보기 스트립을 사용한다',
  /hst-evidence-strip/.test(panel)&&/hstPhotoStrip/.test(panel)&&/exOpenTypeExampleEvidence_/.test(grab(DASH,'exHistoryPhotoThumb_')));
ck('9. 실제 기록 사진이 아닌 유형별 참고 예시임을 명시한다',
  /선택 유형 예시자료/.test(panel) && /실제 처리 기록이 아닌/.test(panel));
const viewer=grab(DASH,'exSavingEvidenceViewer_');
ck('9-b. 공통 뷰어 영상은 자동재생 없이 사용자 재생·기본 음소거·지연 로딩한다',
  /controls muted playsinline preload="none"/.test(viewer)&&!/autoplay/.test(viewer)&&
  /doc\.kind==='video'/.test(grab(DASH,'exRenderSavingEvidence_')));
ck('10. 행 선택 전에는 이미지 src와 lazy 요청이 없다',
  !/<img[^>]+src=/.test(panel) && !/loading="lazy"/.test(panel));
ck('11. 행 선택은 기록ID·물리 행 번호가 아니라 유형 키를 사용한다',
  /exLoadHistoryTypeExample_\(it\)/.test(select)&&/exTypeExampleKey_\(r\)/.test(loadExample) && !/r\.row|historyPhotoSig/.test(loadExample));
ck('12. 행 선택은 GAS 대신 정적 매니페스트를 읽는다',
  /exTypeExampleLoad_\(\)/.test(loadExample) && !/gvRetry|historyphotos|script\.google/.test(loadExample));
ck('13. 카드 클릭·모달 열기 자체에는 추가 네트워크 호출이 없다',
  !/\bfetch\s*\(|\bgv(?:Retry)?\s*\(|loadData\s*\(/.test(show));
ck('14. 유형이 있는 행만 키보드로 예시를 열 수 있다',
  /canPhoto=!!exTypeExampleKey_\(r\)/.test(table) && /tabindex="0"/.test(table));
ck('15. 늦게 도착한 매니페스트 응답은 현재 선택을 덮지 않는다',
  /seq!==EX_HISTORY_PHOTO_SEQ/.test(loadExample) && /selectedKey!==key/.test(loadExample));
ck('16. 사진 데이터 경로에 Drive·Base64·Blob이 없다',
  !/Drive|data:image|base64|getBlob/i.test(loadExample+'\n'+panel+'\n'+grab(DASH,'exHistoryPhotoThumb_')));

{
  let calls=0;
  const fakeFetch=()=>{ calls++; return Promise.resolve({ok:true,json:()=>Promise.resolve(sampleManifest)}); };
  const runtime=[
    "var EX_TYPE_EXAMPLE_URL='assets/type-examples/index.json';var EX_TYPE_EXAMPLE_PROMISE=null;",
    grab(DASH,'exTypeExampleLoad_'),
    'return exTypeExampleLoad_;'
  ].join('\n');
  const load=new Function('fetch',runtime)(fakeFetch);
  const result=await Promise.all([load(),load(),load()]);
  ck('17. 매니페스트는 페이지당 최초 1회만 요청한다',calls===1&&result[0].items===sampleManifest.items);
}

ck('18. 정적 매니페스트는 all·bootstrap·40초 폴링과 분리돼 있다',
  DASH.indexOf("EX_TYPE_EXAMPLE_URL='assets/type-examples/index.json'")>=0 &&
  !/type-examples/.test(grab(DASH,'loadData')));
ck('19. GAS에는 historyphotos 라우트·대표사진 인덱스가 없다',
  !/historyphotos|PHOTO_REP|representativePhoto/.test(GAS));
ck('20. all 응답에 사진용 물리 행 번호를 추가하지 않는다',
  /data:all\.rows\.map\(slim_\)/.test(grab(GAS,'getAll_')) && !/\.row=/.test(grab(GAS,'getAll_')));
ck('21. PC는 예시자료 2열, 모바일은 공통 가로 미리보기를 사용한다',
  /hst-photo-panel \.hst-evidence-strip\{grid-template-columns:repeat\(2/.test(DASH) &&
  /hst-evidence-strip\{display:flex;overflow-x:auto\}/.test(DASH));
ck('22. 사진 패널이 열려도 표 최소 높이와 모바일 전체 스크롤을 유지한다',
  /hst-view \.hst-table-wrap\{min-height:\d+px/.test(DASH) && /hst-view\{overflow-y:auto/.test(DASH));
/* 버전은 배포마다 올라간다 — 특정 숫자에 고정하면 다음 배포에서 반드시 깨진다 */
ck('23. 서비스워커 버전이 정적 예시 전환 이후 최신 상태다',
  Number((fs.readFileSync(path.join(ROOT,'sw.js'),'utf8').match(/baz-cs-v(\d+)/)||[])[1]||0) >= 145);
const render=grab(DASH,'exHistoryPhotoRender_');
const photoError=grab(DASH,'exHistoryPhotoError_');
ck('24. 예시가 없으면 선택 유형의 명시적인 미등록 상태를 표시한다',
  /등록된 예시자료가 없습니다/.test(render)&&/panel\.hidden=false/.test(render));
ck('25. 사진·영상은 증상·처리 결과 순서로 공통 문서 목록을 만든다',
  /push\(data&&data\.symptom,'증상 예시'\)/.test(grab(DASH,'exTypeExampleDocs_'))&&
  /push\(data&&data\.after,'처리 결과 예시'\)/.test(grab(DASH,'exTypeExampleDocs_')));
ck('26. 예시자료 본문과 토글은 기본 접힘이며 접근성 상태를 함께 제공한다',
  /id="hstPhotoBody" hidden/.test(panel)&&/id="hstPhotoToggle" aria-expanded="false"/.test(panel)&&/aria-controls="hstPhotoBody"/.test(panel));
ck('27. 매니페스트 로드 실패는 빈 사진과 구분해 안내한다',
  /exHistoryPhotoError_/.test(render) && /불러오지 못했습니다/.test(photoError) && /panel\.hidden=false/.test(photoError));
ck('28. VOC 유형 필터 선택은 접힌 제목만 전환하고 전체 선택 시 패널을 닫는다',
  /exLoadHistoryTypeExample_\(found\)/.test(syncType)&&/type==='all'/.test(syncType)&&
  /!EX_HISTORY_STATE\.typeExampleExpanded/.test(loadExample)&&/exSyncHistoryTypeExample_\(opt\.type,filtered\)/.test(grab(DASH,'exApplyHistoryFilters_')));
ck('29. 절감 근거자료와 VOC 예시자료가 동일한 전체화면 뷰어 상태를 공유한다',
  /exOpenEvidence_\(EX_SAVING_EVIDENCE/.test(grab(DASH,'exOpenSavingEvidence_'))&&
  /exOpenEvidence_\(docs/.test(grab(DASH,'exOpenTypeExampleEvidence_')));
ck('30. 토글을 펼칠 때만 선택 유형 자료를 로드하고 다시 누르면 접는다',
  /expanded=!EX_HISTORY_STATE\.typeExampleExpanded/.test(toggleExample)&&
  /if\(expanded\)\{ exLoadHistoryTypeExample_/.test(toggleExample)&&/예시자료 접기/.test(grab(DASH,'exSetHistoryPhotoExpanded_')));

console.log('\n──────────────────────────────');
console.log(`통과 ${pass}/${total}`);
if(fails.length){ console.log('실패:'); fails.forEach(f=>console.log(' -',f)); process.exit(1); }
console.log('모든 테스트 통과 ✅');
