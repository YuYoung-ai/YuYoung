(function(global){
  'use strict';
  // The generated PDF stays on this device. Sharing never uploads it to our server.
  const button=document.getElementById('pdfShareButton');
  const status=document.getElementById('pdfShareStatus');
  const sizeLabel=document.getElementById('doneFsize');
  const MAX_BYTES=300*1000*1000; // Ordinary KakaoTalk file attachment limit; no subscription required.
  let snapshot=null;
  function supported(file){
    try{return !!file && typeof navigator.share==='function' && typeof navigator.canShare==='function' && navigator.canShare({files:[file]});}
    catch(e){return false;}
  }
  function message(s,text){if(snapshot===s)status.textContent=text;}
  function capture(blob,filename,save){
    if(blob.size>MAX_BYTES)throw new Error('PDF가 카카오톡 첨부 한도 300MB를 넘습니다. 사진을 줄인 뒤 다시 생성해 주세요.');
    let file=null;
    try{file=new File([blob],filename,{type:'application/pdf'});}catch(e){}
    snapshot={file,save,busy:false};
    sizeLabel.textContent=blob.size<1000000?Math.ceil(blob.size/1000)+' KB':(blob.size/1000000).toFixed(1)+' MB';
    button.disabled=false;
    message(snapshot,supported(file)?'공유창에서 카카오톡과 받는 사람을 선택해 주세요.':'이 기기에서는 버튼을 누르면 PDF가 저장됩니다. 저장한 파일을 카카오톡에 첨부해 주세요.');
  }
  async function download(s,failed){
    try{
      await s.save();
      message(s,(failed?'공유창을 열지 못해 PDF를 저장했습니다. ':'PDF를 저장했습니다. ')+'카카오톡 대화에서 파일 첨부로 전달해 주세요.');
    }catch(e){message(s,'PDF를 저장하지 못했습니다. 파일 공유 버튼을 다시 눌러 주세요.');}
  }
  async function share(){
    const s=snapshot;
    if(!s || s.busy)return;
    s.busy=true;button.disabled=true;
    try{
      if(supported(s.file)){
        // Keep this call inside the click event, before any await, for user activation.
        await navigator.share({files:[s.file]});
        message(s,'파일 공유창을 이용했습니다. 카카오톡에서 전송 상태를 확인해 주세요.');
      }else await download(s,false);
    }catch(e){
      if(e.name==='AbortError')message(s,'공유가 취소되었습니다. 다시 공유하려면 버튼을 눌러 주세요.');
      else await download(s,true);
    }finally{
      s.busy=false;
      if(snapshot===s)button.disabled=false;
    }
  }
  button.addEventListener('click',share);
  global.BazInspectionShare={capture,reset(){snapshot=null;button.disabled=true;status.textContent='';}};
})(window);
