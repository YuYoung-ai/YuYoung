(function(){
  'use strict';
  var cache=window.BazWorkCache,kvReady=false,revision='0',sourceCheckedAt='',bridgeStatus=null,api=window.BazWorkAPI, $=function(id){return document.getElementById(id);};
  var statuses=['접수','방문예정','처리중','결과확인','완료','보류','취소'];
  var state={requests:[],hospitals:[],engineers:[],roster:[],rosterMonth:localNow().slice(0,7),rosterLoaded:false,filter:'week',statusScope:'all',page:1,detail:null,selected:null,editing:null,baseline:null,source:null,loaded:false};
  var lastLiveFilter='week';
  var rosterLoading=false,rosterEdit=null,rosterDelete=null,calendarDate=localNow().slice(0,10),rosterTab='calendar',todayRoster=[],todayRosterDate='',todayRosterLoading=false;
  var detailSeq=0,hospitalSeq=0,sourceSeq=0,resultDialogSeq=0,busy=false,syncing=false,syncCheckedAt='';
  var detailCache=new Map(),detailLoading=false,detailError='',detailTask=null;
  var account=window.BazAuth.name(),scope='baz_work_v1_'+encodeURIComponent(account),draftKey=scope+'_draft',pendingKey=scope+'_pending';
  var role={engineer:'',admin:window.BazAuth.cachedLevel()>=3,resolved:false},workspaceView=role.admin?'attention':'mine',roleTouched=false,claimReady=null,claimLoading=false,assignmentSeq=0;
  if(role.admin){state.filter='all';lastLiveFilter='all';}
  var launch=window.BazWorkLaunch?window.BazWorkLaunch.parse(window.location?.search):{receipt:false,embed:false};
  var notificationTarget=window.BazNotificationRoute?window.BazNotificationRoute.parse(window.location?.search):null,notificationOpening=false;
  var embedded=launch.receipt&&launch.embed&&window.parent!==window;
  if(embedded){$('receipt-launch-status').hidden=false;document.documentElement.dataset.receiptEmbed='true';draftKey=scope+'_lookup_draft_'+encodeURIComponent([launch.name,launch.sn,launch.region].join('|'));}
  function receiptMessage(type){if(embedded)window.parent.postMessage({type:type},window.location.origin);}
  var refreshCommentPreview=function(){};
  var pending=null,commentEdit=null,checkedRequests=new Set(),shownRequests=[],selectionMode=false,bulkWorking=false,lifecyclePlan=null;
  var fields=window.BazWorkFields,activeField=null,renderHost="list",referenceRefreshing=false,advanced={year:[],month:[],quarter:[],gubun:[],asType:[],ncare:[],engineer:[],cs:[],sales:[],status:[]};
  var editMode=false,inlineDraftKey=scope+'_inline_edits',inlineDrafts=read(inlineDraftKey)||{};
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function commentMarkup(body){
    var text=String(body==null?'':body),out='',cursor=0,pattern=/https?:\/\/[^\s<>"'\x00-\x1f]+/gi,match;
    while((match=pattern.exec(text))){
      var candidate=match[0],url=candidate;
      while(/[.,!?;:、。！？，；：]$/.test(url)||(/[)\]\}）]$/.test(url)&&((url.match(/[)\]\}）]/g)||[]).length>(url.match(/[([\{（]/g)||[]).length)))url=url.slice(0,-1);
      out+=esc(text.slice(cursor,match.index));
      var valid=false;try{var parsed=new URL(url);valid=/^https?:$/.test(parsed.protocol)&&!!parsed.hostname&&!parsed.username&&!parsed.password;}catch(e){}
      out+=valid?'<a class="comment-url" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(url)+'</a>'+esc(candidate.slice(url.length)):esc(candidate);
      cursor=match.index+candidate.length;
    }
    return out+esc(text.slice(cursor));
  }
  function store(key,v){try{if(v===null)localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify(v));return true;}catch(e){return false;}}
  function read(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch(e){return null;}}
  function localNow(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()).replace(' ','T');}
  function time(v){if(!v)return '미정';if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v))return v.replace('T',' ');var d=new Date(v);return isNaN(d.getTime())?v:new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);}
  function active(r){return !r.deletedAt&&!r.purgedAt&&r.status!=='완료'&&r.status!=='취소';}
  function overdue(r){return active(r)&&r.deadline&&r.deadline<localNow();}
  function badge(status){return '<span class="badge '+(status==='완료'?'done':['보류','취소'].includes(status)?'hold':'')+'">'+esc(status)+'</span>';}
  function statusPicker(r,detail){if(typeof editMode!=='undefined'&&editMode)return editable(r,'status',r.status);return '<span class="badge status-badge"><select'+(detail?' id="detail-status-select" data-detail-status="1"':'')+' class="status-picker" data-status-request="'+esc(r.id)+'" aria-label="'+esc(detail?'접수 상태 변경':r.hospitalName+' 상태 변경')+'" title="상태를 선택하면 바로 저장됩니다."'+(r.deletedAt||r.purgedAt?' disabled':'')+'>'+statuses.map(function(s){return '<option value="'+s+'"'+(s===r.status?' selected':'')+'>'+s+'</option>';}).join('')+'</select></span>';}
  function notify(message){$('notice').textContent=message||'';$('notice').hidden=!message;}
  function showSyncState(phase,at){
    if(at)syncCheckedAt=at;
    $('sync-state').dataset.state=phase;
    $('sync-state').textContent=phase==='loading'?'동기화 진행 중':phase==='done'?'동기화 완료':'동기화 실패';
    $('sync-time').textContent=syncCheckedAt?'마지막 동기화 '+time(syncCheckedAt):'아직 동기화되지 않았습니다.';
    $('sync').setAttribute('aria-busy',String(phase==='loading'));
    renderBridgeStatus();
  }
  function renderBridgeStatus(){
    var s=bridgeStatus,known=s&&Number.isSafeInteger(s.pendingCount)&&s.pendingCount>=0&&Number.isFinite(Date.parse(s.checkedAt));
    var stale=known&&Date.now()-Date.parse(s.checkedAt)>10*60*1000;
    $('handover-pending').textContent=known?'Handover 대기 '+s.pendingCount+'건'+(s.error?' · 연동 오류':stale?' · 이전 집계':''):'Handover 대기 미확인';
    $('handover-pending').dataset.state=!known?'unknown':s.error?'error':stale||s.pendingCount?'waiting':'done';
    $('handover-checked').textContent=known?'대기 확인 '+time(s.checkedAt):'대기 현황은 동기화로 확인';
    $('handover-status-detail').textContent=known?'확인 시각: '+time(s.checkedAt)+'\n대기 '+s.pendingCount+'건 / 전송 이벤트 '+s.pendingEvents+'개'+(s.failedCount?' / 원본 확인 필요 '+s.failedCount+'건':'')+(s.oldestPendingAt?'\n최초 대기: '+time(s.oldestPendingAt):'')+(s.error?'\n오류: '+s.error:'')+(stale?'\n10분 이상 지난 집계입니다. 동기화하여 확인하세요.':'')+'\nHandover 저장 직후 대기 집계를 전달하고, 결과는 약 5분 간격으로 최대 20건씩 전달합니다. 이 PC의 동기화 버튼은 서버에 반영된 최신 현황을 가져옵니다. 대기 0건은 전송 대기가 없다는 뜻이며 모든 접수의 완료를 뜻하지 않습니다.':'서버에서 확인한 대기 현황이 아직 없습니다. 확인 전에는 0건으로 표시하지 않습니다. 동기화 버튼으로 최신 집계를 가져오세요.';
  }
  function err(id,message){$(id).textContent=message||'';$(id).hidden=!message;}
  function updatePending(){ $('pending').hidden=!pending; $('retry').disabled=busy||bulkWorking;updateSelection();updateRosterControls(); }
  function rosterLabel(r){var p=r.date.split('-');return Number(p[1])+'/'+Number(p[2])+' '+r.person+' '+r.type;}
  function rosterItems(){return state.roster.filter(function(r){return !r.deletedAt;}).sort(function(a,b){return a.date.localeCompare(b.date)||a.person.localeCompare(b.person,'ko');});}
  function rosterRows(items,empty){
    return items.length?'<ul>'+items.map(function(r){return '<li><span class="roster-chip '+(r.type==='휴무'?'off':'duty')+'">'+esc(rosterLabel(r))+'</span><div><button type="button" data-roster-edit="'+esc(r.id)+'" aria-label="'+esc(rosterLabel(r)+' 수정')+'">수정</button><button type="button" data-roster-delete="'+esc(r.id)+'" aria-label="'+esc(rosterLabel(r)+' 삭제')+'">삭제</button></div></li>';}).join('')+'</ul>':'<p class="roster-empty">'+empty+'</p>';
  }
  function setRosterTab(tab,focus){
    rosterTab=tab==='manage'?'manage':'calendar';
    ['calendar','manage'].forEach(function(name){var selected=name===rosterTab,button=$('roster-tab-'+name);button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;$('roster-panel-'+name).hidden=!selected;});
    if(focus)$('roster-tab-'+rosterTab).focus();
  }
  function rememberTodayRoster(items,month){
    var today=localNow().slice(0,10);if(month!==today.slice(0,7))return;
    todayRoster=items.slice();todayRosterDate=today;renderTodayRoster();
  }
  function renderTodayRoster(){
    var today=localNow().slice(0,10),people=todayRosterDate===today?Array.from(new Set(todayRoster.filter(function(r){return !r.deletedAt&&r.date===today&&r.type==='휴무';}).map(function(r){return r.person;}))).sort(function(a,b){return a.localeCompare(b,'ko');}):[];
    $('roster-today-people').textContent=people.join(', ')+' · '+Number(today.slice(5,7))+'월 '+Number(today.slice(8))+'일';
    $('roster-today-notice').hidden=!people.length;
  }
  async function refreshTodayRoster(){
    if(state.rosterLoaded&&state.rosterMonth===localNow().slice(0,7)){rememberTodayRoster(state.roster,state.rosterMonth);return;}
    if(todayRosterLoading)return;todayRosterLoading=true;
    try{var month=localNow().slice(0,7),data=await api.get('work_roster',{rosterMonth:month});if(data.success&&Array.isArray(data.roster))rememberTodayRoster(data.roster,data.rosterMonth);}
    catch(e){}finally{todayRosterLoading=false;renderTodayRoster();}
  }
  function renderRosterCalendar(){
    var month=state.rosterMonth,year=Number(month.slice(0,4)),number=Number(month.slice(5)),today=localNow().slice(0,10),items=rosterItems();
    if(calendarDate.slice(0,7)!==month)calendarDate=today.slice(0,7)===month?today:month+'-01';
    var first=new Date(Date.UTC(year,number-1,1)).getUTCDay(),last=new Date(Date.UTC(year,number,0)).getUTCDate(),slots=Math.ceil((first+last)/7)*7,days='';
    for(var i=0;i<slots;i++){
      var day=i-first+1;if(day<1||day>last){days+='<span class="calendar-blank" aria-hidden="true"></span>';continue;}
      var date=month+'-'+String(day).padStart(2,'0'),entries=items.filter(function(r){return r.date===date;});
      var label=number+'월 '+day+'일 · '+(state.rosterLoaded?(entries.length?entries.map(function(r){return r.person+' '+r.type;}).join(', '):'등록된 일정 없음'):'동기화로 일정 확인');
      days+='<button type="button" class="calendar-day'+(date===today?' today':'')+(i%7===0?' sunday':i%7===6?' saturday':'')+'" data-calendar-date="'+date+'" aria-label="'+esc(label)+'" title="'+esc(label)+'" aria-pressed="'+String(date===calendarDate)+'"'+(date===today?' aria-current="date"':'')+'><span class="calendar-date">'+day+'</span><span class="calendar-entries" aria-hidden="true">'+entries.slice(0,2).map(function(r){return '<span class="calendar-person '+(r.type==='휴무'?'off':'duty')+'">'+esc(r.person+' '+r.type)+'</span>';}).join('')+(entries.length>2?'<span class="calendar-more">+'+(entries.length-2)+'명</span>':'')+'</span></button>';
    }
    $('roster-calendar-days').innerHTML=days;
    $('roster-calendar-selected-title').textContent=Number(calendarDate.slice(5,7))+'월 '+Number(calendarDate.slice(8))+'일 일정';
    $('roster-calendar-selection').innerHTML=rosterRows(items.filter(function(r){return r.date===calendarDate;}),state.rosterLoaded?'등록된 일정이 없습니다.':'일정 새로고침으로 최신 일정을 불러오세요.');
  }
  async function openRoster(date){
    if($('roster-open').disabled)return;setRosterTab('calendar');rosterDelete=null;$('roster-delete-confirm').hidden=true;renderRoster();resetRosterForm();$('roster-dialog').showModal();
    if(date){if(date.slice(0,7)!==state.rosterMonth)await loadRoster(date.slice(0,7));if(date.slice(0,7)===state.rosterMonth){calendarDate=date;renderRosterCalendar();updateRosterControls();}}
    else if(!state.rosterLoaded)await loadRoster(state.rosterMonth);
  }
  async function moveRosterMonth(offset){
    if($('roster-calendar-prev').disabled)return;
    var month=state.rosterMonth,date=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5))-1+offset,1));
    await loadRoster(date.toISOString().slice(0,7));
  }
  function renderRoster(){
    var items=rosterItems();$('roster-month').value=state.rosterMonth;
    $('roster-rows').innerHTML=rosterRows(items,state.rosterLoaded?'이 달에 등록된 휴무·당직 일정이 없습니다.':'일정 새로고침으로 최신 일정을 불러오세요.');
    var people=Array.from(new Set([account].concat(state.engineers,state.requests.flatMap(function(r){return [r.engineer,r.cs,r.sales];}),state.roster.map(function(r){return r.person;})).filter(Boolean))).sort(function(a,b){return a.localeCompare(b,'ko');});
    $('roster-people').innerHTML=people.map(function(name){return '<option value="'+esc(name)+'"></option>';}).join('');rememberTodayRoster(state.roster,state.rosterMonth);renderRosterCalendar();updateRosterControls();
  }
  function updateRosterControls(){
    var locked=busy||syncing||bulkWorking||!!pending||rosterLoading;
    $('roster-open').disabled=!state.loaded||locked;$('roster-refresh').disabled=locked;$('roster-month').disabled=locked;
    $('roster-save').disabled=locked||!state.rosterLoaded;$('roster-date').disabled=$('roster-person').disabled=locked||!!rosterEdit;$('roster-type').disabled=locked;
    $('roster-cancel-edit').disabled=$('roster-delete-submit').disabled=$('roster-delete-cancel').disabled=locked;
    $('roster-dialog').querySelectorAll('[data-roster-edit],[data-roster-delete]').forEach(function(b){b.disabled=locked;});
    $('roster-calendar-prev').disabled=$('roster-calendar-next').disabled=$('roster-calendar-edit').disabled=$('roster-calendar-today').disabled=!state.loaded||locked;
    $('roster-calendar-days').querySelectorAll('button').forEach(function(b){b.disabled=!state.loaded||locked;});
  }
  function resetRosterForm(){
    rosterEdit=null;$('roster-date').value=state.rosterMonth===localNow().slice(0,7)?localNow().slice(0,10):state.rosterMonth+'-01';$('roster-person').value='';$('roster-type').value='휴무';$('roster-form-title').textContent='일정 추가';$('roster-cancel-edit').hidden=true;err('roster-error','');updateRosterControls();
  }
  async function loadRoster(month){
    if(rosterLoading||busy||pending||syncing||bulkWorking)return;
    rosterLoading=true;updateRosterControls();err('roster-error','');
    try{var data=await api.get('work_roster',{rosterMonth:month});if(!data.success)throw new Error(data.error);state.rosterMonth=data.rosterMonth;state.roster=data.roster||[];state.rosterLoaded=true;$('roster-month').value=state.rosterMonth;rosterDelete=null;$('roster-delete-confirm').hidden=true;resetRosterForm();renderRoster();await persistSnapshot();}
    catch(e){$('roster-month').value=state.rosterMonth;err('roster-error',e.message);}
    finally{rosterLoading=false;updateRosterControls();}
  }
  function rosterSaved(data){
    var r=data.schedule;if(r.date.slice(0,7)===state.rosterMonth){var i=state.roster.findIndex(function(x){return x.id===r.id;});if(i<0)state.roster.push(r);else if(state.roster[i].revision<=r.revision)state.roster[i]=r;state.rosterLoaded=true;renderRoster();}
    rosterDelete=null;$('roster-delete-confirm').hidden=true;resetRosterForm();notify(r.deletedAt?'근무 일정을 삭제했습니다.':rosterLabel(r)+' 저장 완료');
  }
  async function saveRoster(event){
    event.preventDefault();if(rosterLoading||busy||pending||syncing||bulkWorking||!state.rosterLoaded)return;err('roster-error','');
    var date=$('roster-date').value,person=$('roster-person').value.trim().normalize('NFC');
    if(!date||date.slice(0,7)!==state.rosterMonth){err('roster-error','조회 월과 같은 날짜를 선택하세요. 다른 월은 위의 조회 월을 변경하세요.');return;}
    if(!person){err('roster-error','근무자를 선택하거나 이름을 입력하세요.');return;}
    var current=state.roster.find(function(r){return r.date===date&&r.person===person;});
    if(!rosterEdit&&current&&!current.deletedAt){err('roster-error','이미 등록된 날짜·근무자입니다. 위 목록의 수정 버튼을 사용하세요.');return;}
    var data=await write('work_roster_save',{date:date,person:person,type:$('roster-type').value,baseRevision:rosterEdit?rosterEdit.revision:current?current.revision:0},'roster');
    if(data&&!data.success)err('roster-error',data.error);updateRosterControls();
  }
  function canManage(r){return r.createdBy===account||window.BazAuth.cachedLevel()>=3;}
  function updateSelection(){
    var eligible=shownRequests.filter(canManage),locked=busy||syncing||bulkWorking||referenceRefreshing||!!pending;
    $('selection-bar').hidden=!selectionMode;
    $('list').classList.toggle('selection-mode',selectionMode);
    $('selection-mode').textContent=selectionMode?(state.filter==='trash'?'복원 모드 닫기':'삭제 모드 닫기'):(state.filter==='trash'?'복원':'삭제');
    $('selection-mode').setAttribute('aria-expanded',String(selectionMode));
    $('selection-mode').disabled=locked;
    $('edit-mode').disabled=locked||!state.loaded||state.filter==='trash';$('edit-mode').textContent=editMode?'수정 모드 닫기':'수정';$('edit-mode').setAttribute('aria-pressed',String(editMode));
    $('list').querySelectorAll('[data-inline-form] input,[data-inline-form] select,[data-inline-form] textarea,[data-inline-form] button').forEach(function(x){x.disabled=locked;});
    $('detail').querySelectorAll('[data-inline-field],[data-edit-field],[data-edit-done],[data-inline-save],[data-inline-reset],[data-inline-rebase]').forEach(function(x){x.disabled=locked||!!state.detail?.request.deletedAt||!!state.detail?.request.purgedAt;});
    $('empty-trash').hidden=state.filter!=='trash'||window.BazAuth.cachedLevel()<3;
    $('empty-trash').disabled=locked||!state.requests.some(function(r){return r.deletedAt&&!r.purgedAt;});
    checkedRequests.forEach(function(id){if(!eligible.some(function(r){return r.id===id;}))checkedRequests.delete(id);});
    $('selection-count').textContent='선택 '+checkedRequests.size+'건';
    $('select-page').checked=eligible.length>0&&checkedRequests.size===eligible.length;
    $('select-page').indeterminate=checkedRequests.size>0&&checkedRequests.size<eligible.length;
    $('select-page').disabled=locked||!selectionMode||!eligible.length;
    $('clear-selection').disabled=locked||!checkedRequests.size;
    $('delete-selected').hidden=state.filter==='trash';$('restore-selected').hidden=state.filter!=='trash';
    $('delete-selected').disabled=$('restore-selected').disabled=locked||!selectionMode||!checkedRequests.size;
    document.querySelectorAll('[data-select-request]').forEach(function(input){var r=eligible.find(function(r){return r.id===input.dataset.selectRequest;});input.checked=checkedRequests.has(input.dataset.selectRequest);input.disabled=locked||!r;});
    updateStatusControl();
    updateRosterControls();
  }
  function clearSelection(){checkedRequests.clear();updateSelection();}
  function upsert(r){var i=state.requests.findIndex(function(x){return x.id===r.id;});if(i<0)state.requests.unshift(r);else if(state.requests[i].revision<=r.revision)state.requests[i]=r;}
  function label(h){return h.name+' · '+(h.sn||'S/N 미기록')+' · '+(h.region||'지역 미기록');}
  function dbHospital(r){return fields.hospital(r,state.hospitals);}
  function displayRequest(r){var d=editMode&&inlineDrafts[r.id],h=d?state.hospitals.find(function(h){return h.origin!=='flow'&&h.key===d.form.hospitalKey;}):dbHospital(r);return h?Object.assign({},r,{hospitalName:h.name,region:h.region,sn:r.sn||h.sn}):r;}
  function hospitalTerms(r){
    var d=editMode&&inlineDrafts[r.id],values=fields.terms(d?Object.assign({},r,{hospitalKey:d.form.hospitalKey,serviceOverrides:{asType:d.form.asType,ncare:d.form.ncare}}):r,state.hospitals);
    return '<div><dt>AS 유/무상</dt><dd>'+editable(r,'asType',values.asType)+'</dd></div><div><dt>N-care</dt><dd>'+editable(r,'ncare',values.ncare)+'</dd></div>';
  }
  function dbValues(key){return Array.from(new Set(state.hospitals.filter(function(h){return h.origin!=='flow';}).map(function(h){return String(h[key]||'').trim();}).filter(Boolean))).sort(function(a,b){return a.localeCompare(b,'ko');});}
  function renderAdvanced(){
    var years=Array.from(new Set([localNow().slice(0,4)].concat(state.requests.map(function(r){return String(r.visitAt||'').slice(0,4);}).filter(Boolean)))).sort();
    var groups=[['gubun','구분',['A/S','점검']],['asType','AS 유/무상 · 병원DB 또는 접수 수정값',dbValues('asType')],['ncare','N-CARE · 병원DB 또는 접수 수정값',dbValues('ncare')],['year','년',years],['month','월',Array.from({length:12},function(_,i){return String(i+1);})],['quarter','분기',['1','2','3','4']],['engineer','엔지니어',state.engineers],['cs','CS 접수 담당',Array.from(new Set(state.requests.map(function(r){return r.cs;}).filter(Boolean))).sort()],['sales','영업 담당 · 병원정보DB',dbValues('sales')],['status','상태',statuses]];
    $('advanced-groups').innerHTML=groups.map(function(g){return '<fieldset class="advanced-group"><legend>'+esc(g[1])+'</legend><div><button type="button" data-advanced="'+g[0]+'" data-value="" aria-pressed="'+String(!advanced[g[0]].length)+'">전체</button>'+g[2].map(function(v){return '<button type="button" data-advanced="'+g[0]+'" data-value="'+esc(v)+'" aria-pressed="'+String(advanced[g[0]].includes(v))+'">'+esc(v+(g[0]==='month'?'월':g[0]==='quarter'?'분기':g[0]==='year'?'년':''))+'</button>';}).join('')+'</div></fieldset>';}).join('');
    var count=Object.values(advanced).reduce(function(n,v){return n+v.length;},0);$('advanced-toggle').textContent='⚙ 상세 필터'+(count?' · '+count:'');
  }
  async function refreshHospitalDB(){
    if(busy||syncing||pending||referenceRefreshing)return;referenceRefreshing=true;updateSelection();$('db-refresh').disabled=true;$('editor-db-refresh').disabled=true;notify('병원정보DB 최신 값을 확인하고 있습니다…');
    try{var data=await api.get('work_references_refresh',{});if(!data.success)throw new Error(data.error);var selected=state.selected;state.hospitals=data.hospitals;state.engineers=data.engineers;
      Object.keys(inlineDrafts).forEach(function(id){var f=inlineDrafts[id].form;if(state.hospitals.some(function(h){return h.key===f.hospitalKey;}))return;var h=fields.hospital({hospitalKey:f.hospitalKey},state.hospitals);if(h){f.hospitalKey=h.key;f.hospitalInput=label(h);}});store(inlineDraftKey,inlineDrafts);
      fillPeople();renderList();if(state.detail)renderDetail();if($('editor').open){var rebound=selected&&fields.hospital({hospitalKey:selected.key},state.hospitals);if(rebound)$('hospital-input').value=label(rebound);selectHospital(false);}await persistSnapshot();notify('병원정보DB 최신 값 반영 완료 · '+state.hospitals.filter(function(h){return h.origin!=='flow';}).length+'건');}
    catch(e){notify('병원정보DB 새로고침 실패: '+e.message);}
    finally{referenceRefreshing=false;$('db-refresh').disabled=false;$('editor-db-refresh').disabled=false;updateSelection();}
  }
  function normalizeTime(value){var v=String(value||'').trim(),m=/^(\d{1,2}):(\d{2})$/.exec(v);if(!m&&/^\d{3,4}$/.test(v)){v=v.padStart(4,'0');m=[v,v.slice(0,2),v.slice(2)];}return m&&Number(m[1])<24&&Number(m[2])<60?m[1].padStart(2,'0')+':'+m[2]:'';}
  function inputDateTime(prefix){var date=$(prefix+'Date').value,raw=$(prefix+'Time').value.trim();return date?(date+(raw?'T'+(normalizeTime(raw)||raw):'')):raw;}
  function formValues(){$('registeredAt').value=inputDateTime('registered');$('visitAt').value=inputDateTime('visit');return {hospitalKey:state.selected?state.selected.key:'',symptom:$('symptom').value,cs:$('cs').value,engineer:$('engineer').value,sales:$('sales').value,status:$('status').value,registeredAt:$('registeredAt').value,visitAt:$('visitAt').value,deadline:$('deadline').value};}
  function saveDraft(){
    if(!$('editor').open)return;
    var ok=store(draftKey,{id:state.editing?state.editing.id:null,baseRevision:state.editing?state.editing.revision:null,baseline:state.baseline,hospitalInput:$('hospital-input').value,form:formValues()});
    $('draft-status').textContent=ok?'이 PC에 초안 보존됨':'브라우저 저장 불가 · 창을 닫기 전에 저장하세요.';
  }
  function fillPeople(){
    var current=$('engineer').value;
    var names=Array.from(new Set(state.engineers.filter(Boolean)));
    
    $('engineer').innerHTML='<option value="">미배정</option>'+names.map(function(n){return '<option>'+esc(n)+'</option>';}).join('');$('engineer').value=current;
    $('cs-options').innerHTML=Array.from(new Set([account].filter(Boolean))).map(function(n){return '<option value="'+esc(n)+'"></option>';}).join('');
    var currentSales=$('sales').value;$('sales').innerHTML='<option value="">미기록</option>'+dbValues('sales').map(function(n){return '<option value="'+esc(n)+'">'+esc(n)+'</option>';}).join('');$('sales').value=currentSales;
    hospitalSearch.refresh();
  }
  function hospitalChanged(r,key){var h=state.hospitals.find(function(h){return h.key===key;});return key!==r.hospitalKey&&(!h||h.name!==r.hospitalName||String(h.region||'')!==String(r.region||''));}
  function inlineValues(r){
    var h=dbHospital(r),registered=String(r.registeredAt||'').split('T'),visit=String(r.visitAt||'').split('T');
    return {hospitalInput:h?label(h):r.hospitalName,hospitalKey:h?h.key:r.hospitalKey,gubun:fields.kind(r.gubun)||'A/S',status:r.status,symptom:r.symptom,engineer:r.engineer||'',cs:r.cs||'',sales:r.sales||'',registeredDate:registered[0]||'',registeredTime:registered[1]||'',visitDate:visit[0]||'',visitTime:visit[1]||'',deadlineDate:String(r.deadline||'').split('T')[0]||'',deadlineTime:String(r.deadline||'').split('T')[1]||'',asType:r.serviceOverrides?.asType||'',ncare:r.serviceOverrides?.ncare||'',acknowledgeDuplicates:false,acknowledgeHospitalChange:false};
  }
  var editLabels={hospitalInput:'병원명',symptom:'접수 내용',status:'상태',visit:'방문 일시',registered:'접수 일시',deadline:'마감일',engineer:'엔지니어',cs:'CS 담당',sales:'영업 담당',gubun:'구분',asType:'AS 유/무상',ncare:'N-care'};
  function singleTapEdit(){return matchMedia('(max-width:700px), (pointer:coarse)').matches;}
  function editable(r,name,value){
    if(!editMode||r.deletedAt)return esc(value);
    var d=inlineDrafts[r.id],f=d?d.form:inlineValues(r),editing=activeField&&activeField.id===r.id&&activeField.field===name&&activeField.host===renderHost;
    if(!editing){
      if(d){value=name==='hospitalInput'?(state.hospitals.find(function(h){return h.key===f.hospitalKey&&h.origin!=='flow';})?.name||f.hospitalInput):name==='visit'||name==='registered'||name==='deadline'?time(f[name+'Date']?(f[name+'Date']+'T'+(normalizeTime(f[name+'Time'])||f[name+'Time'])):''):name==='asType'||name==='ncare'?f[name]||fields.terms(Object.assign({},r,{hospitalKey:f.hospitalKey,serviceOverrides:{}}),state.hospitals)[name]:f[name]||'미배정';}
      return '<button type="button" class="editable-value" data-edit-field="'+name+'" data-edit-request="'+esc(r.id)+'" aria-label="'+esc((editLabels[name]||name)+' 수정')+'" title="'+(singleTapEdit()?'눌러서 수정':'더블클릭 또는 Enter로 수정')+'">'+esc(value||'미기록')+'</button>';
    }
    function input(key,type,extra){return '<input data-inline-field="'+key+'" aria-label="'+esc((editLabels[name]||name)+(type==='date'?' 날짜':key.endsWith('Time')?' 시간':''))+'" type="'+type+'" value="'+esc(f[key])+'" '+(extra||'')+'>';}
    function select(options,empty){var values=Array.from(new Set(options));return '<select data-inline-field="'+name+'" aria-label="'+esc(editLabels[name]||name)+'">'+(empty!=null?'<option value="">'+esc(empty)+'</option>':'')+(f[name]&&!values.includes(f[name])?'<option selected disabled value="'+esc(f[name])+'">'+esc(f[name])+' · 현재 DB에 없음</option>':'')+values.map(function(v){return '<option value="'+esc(v)+'"'+(v===f[name]?' selected':'')+'>'+esc(v)+'</option>';}).join('')+'</select>';}
    var html=name==='hospitalInput'?input(name,'text','role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="off"'):name==='symptom'?'<textarea data-inline-field="symptom" aria-label="접수 내용" rows="3" maxlength="4000">'+esc(f.symptom)+'</textarea>':name==='gubun'?select(['A/S','점검']):name==='status'?select(statuses):name==='engineer'?select(state.engineers,'미배정'):name==='sales'?select(dbValues('sales'),'미기록'):name==='asType'||name==='ncare'?select(dbValues(name),'병원DB 값 사용'):name==='visit'||name==='registered'||name==='deadline'?'<span class="edit-datetime">'+input(name+'Date','date')+input(name+'Time','text','inputmode="numeric" maxlength="5" placeholder="10:00 또는 1000"')+'</span>':input(name,'text','maxlength="60"');
    return '<span class="field-editor">'+html+'<button type="button" data-edit-done="'+esc(r.id)+'" aria-label="입력 적용">✓</button></span>';
  }
  function inlineActions(r){
    var d=inlineDrafts[r.id];if(!d)return '';
    var f=d.form,stale=d.baseRevision!==r.revision;
    return '<div class="inline-actions"><span class="hint">미저장 수정 · 이 PC에 보관</span>'+(hospitalChanged(r,f.hospitalKey)?'<label class="check"><input type="checkbox" data-inline-field="acknowledgeHospitalChange"'+(f.acknowledgeHospitalChange?' checked':'')+'>병원 변경 확인 · 기존 댓글·결과 유지</label>':'')+(d.duplicate?'<label class="check"><input type="checkbox" data-inline-field="acknowledgeDuplicates"'+(f.acknowledgeDuplicates?' checked':'')+'>중복 일정 확인</label>':'')+(d.error||stale?'<p class="notice">'+esc(d.error||(stale?'다른 사용자의 변경이 있습니다. 최신 값과 비교하세요.':''))+'</p>':'')+(d.current?'<details class="inline-conflict"><summary>서버의 최신 값 비교</summary><p>'+esc(d.current.hospitalName+' · '+d.current.symptom+' · '+time(d.current.visitAt)+' · '+d.current.status)+'</p><button type="button" data-inline-rebase="'+esc(r.id)+'">최신 값 확인 후 내 입력으로 계속 수정</button></details>':'')+'<button type="button" data-inline-reset="'+esc(r.id)+'">되돌리기</button><button type="button" class="primary" data-inline-save="'+esc(r.id)+'">접수 저장</button></div>';
  }
  function renderEdits(){renderList();if(state.detail)renderDetail();}
  function beginEdit(event){
    var b=event.target.closest('[data-edit-field]');if(!b||!editMode||busy||pending||syncing||bulkWorking||referenceRefreshing||b.disabled)return;
    var r=state.requests.find(function(r){return r.id===b.dataset.editRequest;});if(!r||r.deletedAt||r.purgedAt)return;
    event.preventDefault();var host=b.closest('#detail')?$('detail'):$('list');activeField={id:r.id,field:b.dataset.editField,host:host.id};renderEdits();
    var selector=host.id==='detail'?'[data-inline-field]':'[data-inline-form="'+activeField.id+'"] [data-inline-field]';var control=Array.from(host.querySelectorAll(selector)).find(function(x){return x.offsetParent!==null;});if(control)control.focus();
  }
  function editKey(event){if(event.key==='Enter'||event.key==='F2')beginEdit(event);}
  function editClick(event){
    var b=event.target.closest('button');if(!b||busy||pending||syncing||referenceRefreshing)return false;
    if(b.dataset.editField&&singleTapEdit()){beginEdit(event);return true;}
    if(b.dataset.editDone){var container=b.closest('[data-inline-form]');if(container)captureInline(container);activeField=null;renderEdits();return true;}
    if(b.dataset.inlineSave){saveInline({target:b,preventDefault:function(){}});return true;}
    if(b.dataset.inlineReset){delete inlineDrafts[b.dataset.inlineReset];store(inlineDraftKey,inlineDrafts);activeField=null;renderEdits();return true;}
    if(b.dataset.inlineRebase){var d=inlineDrafts[b.dataset.inlineRebase];if(d?.current){d.baseRevision=d.current.revision;delete d.current;delete d.error;store(inlineDraftKey,inlineDrafts);renderEdits();}return true;}
    return false;
  }
  function captureInline(form,changedField){
    if(busy||pending||syncing||referenceRefreshing)return null;
    var r=state.requests.find(function(r){return r.id===form.dataset.inlineForm;});if(!r)return null;
    var d=inlineDrafts[r.id]||{baseRevision:r.revision,form:inlineValues(r)},f=d.form,previousKey=f.hospitalKey;
    form.querySelectorAll('[data-inline-field]').forEach(function(x){if(changedField&&x.dataset.inlineField!==changedField)return;f[x.dataset.inlineField]=x.type==='checkbox'?x.checked:x.value;});
    var matches=state.hospitals.filter(function(h){return h.origin!=='flow'&&(label(h)===f.hospitalInput.trim()||h.name===f.hospitalInput.trim());});f.hospitalKey=matches.length===1?matches[0].key:'';
    if(previousKey!==f.hospitalKey){if(matches.length===1)f.sales=matches[0].sales||'';f.asType='';f.ncare='';f.acknowledgeHospitalChange=false;var hospitalAck=form.querySelector('[data-inline-field="acknowledgeHospitalChange"]');if(hospitalAck)hospitalAck.checked=false;}
    if(changedField&&!['acknowledgeDuplicates','acknowledgeHospitalChange'].includes(changedField)){f.acknowledgeDuplicates=false;var duplicateAck=form.querySelector('[data-inline-field="acknowledgeDuplicates"]');if(duplicateAck)duplicateAck.checked=false;}
    inlineDrafts[r.id]=d;store(inlineDraftKey,inlineDrafts);form.classList.add('dirty');
    var ack=form.querySelector('[data-inline-hospital-ack]');if(ack)ack.hidden=!f.hospitalKey||!hospitalChanged(r,f.hospitalKey);return d;
  }
  async function saveInline(event){
    var form=event.target.closest('[data-inline-form]');if(!form)return;event.preventDefault();if(busy||pending||syncing||bulkWorking||referenceRefreshing)return;
    var r=state.requests.find(function(r){return r.id===form.dataset.inlineForm;}),d=captureInline(form);if(!r||!d)return;
    var f=d.form,message='';
    if(!f.hospitalKey)message='병원정보DB 목록에서 정확한 병원을 선택하세요.';
    else if(!f.registeredDate||!normalizeTime(f.registeredTime))message='등록 날짜와 시간을 입력하세요. 시간은 10:00 또는 1000 형태로 입력할 수 있습니다.';
    else if((f.visitDate||f.visitTime)&&(!f.visitDate||!normalizeTime(f.visitTime)))message='방문 날짜와 시간을 함께 입력하세요.';
    else if((f.deadlineDate||f.deadlineTime)&&(!f.deadlineDate||!normalizeTime(f.deadlineTime)))message='마감 날짜와 시간을 함께 입력하세요.';
    if(message){d.error=message;store(inlineDraftKey,inlineDrafts);renderEdits();return;}
    var values={hospitalKey:f.hospitalKey,gubun:f.gubun,status:f.status,symptom:f.symptom,cs:f.cs,engineer:f.engineer,sales:f.sales,registeredAt:f.registeredDate+'T'+normalizeTime(f.registeredTime),visitAt:f.visitDate?f.visitDate+'T'+normalizeTime(f.visitTime):'',deadline:f.deadlineDate?f.deadlineDate+'T'+normalizeTime(f.deadlineTime):'',serviceOverrides:{asType:f.asType,ncare:f.ncare}};
    var data=await write('work_request_edit',{id:r.id,baseRevision:d.baseRevision,form:values,acknowledgeDuplicates:!!f.acknowledgeDuplicates,acknowledgeHospitalChange:!!f.acknowledgeHospitalChange},'inline-request');
    if(!data)return;if(data.success)return;
    d.error=data.error;d.duplicate=!!data.duplicate;if(data.duplicate)d.error+='\n'+(data.candidates||[]).concat(data.overlaps||[]).map(function(x){return x.hospitalName+' · '+time(x.visitAt)+' · '+(x.engineer||'미배정');}).join('\n');if(data.conflict){d.current=data.current;upsert(data.current);}store(inlineDraftKey,inlineDrafts);renderEdits();
  }
  function workspaceLabel(view){return {attention:'확인할 업무',all:'전체 업무',mine:'내 업무',unassigned:'미배정',changed:'원본 변경'}[view]||'전체 업무';}
  function renderWorkspace(){
    if(!$('workspace-title'))return;
    $('workspace-title').textContent=state.filter==='trash'?'휴지통':workspaceLabel(workspaceView);
    var hint=workspaceView==='attention'?'미배정·결과 확인 대기·Handover 원본 변경을 모아 보여줍니다.':workspaceView==='mine'?(role.engineer?role.engineer+' 담당으로 배정된 업무입니다.':'본인 담당자 연결을 확인해 주세요. 앱 설치·알림 설정에서 연결할 수 있습니다.'):workspaceView==='unassigned'?'담당자를 지정하면 해당 담당자에게 접수 알림이 전달됩니다.':workspaceView==='changed'?'완료된 업무를 포함해 Handover 원본 확인이 필요한 기록입니다.':'기간·상태·검색 조건을 적용해 전체 업무를 조회합니다.';
    if(workspaceView==='mine'&&!role.resolved)hint=role.failed?'담당자 연결 확인에 실패했습니다. 전체 업무로 전환하거나 앱 설치·알림 설정에서 다시 확인하세요.':'본인의 담당자 연결을 확인하고 있습니다.';
    $('workspace-hint').textContent=hint;document.querySelectorAll('[data-workspace]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.workspace===workspaceView&&state.filter!=='trash'));});
    $('my-today').disabled=!role.engineer;$('my-today').title=role.engineer?'오늘 '+role.engineer+' 방문 업무':'앱 설치·알림 설정에서 담당자를 연결하세요.';
  }
  async function loadRoleContext(){
    try{var c=await window.BazNotifications.config(true);role={engineer:c.engineer||'',admin:!!c.admin,resolved:true};if(!roleTouched){workspaceView=role.admin?'attention':'mine';if(role.admin){state.filter='all';lastLiveFilter='all';}}if(state.loaded){renderList();if(state.detail&&!detailLoading)renderDetail();}}
    catch(e){role.resolved=false;role.failed=true;if(state.loaded)renderList();else renderWorkspace();}
  }
  function assignmentNotes(r,engineer,roster){
    var day=String(r.visitAt||'').slice(0,10),notes=[];
    if(roster.some(function(s){return !s.deletedAt&&s.date===day&&s.person===engineer&&s.type==='휴무';}))notes.push(engineer+' 담당자는 '+day+' 휴무로 등록되어 있습니다.');
    var overlaps=state.requests.filter(function(x){return x.id!==r.id&&active(x)&&r.visitAt&&x.visitAt===r.visitAt&&x.engineer===engineer;});
    if(overlaps.length)notes.push('같은 방문 일시에 '+overlaps.map(function(x){return x.hospitalName;}).join(', ')+' 일정이 있습니다(현재 목록 기준).');
    return notes;
  }
  async function checkAssignment(){
    var seq=++assignmentSeq,engineer=$('engineer').value,date=$('visitDate').value,at=normalizeTime($('visitTime').value),out=$('assignment-warning');out.hidden=true;
    if(!engineer||!/^\d{4}-\d{2}-\d{2}$/.test(date))return;
    out.hidden=false;out.textContent='배정할 담당자의 근무 일정을 확인하고 있습니다…';
    try{var data=await api.get('work_roster',{rosterMonth:date.slice(0,7)});if(seq!==assignmentSeq||!$('editor').open)return;if(!data.success)throw new Error(data.error);var notes=assignmentNotes({id:state.editing?.id,visitAt:at?date+'T'+at:date},engineer,data.roster||[]);out.textContent=notes.join(' ')+' 일정을 확인한 뒤 저장하세요.';out.hidden=!notes.length;}
    catch(e){if(seq===assignmentSeq){out.hidden=false;out.textContent='근무 일정 확인 실패 · '+e.message+' 일정 확인 후 저장하세요.';}}
  }
  async function claimRequest(){
    if(claimLoading||notificationOpening||busy||syncing||pending||!state.detail||!role.engineer)return;
    var r={...state.detail.request},signature=[r.id,r.revision,role.engineer].join('|'),ack=claimReady===signature,button=$('detail').querySelector('[data-action="claim"]');if(!button)return;
    claimLoading=true;button.disabled=true;
    function feedback(message){var el=$('claim-status')||$('detail-feedback');if(el){el.hidden=false;el.textContent=message;}}
    try{
      var roster=[];if(r.visitAt){var data=await api.get('work_roster',{rosterMonth:r.visitAt.slice(0,7)});if(!data.success)throw new Error('근무 일정 확인 실패 · '+data.error);roster=data.roster||[];}
      if(busy||syncing||pending||!state.detail||state.detail.request.id!==r.id||state.detail.request.revision!==r.revision)return;
      var notes=assignmentNotes(r,role.engineer,roster);
      if(notes.length&&!ack){claimReady=signature;feedback(notes.join(' '));button.textContent='일정 확인 후 담당하기';return;}
      var result=await write('work_claim',{requestId:r.id,baseRevision:r.revision,expectedEngineer:role.engineer,acknowledgeDuplicates:ack},'claim');
      if(result&&!result.success){if(result.duplicate){claimReady=signature;feedback(result.error);button.textContent='일정 확인 후 담당하기';}else{if(result.current){upsert(result.current);await persistSnapshot();await openDetail(r.id,true);}feedback(result.error);}}
      else if(result?.success){claimReady=null;var el=$('detail-feedback');if(el){el.hidden=false;el.textContent=role.engineer+' 담당으로 배정했습니다.';}}
    }catch(e){feedback(e.message);}
    finally{claimLoading=false;var current=$('detail').querySelector('[data-action="claim"]');if(current)current.disabled=busy||!!pending||!role.engineer;}
  }
  function receiptButton(r){return r.deletedAt||r.purgedAt?'':'<button type="button" aria-label="알림 읽음 현황" title="알림 읽음 현황 보기" data-receipt-request="'+esc(r.id)+'">읽음 현황</button>'; }
  function renderList(){
    renderWorkspace();
    renderHost='list';renderAdvanced();var period=fields.range(state.filter,localNow().slice(0,10),localNow().slice(0,7));
    var today=localNow().slice(0,10),search=$('search').value.trim().toLowerCase();
    var query={filter:state.filter,today:today,month:localNow().slice(0,7),statusScope:state.statusScope,advanced:advanced,search:search,account:account,view:workspaceView,engineer:role.engineer};
    var counts=fields.counts(state.requests,query,state.hospitals);
    $('count-total').textContent=counts.total;$('count-active').textContent=counts.active;$('count-review').textContent=counts.review;$('count-completed').textContent=counts.completed;
    if(workspaceView==='mine'&&!role.engineer&&state.filter!=='trash')['count-total','count-active','count-review','count-completed'].forEach(function(id){$(id).textContent='—';});
    document.querySelectorAll('[data-metric]').forEach(function(b){b.setAttribute('aria-pressed',String(!advanced.status.length&&b.dataset.metric===state.statusScope));});
    $('review-alert').hidden=!counts.globalReview;$('review-alert-count').textContent=counts.globalReview+'건';
    var sourceAlerts=state.requests.filter(function(r){return !r.deletedAt&&r.handoverReviewCount>0;});
    $('workspace-alerts').hidden=!sourceAlerts.length&&!counts.globalReview;$('workspace-alert-count').textContent='원본 변경 '+sourceAlerts.length+'건 · 결과 확인 '+counts.globalReview+'건 · 전체 기간';
    if($('source-review-alert')){$('source-review-alert').hidden=!sourceAlerts.length;$('source-review-alert').innerHTML='<summary>Handover 원본 변경 확인 · '+sourceAlerts.length+'건 <small>전체 기간</small></summary><div>'+sourceAlerts.map(function(r){return '<button type="button" data-open="'+esc(r.id)+'">'+esc(r.hospitalName)+' · '+esc(time(r.visitAt))+' · '+r.handoverReviewCount+'개 기록</button>';}).join('')+'</div>';}

    $('trash-toggle').setAttribute('aria-pressed',String(state.filter==='trash'));$('trash-toggle').textContent=state.filter==='trash'?'휴지통 닫기':'휴지통';
    var rows=state.requests.filter(function(r){
      return fields.query(r,Object.assign({},query,{name:displayRequest(r).hospitalName}),state.hospitals);
    });
    var sort=$('sort').value,key=sort==='updated'?'updatedAt':sort==='deadline'?'deadline':'visitAt',direction=$('sort-direction').value==='desc'?-1:1;
    rows.sort(function(a,b){var av=a[key]||'',bv=b[key]||'';if((!av||!bv)&&av!==bv)return av?-1:1;return direction*av.localeCompare(bv)||(b.updatedAt||'').localeCompare(a.updatedAt||'')||a.id.localeCompare(b.id);});
    var pages=Math.max(1,Math.ceil(rows.length/50));state.page=Math.min(state.page,pages);
    var scopeLabel=advanced.status.length?advanced.status.join(', '):{all:'전체 상태',active:'진행 중',review:'결과 확인 대기',completed:'처리 완료'}[state.statusScope];
    var periodLabel=state.filter==='trash'?'휴지통 · 전체 기간':state.filter==='today'?today:period?period[0]+' ~ '+period[1]:'전체 기간';
    var conditions=[state.filter==='trash'?'휴지통':workspaceLabel(workspaceView),'방문일 기준 '+periodLabel,scopeLabel],labels={gubun:'구분',asType:'AS',ncare:'N-CARE',year:'년',month:'월',quarter:'분기',engineer:'엔지니어',cs:'CS 담당',sales:'영업 담당'};
    if(search)conditions.push('검색 “'+$('search').value.trim()+'”');Object.keys(labels).forEach(function(k){if(advanced[k].length)conditions.push(labels[k]+' '+advanced[k].join(', '));});conditions.push(rows.length+'건');
    $('period-caption').textContent=conditions.join(' · ')+(editMode?(singleTapEdit()?' · 항목을 눌러 수정':' · 값을 더블클릭하여 수정'):'');
    $('list-count').textContent=rows.length+'건 · 전체 '+state.requests.filter(function(r){return !r.deletedAt;}).length+'건';$('page-info').textContent=state.page+' / '+pages;
    $('prev').disabled=state.page<=1;$('next').disabled=state.page>=pages;
    document.querySelectorAll('.filter-bar [data-filter]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.filter===state.filter));});
    var shown=rows.slice((state.page-1)*50,state.page*50);shownRequests=shown;updateSelection();
    if(!shown.length){var unmapped=workspaceView==='mine'&&!role.engineer&&state.filter!=='trash';$('list').innerHTML='<div class="empty"><strong>'+(unmapped?'본인 담당자 연결을 확인해 주세요.':state.requests.length?(workspaceView==='attention'?'조건에 맞는 확인할 업무가 없습니다':'조건에 맞는 업무가 없습니다'):'등록된 A/S 업무가 없습니다')+'</strong>'+(unmapped?'<a href="install.html">앱 설치·알림 설정에서 담당자 연결 확인 ↗</a>':state.requests.length?'검색어나 기간·업무 범위를 변경해 보세요.':'상단의 접수 등록에서 첫 요청을 등록하세요.')+'</div>';return;}
    function rowButton(r){var shown=displayRequest(r);return (editMode?editable(r,'hospitalInput',shown.hospitalName)+'<button class="row-detail-link" data-open="'+esc(r.id)+'">상세 보기 ↗</button>':'<button class="row-open" data-open="'+esc(r.id)+'">'+esc(shown.hospitalName)+'</button>')+'<div class="summary">'+editable(r,'symptom',r.symptom)+'</div>';}
    function rowCheck(r){return '<input type="checkbox" data-select-request="'+esc(r.id)+'" aria-label="'+esc(r.hospitalName+' · '+time(r.visitAt)+' · '+r.symptom.slice(0,60)+' 접수 선택')+'"'+(checkedRequests.has(r.id)?' checked':'')+(canManage(r)?'':' disabled title="등록자 또는 관리자만 선택할 수 있습니다."')+'>';}
    $('list').innerHTML='<div class="table-scroll"><table><thead><tr><th class="selection-cell"><span class="sr-only">접수 선택</span></th><th>병원 / 접수 증상</th><th>상태</th><th>방문 일시</th><th>엔지니어</th><th>CS 담당</th><th class="recent-column">최근 기록</th><th class="read-receipts-column">알림</th></tr></thead><tbody>'+shown.map(function(r){return '<tr data-inline-form="'+esc(r.id)+'" class="'+(state.detail&&state.detail.request.id===r.id?'selected':'')+(checkedRequests.has(r.id)?' checked-row':'')+'"><td class="selection-cell">'+rowCheck(r)+'</td><td>'+rowButton(r)+'</td><td>'+statusPicker(r)+(overdue(r)?'<div class="overdue">마감 초과</div>':'')+'</td><td class="date">'+editable(r,'visit',time(r.visitAt))+'</td><td>'+editable(r,'engineer',r.engineer||'미배정')+'</td><td>'+editable(r,'cs',r.cs)+'</td><td class="recent-column"><div class="summary">'+esc(r.latest||'—')+'</div></td><td class="read-receipts-column">'+receiptButton(r)+'</td></tr>'+(editMode&&inlineDrafts[r.id]?'<tr class="edit-save-row" data-inline-form="'+esc(r.id)+'"><td colspan="8">'+inlineActions(r)+'</td></tr>':'');}).join('')+'</tbody></table></div><div class="mobile-cards">'+shown.map(function(r){if(editMode){
      function mobileField(name,value){return '<div class="mobile-edit-field mobile-edit-field--'+name+'"><span class="mobile-edit-label">'+esc(editLabels[name])+'</span>'+editable(r,name,value)+'</div>';}
      return '<article class="mobile-card editable-card" data-inline-form="'+esc(r.id)+'"><div class="mobile-edit-heading"><span class="mobile-edit-label">병원명</span><button type="button" class="row-detail-link" data-open="'+esc(r.id)+'">상세 보기 ↗</button></div><div class="mobile-edit-hospital">'+editable(r,'hospitalInput',displayRequest(r).hospitalName)+'</div>'+mobileField('symptom',r.symptom)+'<div class="mobile-edit-grid">'+mobileField('status',r.status)+mobileField('visit',time(r.visitAt))+mobileField('engineer',r.engineer||'미배정')+mobileField('cs',r.cs)+'</div>'+inlineActions(r)+'</article>';
    }return '<div class="mobile-card '+(state.detail&&state.detail.request.id===r.id?'selected':'')+(checkedRequests.has(r.id)?' checked-row':'')+'"><div class="mobile-status">'+statusPicker(r)+'</div><label class="mobile-select">'+rowCheck(r)+'<span class="sr-only">접수 선택</span></label><button data-open="'+esc(r.id)+'"><div class="card-top"><span>'+esc(displayRequest(r).hospitalName)+'</span>'+'</div><div class="card-meta">'+esc(time(r.visitAt))+' · '+esc(r.engineer||'미배정')+(overdue(r)?' · 마감 초과':'')+'</div><div class="card-summary">'+esc(r.symptom.slice(0,130))+'</div></button><div class="read-receipts-card-footer">'+receiptButton(r)+'</div></div>';}).join('')+'</div>';updateSelection();
  }
  async function readSyncData(force){
    var data,nextRevision;
    if(state.loaded&&kvReady&&force!==true){
      var merged=new Map(state.requests.map(function(r){return [r.id,r];})),next=revision,upper;
      do{
        data=await api.get('work_sync',Object.assign({revision:next,rosterMonth:state.rosterMonth},upper===undefined?{}:{snapshotSeq:upper}));
        if(!data.success){if(data.code==='REVISION_INVALID')return readSyncData(true);throw new Error(data.error);}
        if(upper===undefined)upper=data.snapshotSeq;
        if(!Number.isSafeInteger(Number(data.revision))||Number(data.revision)<Number(next)||data.more&&Number(data.revision)<=Number(next))throw new Error('동기화 커서가 전진하지 않습니다. 다시 시도하세요.');
        if(upper!==undefined&&(String(data.snapshotSeq)!==String(upper)||Number(data.revision)>Number(upper)))throw new Error('동기화 조회 범위가 변경되었습니다. 다시 시도하세요.');
        (data.requests||[]).forEach(function(r){var old=merged.get(r.id);if(!old||old.revision<=r.revision)merged.set(r.id,r);});next=data.revision;
      }while(data.more);
      data.requests=Array.from(merged.values());nextRevision=next;
    }else{
      var all=[],page='',base,seen=new Set();
      do{
        data=await api.get('work_bootstrap',Object.assign({rosterMonth:state.rosterMonth},page?{pageCursor:page,snapshotSeq:base}:{}));
        if(!data.success)throw new Error(data.error);
        if(base===undefined)base=data.revision;
        all=all.concat(data.requests||[]);page=data.pageCursor;
        if(page&&seen.has(page))throw new Error('전체 조회 커서가 전진하지 않습니다. 다시 시도하세요.');
        if(page)seen.add(page);
      }while(page);
      data.requests=all;nextRevision=base||'0';
    }
    return {data:data,revision:nextRevision};
  }
  async function sync(force){
    if(syncing||busy||bulkWorking||rosterLoading)return;syncing=true;updateSelection();$('sync').disabled=true;$('sync').textContent='동기화 중…';showSyncState('loading');notify('');
    try{
      var loaded=await readSyncData(force),data=loaded.data;
      if(window.BazAuth.name()!==account)throw new Error('계정이 변경되었습니다. 다시 접속하세요.');
      // 늦게 도착한 목록으로 이 PC에서 저장한 더 높은 버전을 덮지 않는다.
      var newer=state.requests;state.requests=data.requests;
      newer.forEach(function(r){var x=state.requests.find(function(v){return v.id===r.id;});if(x&&x.revision<r.revision)upsert(r);});
      for(var removed of state.requests.filter(function(r){return r.purgedAt;}))await forgetPurged(removed.id);
      revision=loaded.revision;kvReady=data.storage==='kv';sourceCheckedAt=data.sourceCheckedAt||sourceCheckedAt;if(Object.prototype.hasOwnProperty.call(data,'bridgeStatus'))bridgeStatus=data.bridgeStatus;if(Array.isArray(data.hospitals))state.hospitals=data.hospitals;if(Array.isArray(data.engineers))state.engineers=data.engineers;state.loaded=true;fillPeople();renderList();
      if(Array.isArray(data.roster)){state.roster=data.roster;state.rosterMonth=data.rosterMonth;state.rosterLoaded=true;}renderRoster();await refreshTodayRoster();
      $('new').disabled=false;
      if(data.autoMatch){
        var completed=data.autoMatch.completed.length,skipped=data.autoMatch.skipped.length;
        if(completed||skipped)notify((completed?'Handover 결과 '+completed+'건 자동 연결·완료. ':'')+(skipped?'자동 연결 확인이 필요한 업무 '+skipped+'건은 상세에서 직접 확인하세요.':''));
      }
      if(state.detail){
        renderDetail();
        // 기준 정보만 바뀌어도 즉시 반영하며 댓글 입력과 접힘 상태는 유지한다.
        $('hospital-terms').innerHTML=hospitalTerms(state.detail.request);
        var latest=state.requests.find(function(r){return r.id===state.detail.request.id;});
        if(latest&&latest.revision!==state.detail.request.revision){
          if($('comment-body')&&$('comment-body').value.trim())notify('선택 업무가 변경되었습니다. 작성 중인 댓글은 유지했습니다. 저장 전 최신 내용을 확인하세요.');
          else await openDetail(latest.id,true);
        }
      }
      if($('editor').open)notify('목록을 동기화했습니다. 작성 중인 접수 입력은 유지되며 저장 시 최신 버전을 확인합니다.');
      showSyncState('done',data.updatedAt);await persistSnapshot();
      if(data.queryIndexReady===false)prepareQueryIndex();
    }catch(e){showSyncState('error');notify(e.message);if(!state.loaded){$('list').innerHTML='<div class="empty"><strong>업무 데이터를 불러오지 못했습니다</strong>로그인과 GAS 배포 상태를 확인하고 동기화 버튼으로 다시 시도하세요.</div>';$('new').disabled=true;}}
    finally{syncing=false;$('sync').disabled=false;$('sync').textContent='↻ 동기화';updateSelection();}
  }
  function resultFields(s,memo){
    var assessment={nsFill:s.nsFill||'',nsAmt:s.nsAmt||'',jet:s.jet||''};
    if(s.origin==='flow'&&memo){
      var patterns={nsFill:/NS\s*충진\s*여부\s*[:：]\s*([^\n]*?)(?=NS\s*충진량|젯\s*분사|\n|$)/,nsAmt:/NS\s*충진량\s*[:：]\s*([^\n]*?)(?=젯\s*분사|비고\s*\/\s*특이사항|\n|$)/,jet:/젯\s*분사\s*판단(?:\[[^\]]*\])?\s*[:：]\s*([^\n]*?)(?=비고\s*\/\s*특이사항|\n|$)/};
      Object.keys(patterns).forEach(function(k){var hit=patterns[k].exec(memo);if(!assessment[k]&&hit)assessment[k]=hit[1].replace(/\s*[-•]\s*$/,'').trim();});
    }
    var reuse=String(s.nozzleReuse||'').trim().toUpperCase(),reuseText=['O','Y','유','예'].includes(reuse)?'유':['X','N','무','아니오'].includes(reuse)?'무':reuse||'미기록';
    var fields=[['원본 병원',s.hospitalName],['처리일',s.date],['실제 처리자',s.engineer],['장비 S/N',s.sn],['처리 구분',s.gubun],['처리 항목',[s.cat,s.type].filter(Boolean).join(' / ')],['처리 내용',s.detail],['처리 결과',s.result],['교체품',s.part],['교체비용',s.cost],['특이사항',s.remark],['노즐 재사용',reuseText]];
    return '<dl class="result-fields">'+fields.map(function(x){var wide=x[0]==='처리 내용'||x[0]==='특이사항',kind=wide?' class="result-wide"':x[0]==='처리 결과'?' class="result-outcome"':'';return '<dt'+kind+'>'+esc(x[0])+'</dt><dd'+kind+'>'+esc(x[1]||'미기록')+'</dd>';}).join('')+'</dl><h4>사용자 숙련도 평가</h4><dl class="result-fields">'+[['NS 충진 여부',assessment.nsFill],['NS 충진량',assessment.nsAmt],['젯 분사 판단',assessment.jet]].map(function(x){return '<dt>'+x[0]+'</dt><dd>'+esc(x[1]||'미기록')+'</dd>';}).join('')+'</dl>';
  }
  function detailMarkup(d,r,results,comments){
    var back='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg>';
    var home='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-8 9 8M5 9v12h5v-7h4v7h5V9"/></svg>';
    var person='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/></svg>';
    function personChip(name){return '<span class="person-chip"><span class="person-icon">'+person+'</span><span class="person-name">'+esc(name||'미배정')+'</span></span>';}
    var kinds=Array.from(new Set(results.map(function(h){return fields.kind(h.source.gubun);}).filter(function(v){return v==='A/S'||v==='점검';})));
    var category=fields.kind(r.gubun)||(kinds.length?kinds.join(' · '):'구분 미확인');
    var statusMarkup='<div class="detail-status-editor">'+statusPicker(r,true)+'<span class="badge work-kind" aria-label="처리 구분">'+editable(r,'gubun',category)+'</span></div>';
    var facts=[['상태',statusMarkup],['엔지니어',(editMode?editable(r,'engineer',r.engineer||'미배정'):personChip(r.engineer)),'fact-assignee'],['영업 담당자',(editMode?editable(r,'sales',r.sales||'미배정'):personChip(r.sales)),'fact-assignee'],['방문 일시',editable(r,'visit',time(r.visitAt))],['마감일','<span class="'+(overdue(r)?'deadline-overdue':'')+'">'+editable(r,'deadline',time(r.deadline))+'</span>']];
    return [
      '<div class="detail-bar"><button data-action="close-detail" aria-label="상세 닫기">'+back+'</button><a href="index.html" aria-label="메인으로">'+home+'</a><div><strong>서비스 업무 상세</strong><span>병원 접수 · 처리 결과</span></div></div><p id="detail-feedback" class="assignment-warning" role="status" hidden></p>',
      '<div class="detail-summary"><div class="request-byline"><span class="request-avatar" aria-hidden="true">'+esc((r.cs||'CS').slice(-2))+'</span><div><strong>'+editable(r,'cs',r.cs||'담당 미기록')+'</strong><span>CS 접수 담당 · '+editable(r,'registered',time(r.registeredAt))+'</span></div></div>',
      '<div class="detail-heading"><div><h2>'+editable(r,'hospitalInput',r.hospitalName)+'</h2><p class="detail-sub">'+esc([r.region,r.sn||'S/N 미기록'].filter(Boolean).join(' · '))+'</p></div></div>',
      '<dl id="hospital-terms" class="hospital-terms" aria-label="병원 서비스 조건">'+hospitalTerms(r)+'</dl>',
      '<dl class="facts">'+facts.map(function(x){return '<div class="fact '+(x[2]||'')+'"><dt>'+x[0]+'</dt><dd>'+x[1]+'</dd></div>';}).join('')+'</dl>',
      r.status==='완료'?'<div class="completion-progress"><span>진척도</span><div><progress max="100" value="100" aria-label="업무 완료 100%">100%</progress><strong>100%</strong></div></div>':'',
      '</div>',
      !r.deletedAt&&!r.engineer&&active(r)&&!d.preview?'<section class="claim-panel"><div><strong>담당자가 정해지지 않았습니다</strong><p>'+(role.engineer?esc(role.engineer)+' 담당으로 가져올 수 있습니다.':'앱 설치·알림 설정에서 본인 담당자를 연결해 주세요.')+'</p></div><button type="button" data-action="claim"'+(!role.engineer?' disabled':'')+'>내가 담당하기</button><p id="claim-status" class="assignment-warning" role="status" hidden></p></section>':'',
      !r.deletedAt&&!d.preview&&!editMode&&window.BazWorkFlow?'<section class="work-flow-panel"><h3>다음 작업</h3><div class="work-flow-main"><button type="button" data-action="work-flow">'+(results.some(function(h){return h.source.origin!=='flow';})?(results.some(function(h){return h.source.pdf;})?'내역서 확인':'내역서 작성'):'현장 기록 작성')+'</button><p>접수 정보 → 현장 기록 → PDF 저장·댓글 연결</p></div></section>':'',
      !d.preview?'<section class="detail-content read-receipts-section" aria-label="알림 읽음 현황">'+receiptButton(r)+'</section>':'',
      '<section class="receipt-section detail-content"><h3>접수 내용</h3><p class="entry-body">'+editable(r,'symptom',r.symptom)+'</p>'+ (editMode?inlineActions(r):'')+'</section>',
      '<section class="results-section" aria-labelledby="as-result-heading"><h3 id="as-result-heading" class="section-divider">처리 결과</h3><div class="detail-content"><div class="result-list">',
      d.preview?'<p class="result-empty hint">처리 결과를 불러오는 중…</p>':results.length?results.map(function(h){return '<article class="detail-result">'+(h.source.origin==='flow'?'<span class="result-origin">Flow 이전 기록</span>':'')+(h.source.origin!=='flow'?'<p class="review-label">'+(h.source.reviewVersion?'검수 완료 v'+esc(h.source.reviewVersion)+' · '+esc(h.source.reviewedBy):'미검수')+'</p>'+((editMode&&window.BazHandoverReview&&!r.deletedAt)?'<button type="button" data-review-record="'+esc(h.source.recordId)+'" data-review-request="'+esc(r.id)+'">Handover 본문 검수</button>':''):'')+(window.BazSourceReview?window.BazSourceReview.markup(h,!!r.deletedAt):'')+resultFields(h.source,h.memo)+(h.memo?(h.source.origin==='flow'?'<details class="result-memo"><summary>Flow 원문 보기</summary><p class="entry-body">'+esc(h.memo)+'</p></details>':'<div class="result-memo"><strong>고객센터 보완</strong><p class="entry-body">'+esc(h.memo)+'</p></div>'):'')+'</article>';}).join(''):'<div class="result-empty"><strong>등록된 처리 결과가 없습니다.</strong></div>',
      '</div>'+((d.historyCursor||d.auditCursor)?'<button data-action="more-history">이력 더 보기</button>':'')+'</div></section>',
      '<section class="detail-section comments-section"><h3>댓글 <span class="muted">'+(d.preview?'확인 중':comments.length)+'</span></h3><div class="timeline">',
      d.preview?'<p class="hint">댓글을 불러오는 중…</p>':comments.map(function(h){return '<article class="entry"><div class="entry-meta"><strong>'+esc(h.author)+'</strong><span>'+esc(time(h.createdAt))+'</span>'+(h.revision>1?'<span>수정됨 '+esc(time(h.updatedAt))+'</span>':'')+'</div><div class="entry-body">'+(h.attachment&&h.attachment.kind==='inspection_pdf'?(window.BazWorkComments&&window.BazWorkComments.renderPdf?window.BazWorkComments.renderPdf(h.attachment)+'<p class="pdf-review" data-pdf-review="'+esc(h.id)+'">원본 비교 중…</p>':esc('AS/점검 내역서')):(window.BazWorkComments?window.BazWorkComments.render(h.body):commentMarkup(h.body)))+'</div>'+((!h.attachment&&(h.author===account||BazAuth.cachedLevel()>=3))?'<div class="comment-controls"><button data-comment="'+esc(h.id)+'">댓글 수정</button><button data-comment-delete="'+esc(h.id)+'">댓글 삭제</button></div><div class="comment-delete-confirm" hidden><span>이 댓글을 삭제할까요? 삭제 후 복원할 수 있습니다.</span><button class="danger" data-comment-confirm="'+esc(h.id)+'">삭제 확인</button><button data-comment-cancel>취소</button></div>':'')+'</article>';}).join(''),
      (d.history||[]).some(function(h){return h.kind==='comment'&&h.deletedAt;})?'<details class="deleted-comments"><summary>삭제된 댓글</summary>'+(d.history||[]).filter(function(h){return h.kind==='comment'&&h.deletedAt;}).map(function(h){return '<div class="entry"><small>'+esc(h.author)+' · 삭제 '+esc(time(h.deletedAt))+'</small>'+((h.author===account||BazAuth.cachedLevel()>=3)?'<button data-comment-restore="'+esc(h.id)+'">댓글 복원</button>':'')+'</div>';}).join('')+'</details>':'',
      '</div><form id="comment-form" class="comment-form"><label class="sr-only" for="comment-body">댓글 내용</label><textarea id="comment-body" rows="3" maxlength="4000" placeholder="댓글·URL을 입력하거나 클라우디움 공유 표를 붙여 넣으세요." required></textarea><p class="hint comment-url-hint">클라우디움 공유 표를 붙여 넣거나 URL.html 파일을 불러오면 수정 URL만 댓글에 입력됩니다.</p><div id="comment-preview" class="comment-preview" role="region" aria-label="댓글 미리보기" hidden></div><p id="comment-share-error" class="notice" role="alert" hidden></p><input id="comment-file-input" type="file" accept=".html,.htm,text/html" aria-label="클라우디움 공유 링크 파일" hidden><div class="comment-actions"><button id="comment-file-button" type="button">공유 링크 파일</button><span id="comment-edit-label" class="hint"></span><button class="primary" type="submit">댓글 저장</button></div></form></section>',
      '<details id="detail-tools" class="detail-section detail-tools" data-request-id="'+esc(r.id)+'"><summary>상세 관리 및 이력</summary><div class="detail-tools-body">',
      r.status==='완료'?'<p class="hint">완료 '+esc(time(r.completedAt))+' · '+esc(r.completedBy||'미기록')+'</p>':'',
      '<p id="detail-checked" class="hint">최신 상세 확인 '+esc(time(d.updatedAt))+'</p><p class="hint">Handover 연동 확인 '+esc(time(sourceCheckedAt))+'</p><div class="detail-buttons"><button data-action="edit">기본 정보 수정</button><button data-action="refresh-detail">최신 내용 확인</button></div>',
      (r.deletedAt?'<p class="notice">휴지통 · '+esc(r.deletedBy)+' · '+esc(time(r.deletedAt))+'</p>'+((r.createdBy===account||BazAuth.cachedLevel()>=3)?'<button data-action="restore">접수 복원</button>':''):(r.createdBy===account||BazAuth.cachedLevel()>=3)?'<button class="danger" data-action="delete">접수 삭제</button>':''),
      '<details class="request-extra"><summary>기본 정보 더 보기</summary><dl class="result-fields"><dt>CS 담당</dt><dd>'+esc(r.cs)+'</dd><dt>영업 담당</dt><dd>'+esc(r.sales||'미기록')+'</dd><dt>등록일시</dt><dd>'+esc(time(r.registeredAt))+'</dd></dl></details>',
      '<div class="result-link-tools"><h4>Handover 연결 관리</h4><p class="hint">같은 병원·방문일의 서로 다른 장비 S/N은 처리 내역에 각각 연결됩니다. 같은 S/N 중복 또는 S/N 미기록은 원본을 직접 선택하세요.</p>',
      results.map(function(h){return '<div class="result-link"><strong>'+esc(h.source.date||'처리일 미기록')+' · '+esc(h.source.engineer||'처리자 미기록')+'</strong>'+(h.source.origin==='flow'?'<span class="result-origin">Flow 이전 기록</span>':h.auto?'<span class="result-origin">자동 연결</span>':'')+'<div class="entry-meta">연결: '+esc(h.author)+' · '+esc(time(h.createdAt))+(h.revision>1?' · 수정 '+esc(time(h.updatedAt)):'')+'</div>'+(h.source.origin==='flow'?'<p class="hint">엑셀 원문을 보존한 기록입니다. 이후 처리 내용은 댓글 또는 Handover 결과로 추가하세요.</p>':'<button data-result="'+esc(h.id)+'">원본 비교·갱신</button>')+'</div>';}).join(''),
      '<div class="result-actions"><button data-action="import">Handover 결과 불러오기</button>'+(r.status!=='완료'?'<button class="primary" data-action="complete">완료 처리</button>':'')+'<a href="handover.html">Handover 열기 ↗</a></div></div>',
      '<details class="detail-records"><summary>이 병원의 다른 접수 · '+d.requests.length+'건</summary>'+d.requests.map(function(x){return '<button class="history-request" data-open="'+esc(x.id)+'">'+esc(time(x.registeredAt))+' · '+esc(x.status)+'<br>'+esc(x.symptom.slice(0,100))+'</button>';}).join('')+'</details>',
      '<details class="detail-records"><summary>변경 이력 · 이전 내용 확인</summary>'+d.logs.slice().reverse().map(function(log){return '<div class="audit-item">'+esc(auditText(log))+'<br><small>'+esc(log.actor)+' · '+esc(time(log.at))+'</small></div>';}).join('')+'</details></div></details>'
    ].join('');
  }
  function auditText(log){
    if(log.kind==='handover_review')return 'Handover 본문 검수 저장 · '+log.actor;
    if(log.kind==='result_source_review')return 'Handover 변경 내용 확인 · '+log.actor;
    if(log.kind==='pdf_attachment')return 'AS/점검 내역서 자동 첨부';
    if(log.kind==='result_auto')return 'Handover 결과 자동 연결 · 고객센터 결과 확인 대기';if(log.kind==='status_change')return '상태 수동 변경 · '+(log.before&&log.before.status||'미기록')+' → '+(log.after&&log.after.status||'미기록');if(log.kind==='delete')return '접수 휴지통 이동';if(log.kind==='restore')return '접수 복원';
    if(log.kind==='request_create')return '고객센터 접수';
    if(log.kind==='comment_add')return '댓글 등록';
    if(log.kind==='comment_delete')return '댓글 삭제 · 이전 내용: '+(log.before?log.before.body:'');
    if(log.kind==='comment_restore')return '댓글 복원';
    if(log.kind==='comment_update')return '댓글 수정 · 이전 내용: '+(log.before?log.before.body:'');
    if(log.kind==='result_source_update')return 'Handover 원본 자동 갱신 · 이전 처리 내용: '+(log.before&&log.before.source.detail||'');
    if(log.kind==='result_save')return log.before?'Handover 결과 갱신 · 이전 처리 내용: '+(log.before.source.detail||''):'Handover 결과 등록';
    var before=log.requestBefore||log.before||{},after=log.after||{},labels={status:'상태',engineer:'엔지니어',visitAt:'방문',deadline:'마감',cs:'CS 담당',sales:'영업 담당',symptom:'증상'};
    var diff=Object.keys(labels).filter(function(k){return before[k]!==after[k];}).map(function(k){return labels[k]+': '+(before[k]||'미정')+' → '+(after[k]||'미정');});
    return diff.join(' / ')||'기본 정보 수정';
  }
  function renderDetail(){
    var d=state.detail,r=displayRequest(d.request);
    $('detail').dataset.inlineForm=r.id;
    var previousInput=$('comment-body'),restoreFocus=previousInput&&previousInput.dataset.requestId===r.id&&document.activeElement===previousInput;
    var selection=restoreFocus?[previousInput.selectionStart,previousInput.selectionEnd]:null;
    var previousTools=$('detail-tools'),keepToolsOpen=previousTools&&!$('detail').hidden&&previousTools.dataset.requestId===r.id&&previousTools.open;
    var entries=d.history.slice().sort(function(a,b){return b.createdAt.localeCompare(a.createdAt);});
    var results=entries.filter(function(h){return h.kind==='result';});
    results=results.filter(function(h){return h.source.origin!=='flow'||!h.source.sn||!results.some(function(other){return other.source.origin!=='flow'&&other.source.sn===h.source.sn&&other.source.date===h.source.date;});});
    renderHost='detail';$('detail').innerHTML=detailMarkup(d,r,results,entries.filter(function(h){return h.kind!=='result'&&!h.deletedAt&&!(h.kind==='comment'&&h.flowImport);}));
    $('detail').hidden=false;if(!$('detail').open)$('detail').showModal();commentEdit=null;
    refreshPdfReviews(d);
    $('detail-tools').open=!!keepToolsOpen;
    var commentDraft=read(scope+'_comment_'+r.id)||{};
    $('comment-body').value=commentDraft.body||'';
    if(commentDraft.historyId){
      var savedComment=d.history.find(function(h){return h.id===commentDraft.historyId&&h.kind==='comment'&&!h.deletedAt;});
      if(savedComment){commentEdit=Object.assign({},savedComment,{revision:commentDraft.baseRevision});$('comment-edit-label').textContent='댓글 수정 초안 복원됨';}
      else if(d.preview){commentEdit={id:commentDraft.historyId,revision:commentDraft.baseRevision};$('comment-edit-label').textContent='댓글 수정 초안 · 원본 확인 중';}
    }
    var cancelComment=document.createElement('button');cancelComment.type='button';cancelComment.id='cancel-comment';cancelComment.textContent='수정 취소';cancelComment.hidden=!commentEdit;
    $('comment-edit-label').after(cancelComment);
    cancelComment.onclick=function(){commentEdit=null;$('comment-edit-label').textContent='';$('comment-body').value='';this.hidden=true;store(scope+'_comment_'+r.id,null);refreshCommentPreview();};
    $('comment-body').addEventListener('input',function(){store(scope+'_comment_'+r.id,{body:this.value,historyId:commentEdit?commentEdit.id:'',baseRevision:commentEdit?commentEdit.revision:0});});
    refreshCommentPreview=window.BazWorkComments?window.BazWorkComments.mount({input:$('comment-body'),preview:$('comment-preview'),fileInput:$('comment-file-input'),fileButton:$('comment-file-button'),error:$('comment-share-error')}):function(){};
    $('comment-form').addEventListener('submit',saveComment);
    var status=document.createElement('p');status.id='detail-status';status.className=detailError?'notice':'hint';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    status.textContent=detailLoading?(d.preview?'접수 정보 표시 · 댓글과 처리 결과를 불러오는 중…':'이전 상세 표시 · 최신 내용을 확인하는 중…'):'';
    if(detailError)status.textContent='최신 상세 확인 실패: '+detailError+' · 하단의 상세 관리 및 이력을 펼쳐 최신 내용 확인 버튼으로 다시 시도하세요.';
    status.hidden=!detailLoading&&!detailError;
    var checked=$('detail-checked');checked.hidden=!!d.preview;if(!d.preview&&(detailLoading||detailError))checked.textContent='이전 상세 확인 '+time(d.updatedAt);$('detail').querySelector('.detail-summary').append(status);
    if(!d.preview&&d.autoMatch){
      var skipped=d.autoMatch.skipped.find(function(x){return x.requestId===r.id;});
      if(skipped){var warning=document.createElement('p');warning.id='auto-match-status';warning.className='notice';warning.setAttribute('role','status');warning.textContent=skipped.message;$('detail').querySelector('.results-section .detail-content').prepend(warning);}
    }
    if(entries.some(function(h){return h.kind==='result'&&h.auto;})){
      var autoLabel=document.createElement('p');autoLabel.className='hint';autoLabel.textContent='Handover 결과 자동 연결 · 병원명·방문일 일치';checked.after(autoLabel);
    }
    $('detail').setAttribute('aria-busy',String(detailLoading));
    $('detail').querySelectorAll('[data-action="edit"],[data-action="import"],[data-action="complete"],[data-comment],[data-comment-delete],[data-comment-confirm],[data-comment-restore],[data-result],#comment-form button[type="submit"],#comment-file-button,#comment-file-input').forEach(function(b){b.disabled=detailLoading||!!detailError||!!r.deletedAt;});
    updateStatusControl();
    var refresh=$('detail').querySelector('[data-action="refresh-detail"]');refresh.disabled=detailLoading;refresh.textContent=detailLoading?'최신 내용 확인 중…':'최신 내용 확인';
    $('comment-body').dataset.requestId=r.id;
    var nextAction=$('detail').querySelector('section.work-flow-panel');if(nextAction)$('detail').append(nextAction);
    if(restoreFocus){$('comment-body').focus({preventScroll:true});$('comment-body').setSelectionRange(selection[0],selection[1]);}
    renderList();
    if(!d.preview&&!r.deletedAt&&window.BazReadReceipts)window.BazReadReceipts.mount(r.id);
  }
  async function openDetail(id,force){
    if(busy)return;
    if(detailLoading&&state.detail&&state.detail.request.id===id)return detailTask;
    var seq=++detailSeq,known=state.requests.find(function(r){return r.id===id;}),cached=detailCache.get(id)||await cache.detail(account,id).catch(function(){return null;});
    if(known&&known.purgedAt){await forgetPurged(id);notify('영구 삭제된 접수입니다.');return;}
    notify('');detailLoading=true;detailError='';
    // 목록의 접수 정보는 즉시 표시한다. 댓글/결과의 미조회 상태를 0건으로 표시하지 않는다.
    if(known||cached){
      state.detail=Object.assign({},cached||{history:[],logs:[],requests:state.requests.filter(function(r){return r.hospitalId===known.hospitalId;}),updatedAt:'',preview:true},{request:known||cached.request});
      renderDetail();if(matchMedia('(max-width:700px)').matches)$('detail').scrollIntoView({block:'start'});
    }
    detailTask=(async function(){
      try{
        var d=(!force&&cached&&!cached.preview&&known&&cached.request.revision===known.revision)?cached:await api.get('work_detail',{id:id});if(seq!==detailSeq)return;if(!d.success){if(d.purged&&d.current){upsert(d.current);await forgetPurged(id);await persistSnapshot();renderList();notify(d.error);return;}throw new Error(d.error);}
        var latest=state.requests.find(function(r){return r.id===id;});
        if(latest&&latest.revision>d.request.revision)throw new Error('이 PC에서 확인한 정보보다 이전 응답입니다. 다시 확인하세요.');
        detailLoading=false;state.detail=d;upsert(d.request);
        // 조회한 상세는 이 PC에 보관한다. 다른 PC의 변경은 수동 동기화로 확인한다.
        detailCache.delete(id);detailCache.set(id,d);cache.saveDetail(account,id,d).catch(function(){});if(detailCache.size>20)detailCache.delete(detailCache.keys().next().value);
        renderDetail();
      }catch(e){
        if(seq!==detailSeq)return;
        detailLoading=false;detailError=e.message;
        if(state.detail&&state.detail.request.id===id)renderDetail();else notify('상세 확인 실패: '+e.message);
      }finally{if(seq===detailSeq)detailTask=null;}
    })();
    return detailTask;
  }
  function closeDetail(render){claimReady=null;var id=state.detail?.request.id;detailSeq++;detailLoading=false;detailError='';detailTask=null;state.detail=null;$('detail').hidden=true;if($('detail').open)$('detail').close();$('detail').setAttribute('aria-busy','false');if(render!==false){renderList();var trigger=Array.from($('list').querySelectorAll('[data-open]')).find(function(b){return b.dataset.open===id;});if(trigger)trigger.focus({preventScroll:true});else $('search').focus({preventScroll:true});}}
  $('detail').addEventListener('cancel',function(event){event.preventDefault();closeDetail();});
  function notificationBusy(ignoreOpening){return claimLoading||busy||syncing||bulkWorking||pending||rosterLoading||notificationOpening&&!ignoreOpening||Array.from(document.querySelectorAll('dialog[open]')).some(function(d){return d.id!=='detail';})||!!($('comment-body')&&$('comment-body').value.trim());}
  function queueNotification(target){
    if(!window.BazNotificationRoute||!window.BazNotificationRoute.valid(target.requestId))return;
    notificationTarget={requestId:target.requestId,notificationId:window.BazNotificationRoute.valid(target.notificationId)?target.notificationId:''};
    $('notification-launch').hidden=false;$('notification-launch-message').textContent='알림의 접수를 최신 내용으로 확인할 수 있습니다.';
    if(!state.loaded||notificationBusy()){$('notification-launch-message').textContent='작성·저장 중인 내용을 유지했습니다. 작업을 마친 뒤 알림 접수를 열어 주세요.';return;}
    return openNotification();
  }
  async function openNotification(){
    if(!notificationTarget||!state.loaded)return;
    if(notificationBusy()){$('notification-launch-message').textContent='작성창을 닫고 저장 결과를 확인한 뒤 다시 눌러 주세요. 입력한 초안은 유지됩니다.';return;}
    const target={...notificationTarget};notificationOpening=true;
    $('notification-launch').hidden=false;$('notification-launch-open').disabled=true;$('notification-launch-message').textContent='해당 접수와 Handover의 최신 내용을 확인하고 있습니다…';
    try{
      const refreshed=await api.get('work_detail',{id:target.requestId});
      if(refreshed.deleted&&refreshed.current?.deletedAt){
        upsert(refreshed.current);await persistSnapshot();renderList();
        if(state.detail?.request.id===target.requestId)closeDetail(false);
        if(target.notificationId&&window.BazNotifications){await window.BazNotifications.call('notification_read',{notificationId:target.notificationId,revision:refreshed.current.revision});window.BazNotifications.refresh();}
        $('notification-launch-message').textContent=refreshed.current.hospitalName+' · 현재 휴지통에 있는 접수입니다.';
        notificationTarget=null;$('notification-launch-open').hidden=true;return;
      }
      if(!refreshed.success)throw new Error(refreshed.error||'Handover 최신 확인 실패');
      await sync();if($('sync-state').dataset.state!=='done')throw new Error('목록 동기화를 다시 시도하세요.');
      if(notificationBusy(true))throw new Error('확인 중 새로 시작한 작업을 유지했습니다. 작업을 마친 뒤 다시 눌러 주세요.');
      await openDetail(target.requestId,true);
      if(detailError||!state.detail||state.detail.request.id!==target.requestId||state.detail.preview)throw new Error(detailError||'최신 접수 상세를 확인하지 못했습니다.');
      let readConfirmed=true;
      $('notification-launch-message').textContent=state.detail.request.hospitalName+' · 최신 접수·Handover 확인 완료 · '+time(refreshed.updatedAt);
      if(target.notificationId&&window.BazNotifications){
        try{await window.BazNotifications.call('notification_read',{notificationId:target.notificationId,revision:state.detail.request.revision,sourceCheckedAt:refreshed.sourceCheckedAt});window.BazNotifications.refresh();}
        catch(e){readConfirmed=false;$('notification-launch-message').textContent+=' · 알림 확인 기록: '+e.message;}
      }
      if(readConfirmed&&notificationTarget?.requestId===target.requestId&&notificationTarget?.notificationId===target.notificationId){notificationTarget=null;$('notification-launch-open').hidden=true;}
      if(matchMedia('(max-width:700px)').matches)$('detail').scrollIntoView({block:'start'});
    }catch(e){$('notification-launch-message').textContent='최신 내용 확인 실패 · '+e.message+' 마지막으로 확인한 내용과 구분해 다시 시도하세요.';}
    finally{notificationOpening=false;$('notification-launch-open').disabled=false;}
  }
  async function selectHospital(fillSales){
    var value=$('hospital-input').value.trim(),matches=state.hospitals.filter(function(h){return h.origin!=='flow'&&(label(h)===value||h.name===value);});
    var seq=++hospitalSeq;state.selected=matches.length===1?matches[0]:null;
    $('existing-requests').hidden=true;$('ack').checked=false;$('duplicate-ack').hidden=true;err('form-error','');
    if(!state.selected){$('hospital-match').textContent='목록에서 병원을 선택하세요. 같은 이름의 지점은 S/N과 지역을 확인하세요.';if(fillSales)$('sales').value='';$('past-history').textContent='병원을 선택하세요.';return;}
    var h=state.selected;if(fillSales)$('sales').value=h.sales||'';
    $('hospital-match').textContent=[h.region,h.sn?'S/N '+h.sn:'S/N 미기록',h.ncare?'N-CARE '+h.ncare:'',h.sales?'영업 '+h.sales:''].filter(Boolean).join(' · ');
    var current=state.requests.filter(function(r){return r.hospitalKey===h.key&&active(r)&&(!state.editing||r.id!==state.editing.id);});
    if(current.length){$('existing-requests').innerHTML='<strong>이 병원의 미완료 요청 '+current.length+'건</strong><br>'+current.map(function(r){var text=esc(r.status)+' · '+esc(r.symptom.slice(0,70));return embedded?'<div>'+text+'</div>':'<button type="button" data-existing="'+esc(r.id)+'">'+text+'</button>';}).join('')+(embedded?'<a href="hospital-work.html" target="_blank" rel="noopener">CS 서비스 현황에서 확인</a>':'');$('existing-requests').hidden=false;}
    $('past-history').textContent='기존 처리 이력을 확인하는 중…';
    try{var data=await api.get('work_handover_candidates',{hospitalName:h.name});if(seq!==hospitalSeq)return;if(!data.success)throw new Error(data.error);$('past-history').innerHTML=data.data.length?data.data.slice(0,8).map(function(s){return '<div class="past-item"><strong>'+esc(s.gubun)+' · '+esc(s.date)+' · '+esc(s.engineer)+'</strong><br>'+esc([s.cat,s.type,s.detail].filter(Boolean).join(' / '))+'</div>';}).join('')+(data.total>8?'<p class="hint">최근 8건 표시 · 전체 '+data.total+'건</p>':''):'기존 처리 이력이 없습니다.';}
    catch(e){if(seq===hospitalSeq)$('past-history').textContent='이력 조회 실패: '+e.message;}
  }
  function setForm(form){['symptom','cs','sales','status','registeredAt','visitAt','deadline'].forEach(function(k){$(k).value=form[k]||'';});['registered','visit'].forEach(function(prefix){var parts=String(form[prefix==='registered'?'registeredAt':'visitAt']||'').split('T');$(prefix+'Date').value=parts[0]||'';$(prefix+'Time').value=parts[1]||'';});var h=fields.hospital(form,state.hospitals);$('hospital-input').value=h?label(h):'';if(form.engineer&&!Array.from($('engineer').options).some(function(x){return x.value===form.engineer;}))$('engineer').add(new Option(form.engineer,form.engineer));$('engineer').value=form.engineer||'';selectHospital(false);}
  function openEditor(request,prefill){
    if(!state.loaded||busy)return;state.editing=request||null;state.baseline=request?Object.assign({},request):null;
    $('request-form').reset();err('form-error','');$('duplicate-ack').hidden=true;state.selected=null;
    var draft=read(draftKey),useDraft=draft&&draft.id===(request?request.id:null);
    var form=request||{cs:account,status:'접수',registeredAt:localNow(),hospitalKey:prefill?.key||'',sales:prefill?.sales||''};
    if(useDraft){form=draft.form;state.baseline=draft.baseline;if(request)state.editing=Object.assign({},request,{revision:draft.baseRevision});}
    fillPeople();setForm(form);if(useDraft)$('hospital-input').value=draft.hospitalInput||$('hospital-input').value;
    $('editor-title').textContent=request?'A/S 접수 정보 수정':'A/S 접수';$('draft-status').textContent=useDraft?'이 PC의 미저장 초안 복원됨':'';
    if(!$('editor').open)$('editor').showModal();
    checkAssignment();
  }
  function conflictForm(response){
    var latest=response.current,input=formValues(),base=state.baseline||{},keys=Object.keys(input);
    var diff=keys.filter(function(k){return String(latest[k]||'')!==String(input[k]||'');});
    $('form-error').innerHTML='<strong>다른 사용자의 변경이 있습니다</strong><p>아래 서버 값과 입력 값을 확인하세요. 계속 편집을 누르면 본인이 변경한 항목만 최신 값 위에 유지합니다.</p><dl class="result-fields">'+diff.map(function(k){return '<dt>'+esc(k)+'</dt><dd>서버: '+esc(latest[k]||'미정')+'<br>입력: '+esc(input[k]||'미정')+'</dd>';}).join('')+'</dl><button type="button" id="merge-conflict">비교 후 계속 편집</button><button type="button" id="load-conflict">서버 내용으로 새로 시작</button>';
    $('form-error').hidden=false;
    $('merge-conflict').onclick=function(){var merged=Object.assign({},latest);keys.forEach(function(k){if(String(input[k]||'')!==String(base[k]||''))merged[k]=input[k];});state.editing=latest;state.baseline=Object.assign({},latest);setForm(merged);saveDraft();};
    $('load-conflict').onclick=function(){state.editing=latest;state.baseline=Object.assign({},latest);setForm(latest);saveDraft();};
  }
  async function write(action,payload,context){
    if(busy||pending||(bulkWorking&&context!=='bulk-'+lifecyclePlan.action)){notify('먼저 진행 중인 저장 결과를 확인하세요.');return null;}
    pending={action:action,payload:Object.assign({},payload,{operationId:api.id()}),context:context};
    if(!store(pendingKey,pending))notify('브라우저 저장을 사용할 수 없습니다. 결과 확인 전 이 창을 닫지 마세요.');
    await cache.savePending(account,pending).catch(function(){});return sendPending();
  }
  async function sendPending(){
    if(!pending||busy)return null;busy=true;updatePending();$('save-status').textContent='서버 저장 중…';
    var disabledBefore=Array.from(document.querySelectorAll('dialog input,dialog select,dialog textarea,#comment-body,[data-comment],[data-comment-delete],[data-comment-confirm],[data-comment-restore],#comment-file-button,#comment-file-input,button[type=submit],#save-complete')).map(function(b){var previous=b.disabled;b.disabled=true;return {element:b,disabled:previous};});
    var operation=pending;
    try{
      var data=await api.post(operation.action,operation.payload);
      if(!data.success&&data.retrySameOperation){notify(data.error+' 같은 기록으로 재시도하세요.');$('save-status').textContent='저장 결과 확인 필요';return null;}
      pending=null;store(pendingKey,null);await cache.savePending(account,null).catch(function(){});updatePending();
      if(!data.success){$('save-status').textContent='저장되지 않음';return data;}
      if(data.schedule){rosterSaved(data);$('save-status').textContent='서버 저장 완료 '+time(data.schedule.updatedAt);await persistSnapshot();return data;}
      if(operation.context==='inline-request'){activeField=null;delete inlineDrafts[data.request.id];store(inlineDraftKey,inlineDrafts);}
      upsert(data.request);renderList();$('save-status').textContent='서버 저장 완료 '+time(data.request.updatedAt);
      if(data.request.purgedAt){await forgetPurged(data.request.id);await persistSnapshot();notify('접수를 영구 삭제했습니다.');return data;}
      if(operation.context==='request'){store(draftKey,null);if(!embedded)$('editor').close();}
      if(operation.context==='comment'||(operation.context==='comment-lifecycle'&&read(scope+'_comment_'+data.request.id)?.historyId===operation.payload.historyId)){store(scope+'_comment_'+data.request.id,null);commentEdit=null;}
      if(operation.context==='result'){store(scope+'_result_'+data.request.id,null);$('result-dialog').close();}
      // KV response is sufficient; no second detail request on the save path.
      var detail=detailCache.get(data.request.id)||(state.detail&&state.detail.request.id===data.request.id?state.detail:null)||await cache.detail(account,data.request.id).catch(function(){return null;});
      // A row mutation must not turn an unqueried or stale history into an empty, current detail.
      var complete=detail&&!detail.preview&&(operation.payload.baseRevision==null||detail.request.revision===operation.payload.baseRevision);
      if(operation.context==='request'&&!operation.payload.id)complete=true;
      if(data.workDetail&&data.workDetail.success){detail=data.workDetail;complete=true;}
      detail=Object.assign({},detail||{history:[],logs:[],requests:[]},{success:true,request:data.request,updatedAt:data.request.updatedAt,preview:!complete,requests:state.requests.filter(function(r){return !r.deletedAt&&r.hospitalId===data.request.hospitalId;})});
      if(data.history){detail.history=detail.history.filter(function(h){return h.id!==data.history.id;}).concat([data.history]);}
      if(data.event&&!detail.logs.some(function(e){return e.id===data.event.id;}))detail.logs=detail.logs.concat([data.event]);
      detailCache.set(data.request.id,detail);await cache.saveDetail(account,data.request.id,detail).catch(function(){});await persistSnapshot();
      busy=false;
      if(data.request.deletedAt){if(state.detail&&state.detail.request.id===data.request.id)closeDetail(false);notify('선택한 접수를 휴지통으로 이동했습니다.');renderList();}
      else if((operation.context==='inline-request'?(state.detail&&state.detail.request.id===data.request.id):operation.context.indexOf('bulk-')!==0||(state.detail&&state.detail.request.id===data.request.id))){state.detail=detail;detailLoading=false;detailError='';renderDetail();}
      if(operation.context==='request'&&embedded)receiptMessage('baz-work-receipt-saved');
      return data;
    }catch(e){notify('저장 결과를 확인하지 못했습니다. 입력과 저장 식별자를 보존했습니다. '+e.message);$('save-status').textContent='저장 결과 확인 필요';return null;}
    finally{busy=false;disabledBefore.forEach(function(x){x.element.disabled=x.disabled;});updatePending();}
  }
  async function saveRequest(event){
    event.preventDefault();err('form-error','');if(!state.selected){err('form-error','병원 목록에서 정확한 병원을 선택하세요.');return;}
    if(!$('registeredDate').value||!normalizeTime($('registeredTime').value)){err('form-error','등록 날짜와 시간을 입력하세요. 시간은 10:00 또는 1000 형태로 입력할 수 있습니다.');$('registeredTime').focus();return;}
    if(($('visitDate').value||$('visitTime').value)&&(!$('visitDate').value||!normalizeTime($('visitTime').value))){err('form-error','방문·처리 날짜와 시간을 함께 입력하세요. 시간은 10:00 또는 1000 형태로 입력할 수 있습니다.');$('visitTime').focus();return;}
    var payload={id:state.editing?state.editing.id:'',baseRevision:state.editing?state.editing.revision:0,form:formValues(),acknowledgeDuplicates:$('ack').checked};
    saveDraft();var data=await write('work_save',payload,'request');if(!data||data.success)return;
    if(data.conflict){conflictForm(data);return;}
    if(data.duplicate){$('duplicate-ack').hidden=false;err('form-error',data.error+'\n'+(data.candidates||[]).concat(data.overlaps||[]).map(function(r){return r.hospitalName+' · '+r.status+' · '+time(r.visitAt)+' · '+(r.engineer||'미배정');}).join('\n'));return;}
    err('form-error',data.error);
  }
  function updateStatusControl(){
    document.querySelectorAll('[data-status-request]').forEach(function(select){
      var r=state.requests.find(function(r){return r.id===select.dataset.statusRequest;}),same=state.detail&&state.detail.request.id===select.dataset.statusRequest;
      select.disabled=busy||syncing||bulkWorking||!!pending||!r||!!r.deletedAt||!!r.purgedAt||!!(same&&(detailLoading||detailError||state.detail.preview));
    });
  }
  async function saveStatus(r,next){
    var same=state.detail&&r&&state.detail.request.id===r.id;
    if(busy||syncing||bulkWorking||pending||!r||r.deletedAt||r.purgedAt||same&&(detailLoading||detailError||state.detail.preview)||next===r.status)return;
    var data=await write('work_status',{requestId:r.id,baseRevision:r.revision,status:next},same?'status':'bulk-status');
    if(data&&!data.success){document.querySelectorAll('[data-status-request]').forEach(function(select){if(select.dataset.statusRequest===r.id)select.value=r.status;});notify(data.error+(data.conflict?'\n동기화 또는 최신 내용 확인 후 상태를 다시 선택하세요.':''));}
    updateStatusControl();
  }
  function statusChanged(event){var select=event.target.closest('[data-status-request]');if(select)saveStatus(state.requests.find(function(r){return r.id===select.dataset.statusRequest;}),select.value);}
  async function saveComment(event){
    event.preventDefault();if(detailLoading||detailError)return;var r=state.detail.request,body=$('comment-body').value;if(r.deletedAt){notify('삭제된 접수에는 댓글을 남길 수 없습니다.');return;}
    var data=await write(commentEdit?'work_history_update':'work_history_add',{requestId:r.id,body:body,historyId:commentEdit?commentEdit.id:'',baseHistoryRevision:commentEdit?commentEdit.revision:0},'comment');
    if(data&&!data.success)notify(data.error+(data.conflict?'\n최신 댓글을 확인한 뒤 다시 편집하세요. 입력한 내용은 초안에 남아 있습니다.':''));
  }
  var indexPreparing=false;
  async function prepareQueryIndex(){
    if(indexPreparing||!kvReady)return;indexPreparing=true;
    try{for(var batch=0;batch<32;batch++){
      if(busy||bulkWorking||document.visibilityState==='hidden')return;
      var result=await api.get('work_index_prepare',{});if(!result.success)return;
      document.body.dataset.queryIndexReady=String(!!result.ready);if(result.ready)return;
      await new Promise(function(resolve){setTimeout(resolve,250);});
    }}catch(e){}finally{indexPreparing=false;}
  }
  async function openDocumentFlow(){
    if(busy||pending||syncing||bulkWorking||notificationOpening){notify('진행 중인 저장·동기화를 먼저 확인하세요.');return;}
    if(!state.detail||state.detail.request.deletedAt)return;
    var id=state.detail.request.id;notificationOpening=true;
    try{
      notify('이 접수의 최신 현장 기록을 확인하고 있습니다…');
      var data=await api.get('work_document_status',{requestId:id});if(!data.success)throw new Error(data.error);
      if(state.detail?.request.id!==id)return;
      if(!data.records.length){location.href=window.BazWorkFlow.url('handover.html',id);return;}
      if(data.records.length===1){location.href=window.BazWorkFlow.url('inspection.html',id,data.records[0].recordId);return;}
      var dialog=document.createElement('dialog');dialog.className='work-flow-panel';
      var heading=document.createElement('h3');heading.textContent='내역서를 작성할 현장 기록 선택';dialog.appendChild(heading);
      var hint=document.createElement('p');hint.textContent='같은 병원의 여러 장비·방문 기록입니다. 처리일과 S/N을 확인하세요.';dialog.appendChild(hint);
      var list=document.createElement('div');list.className='work-flow-records';data.records.forEach(function(record){var b=document.createElement('button');b.type='button';b.textContent=(record.date||'처리일 미기록')+' · '+(record.sn||'S/N 미기록')+(record.hasPdf?' · 내역서 있음':'');b.onclick=function(){location.href=window.BazWorkFlow.url('inspection.html',id,record.recordId);};list.appendChild(b);});dialog.appendChild(list);
      var close=document.createElement('button');close.type='button';close.textContent='닫기';close.onclick=function(){dialog.close();};dialog.appendChild(close);dialog.addEventListener('close',function(){dialog.remove();});document.body.appendChild(dialog);dialog.showModal();notify('');
    }catch(e){notify('다음 작업을 열지 못했습니다. '+e.message);}
    finally{notificationOpening=false;}
  }
  async function refreshPdfReviews(d){
    if(!window.BazSourceReview||d.preview)return;
    var root=$('detail');
    await Promise.all((d.history||[]).filter(function(h){return h.attachment?.kind==='inspection_pdf'&&!h.deletedAt;}).map(async function(h){
      var node=Array.from(root.querySelectorAll('[data-pdf-review]')).find(function(n){return n.dataset.pdfReview===h.id;});if(!node)return;
      try{var source=d.history.find(function(x){return x.kind==='result'&&x.source?.recordId===h.sourceRecordId;});var result=await window.BazSourceReview.comparePdf(h.attachment,source&&source.source);if(!node.isConnected||state.detail!==d)return;node.textContent=result.text;node.dataset.state=result.state;}
      catch(e){if(node.isConnected)node.textContent='PDF 원본 비교 실패 · 다시 확인하세요.';}
    }));
  }
  async function confirmSourceReview(id){
    if(busy||pending||syncing||notificationOpening||!state.detail)return;
    var previous=state.detail,entry=previous.history.find(function(h){return h.id===id;});if(!entry?.sourceReview?.pending)return;
    var targetId=previous.request.id,sourceVersion=entry.source.version;notificationOpening=true;
    try{
      notify('변경 확인 전 최신 Handover를 확인하고 있습니다…');
      var fresh=await api.get('work_handover_refresh',{requestId:targetId});if(!fresh.success||!fresh.workDetail?.success)throw new Error(fresh.error||'원본 확인 실패');
      if(state.detail?.request.id!==targetId)return;
      state.detail=fresh.workDetail;detailCache.set(targetId,state.detail);await cache.saveDetail(account,targetId,state.detail);upsert(state.detail.request);renderList();renderDetail();
      var current=state.detail.history.find(function(h){return h.id===id;});
      if(!current)throw new Error('해당 처리 이력을 더 불러온 뒤 다시 확인하세요.');
      if(!current.sourceReview?.pending){notify('이미 확인된 원본 변경입니다.');return;}
      if(current.source.version!==sourceVersion){notify('확인 중 원본이 다시 변경되었습니다. 변경 항목을 다시 비교하세요.');return;}
      var saved=await write('work_source_review',{requestId:targetId,historyId:id,baseRevision:state.detail.request.revision,baseHistoryRevision:current.revision,sourceVersion:sourceVersion},'source-review');
      if(saved)notify(saved.success?'원본 변경을 확인했습니다. 업무 상태는 유지됩니다.':saved.error);
    }catch(e){notify('원본 변경을 확인 처리하지 못했습니다. '+e.message);}
    finally{notificationOpening=false;}
  }
  async function openResults(existing){
    if(busy)return;var requestId=state.detail.request.id,dialogSeq=++resultDialogSeq;state.source=null;state.resultExisting=existing||null;sourceSeq++;
    $('source-list').textContent='Handover 기록을 불러오는 중…';$('source-preview').hidden=true;$('result-memo').value=existing?existing.memo||'':'';err('result-error','');
    $('result-dialog').showModal();
    try{
      var data=await api.get('work_handover_candidates',{requestId:requestId});if(dialogSeq!==resultDialogSeq)return;if(!data.success)throw new Error(data.error);
      if(data.workDetail&&data.workDetail.success){state.detail=data.workDetail;detailCache.set(data.workDetail.request.id,data.workDetail);await cache.saveDetail(account,data.workDetail.request.id,data.workDetail).catch(function(){});upsert(data.workDetail.request);renderList();renderDetail();}
      state.sources=data.data.map(function(s){return Object.assign({},s,{gubun:fields.kind(s.gubun)});}).filter(function(s){return s.gubun==='A/S'||s.gubun==='점검';});
      $('source-list').innerHTML=state.sources.length?state.sources.map(function(s,i){return '<button class="source-button" type="button" data-source="'+i+'"><strong>'+esc(s.date)+' · '+esc(s.engineer)+' · '+esc(s.sn||'S/N 미기록')+'</strong><br>'+esc([s.cat,s.type,s.detail.slice(0,100)].filter(Boolean).join(' / '))+'</button>';}).join(''):'이 병원에 저장된 A/S·점검 기록이 없습니다. Handover에서 시트 저장을 완료한 뒤 다시 불러오세요.';
      if(data.total>100)$('source-list').insertAdjacentHTML('afterbegin','<p class="hint">최신 100건 표시</p>');
      var resultDraft=read(scope+'_result_'+requestId);
      var restoreId=existing?existing.source.recordId:resultDraft?resultDraft.recordId:'';
      if(restoreId){var i=state.sources.findIndex(function(s){return s.recordId===restoreId;});if(i>=0)await selectSource(i);else err('result-error','연결하거나 작성 중인 원본이 후보 목록에 없습니다. 원본 보존 상태를 확인하세요.');}
    }catch(e){if(dialogSeq===resultDialogSeq){err('result-error',e.message);$('source-list').textContent='불러오기 실패';}}
  }
  async function selectSource(index){
    var candidate=state.sources[index],seq=++sourceSeq;if(!candidate)return;
    state.source=null;err('result-error','');$('source-preview').hidden=true;
    try{
      var data=await api.get('work_handover_detail',{requestId:state.detail.request.id,recordId:candidate.recordId});if(seq!==sourceSeq)return;if(!data.success)throw new Error(data.error);
      if(data.workDetail&&data.workDetail.success){state.detail=data.workDetail;detailCache.set(data.workDetail.request.id,data.workDetail);await cache.saveDetail(account,data.workDetail.request.id,data.workDetail).catch(function(){});upsert(data.workDetail.request);renderList();renderDetail();}
      state.source=data.source;
      var previous=state.detail.history.find(function(h){return h.kind==='result'&&h.source.recordId===data.source.recordId;});state.resultExisting=previous||null;
      var draft=read(scope+'_result_'+state.detail.request.id);
      $('result-memo').value=draft&&draft.recordId===data.source.recordId?draft.memo:previous?previous.memo||'':'';
      $('source-preview').innerHTML='<strong>자동 입력된 현장 결과</strong>'+resultFields(data.source)+(previous?'<details><summary>이전에 등록한 원본과 비교</summary>'+resultFields(previous.source)+'</details>':'')+'<p class="hint">고객센터 접수 담당자와 예정 방문 일시는 유지됩니다. 원본 내용은 보완 메모와 구분합니다.</p>';
      $('source-preview').hidden=false;document.querySelectorAll('[data-source]').forEach(function(b){b.classList.toggle('selected',Number(b.dataset.source)===index);});
      var r=state.detail.request,warnings=[];
      if(r.engineer&&r.engineer!==data.source.engineer)warnings.push('배정 엔지니어와 실제 처리자가 다릅니다.');
      if(r.sn&&data.source.sn&&!fields.serialMatch(r.sn,data.source.sn))warnings.push('접수 기준 S/N과 다릅니다. 함께 처리한 다른 장비인지 확인하세요.');
      if(!data.source.result)warnings.push('원본에 처리 결과가 미기록입니다.');
      if(warnings.length)err('result-error',warnings.join('\n')+' 해당 요청의 기록이 맞는지 확인하세요.');
    }catch(e){if(seq===sourceSeq)err('result-error',e.message);}
  }
  async function saveResult(complete){
    if(!state.source){err('result-error','연결할 Handover 기록을 선택하세요.');return;}
    var r=state.detail.request,s=state.source,h=state.resultExisting;
    var data=await write('work_result_save',{requestId:r.id,baseRevision:r.revision,recordId:s.recordId,sourceVersion:s.version,baseHistoryRevision:h?h.revision:0,memo:$('result-memo').value,complete:!!complete},'result');
    if(data&&!data.success)err('result-error',data.error+(data.conflict?' 창을 닫고 최신 내용을 확인한 후 다시 불러오세요.':''));
  }
  $('advanced-toggle').onclick=function(){var open=$('advanced-filters').hidden;$('advanced-filters').hidden=!open;this.setAttribute('aria-expanded',String(open));};
  $('advanced-groups').onclick=function(event){var b=event.target.closest('[data-advanced]');if(!b)return;var key=b.dataset.advanced,value=b.dataset.value;if(!value)advanced[key]=[];else if(advanced[key].includes(value))advanced[key]=advanced[key].filter(function(v){return v!==value;});else advanced[key].push(value);if(key==='status')state.statusScope='all';clearSelection();closeDetail(false);state.page=1;renderList();};
  $('advanced-reset').onclick=function(){Object.keys(advanced).forEach(function(k){advanced[k]=[];});$('search').value='';workspaceView='all';roleTouched=true;state.filter='week';lastLiveFilter='week';state.statusScope='all';state.page=1;clearSelection();closeDetail(false);renderList();};
  $('db-refresh').onclick=$('editor-db-refresh').onclick=refreshHospitalDB;
  $('account').textContent=account;
  try{document.documentElement.dataset.theme=localStorage.getItem('baz_work_theme')||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');}catch(e){}
  $('theme').onclick=function(){var value=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=value;try{localStorage.setItem('baz_work_theme',value);}catch(e){}};
  statuses.forEach(function(s){$('status').add(new Option(s,s));});
  $('new').disabled=true;$('new').onclick=function(){openEditor(null);};$('sync').onclick=function(){return sync(false);};
  $('edit-mode').onclick=function(){if(!state.loaded||busy||syncing||bulkWorking||pending||state.filter==='trash')return;editMode=!editMode;selectionMode=false;checkedRequests.clear();activeField=null;renderEdits();};
  $('roster-open').onclick=function(){return openRoster();};
  $('roster-calendar-prev').onclick=function(){return moveRosterMonth(-1);};$('roster-calendar-next').onclick=function(){return moveRosterMonth(1);};
  $('roster-calendar-edit').onclick=function(){resetRosterForm();$('roster-date').value=calendarDate;setRosterTab('manage');$('roster-person').focus();};
  $('roster-calendar-today').onclick=async function(){var date=localNow().slice(0,10);if(date.slice(0,7)!==state.rosterMonth)await loadRoster(date.slice(0,7));if(date.slice(0,7)===state.rosterMonth){calendarDate=date;renderRosterCalendar();updateRosterControls();}};
  $('roster-today-open').onclick=function(){return openRoster(localNow().slice(0,10));};
  ['calendar','manage'].forEach(function(name){var button=$('roster-tab-'+name);button.onclick=function(){setRosterTab(name);};button.onkeydown=function(event){if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();setRosterTab(event.key==='Home'?'calendar':event.key==='End'?'manage':rosterTab==='calendar'?'manage':'calendar',true);}};});
  $('roster-calendar-days').onclick=function(event){var button=event.target.closest('[data-calendar-date]');if(!button||button.disabled||$('roster-calendar-prev').disabled)return;calendarDate=button.dataset.calendarDate;renderRosterCalendar();updateRosterControls();};
  $('roster-close').onclick=function(){$('roster-dialog').close();};
  $('roster-form').onsubmit=saveRoster;$('roster-cancel-edit').onclick=resetRosterForm;
  $('roster-refresh').onclick=function(){loadRoster(state.rosterMonth);};
  $('roster-month').onchange=async function(){var month=this.value;if(!/^\d{4}-\d{2}$/.test(month)){this.value=state.rosterMonth;return;}await loadRoster(month);if(state.rosterMonth===month){rosterDelete=null;$('roster-delete-confirm').hidden=true;resetRosterForm();}};
  function manageRosterRow(event){var button=event.target.closest('button');if(!button||rosterLoading||busy||pending||syncing||bulkWorking)return;var r=state.roster.find(function(r){return r.id===(button.dataset.rosterEdit||button.dataset.rosterDelete);});if(!r||r.deletedAt)return;setRosterTab('manage');err('roster-error','');if(button.dataset.rosterEdit){rosterEdit=Object.assign({},r);$('roster-date').value=r.date;$('roster-person').value=r.person;$('roster-type').value=r.type;$('roster-form-title').textContent='일정 수정';$('roster-cancel-edit').hidden=false;rosterDelete=null;$('roster-delete-confirm').hidden=true;updateRosterControls();$('roster-type').focus();}else{rosterDelete=Object.assign({},r);$('roster-delete-label').textContent=rosterLabel(r)+' 일정을 삭제할까요?';$('roster-delete-confirm').hidden=false;$('roster-delete-cancel').focus();}}
  $('roster-rows').onclick=$('roster-calendar-selection').onclick=manageRosterRow;
  $('roster-delete-cancel').onclick=function(){rosterDelete=null;$('roster-delete-confirm').hidden=true;};
  $('roster-delete-submit').onclick=async function(){if(!rosterDelete||rosterLoading||busy||pending||syncing||bulkWorking)return;var r=rosterDelete,data=await write('work_roster_delete',{date:r.date,person:r.person,baseRevision:r.revision},'roster');if(data&&!data.success)err('roster-error',data.error);};
  $('search').oninput=function(){clearSelection();state.page=1;renderList();};$('sort').onchange=$('sort-direction').onchange=function(){clearSelection();state.page=1;renderList();};
  document.querySelectorAll('[data-workspace]').forEach(function(b){b.onclick=function(){roleTouched=true;workspaceView=b.dataset.workspace;selectionMode=false;clearSelection();closeDetail(false);state.statusScope='all';advanced.status=[];state.page=1;if(state.filter==='trash')state.filter=lastLiveFilter;renderList();};});
  $('my-today').onclick=function(){roleTouched=true;workspaceView='mine';Object.keys(advanced).forEach(function(k){advanced[k]=[];});$('search').value='';state.filter='today';lastLiveFilter='today';state.statusScope='all';state.page=1;clearSelection();closeDetail(false);renderList();if(matchMedia('(max-width:700px)').matches)$('list').scrollIntoView({block:'start'});};
  $('prev').onclick=function(){clearSelection();state.page--;renderList();};$('next').onclick=function(){clearSelection();state.page++;renderList();};
  document.querySelectorAll('[data-filter]').forEach(function(b){b.onclick=function(){selectionMode=false;clearSelection();closeDetail(false);state.filter=b.dataset.filter;lastLiveFilter=state.filter;state.page=1;renderList();};});
  document.querySelectorAll('[data-metric]').forEach(function(b){b.onclick=function(){
    selectionMode=false;clearSelection();closeDetail(false);state.statusScope=b.dataset.metric;advanced.status=[];
    state.page=1;renderList();
  };});
  if($('source-review-alert'))$('source-review-alert').onclick=function(event){var b=event.target.closest('[data-open]');if(b)openDetail(b.dataset.open);};
  $('review-alert-open').onclick=function(){Object.keys(advanced).forEach(function(k){advanced[k]=[];});$('search').value='';workspaceView='all';roleTouched=true;state.filter='all';lastLiveFilter='all';state.statusScope='review';selectionMode=false;clearSelection();closeDetail(false);state.page=1;renderList();};
  $('trash-toggle').onclick=function(){selectionMode=false;clearSelection();closeDetail(false);if(state.filter==='trash')state.filter=lastLiveFilter;else{lastLiveFilter=state.filter;state.filter='trash';editMode=false;}state.page=1;renderList();};
  $('selection-mode').onclick=function(){if(busy||syncing||bulkWorking||pending)return;editMode=false;activeField=null;if(state.detail)renderDetail();selectionMode=!selectionMode;if(!selectionMode)checkedRequests.clear();renderList();};
  $('select-page').onchange=function(){if(!selectionMode||busy||syncing||bulkWorking||pending)return;shownRequests.filter(canManage).forEach(function(r){if($('select-page').checked)checkedRequests.add(r.id);else checkedRequests.delete(r.id);});renderList();};
  $('clear-selection').onclick=clearSelection;
  $('list').onchange=function(event){if(event.target.dataset?.inlineField){var form=event.target.closest('[data-inline-form]');if(form)captureInline(form,event.target.dataset.inlineField);return;}statusChanged(event);var input=event.target.closest('[data-select-request]');if(!selectionMode||!input||busy||syncing||bulkWorking||pending)return;var r=shownRequests.find(function(r){return r.id===input.dataset.selectRequest;});if(!r||!canManage(r))return;if(input.checked)checkedRequests.add(r.id);else checkedRequests.delete(r.id);renderList();};
  $('delete-selected').onclick=function(){openLifecycle('delete',shownRequests.filter(function(r){return checkedRequests.has(r.id);}));};
  $('restore-selected').onclick=function(){openLifecycle('restore',shownRequests.filter(function(r){return checkedRequests.has(r.id);}));};
  $('empty-trash').onclick=async function(){
    if(busy||syncing||bulkWorking||pending||window.BazAuth.cachedLevel()<3)return;
    await sync();if($('sync-state').dataset.state!=='done')return;
    openLifecycle('purge',state.requests.filter(function(r){return r.deletedAt&&!r.purgedAt;}));
  };
  $('purge-confirm').onchange=function(){if(lifecyclePlan&&lifecyclePlan.action==='purge')$('confirm-lifecycle').disabled=!this.checked;};
  function cancelLifecycle(){if(!bulkWorking)$('lifecycle-dialog').close();}
  $('close-lifecycle').onclick=$('cancel-lifecycle').onclick=cancelLifecycle;
  $('lifecycle-dialog').addEventListener('cancel',function(event){if(bulkWorking)event.preventDefault();});
  $('lifecycle-form').onsubmit=submitLifecycle;
  $('detail').oninput=function(event){var form=event.target.closest('[data-inline-form]');if(event.target.dataset?.inlineField&&form)captureInline(form,event.target.dataset.inlineField);};
  $('detail').onsubmit=function(event){if(event.target.closest('[data-inline-form]')&&event.target.dataset.inlineForm)saveInline(event);};
  $('list').oninput=function(event){var form=event.target.closest('[data-inline-form]');if(form)captureInline(form,event.target.dataset?.inlineField);};
  $('list').onsubmit=saveInline;
  $('list').ondblclick=$('detail').ondblclick=beginEdit;
  $('list').onkeydown=$('detail').onkeydown=editKey;
  $('list').onclick=function(event){if(editClick(event))return;var reset=event.target.closest('[data-inline-reset]');if(reset?.dataset.inlineReset&&!busy&&!pending){delete inlineDrafts[reset.dataset.inlineReset];store(inlineDraftKey,inlineDrafts);renderList();return;}var rebase=event.target.closest('[data-inline-rebase]');if(rebase?.dataset.inlineRebase&&!busy&&!pending){var d=inlineDrafts[rebase.dataset.inlineRebase];if(d?.current){d.baseRevision=d.current.revision;delete d.current;delete d.error;store(inlineDraftKey,inlineDrafts);renderList();}return;}var b=event.target.closest('[data-open]');if(b)openDetail(b.dataset.open);};
  $('detail').onclick=function(event){
    if(editClick(event))return;    var b=event.target.closest('button');if(!b)return;
    if(b.dataset.open){openDetail(b.dataset.open);return;}
    if(b.dataset.action==='close-detail'){closeDetail();return;}
    if(b.dataset.action==='refresh-detail'){openDetail(state.detail.request.id,true);return;}
    if(b.dataset.action==='delete'||b.dataset.action==='restore'){changeLifecycle(b.dataset.action);return;}
    if(b.dataset.action==='more-history'){loadMoreHistory();return;}
    if(detailLoading||detailError)return;
    if(b.dataset.action==='claim'){claimRequest();return;}
    if(b.dataset.action==='work-flow'){openDocumentFlow();return;}
    if(b.dataset.sourceReview){confirmSourceReview(b.dataset.sourceReview);return;}
    if(b.dataset.commentDelete){if(busy||pending||state.detail.request.deletedAt)return;b.closest('.entry').querySelector('.comment-delete-confirm').hidden=false;return;}
    if(b.dataset.commentCancel!==undefined){b.closest('.comment-delete-confirm').hidden=true;return;}
    if(b.dataset.commentConfirm||b.dataset.commentRestore){
      if(busy||pending||state.detail.request.deletedAt)return;
      var h=state.detail.history.find(function(x){return x.id===(b.dataset.commentConfirm||b.dataset.commentRestore);});if(!h||h.kind!=='comment')return;
      write('work_history_update',{requestId:state.detail.request.id,historyId:h.id,baseHistoryRevision:h.revision,deleted:!!b.dataset.commentConfirm},'comment-lifecycle').then(function(data){if(data&&!data.success)notify(data.error);else if(data&&data.success){if(commentEdit&&commentEdit.id===h.id){store(scope+'_comment_'+data.request.id,null);commentEdit=null;}notify(b.dataset.commentConfirm?'댓글을 삭제했습니다.':'댓글을 복원했습니다.');}});return;
    }
    if(b.dataset.comment){commentEdit=state.detail.history.find(function(h){return h.id===b.dataset.comment;});$('comment-body').value=commentEdit.body;$('comment-edit-label').textContent='댓글 수정 중';$('cancel-comment').hidden=false;$('comment-body').focus();store(scope+'_comment_'+state.detail.request.id,{body:commentEdit.body,historyId:commentEdit.id,baseRevision:commentEdit.revision});refreshCommentPreview();return;}
    if(b.dataset.result){openResults(state.detail.history.find(function(h){return h.id===b.dataset.result;}));return;}
    var action=b.dataset.action;if(action==='edit'){editMode=true;selectionMode=false;activeField=null;renderEdits();}if(action==='import')openResults();
    if(action==='complete'){write('work_complete',{requestId:state.detail.request.id,baseRevision:state.detail.request.revision},'complete').then(function(d){if(d&&!d.success)notify(d.error);});}
  };
  $('detail').onchange=function(event){if(event.target.dataset?.inlineField){var form=event.target.closest('[data-inline-form]');if(form)captureInline(form,event.target.dataset.inlineField);}else statusChanged(event);};
  var hospitalSearch=window.BazWorkHospitalSearch.create({selector:'#hospital-input, [data-inline-field="hospitalInput"]',getRows:function(){return state.hospitals.filter(function(h){return h.origin!=='flow';});},formatValue:label});
  $('hospital-input').oninput=function(){selectHospital(true);saveDraft();};
  $('request-form').addEventListener('input',function(event){if(event.target.id!=='ack'){$('ack').checked=false;$('duplicate-ack').hidden=true;}saveDraft();});
  $('engineer').onchange=$('visitDate').onchange=$('visitTime').onchange=function(){if(!state.editing&&$('engineer').value&&$('visitDate').value&&normalizeTime($('visitTime').value)&&$('status').value==='접수')$('status').value='방문예정';saveDraft();checkAssignment();};
  ['registeredTime','visitTime'].forEach(function(id){$(id).onblur=function(){var normalized=normalizeTime(this.value);if(normalized)this.value=normalized;saveDraft();};});
  $('request-form').onsubmit=saveRequest;$('close-editor').onclick=function(){saveDraft();if(embedded)receiptMessage('baz-work-receipt-close');else $('editor').close();};$('editor').addEventListener('cancel',function(event){saveDraft();if(embedded){event.preventDefault();receiptMessage('baz-work-receipt-close');}});
  $('discard').onclick=function(){store(draftKey,null);if(embedded)receiptMessage('baz-work-receipt-close');else $('editor').close();};
  $('existing-requests').onclick=function(event){var b=event.target.closest('[data-existing]');if(b){saveDraft();$('editor').close();openDetail(b.dataset.existing);}};
  $('close-result').onclick=function(){sourceSeq++;resultDialogSeq++;$('result-dialog').close();};$('result-dialog').addEventListener('cancel',function(){sourceSeq++;resultDialogSeq++;});$('source-list').onclick=function(event){var b=event.target.closest('[data-source]');if(b)selectSource(Number(b.dataset.source));};
  $('result-form').onsubmit=function(event){event.preventDefault();saveResult(false);};$('save-complete').onclick=function(){saveResult(true);};
  $('result-memo').oninput=function(){if(state.source&&state.detail)store(scope+'_result_'+state.detail.request.id,{recordId:state.source.recordId,memo:this.value});};
  $('retry').onclick=async function(){var d=await sendPending();if(d&&!d.success)notify(d.error);};
  async function persistSnapshot(){if(!kvReady)return;try{await cache.save(account,{storage:'kv',requests:state.requests,hospitals:state.hospitals,engineers:state.engineers,roster:state.roster,rosterMonth:state.rosterMonth,rosterLoaded:state.rosterLoaded,revision:revision,updatedAt:syncCheckedAt,sourceCheckedAt:sourceCheckedAt,bridgeStatus:bridgeStatus});}catch(e){notify('브라우저 보관 실패 · 서버 저장은 유지됩니다. 다음 접속에서 다시 조회합니다.');}}
  async function forgetPurged(id){
    delete inlineDrafts[id];store(inlineDraftKey,inlineDrafts);
    detailCache.delete(id);checkedRequests.delete(id);
    await cache.saveDetail(account,id,null).catch(function(){});
    store(scope+'_comment_'+id,null);store(scope+'_result_'+id,null);
    var draft=read(draftKey);if(draft&&draft.id===id){store(draftKey,null);if($('editor').open)$('editor').close();}
    if(state.detail&&state.detail.request.id===id)closeDetail();
  }
  function changeLifecycle(action){if(state.detail)openLifecycle(action,[state.detail.request]);}
  function openLifecycle(action,requests){
    if(busy||syncing||bulkWorking||pending){notify('먼저 진행 중인 저장 결과를 확인하세요.');return;}
    if(action==='purge'&&window.BazAuth.cachedLevel()<3)return;
    requests=requests.filter(function(r){return !r.purgedAt&&canManage(r)&&!!r.deletedAt===(action!=='delete');});if(!requests.length)return;
    lifecyclePlan={action:action,items:requests.map(function(r){return {id:r.id,revision:r.revision,hospitalName:r.hospitalName,visitAt:r.visitAt,symptom:r.symptom};})};
    $('lifecycle-title').textContent=action==='purge'?'휴지통 '+requests.length+'건 비우기':'선택한 접수 '+requests.length+'건 '+(action==='delete'?'삭제':'복원');
    $('lifecycle-description').textContent=action==='purge'?'아래는 검색·페이지 필터와 관계없이 휴지통에 있는 전체 접수입니다. 접수와 댓글·처리 결과를 영구 삭제하며 복원할 수 없습니다. Handover 원본과 병원 정보는 유지됩니다.':action==='delete'?'아래 접수만 휴지통으로 이동합니다. 댓글과 처리 이력은 보존되며 휴지통에서 복원할 수 있습니다. Handover 원본과 병원 정보는 유지됩니다.':'아래 접수를 목록으로 복원합니다. 상태·댓글·처리 이력은 그대로 유지됩니다.';
    $('lifecycle-list').innerHTML=requests.map(function(r){return '<li><strong>'+esc(r.hospitalName)+'</strong><span>'+esc(time(r.visitAt))+' · '+esc(r.status)+'</span><p>'+esc(r.symptom)+'</p></li>';}).join('');
    $('restore-duplicate-label').hidden=action!=='restore';$('restore-duplicate').checked=false;
    $('purge-confirm-label').hidden=action!=='purge';$('purge-confirm').checked=false;$('confirm-lifecycle').disabled=action==='purge';
    $('confirm-lifecycle').textContent=action==='purge'?'영구 삭제':action==='delete'?'휴지통으로 이동':'선택 접수 복원';$('confirm-lifecycle').className=action==='restore'?'primary':'danger selection-delete';$('lifecycle-progress').textContent='';
    $('lifecycle-dialog').showModal();
  }
  async function submitLifecycle(event){
    event.preventDefault();if(!lifecyclePlan||busy||syncing||bulkWorking||pending)return;
    if(lifecyclePlan.action==='purge'&&!$('purge-confirm').checked)return;
    var plan=lifecyclePlan,completed=0,errors=[],ack=$('restore-duplicate').checked;bulkWorking=true;updatePending();
    ['close-lifecycle','cancel-lifecycle','confirm-lifecycle'].forEach(function(id){$(id).disabled=true;});
    try{
      for(var i=0;i<plan.items.length;i++){
        var r=plan.items[i];$('lifecycle-progress').textContent=(i+1)+' / '+plan.items.length+'건 처리 중…';
        var data=await write('work_'+plan.action,{requestId:r.id,baseRevision:r.revision,acknowledgeDuplicates:ack,confirmPermanentDelete:plan.action==='purge'},'bulk-'+plan.action);
        if(data&&data.success){completed++;checkedRequests.delete(r.id);}
        else {errors.push(r.hospitalName+' · '+(data?data.error:'저장 결과 확인 필요'));if(!data)break;}
      }
    }finally{
      bulkWorking=false;['close-lifecycle','cancel-lifecycle','confirm-lifecycle'].forEach(function(id){$(id).disabled=false;});$('lifecycle-dialog').close();renderList();updatePending();
      notify(completed+'건 '+(plan.action==='purge'?'영구 삭제':plan.action==='delete'?'휴지통 이동':'복원')+' 완료'+(errors.length?'\n'+errors.join('\n')+'\n처리되지 않은 접수는 유지됩니다. 저장 결과 확인 또는 동기화 후 다시 시도하세요.':''));
    }
  }
  async function loadMoreHistory(){var d=state.detail;try{var next=await api.get('work_detail',{id:d.request.id,historyCursor:d.historyCursor||'',auditCursor:d.auditCursor||''});if(!next.success)throw new Error(next.error);var hm=new Map(d.history.map(function(h){return [h.id,h];}));next.history.forEach(function(h){hm.set(h.id,h);});next.history=Array.from(hm.values());next.logs=d.logs.concat(next.logs).filter(function(l,i,a){return a.findIndex(function(x){return x.at===l.at&&x.kind===l.kind&&x.actor===l.actor;})===i;});state.detail=next;detailCache.set(next.request.id,next);await cache.saveDetail(account,next.request.id,next);renderDetail();}catch(e){notify(e.message);}}
  async function start(){
    if(!embedded)loadRoleContext();else{workspaceView='all';state.filter='week';}
    pending=read(pendingKey)||await cache.pending(account).catch(function(){return null;});updatePending();
    var saved=await cache.snapshot(account).catch(function(){return null;});
    if(saved&&saved.storage==='kv'&&Array.isArray(saved.requests)&&saved.hospitals){kvReady=true;state.requests=saved.requests;state.hospitals=saved.hospitals;state.engineers=saved.engineers;state.roster=saved.roster||[];state.rosterMonth=saved.rosterMonth||state.rosterMonth;state.rosterLoaded=!!saved.rosterLoaded;revision=saved.revision||'0';sourceCheckedAt=saved.sourceCheckedAt||'';bridgeStatus=saved.bridgeStatus||null;state.loaded=true;fillPeople();renderList();renderRoster();$('new').disabled=false;showSyncState('done',saved.updatedAt);$('sync-state').textContent='이 PC의 보관 데이터';}
    else await sync();
    if(state.loaded&&!embedded)await refreshTodayRoster();
    if(embedded){$('receipt-launch-status').hidden=state.loaded;$('receipt-launch-retry').hidden=state.loaded;$('receipt-launch-message').textContent=state.loaded?'':'접수 정보를 불러오지 못했습니다. 다시 불러오거나 패널을 닫은 뒤 재시도하세요.';}
    if(launch.receipt&&state.loaded){var selected=window.BazWorkLaunch.match(launch,state.hospitals);openEditor(null,selected);if(launch.name&&!selected)$('hospital-match').textContent='조회한 병원을 최신 병원정보DB에서 확인해 선택하세요. 이름·장비번호·지역이 일치하는 한 개의 후보만 자동 선택합니다.';}
    if(notificationTarget&&!embedded&&state.loaded)await queueNotification(notificationTarget);
  }
  $('receipt-launch-retry').onclick=function(){this.hidden=true;$('receipt-launch-message').textContent='접수 양식을 불러오는 중…';return start();};
  function checkRosterDay(){if(!embedded&&!document.hidden&&todayRosterDate!==localNow().slice(0,10)&&state.loaded&&!syncing&&!busy&&!rosterLoading)refreshTodayRoster();}
  setInterval(checkRosterDay,60000);document.addEventListener('visibilitychange',function(){if(!document.hidden)checkRosterDay();});
  if($('notification-launch-open'))$('notification-launch-open').onclick=openNotification;
  if(window.addEventListener)window.addEventListener('baz-open-notification',function(event){$('notification-launch-open').hidden=false;queueNotification(event.detail||{});});
  if(window.BazHandoverReview)window.BazHandoverReview.onSaved=async function(data,requestId){if(data.request)upsert(data.request);await persistSnapshot();renderList();if(requestId&&state.detail?.request.id===requestId)await openDetail(requestId,true);};
  document.addEventListener('click',function(event){var button=event.target.closest('[data-review-record]');if(button&&window.BazHandoverReview)window.BazHandoverReview.open(button.dataset.reviewRecord,button.dataset.reviewRequest||'').catch(function(e){notify(e.message);});});
  start().then(async function(){var date=new URLSearchParams(window.location.search).get('roster');if(!embedded&&/^\d{4}-\d{2}-\d{2}$/.test(date||'')&&state.loaded&&!notificationBusy()){await loadRoster(date.slice(0,7));await openRoster(date);}});
})();
