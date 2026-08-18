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
  grab(DASH,'exTypeExampleNorm_')+'\n'+grab(DASH,'exTypeExampleKey_')+'\n'+
  grab(DASH,'exTypeExampleAssetUrl_')+'\n'+grab(DASH,'exTypeExamplePhoto_')+'\n'+
  grab(DASH,'exTypeExampleData_')+';return exTypeExampleData_;')();

ck('1. 유형 키는 대분류|유형으로 만들고 공백을 정규화한다',
  key({cat:' 장비 ',type:'노즐   누수'})==='장비|노즐 누수' && norm('  A   B ')==='A B');
ck('2. 유형이 없으면 예시 키를 만들지 않는다',key({cat:'장비',type:''})==='');
ck('3. 저장소 아래의 지원 이미지 형식만 허용한다',
  asset('assets/type-examples/nozzle-leak/symptom-a1.webp')!=='' &&
  asset('assets/type-examples/a/b.jpg')!=='' && asset('assets/type-examples/a/b.png')!=='');
ck('4. 경로 탈출·외부 URL·data URL을 거부한다',
  asset('../secret.webp')==='' && asset('assets/type-examples/../secret.webp')==='' &&
  asset('https://example.com/a.webp')==='' && asset('data:image/png;base64,AA')==='');

const sampleManifest={schema:1,items:{
  '장비|노즐 누수':{
    symptom:{src:'assets/type-examples/nozzle-leak/symptom-a1.webp',text:'누수 확인'},
    after:{src:'assets/type-examples/nozzle-leak/after-b2.webp',text:'처리 후 정상'}
  }
}};
const picked=dataFn(sampleManifest,{cat:'장비',type:'노즐 누수'});
ck('5. 매니페스트에서 증상·처리결과 두 예시를 찾는다',
  picked.symptom&&picked.symptom.desc==='누수 확인' && picked.after&&picked.after.desc==='처리 후 정상');
ck('6. 등록되지 않은 유형은 빈 사진 데이터로 판정한다',
  dataFn(sampleManifest,{cat:'장비',type:'미등록'}).missing===true);
ck('7. 등록 매니페스트는 9개 유형과 갱신일을 가진다',
  MANIFEST.schema===1&&MANIFEST.updatedAt==='2026-08-18'&&Object.keys(MANIFEST.items||{}).length===9);
const manifestPhotos=Object.values(MANIFEST.items||{}).flatMap(item=>[item.symptom,item.after].filter(Boolean));
ck('7-b. 매니페스트의 모든 사진 경로가 실제 WebP 파일을 가리킨다',
  manifestPhotos.length===15&&manifestPhotos.every(photo=>photo.src.endsWith('.webp')&&fs.existsSync(path.join(ROOT,photo.src))));
ck('7-c. 체결 강함·약함은 동일 원본 자산을 중복 저장하지 않는다',
  MANIFEST.items['핸드피스|노즐 체결 강함'].symptom.src===MANIFEST.items['핸드피스|노즐 체결 약함'].symptom.src);

const panel=grab(DASH,'exHistoryPhotoPanel_');
const select=grab(DASH,'exSelectHistory_');
const show=grab(DASH,'exShowHistory_');
const table=grab(DASH,'exHistoryTable_');
ck('8. PC·모바일 공용 패널은 증상·처리결과 각 한 칸이다',
  (panel.match(/hstPhotoSymptom"/g)||[]).length===1 && (panel.match(/hstPhotoAfter"/g)||[]).length===1);
ck('9. 실제 기록 사진이 아닌 유형별 참고 예시임을 명시한다',
  /유형별 참고 예시/.test(panel) && /실제 처리 기록 사진이 아닌/.test(panel));
ck('10. 행 선택 전에는 이미지 src와 lazy 요청이 없다',
  !/<img[^>]+src=/.test(panel) && !/loading="lazy"/.test(panel));
ck('11. 행 선택은 기록ID·물리 행 번호가 아니라 유형 키를 사용한다',
  /exTypeExampleKey_\(r\)/.test(select) && !/r\.row|historyPhotoSig/.test(select));
ck('12. 행 선택은 GAS 대신 정적 매니페스트를 읽는다',
  /exTypeExampleLoad_\(\)/.test(select) && !/gvRetry|historyphotos|script\.google/.test(select));
ck('13. 카드 클릭·모달 열기 자체에는 추가 네트워크 호출이 없다',
  !/\bfetch\s*\(|\bgv(?:Retry)?\s*\(|loadData\s*\(/.test(show));
ck('14. 유형이 있는 행만 키보드로 예시를 열 수 있다',
  /canPhoto=!!exTypeExampleKey_\(r\)/.test(table) && /tabindex="0"/.test(table));
ck('15. 늦게 도착한 매니페스트 응답은 현재 선택을 덮지 않는다',
  /seq!==EX_HISTORY_PHOTO_SEQ/.test(select) && /selectedKey!==key/.test(select));
ck('16. 사진 데이터 경로에 Drive·Base64·Blob이 없다',
  !/Drive|data:image|base64|getBlob/i.test(select+'\n'+panel+'\n'+grab(DASH,'exHistoryPhotoSlot_')));

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
ck('21. PC는 사진 2열, 모바일은 1열 레이아웃을 유지한다',
  /hst-photo-grid\{display:grid;grid-template-columns:repeat\(2/.test(DASH) &&
  /hst-photo-grid\{grid-template-columns:1fr/.test(DASH));
ck('22. 사진 패널이 열려도 표 최소 높이와 모바일 전체 스크롤을 유지한다',
  /hst-view \.hst-table-wrap\{min-height:\d+px/.test(DASH) && /hst-view\{overflow-y:auto/.test(DASH));
ck('23. 서비스워커 버전이 정적 예시 전환으로 갱신됐다',/baz-cs-v144/.test(fs.readFileSync(path.join(ROOT,'sw.js'),'utf8')));
const render=grab(DASH,'exHistoryPhotoRender_');
const loading=grab(DASH,'exHistoryPhotoLoading_');
const photoError=grab(DASH,'exHistoryPhotoError_');
ck('24. 사진이 둘 다 없으면 사진 패널 전체를 숨긴다',
  /!symptom&&!after/.test(render) && /panel\.hidden=true/.test(render));
ck('25. 사진이 한 장뿐이면 없는 카드만 숨기고 한 열로 넓힌다',
  /symptomCard\.hidden=!symptom/.test(render) && /afterCard\.hidden=!after/.test(render) && /classList\.toggle\('single'/.test(render));
ck('26. 사진 유무 확인 전에는 빈 패널을 노출하지 않는다',/panel\.hidden=true/.test(loading));
ck('27. 매니페스트 로드 실패는 빈 사진과 구분해 안내한다',
  /exHistoryPhotoError_/.test(render) && /grid\.hidden=true/.test(photoError) && /panel\.hidden=false/.test(photoError));

console.log('\n──────────────────────────────');
console.log(`통과 ${pass}/${total}`);
if(fails.length){ console.log('실패:'); fails.forEach(f=>console.log(' -',f)); process.exit(1); }
console.log('모든 테스트 통과 ✅');
