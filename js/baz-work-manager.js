(function(){
  'use strict';
  var cache=window.BazWorkCache,kvReady=false,revision='0',sourceCheckedAt='',api=window.BazWorkAPI, $=function(id){return document.getElementById(id);};
  var statuses=['접수','방문예정','처리중','결과확인','완료','보류','취소'];
  var state={requests:[],hospitals:[],engineers:[],filter:'active',page:1,detail:null,selected:null,editing:null,baseline:null,source:null,loaded:false};
  var detailSeq=0,hospitalSeq=0,sourceSeq=0,resultDialogSeq=0,busy=false,syncing=false,syncCheckedAt='';
  var detailCache=new Map(),detailLoading=false,detailError='',detailTask=null;
  var account=window.BazAuth.name(),scope='baz_work_v1_'+encodeURIComponent(account),draftKey=scope+'_draft',pendingKey=scope+'_pending';
  var pending=null,commentEdit=null,checkedRequests=new Set(),shownRequests=[],selectionMode=false,bulkWorking=false,lifecyclePlan=null;
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function store(key,v){try{if(v===null)localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify(v));return true;}catch(e){return false;}}
  function read(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch(e){return null;}}
  function localNow(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()).replace(' ','T');}
  function time(v){if(!v)return '미정';if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v))return v.replace('T',' ');var d=new Date(v);return isNaN(d.getTime())?v:new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);}
  function active(r){return !r.deletedAt&&r.status!=='완료'&&r.status!=='취소';}
  function overdue(r){return active(r)&&r.deadline&&r.deadline<localNow();}
  function badge(status){return '<span class="badge '+(status==='완료'?'done':['보류','취소'].includes(status)?'hold':'')+'">'+esc(status)+'</span>';}
  function notify(message){$('notice').textContent=message||'';$('notice').hidden=!message;}
  function showSyncState(phase,at){
    if(at)syncCheckedAt=at;
    $('sync-state').dataset.state=phase;
    $('sync-state').textContent=phase==='loading'?'동기화 진행 중':phase==='done'?'동기화 완료':'동기화 실패';
    $('sync-time').textContent=syncCheckedAt?'마지막 동기화 '+time(syncCheckedAt):'아직 동기화되지 않았습니다.';
    $('sync').setAttribute('aria-busy',String(phase==='loading'));
  }
  function err(id,message){$(id).textContent=message||'';$(id).hidden=!message;}
  function updatePending(){ $('pending').hidden=!pending; $('retry').disabled=busy||bulkWorking;updateSelection(); }
  function canManage(r){return r.createdBy===account||window.BazAuth.cachedLevel()>=3;}
  function updateSelection(){
    var eligible=shownRequests.filter(canManage),locked=busy||syncing||bulkWorking||!!pending;
    $('selection-bar').hidden=!selectionMode;
    $('list').classList.toggle('selection-mode',selectionMode);
    $('selection-mode').textContent=selectionMode?(state.filter==='trash'?'복원 모드 닫기':'삭제 모드 닫기'):(state.filter==='trash'?'복원':'삭제');
    $('selection-mode').setAttribute('aria-expanded',String(selectionMode));
    $('selection-mode').disabled=locked;
    checkedRequests.forEach(function(id){if(!eligible.some(function(r){return r.id===id;}))checkedRequests.delete(id);});
    $('selection-count').textContent='선택 '+checkedRequests.size+'건';
    $('select-page').checked=eligible.length>0&&checkedRequests.size===eligible.length;
    $('select-page').indeterminate=checkedRequests.size>0&&checkedRequests.size<eligible.length;
    $('select-page').disabled=locked||!selectionMode||!eligible.length;
    $('clear-selection').disabled=locked||!checkedRequests.size;
    $('delete-selected').hidden=state.filter==='trash';$('restore-selected').hidden=state.filter!=='trash';
    $('delete-selected').disabled=$('restore-selected').disabled=locked||!selectionMode||!checkedRequests.size;
    document.querySelectorAll('[data-select-request]').forEach(function(input){var r=eligible.find(function(r){return r.id===input.dataset.selectRequest;});input.checked=checkedRequests.has(input.dataset.selectRequest);input.disabled=locked||!r;});
  }
  function clearSelection(){checkedRequests.clear();updateSelection();}
  function upsert(r){var i=state.requests.findIndex(function(x){return x.id===r.id;});if(i<0)state.requests.unshift(r);else if(state.requests[i].revision<=r.revision)state.requests[i]=r;}
  function label(h){return h.name+' · '+(h.sn||'S/N 미기록')+' · '+(h.region||'지역 미기록');}
  function hospitalTerms(r){
    // 접수에 저장된 병원 키로만 연결한다. 동명 병원/지점의 조건을 대신 표시하지 않는다.
    var matches=state.hospitals.filter(function(h){return h.key===r.hospitalKey;}),h=matches.length===1?matches[0]:null;
    function value(key){return h?String(h[key]==null?'':h[key]).trim()||'미기록':'미확인';}
    return '<div><dt>AS 유/무상</dt><dd>'+esc(value('asType'))+'</dd></div><div><dt>N-care</dt><dd>'+esc(value('ncare'))+'</dd></div>';
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
    var names=Array.from(new Set(state.engineers.concat(state.requests.map(function(r){return r.engineer;})).filter(Boolean)));
    if(current&&!names.includes(current))names.push(current);
    $('engineer').innerHTML='<option value="">미배정</option>'+names.map(function(n){return '<option>'+esc(n)+'</option>';}).join('');$('engineer').value=current;
    $('cs-options').innerHTML=Array.from(new Set([account].concat(state.requests.map(function(r){return r.cs;})).filter(Boolean))).map(function(n){return '<option value="'+esc(n)+'"></option>';}).join('');
    $('hospital-options').innerHTML=state.hospitals.map(function(h){return '<option value="'+esc(label(h))+'"></option>';}).join('');
  }
  function renderList(){
    var today=localNow().slice(0,10),search=$('search').value.trim().toLowerCase(),status=$('status-filter').value;
    $('count-active').textContent=state.requests.filter(active).length;
    $('count-today').textContent=state.requests.filter(function(r){return active(r)&&r.visitAt.slice(0,10)===today;}).length;
    $('count-review').textContent=state.requests.filter(function(r){return !r.deletedAt&&r.status==='결과확인';}).length;
    $('count-overdue').textContent=state.requests.filter(overdue).length;
    var rows=state.requests.filter(function(r){
      if(!!r.deletedAt!==(state.filter==='trash'))return false;
      if(status&&r.status!==status)return false;
      if(search&&![r.hospitalName,r.symptom,r.cs,r.engineer,r.sales].join(' ').toLowerCase().includes(search))return false;
      if(state.filter==='active')return active(r);
      if(state.filter==='today')return active(r)&&r.visitAt.slice(0,10)===today;
      if(state.filter==='mine')return active(r)&&(r.cs===account||r.engineer===account);
      if(state.filter==='unassigned')return active(r)&&(!r.engineer||!r.visitAt);
      if(state.filter==='review')return r.status==='결과확인';
      if(state.filter==='overdue')return overdue(r);
      return true;
    });
    var sort=$('sort').value;
    rows.sort(function(a,b){if(sort==='updated')return b.updatedAt.localeCompare(a.updatedAt);var key=sort==='deadline'?'deadline':'visitAt';return (a[key]||'9999').localeCompare(b[key]||'9999')||b.updatedAt.localeCompare(a.updatedAt);});
    var pages=Math.max(1,Math.ceil(rows.length/50));state.page=Math.min(state.page,pages);
    $('list-count').textContent=rows.length+'건 · 전체 '+state.requests.filter(function(r){return !r.deletedAt;}).length+'건';$('page-info').textContent=state.page+' / '+pages;
    $('prev').disabled=state.page<=1;$('next').disabled=state.page>=pages;
    document.querySelectorAll('.filter-bar [data-filter]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.filter===state.filter));});
    var shown=rows.slice((state.page-1)*50,state.page*50);shownRequests=shown;updateSelection();
    if(!shown.length){$('list').innerHTML='<div class="empty"><strong>'+(state.requests.length?'조건에 맞는 업무가 없습니다':'등록된 A/S 업무가 없습니다')+'</strong>'+(state.requests.length?'검색어나 필터를 변경해 보세요.':'상단의 A/S 접수에서 첫 요청을 등록하세요.')+'</div>';return;}
    function rowButton(r){return '<button class="row-open" data-open="'+esc(r.id)+'">'+esc(r.hospitalName)+'</button><div class="summary">'+esc(r.symptom)+'</div>';}
    function rowCheck(r){return '<input type="checkbox" data-select-request="'+esc(r.id)+'" aria-label="'+esc(r.hospitalName+' · '+time(r.visitAt)+' · '+r.symptom.slice(0,60)+' 접수 선택')+'"'+(checkedRequests.has(r.id)?' checked':'')+(canManage(r)?'':' disabled title="등록자 또는 관리자만 선택할 수 있습니다."')+'>';}
    $('list').innerHTML='<div class="table-scroll"><table><thead><tr><th class="selection-cell"><span class="sr-only">접수 선택</span></th><th>병원 / 접수 증상</th><th>상태</th><th>방문 일시</th><th>엔지니어</th><th>CS 담당</th><th class="recent-column">최근 기록</th></tr></thead><tbody>'+shown.map(function(r){return '<tr class="'+(state.detail&&state.detail.request.id===r.id?'selected':'')+(checkedRequests.has(r.id)?' checked-row':'')+'"><td class="selection-cell">'+rowCheck(r)+'</td><td>'+rowButton(r)+'</td><td>'+badge(r.status)+(overdue(r)?'<div class="overdue">마감 초과</div>':'')+'</td><td class="date">'+esc(time(r.visitAt))+'</td><td>'+esc(r.engineer||'미배정')+'</td><td>'+esc(r.cs)+'</td><td class="recent-column"><div class="summary">'+esc(r.latest||'—')+'</div></td></tr>';}).join('')+'</tbody></table></div><div class="mobile-cards">'+shown.map(function(r){return '<div class="mobile-card '+(state.detail&&state.detail.request.id===r.id?'selected':'')+(checkedRequests.has(r.id)?' checked-row':'')+'"><label class="mobile-select">'+rowCheck(r)+'<span class="sr-only">접수 선택</span></label><button data-open="'+esc(r.id)+'"><div class="card-top"><span>'+esc(r.hospitalName)+'</span>'+badge(r.status)+'</div><div class="card-meta">'+esc(time(r.visitAt))+' · '+esc(r.engineer||'미배정')+(overdue(r)?' · 마감 초과':'')+'</div><div class="card-summary">'+esc(r.symptom.slice(0,130))+'</div></button></div>';}).join('')+'</div>';updateSelection();
  }
  async function sync(force){
    if(syncing||busy||bulkWorking)return;syncing=true;updateSelection();$('sync').disabled=true;$('sync').textContent='동기화 중…';showSyncState('loading');notify('');
    try{
      var data;
      if(state.loaded&&kvReady&&force!==true){
        var merged=new Map(state.requests.map(function(r){return [r.id,r];})),next=revision;
        do{data=await api.get('work_sync',{revision:next});if(!data.success)throw new Error(data.error);(data.requests||[]).forEach(function(r){var old=merged.get(r.id);if(!old||old.revision<=r.revision)merged.set(r.id,r);});next=data.revision;}while(data.more);
        data.requests=Array.from(merged.values());revision=next;
      }else{
        var all=[],page='',base;
        do{data=await api.get('work_bootstrap',page?{pageCursor:page,snapshotSeq:base}:{});if(!data.success)throw new Error(data.error);if(base===undefined)base=data.revision;all=all.concat(data.requests||[]);page=data.pageCursor;}while(page);
        data.requests=all;revision=base||'0';
      }
      // 늦게 도착한 목록으로 이 PC에서 저장한 더 높은 버전을 덮지 않는다.
      var newer=state.requests;state.requests=data.requests;
      newer.forEach(function(r){var x=state.requests.find(function(v){return v.id===r.id;});if(x&&x.revision<r.revision)upsert(r);});
      kvReady=data.storage==='kv';sourceCheckedAt=data.sourceCheckedAt||sourceCheckedAt;state.hospitals=data.hospitals;state.engineers=data.engineers;state.loaded=true;fillPeople();renderList();
      $('new').disabled=false;
      if(data.autoMatch){
        var completed=data.autoMatch.completed.length,skipped=data.autoMatch.skipped.length;
        if(completed||skipped)notify((completed?'Handover 결과 '+completed+'건 자동 연결·완료. ':'')+(skipped?'자동 연결 확인이 필요한 업무 '+skipped+'건은 상세에서 직접 확인하세요.':''));
      }
      if(state.detail){
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
    }catch(e){showSyncState('error');notify(e.message);if(!state.loaded){$('list').innerHTML='<div class="empty"><strong>업무 데이터를 불러오지 못했습니다</strong>로그인과 GAS 배포 상태를 확인하고 동기화 버튼으로 다시 시도하세요.</div>';$('new').disabled=true;}}
    finally{syncing=false;$('sync').disabled=false;$('sync').textContent='↻ 동기화';updateSelection();}
  }
  function resultFields(s){
    var fields=[['처리일',s.date],['실제 처리자',s.engineer],['장비 S/N',s.sn],['처리 구분',s.gubun],['처리 항목',[s.cat,s.type].filter(Boolean).join(' / ')],['처리 내용',s.detail],['처리 결과',s.result],['교체품',s.part],['교체비용',s.cost],['특이사항',s.remark]];
    return '<dl class="result-fields">'+fields.map(function(x){var wide=x[0]==='처리 내용'||x[0]==='특이사항',kind=wide?' class="result-wide"':x[0]==='처리 결과'?' class="result-outcome"':'';return '<dt'+kind+'>'+esc(x[0])+'</dt><dd'+kind+'>'+esc(x[1]||'미기록')+'</dd>';}).join('')+'</dl>';
  }
  function detailMarkup(d,r,results,comments){
    var back='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg>';
    var home='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-8 9 8M5 9v12h5v-7h4v7h5V9"/></svg>';
    var person='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/></svg>';
    function personChip(name){return '<span class="person-chip"><span class="person-icon">'+person+'</span><span class="person-name">'+esc(name||'미배정')+'</span></span>';}
    var kinds=Array.from(new Set(results.map(function(h){return h.source.gubun;}).filter(function(v){return v==='A/S'||v==='점검';})));
    var category=kinds.length?kinds.join(' · '):r.gubun||'구분 미확인';
    var facts=[['상태',badge(r.status)+'<span class="badge work-kind" aria-label="처리 구분">'+esc(category)+'</span>'],['엔지니어',personChip(r.engineer),'fact-assignee'],['영업 담당자',personChip(r.sales),'fact-assignee'],['방문 일시',esc(time(r.visitAt))],['마감일','<span class="'+(overdue(r)?'deadline-overdue':'')+'">'+esc(time(r.deadline))+'</span>']];
    return [
      '<div class="detail-bar"><button data-action="close-detail" aria-label="상세 닫기">'+back+'</button><a href="index.html" aria-label="메인으로">'+home+'</a><div><strong>서비스 업무 상세</strong><span>병원 접수 · 현장 처리 내역</span></div></div>',
      '<div class="detail-summary"><div class="request-byline"><span class="request-avatar" aria-hidden="true">'+esc((r.cs||'CS').slice(-2))+'</span><div><strong>'+esc(r.cs||'담당 미기록')+'</strong><span>CS 접수 담당 · '+esc(time(r.registeredAt))+'</span></div></div>',
      '<div class="detail-heading"><div><h2>'+esc(r.hospitalName)+'</h2><p class="detail-sub">'+esc([r.region,r.sn||'S/N 미기록'].filter(Boolean).join(' · '))+'</p></div></div>',
      '<dl id="hospital-terms" class="hospital-terms" aria-label="병원 서비스 조건">'+hospitalTerms(r)+'</dl>',
      '<dl class="facts">'+facts.map(function(x){return '<div class="fact '+(x[2]||'')+'"><dt>'+x[0]+'</dt><dd>'+x[1]+'</dd></div>';}).join('')+'</dl>',
      r.status==='완료'?'<div class="completion-progress"><span>진척도</span><div><progress max="100" value="100" aria-label="업무 완료 100%">100%</progress><strong>100%</strong></div></div>':'',
      '</div>',
      '<section class="receipt-section detail-content"><h3>접수 내용</h3><p class="entry-body">'+esc(r.symptom)+'</p></section>',
      '<section class="results-section" aria-labelledby="as-result-heading"><h3 id="as-result-heading" class="section-divider">처리 결과</h3><div class="detail-content"><div class="result-list">',
      d.preview?'<p class="result-empty hint">처리 결과를 불러오는 중…</p>':results.length?results.map(function(h){return '<article class="detail-result"><div class="result-title"><h4>현장 처리 내역</h4>'+(h.source.origin==='flow'?'<span class="result-origin">Flow 이전 기록</span>':'')+'</div>'+resultFields(h.source)+(h.memo?(h.source.origin==='flow'?'<details class="result-memo"><summary>Flow 원문 보기</summary><p class="entry-body">'+esc(h.memo)+'</p></details>':'<div class="result-memo"><strong>고객센터 보완</strong><p class="entry-body">'+esc(h.memo)+'</p></div>'):'')+'</article>';}).join(''):'<div class="result-empty"><strong>등록된 처리 결과가 없습니다.</strong></div>',
      '</div>'+((d.historyCursor||d.auditCursor)?'<button data-action="more-history">이력 더 보기</button>':'')+'</div></section>',
      '<section class="detail-section comments-section"><h3>댓글 <span class="muted">'+(d.preview?'확인 중':comments.length)+'</span></h3><div class="timeline">',
      d.preview?'<p class="hint">댓글을 불러오는 중…</p>':comments.map(function(h){return '<article class="entry"><div class="entry-meta"><strong>'+esc(h.author)+'</strong><span>'+esc(time(h.createdAt))+'</span>'+(h.revision>1?'<span>수정됨 '+esc(time(h.updatedAt))+'</span>':'')+'</div><div class="entry-body">'+esc(h.body)+'</div>'+((h.author===account||BazAuth.cachedLevel()>=3)?'<button data-comment="'+esc(h.id)+'">댓글 수정</button>':'')+'</article>';}).join(''),
      '</div><form id="comment-form" class="comment-form"><label class="sr-only" for="comment-body">댓글 내용</label><textarea id="comment-body" rows="2" maxlength="4000" placeholder="댓글을 입력하세요. 추가 상담, 변경 사유, 고객센터 메모" required></textarea><div class="comment-actions"><span id="comment-edit-label" class="hint"></span><button class="primary" type="submit">댓글 저장</button></div></form></section>',
      '<details id="detail-tools" class="detail-section detail-tools" data-request-id="'+esc(r.id)+'"><summary>상세 관리 및 이력</summary><div class="detail-tools-body">',
      r.status==='완료'?'<p class="hint">완료 '+esc(time(r.completedAt))+' · '+esc(r.completedBy||'미기록')+'</p>':'',
      '<p id="detail-checked" class="hint">최신 상세 확인 '+esc(time(d.updatedAt))+'</p><p class="hint">Handover 연동 확인 '+esc(time(sourceCheckedAt))+'</p><div class="detail-buttons"><button data-action="edit">기본 정보 수정</button><button data-action="refresh-detail">최신 내용 확인</button></div>',
      (r.deletedAt?'<p class="notice">휴지통 · '+esc(r.deletedBy)+' · '+esc(time(r.deletedAt))+'</p>'+((r.createdBy===account||BazAuth.cachedLevel()>=3)?'<button data-action="restore">접수 복원</button>':''):(r.createdBy===account||BazAuth.cachedLevel()>=3)?'<button class="danger" data-action="delete">접수 삭제</button>':''),
      '<details class="request-extra"><summary>기본 정보 더 보기</summary><dl class="result-fields"><dt>CS 담당</dt><dd>'+esc(r.cs)+'</dd><dt>영업 담당</dt><dd>'+esc(r.sales||'미기록')+'</dd><dt>등록일시</dt><dd>'+esc(time(r.registeredAt))+'</dd></dl></details>',
      '<div class="result-link-tools"><h4>Handover 연결 관리</h4><p class="hint">Handover의 병원명·처리일이 병원명·방문일과 일치하면 결과가 자동 연결됩니다.</p>',
      results.map(function(h){return '<div class="result-link"><strong>'+esc(h.source.date||'처리일 미기록')+' · '+esc(h.source.engineer||'처리자 미기록')+'</strong>'+(h.source.origin==='flow'?'<span class="result-origin">Flow 이전 기록</span>':h.auto?'<span class="result-origin">자동 연결</span>':'')+'<div class="entry-meta">연결: '+esc(h.author)+' · '+esc(time(h.createdAt))+(h.revision>1?' · 수정 '+esc(time(h.updatedAt)):'')+'</div>'+(h.source.origin==='flow'?'<p class="hint">엑셀 원문을 보존한 기록입니다. 이후 처리 내용은 댓글 또는 Handover 결과로 추가하세요.</p>':'<button data-result="'+esc(h.id)+'">원본 비교·갱신</button>')+'</div>';}).join(''),
      '<div class="result-actions"><button data-action="import">Handover 결과 불러오기</button>'+(r.status!=='완료'?'<button class="primary" data-action="complete">완료 처리</button>':'')+'<a href="handover.html">Handover 열기 ↗</a></div></div>',
      '<details class="detail-records"><summary>이 병원의 다른 접수 · '+d.requests.length+'건</summary>'+d.requests.map(function(x){return '<button class="history-request" data-open="'+esc(x.id)+'">'+esc(time(x.registeredAt))+' · '+esc(x.status)+'<br>'+esc(x.symptom.slice(0,100))+'</button>';}).join('')+'</details>',
      '<details class="detail-records"><summary>변경 이력 · 이전 내용 확인</summary>'+d.logs.slice().reverse().map(function(log){return '<div class="audit-item">'+esc(auditText(log))+'<br><small>'+esc(log.actor)+' · '+esc(time(log.at))+'</small></div>';}).join('')+'</details></div></details>'
    ].join('');
  }
  function auditText(log){
    if(log.kind==='result_auto')return 'Handover 결과 자동 연결 · 고객센터 결과 확인 대기';if(log.kind==='delete')return '접수 휴지통 이동';if(log.kind==='restore')return '접수 복원';
    if(log.kind==='request_create')return '고객센터 접수';
    if(log.kind==='comment_add')return '댓글 등록';
    if(log.kind==='comment_update')return '댓글 수정 · 이전 내용: '+(log.before?log.before.body:'');
    if(log.kind==='result_save')return log.before?'Handover 결과 갱신 · 이전 처리 내용: '+(log.before.source.detail||''):'Handover 결과 등록';
    var before=log.requestBefore||log.before||{},after=log.after||{},labels={status:'상태',engineer:'엔지니어',visitAt:'방문',deadline:'마감',cs:'CS 담당',sales:'영업 담당',symptom:'증상'};
    var diff=Object.keys(labels).filter(function(k){return before[k]!==after[k];}).map(function(k){return labels[k]+': '+(before[k]||'미정')+' → '+(after[k]||'미정');});
    return diff.join(' / ')||'기본 정보 수정';
  }
  function renderDetail(){
    var d=state.detail,r=d.request;
    var previousInput=$('comment-body'),restoreFocus=previousInput&&previousInput.dataset.requestId===r.id&&document.activeElement===previousInput;
    var selection=restoreFocus?[previousInput.selectionStart,previousInput.selectionEnd]:null;
    var previousTools=$('detail-tools'),keepToolsOpen=previousTools&&!$('detail').hidden&&previousTools.dataset.requestId===r.id&&previousTools.open;
    var entries=d.history.slice().sort(function(a,b){return b.createdAt.localeCompare(a.createdAt);});
    $('detail').innerHTML=detailMarkup(d,r,entries.filter(function(h){return h.kind==='result';}),entries.filter(function(h){return h.kind!=='result';}));
    $('detail').hidden=false;commentEdit=null;
    $('detail-tools').open=!!keepToolsOpen;
    var commentDraft=read(scope+'_comment_'+r.id)||{};
    $('comment-body').value=commentDraft.body||'';
    if(commentDraft.historyId){
      var savedComment=d.history.find(function(h){return h.id===commentDraft.historyId&&h.kind==='comment';});
      if(savedComment){commentEdit=Object.assign({},savedComment,{revision:commentDraft.baseRevision});$('comment-edit-label').textContent='댓글 수정 초안 복원됨';}
      else if(d.preview){commentEdit={id:commentDraft.historyId,revision:commentDraft.baseRevision};$('comment-edit-label').textContent='댓글 수정 초안 · 원본 확인 중';}
    }
    var cancelComment=document.createElement('button');cancelComment.type='button';cancelComment.id='cancel-comment';cancelComment.textContent='수정 취소';cancelComment.hidden=!commentEdit;
    $('comment-edit-label').after(cancelComment);
    cancelComment.onclick=function(){commentEdit=null;$('comment-edit-label').textContent='';$('comment-body').value='';this.hidden=true;store(scope+'_comment_'+r.id,null);};
    $('comment-body').addEventListener('input',function(){store(scope+'_comment_'+r.id,{body:this.value,historyId:commentEdit?commentEdit.id:'',baseRevision:commentEdit?commentEdit.revision:0});});
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
    $('detail').querySelectorAll('[data-action="edit"],[data-action="import"],[data-action="complete"],[data-comment],[data-result],#comment-form button[type="submit"]').forEach(function(b){b.disabled=detailLoading||!!detailError||!!r.deletedAt;});
    var refresh=$('detail').querySelector('[data-action="refresh-detail"]');refresh.disabled=detailLoading;refresh.textContent=detailLoading?'최신 내용 확인 중…':'최신 내용 확인';
    $('comment-body').dataset.requestId=r.id;
    if(restoreFocus){$('comment-body').focus({preventScroll:true});$('comment-body').setSelectionRange(selection[0],selection[1]);}
    renderList();
  }
  async function openDetail(id,force){
    if(busy)return;
    if(detailLoading&&state.detail&&state.detail.request.id===id)return detailTask;
    var seq=++detailSeq,known=state.requests.find(function(r){return r.id===id;}),cached=detailCache.get(id)||await cache.detail(account,id).catch(function(){return null;});
    notify('');detailLoading=true;detailError='';
    // 목록의 접수 정보는 즉시 표시한다. 댓글/결과의 미조회 상태를 0건으로 표시하지 않는다.
    if(known||cached){
      state.detail=Object.assign({},cached||{history:[],logs:[],requests:state.requests.filter(function(r){return r.hospitalId===known.hospitalId;}),updatedAt:'',preview:true},{request:known||cached.request});
      renderDetail();if(matchMedia('(max-width:700px)').matches)$('detail').scrollIntoView({block:'start'});
    }
    detailTask=(async function(){
      try{
        var d=(!force&&cached&&!cached.preview&&known&&cached.request.revision===known.revision)?cached:await api.get('work_detail',{id:id});if(seq!==detailSeq)return;if(!d.success)throw new Error(d.error);
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
  function closeDetail(){detailSeq++;detailLoading=false;detailError='';detailTask=null;state.detail=null;$('detail').hidden=true;$('detail').setAttribute('aria-busy','false');renderList();}
  async function selectHospital(fillSales){
    var value=$('hospital-input').value.trim(),matches=state.hospitals.filter(function(h){return label(h)===value||h.name===value;});
    var seq=++hospitalSeq;state.selected=matches.length===1?matches[0]:null;
    $('existing-requests').hidden=true;$('ack').checked=false;$('duplicate-ack').hidden=true;err('form-error','');
    if(!state.selected){$('hospital-match').textContent='목록에서 병원을 선택하세요. 같은 이름의 지점은 S/N과 지역을 확인하세요.';if(fillSales)$('sales').value='';$('past-history').textContent='병원을 선택하세요.';return;}
    var h=state.selected;if(fillSales)$('sales').value=h.sales||'';
    $('hospital-match').textContent=[h.region,h.sn?'S/N '+h.sn:'S/N 미기록',h.ncare?'N-CARE '+h.ncare:'',h.sales?'영업 '+h.sales:''].filter(Boolean).join(' · ');
    var current=state.requests.filter(function(r){return r.hospitalKey===h.key&&active(r)&&(!state.editing||r.id!==state.editing.id);});
    if(current.length){$('existing-requests').innerHTML='<strong>이 병원의 미완료 요청 '+current.length+'건</strong><br>'+current.map(function(r){return '<button type="button" data-existing="'+esc(r.id)+'">'+esc(r.status)+' · '+esc(r.symptom.slice(0,70))+'</button>';}).join('');$('existing-requests').hidden=false;}
    $('past-history').textContent='기존 처리 이력을 확인하는 중…';
    try{var data=await api.get('work_handover_candidates',{hospitalName:h.name});if(seq!==hospitalSeq)return;if(!data.success)throw new Error(data.error);$('past-history').innerHTML=data.data.length?data.data.slice(0,8).map(function(s){return '<div class="past-item"><strong>'+esc(s.gubun)+' · '+esc(s.date)+' · '+esc(s.engineer)+'</strong><br>'+esc([s.cat,s.type,s.detail].filter(Boolean).join(' / '))+'</div>';}).join('')+(data.total>8?'<p class="hint">최근 8건 표시 · 전체 '+data.total+'건</p>':''):'기존 처리 이력이 없습니다.';}
    catch(e){if(seq===hospitalSeq)$('past-history').textContent='이력 조회 실패: '+e.message;}
  }
  function setForm(form){['symptom','cs','sales','status','registeredAt','visitAt','deadline'].forEach(function(k){$(k).value=form[k]||'';});['registered','visit'].forEach(function(prefix){var parts=String(form[prefix==='registered'?'registeredAt':'visitAt']||'').split('T');$(prefix+'Date').value=parts[0]||'';$(prefix+'Time').value=parts[1]||'';});var h=state.hospitals.find(function(x){return x.key===form.hospitalKey;});$('hospital-input').value=h?label(h):'';if(form.engineer&&!Array.from($('engineer').options).some(function(x){return x.value===form.engineer;}))$('engineer').add(new Option(form.engineer,form.engineer));$('engineer').value=form.engineer||'';selectHospital(false);}
  function openEditor(request){
    if(!state.loaded||busy)return;state.editing=request||null;state.baseline=request?Object.assign({},request):null;
    $('request-form').reset();err('form-error','');$('duplicate-ack').hidden=true;state.selected=null;
    var draft=read(draftKey),useDraft=draft&&draft.id===(request?request.id:null);
    var form=request||{cs:account,status:'접수',registeredAt:localNow()};
    if(useDraft){form=draft.form;state.baseline=draft.baseline;if(request)state.editing=Object.assign({},request,{revision:draft.baseRevision});}
    fillPeople();setForm(form);if(useDraft)$('hospital-input').value=draft.hospitalInput||$('hospital-input').value;
    $('editor-title').textContent=request?'A/S 접수 정보 수정':'A/S 접수';$('draft-status').textContent=useDraft?'이 PC의 미저장 초안 복원됨':'';
    if(!$('editor').open)$('editor').showModal();
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
    var disabledBefore=Array.from(document.querySelectorAll('dialog input,dialog select,dialog textarea,#comment-body,button[type=submit],#save-complete')).map(function(b){var previous=b.disabled;b.disabled=true;return {element:b,disabled:previous};});
    var operation=pending;
    try{
      var data=await api.post(operation.action,operation.payload);
      if(!data.success&&data.retrySameOperation){notify(data.error+' 같은 기록으로 재시도하세요.');$('save-status').textContent='저장 결과 확인 필요';return null;}
      pending=null;store(pendingKey,null);await cache.savePending(account,null).catch(function(){});updatePending();
      if(!data.success){$('save-status').textContent='저장되지 않음';return data;}
      upsert(data.request);renderList();$('save-status').textContent='서버 저장 완료 '+time(data.request.updatedAt);
      if(operation.context==='request'){store(draftKey,null);$('editor').close();}
      if(operation.context==='comment'){store(scope+'_comment_'+data.request.id,null);commentEdit=null;}
      if(operation.context==='result'){store(scope+'_result_'+data.request.id,null);$('result-dialog').close();}
      // KV response is sufficient; no second detail request on the save path.
      var detail=detailCache.get(data.request.id)||(state.detail&&state.detail.request.id===data.request.id?state.detail:null)||await cache.detail(account,data.request.id).catch(function(){return null;});
      // A row mutation must not turn an unqueried or stale history into an empty, current detail.
      var complete=detail&&!detail.preview&&(operation.payload.baseRevision==null||detail.request.revision===operation.payload.baseRevision);
      if(operation.context==='request'&&!operation.payload.id)complete=true;
      detail=Object.assign({},detail||{history:[],logs:[],requests:[]},{success:true,request:data.request,updatedAt:data.request.updatedAt,preview:!complete,requests:state.requests.filter(function(r){return !r.deletedAt&&r.hospitalId===data.request.hospitalId;})});
      if(data.history){detail.history=detail.history.filter(function(h){return h.id!==data.history.id;}).concat([data.history]);}
      if(data.event)detail.logs=detail.logs.concat([data.event]);
      detailCache.set(data.request.id,detail);await cache.saveDetail(account,data.request.id,detail).catch(function(){});await persistSnapshot();
      busy=false;
      if(data.request.deletedAt){if(state.detail&&state.detail.request.id===data.request.id){detailSeq++;state.detail=null;$('detail').hidden=true;}notify('선택한 접수를 휴지통으로 이동했습니다.');renderList();}
      else if(operation.context.indexOf('bulk-')!==0||(state.detail&&state.detail.request.id===data.request.id)){state.detail=detail;detailLoading=false;detailError='';renderDetail();}
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
  async function saveComment(event){
    event.preventDefault();if(detailLoading||detailError)return;var r=state.detail.request,body=$('comment-body').value;if(r.deletedAt){notify('삭제된 접수에는 댓글을 남길 수 없습니다.');return;}
    var data=await write(commentEdit?'work_history_update':'work_history_add',{requestId:r.id,body:body,historyId:commentEdit?commentEdit.id:'',baseHistoryRevision:commentEdit?commentEdit.revision:0},'comment');
    if(data&&!data.success)notify(data.error+(data.conflict?'\n최신 댓글을 확인한 뒤 다시 편집하세요. 입력한 내용은 초안에 남아 있습니다.':''));
  }
  async function openResults(existing){
    if(busy)return;var requestId=state.detail.request.id,dialogSeq=++resultDialogSeq;state.source=null;state.resultExisting=existing||null;sourceSeq++;
    $('source-list').textContent='Handover 기록을 불러오는 중…';$('source-preview').hidden=true;$('result-memo').value=existing?existing.memo||'':'';err('result-error','');
    $('result-dialog').showModal();
    try{
      var data=await api.get('work_handover_candidates',{requestId:requestId});if(dialogSeq!==resultDialogSeq)return;if(!data.success)throw new Error(data.error);
      state.sources=data.data.filter(function(s){return s.gubun==='A/S'||s.gubun==='점검';});
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
      state.source=data.source;
      var previous=state.detail.history.find(function(h){return h.kind==='result'&&h.source.recordId===data.source.recordId;});state.resultExisting=previous||null;
      var draft=read(scope+'_result_'+state.detail.request.id);
      $('result-memo').value=draft&&draft.recordId===data.source.recordId?draft.memo:previous?previous.memo||'':'';
      $('source-preview').innerHTML='<strong>자동 입력된 현장 결과</strong>'+resultFields(data.source)+(previous?'<details><summary>이전에 등록한 원본과 비교</summary>'+resultFields(previous.source)+'</details>':'')+'<p class="hint">고객센터 접수 담당자와 예정 방문 일시는 유지됩니다. 원본 내용은 보완 메모와 구분합니다.</p>';
      $('source-preview').hidden=false;document.querySelectorAll('[data-source]').forEach(function(b){b.classList.toggle('selected',Number(b.dataset.source)===index);});
      var r=state.detail.request,warnings=[];
      if(r.engineer&&r.engineer!==data.source.engineer)warnings.push('배정 엔지니어와 실제 처리자가 다릅니다.');
      if(r.sn&&data.source.sn&&r.sn!==data.source.sn)warnings.push('접수 장비와 처리 장비 S/N이 다릅니다.');
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
  $('account').textContent=account;
  try{document.documentElement.dataset.theme=localStorage.getItem('baz_work_theme')||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');}catch(e){}
  $('theme').onclick=function(){var value=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=value;try{localStorage.setItem('baz_work_theme',value);}catch(e){}};
  statuses.forEach(function(s){$('status').add(new Option(s,s));$('status-filter').add(new Option(s,s));});
  $('new').disabled=true;$('new').onclick=function(){openEditor(null);};$('sync').onclick=function(){sync(false);};
  $('search').oninput=function(){clearSelection();state.page=1;renderList();};$('status-filter').onchange=function(){clearSelection();state.page=1;renderList();};$('sort').onchange=function(){clearSelection();state.page=1;renderList();};
  $('prev').onclick=function(){clearSelection();state.page--;renderList();};$('next').onclick=function(){clearSelection();state.page++;renderList();};
  document.querySelectorAll('[data-filter]').forEach(function(b){b.onclick=function(){selectionMode=false;clearSelection();state.filter=b.dataset.filter;state.page=1;renderList();};});
  $('selection-mode').onclick=function(){if(busy||syncing||bulkWorking||pending)return;selectionMode=!selectionMode;if(!selectionMode)checkedRequests.clear();renderList();};
  $('select-page').onchange=function(){if(!selectionMode||busy||syncing||bulkWorking||pending)return;shownRequests.filter(canManage).forEach(function(r){if($('select-page').checked)checkedRequests.add(r.id);else checkedRequests.delete(r.id);});renderList();};
  $('clear-selection').onclick=clearSelection;
  $('list').onchange=function(event){var input=event.target.closest('[data-select-request]');if(!selectionMode||!input||busy||syncing||bulkWorking||pending)return;var r=shownRequests.find(function(r){return r.id===input.dataset.selectRequest;});if(!r||!canManage(r))return;if(input.checked)checkedRequests.add(r.id);else checkedRequests.delete(r.id);renderList();};
  $('delete-selected').onclick=function(){openLifecycle('delete',shownRequests.filter(function(r){return checkedRequests.has(r.id);}));};
  $('restore-selected').onclick=function(){openLifecycle('restore',shownRequests.filter(function(r){return checkedRequests.has(r.id);}));};
  function cancelLifecycle(){if(!bulkWorking)$('lifecycle-dialog').close();}
  $('close-lifecycle').onclick=$('cancel-lifecycle').onclick=cancelLifecycle;
  $('lifecycle-dialog').addEventListener('cancel',function(event){if(bulkWorking)event.preventDefault();});
  $('lifecycle-form').onsubmit=submitLifecycle;
  $('list').onclick=function(event){var b=event.target.closest('[data-open]');if(b)openDetail(b.dataset.open);};
  $('detail').onclick=function(event){
    var b=event.target.closest('button');if(!b)return;
    if(b.dataset.open){openDetail(b.dataset.open);return;}
    if(b.dataset.action==='close-detail'){closeDetail();return;}
    if(b.dataset.action==='refresh-detail'){openDetail(state.detail.request.id,true);return;}
    if(b.dataset.action==='delete'||b.dataset.action==='restore'){changeLifecycle(b.dataset.action);return;}
    if(b.dataset.action==='more-history'){loadMoreHistory();return;}
    if(detailLoading||detailError)return;
    if(b.dataset.comment){commentEdit=state.detail.history.find(function(h){return h.id===b.dataset.comment;});$('comment-body').value=commentEdit.body;$('comment-edit-label').textContent='댓글 수정 중';$('cancel-comment').hidden=false;$('comment-body').focus();store(scope+'_comment_'+state.detail.request.id,{body:commentEdit.body,historyId:commentEdit.id,baseRevision:commentEdit.revision});return;}
    if(b.dataset.result){openResults(state.detail.history.find(function(h){return h.id===b.dataset.result;}));return;}
    var action=b.dataset.action;if(action==='edit')openEditor(state.detail.request);if(action==='import')openResults();
    if(action==='complete'){write('work_complete',{requestId:state.detail.request.id,baseRevision:state.detail.request.revision},'complete').then(function(d){if(d&&!d.success)notify(d.error);});}
  };
  $('hospital-input').oninput=function(){selectHospital(true);saveDraft();};
  $('request-form').addEventListener('input',function(event){if(event.target.id!=='ack'){$('ack').checked=false;$('duplicate-ack').hidden=true;}saveDraft();});
  $('engineer').onchange=$('visitDate').onchange=$('visitTime').onchange=function(){if(!state.editing&&$('engineer').value&&$('visitDate').value&&normalizeTime($('visitTime').value)&&$('status').value==='접수')$('status').value='방문예정';saveDraft();};
  ['registeredTime','visitTime'].forEach(function(id){$(id).onblur=function(){var normalized=normalizeTime(this.value);if(normalized)this.value=normalized;saveDraft();};});
  $('request-form').onsubmit=saveRequest;$('close-editor').onclick=function(){saveDraft();$('editor').close();};$('editor').addEventListener('cancel',saveDraft);
  $('discard').onclick=function(){store(draftKey,null);$('editor').close();};
  $('existing-requests').onclick=function(event){var b=event.target.closest('[data-existing]');if(b){saveDraft();$('editor').close();openDetail(b.dataset.existing);}};
  $('close-result').onclick=function(){sourceSeq++;resultDialogSeq++;$('result-dialog').close();};$('result-dialog').addEventListener('cancel',function(){sourceSeq++;resultDialogSeq++;});$('source-list').onclick=function(event){var b=event.target.closest('[data-source]');if(b)selectSource(Number(b.dataset.source));};
  $('result-form').onsubmit=function(event){event.preventDefault();saveResult(false);};$('save-complete').onclick=function(){saveResult(true);};
  $('result-memo').oninput=function(){if(state.source&&state.detail)store(scope+'_result_'+state.detail.request.id,{recordId:state.source.recordId,memo:this.value});};
  $('retry').onclick=async function(){var d=await sendPending();if(d&&!d.success)notify(d.error);};
  async function persistSnapshot(){if(!kvReady)return;try{await cache.save(account,{storage:'kv',requests:state.requests,hospitals:state.hospitals,engineers:state.engineers,revision:revision,updatedAt:syncCheckedAt,sourceCheckedAt:sourceCheckedAt});}catch(e){notify('브라우저 보관 실패 · 서버 저장은 유지됩니다. 다음 접속에서 다시 조회합니다.');}}
  function changeLifecycle(action){if(state.detail)openLifecycle(action,[state.detail.request]);}
  function openLifecycle(action,requests){
    if(busy||syncing||bulkWorking||pending){notify('먼저 진행 중인 저장 결과를 확인하세요.');return;}
    requests=requests.filter(function(r){return canManage(r)&&!!r.deletedAt===(action==='restore');});if(!requests.length)return;
    lifecyclePlan={action:action,items:requests.map(function(r){return {id:r.id,revision:r.revision,hospitalName:r.hospitalName,visitAt:r.visitAt,symptom:r.symptom};})};
    $('lifecycle-title').textContent='선택한 접수 '+requests.length+'건 '+(action==='delete'?'삭제':'복원');
    $('lifecycle-description').textContent=action==='delete'?'아래 접수만 휴지통으로 이동합니다. 댓글과 처리 이력은 보존되며 휴지통에서 복원할 수 있습니다. Handover 원본과 병원 정보는 유지됩니다.':'아래 접수를 목록으로 복원합니다. 상태·댓글·처리 이력은 그대로 유지됩니다.';
    $('lifecycle-list').innerHTML=requests.map(function(r){return '<li><strong>'+esc(r.hospitalName)+'</strong><span>'+esc(time(r.visitAt))+' · '+esc(r.status)+'</span><p>'+esc(r.symptom)+'</p></li>';}).join('');
    $('restore-duplicate-label').hidden=action!=='restore';$('restore-duplicate').checked=false;
    $('confirm-lifecycle').textContent=action==='delete'?'휴지통으로 이동':'선택 접수 복원';$('confirm-lifecycle').className=action==='delete'?'danger selection-delete':'primary';$('lifecycle-progress').textContent='';
    $('lifecycle-dialog').showModal();
  }
  async function submitLifecycle(event){
    event.preventDefault();if(!lifecyclePlan||busy||syncing||bulkWorking||pending)return;
    var plan=lifecyclePlan,completed=0,errors=[],ack=$('restore-duplicate').checked;bulkWorking=true;updatePending();
    ['close-lifecycle','cancel-lifecycle','confirm-lifecycle'].forEach(function(id){$(id).disabled=true;});
    try{
      for(var i=0;i<plan.items.length;i++){
        var r=plan.items[i];$('lifecycle-progress').textContent=(i+1)+' / '+plan.items.length+'건 처리 중…';
        var data=await write('work_'+plan.action,{requestId:r.id,baseRevision:r.revision,acknowledgeDuplicates:ack},'bulk-'+plan.action);
        if(data&&data.success){completed++;checkedRequests.delete(r.id);}
        else {errors.push(r.hospitalName+' · '+(data?data.error:'저장 결과 확인 필요'));if(!data)break;}
      }
    }finally{
      bulkWorking=false;['close-lifecycle','cancel-lifecycle','confirm-lifecycle'].forEach(function(id){$(id).disabled=false;});$('lifecycle-dialog').close();renderList();updatePending();
      notify(completed+'건 '+(plan.action==='delete'?'휴지통 이동':'복원')+' 완료'+(errors.length?'\n'+errors.join('\n')+'\n처리되지 않은 선택은 유지됩니다. 저장 결과 확인 또는 동기화 후 다시 시도하세요.':''));
    }
  }
  async function loadMoreHistory(){var d=state.detail;try{var next=await api.get('work_detail',{id:d.request.id,historyCursor:d.historyCursor||'',auditCursor:d.auditCursor||''});if(!next.success)throw new Error(next.error);var hm=new Map(d.history.map(function(h){return [h.id,h];}));next.history.forEach(function(h){hm.set(h.id,h);});next.history=Array.from(hm.values());next.logs=d.logs.concat(next.logs).filter(function(l,i,a){return a.findIndex(function(x){return x.at===l.at&&x.kind===l.kind&&x.actor===l.actor;})===i;});state.detail=next;detailCache.set(next.request.id,next);await cache.saveDetail(account,next.request.id,next);renderDetail();}catch(e){notify(e.message);}}
  async function start(){
    pending=read(pendingKey)||await cache.pending(account).catch(function(){return null;});updatePending();
    var saved=await cache.snapshot(account).catch(function(){return null;});
    if(saved&&saved.storage==='kv'&&Array.isArray(saved.requests)&&saved.hospitals){kvReady=true;state.requests=saved.requests;state.hospitals=saved.hospitals;state.engineers=saved.engineers;revision=saved.revision||'0';sourceCheckedAt=saved.sourceCheckedAt||'';state.loaded=true;fillPeople();renderList();$('new').disabled=false;showSyncState('done',saved.updatedAt);$('sync-state').textContent='이 PC의 보관 데이터';}
    else await sync();
  }
  start();
})();

