import webpush from 'npm:web-push@3.6.7';
import {createPushSender} from '../deno-auth/work-push.ts';
const kv=await Deno.openKv(':memory:');
const sender=createPushSender(kv),publicKey=await sender.publicKey();
const serverKeys=(await kv.get<any>(['work-notifications-v1','secret','vapid'])).value;
const receiver=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
const clientPublic=new Uint8Array(await crypto.subtle.exportKey('raw',receiver.publicKey)),auth=crypto.getRandomValues(new Uint8Array(16));
const b64=(v:Uint8Array)=>btoa(String.fromCharCode(...v)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=(v:string)=>Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const payload={title:'BAZ CS 검증',body:'암호화된 접수 안내',requestId:crypto.randomUUID()};
let request:any;
const original=webpush.sendNotification;
// Keep the real request construction/encryption and isolate only network delivery.
webpush.sendNotification=async(s:any,p:string,o:any)=>{request=webpush.generateRequestDetails(s,p,o);return {statusCode:201,body:'',headers:{}};};
try{
 await sender.send({endpoint:'https://fcm.googleapis.com/fcm/send/runtime-test',keys:{p256dh:b64(clientPublic),auth:b64(auth)}},payload,60);
 if(!request||request.headers.TTL!==60)throw new Error('TTL missing');
 const authorization=request.headers.Authorization,token=authorization.match(/t=([^,]+)/)[1],parts=token.split('.');
 const verificationKey=await crypto.subtle.importKey('raw',decode(publicKey),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},verificationKey,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))throw new Error('VAPID signature mismatch');
 const claims=JSON.parse(new TextDecoder().decode(decode(parts[1])));
 if(claims.aud!=='https://fcm.googleapis.com')throw new Error('VAPID audience mismatch');
 const body=new Uint8Array(request.body),salt=body.slice(0,16),keySize=body[20],senderPublic=body.slice(21,21+keySize);
 const peer=await crypto.subtle.importKey('raw',senderPublic,{name:'ECDH',namedCurve:'P-256'},false,[]);
 const shared=await crypto.subtle.deriveBits({name:'ECDH',public:peer},receiver.privateKey,256);
 const encoder=new TextEncoder(),concat=(...values:Uint8Array[])=>{const out=new Uint8Array(values.reduce((n,v)=>n+v.length,0));let at=0;for(const v of values){out.set(v,at);at+=v.length;}return out;};
 const base=await crypto.subtle.importKey('raw',shared,'HKDF',false,['deriveBits']);
 const ikm=await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:auth,info:concat(encoder.encode('WebPush: info\0'),clientPublic,senderPublic)},base,256);
 const material=await crypto.subtle.importKey('raw',ikm,'HKDF',false,['deriveBits']);
 const cek=await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info:encoder.encode('Content-Encoding: aes128gcm\0')},material,128);
 const nonce=await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info:encoder.encode('Content-Encoding: nonce\0')},material,96);
 const aes=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['decrypt']);
 const clear=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce},aes,body.slice(21+keySize)));
 let end=clear.length-1;while(clear[end]===0)end--;if(clear[end]!==2)throw new Error('Final record marker mismatch');
 if(new TextDecoder().decode(clear.slice(0,end))!==JSON.stringify(payload))throw new Error('Web Push encrypted payload mismatch');
 if(serverKeys.publicKey!==publicKey||!serverKeys.privateKey)throw new Error('Persistent VAPID key mismatch');
 console.log('work-push-deno: actual Deno/npm runtime, persistent WebCrypto VAPID, JWT signature/audience, aes128gcm receiver decryption and UTF-8 payload passed. No external push sent.');
}finally{webpush.sendNotification=original;kv.close();}
