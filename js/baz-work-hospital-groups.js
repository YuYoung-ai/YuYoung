(function(root){
  'use strict';
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function normalized(value){return String(value||'').normalize('NFKC').replace(/[\s_]+/g,'').toLowerCase();}
  function group(rows,display){
    var groups=new Map();
    rows.forEach(function(r){
      var h=display(r),name=String(h.hospitalName||'').trim(),region=String(h.region||'').trim();
      // Equipment serials are deliberately excluded. Branch names and regions remain distinct.
      var key=name?JSON.stringify([normalized(name),normalized(region)]):JSON.stringify(['unknown',r.hospitalId||r.id]);
      var item=groups.get(key);
      if(!item){item={key:key,name:name||'병원명 미기록',region:region,rows:[],active:0,completed:0};groups.set(key,item);}
      item.rows.push(r);if(!['완료','취소'].includes(r.status))item.active++;if(r.status==='완료')item.completed++;
    });
    return Array.from(groups.values());
  }
  function create(){
    var selected='',directoryPage=1,groups=[];
    function render(rows,options){
      groups=group(rows,options.display);
      var index=groups.findIndex(function(g){return g.key===selected;});
      if(index<0){index=0;selected=groups[0]?.key||'';options.page=1;directoryPage=1;}
      var directoryPages=Math.max(1,Math.ceil(groups.length/50));directoryPage=Math.min(directoryPage,directoryPages);
      var current=groups[index],pages=Math.max(1,Math.ceil((current?.rows.length||0)/50)),page=Math.min(options.page,pages);
      var shown=current?current.rows.slice((page-1)*50,page*50):[];
      if(!current)return {html:'<div class="empty"><strong>조건에 맞는 병원 이력이 없습니다.</strong>검색어나 기간·상태 조건을 변경해 보세요.</div>',shown:[],page:1,pages:1,count:0};
      var directory=groups.slice((directoryPage-1)*50,directoryPage*50).map(function(g,i){
        return '<button type="button" class="hospital-group-choice" data-hospital-group="'+((directoryPage-1)*50+i)+'" aria-pressed="'+String(g.key===selected)+'"><strong>'+esc(g.name)+'</strong><span>'+esc(g.region||'지역 미기록')+'</span><span class="hospital-group-count">전체 '+g.rows.length+'건 · 미완료 '+g.active+'<time>'+esc(String(g.rows[0].visitAt||'').slice(5,10).replace('-','.')||'일정 미정')+'</time></span></button>';
      }).join('');
      var sales=Array.from(new Set(current.rows.map(options.sales).filter(function(s){return s&&s!=='미기록';})));
      var html='<section class="hospital-groups" aria-label="병원별 처리 이력"><aside class="hospital-group-directory" aria-label="병원 목록"><p class="hospital-group-label">병원 목록 · '+groups.length+'곳</p>'+directory+(directoryPages>1?'<div class="hospital-directory-pager"><button type="button" data-hospital-directory="-1"'+(directoryPage===1?' disabled':'')+'>이전</button><span>'+directoryPage+' / '+directoryPages+'</span><button type="button" data-hospital-directory="1"'+(directoryPage===directoryPages?' disabled':'')+'>다음</button></div>':'')+'</aside><section class="hospital-group-history" aria-label="'+esc(current.name)+' 처리 이력"><header class="hospital-group-heading"><h3>'+esc(current.name)+'</h3><p>전체 '+current.rows.length+'건 · 미완료 '+current.active+' · 완료 '+current.completed+(sales.length?' · 영업 담당자 '+esc(sales.join(', ')):'')+'</p></header><ol class="hospital-timeline">'+shown.map(function(r){
        var h=options.display(r);
        return '<li class="hospital-timeline-event"><div class="hospital-event-heading"><time>'+esc(options.time(r.visitAt))+'</time><span class="badge status-badge hospital-event-status" data-work-status="'+esc(r.status)+'">'+esc(r.status)+'</span><span class="hospital-payment" data-work-payment="'+esc(r.id)+'" data-payment="loading" role="status">확인 중…</span></div><button type="button" class="hospital-event-open" data-open="'+esc(r.id)+'">'+esc(r.symptom||'접수 증상 미기록')+'</button><p class="hospital-treatment" data-work-summary="'+esc(r.id)+'">처리 항목 · 확인 중…</p>'+(h.sn?'<p class="hospital-equipment">장비 S/N · '+esc(h.sn)+'</p>':'')+'<div class="hospital-event-footer"><p>엔지니어 '+esc(r.engineer||'미배정')+' · CS 접수 '+esc(r.cs||'미기록')+'</p><div class="recent-inspection" data-inspection-request="'+esc(r.id)+'"><span class="inspection-loading">내역서 확인 중…</span></div></div></li>';
      }).join('')+'</ol></section></section>';
      return {html:html,shown:shown,page:page,pages:pages,count:groups.length};
    }
    return {render:render,select:function(index){if(!groups[index])return false;selected=groups[index].key;return true;},moveDirectory:function(delta){directoryPage=Math.max(1,Math.min(Math.ceil(groups.length/50),directoryPage+delta));},reset:function(){selected='';directoryPage=1;}};
  }
  var api={group:group,create:create};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.BazWorkHospitalGroups=api;
})(typeof window==='object'?window:globalThis);
