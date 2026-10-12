(function(root){
  'use strict';
  function serials(v){return Array.from(new Set(String(v||'').normalize('NFKC').toUpperCase().split(/[,;\s/|、，]+/).filter(Boolean)));}
  function serialMatch(a,b){return serials(a).some(function(sn){return serials(b).includes(sn);});}
  function kind(v){var s=String(v||'').normalize('NFKC').trim();return /^a\s*\/?\s*s$/i.test(s)?'A/S':s;}
  function hospital(r,hospitals){
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
  var api={hospital:hospital,terms:terms,range:range,matches:matches,serials:serials,serialMatch:serialMatch,kind:kind};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.BazWorkFields=api;
})(typeof window==='object'?window:globalThis);
