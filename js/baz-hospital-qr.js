import {createBulkIssuer} from './baz-survey-bulk.mjs?v=321';
const root=document.getElementById('qr-controls'),message=document.getElementById('qr-message');
const status=(text,error=false)=>{message.textContent=text;message.classList.toggle('error',error);};
try{
 const runtime=await window.BazQrReady;if(!runtime)throw Error('접수 운영 설정을 불러올 수 없습니다.');
 const response=await window.BazWorkAPI.get('qr_library');if(!response.success)throw Error(response.error);
 const bulk=createBulkIssuer(root,{purpose:'as',mode:'library',onStatus:status,onOperation:async(hospitalId,state,baseRevision)=>{const result=await window.BazWorkAPI.post('qr_hospital_pause',{hospitalId,state,baseRevision});if(!result.success)throw Error(result.error);return result;}});
 bulk.setIssued(response.items);root.hidden=false;status('AS 접수 QR이 생성된 병원만 표시합니다. 운영 상태를 선택하면 저장됩니다.');
}catch(e){status(e.message,true);}
