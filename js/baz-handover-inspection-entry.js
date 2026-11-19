(function(){
 'use strict';
 const route=BazWorkFlow.route(location.search);
 if(!route)return;
 const legacy=document.getElementById('legacyHandover'),frame=document.getElementById('inspectionForm');
 legacy.textContent='기존 Handover로 작성';
 legacy.href=BazWorkFlow.url('handover.html',route.requestId);
 legacy.target='_blank';
 legacy.rel='noopener';
 const params=new URLSearchParams({combined:route.requestId});
 document.getElementById('entryMessage').hidden=true;
 frame.hidden=false;
 frame.src='inspection.html?'+params;
 const nav=document.getElementById('entryNav');
 function resize(){document.documentElement.style.setProperty('--nav-height',nav.offsetHeight+'px');}
 resize();
 new ResizeObserver(resize).observe(nav);
})();
