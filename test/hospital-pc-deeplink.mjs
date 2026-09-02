/************************************************************
 * hospital-pc-deeplink.mjs
 * 대시보드 → hospital-pc.html?hosp=… 딥링크 회귀 테스트
 * 실행: node test/hospital-pc-deeplink.mjs
 * ----------------------------------------------------------
 * 무빌드 헤드리스. hospital-pc.html 원문에서 함수를 꺼내 실행한다
 * (test/hospital-pc-map-integrity.mjs 와 같은 방식).
 *
 * 커버리지
 *   · 한글·공백·괄호가 든 병원명 정확 일치
 *   · 일치 없음 / 정규화 후 2곳 이상(임의 선택 금지)
 *   · bazBootReady 지연·reject 에도 화면이 막히지 않음
 *   · 같은 병원 모달이 이미 열려 있으면 다시 열지 않음
 *   · 다른 모달이 열려 있으면 정리 후 이력만 열기
 *   · 새로고침(같은 쿼리 재실행)에도 1회만 실행
 *   · 편집 비밀번호 화면이 자동으로 열리지 않음
 *   · sw.js 캐시 버전 상승 + 쿼리스트링 내비게이션 오프라인 폴백
 ************************************************************/
import fs from 'node:fs';
import assert from 'node:assert/strict';

const SRC=fs.readFileSync(new URL('../hospital-pc.html',import.meta.url),'utf8');
const SW=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');

function grab(name){
  const at=SRC.search(new RegExp('\\b(?:async\\s+)?function\\s+'+name+'\\s*\\('));
  assert.ok(at>=0,name);
  let depth=0;
  for(let i=SRC.indexOf('{',at);i<SRC.length;i++){
    if(SRC[i]==='{') depth++;
    else if(SRC[i]==='}'&&!--depth) return SRC.slice(at,i+1);
  }
  throw new Error(name);
}
const FNS=['normalize','pcDeepLinkName_','pcDeepLinkHistOnly_','pcSetHistOnly_','pcDeepLinkMatch_',
  'pcDeepLinkResolve_','pcDeepLinkNoticeText_','pcDeepLinkNotice_','pcDeepLinkOpen_','pcRunDeepLink_'];

/* 최소 DOM·모달 스텁 — 실제 페이지 부팅 없이 딥링크 경로만 실행한다 */
function build(){
  const log={opened:[],closed:0,announced:[],notice:[],pw:0};
  const ctx=new Function(`
var HOSPITALS=[],histCurName=null,PC_DEEPLINK_DONE=false;
var log=arguments[0];
var body={appendChild:function(){}};
var nodes={};
function el(tag){return {tagName:tag,id:'',className:'',hidden:false,textContent:'',type:'',children:[],
  setAttribute:function(){},addEventListener:function(){},appendChild:function(c){this.children.push(c);}};}
var bodyCls={};
body.classList={add:function(c){bodyCls[c]=1;},remove:function(c){delete bodyCls[c];},
  toggle:function(c,on){ if(on===undefined) on=!bodyCls[c]; if(on)bodyCls[c]=1; else delete bodyCls[c]; },
  contains:function(c){return !!bodyCls[c];}};
var document={body:body,getElementById:function(id){return nodes[id]||null;},createElement:el};
var window={};
var location={search:''};
var console={warn:function(){},log:function(){},info:function(){}};
function bazAnnounce(m){log.announced.push(m);}
var modalStack=[];
var BazModal={
  isOpen:function(m){return modalStack.indexOf(m)>=0;},
  openCount:function(){return modalStack.length;},
  closeTop:function(){ if(!modalStack.length) return false; modalStack.pop(); log.closed++; return true; },
  open:function(m){ if(modalStack.indexOf(m)<0) modalStack.push(m); }
};
function openHist(name){ histCurName=name; BazModal.open(nodes.histModal); log.opened.push(name); }
function openHistPw(){ log.pw++; }
`+FNS.map(grab).join('\n')+`
return {
  set:function(list){HOSPITALS=list;},
  nodes:nodes, modalStack:modalStack,
  loc:location, win:window, histOnly:function(){return body.classList.contains('hist-only');},
  reset:function(){PC_DEEPLINK_DONE=false;histCurName=null;modalStack.length=0;},
  done:function(){return PC_DEEPLINK_DONE;},
  histName:function(){return histCurName;},
  ${FNS.join(',')}
};
`)(log);
  ctx.nodes.histModal={id:'histModal'};
  ctx.nodes.histPwModal={id:'histPwModal'};
  ctx.log=log;
  return ctx;
}

