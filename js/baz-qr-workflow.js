(function(root){
 'use strict';if(!root.BazQrRuntime)return;
 var api=root.BazWorkAPI,$=function(id){return document.getElementById(id);},data=null,selected=null,displayedRevision=0,busy=false,pending=null,dirty=false,photoUrls=[],photoGeneration=0,photoControllers=[],photoFocus=null,renderedCase='',limit=20,photoIndex=0,zoom=1,loadTask=null,loadAgain=false,forceNext=false,readEpoch=0,pollFailures=0,lastPoll=0,loadedView='',listSignature='';
 var viewKey='qr-work-view:'+root.BazAuth.name(),view={query:'',filter:'active',sort:'priority',period:'all'};try{Object.assign(view,JSON.parse(sessionStorage.getItem(viewKey)||'{}'));}catch{}
 var storageKey='qr-workflow-pending:'+root.BazAuth.name();try{pending=JSON.parse(localStorage.getItem(storageKey)||'null');}catch{}
 function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 function message(text){$('qr-workflow-message').textContent=text;}
 function renderOperations(response){
  $('qr-jobs').innerHTML=(response.serviceJobs||[]).map(function(job){
   return '<li>'+esc(job.requestId)+' · '+esc(job.state)+' · '+esc(job.lastError||'')+'</li>';
  }).join('')||'<li>설문 연동 대기 없음</li>';
  $('qr-push-log').innerHTML=(response.pushEvents||[]).slice(-30).map(function(job){
   return '<li>'+[job.kind,job.state,job.requestId,job.lastError].filter(Boolean).map(esc).join(' · ')+'</li>';
  }).join('')||'<li>알림 기록 없음</li>';
 }
 var panel=document.createElement('section');panel.id='qr-workflow-panel';panel.className='reservation-panel';panel.hidden=true;
 panel.innerHTML='<div class="reservation-heading"><div><h1>고객 AS 접수 관리</h1><p id="qr-metrics"></p></div><button id="qr-refresh" type="button">목록 새로고침</button></div><p id="qr-workflow-message" role="status" aria-live="polite"></p><button id="qr-retry" hidden>같은 기록으로 재시도</button><div id="qr-view-tools" class="qr-view-tools"><input id="qr-search" type="search" aria-label="병원·연락처·증상 검색" placeholder="병원, 연락처, 증상 검색"><select id="qr-sort" aria-label="접수 정렬"><option value="priority">처리 우선순위</option><option value="visit">방문 시간순</option><option value="new">최근 접수순</option></select><select id="qr-period" aria-label="방문 조회 기간"><option value="all">전체 기간</option><option value="today">오늘</option><option value="week">향후 7일</option><option value="month">최근·향후 30일</option></select></div><div id="qr-filters" class="qr-filters"></div><p id="qr-found" role="status"></p><div class="qr-case-layout"><div><h2>접수 목록</h2><ul id="qr-cases"></ul></div><div><button id="qr-list-back" type="button">‹ 접수 목록</button><div id="qr-case-detail"></div></div></div><details class="qr-system-tools"><summary>연동 관리</summary><div class="actions"><button id="qr-pump" type="button">대기 중인 연동 작업 처리</button><button id="qr-reconcile" type="button">연동 누락 복구</button><button id="qr-results" type="button">설문 점수·의견</button><span id="qr-admin-tools" hidden><button id="qr-toggle-ingress" type="button"></button></span></div><ul id="qr-jobs"></ul><details><summary>알림 처리 기록</summary><ul id="qr-push-log"></ul></details><div id="qr-survey-results" hidden></div></details>';
 document.querySelector('main').append(panel);
 var lightbox=document.createElement('dialog');lightbox.id='qr-photo-viewer';lightbox.className='qr-photo-viewer';lightbox.setAttribute('aria-label','접수 사진 확대');
 lightbox.innerHTML='<div class="qr-photo-heading"><button type="button" id="qr-photo-close" aria-label="확대 사진 닫기">닫기 ×</button></div><div class="qr-photo-viewport" tabindex="0" role="region" aria-label="사진 스크롤 영역"><div class="qr-photo-canvas"><img id="qr-photo-large" alt="확대된 접수 사진"></div></div>';
 document.body.append(lightbox);
 var photoViewport=lightbox.querySelector('.qr-photo-viewport'),largePhoto=$('qr-photo-large');
 $('qr-photo-close').onclick=function(){lightbox.close();};
 lightbox.onclick=function(e){if(e.target===lightbox)lightbox.close();};
 root.BazWorkTabs.register('customers',$('qr-workflow-open'),panel);
 function rememberView(){try{sessionStorage.setItem(viewKey,JSON.stringify(view));}catch{}}
 function today(){return new Date(Date.now()+9*3600000).toISOString().slice(0,10);}
 function confirmed(r){
  if(!r.visitAt||['접수','취소'].includes(r.status))return false;
  if(r.qrIntake?.confirmationRequired||r.qrIntake?.appointmentConfirmed!==undefined)return r.qrIntake.appointmentConfirmed===true;
  return !!r.engineer&&['방문예정','처리중','결과확인','완료'].includes(r.status);
 }
 function openCase(r){return !['완료','취소'].includes(r.status);}
 function matches(c,f){
  var r=c.request;
  if(f==='awaiting')return openCase(r)&&!confirmed(r);
  if(f==='confirmed-unassigned')return openCase(r)&&confirmed(r)&&!r.engineer;
  return f==='all'||f==='active'&&openCase(r)||f==='unassigned'&&!r.engineer&&openCase(r)||f==='today'&&confirmed(r)&&r.visitAt.slice(0,10)===today()||f==='completed'&&r.status==='완료'||f==='changes'&&c.changeRequest?.state==='pending';
 }
 function nextWork(c){
  var r=c.request;
  if(!openCase(r))return '';
  if(c.changeRequest?.state==='pending')return '변경 요청 확인';
  if(!confirmed(r))return '방문 일정 확정';
  return r.engineer?'':'담당 엔지니어 배정';
 }
 function dateLabel(at){
  if(!at)return '일시 미정';
  return root.BazDesign?root.BazDesign.date(at,true):at.replace('T',' ');
 }
 function ageLabel(r){
  var stamp=r.createdAt||r.registeredAt;
  if(!stamp)return '';
  var stampMs=Date.parse(/T\d\d:\d\d$/.test(stamp)?stamp+'+09:00':stamp);
  if(!Number.isFinite(stampMs))return '';
  var minutes=Math.max(0,Math.floor((Date.now()-stampMs)/60000));
  if(minutes<1)return '방금 접수';
  if(minutes<60)return minutes+'분 전 접수';
  if(minutes<1440)return Math.floor(minutes/60)+'시간 전 접수';
  return Math.floor(minutes/1440)+'일 전 접수';
 }
 function list(){if(!data)return;var q=view.query.trim().toLocaleLowerCase(),items=data.items.filter(function(c){var r=c.request,delta=(Date.parse(r.visitAt.slice(0,10))-Date.parse(today()))/86400000;return matches(c,view.filter)&&(!q||[r.hospitalName,r.symptom,r.engineer,c.contact.phone,c.contact.name].join(' ').toLocaleLowerCase().includes(q))&&(view.period==='all'||view.period==='today'&&delta===0||view.period==='week'&&delta>=0&&delta<7||view.period==='month'&&Math.abs(delta)<=30);});
  var signature=JSON.stringify([view,selected,limit,data.admin,data.total,data.nextOffset,data.counts,items.map(function(c){return [c.request,c.canSchedule,c.changeRequest?.state,ageLabel(c.request)];})]);
  if(signature===listSignature)return;
  listSignature=signature;

  items.sort(function(a,b){var x=a.request,y=b.request;if(view.sort==='priority'){var ax=a.changeRequest?.state==='pending'?0:!confirmed(x)?1:!x.engineer?2:3,bx=b.changeRequest?.state==='pending'?0:!confirmed(y)?1:!y.engineer?2:3;if(ax!==bx)return ax-bx;}return view.sort==='new'?y.createdAt.localeCompare(x.createdAt):x.visitAt.localeCompare(y.visitAt);});
  $('qr-filters').innerHTML=[['active','진행 중'],['awaiting','일정 미확정'],['confirmed-unassigned','확정·미배정'],['today','오늘 방문'],['changes','변경 요청 대기'],['completed','완료'],['all','전체']].map(function(f){return '<button type="button" data-filter="'+f[0]+'" aria-pressed="'+(view.filter===f[0])+'">'+f[1]+' <strong>'+((data.counts?.[f[0]]??data.items.filter(function(c){return matches(c,f[0]);}).length))+'</strong></button>';}).join('');$('qr-filters').querySelectorAll('button').forEach(function(b){b.onclick=function(){view.filter=b.dataset.filter;limit=20;rememberView();load(true,true);};});
  $('qr-found').textContent=((data.total??items.length)+'건')+(items.length>limit?' · '+limit+'건 표시':'');
  $('qr-cases').innerHTML=items.slice(0,limit).map(function(c){
   var r=c.request,canConfirm=(data.admin||c.canSchedule===true)&&openCase(r)&&!confirmed(r)&&c.changeRequest?.state!=='pending';
   return '<li class="'+[r.id===selected?'selected':'',canConfirm?'qr-case-with-confirm':''].filter(Boolean).join(' ')+'"><button type="button" data-qr-select="'+esc(r.id)+'"><span class="qr-list-heading"><strong>'+esc(r.hospitalName)+'</strong><b class="qr-state" data-state="'+esc(r.status)+'">'+esc(r.status)+'</b></span><span class="qr-list-date">'+'접수 · '+esc(root.BazDesign?root.BazDesign.date(r.registeredAt,true):(r.registeredAt||'접수 일시 미상').replace('T',' '))+'</span><span class="qr-list-date">'+esc(confirmed(r)?'확정 방문 · '+dateLabel(r.visitAt):'방문 시간 확인 중')+'</span><span class="qr-symptom">'+esc(r.symptom)+'</span><span class="qr-list-engineer">'+esc([r.engineer||'미배정',ageLabel(r),canConfirm?'':nextWork(c)].filter(Boolean).join(' · '))+'</span></button>'+
    (canConfirm?'<button type="button" class="qr-list-confirm" data-ui-icon="calendar" data-qr-confirm="'+esc(r.id)+'" aria-label="'+esc(r.hospitalName)+' 방문 확정">방문 확정</button>':'')+'</li>';
  }).join('')||'<li class="qr-empty">불러온 접수 중 조건에 맞는 건이 없습니다.</li>';
  if(data.nextOffset!==null&&data.nextOffset!==undefined&&items.length<=limit){
   var next=document.createElement('button');next.type='button';next.textContent='다음 접수 더 보기';
   next.onclick=async function(){
    if(busy||pending||loadTask)return;
    var snapshot=data,viewKeyAtStart=JSON.stringify(view);
    next.disabled=true;
    try{
     var response=await summaries(snapshot.nextOffset);
     if(snapshot!==data||viewKeyAtStart!==JSON.stringify(view)||busy||pending)return;
     var known=new Set(data.items.map(function(item){return item.request.id;}));
     data.items.push.apply(data.items,response.items.filter(function(item){return !known.has(item.request.id);}));
     data.nextOffset=response.nextOffset;limit+=20;list();
    }catch(e){
     if(e.code==='LIST_CHANGED'){message('목록이 변경되어 첫 페이지를 다시 불러왔습니다.');limit=20;load(false,true);}
     else message(e.message);
    }finally{next.disabled=false;}
   };
   $('qr-cases').append(next);
  }
  if(items.length>limit){var more=document.createElement('button');more.type='button';more.textContent='20건 더 보기';more.onclick=function(){limit+=20;list();};$('qr-cases').append(more);}
 }
 $('qr-cases').onclick=async function(e){
  var target=e.target.closest('[data-qr-select],[data-qr-confirm]');
  if(!target||busy||pending)return;
  var id=target.dataset.qrConfirm||target.dataset.qrSelect,shortcut=!!target.dataset.qrConfirm;
  if(selected!==id||!dirty){
   if(dirty&&!confirm('저장하지 않은 변경을 비울까요?'))return;
   selected=id;sessionStorage.setItem(viewKey+':selected',id);dirty=false;list();
   try{await ensureDetail();if(busy||selected!==id)return;render();}catch(error){message(error.message);return;}
  }
  panel.dataset.listScroll=String(scrollY);
  panel.classList.add('is-detail');
  if(shortcut&&$('qr-visit-date')&&!$('qr-visit-date').readOnly){
   $('qr-workflow-heading').focus({preventScroll:true});
   $('qr-workflow-heading').scrollIntoView({block:'start'});
  }else if(matchMedia('(max-width:760px)').matches)$('qr-case-detail').scrollIntoView({block:'start'});
 };
 $('qr-search').value=view.query;$('qr-sort').value=view.sort;$('qr-period').value=view.period;
 var searchTimer,composing=false;function searchChanged(){clearTimeout(searchTimer);if(composing)return;searchTimer=setTimeout(function(){view.query=$('qr-search').value;limit=20;rememberView();load(true,true);},150);}$('qr-search').oncompositionstart=function(){composing=true;};$('qr-search').oncompositionend=function(){composing=false;searchChanged();};$('qr-search').oninput=searchChanged;['sort','period'].forEach(function(k){$('qr-'+k).onchange=function(){view[k]=this.value;limit=20;rememberView();load(true,true);};});
 $('qr-list-back').onclick=function(){panel.classList.remove('is-detail');scrollTo({top:Number(panel.dataset.listScroll||0),behavior:'instant'});$('qr-cases [data-qr-select="'+selected+'"]')?.focus({preventScroll:true});};
 var detailTasks=new Map();async function ensureDetail(){var id=selected,c=current();if(!c||c.detailLoaded!==false)return;var key=id+':'+c.request.revision,epoch=readEpoch;if(!detailTasks.has(key))detailTasks.set(key,api.get('qr_case',{requestId:id}).finally(function(){detailTasks.delete(key);}));var response=await detailTasks.get(key);if(!response.success)throw Error(response.error);if(epoch!==readEpoch||selected!==id)return;var index=data.items.findIndex(function(c){return c.request.id===id;});if(index>=0&&response.item.request.revision>=data.items[index].request.revision)data.items[index]=response.item;}
 async function summaries(offset){for(var attempt=0;attempt<3;attempt++){try{return await fetchSummaries(offset);}catch(e){if(e.code!=='LIST_CHANGED'||offset)throw e;}}throw Error('접수가 계속 변경되고 있습니다. 잠시 후 새로고침하세요.');}
 async function fetchSummaries(offset){
  var response=await api.get('qr_cases',{summaryOnly:true,offset:offset||0,limit:20,view:Object.assign({},view),listVersion:offset?data?.listVersion:undefined});
  if(!response.success)throw Object.assign(Error(response.error),{code:response.code});
  return response;
 }
 function current(){return data?.items.find(function(c){return c.request.id===selected;});}
 function load(force,refresh){if(busy)return Promise.resolve();if(loadTask){if(force===true||refresh===true)loadAgain=true;if(force===true)forceNext=true;return loadTask;}panel.setAttribute('aria-busy','true');
  loadTask=(async function(){do{var requestedView=JSON.stringify(view),renderForce=force===true||forceNext;loadAgain=false;forceNext=false;force=false;var epoch=readEpoch;try{var response=await summaries();if(requestedView!==JSON.stringify(view)){loadAgain=true;continue;}if(busy||epoch!==readEpoch)continue;
  if(data){
   var previous=new Map(data.items.map(function(item){return [item.request.id,item];}));
   response.items=response.items.map(function(item){var old=previous.get(item.request.id);return old?.detailLoaded&&old.request.revision===item.request.revision?old:item;});
   if(loadedView===requestedView&&response.listVersion!=null&&response.listVersion===data.listVersion&&data.items.length>response.items.length){
    response.items.push.apply(response.items,data.items.slice(response.items.length));
    response.nextOffset=data.nextOffset;
   }
  }
  data=response;loadedView=requestedView;pollFailures=0;
  var done=data.items.filter(function(c){return c.request.status==='완료';}).length;
  $('qr-metrics').textContent='접수 '+(data.globalCounts?.total??data.items.length)+'건 · 진행 중 '+(data.globalCounts?.active??data.items.filter(function(c){return !['완료','취소'].includes(c.request.status);}).length)+'건 · 완료 '+(data.globalCounts?.completed??done)+'건';
  $('qr-admin-tools').hidden=!data.admin;$('qr-toggle-ingress').textContent=data.ingress.enabled?'신규 접수 중지':'신규 접수 열기';$('qr-results').hidden=!data.admin;$('qr-reconcile').hidden=!data.admin;
  list();
  renderOperations(data);
  root.dispatchEvent(new CustomEvent('baz-qr-work-changed',{detail:{requests:data.items.map(function(c){return c.request;})}}));
  if(!selected){selected=sessionStorage.getItem(viewKey+':selected');}await ensureDetail();if(dirty&&current()?.request.revision!==displayedRevision){message('다른 담당자가 변경했습니다. 입력을 유지했습니다. 최신 내용 확인을 누르면 다시 불러옵니다.');}else if(!dirty&&(renderForce||JSON.stringify(current())!==renderedCase))render();
 }catch(e){pollFailures++;message(e.message+' · 새로고침으로 다시 확인하세요.');}}while(loadAgain&&!busy);})().finally(function(){loadTask=null;panel.setAttribute('aria-busy','false');});return loadTask;}
 function fitPhoto(keepCenter){
  if(!lightbox.open||!largePhoto.naturalWidth||!photoViewport.clientWidth||!photoViewport.clientHeight)return;
  var frame=photoViewport.getBoundingClientRect(),before=largePhoto.getBoundingClientRect();
  var centerX=keepCenter&&before.width?Math.max(0,Math.min(1,(frame.left+photoViewport.clientWidth/2-before.left)/before.width)):0.5;
  var centerY=keepCenter&&before.height?Math.max(0,Math.min(1,(frame.top+photoViewport.clientHeight/2-before.top)/before.height)):0.5;
  var scale=Math.min(1,frame.width/largePhoto.naturalWidth,frame.height/largePhoto.naturalHeight)*zoom;
  largePhoto.style.width=Math.max(1,Math.floor(largePhoto.naturalWidth*scale))+'px';
  largePhoto.style.height=Math.max(1,Math.floor(largePhoto.naturalHeight*scale))+'px';
  var after=largePhoto.getBoundingClientRect();
  photoViewport.scrollTo({
   left:photoViewport.scrollLeft+after.left-frame.left+after.width*centerX-photoViewport.clientWidth/2,
   top:photoViewport.scrollTop+after.top-frame.top+after.height*centerY-photoViewport.clientHeight/2
  });
 }
 function showPhoto(){
  zoom=1;
  largePhoto.style.width='0px';largePhoto.style.height='0px';
  largePhoto.src=photoUrls[photoIndex];
  if(largePhoto.complete)fitPhoto(false);
 }
 largePhoto.addEventListener('load',function(){fitPhoto(false);});
 root.addEventListener('resize',function(){fitPhoto(true);});
 var photoTools=document.createElement('div');photoTools.className='qr-photo-tools';photoTools.innerHTML='<button type="button" data-photo-step="-1">이전</button><button type="button" data-photo-zoom="-0.25">축소</button><button type="button" data-photo-zoom="0.25">확대</button><button type="button" data-photo-step="1">다음</button>';
 lightbox.append(photoTools);
 photoTools.addEventListener('click',function(e){
  var button=e.target.closest('button');
  if(!button)return;
  if(button.dataset.photoStep){
   var count=current()?.photos.length||1,next=(photoIndex+Number(button.dataset.photoStep)+count)%count;
   if(photoUrls[next]){photoIndex=next;showPhoto();}
   return;
  }
  zoom=Math.max(0.5,Math.min(3,zoom+Number(button.dataset.photoZoom)));
  fitPhoto(true);
 });
 lightbox.addEventListener('close',function(){photoFocus?.focus({preventScroll:true});});
 var photoCache=new Map(),photoCacheBytes=0,photoCacheToken='';
 function releasePhotos(){photoGeneration++;photoControllers.forEach(function(c){c.abort();});photoControllers=[];photoUrls.forEach(function(url){URL.revokeObjectURL(url);});photoUrls=[];if(lightbox.open)lightbox.close();}
 function cachePhoto(key,blob){
  var maxBytes=12*1024*1024;
  if(blob.size>maxBytes)return;
  while(photoCacheBytes+blob.size>maxBytes||photoCache.size>=12){
   var oldest=photoCache.keys().next().value;
   photoCacheBytes-=photoCache.get(oldest).size;
   photoCache.delete(oldest);
  }
  photoCache.set(key,blob);photoCacheBytes+=blob.size;
 }
 function render(){renderedCase=JSON.stringify(current());releasePhotos();var c=current();if(!c){$('qr-case-detail').innerHTML='<p class="qr-empty">접수를 선택하세요.</p>';return;}var r=c.request,canSchedule=data.admin||c.canSchedule===true;displayedRevision=r.revision;
  var savedVisit=confirmed(r)?r.visitAt:'',savedDate=savedVisit.slice(0,10),savedTime=savedVisit.slice(11,16).replace(':',''),readOnly=openCase(r)?'':' readonly';
  $('qr-case-detail').innerHTML='<div class="qr-case-heading"><h2>'+esc(r.hospitalName)+'</h2><span class="qr-case-number">'+esc(r.requestNumber||r.id.slice(-8))+'</span></div><dl class="qr-case-facts"><dt>담당자</dt><dd>'+esc(c.contact.name||'미입력')+'</dd><dt>연락처</dt><dd>'+'<a href="tel:'+esc(c.contact.phone)+'">'+esc(c.contact.phone)+'</a></dd><dt>이메일</dt><dd>'+esc(c.contact.email||'미입력')+'</dd><dt>엔지니어</dt><dd>'+esc(r.engineer||'미배정')+'</dd></dl><h3>접수 내용</h3><p>'+esc(r.symptom)+'</p><h3>첨부 사진</h3><div id="qr-photo-list" class="photo-strip"></div>'+
   '<section class="qr-workflow-controls" aria-labelledby="qr-workflow-heading"><h3 id="qr-workflow-heading" tabindex="-1">방문 일정 확정 · 담당 배정</h3>'+
   (c.canEdit===false&&!canSchedule?
    '<p class="help">접수·방문 희망 일정 조회 · 일정 조율과 배정은 CS에서 진행합니다.</p><p class="readonly-workflow">'+esc('처리 상태 '+r.status+' · 엔지니어 '+(r.engineer||'미배정')+' · '+(confirmed(r)?'확정 방문 '+dateLabel(r.visitAt):'접수 확인 중'))+'</p>':
    '<form id="qr-workflow-form"><div class="qr-workflow-grid'+(canSchedule?'':' status-only')+'">'+
    (canSchedule?'<div class="field"><label for="qr-visit-date">방문 일시</label><div class="qr-visit-fields"><input id="qr-visit-date" type="date"'+readOnly+' value="'+esc(savedDate)+'"><input id="qr-visit-time" type="text" inputmode="numeric" maxlength="4" aria-label="방문 시간, 24시간제 네 자리" placeholder="1000"'+readOnly+' value="'+esc(savedTime)+'"></div></div><label class="field">배정 엔지니어<select id="qr-assigned-engineer"><option value="">미배정</option>'+data.engineers.map(function(n){return '<option value="'+esc(n)+'" '+(n===r.engineer?'selected ':'')+(!data.admin&&n!==data.ownEngineer?'disabled':'')+'>'+esc(n)+'</option>';}).join('')+'</select></label>':'')+
    '<label class="field">처리 상태<select id="qr-status">'+['접수','방문예정','처리중','결과확인','완료','보류','취소'].map(function(s){return '<option '+(s===r.status?'selected':'')+'>'+s+'</option>';}).join('')+'</select></label></div>'+
    '<div class="qr-workflow-footer"><p id="qr-save-feedback" role="status"></p><button id="qr-save-all" type="submit" class="primary" data-ui-icon="'+(canSchedule?'check':'save')+'">'+(canSchedule?'방문 확정':'상태 저장')+'</button></div></form>')+'</section>';
  var heading=$('qr-case-detail').querySelector('.qr-case-heading'),status=document.createElement('span');status.className='qr-state';status.dataset.state=r.status;status.textContent=r.status;heading.append(status);var appointment=document.createElement('p');appointment.className='qr-appointment';appointment.dataset.uiIcon='calendar';appointment.textContent=(confirmed(r)?'확정 방문 · '+dateLabel(r.visitAt):'접수 확인 중');heading.after(appointment);
  var tools=document.createElement('div');tools.className='qr-detail-actions';tools.innerHTML='<button id="qr-service-open" type="button">서비스 현황에서 열기</button><button id="qr-latest" type="button">최신 내용 확인</button><span id="qr-dirty" role="status"></span>';appointment.after(tools);
  $('qr-service-open').onclick=function(){root.BazWorkTabs.show('service');root.dispatchEvent(new CustomEvent('baz-open-notification',{detail:{requestId:r.id}}));};$('qr-latest').title='선택한 접수 내용을 새로 확인합니다.';$('qr-latest').onclick=function(){if(dirty&&!confirm('저장하지 않은 변경을 비우고 최신 내용을 볼까요?'))return;dirty=false;load(true);};
  if(!canSchedule){var preferences=document.createElement('section');preferences.id='qr-preferences';preferences.innerHTML='<h3>방문 희망 순위</h3><ol>'+(r.qrIntake?.preferredStartAts||[r.qrIntake?.requestedVisitAt||r.visitAt]).map(function(at,index){return '<li>'+(index+1)+'순위 · '+esc(root.BazDesign?root.BazDesign.date(at,true):at.replace('T',' '))+'</li>';}).join('')+'</ol>';tools.after(preferences);}
  if(c.changeRequest?.state==='pending'){
   var change=c.changeRequest,cancel=change.kind==='cancel',request=document.createElement('details');
   request.open=true;request.className='qr-change-request';
   request.innerHTML='<summary>'+(cancel?'취소 요청':'방문 일정 변경 요청')+' · CS 확인 대기</summary>'+
    (change.note?'<p>'+esc(change.note)+'</p>':'')+
    (!cancel&&change.preferredAt?'<p>변경 희망 일시 · '+esc(dateLabel(change.preferredAt))+'</p>':'');
   $('qr-case-detail').prepend(request);
   if(data.admin){
    if(cancel){
     request.insertAdjacentHTML('beforeend','<button id="qr-adjust-cancel" type="button">접수 취소 확정</button>');
     $('qr-adjust-cancel').onclick=function(){if(confirm('이 접수의 취소를 확정할까요?'))send('qr_cancel_confirm',{});};
    }else{
     request.insertAdjacentHTML('beforeend','<label>확정할 방문 일시<input id="qr-adjust-time" type="datetime-local" required value="'+esc(change.preferredAt||(confirmed(r)?r.visitAt:''))+'"></label><label>배정 엔지니어<select id="qr-adjust-engineer" required><option value="">담당 선택</option>'+data.engineers.map(function(n){return '<option '+(n===r.engineer?'selected':'')+'>'+esc(n)+'</option>';}).join('')+'</select></label><button id="qr-adjust-save" type="button">일정 변경 확정</button>');
     $('qr-adjust-save').onclick=function(){var at=$('qr-adjust-time'),engineer=$('qr-adjust-engineer');if(at.reportValidity()&&engineer.reportValidity())send('qr_reschedule',{startAt:at.value,engineer:engineer.value});};
    }
   }
  }
  $('qr-case-detail').querySelectorAll('input,textarea,select').forEach(function(el){el.oninput=function(){dirty=true;if($('qr-dirty'))$('qr-dirty').textContent='저장하지 않은 변경사항';};});
  var workflowForm=$('qr-workflow-form'),visitDate=$('qr-visit-date'),visitTime=$('qr-visit-time'),assignee=$('qr-assigned-engineer');
  function visitAt(){
   var time=visitTime.value;
   return visitDate.value&&/^(?:[01]\d|2[0-3])[0-5]\d$/.test(time)?visitDate.value+'T'+time.slice(0,2)+':'+time.slice(2):'';
  }
  if(visitDate&&!visitDate.readOnly)visitDate.addEventListener('click',function(e){
   if(typeof visitDate.showPicker!=='function')return;
   try{visitDate.focus();visitDate.showPicker();e.preventDefault();}catch{}
  });
  function saveWorkflow(e){
   e.preventDefault();
   if(busy||pending)return;
   var chosenStatus=$('qr-status').value;
   if(!canSchedule){send('work_status',{requestId:r.id,baseRevision:r.revision,status:chosenStatus});return;}
   var engineer=assignee.value,at=visitAt();
   var newVisit=openCase(r)&&!!at&&at!==savedVisit;
   function feedback(text,field){
    $('qr-save-feedback').textContent=text;
    field?.focus();
   }
   if(!at&&(savedVisit||visitDate.value||visitTime.value||chosenStatus==='방문예정')){
    if(!visitDate.value)feedback('방문 날짜를 선택해 주세요.',visitDate);
    else feedback('방문 시간을 네 자리로 입력해 주세요. 예: 1000, 1300',visitTime);
    return;
   }
   if(newVisit){
    if(c.changeRequest?.state==='pending'&&c.changeRequest.kind==='cancel'){
     feedback('고객이 요청한 접수 취소를 먼저 확인해 주세요.');
     return;
    }
    if(!savedVisit&&chosenStatus===r.status)chosenStatus='방문예정';
    if((!savedVisit&&chosenStatus!=='방문예정')||['접수','취소'].includes(chosenStatus)){
     feedback('방문 일시를 확정할 수 있는 처리 상태를 선택해 주세요.',$('qr-status'));
     return;
    }
   }
   if((newVisit||chosenStatus==='방문예정')&&!engineer){
    feedback('방문 일정을 확정하려면 담당 엔지니어를 선택해 주세요.',assignee);
    return;
   }
   if((newVisit||engineer!==r.engineer)&&assignee.selectedOptions[0]?.disabled){
    feedback('해당 시간에 방문 가능한 엔지니어를 선택해 주세요.',assignee);
    return;
   }
   send('qr_update',{engineer:engineer,status:chosenStatus,...(newVisit?{startAt:at}:{})});
  }
  if(workflowForm){
   workflowForm.onsubmit=saveWorkflow;
   function updateSave(){
    var assignmentChanged=assignee&&assignee.value!==(r.engineer||'');
    var visitChanged=canSchedule&&(visitDate.value!==savedDate||visitTime.value!==savedTime);
    $('qr-save-all').disabled=!visitChanged&&!assignmentChanged&&$('qr-status').value===r.status;
    $('qr-save-feedback').textContent='';
   }
   workflowForm.addEventListener('input',updateSave);
   workflowForm.addEventListener('change',updateSave);
   updateSave();
  }
  if(canSchedule){
   var candidateGeneration=photoGeneration,availabilityRead=0,initialSchedules=new Map();
   var preferredTimes=(r.qrIntake?.preferredStartAts||[r.qrIntake?.requestedVisitAt||r.visitAt]).filter(Boolean);
   var preferencePanel=document.createElement('section');preferencePanel.id='qr-preferences';preferencePanel.innerHTML='<h3>방문 희망 순위</h3><div class="actions">'+preferredTimes.map(function(at,index){return '<button type="button" data-preference="'+index+'" aria-label="'+(index+1)+'순위 적용"><strong>'+(index+1)+'순위</strong> '+esc(dateLabel(at))+' · <span>가능 인원 확인 중</span></button>';}).join('')+'</div>';
   if(openCase(r)&&preferredTimes.length)workflowForm.before(preferencePanel);
   function unavailable(schedule,person,at){var start=Date.parse(at+':00+09:00'),end=start+((r.reservationDurationMinutes||120)+(r.reservationTravelMinutes||0))*60000,off=schedule.off.find(function(o){return o.person===person;});if(off)return off.type;var overlaps=function(o){var os=Date.parse(o.startAt+':00+09:00'),oe=os+(o.durationMinutes+(o.travelMinutes||0))*60000;return start<oe&&os<end;};return schedule.schedule.some(function(o){return o.id!==r.id&&o.engineer===person&&overlaps(o);})||schedule.slots.some(function(o){return o.engineer===person&&['closed','blocked'].includes(o.mode)&&overlaps(o);})?'일정 겹침':'';}
   function readSchedule(date){
    var previous=initialSchedules.get(date),now=Date.now();
    if(previous&&now-previous.start<5000)return previous.task;
    var task=api.get('work_reservation_list',{date:date}).catch(function(error){if(initialSchedules.get(date)?.task===task)initialSchedules.delete(date);throw error;});
    initialSchedules.set(date,{start:now,task:task});
    return task;
   }
   if(preferencePanel.isConnected)preferencePanel.querySelectorAll('button').forEach(function(button,index){var at=preferredTimes[index];button.disabled=true;readSchedule(at.slice(0,10)).then(function(schedule){if(candidateGeneration!==photoGeneration||!schedule.success)return;var count=data.engineers.filter(function(person){return (data.admin||person===data.ownEngineer)&&!unavailable(schedule,person,at);}).length;button.querySelector('span').textContent=count?(data.admin?'현재 '+count+'명 가능':'본인 방문 가능'):(data.admin?'현재 방문 불가':'본인 방문 불가');button.disabled=!count;}).catch(function(){button.querySelector('span').textContent='가능 여부 다시 확인';});button.onclick=function(){if(busy||pending||button.disabled)return;visitDate.value=at.slice(0,10);visitTime.value=at.slice(11,16).replace(':','');if(!data.admin&&!assignee.value)assignee.value=data.ownEngineer||'';visitDate.dispatchEvent(new Event('input',{bubbles:true}));};});
   function checkCandidates(){
    var generation=++availabilityRead,at=visitAt();
    preferencePanel.querySelectorAll('button').forEach(function(button,index){button.setAttribute('aria-pressed',String(preferredTimes[index]===at));});
    var options=Array.from(assignee.options).filter(function(option){return !!option.value;});
    options.forEach(function(option){option.textContent=option.value;option.disabled=!data.admin&&option.value!==data.ownEngineer;});
    if(!at)return;
    readSchedule(at.slice(0,10)).then(function(schedule){
     if(!schedule.success||candidateGeneration!==photoGeneration||generation!==availabilityRead)return;
     options.forEach(function(option){var reason=unavailable(schedule,option.value,at);option.textContent=option.value+(reason?' · '+reason:' · 해당 시간 가능');option.disabled=!!reason||!data.admin&&option.value!==data.ownEngineer;});
    }).catch(function(){});
   }
   visitDate.addEventListener('input',checkCandidates);
   visitTime.addEventListener('input',checkCandidates);
   checkCandidates();
  }
  var generation=photoGeneration,list=$('qr-photo-list'),token=root.BazAuth.token();
  if(token!==photoCacheToken){photoCache.clear();photoCacheBytes=0;photoCacheToken=token;}
  if(!c.photos.length)list.textContent='첨부된 사진이 없습니다.';
  var photoActive=0,photoQueue=[];function photoRun(job){photoQueue.push(job);photoNext();}function photoNext(){if(photoActive>=2||!photoQueue.length||generation!==photoGeneration)return;photoActive++;photoQueue.shift()().finally(function(){photoActive--;photoNext();});}
  c.photos.forEach(function(photo,index){var button=document.createElement('button');button.type='button';button.className='qr-photo';button.disabled=true;button.setAttribute('aria-label','접수 사진 '+(index+1)+' 확대');button.textContent='사진 불러오는 중…';list.append(button);function download(){return (async function(){var measured=root.BazPerf?root.BazPerf.start('photos'):function(){},ctl=new AbortController(),timer=setTimeout(function(){ctl.abort();},20000);photoControllers.push(ctl);button.disabled=true;button.textContent='사진 불러오는 중…';try{
   var key=JSON.stringify([r.id,r.revision,photo.id]),blob=photoCache.get(key);
   if(!blob){
   var response=await fetch(root.BazQrRuntime.file||'/_local/file',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:root.BazQrRuntime.fileAction,token:root.BazAuth.token(),requestId:r.id,photoId:photo.id}),cache:'no-store',signal:ctl.signal});if(!response.ok)throw Error('사진을 불러오지 못했습니다.');blob=await response.blob();if(generation!==photoGeneration||token!==root.BazAuth.token())return;cachePhoto(key,blob);}var url=URL.createObjectURL(blob);photoUrls[index]=url;var img=document.createElement('img');img.src=url;img.alt='접수 사진 '+(index+1);img.width=170;img.height=128;img.decoding='async';button.replaceChildren(img);button.disabled=false;button.onclick=function(){photoFocus=button;photoIndex=index;lightbox.showModal();showPhoto();};
  }catch(e){if(generation===photoGeneration){button.disabled=false;button.textContent='사진 다시 불러오기';button.title=e.message;button.onclick=function(){photoRun(download);};}}finally{clearTimeout(timer);measured({bytes:blob?.size||0});photoControllers=photoControllers.filter(function(c){return c!==ctl;});}})();}photoRun(download);});
 }
 async function send(action,p){if(busy||pending)return false;pending={action:action,payload:Object.assign({requestId:selected,operationId:api.id(),baseRevision:displayedRevision},p)};try{localStorage.setItem(storageKey,JSON.stringify(pending));}catch{pending=null;message('재시도 기록을 보관하지 못해 저장하지 않았습니다.');return false;}return retry();}
 async function retry(){if(busy||!pending)return false;readEpoch++;busy=true;panel.setAttribute('aria-busy','true');message('저장 결과를 확인하고 있습니다…');$('qr-retry').hidden=false;var success=false,finished=pending;try{var response=await api.post(pending.action,pending.payload);if(!response.success&&response.retrySameOperation)throw Error(response.error);pending=null;localStorage.removeItem(storageKey);if(!response.success)throw Error(response.error);success=true;dirty=false;message(finished.payload.status==='방문예정'?'방문 일정을 저장했습니다.':'저장했습니다.');}catch(e){message(e.message+(pending?' · 같은 기록으로 재시도하세요.':''));}finally{busy=false;panel.setAttribute('aria-busy','false');$('qr-retry').hidden=!pending;}if(finished.payload.requestId)selected=finished.payload.requestId;if(!pending)await load(success,true);return success;}
  $('qr-refresh').onclick=function(){load(true,true);};$('qr-retry').onclick=retry;
 panel.querySelector('.qr-system-tools').addEventListener('toggle',async function(){if(!this.open)return;try{var response=await api.get('qr_cases');if(response.success){$('qr-jobs').textContent=response.serviceJobs.length+'건 연동 기록';$('qr-push-log').textContent=response.pushEvents.length+'건 알림 기록';}}catch(e){message(e.message);}});
 $('qr-pump').onclick=async function(){try{var r=await api.post('qr_pump',{});if(!r.success)throw Error(r.error);message('설문 전달 '+r.delivered+'건 · 응답 반영 '+r.responses+'건 · 시험 알림 기록 '+r.pushRecords+'건 · 실패 '+r.failed+'건');await load();}catch(e){message(e.message);}};
 $('qr-reconcile').onclick=async function(){try{var r=await api.post('qr_reconcile',{repair:true});if(!r.success)throw Error(r.error);message('설문 응답 '+r.remoteResponses+'건 대사 · 누락 초대 '+r.missing.length+'건');}catch(e){message(e.message);}};
 $('qr-toggle-ingress').onclick=function(){if(data)send('work_reservation_ingress',{enabled:!data.ingress.enabled,baseRevision:data.ingressRevision});};
 $('qr-results').onclick=async function(){try{var r=await api.get('qr_survey_results');if(!r.success)throw Error(r.error);var target=$('qr-survey-results');target.hidden=false;target.innerHTML='<h3>설문 점수·의견</h3>'+r.items.filter(function(i){return i.answers;}).map(function(i){var a=JSON.parse(i.answers),c=data.items.find(function(c){return c.request.id===i.request_id;});return '<article><strong>'+esc(c?c.request.hospitalName:i.request_id)+'</strong><p>예약 '+a.booking+' · 응대 '+a.courtesy+' · 처리 '+a.resolution+' · 설명 '+a.explanation+'</p><p>'+esc(a.comment||'추가 의견 없음')+'</p></article>';}).join('');}catch(e){message(e.message);}};
 root.addEventListener('baz-work-tab',function(e){if(e.detail.name==='customers')load(false);});
 document.addEventListener('visibilitychange',refreshWhenVisible);
 root.addEventListener('online',refreshWhenVisible);
 function refreshWhenVisible(){
  if(!panel.hidden&&!document.hidden&&!busy&&!pending){lastPoll=Date.now();load(false,true);}
 }
 setInterval(function(){if(!panel.hidden&&!document.hidden&&!busy&&!pending&&!lightbox.open&&Date.now()-lastPoll>=Math.min(120000,8000*Math.pow(2,pollFailures))){lastPoll=Date.now();load(false);}},8000);
 if(pending){root.BazWorkTabs.show('customers');$('qr-retry').hidden=false;message('저장 결과 확인이 필요합니다. 같은 기록으로 재시도하세요.');}else if(!panel.hidden)load(false);
})(window);
