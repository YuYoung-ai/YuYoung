(function(root){
  'use strict';
  function parse(search){var p=new URLSearchParams(search||'');return {receipt:p.get('receipt')==='1',embed:p.get('embed')==='1',name:(p.get('hospital')||'').trim(),sn:(p.get('sn')||'').trim(),region:(p.get('region')||'').trim()};}
  function match(context,hospitals){var rows=(hospitals||[]).filter(function(h){return h.origin!=='flow'&&h.name===context.name&&(!context.sn||String(h.sn||'').trim()===context.sn)&&(!context.region||String(h.region||'').trim()===context.region);});return rows.length===1?rows[0]:null;}
  function url(hospital){var p=new URLSearchParams({receipt:'1',embed:'1'});if(hospital){p.set('hospital',hospital.n||'');p.set('sn',hospital.s||'');p.set('region',hospital.rg||'');}return 'hospital-work.html?'+p;}
  var api={parse:parse,match:match,url:url};if(typeof module==='object'&&module.exports)module.exports=api;else root.BazWorkLaunch=api;
})(typeof window==='object'?window:this);
