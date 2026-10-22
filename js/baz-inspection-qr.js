(function(root){
  'use strict';
  const bridge=root.BazInspectionQrBridge,config=root.BazInspectionQrConfig,KEY='baz_inspection_customer_qr_v1';
  let active=null,busy=false,poll=null,clock=null;
  async function hash(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');}
  // Keep the same integer slicing as BazInspectionPdf.bodyPages, including a slot crossing pages.
  function placements(rect,canvasWidth){
    const contentWidth=194,step=Math.floor(281/contentWidth*canvasWidth),scale=canvasWidth/rect.sheetWidth,top=rect.y*scale,bottom=(rect.y+rect.height)*scale,out=[];
    for(let page=Math.floor(top/step);page<=Math.floor((bottom-.01)/step);page++)out.push({page,x:8+rect.x/rect.sheetWidth*contentWidth,y:8+(top-page*step)/canvasWidth*contentWidth,width:rect.width/rect.sheetWidth*contentWidth,height:rect.height/rect.sheetWidth*contentWidth});
    return out;
  }
  root.BazInspectionQr={placements};
  const dialog=document.createElement('dialog');dialog.className='qr-dialog';dialog.setAttribute('aria-labelledby','qrDialogTitle');
  dialog.innerHTML='<h2 id="qrDialogTitle">고객 확인 및 서명 QR</h2><p id="qrStaffStatus" role="status" aria-live="polite">고객이 본인 휴대폰으로 내용을 확인하고 서명합니다.</p><div id="qrOptions"><label for="qrMinutes">QR 유효시간</label><select id="qrMinutes"><option value="10">10분</option><option value="30" selected>30분</option><option value="60">60분</option></select><p class="qr-muted">시간 내 서명하면 최소 10분 동안 PDF를 받을 수 있습니다.</p></div><div id="qrIssued" hidden><canvas id="qrCode" aria-label="고객 서명 페이지 QR"></canvas><p id="qrStaffTimer" class="qr-time"></p><input id="qrCustomerLink" class="qr-link-input" aria-label="고객 문서 링크" readonly><button id="qrCopy" class="qr-button qr-secondary">링크 복사</button><p class="qr-muted">QR을 고객에게 보여 주세요. 개인 연락처를 전달하지 않아도 됩니다. QR을 취소하고 수정하면 새 문서로 다시 발급합니다.</p></div><div class="qr-dialog-actions"><button id="qrDismiss" class="qr-button qr-secondary">닫기</button><button id="qrCreate" class="qr-button qr-primary">QR 생성</button><button id="qrCheck" class="qr-button qr-primary" hidden>서명 상태 확인</button></div><button id="qrRevoke" class="qr-button qr-secondary qr-danger" hidden style="width:100%;margin-top:12px">QR 취소하고 내용 수정</button>';
  document.body.append(dialog);
  const $=id=>document.getElementById(id),say=(text,error)=>{$('qrStaffStatus').textContent=text;$('qrStaffStatus').classList.toggle('qr-error',!!error);};
  $('qrMinutes').value=String(config.defaultMinutes||30);
  function save(){if(active)sessionStorage.setItem(KEY,JSON.stringify(active));else sessionStorage.removeItem(KEY);}
  async function api(path,body,blob){
    const token=root.BazAuth.token(),response=await fetch(config.api+path,{method:'POST',headers:{Authorization:'Bearer '+token,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:JSON.stringify(body||{}),cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(45000)});
    if(root.BazAuth.token()!==token)throw new Error('로그인 계정이 변경되었습니다. 다시 로그인해 확인하세요.');
    if(!response.ok){let p;try{p=await response.json();}catch{}throw new Error(p?.error||'QR 서버에 연결하지 못했습니다. 서비스 배포 설정과 인터넷 연결을 확인하세요.');}
    return blob?response.blob():response.json();
  }
  function issued(){
    $('qrOptions').hidden=!!active;$('qrIssued').hidden=!active;$('qrCreate').hidden=!!active;$('qrCheck').hidden=!active;$('qrRevoke').hidden=!active;$('qrDismiss').hidden=!!active;
    if(active){$('qrCustomerLink').value=active.url;root.BazQrEncoder.toCanvas($('qrCode'),active.url,{width:280,margin:2,errorCorrectionLevel:'M'}).catch(e=>say(e.message,true));tick();}
  }
  function tick(){if(!active)return;const seconds=Math.max(0,Math.ceil(((active.downloadUntil||active.expiresAt)-Date.now())/1000));$('qrStaffTimer').textContent=(active.state==='signed'?'다운로드 남은 시간 ':'서명 남은 시간 ')+Math.floor(seconds/60)+'분 '+String(seconds%60).padStart(2,'0')+'초';if(!seconds&&active.state!=='signed')say('QR 유효시간이 지났습니다. 취소한 뒤 새 QR을 발급해 주세요.',true);}
  function schedule(){clearTimeout(poll);if(active&&dialog.open)poll=setTimeout(check,10000);}
  async function dataUrl(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('서명 파일을 읽지 못했습니다.'));r.readAsDataURL(blob);});}
  async function check(){
    if(!active||busy)return;busy=true;$('qrCheck').disabled=true;
    const entry=active;
    try{
      const value=await api('/staff/sessions/'+entry.id+'/status');if(active!==entry)return;
      Object.assign(entry,{state:value.state,downloadUntil:value.downloadUntil});save();tick();
      if(value.state==='signed'){
        say('고객 서명이 완료되었습니다. 서명된 PDF를 회사 기록에 저장하고 있습니다…');
        const blob=await api('/staff/sessions/'+entry.id+'/download',null,true),signature=await dataUrl(await api('/staff/sessions/'+entry.id+'/signature',null,true));
        await bridge.received(blob,{...value,signature,filename:entry.filename},entry.taskId,entry.fingerprint);
        active=null;save();clearTimeout(poll);dialog.close();
      }else if(value.state==='revoked'){say('취소된 QR입니다. 새 QR을 발급할 수 있습니다.',true);active=null;save();issued();}
      else if(value.state==='signing'){say('고객 서명을 접수했습니다. 서버에서 PDF를 준비하고 있습니다…');schedule();}
      else {say('고객이 QR을 스캔해 내용을 확인하고 서명하기를 기다리고 있습니다.');schedule();}
    }catch(e){say(e.message,true);schedule();}
    finally{busy=false;$('qrCheck').disabled=false;}
  }
  $('customerQrBtn').onclick=()=>{if(!dialog.open)dialog.showModal();issued();if(active)check();};
  $('qrDismiss').onclick=()=>{if(!busy&&!active)dialog.close();};
  dialog.addEventListener('cancel',e=>{if(active||busy)e.preventDefault();});
  $('qrCopy').onclick=async()=>{try{await navigator.clipboard.writeText(active.url);say('고객 문서 링크를 복사했습니다.');}catch{$('qrCustomerLink').select();say('링크를 길게 눌러 복사해 주세요.');}};
  $('qrCreate').onclick=async()=>{
    if(busy||active)return;busy=true;$('qrCreate').disabled=true;$('qrDismiss').disabled=true;
    let created=null;
    try{
      say('고객이 확인할 문서를 고정하고 있습니다…');
      const health=await fetch(config.api+'/health',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!health.ok)throw new Error('QR 서버 배포와 D1 설정이 필요합니다. 설정 후 다시 시도하세요.');
      const draft=await bridge.draft();if(!draft){say('작성 화면의 필수값과 CS 담당자 서명을 확인해 주세요.',true);return;}
      const fingerprint=await hash(bridge.fingerprint()),form=new FormData();
      const metadata=JSON.stringify({ttlMinutes:Number($('qrMinutes').value),filename:draft.filename,documentNo:draft.documentNo,placements:draft.placements,review:draft.review});
      if(new Blob([metadata]).size+draft.blob.size>17.8*1024*1024)throw new Error('고객 확인용 문서가 너무 큽니다. 사진 용량을 줄인 뒤 다시 시도하세요.');
      form.append('metadata',metadata);form.append('pdf',draft.blob,draft.filename);
      say('문서를 업로드하고 QR을 만들고 있습니다…');created=await api('/staff/sessions',form);
      active={...created,taskId:draft.taskId,filename:draft.filename,fingerprint,state:'pending'};
      try{save();if(!bridge.waiting())throw new Error('현재 작업을 보관하지 못했습니다.');}catch(e){await api('/staff/sessions/'+created.id+'/revoke');active=null;save();throw e;}
      issued();say('고객에게 QR을 보여 주세요. 고객 휴대폰에서 확인·서명·다운로드할 수 있습니다.');schedule();
    }catch(e){say(e.message,true);}finally{busy=false;$('qrCreate').disabled=false;$('qrDismiss').disabled=false;}
  };
  $('qrCheck').onclick=check;
  $('qrRevoke').onclick=async()=>{if(busy||!active)return;busy=true;try{await api('/staff/sessions/'+active.id+'/revoke');active=null;save();clearTimeout(poll);issued();dialog.close();}catch(e){say(e.message,true);}finally{busy=false;}};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&active&&dialog.open)check();});
  clock=setInterval(tick,1000);
  try{const saved=JSON.parse(sessionStorage.getItem(KEY)||'null');if(saved?.id&&saved?.url){active=saved;dialog.showModal();issued();check();}}catch{say('이전 QR을 복구하지 못했습니다. 원본 점검서를 확인하세요.',true);}
})(window);
