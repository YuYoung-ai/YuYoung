/* Weekly and monthly VOC editor, shared descriptions and PPT cards. */
(function(root){
 'use strict';
 var drafts=Object.create(null),phrases=Object.create(null),loading=null;
 var NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main',templates={};
 var VOC_TITLE='VOC 유형',MANAGEMENT_TITLE='교육·재사용 병원 현황',VOC_LIMIT=5;
 var VOC_DESCRIPTIONS={
  '냉각수부족':'냉각수 부족에 의한 냉각 순환 장애 및 에러 발생',
  '무증상':'A/S 방문에서 정상 동작 상태를 확인함'
 };
 function key(s){return root.exVocDescKey_(s);}
 function draft(type,p){
  var k=type+'_'+p.from+'_'+p.to;
  return drafts[k]||(drafts[k]={descriptions:Object.create(null),order:null,merges:new Map()});
 }
 function defaultDesc(k){return phrases[k]?phrases[k].text:VOC_DESCRIPTIONS[k]||root.EX_VOC_DESC[k]||'';}
 function desc(k,d){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:defaultDesc(k);}
 function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
 function button(text,fn){var b=el('button','wr-button',text);b.type='button';b.onclick=fn;return b;}
 function tell(e){root.toast(e&&e.message||String(e));}
 async function loadPhrases(){
  if(loading)return loading;
  loading=root.gv('report_phrases',{},15000).then(function(r){if(!r.success)throw new Error(r.error||'기본 문구 조회 실패');phrases=Object.create(null);(r.items||[]).forEach(function(x){phrases[key(x.name)]=x;});}).catch(function(e){tell('공유 기본 문구를 불러오지 못했습니다. '+(e.message||e));}).finally(function(){loading=null;});return loading;
 }
 async function savePhrase(name,input,badge,b,currentDraft){
  var text=input.value.trim().replace(/\s+/g,' ');if(!text){tell('저장할 보조문구를 입력하세요.');return;}
  var k=key(name),previous=phrases[k],body={action:'report_phrase_save',token:root.BazAuth.token(),name:name,text:text,revision:previous?previous.revision:0};b.disabled=true;
  try{var response=await fetch(root.HANDOVER_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(body)}),r=await response.json();if(!r.success)throw new Error(r.error||'기본 문구 저장 실패');phrases[k]=r.item;currentDraft[k]=text;badge.textContent='등록 문구 자동 입력';badge.className='wr-status';tell('기본 문구를 저장했습니다. 같은 증상에 자동 입력됩니다.');}
  catch(e){tell(e);}finally{b.disabled=false;}
 }
 function noSymptom(type){return key(type)==='무증상'||root.isOK(type);}
 function vocSource(rows){
  var service=rows.filter(function(r){return r.gubun==='A/S';});
  var normalCount=service.filter(function(r){return noSymptom(r.type);}).length;
  var types=root.exVocTypeCompare_(service,null).filter(function(t){return !noSymptom(t.k);})
   .sort(function(a,b){return b.cur-a.cur||root.skCmpKo_(a.k,b.k);});
  var defaults=types.slice(0,VOC_LIMIT-Number(normalCount>0)).map(function(t){return t.k;});
  if(normalCount){
   defaults.push('무증상');
   types.push({k:'무증상',cur:normalCount});
  }
  return {types:types,total:service.length,defaults:defaults};
 }
 function vocSelection(source,d){
  var types=new Map(source.types.map(function(t){return [t.k,t];}));
  var order=(d.order||source.defaults).filter(function(name){return types.has(name);});
  var selected=new Map(order.map(function(name){
   return [name,{name:name,desc:desc(key(name),d.descriptions),count:types.get(name).cur,merged:[]}];
  }));
  var unselected=source.types.filter(function(t){return !selected.has(t.k);});
  unselected.forEach(function(t){
   var target=selected.get(d.merges.get(t.k));
   if(target){target.count+=t.cur;target.merged.push(t.k);}
  });
  selected.forEach(function(row){
   var percent=Math.round(row.count*1000/source.total)/10;
   row.metric=root.exNum(row.count)+'건 · '+percent+'%';
  });
  return {selected:Array.from(selected.values()),unselected:unselected,order:order};
 }
 function inspectionSummary(rows){
  var groups=new Map();
  rows.forEach(function(r){
   if(String(r.gubun||'').trim()!=='점검')return;
   var name=noSymptom(r.type)?'무증상':String(r.type||'').trim()||'증상 미입력';
   var group=groups.get(name)||{name:name,count:0,paid:0,amount:0};
   group.count++;
   if(r._cost>0){group.paid++;group.amount+=r._cost;}
   groups.set(name,group);
  });
  return Array.from(groups.values()).sort(function(a,b){
   return b.count-a.count||root.skCmpKo_(a.name,b.name);
  }).map(function(g){
   var label=g.name+' '+root.exNum(g.count)+'건';
   if(g.paid){
    var subset=g.paid<g.count?root.exNum(g.paid)+'건 · ':'';
    label+=' (유상 판매 '+subset+root.exNum(g.amount)+'원)';
   }
   return label;
  }).join(', ');
 }
 function refreshVoc(type){
  var prefix=type==='month'?'mn':'wk',host=document.getElementById(prefix+'VocDescRows');
  var p=root.exReportPeriodFromSel_(type);
  if(!p){
   host.replaceChildren(el('p','voc-desc-empty','보고 기간을 먼저 선택하세요.'));
   return;
  }
  var s=root.buildExecutiveReportSnapshot({type:type,from:p.from,to:p.to});
  renderVoc(host,s.reportVocSource,draft(type,p));
  document.getElementById(prefix+'VocDescBox').open=true;
 }
 function renderVoc(host,source,d,focusName,focusAction){
  var selection=vocSelection(source,d);
  var order=selection.order,focusTarget;
  function keepFocus(control,name,action){
   if(name===focusName&&action===focusAction&&!control.disabled)focusTarget=control;
  }
  function labeledButton(text,name,fn){
   var b=button(text,fn);
   b.setAttribute('aria-label',name+' '+text);
   return b;
  }
  host.replaceChildren();
  if(!source.types.length){
   host.append(el('p','voc-desc-empty','선택한 기간에 표시할 VOC 유형이 없습니다.'));
   return;
  }
  var grid=el('div','wr-voc-grid'),included=el('section','wr-voc-included'),excluded=el('section','wr-voc-excluded');
  var selectedTitle=el('h3','wr-voc-title','반영 증상 '+order.length+'/'+VOC_LIMIT);
  selectedTitle.tabIndex=-1;
  var toolbar=el('div','wr-voc-heading');
  var reset=button('기본 선택으로 되돌리기',function(){
   d.order=null;d.merges.clear();renderVoc(host,source,d,null,'reset');
  });
  reset.disabled=d.order===null&&d.merges.size===0;
  toolbar.append(selectedTitle,reset);included.append(toolbar);
  if(!order.length)included.append(el('p','voc-desc-empty','미반영 증상에서 반영할 항목을 추가하세요.'));
  selection.selected.forEach(function(r,i){
   var k=key(r.name),box=el('section','wr-voc'),registered=!!defaultDesc(k);
   var badge=el('span',registered?'wr-status':'wr-status missing',registered?'등록 문구 자동 입력':'미등록 증상');
   var heading=el('div','wr-voc-heading');
   var name=el('strong','wr-symptom',r.name);
   name.tabIndex=-1;
   heading.append(name,el('span','wr-voc-metric',r.metric));
   var actions=el('div','wr-voc-actions');
   function move(step,action){
    var next=i+step;
    if(next<0||next>=order.length)return;
    order.splice(i,1);order.splice(next,0,r.name);d.order=order;
    renderVoc(host,source,d,r.name,action);
   }
   var up=labeledButton('위로',r.name,function(){move(-1,'up');});
   var down=labeledButton('아래로',r.name,function(){move(1,'down');});
   up.disabled=i===0;down.disabled=i===order.length-1;
   var remove=labeledButton('제외',r.name,function(){
    d.order=order.filter(function(name){return name!==r.name;});
    d.merges.forEach(function(target,from){if(target===r.name)d.merges.delete(from);});
    renderVoc(host,source,d,r.name,'add');
   });
   actions.append(up,down,remove);
   box.append(heading,actions);
   if(r.merged.length)box.append(el('p','wr-hint','편입 증상 · '+r.merged.join(', ')));
   box.append(badge);
   var label=el('label','wr-label','보조문구'),input=el('textarea','wr-desc');input.rows=2;input.maxLength=90;input.value=r.desc;input.placeholder='증상에 대한 기본 설명을 작성하세요';input.setAttribute('aria-label',r.name+' 보조문구');input.oninput=function(){d.descriptions[k]=input.value;};label.append(input);box.append(label);
   var save=button('기본 문구로 저장',function(){savePhrase(r.name,input,badge,save,d.descriptions);});
   box.append(save,el('small','wr-hint','저장한 문구는 다음 보고서의 같은 증상에 자동 입력됩니다.'));included.append(box);
   keepFocus(up.disabled?down:up,r.name,'up');
   keepFocus(down.disabled?up:down,r.name,'down');
   keepFocus(name,r.name,'selected');
  });
  excluded.append(el('h3','wr-voc-title','미반영 증상'));
  if(order.length===VOC_LIMIT&&selection.unselected.length){
   excluded.append(el('p','wr-hint','다른 증상을 추가하려면 반영 증상에서 한 항목을 제외하세요.'));
  }
  if(!selection.unselected.length)excluded.append(el('p','voc-desc-empty','미반영 증상이 없습니다.'));
  selection.unselected.forEach(function(t){
   var row=el('div','wr-voc-excluded-row'),heading=el('div','wr-voc-heading');
   heading.append(el('strong','wr-symptom',t.k),el('span','wr-voc-metric',root.exNum(t.cur)+'건'));
   var actions=el('div','wr-voc-actions');
   var add=labeledButton('반영',t.k,function(){
    if(order.length>=VOC_LIMIT)return;
    d.merges.delete(t.k);d.order=order.concat(t.k);renderVoc(host,source,d,t.k,'selected');
   });
   add.disabled=order.length>=VOC_LIMIT;
   var select=el('select','wr-merge-select');
   select.setAttribute('aria-label',t.k+' 편입 대상');
   select.append(new Option('편입 안 함',''));
   order.forEach(function(target){select.append(new Option(target+'에 편입',target));});
   select.value=order.includes(d.merges.get(t.k))?d.merges.get(t.k):'';
   select.disabled=!order.length;
   select.onchange=function(){
    if(select.value)d.merges.set(t.k,select.value);
    else d.merges.delete(t.k);
    renderVoc(host,source,d,t.k,'merge');
   };
   actions.append(add,select);row.append(heading,actions);excluded.append(row);
   keepFocus(add,t.k,'add');
   keepFocus(select,t.k,'merge');
  });
  grid.append(included,excluded);host.append(grid);
  if(focusTarget)focusTarget.focus();
  else if(focusAction==='reset')selectedTitle.focus();
 }
 function management(rows){
  var skill=root.buildSkillData(rows),nz=root.buildNozzleData(rows);
  return {rows:rows,skill:skill,nozzle:nz,items:[
   {key:'education',name:'교육 필요 병원',sub:'사용자 교육 현황',cur:skill.needCount},
   {key:'nozzle',name:'노즐 재사용 병원',sub:'노즐 재사용 현황',cur:nz.joined.reuse+nz.nonJoined.reuse}
  ]};
 }
 function augment(s){
  var rows=root.exWindowRows(new Date(s.from+'T00:00:00'),new Date(s.to+'T23:59:59'));
  s.reportVocSource=vocSource(rows);
  s.reportVoc=vocSelection(s.reportVocSource,draft(s.type,s)).selected;
  if(s.type==='week'){
   s.kpi.find(function(k){return k.key==='insp';}).detail=inspectionSummary(rows);
  }
  s.management=management(rows);
  return s;
 }
 function layout(L){
  var bottom=L.notes.y+L.notes.h,managementH=1.17,managementY=bottom-managementH;
  return {
   voc:{x:L.change.x,y:L.change.y,w:L.change.w,h:managementY-.10-L.change.y,pad:.14,top:.39,pitch:.59,
        nameH:.18,descGap:.025,descH:.115,dividerGap:.015},
   management:{x:L.notes.x,y:managementY,w:L.notes.w,h:managementH,pad:.14,top:.52,pitch:.30}
  };
 }
 function wrap(text,width,size){
  var value=text.trim().replace(/\s+/g,' '),lines=[];
  if(!value)return lines;
  var line='';
  Array.from(value).forEach(function(ch){
   if(line&&root.exTxtW_(line+ch,size)>width){lines.push(line.trimEnd());line='';}
   if(line||ch!==' ')line+=ch;
  });
  if(line)lines.push(line);
  return lines;
 }
 function decorate(s,items){
  var L=root.L,C=root.C,B=layout(L);
  function text(x,y,w,h,t,size,color,bold,extra){items.push(Object.assign({k:'text',x:x,y:y,w:w,h:h,t:t,size:size,color:color||C.navy,bold:!!bold},extra||{}));}
  function shell(T,title){
   items.push({k:'rect',x:T.x,y:T.y,w:T.w,h:T.h,r:.05,fill:C.white,line:{color:C.line,width:1},reportCard:title});
   text(T.x+T.pad,T.y+.07,T.w-T.pad*2,.25,title,10.5,C.navy,true);
  }
  var T=B.voc,x=T.x+T.pad,w=T.w-T.pad*2;
  shell(T,VOC_TITLE);
  if(!s.reportVoc.length)text(x,T.y+T.top,w,.25,'선택한 기간에 표시할 유형이 없습니다.',9,C.mut);
  s.reportVoc.forEach(function(r,i){
   var y=T.y+T.top+i*T.pitch,center=y+T.pitch/2;
   var metricW=root.exTxtW_(r.metric,9)+.12,nameW=w-metricW-.10;
   var size=8,lines=wrap(r.desc,nameW,size);
   if(lines.length>2){
    size=7;
    lines=wrap(r.desc,nameW,size);
   }
   if(lines.length>3)throw new Error(r.name+' 보조문구를 세 줄 이내로 줄여주세요.');
   var blockH=T.nameH+(lines.length?T.descGap+lines.length*T.descH:0);
   var nameY=center-blockH/2,descY=nameY+T.nameH+T.descGap;
   text(x,nameY,nameW,T.nameH,root.exFitTxt_(r.name,nameW,9.5),9.5,C.navy,true,{reportVoc:i});
   text(x+w-metricW,center-T.nameH/2,metricW,T.nameH,r.metric,9,C.navy,true,{align:'right',reportVocMetric:i});
   lines.forEach(function(line,j){text(x,descY+j*T.descH,nameW,T.descH,line,size,C.mut,false,{reportVocDescription:i});});
   items.push({k:'line',x:x,y:y+T.pitch-T.dividerGap,w:w,color:C.line,width:.5,reportVocDivider:true});
  });
  T=B.management;
  shell(T,MANAGEMENT_TITLE);
  var inner=T.w-2*T.pad, columns=[
   {w:inner*.43,align:'left',heading:'구분'},
   {w:inner*.19,align:'right',heading:'병원 수'},
   {w:inner*.38,align:'center',heading:'관련 명단'}
  ];
  function managementRow(y,h,values,header){
   var left=T.x+T.pad;
   columns.forEach(function(col,j){
    var cellW=col.w-.10,size=header?6.8:root.exFitSize_(values[j],cellW,[8.5,8,7.5,7]);
    text(left+.05,y,cellW,h,values[j],size,header?C.mut:C.navy,!header&&j!==2,
     {align:col.align,reportManagementCount:!header&&j===1,manualFileCaption:!header&&j===2?values[j]:undefined});
    left+=col.w;
   });
  }
  managementRow(T.y+.33,.16,columns.map(function(col){return col.heading;}),true);
  s.management.items.forEach(function(r,i){
   var y=T.y+T.top+i*T.pitch;
   items.push({k:'line',x:T.x+T.pad,y:y,w:inner,color:C.line,width:.5});
   managementRow(y+.015,T.pitch-.03,[r.name,r.cur+'곳',r.sub],false);
  });
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
 async function previewWorkbook(kind,s){
  if(!s){tell('보고 기간을 먼저 선택하세요.');return;}
  try{
   var a=s.management.items.find(function(x){return x.key===kind;}),bytes=await workbook(s,kind);
   root.BazReportFiles.download(bytes,a.sub+'('+s.from.replaceAll('-','.')+'~'+s.to.replaceAll('-','.')+').xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }catch(e){tell(e);}
 }
 function install(){
  var originalSnap=root.exReportSnapshot_;root.exReportSnapshot_=function(){return augment(originalSnap.apply(this,arguments));};
  var originalDeck=root.buildExecutivePptDeck;root.buildExecutivePptDeck=function(s){var d=originalDeck(s);if(s.reportVoc)d[0].items=decorate(s,d[0].items);return d;};
  root.exRefreshVocDescEditor_=refreshVoc;
  [['week','wk','Weekly'],['month','mn','Monthly']].forEach(function(report){
   var type=report[0],prefix=report[1],modal=document.getElementById(prefix+'Modal');
   document.getElementById(prefix+'ManagementDownloads').append(
    button('사용자 교육 현황.xlsx 다운로드',function(){previewWorkbook('education',root.exReportSnapFromSel_(type));}),
    button('노즐 재사용 현황.xlsx 다운로드',function(){previewWorkbook('nozzle',root.exReportSnapFromSel_(type));})
   );
   var openName='open'+report[2],open=root[openName];
   root[openName]=function(){
    open();
    if(modal.classList.contains('show'))loadPhrases().then(function(){
     if(modal.classList.contains('show'))refreshVoc(type);
    });
   };
   var previewName='preview'+report[2]+'PPT',preview=root[previewName];
   root[previewName]=function(){try{return preview();}catch(e){tell(e);}};
  });
  // Weekly and monthly exports both use the original exMakeReportPPT/writeFile path.
  // Use the same supplied templates for the existing dashboard Excel actions as well.
  ['exportSkillManagementExcel','exportNozzleReuseExcel'].forEach(function(name,i){root[name]=async function(){try{var days=root.EX_ROWS.map(root.rowDate).filter(Boolean).map(root.ymd).sort(),s={from:root.F.from||days[0]||root.ymd(root.exBaseDate()),to:root.F.to||days[days.length-1]||root.ymd(root.exBaseDate()),management:management(root.EX_ROWS)};await previewWorkbook(i?'nozzle':'education',s);}catch(e){tell(e);}};});
 }
 root.BazWeeklyReport={install:install,layout:layout,workbook:workbook,management:management,wrap:wrap,loadPhrases:loadPhrases};
 install();
})(window);
