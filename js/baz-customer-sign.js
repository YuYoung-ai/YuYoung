(function(root){
  'use strict';
  const $=id=>document.getElementById(id),config=root.BazInspectionQrConfig,params=new URLSearchParams(location.hash.slice(1)),id=params.get('id'),token=params.get('token');
  const status=$('customerStatus'),canvas=$('customerSignature'),ctx=canvas.getContext('2d');
  let current=null,drawing=false,ink=0,last=null,busy=false,timer=null,poll=null,submission=null,reviewLoaded=false,offset=0;
  function say(text,error){status.textContent=text;status.classList.toggle('qr-error',!!error);}
  function now(){return Date.now()+offset;}
  async function api(action,data,blob){
    const response=await fetch(config.api+'/guest/sessions/'+id+'/'+action,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(data||{}),cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(45000)});
    const serverDate=response.headers.get('Date');if(serverDate)offset=new Date(serverDate).getTime()-Date.now();
    if(!response.ok){let p;try{p=await response.json();}catch{}const e=new Error(p?.error||'연결을 확인한 후 다시 시도하세요.');e.status=response.status;throw e;}
    return blob?response.blob():response.json();
  }
  function error(e){say(e.name==='TimeoutError'?'응답이 지연되고 있습니다. 다시 확인해 주세요.':e.message,true);if(e.status===410||e.status===404){$('customerSigning').hidden=true;$('customerDownload').hidden=true;$('customerReview').hidden=true;clearTimeout(poll);}else $('customerRetry').hidden=false;}
  function countdown(){
    if(!current)return;
    const until=current.state==='signed'?current.downloadUntil:current.state==='signing'?current.signedAt+600000:current.expiresAt;
    const seconds=Math.max(0,Math.ceil((until-now())/1000));
    $('customerTimer').textContent=(current.state==='signed'?'다운로드 가능 시간 ':'서명 가능 시간 ')+Math.floor(seconds/60)+'분 '+String(seconds%60).padStart(2,'0')+'초';
    if(!seconds){$('submitSignature').disabled=true;$('downloadSignedPdf').disabled=true;if(!busy){$('customerSigning').hidden=true;$('customerDownload').hidden=true;$('customerReview').hidden=true;say('유효시간이 지났습니다. 담당 직원에게 새 QR을 요청해 주세요.',true);}}
  }
  function renderReview(value){
    const pages=$('reviewPages'),photos=$('reviewPhotos');pages.replaceChildren();photos.replaceChildren();
    value.pages.forEach((src,i)=>{const img=new Image();img.src=src;img.alt='점검 내역서 본문 '+(i+1)+'페이지';pages.append(img);});
    value.photos.forEach((p,i)=>{const figure=document.createElement('figure'),img=new Image(),caption=document.createElement('figcaption');figure.className='qr-photo';img.src=p.data;img.alt='현장 사진 '+(i+1);caption.textContent='사진 '+(i+1)+(p.memo?' · '+p.memo:'');figure.append(img,caption);photos.append(figure);});
    $('customerDocument').textContent=[value.hospital,value.serial,current.documentNo].filter(Boolean).join(' · ');$('customerReview').hidden=false;reviewLoaded=true;
  }
  function renderState(value){
    current=value;if(value.serverNow)offset=value.serverNow-Date.now();$('customerRetry').hidden=true;countdown();
    $('customerSigning').hidden=current.state!=='pending';$('customerDownload').hidden=current.state!=='signed';
    if(current.state==='signed'){say('서명이 완료되었습니다. PDF를 다운로드해 주세요.');clearTimeout(poll);}
    else if(current.state==='signing'){say('서명을 접수했습니다. 서명된 PDF를 준비하고 있습니다…');schedule();}
    else say('점검 내용과 사진을 확인한 뒤 아래에서 서명해 주세요.');
  }
  function schedule(){clearTimeout(poll);poll=setTimeout(check,5000);}
  async function check(){
    try{renderState(await api('status'));if(!reviewLoaded)renderReview(await api('review'));if(current.state==='signing'&&submission&&!busy){busy=true;try{renderState(await api('sign',submission));}finally{busy=false;}}}
    catch(e){error(e);if(current?.state==='signing'&&e.status!==410&&e.status!==404)schedule();}
  }
  function point(event){const r=canvas.getBoundingClientRect();return {x:(event.clientX-r.left)*canvas.width/r.width,y:(event.clientY-r.top)*canvas.height/r.height};}
  ctx.lineWidth=5;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#142545';
  canvas.addEventListener('pointerdown',e=>{if(busy||current?.state!=='pending')return;e.preventDefault();canvas.setPointerCapture(e.pointerId);drawing=true;last=point(e);ctx.beginPath();ctx.moveTo(last.x,last.y);});
  canvas.addEventListener('pointermove',e=>{if(!drawing)return;e.preventDefault();const p=point(e);if(Math.hypot(p.x-last.x,p.y-last.y)>1){ctx.lineTo(p.x,p.y);ctx.stroke();ink++;last=p;}});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>{drawing=false;last=null;});
  $('clearSignature').onclick=()=>{if(!busy){ctx.clearRect(0,0,canvas.width,canvas.height);ink=0;submission=null;}};
  function signature(){
    const out=document.createElement('canvas');out.width=900;out.height=600;const c=out.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,900,600);c.fillStyle='#1b2f5e';c.font='bold 45px "Malgun Gothic",sans-serif';c.fillText($('customerName').value.trim(),35,64,830);c.drawImage(canvas,0,95,900,480);return out.toDataURL('image/png');
  }
  $('submitSignature').onclick=async()=>{
    if(busy)return;
    const name=$('customerName').value.trim();
    if(!name){say('성함을 입력해 주세요.',true);$('customerName').focus();return;}
    if(!$('customerConsent').checked){say('점검 내용을 확인한 후 확인란을 선택해 주세요.',true);$('customerConsent').focus();return;}
    if(ink<5){say('서명 칸에 손가락으로 서명해 주세요.',true);return;}
    busy=true;$('submitSignature').disabled=true;$('clearSignature').disabled=true;$('customerName').disabled=true;$('customerConsent').disabled=true;
    submission=submission||{name,confirmed:true,signature:signature(),submissionId:crypto.randomUUID()};
    try{say('서명을 접수하고 PDF를 준비하고 있습니다…');renderState(await api('sign',submission));}
    catch(e){error(e);$('customerRetry').hidden=false;}
    finally{busy=false;if(current?.state==='pending'){$('submitSignature').disabled=false;$('clearSignature').disabled=false;$('customerName').disabled=false;$('customerConsent').disabled=false;}countdown();}
  };
  $('downloadSignedPdf').onclick=async()=>{
    if(busy)return;busy=true;$('downloadSignedPdf').disabled=true;
    try{const blob=await api('download',null,true),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(current.documentNo||'서명된_점검내역서')+'.pdf';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);say('PDF 다운로드를 시작했습니다. 휴대폰의 다운로드 목록을 확인해 주세요.');}
    catch(e){error(e);}finally{busy=false;$('downloadSignedPdf').disabled=false;countdown();}
  };
  $('customerRetry').onclick=check;
  $('reviewZoom').onclick=()=>{const on=$('reviewPages').classList.toggle('qr-zoom');$('reviewZoom').setAttribute('aria-pressed',String(on));$('reviewZoom').textContent=on?'화면에 맞추기':'확대 보기';};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
  if(!id||!/^[a-f0-9-]{36}$/.test(id)||!token||!/^[a-f0-9]{64}$/.test(token))say('유효한 문서 링크가 아닙니다. 담당 직원이 보여 주는 QR로 접속해 주세요.',true);
  else {timer=setInterval(countdown,1000);check();}
})(window);
