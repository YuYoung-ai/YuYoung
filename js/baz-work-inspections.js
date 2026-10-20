(function(root){
 'use strict';
 function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 function paymentLabel(value){return {paid:'유상 확정',free:'무상 확정',unknown:'미확정'}[value]||'미확정';}
 function create(options){
  var entries=new Map(),failed=new Set(),inflight=new Set(),host=null,requests=[],timer=null;
  var ready=options.cache.detail(options.account,'inspection-links-v3').then(function(saved){
   (saved&&Array.isArray(saved.items)?saved.items:[]).forEach(function(x){if(x&&x.requestId)entries.set(x.requestId,x);});
  }).catch(function(){});
  function signature(r){return r.id+':'+r.revision;}
  function draw(){
   if(!host)return;
   var current=new Map(requests.map(function(r){return [r.id,r];}));
   host.querySelectorAll('[data-work-summary], [data-work-payment]').forEach(function(node){
    var id=node.dataset.workSummary||node.dataset.workPayment,r=current.get(id);if(!r)return;
    var item=entries.get(id),valid=item&&item.revision===r.revision,summary=valid&&item.schema===3;
    var parts=summary&&Array.isArray(item.resultItems)?item.resultItems:[];
    if(node.dataset.workSummary){
     if(parts.length>1)node.innerHTML=parts.map(function(part){var payment=['paid','free'].includes(part.payment)?part.payment:'unknown';return '<span class="hospital-treatment-result"><span>처리 항목 · '+esc(part.treatment||'미등록')+'<small>'+esc([part.date,part.sn?'S/N '+part.sn:'장비 미기록'].filter(Boolean).join(' · '))+'</small></span><span class="hospital-payment" data-payment="'+payment+'">'+paymentLabel(payment)+'</span></span>';}).join('');
     else node.textContent='처리 항목 · '+(summary?item.treatment||'미등록':valid||failed.has(signature(r))?'다시 확인 필요':'확인 중…');
    }else {var payment=summary&&['paid','free'].includes(item.payment)?item.payment:'unknown';node.dataset.payment=summary?(parts.length>1?'mixed':payment):'loading';node.textContent=summary?(parts.length>1?'항목별 구분':paymentLabel(payment)):valid||failed.has(signature(r))?'확인 필요':'확인 중…';}
   });
   host.querySelectorAll('[data-inspection-request]').forEach(function(node){
    var r=current.get(node.dataset.inspectionRequest);if(!r)return;
    var item=entries.get(r.id),valid=item&&item.revision===r.revision;
    if(valid){var markup=item.attachment&&root.BazWorkComments.renderPdf(item.attachment);node.innerHTML=markup||'<span class="inspection-empty">—</span>';}
    else if(failed.has(signature(r)))node.innerHTML='<button type="button" class="inspection-retry" data-inspection-retry="'+r.id+'">내역서 다시 확인</button>';
    else node.innerHTML='<span class="inspection-loading">내역서 확인 중…</span>';
   });
  }
  async function load(){
   timer=null;await ready;
   var batch=requests.filter(function(r){var x=entries.get(r.id);return !r.purgedAt&&(!x||x.schema!==3||x.revision!==r.revision)&&!inflight.has(signature(r))&&!failed.has(signature(r));}).slice(0,50);
   if(!batch.length){draw();return;}
   batch.forEach(function(r){inflight.add(signature(r));});
   try{
    var result=await options.api.get('work_inspection_links',{requestIds:batch.map(function(r){return r.id;})});
    if(root.BazAuth.name()!==options.account)return;
    if(!result.success||!Array.isArray(result.items))throw new Error(result.error||'내역서 조회 실패');
    batch.forEach(function(r){var item=result.items.find(function(x){return x.requestId===r.id&&x.revision===r.revision;}),old=entries.get(r.id);if(item){if(!old||old.revision<=item.revision){entries.delete(r.id);entries.set(r.id,item);}}else failed.add(signature(r));});
    while(entries.size>300)entries.delete(entries.keys().next().value);
    options.cache.saveDetail(options.account,'inspection-links-v3',{items:Array.from(entries.values())}).catch(function(){});
   }catch(e){batch.forEach(function(r){failed.add(signature(r));});}
   finally{batch.forEach(function(r){inflight.delete(signature(r));});draw();}
  }
  function hydrate(node,rows){host=node;requests=rows;draw();if(timer!==null)clearTimeout(timer);timer=setTimeout(load,250);}
  return {hydrate:hydrate,retry:function(id){requests.filter(function(r){return r.id===id;}).forEach(function(r){failed.delete(signature(r));});hydrate(host,requests);},forget:function(id){entries.delete(id);}};
 }
 root.BazWorkInspections={create:create};
})(window);
