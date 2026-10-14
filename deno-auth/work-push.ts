// The private VAPID key never leaves protected server storage.
let library:any;
async function webpush(){if(!library){const pkg=await import('npm:web-push@3.6.7');library=pkg.default||pkg;}return library;}
export function createPushSender(kv:any){
 let cached:Promise<any>|null=null;
 async function keys(){
  if(!cached)cached=(async()=>{
   const key=['work-notifications-v1','secret','vapid'];
   for(let i=0;i<8;i++){
    const old=await kv.get(key);if(old.value)return old.value;
    // WebCrypto generation also lets authentication start without loading npm modules.
    const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
    const raw=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey)),jwk=await crypto.subtle.exportKey('jwk',pair.privateKey);
    let bin='';raw.forEach(x=>bin+=String.fromCharCode(x));
    const record={publicKey:btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''),privateKey:jwk.d,createdAt:new Date().toISOString()};
    if((await kv.atomic().check(old).set(key,record).commit()).ok)return record;
   }
   throw new Error('알림 서버 키를 준비하지 못했습니다.');
  })().catch(e=>{cached=null;throw e;});
  return cached;
 }
 async function send(subscription:any,payload:any,ttl:number){
  const [k,lib]=await Promise.all([keys(),webpush()]);
  await lib.sendNotification(subscription,JSON.stringify(payload),{vapidDetails:{subject:'https://yuyoung-ai.github.io/YuYoung/',publicKey:k.publicKey,privateKey:k.privateKey},TTL:ttl,urgency:'high',timeout:2500,contentEncoding:'aes128gcm'});
 }
 return {publicKey:async()=>(await keys()).publicKey,send};
}
