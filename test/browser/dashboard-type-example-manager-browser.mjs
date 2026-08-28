/************************************************************
 * dashboard-pc.html · VOC 유형별 예시 사진 관리 화면 브라우저 검증
 * ----------------------------------------------------------
 * 기본 테스트 묶음(node test/*.mjs)에는 포함하지 않는다 — playwright 와 정적 서버가 필요하다.
 * Canvas/WebP 인코딩처럼 Node 에서 못 도는 구간을 여기서 실제로 돌린다.
 *
 *   npx http-server . -p 8099 -s &
 *   BASE=http://127.0.0.1:8099 node test/browser/dashboard-type-example-manager-browser.mjs
 *
 * GAS·인증 서버는 라우팅으로 가로채 가짜 응답을 준다.
 ************************************************************/
import { createRequire } from 'module';
import { execSync } from 'child_process';

let pw;
try { pw=(await import('playwright')).default; }
catch {
  const roots=[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES];
  try{roots.push(execSync('npm root -g').toString().trim());}catch{}
  for(const root of roots.filter(Boolean)){try{pw=createRequire(import.meta.url)(root+'/playwright');break;}catch{}}
}
if(!pw)throw new Error('playwright 모듈을 찾을 수 없습니다');
const {chromium}=pw,BASE=process.env.BASE||'http://127.0.0.1:8099';
let pass=0,total=0;const fails=[],errs=[];
function ck(name,cond,detail=''){total++;if(cond)pass++;else fails.push(name+(detail?' — '+detail:''));console.log(cond?'✅':'❌',name,detail);}

/* 시트에 실제로 쌓여 있는 legacy 표기(괄호 안 공백 없음)를 그대로 흉내낸다 */
const DATA=[
  {date:'2026-08-10',hosp:'A병원',gubun:'A/S',cat:'핸드피스',type:'노즐 누수(약액유입)',ncare:'미가입'},
  {date:'2026-08-11',hosp:'B병원',gubun:'A/S',cat:'노즐',type:'크랙',ncare:'미가입'},
  {date:'2026-08-12',hosp:'C병원',gubun:'A/S',cat:'장비',type:'풋스위치 작동 불량',ncare:'미가입'}
];
const KEY='노즐|크랙';
const sel=(s,slot)=>`.bte-row[data-key="${KEY}"] .bte-slot[data-slot="${slot}"] ${s}`;

