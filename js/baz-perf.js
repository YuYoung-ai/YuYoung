(function(root){
 'use strict';
 const samples=[],allowed=/^(lcp_candidate|interaction_duration|layout_shift|tab_paint|screen|search|photos|pdf_(libraries|source|body(_(prefetch|clone|draw|encode|timeout))?|photos|assemble|total|draft_save|delivery_(sheet|sheet_response|sheet_check|link|queue|prepare|local_save|total|incomplete|batch))|work_[a-z_]+|qr_(config|cases|case|customer_info|customer_status|customer_create|customer_survey_link)|inspection_pdf_(resolve|upload|job_(source|lookup|submit|status|resume)))$/;
 const deliveryStages=['jobRead','validateBytes','lockWait','lockHeld','source','target','driveId','driveUpload','driveVerify','driveLink',
  'sheetLinkCheck','sheetLink','cacheDrop','driveShare','jobWrite','comment',
  'workTarget','workRegistration','workConfirmation'];
 function record(name,ms,extra){
  if(!allowed.test(name)||!Number.isFinite(ms))return;
  const item={name,ms:name==='layout_shift'?Math.round(ms*10000)/10000:Math.round(ms*10)/10};
  for(const k of ['count','bytes','pass','worker','serverMs','googleMs'])if(Number.isFinite(extra?.[k]))item[k]=extra[k];
  if(name==='pdf_body_timeout'&&typeof extra?.cloneReady==='boolean')item.cloneReady=extra.cloneReady;
  if(/^inspection_pdf_job_(submit|resume)$/.test(name)){
   for(const stage of deliveryStages){
    const value=extra?.stageTimings?.[stage];
    if(Number.isFinite(value)&&value>=0)item[stage+'Ms']=Math.round(value);
   }
  }
  if(typeof extra?.jobId==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(extra.jobId))item.jobId=extra.jobId;
  if(/^(pdf_delivery_(sheet|sheet_response|sheet_check|link)|work_inspection_source_link)$/.test(name)&&
    typeof extra?.recordId==='string'&&/^[a-f0-9]{32}$/i.test(extra.recordId))item.recordId=extra.recordId;
  if(name==='pdf_delivery_batch'&&typeof extra?.completed==='boolean')item.completed=extra.completed;
  samples.push(item);if(samples.length>200)samples.shift();
  if(name==='pdf_delivery_batch')return {...item};
 }
 function start(name,at=performance.now()){return extra=>record(name,performance.now()-at,extra);}
 function report(){return [...new Set(samples.map(x=>x.name))].map(name=>{const values=samples.filter(x=>x.name===name).map(x=>x.ms).sort((a,b)=>a-b);return {name,count:values.length,unit:name==='layout_shift'?'score':'ms',mean:Math.round(values.reduce((a,b)=>a+b,0)/values.length*10000)/10000,p95:values[Math.ceil(values.length*.95)-1]};});}
 try{new PerformanceObserver(list=>{for(const e of list.getEntries())record('lcp_candidate',e.startTime);}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)record('layout_shift',e.value);}).observe({type:'layout-shift',buffered:true});new PerformanceObserver(list=>{for(const e of list.getEntries())if(e.interactionId)record('interaction_duration',e.duration);}).observe({type:'event',buffered:true,durationThreshold:40});}catch{}
 root.BazPerf={start,report,samples:()=>samples.map(x=>({...x}))};
 function screen(){setTimeout(()=>{const nav=performance.getEntriesByType('navigation')[0];if(nav)record('screen',nav.domContentLoadedEventEnd);},0);}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',screen,{once:true});else screen();
})(window);
