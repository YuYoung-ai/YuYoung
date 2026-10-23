export async function api(path, data = {}, authenticated = false, raw = false) {
  let r;
  try {
    const headers = {'Content-Type': 'application/json'};
    if (authenticated) headers.Authorization = 'Bearer ' + (window.BazAuth?.token() || '');
    r = await fetch(window.BazSurveyConfig.api + path, {method:'POST', headers, body:JSON.stringify(data), cache:'no-store', signal:AbortSignal.timeout(25000), referrerPolicy:'no-referrer'});
  } catch { throw new Error('연결이 지연되고 있습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.'); }
  if (!r.ok) { const p = await r.json().catch(()=>({})); const e = new Error(p.error || '요청을 처리하지 못했습니다.'); e.status=r.status; throw e; }
  return raw ? r : r.json();
}
export const el = (tag, cls, text) => { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; };
export function button(text, fn, cls='primary') { const b=el('button',cls,text); b.type='button'; b.addEventListener('click',fn); return b; }
