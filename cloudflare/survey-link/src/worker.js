const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'};
export default {async fetch(req,env){
 const path=new URL(req.url).pathname;let r;
 if(!['GET','HEAD'].includes(req.method))r=new Response('지원하지 않는 요청입니다.',{status:405});
 else if(path==='/health')r=Response.json({success:true,service:'curejet-survey-link'});
 else if(/^\/[A-Za-z0-9_-]{22}$/.test(path)){
  try{r=await env.SURVEY.fetch(new Request('https://survey.internal/r'+path,{redirect:'manual'}));}
  catch{r=new Response('잠시 후 다시 접속해 주세요.',{status:503});}
 }else r=new Response('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>큐어젯 고객만족도 조사</title><style>body{font-family:system-ui,sans-serif;background:#f2f6f9;color:#21344a;max-width:540px;margin:15vh auto;padding:24px;line-height:1.8}main{background:white;padding:30px;border-radius:20px}h1{font-size:24px}</style><main><h1>큐어젯 고객만족도 조사</h1><p>안내받으신 병원 전용 링크를 누르거나 QR을 스캔해 참여해 주세요.</p></main></html>',{status:path==='/'?200:404,headers:{'Content-Type':'text/html;charset=utf-8'}});
 const result=new Response(req.method==='HEAD'?null:r.body,{status:r.status,headers:r.headers});for(const [k,v] of Object.entries(headers))result.headers.set(k,v);return result;
}};
