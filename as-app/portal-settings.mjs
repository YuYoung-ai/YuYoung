import {installCard} from './pwa.mjs?v=325';
import {portalCall,forgetPortalDevice} from './portal-api.mjs?v=321';
import {writePending} from './portal-storage.mjs?v=323';

// One closed panel at the end of the page. No identity requests on mount/open.
export function mountSettings(container,{device=false,handoff}={}){
 if(!container||document.getElementById('portal-device-settings'))return;
 const panel=document.createElement('details');panel.id='portal-device-settings';panel.className='portal-device-settings';
 panel.innerHTML='<summary>앱 설치·기기 관리</summary><div class="portal-settings-body"><div data-install-slot></div><div class="portal-settings-actions"></div><p class="portal-settings-message" role="status" hidden></p><div id="handoff-box"></div></div>';
 container.append(panel);
 const actions=panel.querySelector('.portal-settings-actions'),status=panel.querySelector('[role=status]'),box=panel.querySelector('#handoff-box');
 const message=text=>{status.textContent=text;status.hidden=!text;};
 let busy=false;
 const setBusy=on=>{busy=on;actions.setAttribute('aria-busy',String(on));actions.querySelectorAll('button').forEach(b=>b.disabled=on);};
 function button(id,text,click){const b=document.createElement('button');b.type='button';b.id=id;b.textContent=text;b.onclick=click;actions.append(b);return b;}
 function link(text,action){const a=document.createElement('a');a.className='portal-button';a.textContent=text;a.href='index.html?action='+action;actions.append(a);}
 if(device){
  link('접수 병원 변경','hospital');
  link('번호 변경·재등록','recovery');
  button('handoff-create','설치 앱으로 이어받기',async()=>{
   if(busy)return;setBusy(true);message('');
   try{
    const code=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    await portalCall('portal_handoff_create',{code});
    box.replaceChildren();const note=document.createElement('div');note.className='portal-note';const title=document.createElement('strong');title.textContent='5분 동안 한 번만 사용할 수 있는 연결 코드';const p=document.createElement('p');p.textContent='설치 앱의 ‘기존 등록 이어받기’에 붙여 넣어 주세요. 다른 사람에게 공유하지 마세요.';const area=document.createElement('textarea');area.readOnly=true;area.setAttribute('aria-label','설치 앱 연결 코드');area.value=code;const copy=document.createElement('button');copy.type='button';copy.id='copy-handoff';copy.textContent='코드 복사';copy.onclick=async()=>{try{await navigator.clipboard.writeText(code);message('연결 코드를 복사했습니다.');}catch{message('표시된 코드를 선택해 복사해 주세요.');}};note.append(title,p,area,copy);box.append(note);
   }catch(e){message(e.message);}finally{setBusy(false);}
  });
  button('portal-logout','이 기기 연결 해제',async()=>{
   if(busy)return;
   if(document.querySelector('#photos:disabled')||document.querySelector('#request-form[aria-busy=true]')){message('사진 업로드나 접수가 끝난 뒤 다시 시도해 주세요.');return;}
   if(!confirm('이 기기의 접속 권한을 해제할까요? 다시 이용하려면 기기 연결 확인이 필요합니다.'))return;
   setBusy(true);message('');
   try{
    await portalCall('portal_logout');
    // Revoke on the server first. Local storage cleanup must not undo that success.
    await Promise.allSettled([forgetPortalDevice(),writePending(null)]);
    try{for(const k of ['curejet-portal-login','curejet-portal-hospital','curejet-portal-return'])sessionStorage.removeItem(k);}catch{}
    location.replace('index.html?loggedOut=1');
   }catch(e){message(e.message);setBusy(false);}
  });
 }else if(handoff)button('pending-handoff','설치한 앱으로 등록 정보 이어받기',handoff);
 panel.addEventListener('toggle',()=>{
  if(!panel.open||panel.querySelector('[data-install-card]'))return;
  installCard(panel.querySelector('[data-install-slot]'),true);
 });
 return panel;
}
