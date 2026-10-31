/* Weekly report editor, reusable symptom descriptions and matching PPT display list. */
(function(root){
 'use strict';
 var drafts=Object.create(null),phrases=Object.create(null),loading=null;
 var NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main',templates={};
 function key(s){return root.exVocDescKey_(s);}
 function period(){return root.exReportPeriodFromSel_('week');}
 function draft(p){p=p||period();if(!p)return {descs:{},notes:['','']};var k=p.from+'_'+p.to;return drafts[k]||(drafts[k]={descs:Object.create(null),notes:['','']});}
 function desc(name,d){var k=key(name);return Object.prototype.hasOwnProperty.call(d.descs,k)?d.descs[k]:(phrases[k]?phrases[k].text:root.EX_VOC_DESC[k]||'');}
 function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
 function button(text,fn){var b=el('button','wr-button',text);b.type='button';b.onclick=fn;return b;}
 function tell(e){root.toast(e&&e.message||String(e));}
 function plain(s){return root.exNotePlain_(s||'');}
 async function loadPhrases(){
  if(loading)return loading;
  loading=root.gv('report_phrases',{},15000).then(function(r){if(!r.success)throw new Error(r.error||'기본 문구 조회 실패');phrases=Object.create(null);(r.items||[]).forEach(function(x){phrases[key(x.name)]=x;});refreshVoc();}).catch(function(e){tell('공유 기본 문구를 불러오지 못했습니다. '+(e.message||e));}).finally(function(){loading=null;});return loading;
 }
 async function savePhrase(name,input,badge,b){
  var text=input.value.trim().replace(/\s+/g,' ');if(!text){tell('저장할 보조문구를 입력하세요.');return;}
  var k=key(name),currentDraft=draft(),previous=phrases[k],body={action:'report_phrase_save',token:root.BazAuth.token(),name:name,text:text,revision:previous?previous.revision:0};b.disabled=true;
  try{var response=await fetch(root.HANDOVER_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(body)}),r=await response.json();if(!r.success)throw new Error(r.error||'기본 문구 저장 실패');phrases[k]=r.item;currentDraft.descs[k]=text;badge.textContent='등록 문구 자동 입력';badge.className='wr-status';tell('기본 문구를 저장했습니다. 같은 증상에 자동 입력됩니다.');}
  catch(e){tell(e);}finally{b.disabled=false;}
 }
 function rowsFor(p){var s=root.buildExecutiveReportSnapshot({type:'week',from:p.from,to:p.to});return s.change.up;}
 function refreshVoc(){
  var p=period(),host=document.getElementById('wkVocDescRows');if(!host||!p)return;
  var d=draft(p),rows=rowsFor(p);host.replaceChildren();
  document.querySelector('#wkVocDescBox summary').textContent='VOC 증가 현황 · 보조문구';
  var help=document.querySelector('#wkVocDescBox .voc-desc-help');help.textContent='등록 증상은 기본 문구 자동 입력 · 미등록 증상은 작성 후 저장 · 증가 유형 최대 3개';
  if(!rows.length)host.append(el('p','voc-desc-empty','전주 대비 증가한 A/S 유형이 없습니다.'));
  rows.forEach(function(r,i){
   var box=el('section','wr-voc'),head=el('div','wr-head'),v=desc(r.k,d),registered=!!(phrases[key(r.k)]||root.EX_VOC_DESC[key(r.k)]),badge=el('span',registered?'wr-status':'wr-status missing',registered?'등록 문구 자동 입력':'미등록 증상');
   head.append(el('strong','',String(i+1)+'. '+r.k),el('span','wr-delta',r.prev+' → '+r.cur+'건 · ▲ +'+r.d));box.append(head,badge);
   var label=el('label','wr-label','보조문구'),input=el('textarea','wr-desc');input.rows=2;input.maxLength=90;input.value=v;input.placeholder='증상에 대한 기본 설명을 작성하세요';input.setAttribute('aria-label',r.k+' 보조문구');input.oninput=function(){d.descs[key(r.k)]=input.value;};label.append(input);box.append(label);
   var save=button('기본 문구로 저장',function(){savePhrase(r.k,input,badge,save);});box.append(save,el('small','wr-hint','저장한 문구는 다음 보고서의 같은 증상에 자동 입력됩니다.'));
   box.append(el('small','wr-hint','A/S·점검 내역서 PDF는 생성한 PPT에서 직접 삽입하세요.'));host.append(box);
  });
  var section=el('section','wr-management');section.append(el('strong','','교육·노즐 재사용 병원 현황'),el('p','wr-hint','선택 기간의 명단을 제공 양식의 엑셀로 다운로드합니다. 생성한 PPT에서 직접 삽입하세요.'));
  section.append(button('사용자 교육 현황.xlsx 다운로드',function(){previewWorkbook('education');}),button('노즐 재사용 현황.xlsx 다운로드',function(){previewWorkbook('nozzle');}));host.append(section);document.getElementById('wkVocDescBox').open=true;
 }
 function refreshNotes(){
  var host=document.getElementById('wkNoteRows');if(!host)return;var d=draft();host.replaceChildren();
  document.querySelector('#wkNoteBox summary').textContent='특이사항 작성 · 최대 두 줄';document.querySelector('#wkNoteBox .voc-desc-help').textContent='작성한 내용만 PPT 하단에 반영합니다. 입력하지 않으면 빈칸으로 둡니다.';
  var reset=document.querySelector('#wkNoteBox .note-reset');reset.textContent='입력 지우기';reset.onclick=function(){d.notes=['',''];refreshNotes();};
  for(var i=0;i<2;i++)(function(i){var label=el('label','wr-label','특이사항 '+(i+1)),input=el('input','wr-note');input.type='text';input.value=d.notes[i];input.maxLength=120;input.setAttribute('aria-label','특이사항 '+(i+1));input.oninput=function(){d.notes[i]=input.value;};label.append(input);host.append(label);})(i);
  document.getElementById('wkNoteBox').open=true;
 }
 function management(rows,prev){
  var hasPrevious=prev&&prev.length>0;
  var skill=root.buildSkillData(rows),nz=root.buildNozzleData(rows),ps=hasPrevious&&root.buildSkillData(prev),pn=hasPrevious&&root.buildNozzleData(prev);
  return {rows:rows,skill:skill,nozzle:nz,items:[{key:'education',name:'교육 필요 병원',sub:'사용자 교육 현황',cur:skill.needCount,prev:ps?ps.needCount:null},{key:'nozzle',name:'노즐 재사용 병원',sub:'노즐 재사용 현황',cur:nz.joined.reuse+nz.nonJoined.reuse,prev:pn?pn.joined.reuse+pn.nonJoined.reuse:null}]};
 }
 function augment(s){
  var d=draft(s),rows=root.exWindowRows(new Date(s.from+'T00:00:00'),new Date(s.to+'T23:59:59')),cp=root.buildComparisonPeriod(),prev=root.exPrevRows(cp),as=function(rr){return (rr||[]).filter(function(r){return String(r.gubun||'').trim()==='A/S';});};
  s.change={title:'VOC 증가 현황',basis:'전주 대비 · A/S 기준',hasPrev:!!prev,down:[],up:prev?root.exVocTypeCompare_(as(rows),as(prev)).filter(function(t){return t.d>0;}).sort(function(a,b){return b.d-a.d||b.cur-a.cur||root.skCmpKo_(a.k,b.k);}).slice(0,3).map(function(t){return Object.assign({},t,{desc:desc(t.k,d)});}):[]};
  s.notes={title:'특이사항',basis:'',edited:true,items:d.notes.filter(function(t){return t.trim();}).map(function(t){return root.esc(t);})};s.management=management(rows,prev);return s;
 }
 function layout(L){
  return {change:Object.assign({},L.change,{pad:.14,top:.45,pitch:.60,nameW:2.06,descW:2.20,countX:2.34,countW:.75,deltaX:3.12,deltaW:.67,iconX:3.96,iconW:.39,iconH:.47}),management:{x:L.notes.x,y:L.notes.y,w:L.notes.w,h:1.17,pad:.14,top:.35,pitch:.36,nameW:1.95,countX:2.1,countW:.84,deltaX:3.0,deltaW:.70,iconX:3.96,iconW:.30,iconH:.35},notes:{x:L.notes.x,y:L.notes.y+1.27,w:L.notes.w,h:.85,pad:.14,top:.34,lineH:.20}};
 }
 function wrap(text,width,size){var lines=[''];Array.from(String(text)).forEach(function(ch){if(ch==='\r')return;if(ch==='\n'){lines.push('');return;}var i=lines.length-1;if(root.exTxtW_(lines[i]+ch,size)>width&&lines[i])lines.push(ch);else lines[i]+=ch;});return lines;}
 function decorate(s,items){
  var L=root.L,C=root.C,F=root.FT,B=layout(L);
  items=items.filter(function(o){return !((o.x>=L.change.x-.001&&o.y>=L.change.y-.001&&o.y<L.change.y+L.change.h)|| (o.x>=L.notes.x-.001&&o.y>=L.notes.y-.001&&o.y<L.notes.y+L.notes.h));});
  function text(x,y,w,h,t,size,color,bold,extra){items.push(Object.assign({k:'text',x:x,y:y,w:w,h:h,t:t,size:size,color:color||C.navy,bold:!!bold},extra||{}));}
  function rule(T,y){items.push({k:'line',x:T.x+T.pad,y:y,w:T.w-T.pad*2,color:C.line,width:.5});}
  function shell(T,title,basis){items.push({k:'rect',x:T.x,y:T.y,w:T.w,h:T.h,r:.05,fill:C.white,line:{color:C.line,width:1},weeklyCard:title});text(T.x+T.pad,T.y+.07,T.w-T.pad*2,.25,title,10.5,C.navy,true);if(basis)text(T.x+T.w-1.65,T.y+.09,1.5,.19,basis,6.8,C.mut,false,{align:'right'});}
  function delta(T,y,cur,prev){var d=prev==null?null:cur-prev,color=d==null||d===0?C.mut:d>0?C.red:C.green;var t=d==null?'비교 없음':d===0?'전주 동일':(d>0?'▲ +':'▼ −')+Math.abs(d)+'곳';text(T.x+T.countX,y,T.countW,.22,(prev==null?'—':prev)+' → '+cur+'곳',8.5,C.navy,true);text(T.x+T.deltaX,y,T.deltaW,.22,t,8,color,true,{align:'center'});}

  var T=B.change;shell(T,'VOC 증가 현황','전주 대비 · 증가 TOP 3');
  if(!s.change.up.length)text(T.x+T.pad,T.y+.7,T.w-T.pad*2,.3,s.change.hasPrev?'전주 대비 증가한 VOC가 없습니다.':'이전 기간 비교 자료가 없습니다.',9,C.mut);
  s.change.up.forEach(function(r,i){var y=T.y+T.top+i*T.pitch;var name=root.exFitTxt_(r.k,T.nameW,9);text(T.x+T.pad,y,T.nameW,.22,name,9,C.navy,true,{weeklyVoc:i});var ls=wrap(r.desc,T.descW,7);if(ls.length>2)throw new Error(r.k+' 보조문구를 두 줄 이내로 줄여주세요.');ls.forEach(function(l,j){text(T.x+T.pad,y+.24+j*.14,T.descW,.14,l,7,C.mut,false,{weeklyDescription:i});});text(T.x+T.countX,y+.02,T.countW,.22,r.prev+' → '+r.cur+'건',8,C.navy,true);text(T.x+T.deltaX,y+.02,T.deltaW,.22,'▲ +'+r.d,8,C.red,true,{align:'center'});if(i<s.change.up.length-1)rule(T,y+T.pitch-.06);});
  T=B.management;shell(T,'교육·재사용 병원 현황','전주 대비');s.management.items.forEach(function(r,i){var y=T.y+T.top+i*T.pitch;text(T.x+T.pad,y,T.nameW,.20,r.name,8.5,C.navy,true);text(T.x+T.pad,y+.20,T.nameW,.13,r.sub,6.5,C.mut);delta(T,y+.04,r.cur,r.prev);if(!i)rule(T,y+T.pitch-.03);});
  T=B.notes;shell(T,'특이사항');s.notes.items.forEach(function(t,i){var v=plain(t);if(root.exTxtW_(v,9.5)>T.w-T.pad*2)throw new Error('특이사항 '+(i+1)+'번을 한 줄 안에 들어가도록 줄여주세요.');text(T.x+T.pad,T.y+T.top+i*T.lineH,T.w-T.pad*2,T.lineH,v,9.5,C.navy,false,{weeklyNote:i});});
  return items;
 }
 async function template(kind){
  if(!templates[kind])templates[kind]=Promise.all([fetch('assets/report-templates/'+kind+'.xlsx').then(function(r){if(!r.ok)throw new Error('엑셀 양식을 불러오지 못했습니다.');return r.arrayBuffer();}),fetch('assets/report-templates/'+kind+'.json').then(function(r){if(!r.ok)throw new Error('엑셀 양식 설정을 불러오지 못했습니다.');return r.json();})]).catch(function(e){delete templates[kind];throw e;});return templates[kind];
 }
 function sheetXML(s){return new DOMParser().parseFromString(s,'application/xml');}
 function cell(doc,ref,value,style){
  var nodes=Array.from(doc.getElementsByTagNameNS(NS,'c')),c=nodes.find(function(c){return c.getAttribute('r')===ref;});
  if(!c){var rn=ref.match(/\d+/)[0],rows=Array.from(doc.getElementsByTagNameNS(NS,'row')),r=rows.find(function(r){return r.getAttribute('r')===rn;});if(!r){r=doc.createElementNS(NS,'row');r.setAttribute('r',rn);doc.getElementsByTagNameNS(NS,'sheetData')[0].append(r);}c=doc.createElementNS(NS,'c');c.setAttribute('r',ref);r.append(c);}
  c.replaceChildren();c.removeAttribute('t');if(style!=null)c.setAttribute('s',style);if(value==null||value==='')return;
  if(typeof value==='number'){var v=doc.createElementNS(NS,'v');v.textContent=String(value);c.append(v);}else{c.setAttribute('t','inlineStr');var is=doc.createElementNS(NS,'is'),t=doc.createElementNS(NS,'t');t.textContent=String(value);is.append(t);c.append(is);}
 }
 function excelDate(s){if(!s)return null;var d=new Date(String(s).slice(0,10)+'T00:00:00Z');return Number.isFinite(+d)?(+d-Date.UTC(1899,11,30))/86400000:null;}
 async function workbook(s,kind){
  var t=await template(kind),z=await root.JSZip.loadAsync(t[0]),meta=t[1],sum=sheetXML(await z.file('xl/worksheets/sheet1.xml').async('string')),list=sheetXML(await z.file('xl/worksheets/sheet2.xml').async('string'));
  var m=s.management,rows=m.rows,sk=m.skill,nz=m.nozzle,roster=root.exHospitalRoster_(rows),evaluations={},needs={},state=root.nozStateMap_(rows);sk.recs.forEach(function(r){evaluations[root.skNorm_(r.name)]=r;});sk.need.forEach(function(r){needs[root.skNorm_(r.name)]=r.items;});
  cell(sum,'A2','선택 기간: '+s.from.replaceAll('-','.')+'~'+s.to.replaceAll('-','.'));
  cell(sum,'A5',roster.length);if(kind==='education'){cell(sum,'C5',sk.needCount);cell(sum,'E5',sk.evaluated?sk.needCount/sk.evaluated:0);[sk.gFill,sk.gAmt,sk.gJet].forEach(function(g,i){cell(sum,'B'+(9+i),g.total);cell(sum,'C'+(9+i),g.bad);cell(sum,'D'+(9+i),g.total?g.bad/g.total:0);});}else{cell(sum,'C5',nz.joined.reuse+nz.nonJoined.reuse);cell(sum,'E5',nz.joined.total?nz.joined.reuse/nz.joined.total:0);cell(sum,'G5',nz.nonJoined.total?nz.nonJoined.reuse/nz.nonJoined.total:0);[nz.joined,nz.nonJoined].forEach(function(g,i){cell(sum,'B'+(9+i),g.total);cell(sum,'C'+(9+i),g.reuse);cell(sum,'D'+(9+i),g.total?g.reuse/g.total:0);});}
  var data=list.getElementsByTagNameNS(NS,'sheetData')[0];
  roster.forEach(function(r,i){var rn=i+2,prototype=sheetXML(meta.dataRows[i<meta.dataRows.length?i:meta.dataRows.length-2+i%2]).documentElement,row=list.importNode(prototype,true);row.setAttribute('r',rn);Array.from(row.children).forEach(function(c){c.setAttribute('r',c.getAttribute('r').replace(/\d+$/,rn));});data.append(row);var e=evaluations[r.key],st=sk.status[r.key]||'none',noz=state[r.key]?state[r.key].state:'unknown',vals;
   if(kind==='education')vals=[i+1,r.name,st==='need'?'교육 보완 필요':st==='good'?'평가 양호':'미평가',excelDate(r.lastVisit?root.ymd(r.lastVisit):null),e?e.nsFill:'',e?e.nsAmt:'',e?e.jet:'',needs[r.key]?needs[r.key].join(' · '):''];
   else vals=[i+1,r.name,r.joined?'N-Care':'미가입',excelDate(r.lastVisit?root.ymd(r.lastVisit):null),noz==='reuse'?'재사용':noz==='noreuse'?'미재사용':'미평가',noz==='reuse'?'O':noz==='noreuse'?'X':''];
   vals.forEach(function(v,j){var col=String.fromCharCode(65+j);cell(list,col+rn,v);});
   // Status colors are copied from the supplied files' existing green/red cells.
   cell(list,(kind==='education'?'C':'E')+rn,vals[kind==='education'?2:4],(kind==='education'?st==='need':noz==='reuse')?9:7);
  });
  var end=(kind==='education'?'H':'F')+Math.max(1,roster.length+1);list.getElementsByTagNameNS(NS,'dimension')[0].setAttribute('ref','A1:'+end);var af=list.getElementsByTagNameNS(NS,'autoFilter')[0];if(af)af.setAttribute('ref','A1:'+end);
  z.file('xl/worksheets/sheet1.xml',new XMLSerializer().serializeToString(sum));z.file('xl/worksheets/sheet2.xml',new XMLSerializer().serializeToString(list));return z.generateAsync({type:'uint8array',compression:'DEFLATE'});
 }
 async function previewWorkbook(kind,s){try{s=s||root.exReportSnapFromSel_('week');var a=s.management.items.find(function(x){return x.key===kind;}),bytes=await workbook(s,kind);root.BazReportFiles.download(bytes,a.sub+'('+s.from.replaceAll('-','.')+'~'+s.to.replaceAll('-','.')+').xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');}catch(e){tell(e);}}
 function install(){
  var hints=document.querySelectorAll('#wkModal .mhint');if(hints[1])hints[1].textContent='선택한 대상의 최근 16주 추이를 표시합니다. VOC 증가·병원 현황은 전체 서비스 기준으로 집계합니다.';if(hints[2])hints[2].textContent='PDF·엑셀은 PPT 생성 후 직접 삽입하세요. 카드 오른쪽에 파일을 넣을 공간이 남아 있습니다.';
  var originalSnap=root.exReportSnapshot_;root.exReportSnapshot_=function(){var s=originalSnap.apply(this,arguments);return s.type==='week'?augment(s):s;};
  var originalDeck=root.buildExecutivePptDeck;root.buildExecutivePptDeck=function(s){var d=originalDeck(s);if(s.type==='week')d[0].items=decorate(s,d[0].items);return d;};
  var oldVoc=root.exRefreshVocDescEditor_;root.exRefreshVocDescEditor_=function(type){if(type==='week')refreshVoc();else oldVoc(type);};
  var oldNotes=root.exRefreshNoteEditor_;root.exRefreshNoteEditor_=function(type){if(type==='week')refreshNotes();else oldNotes(type);};
  var open=root.openWeekly;root.openWeekly=function(){open();loadPhrases();};
  var preview=root.previewWeeklyPPT;root.previewWeeklyPPT=function(){try{return preview();}catch(e){tell(e);}};
  // Weekly and monthly exports both use the original exMakeReportPPT/writeFile path.
  // Use the same supplied templates for the existing dashboard Excel actions as well.
  ['exportSkillManagementExcel','exportNozzleReuseExcel'].forEach(function(name,i){root[name]=async function(){try{var days=root.EX_ROWS.map(root.rowDate).filter(Boolean).map(root.ymd).sort(),cp=root.buildComparisonPeriod(),s={from:root.F.from||days[0]||root.ymd(root.exBaseDate()),to:root.F.to||days[days.length-1]||root.ymd(root.exBaseDate()),management:management(root.EX_ROWS,root.exPrevRows(cp))};await previewWorkbook(i?'nozzle':'education',s);}catch(e){tell(e);}};});
 }
 root.BazWeeklyReport={install:install,layout:layout,workbook:workbook,management:management,wrap:wrap,loadPhrases:loadPhrases};
 install();
})(window);
