(function(root){
 'use strict';
 const samples=[],allowed=/^(screen|search|photos|pdf_(libraries|source|body|photos|assemble|total)|work_[a-z_]+|inspection_pdf_(resolve|upload))$/;
 function record(name,ms,extra){if(!allowed.test(name)||!Number.isFinite(ms))return;const item={name,ms:Math.round(ms*10)/10};for(const k of ['count','bytes','pass','worker','serverMs','googleMs'])if(Number.isFinite(extra?.[k]))item[k]=extra[k];samples.push(item);if(samples.length>200)samples.shift();}
 function start(name){const at=performance.now();return extra=>record(name,performance.now()-at,extra);}
 function report(){return [...new Set(samples.map(x=>x.name))].map(name=>{const values=samples.filter(x=>x.name===name).map(x=>x.ms).sort((a,b)=>a-b);return {name,count:values.length,mean:Math.round(values.reduce((a,b)=>a+b,0)/values.length*10)/10,p95:values[Math.ceil(values.length*.95)-1]};});}
 root.BazPerf={start,report,samples:()=>samples.map(x=>({...x}))};
 function screen(){setTimeout(()=>{const nav=performance.getEntriesByType('navigation')[0];if(nav)record('screen',nav.domContentLoadedEventEnd);},0);}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',screen,{once:true});else screen();
})(window);
