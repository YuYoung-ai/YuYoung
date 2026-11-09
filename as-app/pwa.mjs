// The head bootstrap normally owns this bridge. Import only as a fail-open fallback.
if(!window.CurejetInstall)try{await import('./install-bootstrap.js?v=324');}catch{}
const bridge=window.CurejetInstall;
const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const ios=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
if(globalThis.isSecureContext&&navigator.serviceWorker)navigator.serviceWorker.register(new URL('sw.js?v=324',import.meta.url),{scope:new URL('./',import.meta.url).pathname,updateViaCache:'none'}).catch(()=>{});
export function installCard(container,explicit=false){
 if(standalone()||bridge?.state().installed)return;
 try{if(!explicit&&Date.now()-Number(localStorage.getItem('curejet-install-later')||0)<7*86400000)return;}catch{}
 const card=document.createElement('section');card.className='portal-card';card.dataset.installCard='';card.innerHTML='<h2>CUREJET AS를 홈 화면에 추가하세요</h2><p>다음부터 QR 없이 AS 접수와 진행 상황을 확인할 수 있습니다.</p><div class="portal-actions"><button type="button" class="primary" data-install disabled>설치 준비 중…</button><button type="button" data-later>나중에</button></div><p data-install-help class="muted" role="status"></p><details data-install-details><summary>설치 도움이 필요하신가요?</summary><p data-install-manual class="muted"></p></details>';
 const button=card.querySelector('[data-install]'),help=card.querySelector('[data-install-help]'),details=card.querySelector('[data-install-details]'),manual=card.querySelector('[data-install-manual]');let unsubscribe=()=>{},removed=false;
 function remove(){if(removed)return;removed=true;unsubscribe();card.remove();}
 function render(state={}){
  if(removed)return;if(standalone()||state.installed){remove();return;}
  const manualOnly=ios()||!state.supported||!bridge;
  if(manualOnly){button.disabled=false;button.textContent='홈 화면 추가 방법';help.textContent='이 브라우저에서는 홈 화면 추가 절차를 이용해 주세요.';manual.textContent=ios()?'Safari의 공유 버튼 → 홈 화면에 추가를 선택해 주세요.':'설치를 지원하는 Chrome 또는 Edge에서 이 페이지를 열어 주세요. 브라우저 메뉴의 앱 설치·홈 화면에 추가도 이용할 수 있습니다.';return;}
  button.disabled=!state.ready||state.busy;button.textContent=state.busy?'설치창 여는 중…':state.ready?'앱 설치':'설치 준비 중…';
  help.textContent=state.busy?'브라우저 설치창에서 설치를 확인해 주세요.':state.ready?'앱 설치를 누르면 설치 확인창이 바로 열립니다.':state.outcome==='accepted'?'설치가 진행 중입니다. 완료되면 홈 화면에서 CUREJET AS를 열어 주세요.':state.outcome==='dismissed'?'설치를 취소했습니다. 웹에서 계속 이용할 수 있습니다.':state.outcome==='failed'?'설치창을 열지 못했습니다. 설치 도움이 필요하신가요?를 확인해 주세요.':'브라우저가 설치를 준비하고 있습니다. 준비가 끝나면 버튼이 활성화됩니다.';
  manual.textContent='잠시 사용하면 브라우저가 설치 버튼을 준비합니다. 이미 설치했다면 홈 화면의 CUREJET AS를 실행해 주세요. 시크릿 모드·앱 안의 브라우저에서는 설치가 제한될 수 있습니다. 준비되지 않으면 일반 Chrome·Edge로 열거나 브라우저 메뉴의 앱 설치·홈 화면에 추가를 이용해 주세요.';
 }
 card.querySelector('[data-later]').onclick=()=>{try{localStorage.setItem('curejet-install-later',String(Date.now()));}catch{}remove();};
 button.onclick=()=>{
  const state=bridge?.state();if(ios()||!state?.supported||!bridge){details.open=true;return;}
  if(!state.ready||state.busy)return;
  // Keep the real browser prompt on this click's activation stack.
  const request=bridge.prompt();request.catch(()=>{});
 };
 container.append(card);if(bridge)unsubscribe=bridge.subscribe(render);else render();
 // Rerendered portal views must not retain callbacks/cards in the install bridge.
 const observer=new MutationObserver(()=>{if(!card.isConnected){unsubscribe();observer.disconnect();}});observer.observe(container,{childList:true});
}