let count=0;
const ck=(label,fn)=>{fn();count++;console.log('✅ '+label);};
const ckA=async(label,fn)=>{await fn();count++;console.log('✅ '+label);};

const LIST=[{n:'서울 성모 병원'},{n:'가나(본원) 의원'},{n:'중복병원'},{n:'중복 병원'},{n:'가나의원'}];

/* ── 1. 파라미터 파싱 ── */
ck('1. encodeURIComponent 한글·공백·괄호를 원래 병원명으로 되돌린다',()=>{
  const D=build();
  assert.equal(D.pcDeepLinkName_('?hosp='+encodeURIComponent('가나(본원) 의원')),'가나(본원) 의원');
  assert.equal(D.pcDeepLinkName_('?a=1&hosp='+encodeURIComponent('서울 성모 병원')+'&b=2'),'서울 성모 병원');
  assert.equal(D.pcDeepLinkName_('?hosp=%EA%B0%80%EB%82%98'),'가나');
  assert.equal(D.pcDeepLinkName_('?hosp=서울+성모+병원'),'서울 성모 병원');
});
ck('2. hosp 파라미터가 없거나 비면 빈 문자열 — 딥링크를 실행하지 않는다',()=>{
  const D=build();
  assert.equal(D.pcDeepLinkName_(''),'');
  assert.equal(D.pcDeepLinkName_('?x=1'),'');
  assert.equal(D.pcDeepLinkName_('?hosp='),'');
  assert.equal(D.pcDeepLinkName_('?hosp=%20%20'),'');
});
ck('3. 깨진 퍼센트 인코딩에도 예외 없이 원문을 그대로 쓴다',()=>{
  const D=build();
  assert.equal(D.pcDeepLinkName_('?hosp=%E0%A4%A'),'%E0%A4%A');
});

/* ── 2. 정확 일치 판정 ── */
ck('4. 공백만 다른 병원명도 기존 정규화 규칙으로 정확히 일치',()=>{
  const D=build();
  assert.equal(D.pcDeepLinkResolve_(LIST,'서울성모병원').status,'ok');
  assert.equal(D.pcDeepLinkResolve_(LIST,'서울 성모 병원').name,'서울 성모 병원');
  assert.equal(D.pcDeepLinkResolve_(LIST,'가나(본원) 의원').name,'가나(본원) 의원');
});
ck('5. 부분 일치로 다른 지점을 추정하지 않는다',()=>{
  const D=build();
  assert.equal(D.pcDeepLinkResolve_(LIST,'성모').status,'none');
  assert.equal(D.pcDeepLinkResolve_(LIST,'가나').status,'none');
  assert.equal(D.pcDeepLinkResolve_([{n:'가나의원 2호점'}],'가나의원').status,'none');
});
ck('6. 정규화 후 2곳 이상이면 임의로 고르지 않고 중복으로 알린다',()=>{
  const D=build();
  const r=D.pcDeepLinkResolve_(LIST,'중복 병원');
  assert.equal(r.status,'duplicate');
  assert.equal(r.names.length,2);
  assert.ok(!r.name);
  assert.match(D.pcDeepLinkNoticeText_(r),/2곳/);
});
ck('7. 일치 없음·중복 안내 문구에 조회한 이름이 담긴다',()=>{
  const D=build();
  assert.match(D.pcDeepLinkNoticeText_(D.pcDeepLinkResolve_(LIST,'없는병원')),/없는병원/);
  assert.match(D.pcDeepLinkNoticeText_({status:'boot',query:'x',names:[]}),/불러오지 못해/);
});

