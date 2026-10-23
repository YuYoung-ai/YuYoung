// A 128-bit opaque capability derived from the hospital's random code.
// The expression index guarantees one hospital per prefix.
export function shortCode(code){
 if(!/^[a-f0-9]{48}$/.test(code))throw Error('Invalid hospital code');
 return btoa(String.fromCharCode(...code.slice(0,32).match(/../g).map(x=>parseInt(x,16)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
export function shortKey(slug){
 if(!/^[A-Za-z0-9_-]{21}[AQgw]$/.test(slug))return null;
 try{return Array.from(atob(slug.replaceAll('-','+').replaceAll('_','/')+'=='),x=>x.charCodeAt(0).toString(16).padStart(2,'0')).join('');}catch{return null;}
}
export async function redirectSurvey(env,slug){
 const key=shortKey(slug),h=key?await env.DB.prepare('SELECT code FROM survey_hospitals WHERE substr(code,1,32)=? AND active=1').bind(key).first():null;
 if(!h)return new Response('사용할 수 없는 설문 주소입니다. 전달받으신 주소를 확인해 주세요.',{status:404,headers:{'Content-Type':'text/plain;charset=utf-8'}});
 return new Response(null,{status:302,headers:{Location:env.CUSTOMER_PAGE+'#h='+h.code}});
}
