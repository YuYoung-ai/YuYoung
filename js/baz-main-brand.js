(function(){
 'use strict';
 var paths={hospitalqr:'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h-2zM19 19h2v2h-2zM12 12h5m-5 0v5',customeras:'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5',hospitalwork:'M3 7h18v14H3zM8 7V3h8v4M3 12h18',reservations:'M4 5h16v16H4zM8 3v4m8-4v4M4 10h16M8 14h2m4 0h2m-8 3h2',survey:'m8 12 3 3 5-6M4 3h16v18H4z',report:'M5 3h14v18H5zM9 7h6m-6 5h6m-6 5h4',inspection:'M9 3h6v3H9zM9 5H5v16h14V5h-4M8 12l2 2 5-5',guide:'M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3zM12 6v16',handover:'M8 5H4v16h16v-4M12 3h9v9M21 3l-9 9',hospital:'M4 21V5h16v16M9 9h6m-3-3v6M9 21v-5h6v5',dashboard:'M4 20V10m8 10V4m8 16v-7M2 22h20',label:'M3 3h8l10 10-8 8L3 11zM7 7h.01'};
 document.querySelectorAll('#appSelectStage .hub-tool').forEach(function(button){
  var slot=button.firstElementChild;if(!slot||slot.tagName!=='SPAN'||!slot.nextElementSibling)return;
  slot.removeAttribute('style');slot.classList.add('hub-icon');slot.setAttribute('aria-hidden','true');slot.textContent='';
  var svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS(svg.namespaceURI,'path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.6');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');path.setAttribute('d',paths[button.dataset.toolid]||paths.report);svg.append(path);slot.append(svg);
 });
 document.querySelectorAll('#langSelect .tool-desc,#hubLogo>div,#hubLangSwitch button,#lockHint>div,#chooseToolText,#langSelect .hub-tool>span:last-child').forEach(function(el){el.style.removeProperty('color');});
})();