/* ── 3. 실행 흐름 ── */
async function run(setup){
  const D=build();
  D.set(LIST.slice());
  setup(D);
  const res=await D.pcRunDeepLink_();
  return {D,res};
}
await ckA('8. 정확히 1곳이면 조회 모달만 열고 비밀번호 화면은 열지 않는다',async()=>{
  const {D,res}=await run(D=>{ D.loc.search='?hosp='+encodeURIComponent('서울 성모 병원'); D.win.bazBootReady=Promise.resolve(true); });
  assert.equal(res.status,'ok');
  assert.deepEqual(D.log.opened,['서울 성모 병원']);
  assert.equal(D.log.pw,0);
});
await ckA('9. bazBootReady 완료를 기다린 뒤 실행한다(지연 도착)',async()=>{
  let resolveBoot;
  const D=build();
  D.set([]);
  D.loc.search='?hosp='+encodeURIComponent('늦은병원');
  D.win.bazBootReady=new Promise(r=>{resolveBoot=r;});
  const p=D.pcRunDeepLink_();
  assert.deepEqual(D.log.opened,[],'boot 완료 전에는 열지 않는다');
  D.set([{n:'늦은병원'}]);
  resolveBoot(true);
  const res=await p;
  assert.equal(res.status,'ok');
  assert.deepEqual(D.log.opened,['늦은병원']);
});
await ckA('10. bazBootReady 가 reject 돼도 예외 없이 캐시 목록으로 시도한다',async()=>{
  const {D,res}=await run(D=>{ D.loc.search='?hosp='+encodeURIComponent('서울성모병원'); D.win.bazBootReady=Promise.reject(new Error('boot fail')); });
  assert.equal(res.status,'ok');
  assert.deepEqual(D.log.opened,['서울 성모 병원']);
});
await ckA('11. boot 실패로 병원 목록이 비면 화면을 막지 않고 안내만 남긴다',async()=>{
  const D=build();
  D.set([]);
  D.loc.search='?hosp='+encodeURIComponent('아무병원');
  D.win.bazBootReady=Promise.reject(new Error('down'));
  const res=await D.pcRunDeepLink_();
  assert.equal(res.status,'boot');
  assert.deepEqual(D.log.opened,[]);
  assert.equal(D.log.announced.length,1);
});
await ckA('12. 같은 병원 모달이 이미 열려 있으면 다시 열지 않는다',async()=>{
  const D=build();
  D.set(LIST.slice());
  D.loc.search='?hosp='+encodeURIComponent('서울 성모 병원');
  D.win.bazBootReady=Promise.resolve(true);
  await D.pcRunDeepLink_();
  assert.deepEqual(D.log.opened,['서울 성모 병원']);
  /* 첫 진입으로 histModal 이 열려 있는 상태 그대로 다시 딥링크를 태운다 */
  assert.equal(D.modalStack.length,1);
  const again=D.pcDeepLinkOpen_('서울 성모 병원');
  assert.equal(again,'already');
  assert.deepEqual(D.log.opened,['서울 성모 병원'],'중복 open 없음');
});
await ckA('13. 다른 모달이 열려 있으면 모두 닫은 뒤 이력만 연다',async()=>{
  const D=build();
  D.set(LIST.slice());
  D.modalStack.push(D.nodes.histPwModal);
  D.loc.search='?hosp='+encodeURIComponent('서울성모병원');
  D.win.bazBootReady=Promise.resolve(true);
  const res=await D.pcRunDeepLink_();
  assert.equal(res.action,'opened');
  assert.equal(D.log.closed,1,'열려 있던 다른 모달을 정리');
  assert.deepEqual(D.log.opened,['서울 성모 병원']);
  assert.equal(D.log.pw,0,'편집 비밀번호 화면은 자동 실행되지 않는다');
});
await ckA('14. 새로고침·재호출에도 딥링크는 한 번만 실행된다',async()=>{
  const D=build();
  D.set(LIST.slice());
  D.loc.search='?hosp='+encodeURIComponent('서울성모병원');
  D.win.bazBootReady=Promise.resolve(true);
  await D.pcRunDeepLink_();
  const second=await D.pcRunDeepLink_();
  assert.equal(second,null);
  assert.equal(D.log.opened.length,1);
});
await ckA('15. hosp 파라미터가 없으면 아무 것도 하지 않고 플래그도 세우지 않는다',async()=>{
  const D=build();
  D.set(LIST.slice());
  D.loc.search='?tab=list';
  const res=await D.pcRunDeepLink_();
  assert.equal(res,null);
  assert.equal(D.done(),false);
  assert.deepEqual(D.log.opened,[]);
});

/* ── 4. 소스 규약 ── */
ck('16. 딥링크는 편집(비밀번호) 경로를 호출하지 않는다',()=>{
  const at=SRC.indexOf('function pcRunDeepLink_');
  const block=SRC.slice(SRC.indexOf('function pcDeepLinkOpen_'),at+2000);
  assert.ok(!/histPw|openHistPw|histEditing\s*=\s*true/.test(block),'딥링크 경로에 편집 진입 없음');
});
ck('17. 페이지 로드 시 딥링크가 자동 실행되며 예외가 페이지로 번지지 않는다',()=>{
  assert.match(SRC,/try\{\s*pcRunDeepLink_\(\);\s*\}catch/);
});