const net=[];
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROME||undefined});
const ctx=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
await ctx.addInitScript(()=>{
  sessionStorage.setItem('baz_auth_token','tok-smoke');sessionStorage.setItem('baz_auth_level','3');
  sessionStorage.setItem('baz_auth_name','테스트');sessionStorage.setItem('baz_auth_expires',new Date(Date.now()+864e5).toISOString());
  sessionStorage.setItem('baz_auth_verified_ts',String(Date.now()));
  localStorage.setItem('baz_dash_view','detail');localStorage.setItem('baz_viewmode','window');
});
const page=await ctx.newPage();
page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
page.on('console',m=>{if(m.type()==='error'&&!/ERR_FAILED|ERR_ABORTED|ERR_CONNECTION/.test(m.text()))errs.push('CONSOLE: '+m.text());});
page.on('request',r=>net.push(r.url()));
page.on('dialog',d=>d.accept());
await page.route('**yuyoung-ai.deno.net/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,valid:true,level:3,name:'테스트'})}));
await page.route('**://script.google.com/**',r=>{
  const u=r.request().url();let body={success:true};
  if(u.includes('action=all'))body={success:true,data:DATA,updated:'2026-08-24 09:00'};
  else if(u.includes('action=hospdb'))body={success:true,data:[]};
  return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
});

await page.goto(BASE+'/dashboard-pc.html',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.DATA_READY===true);
await page.waitForTimeout(600);

/* ── 1. 일반 대시보드 사용에는 관리 코드·대표 사진이 실리지 않는다 ── */
const gasBefore=net.filter(u=>/script\.google/.test(u)).length;
ck('1. 관리 JS를 미리 내려받지 않는다',net.filter(u=>/type-example-manager\.js/.test(u)).length===0);
ck('2. 대표 사진·매니페스트를 선다운로드하지 않는다',
  net.filter(u=>/type-examples\//.test(u)).length===0);
ck('3. 진입 버튼이 헤더 도구 영역에 있다',await page.isVisible('#teMgrBtn'));

/* ── 2. 버튼을 눌렀을 때만 로드된다 ── */
await page.click('#teMgrBtn');
await page.waitForSelector('.bte-back .bte-row',{timeout:15000});
ck('4. 버튼을 누르면 그때 관리 JS를 한 번만 내려받는다',
  net.filter(u=>/type-example-manager\.js/.test(u)).length===1);
ck('5. 관리 화면을 여는 데 추가 GAS 요청이 없다',
  net.filter(u=>/script\.google/.test(u)).length===gasBefore);
ck('6. 매니페스트는 정적 index.json 한 번만 읽는다',
  net.filter(u=>/type-examples\/index\.json/.test(u)).length===1);

/* ── 3. 유형 목록 · loose-key 보존 ── */
const rows=await page.$$eval('.bte-row',e=>e.map(x=>x.getAttribute('data-key')));
ck('7. 시트 데이터와 index.json 유형을 합쳐 목록을 만든다',
  rows.includes(KEY)&&rows.includes('핸드피스|노즐 체결 강함')&&rows.includes('장비|풋스위치 작동 불량'));
ck('8. 공백만 다른 legacy 표기는 기존 키로 흡수돼 중복이 생기지 않는다',
  rows.filter(k=>/누수/.test(k)).join()==='핸드피스|노즐 누수(약액 유입)',rows.filter(k=>/누수/.test(k)).join());
const sum=String(await page.textContent('.bte-sum'));
ck('9. 등록 상태 4구분을 요약에 표시한다',
  ['모두 등록','증상 예시만','처리 결과 예시만','모두 미등록'].every(t=>sum.includes(t)),sum);

/* ── 4. 실제 Canvas/WebP 변환 ── */
await page.click(`.bte-row[data-key="${KEY}"] .bte-row-head`);
await page.waitForSelector(sel('input[data-act="file"]','symptom'),{state:'attached'});
const mediaAccept=await page.getAttribute(sel('input[data-act="file"]','symptom'),'accept');
ck('10-a. 파일 선택기가 사진과 MP4만 받도록 제한한다',
  /image\/\*/.test(mediaAccept||'')&&/video\/mp4/.test(mediaAccept||'')&&!/video\/\*/.test(mediaAccept||''),mediaAccept||'');
/* 압축이 잘 안 되는 큰 노이즈 PNG — 품질 하강 경로를 실제로 태운다 */
const png=await page.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=2400;c.height=1600;const x=c.getContext('2d');
  const g=x.createLinearGradient(0,0,2400,1600);g.addColorStop(0,'#f00');g.addColorStop(1,'#00f');
  x.fillStyle=g;x.fillRect(0,0,2400,1600);
  for(let i=0;i<6000;i++){x.fillStyle='rgb('+(i%255)+','+((i*7)%255)+','+((i*13)%255)+')';x.fillRect(Math.random()*2400,Math.random()*1600,16,16);}
  const b=await new Promise(r=>c.toBlob(r,'image/png'));
  return Array.from(new Uint8Array(await b.arrayBuffer()));
});
await page.setInputFiles(sel('input[data-act="file"]','symptom'),{name:'sample.png',mimeType:'image/png',buffer:Buffer.from(png)});
await page.waitForSelector(`.bte-row[data-key="${KEY}"].changed`,{timeout:30000});
const meta=String(await page.textContent(sel('.bte-meta','symptom'))).replace(/\s+/g,' ');
ck('10. 원본·변환 파일 크기와 해상도를 함께 보여준다',
  /원본 sample\.png · 2\.\d+MB · 2400×1600/.test(meta)&&/변환 WebP · \d+KB · 1200×800/.test(meta),meta);
const conv=await page.evaluate(k=>{
  const c=window.BazTypeExampleManager._state.changes[k].symptom;
  return {bytes:c.bytes,w:c.width,h:c.height,src:c.src,type:c.blob.type,over:c.over};
},KEY);
ck('11. 출력은 WebP · 긴 변 1200px 이하 · 확대 없음',
  conv.type==='image/webp'&&Math.max(conv.w,conv.h)===1200,JSON.stringify(conv));
ck('12. 목표 용량 300KB 이하로 맞춘다',conv.bytes<=300*1024&&conv.over===false,conv.bytes+'B');
ck('13. 저장 경로는 내용 해시 12자리 WebP 다',
  /^assets\/type-examples\/media\/[0-9a-f]{12}\.webp$/.test(conv.src),conv.src);
const rehash=await page.evaluate(async k=>{
  const M=window.BazTypeExampleManager,c=M._state.changes[k].symptom;
  return M.mediaPath(await M.sha256Hex12(await c.blob.arrayBuffer()));
},KEY);
ck('14. 경로는 변환 결과 바이트의 SHA-256 에서 나온다',rehash===conv.src,rehash);

/* ── 5. 매니페스트 갱신 · 검증 ── */
await page.fill(sel('input[data-act="text"]','symptom'),'노즐 크랙 예시');
const plan=await page.evaluate(()=>{
  const M=window.BazTypeExampleManager,S=M._state;
  const next=M.applyChanges(S.manifest,S.changes,M.todayLocal());
  const writes=M.planWrites(S.changes);
  return {v:M.validateManifest(next,{newFiles:writes.map(w=>w.path)}),
    writes:writes.map(w=>w.path),items:next.items,updatedAt:next.updatedAt,
    baseCount:Object.keys(S.manifest.items).length,
    baseNozzleAfter:S.manifest.items['핸드피스|노즐 누수(약액 유입)'].after.src,
    json:M.serializeManifest(next)};
});
ck('15. 갱신된 매니페스트가 검증을 통과한다',plan.v.ok===true,plan.v.errors.join(' | '));
ck('16. 기존 항목을 모두 보존하고 바꾼 슬롯만 갱신한다',
  Object.keys(plan.items).length===plan.baseCount+1&&
  plan.items['핸드피스|노즐 누수(약액 유입)'].after.src===plan.baseNozzleAfter&&
  plan.items[KEY].symptom.src===conv.src&&plan.items[KEY].symptom.text==='노즐 크랙 예시');
ck('17. updatedAt 은 오늘 로컬 날짜다',
  plan.updatedAt===new Date().toLocaleDateString('sv-SE'),plan.updatedAt);
ck('18. JSON 은 2칸 들여쓰기 · 끝 개행이다',
  plan.json.split('\n')[1].startsWith('  "')&&plan.json.endsWith('}\n'));

/* 같은 사진을 다른 유형에 한 번 더 올리면 경로가 같고 파일은 하나만 쓴다 */
await page.click('.bte-row[data-key="장비|풋스위치 작동 불량"] .bte-row-head');
await page.waitForSelector('.bte-row[data-key="장비|풋스위치 작동 불량"] .bte-slot[data-slot="after"] input[data-act="file"]',{state:'attached'});
await page.setInputFiles('.bte-row[data-key="장비|풋스위치 작동 불량"] .bte-slot[data-slot="after"] input[data-act="file"]',
  {name:'sample.png',mimeType:'image/png',buffer:Buffer.from(png)});
await page.waitForSelector('.bte-row[data-key="장비|풋스위치 작동 불량"].changed',{timeout:30000});
const dedupe=await page.evaluate(()=>{
  const M=window.BazTypeExampleManager;
  return M.planWrites(M._state.changes).map(w=>w.path);
});
ck('19. 같은 변환 결과는 같은 경로를 쓰고 파일을 중복 저장하지 않는다',
  dedupe.length===1&&dedupe[0]===conv.src,JSON.stringify(dedupe));

/* ── 6. 저장(다운로드 폴백) ── */
const dls=[];page.on('download',d=>dls.push(d.suggestedFilename()));
await page.click('.bte-foot [data-act="download"]');
await page.waitForTimeout(3000);
ck('20. 새 WebP 와 index.json 을 내려받고 index.json 이 마지막이다',
  dls.length===2&&dls[0]===conv.src.split('/').pop()&&dls[1]==='index.json',JSON.stringify(dls));
const after=String(await page.textContent('.bte-msg')).replace(/\s+/g,' ');
ck('21. 어느 저장소 경로에 넣어야 하는지 안내한다',
  after.includes('assets/type-examples/media/')&&after.includes('assets/type-examples/index.json'));
ck('22. 커밋 안내로 끝난다',after.includes('변경 파일을 확인한 뒤 커밋'));

/* 용량 초과 영상은 메타데이터를 읽거나 기존 상태를 바꾸기 전에 거절한다 */
await page.waitForSelector(sel('input[data-act="file"]','after'),{state:'attached'});
await page.setInputFiles(sel('input[data-act="file"]','after'),{
  name:'too-large.mp4',mimeType:'video/mp4',buffer:Buffer.alloc(5*1024*1024+1)
});
await page.waitForFunction(()=>document.querySelector('.bte-msg')?.textContent.includes('5MB'));
const videoReject=await page.evaluate(k=>({
  message:document.querySelector('.bte-msg')?.textContent||'',
  changed:!!window.BazTypeExampleManager._state.changes[k]?.after
}),KEY);
ck('22-a. 5MB 초과 MP4를 거절하고 기존 선택 상태를 보존한다',
  /변환 실패/.test(videoReject.message)&&/5MB/.test(videoReject.message)&&videoReject.changed===false,
  JSON.stringify(videoReject));

/* 사진 4장을 서버 전송 없이 한 장의 보고서형 WebP로 합성한다 */
const collageInput=sel('input[data-act="collage-file"]','after');
await page.waitForSelector(collageInput,{state:'attached'});
const collageAccept=await page.getAttribute(collageInput,'accept');
ck('22-b. 합성 선택기는 사진만 받고 여러 장 선택을 허용한다',
  await page.locator(collageInput).getAttribute('multiple')!==null&&!/video/.test(collageAccept||''),collageAccept||'');
await page.setInputFiles(collageInput,[0,1,2,3].map(i=>({name:`collage-${i+1}.png`,mimeType:'image/png',buffer:Buffer.from(png)})));
await page.waitForSelector('.bte-collage:not([hidden])',{timeout:30000});
ck('22-c. 사진 선택 후 자동 합성하지 않고 수동 조정 미리보기를 먼저 연다',
  await page.locator('.bte-collage canvas').isVisible()&&await page.locator('.bte-order-item').count()===4);
await page.click('.bte-order-item[data-index="0"] [data-act="collage-next"]');
await page.click('[data-act="collage-right"]');
await page.locator('[data-act="collage-zoom"]').fill('145');
await page.click('[data-act="collage-rotate"]');
const manual=await page.evaluate(()=>{
  const C=window.BazTypeExampleManager._state.collage,i=C.items[C.selected];
  return {order:C.items.map(x=>x.file.name),selected:C.selected,x:i.x,zoom:i.zoom,rotation:i.rotation};
});
ck('22-d. 순서·위치·확대·회전 수동 조정값이 미리보기에 반영된다',
  manual.order[0]==='collage-2.png'&&manual.order[1]==='collage-1.png'&&manual.selected===1&&manual.x>0&&manual.zoom===1.45&&manual.rotation===90,
  JSON.stringify(manual));
await page.click('[data-act="collage-apply"]');
await page.waitForFunction(()=>document.querySelector('.bte-msg')?.textContent.includes('합성 완료'),null,{timeout:30000});
const collage=await page.evaluate(k=>{
  const c=window.BazTypeExampleManager._state.changes[k].after;
  return {collage:c.collage,manual:c.manual,count:c.sourceCount,w:c.width,h:c.height,bytes:c.bytes,type:c.blob.type,src:c.src};
},KEY);
ck('22-e. 수동 배치한 사진 4장을 1200×900 이하·300KB 목표의 단일 해시 WebP로 생성한다',
  collage.collage&&collage.manual&&collage.count===4&&collage.w===1200&&collage.h===900&&collage.bytes<=300*1024&&
  collage.type==='image/webp'&&/^assets\/type-examples\/media\/[0-9a-f]{12}\.webp$/.test(collage.src),JSON.stringify(collage));
const collageMeta=String(await page.textContent(sel('.bte-meta','after'))).replace(/\s+/g,' ');
ck('22-f. 합성 원본 장수·수동 배치와 결과 크기·해상도를 화면에 표시한다',
  /합성 원본 4장/.test(collageMeta)&&/수동 배치/.test(collageMeta)&&/변환 WebP/.test(collageMeta)&&/1200×900/.test(collageMeta),collageMeta);

/* ── 7. 필터 · 레이아웃 · 격리 ── */
await page.selectOption('.bte-tools [data-act="cat"]','장비');
await page.waitForTimeout(150);
const catRows=await page.$$eval('.bte-row',e=>e.map(x=>x.getAttribute('data-key')));
ck('23. 대분류 필터가 동작한다',catRows.length>0&&catRows.every(k=>k.startsWith('장비|')));
await page.selectOption('.bte-tools [data-act="cat"]','');
await page.fill('.bte-tools [data-act="query"]','스프링');
await page.waitForTimeout(150);
ck('24. 유형 검색이 동작한다',(await page.$$eval('.bte-row',e=>e.map(x=>x.getAttribute('data-key')))).join()==='핸드피스|스프링 파손');
await page.fill('.bte-tools [data-act="query"]','');
await page.check('.bte-tools [data-act="missing"]');
await page.waitForTimeout(150);
const missing=await page.$$eval('.bte-row .bte-state',e=>e.map(x=>x.className));
ck('25. 미등록만 보기가 동작한다',missing.length>0&&missing.every(c=>!/s-both/.test(c)));
await page.uncheck('.bte-tools [data-act="missing"]');

await page.setViewportSize({width:420,height:840});
await page.waitForTimeout(250);
ck('26. 모바일에서 사진 두 칸이 한 열로 바뀐다',
  await page.evaluate(()=>getComputedStyle(document.querySelector('.bte-slots')).gridTemplateColumns.split(' ').length===1));
await page.setViewportSize({width:1440,height:900});

const dashBefore=await page.textContent('#metaLine');
await page.click('.bte-x');
await page.waitForTimeout(400);
ck('27. 닫으면 오버레이만 사라진다',await page.$eval('.bte-back',e=>e.style.display)==='none');
ck('28. 관리 화면을 닫아도 대시보드 상태가 그대로다',
  (await page.textContent('#metaLine'))===dashBefore&&await page.isVisible('#app'));
ck('29. 관리 화면을 쓰는 동안 추가 GAS 요청이 없었다',
  net.filter(u=>/script\.google|googleusercontent|drive\.google/.test(u)).length===gasBefore);
ck('30. 런타임 오류가 없다',errs.length===0,errs.join(' | '));

if(process.env.SHOT)await page.screenshot({path:process.env.SHOT});
await browser.close();
console.log('\n──────────────────────────────');
console.log(`통과 ${pass}/${total}`);
if(fails.length){console.log('실패:');fails.forEach(f=>console.log(' -',f));process.exit(1);}
console.log('모든 테스트 통과 ✅');
