// The head bootstrap starts browser preparation independently of login/API work.
if(!window.CurejetInstall)try{await import('./install-bootstrap.js?v=325');}catch{}
const bridge=window.CurejetInstall;
const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const ios=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
if(bridge?.prepare)bridge.prepare();
else if(globalThis.isSecureContext&&navigator.serviceWorker)navigator.serviceWorker.register(new URL('sw.js?v=326',import.meta.url),{scope:new URL('./',import.meta.url).pathname,updateViaCache:'none'}).catch(()=>{});
export function installCard(container,explicit=false){
 if(location.origin==='https://yuyoung-ai.github.io'){
  const card=document.createElement('section');card.className='portal-card';card.dataset.installCard='';card.innerHTML='<h2>CUREJET AS 독립 앱</h2><p>BAZ CS와 별도로 설치되는 병원용 앱입니다.</p><a class="portal-button primary full" href="https://curejet-as.coaptation.workers.dev/as-app/index.html" target="_blank" rel="noopener noreferrer">독립 앱 설치 화면 열기</a>';container.append(card);return;
 }
 if(standalone()||bridge?.state().installed)return;
 try{if(!explicit&&Date.now()-Number(localStorage.getItem('curejet-install-later')||0)<7*86400000)return;}catch{}
 const card=document.createElement('section');card.className='portal-card';card.dataset.installCard='';card.innerHTML='<h2>CUREJET AS를 홈 화면에 추가하세요</h2><p>다음부터 QR 없이 AS 접수와 진행 상황을 확인할 수 있습니다.</p><div class="portal-actions"><button type="button" class="primary" data-install disabled>설치 확인 중…</button><button type="button" data-later>나중에</button></div><p data-install-help class="muted" role="status"></p><details data-install-details><summary>설치 도움이 필요하신가요?</summary><p data-install-manual class="muted"></p></details>';
 const button=card.querySelector('[data-install]'),help=card.querySelector('[data-install-help]'),details=card.querySelector('[data-install-details]'),manual=card.querySelector('[data-install-manual]');let unsubscribe=()=>{},removed=false,timer;
 const deadline=(bridge?.startedAt||Date.now())+3000;
 function remove(){if(removed)return;removed=true;clearTimeout(timer);unsubscribe();card.remove();}
 function render(state={}){
  clearTimeout(timer);if(removed)return;if(standalone()||state.installed){remove();return;}
  const manualOnly=ios()||!state.supported||!bridge;
  if(manualOnly){button.disabled=false;button.textContent='홈 화면 추가 방법';help.textContent='이 브라우저에서는 홈 화면 추가 절차를 이용해 주세요.';manual.textContent=ios()?'Safari의 공유 버튼 → 홈 화면에 추가를 선택해 주세요.':'설치를 지원하는 Chrome 또는 Edge에서 이 페이지를 열어 주세요. 브라우저 메뉴의 앱 설치·홈 화면에 추가도 이용할 수 있습니다.';return;}
  manual.textContent='Chrome·Edge의 메뉴(⋮) → 앱 설치 또는 홈 화면에 추가를 선택해 주세요. 시크릿 모드나 앱 안의 브라우저에서는 설치가 제한될 수 있습니다.';
  if(state.busy){button.disabled=true;button.textContent='설치창 여는 중…';help.textContent='브라우저 설치창에서 설치를 확인해 주세요.';return;}
  if(state.ready){button.disabled=false;button.textContent='앱 설치';help.textContent='앱 설치를 누르면 설치 확인창이 바로 열립니다.';return;}
  if(state.outcome==='accepted'){button.disabled=true;button.textContent='설치 진행 중';help.textContent='설치가 진행 중입니다. 완료되면 홈 화면에서 CUREJET AS를 열어 주세요.';return;}
  if(state.outcome==='dismissed'||state.outcome==='failed'){
   button.disabled=false;button.textContent='설치 다시 확인';help.textContent=state.outcome==='dismissed'?'설치를 취소했습니다. 웹에서 계속 이용할 수 있습니다.':'설치창을 열지 못했습니다. 설치 도움이 필요하신가요?를 확인해 주세요.';return;
  }
  const remaining=deadline-Date.now();
  if(remaining>0){button.disabled=true;button.textContent='설치 확인 중…';help.textContent='이 브라우저에서 설치 가능한지 확인하고 있습니다.';timer=setTimeout(()=>render(bridge.state()),remaining);}
  else{button.disabled=false;button.textContent='설치 방법 확인';help.textContent='브라우저가 설치창을 아직 제공하지 않았습니다. 설치 방법을 확인해 주세요.';}
 }
 card.querySelector('[data-later]').onclick=()=>{try{localStorage.setItem('curejet-install-later',String(Date.now()));}catch{}remove();};
 button.onclick=()=>{
  const state=bridge?.state();if(state?.busy)return;
  if(!state?.ready){details.open=true;return;}
  // No await or timer between a trusted click and the real native prompt.
  const request=bridge.prompt();request.catch(()=>{});
 };
 container.append(card);if(bridge)unsubscribe=bridge.subscribe(render);else render();
 const observer=new MutationObserver(()=>{if(!card.isConnected){clearTimeout(timer);unsubscribe();observer.disconnect();}});observer.observe(container,{childList:true});
}
