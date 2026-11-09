let installEvent;
// Register the customer-scoped worker on first entry, before an AS form is opened.
if(globalThis.isSecureContext&&navigator.serviceWorker){navigator.serviceWorker.register(new URL('sw.js?v=321',import.meta.url),{scope:new URL('./',import.meta.url).pathname,updateViaCache:'none'}).catch(()=>{});}
const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const ios=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installEvent=e;document.dispatchEvent(new Event('curejet-install-ready'));});
window.addEventListener('appinstalled',()=>{installEvent=null;document.querySelectorAll('[data-install-card]').forEach(e=>e.remove());});
export function installCard(container,explicit=false){
 if(standalone())return;try{if(!explicit&&Date.now()-Number(localStorage.getItem('curejet-install-later')||0)<7*86400000)return;}catch{}
 const card=document.createElement('section');card.className='portal-card';card.dataset.installCard='';card.innerHTML='<h2>CUREJET AS를 홈 화면에 추가하세요</h2><p>다음부터 QR 없이 AS 접수와 진행 상황을 확인할 수 있습니다.</p><div class="portal-actions"><button type="button" class="primary" data-install>앱 설치</button><button type="button" data-later>나중에</button></div><p data-install-help class="muted" hidden></p>';
 card.querySelector('[data-later]').onclick=()=>{try{localStorage.setItem('curejet-install-later',String(Date.now()));}catch{}card.remove();};
 card.querySelector('[data-install]').onclick=async()=>{const help=card.querySelector('[data-install-help]');help.hidden=false;if(installEvent){const e=installEvent;installEvent=null;await e.prompt();const result=await e.userChoice;help.textContent=result.outcome==='accepted'?'설치 후 홈 화면의 CUREJET AS를 열어 주세요.':'설치하지 않아도 이 화면에서 이용할 수 있습니다.';}else help.textContent=ios()?'Safari의 공유 버튼 → 홈 화면에 추가를 선택해 주세요. 설치 후 등록한 번호로 접속하세요.':'브라우저 메뉴에서 앱 설치 또는 홈 화면에 추가를 선택해 주세요. 메뉴가 없으면 웹에서 그대로 이용하실 수 있습니다.';};container.append(card);
}