/* ── 5. 이력만 보는 창 (view=hist) ── */
ck('22. view=hist 파라미터를 정확히 판별한다',()=>{
  const D=build();
  assert.equal(D.pcDeepLinkHistOnly_('?hosp=x&view=hist'),true);
  assert.equal(D.pcDeepLinkHistOnly_('?view=hist&hosp=x'),true);
  assert.equal(D.pcDeepLinkHistOnly_('?hosp=x'),false);
  assert.equal(D.pcDeepLinkHistOnly_('?hosp=x&view=map'),false);
  assert.equal(D.pcDeepLinkHistOnly_('?hosp=x&view=history'),false,'부분 일치로 켜지지 않는다');
});
await ckA('23. view=hist 는 병원 화면 전체 대신 이력만 보이는 모드로 연다',async()=>{
  const D=build();
  D.set(LIST.slice());
  D.loc.search='?hosp='+encodeURIComponent('서울 성모 병원')+'&view=hist';
  D.win.bazBootReady=Promise.resolve(true);
  const res=await D.pcRunDeepLink_();
  assert.equal(res.status,'ok');
  assert.equal(res.histOnly,true);
  assert.equal(D.histOnly(),true);
  assert.deepEqual(D.log.opened,['서울 성모 병원']);
});
await ckA('24. view=hist 없이 들어오면 평소 병원 화면 그대로 연다',async()=>{
  const D=build();
  D.set(LIST.slice());
  D.loc.search='?hosp='+encodeURIComponent('서울 성모 병원');
  D.win.bazBootReady=Promise.resolve(true);
  const res=await D.pcRunDeepLink_();
  assert.equal(res.histOnly,false);
  assert.equal(D.histOnly(),false);
});
await ckA('25. 병원을 찾지 못하면 이력 전용 화면에 갇히지 않는다',async()=>{
  const D=build();
  D.set(LIST.slice());
  D.loc.search='?hosp='+encodeURIComponent('없는병원')+'&view=hist';
  D.win.bazBootReady=Promise.resolve(true);
  const res=await D.pcRunDeepLink_();
  assert.equal(res.status,'none');
  assert.equal(D.histOnly(),false,'빈 화면 대신 평소 병원 화면이 남는다');
  assert.equal(D.log.announced.length,1);
});
ck('26. 이력 창을 닫으면 이력 전용 모드가 풀리고 전체 화면 보기 버튼이 있다',()=>{
  assert.match(SRC,/onClose:function\(\)\{[\s\S]*?pcSetHistOnly_\(false\)/,'닫으면 hist-only 해제');
  assert.match(SRC,/id="histOnlyFull"/);
  assert.match(SRC,/getElementById\('histOnlyFull'\)[\s\S]{0,140}pcSetHistOnly_\(false\)/);
  assert.match(SRC,/body\.hist-only \.wrap\{display:none;\}/,'이력만 보이도록 병원 화면을 감춘다');
});

/* ── 6. sw.js 배포 안전성 ── */
ck('27. sw.js 캐시 버전이 v169 이후로 올라갔다',()=>{
  const m=/CACHE_VERSION = 'baz-cs-v(\d+)'/.exec(SW);
  assert.ok(m,'CACHE_VERSION');
  assert.ok(Number(m[1])>169,'v'+m[1]);
});
ck('28. ignoreSearch 는 오프라인 내비게이션 폴백에서만 쓴다(네트워크 우선 유지)',()=>{
  assert.ok(SW.indexOf('ignoreSearch')>SW.indexOf('.catch(() =>'),'네트워크 실패 이후 경로');
  const code=SW.split('\n').filter(l=>!/^\s*\/\//.test(l)).join('\n');
  assert.equal((code.match(/ignoreSearch/g)||[]).length,1,'실제 코드에서는 한 곳');
  assert.match(SW,/fetch\(req\)\s*\n\s*\.then\(\(res\) => putCache\(req, res\)\)/,'네트워크 우선 유지');
});
ck('29. 쿼리스트링 내비게이션은 같은 경로 캐시를 먼저 찾고 없을 때만 index.html',()=>{
  const at=SW.indexOf('if (isNav) {');
  assert.ok(at>0);
  const block=SW.slice(at,at+320);
  assert.ok(block.indexOf('ignoreSearch')>=0 && block.indexOf("caches.match('./index.html')")>block.indexOf('ignoreSearch'));
});
ck('30. 내비게이션이 아닌 요청에는 여전히 HTML을 돌려주지 않는다',()=>{
  assert.match(SW,/return Response\.error\(\);/);
});

console.log('딥링크 검증 통과 '+count+'/'+count);
