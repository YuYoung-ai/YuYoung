import {api} from './baz-survey-api.mjs';
import {createIssuer} from './baz-survey-issuer.mjs';
const $=s=>document.querySelector(s),KEY='baz-survey-sales-session-v1';let session,issuer;
function notice(text,error=false){$('#sales-status').textContent=text;$('#sales-status').classList.toggle('error',error);}
function loginView(text=''){session=null;try{sessionStorage.removeItem(KEY);}catch{}$('#sales-app').hidden=true;$('#sales-login').hidden=false;$('#sales-login-password').value='';$('#login-status').textContent=text;}
async function call(path,p={}){try{return await api('/sales/'+path,p,false,false,session?.token||'');}catch(e){if(e.status===401)loginView(e.message);throw e;}}
async function load(){const p=await call('bootstrap');$('#sales-login').hidden=true;$('#sales-app').hidden=false;if(!issuer)issuer=createIssuer($('#sales-issuer'),{call,onStatus:notice});issuer.setNames(p.names);issuer.setCampaigns(p.campaigns);notice(p.campaigns.length?'병원명을 선택하거나 입력한 뒤 QR과 안내 문구를 만들어 주세요.':'현재 접수 중인 조사가 없습니다. 링크를 미리 준비할 수 있으며 접수 일정은 CS팀에 문의해 주세요.');}
$('#sales-login-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.currentTarget.querySelector('button');b.disabled=true;$('#login-status').textContent='접속을 확인하고 있습니다…';try{session=await api('/sales/login',{password:$('#sales-login-password').value});$('#sales-login-password').value='';try{sessionStorage.setItem(KEY,JSON.stringify(session));}catch{}await load();}catch(e){$('#login-status').textContent=e.message;}finally{b.disabled=false;}});
$('#sales-refresh').addEventListener('click',async e=>{e.currentTarget.disabled=true;try{await load();}catch(e){notice(e.message,true);}finally{$('#sales-refresh').disabled=false;}});
$('#sales-logout').addEventListener('click',async()=>{try{await call('logout');}finally{loginView('접속을 종료했습니다.');issuer=null;$('#sales-issuer').replaceChildren();}});
try{session=JSON.parse(sessionStorage.getItem(KEY));if(session?.expiresAt>Date.now())await load();else loginView();}catch(e){loginView(e.message||'다시 접속해 주세요.');}
