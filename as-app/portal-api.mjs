import {createPortalDevice} from './portal-device.mjs?v=321';
let device;
export const portalDevice=()=>device||(device=createPortalDevice().catch(e=>{device=null;throw e;}));
export async function signCustomer(action,params={},deviceId='portal-browser'){
 const r=window.QrCustomerRuntime,p={...params,action,deviceId,...(r.customerAction?{customerAction:action}:{})};return (await portalDevice()).sign(p);
}
export async function portalCall(action,params={},unsigned=false){
 const r=window.QrCustomerRuntime;if(!r||!(r.local&&r.api==='/_local/customer'||r.environment==='pilot'&&r.api==='https://yuyoung-production.coaptation.workers.dev'))throw Error('병원 등록 연결을 확인해 주세요.');
 const body=unsigned?{...params,action,...(r.customerAction?{customerAction:action}:{})}:await signCustomer(action,params);
 if(r.customerAction)body.action=r.customerAction;
 const response=await fetch(r.api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(35000)});
 if(!response.ok)throw Error('연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.');const data=await response.json();
 if(!data.success){const error=Error(data.error||'처리 내용을 확인해 주세요.');error.definitive=!data.retrySameOperation;throw error;}return data;
}
export async function forgetPortalDevice(){device=null;await new Promise((resolve,reject)=>{const r=indexedDB.open('curejet-portal-device-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('keys');r.onerror=reject;r.onsuccess=()=>{const db=r.result,tx=db.transaction('keys','readwrite');tx.objectStore('keys').clear();tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>{db.close();reject(Error('기기 연결을 다시 확인하세요.'));};};});}
