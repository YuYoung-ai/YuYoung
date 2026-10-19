(function(root){
  'use strict';
  function serials(v){return Array.from(new Set(String(v||'').normalize('NFKC').toUpperCase().split(/[,;\s/|、，]+/).filter(Boolean)));}
  function serialMatch(a,b){return serials(a).some(function(sn){return serials(b).includes(sn);});}
  function kind(v){var s=String(v||'').normalize('NFKC').trim();return /^a\s*\/?\s*s$/i.test(s)?'A/S':s;}
  // Build once per DB snapshot; preserve ambiguous-match handling.
  function hospitalLookup(hospitals){
    var keys=new Map(),names=new Map(),serial=new Map();
    function add(map,key,h){var rows=map.get(key);if(rows)rows.push(h);else map.set(key,[h]);}
    hospitals.forEach(function(h){
      if(h.origin==='flow')return;
      add(keys,h.key,h);add(names,JSON.stringify([h.name,String(h.region||'')]),h);
      add(serial,String(h.sn||'').trim(),h);
    });
    return function(r){
      var exact=keys.get(r.hospitalKey)||[];
      if(exact.length===1)return exact[0];
      var parts=String(r.hospitalKey||'').split('\u001f'),name=r.hospitalName||(parts.length===3?parts[0]:''),region=r.region!=null?r.region:(parts.length===3?parts[2]:'');
      if(name){
        var same=names.get(JSON.stringify([name,String(region||'')]))||[];
        if(same.length===1)return same[0];
        if(same.length>1){var device=same.filter(function(h){return serialMatch(h.sn,r.hospitalReferenceSN||r.sn||parts[1]);});return device.length===1?device[0]:null;}
      }
      var sn=String(r.hospitalReferenceSN||r.sn||'').trim(),matches=sn?(serial.get(sn)||[]):[];
      return matches.length===1?matches[0]:null;
    };
  }
  function hospital(r,hospitals){
    if(typeof hospitals==='function')return hospitals(r);
    var db=hospitals.filter(function(h){return h.origin!=='flow';});
    var exact=db.filter(function(h){return h.key===r.hospitalKey;});
    if(exact.length===1)return exact[0];
    var parts=String(r.hospitalKey||'').split('\u001f'),name=r.hospitalName||(parts.length===3?parts[0]:''),region=r.region!=null?r.region:(parts.length===3?parts[2]:'');
    if(name){
      var same=db.filter(function(h){return h.name===name&&String(h.region||'')===String(region||'');});
      if(same.length===1)return same[0];
      if(same.length>1){var device=same.filter(function(h){return serialMatch(h.sn,r.hospitalReferenceSN||r.sn||parts[1]);});return device.length===1?device[0]:null;}
    }
    var sn=String(r.hospitalReferenceSN||r.sn||'').trim();
    if(!sn)return null;
    var matches=db.filter(function(h){return String(h.sn||'').trim()===sn;});
    return matches.length===1?matches[0]:null;
  }
  function terms(r,hospitals){
    var h=hospital(r,hospitals),overrides=r.serviceOverrides||{};
    return {asType:overrides.asType||(h?h.asType||'미기록':'미확인'),ncare:overrides.ncare||(h?h.ncare||'미기록':'미확인')};
  }
  function range(filter,date,month){
    if(filter==='month')return [month+'-01',new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10)];
    if(filter!=='week'&&filter!=='lastweek')return null;
    var d=new Date(date+'T12:00:00Z'),offset=(d.getUTCDay()+6)%7+(filter==='lastweek'?7:0);
    d.setUTCDate(d.getUTCDate()-offset);var start=d.toISOString().slice(0,10);d.setUTCDate(d.getUTCDate()+6);
    return [start,d.toISOString().slice(0,10)];
  }
  function matches(r,filters,hospitals){
    var t=terms(r,hospitals),h=hospital(r,hospitals),day=String(r.visitAt||'').slice(0,10);
    return Object.keys(filters).every(function(key){
      var values=filters[key];if(!values.length)return true;
      var value=key==='year'?day.slice(0,4):key==='month'?String(Number(day.slice(5,7))):key==='quarter'?String(Math.ceil(Number(day.slice(5,7))/3)):key==='asType'||key==='ncare'?t[key]:key==='sales'?r.sales||(h&&h.sales)||'':key==='gubun'?kind(r.gubun):r[key]||'';
      return values.includes(value);
    });
  }
  function query(r,q,hospitals){
    if(r.purgedAt||!!r.deletedAt!==(q.filter==='trash'))return false;
    if(q.filter!=='trash'&&!workspace(r,q.view,q.engineer))return false;
    if(q.status&&r.status!==q.status||!matches(r,q.advanced,hospitals))return false;
    if(q.statusScope==='active'&&!['접수','방문예정','처리중'].includes(r.status))return false;
    if(q.statusScope==='review'&&r.status!=='결과확인'||q.statusScope==='completed'&&r.status!=='완료')return false;
    var day=String(r.visitAt||'').slice(0,10),period=range(q.filter,q.today,q.month);
    if(period&&(!day||day<period[0]||day>period[1]))return false;
    if(q.search&&![q.name||r.hospitalName,r.symptom,r.cs,r.engineer,r.sales].join(' ').toLowerCase().includes(String(q.search).toLowerCase()))return false;
    if(q.filter==='active')return !['완료','취소'].includes(r.status);
    if(q.filter==='today')return day===q.today;
    if(q.filter==='mine')return r.status!=='취소'&&(r.cs===q.account||r.engineer===q.account);
    if(q.filter==='unassigned')return r.status!=='취소'&&(!r.engineer||!r.visitAt);
    if(q.filter==='review')return r.status==='결과확인';
    if(q.filter==='completed')return r.status==='완료';
    return true;
  }
  function counts(requests,q,hospitals){
    var base=Object.assign({},q,{status:'',statusScope:'all',advanced:Object.assign({},q.advanced,{status:[]})});
    var scoped=requests.filter(function(r){var h=hospital(r,hospitals);return query(r,Object.assign({},base,{name:h?h.name:r.hospitalName}),hospitals);});
    return {total:scoped.length,active:scoped.filter(function(r){return ['접수','방문예정','처리중'].includes(r.status);}).length,review:scoped.filter(function(r){return r.status==='결과확인';}).length,completed:scoped.filter(function(r){return r.status==='완료';}).length,globalReview:requests.filter(function(r){return !r.deletedAt&&!r.purgedAt&&r.status==='결과확인';}).length};
  }
  function workspace(r,view,engineer){
    if(view==='mine')return !!engineer&&r.engineer===engineer;
    if(view==='attention')return r.status==='결과확인'||r.handoverReviewCount>0||(!['완료','취소'].includes(r.status)&&!r.engineer);
    if(view==='unassigned')return !['완료','취소'].includes(r.status)&&!r.engineer;
    if(view==='changed')return r.handoverReviewCount>0;
    return true;
  }
  var api={hospitalLookup:hospitalLookup,hospital:hospital,terms:terms,range:range,matches:matches,query:query,counts:counts,workspace:workspace,serials:serials,serialMatch:serialMatch,kind:kind};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.BazWorkFields=api;
})(typeof window==='object'?window:globalThis);
