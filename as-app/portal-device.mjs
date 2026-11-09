// Persistent non-extractable key; neither phone numbers nor bearer tokens are saved.
// Registration identity and authorization are still verified on the server.
const DB='curejet-portal-device-v1',STORE='keys';
function canonical(v){if(v===undefined)throw Error('잘못된 요청입니다.');if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';}
function b64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function open(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('이 기기에 접속 정보를 보관하지 못했습니다. 브라우저 설정을 확인해 주세요.'));r.onblocked=()=>reject(Error('다른 창을 닫은 뒤 다시 시도해 주세요.'));});}
function read(db){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).get('primary');tx.oncomplete=()=>resolve(r.result);tx.onabort=()=>reject(Error('기기 연결을 다시 확인해 주세요.'));});}
function insert(db,value){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite'),s=tx.objectStore(STORE),r=s.get('primary');let result;r.onsuccess=()=>{result=r.result||value;if(!r.result)s.add(value,'primary');};tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(Error('기기 연결을 저장하지 못했습니다. 다시 시도해 주세요.'));});}
export async function createPortalDevice(){
 if(!globalThis.isSecureContext||!globalThis.crypto?.subtle||!globalThis.indexedDB)throw Error('안전한 기기 연결을 지원하는 브라우저에서 열어 주세요.');
 const db=await open();let keys;try{keys=await read(db);if(!keys){const generated=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);keys=await insert(db,{privateKey:generated.privateKey,publicKey:generated.publicKey});}}finally{db.close();}
 if(!keys?.privateKey||keys.privateKey.extractable!==false||keys.privateKey.algorithm.name!=='ECDSA'||keys.privateKey.algorithm.namedCurve!=='P-256')throw Error('기기 연결을 다시 확인해 주세요.');
 const exported=await crypto.subtle.exportKey('jwk',keys.publicKey),key={kty:'EC',crv:'P-256',x:exported.x,y:exported.y};
 return Object.freeze({async sign(body){if(!body||typeof body!=='object'||Array.isArray(body)||Object.hasOwn(body,'proof'))throw Error('등록 요청을 확인해 주세요.');const snapshot=JSON.parse(JSON.stringify(body)),at=Date.now(),nonce=b64(crypto.getRandomValues(new Uint8Array(32))),payload={body:snapshot,at,nonce},signature=b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,new TextEncoder().encode(canonical(payload))));return {...snapshot,proof:{key,at,nonce,signature}};}});
}
