(function (root) {
  'use strict';
  const byId = id => document.getElementById(id);
  const api = root.BazWorkAPI, cache = root.BazWorkCache;
  const panel = byId('field-records-panel'), dialog = byId('field-memo-dialog');
  const filters = byId('field-records-filters'), form = byId('field-memo-form');
  const directory = byId('field-records-directory'), empty = byId('field-records-empty');
  const template = byId('field-records-hospital-template');
  const pendingElement = byId('field-records-pending');
  const filterStatus = byId('field-records-status');
  const error = byId('field-memo-error'), feedback = byId('field-memo-feedback');
  const sourceLabels = { sales: '영업팀', hospital: '병원', cs: 'CS 내부', other: '기타', unclassified: '미분류' };
  const impactLabels = { schedule: '일정 변경', extra_visit: '추가 방문', after_hours: '업무시간 외 대응', cost: '추가 비용', none: '영향 없음', unset: '미입력' };
  const columns = ['schedule', 'extra_visit', 'after_hours', 'cost'];
  const zoned = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
  const clock = new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', hour:'2-digit', minute:'2-digit'});
  const counts = new Map(), hospitalSelection = new Set();
  let bridge, owner = '', registered = false, noteContext, queueBusy = false, queueRequested = false, feedbackTimer, pending = [];
  const timelines = new Map(), knownGroups = new Map();
  const timelineObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const timeline = timelines.get(entry.target.dataset.hospitalGroup);
      if (entry.isIntersecting && timeline?.expanded && visible()) {
        timelineObserver.unobserve(entry.target);
        void loadTimeline(timeline);
      }
    }
  }, {rootMargin:'180px'});
  let activeFilters, revision = '', summarySeq = 0, summaryBusy = false, firstResult = true;
  let timelineId = 0, recentSeq = 0, recentCursor = '';
  let visibleIds = [], countSeq = 0, submitBusy = false;

  function escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
  }
  const dateTime = (date = new Date()) => zoned.format(date).replace(' ', 'T');
  const normalize = text => String(text || '').normalize('NFKC').replace(/[\s_]+/g, '').toLowerCase();
  const groupKey = (name, region) => JSON.stringify([normalize(name), normalize(region)]);
  const accountOwner = () => root.BazInspectionSession.owner(root.BazAuth);
  const active = () => Boolean(owner && accountOwner() === owner);
  const visible = () => active() && !panel.hidden && !document.hidden;
  const hospitalName = row => [row.hospitalName || row.name, row.region].filter(Boolean).join(' · ');
  function requireSuccess(data) {
    if (!data.success) throw new Error(data.error || '현장 기록을 불러오지 못했습니다.');
    return data;
  }
  function options(labels, placeholder) {
    return '<option value="">' + placeholder + '</option>' + Object.entries(labels).map(([id, label]) =>
      '<option value="' + id + '">' + label + '</option>').join('');
  }

  filters.elements.source.innerHTML = options(sourceLabels, '전체 출처');
  filters.elements.impact.innerHTML = options(impactLabels, '전체 영향');
  form.elements.source.innerHTML = options(Object.fromEntries(Object.entries(sourceLabels).filter(([id]) => id !== 'unclassified')), '선택 안 함');
  byId('field-memo-impacts').innerHTML = [...columns, 'none'].map(id =>
    '<label><input type="checkbox" name="impacts" value="' + id + '"> ' + impactLabels[id] + '</label>').join('');
  byId('field-memo-impacts').onchange = event => {
    const input = event.target;
    if (!input.checked) return;
    for (const item of form.elements.impacts) {
      if (item !== input && (input.value === 'none' || item.value === 'none')) item.checked = false;
    }
  };

  function configure(enabled, adapters) {
    const next = accountOwner();
    if (!enabled || !next.startsWith('account:')) {
      disable();
      return;
    }
    if (owner && owner !== next) disable();
    bridge = adapters;
    if (owner === next) return;
    owner = next;
    registered = true;
    setPeriod('month');
    root.BazWorkTabs.register('field-records', byId('field-records-tab'), panel);
    void flushQueue();
  }

  function disable() {
    if (!registered) return;
    if (!panel.hidden) root.BazWorkTabs.show('service');
    root.BazWorkTabs.unregister('field-records');
    registered = false;
    owner = '';
    summarySeq++; recentSeq++; countSeq++; summaryBusy = false;
    activeFilters = undefined; revision = '';
    resetTimelines(); knownGroups.clear(); hospitalSelection.clear(); counts.clear(); visibleIds = []; pending = [];
    for (const element of [pendingElement, filterStatus, feedback, byId('field-memo-recent-entries')]) element.textContent = '';
    feedback.hidden = true;
    form.reset();
    entryRecords.clear();
    if (dialog.open) dialog.close();
  }

  function button(request, display) {
    if (request.deletedAt || request.purgedAt) return '';
    const label = counts.get(request.id) ? '메모 ' + counts.get(request.id) + '건' : '＋ 메모';
    return '<button type="button" class="field-memo-trigger" aria-haspopup="dialog" data-field-request="' +
      escape(request.id) + '" data-field-hospital="' + escape(display.hospitalName) + '">' + label + '</button>';
  }

  async function hydrate(rows) {
    if (!active()) return;
    if (rows) visibleIds = rows.filter(row => !row.deletedAt && !row.purgedAt).map(row => row.id);
    const seq = ++countSeq;
    if (!visibleIds.length) return;
    try {
      const data = requireSuccess(await api.get('work_memo_counts', {ids:visibleIds}));
      if (seq !== countSeq || !active()) return;
      for (const id of visibleIds) counts.set(id, Number(data.counts?.[id]) || 0);
      for (const el of document.querySelectorAll('[data-field-request]')) {
        const count = counts.get(el.dataset.fieldRequest);
        el.textContent = count ? '메모 ' + count + '건' : '＋ 메모';
      }
    } catch { /* 메모 입력은 건수 조회 오류에도 사용할 수 있다. */ }
  }

  function setPeriod(period) {
    const today = dateTime().slice(0, 10);
    const utcDay = new Date(today + 'T00:00:00Z');
    const offset = (utcDay.getUTCDay() + 6) % 7;
    const start = new Date(+utcDay - offset * 86_400_000).toISOString().slice(0, 10);
    filters.elements.from.value = period === 'today' ? today : period === 'week' ? start : today.slice(0, 7) + '-01';
    filters.elements.to.value = today;
    for (const el of filters.querySelectorAll('[data-memo-period]')) el.setAttribute('aria-pressed', String(el.dataset.memoPeriod === period));
  }

  function renderHospitalFilters() {
    const search = normalize(byId('field-records-hospital-search').value);
    const choices = new Map(knownGroups);
    for (const hospital of bridge.hospitals()) {
      if (!hospital.name || hospital.origin === 'flow') continue;
      choices.set(groupKey(hospital.name, hospital.region), hospital);
    }
    const items = [...choices].filter(([, hospital]) => normalize(hospitalName(hospital)).includes(search))
      .sort((a, b) => hospitalName(a[1]).localeCompare(hospitalName(b[1]), 'ko'));
    byId('field-records-hospital-options').innerHTML = items.map(([group, hospital]) =>
      '<label><input type="checkbox" value="' + escape(group) + '"' + (hospitalSelection.has(group) ? ' checked' : '') + '> ' + escape(hospitalName(hospital)) + '</label>').join('');
    byId('field-records-hospitals').querySelector('summary').textContent = hospitalSelection.size ? '병원 ' + hospitalSelection.size + '곳 선택' : '전체 병원';
  }

  function applyFilters() {
    if (!active() || !filters.reportValidity()) return;
    const fields = filters.elements;
    if (fields.from.value > fields.to.value) {
      filterStatus.textContent = '종료일을 시작일 이후로 선택하세요.';
      return;
    }
    activeFilters = {from:fields.from.value, to:fields.to.value, source:fields.source.value, impact:fields.impact.value, groups:[...hospitalSelection]};
    revision = '';
    resetTimelines();
    filterStatus.textContent = '현장 기록을 불러오는 중…';
    void refreshSummary(true);
  }

  function resetTimelines() {
    timelineObserver.disconnect();
    timelines.clear();
    directory.replaceChildren();
    empty.hidden = true;
    byId('field-records-expand').hidden = true;
    firstResult = true;
  }

  function makeTimeline(row) {
    const card = template.content.firstElementChild.cloneNode(true);
    const trigger = card.querySelector('.field-records-hospital-toggle');
    const section = card.querySelector('.field-records-timeline');
    const scroll = card.querySelector('.field-records-scroll');
    const entries = card.querySelector('.field-records-entries');
    const status = card.querySelector('.field-records-timeline-status');
    const refresh = card.querySelector('.field-records-refresh');
    const more = card.querySelector('.field-records-more');
    const hint = card.querySelector('.field-records-gesture');
    const timeline = {row, card, trigger, section, scroll, entries, status, refresh, more, hint,
      expanded:false, loaded:false, loading:false, revision:'', cursor:'', date:'', ids:new Set()};

    card.dataset.hospitalGroup = row.group;
    section.id = 'field-records-timeline-' + (++timelineId);
    trigger.setAttribute('aria-controls', section.id);
    card.querySelector('[data-hospital-name]').textContent = row.hospitalName;
    const region = card.querySelector('[data-hospital-region]');
    region.textContent = row.region;
    region.hidden = !row.region;
    scroll.setAttribute('aria-label', hospitalName(row) + ' 날짜별 기록');
    trigger.onclick = () => expandTimeline(timeline, !timeline.expanded);
    refresh.onclick = () => loadTimeline(timeline);
    more.onclick = () => loadTimeline(timeline, true);
    scroll.addEventListener('scroll', () => {
      if (scroll.scrollTop > 0 && timeline.cursor && scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 80) {
        void loadTimeline(timeline, true);
      }
    }, {passive:true});
    enableTimelineGestures(timeline);
    return timeline;
  }

  function expandTimeline(timeline, expand, defer = false) {
    timeline.expanded = expand;
    timeline.trigger.setAttribute('aria-expanded', String(expand));
    timeline.section.hidden = !expand;
    if (!expand) timelineObserver.unobserve(timeline.card);
    else if (!timeline.loaded && !timeline.loading) {
      if (defer) timelineObserver.observe(timeline.card);
      else void loadTimeline(timeline);
    }
  }

  function renderDirectory(groups) {
    const current = new Set(groups.map(row => row.group));
    for (const [id, timeline] of timelines) {
      if (current.has(id)) continue;
      timelineObserver.unobserve(timeline.card);
      timeline.card.remove();
      timelines.delete(id);
    }
    for (const row of groups) {
      knownGroups.set(row.group, row);
      if (timelines.has(row.group)) continue;
      const timeline = makeTimeline(row);
      timelines.set(row.group, timeline);
      directory.append(timeline.card);
    }
    empty.hidden = groups.length !== 0;
    byId('field-records-expand').hidden = groups.length === 0;
    if (firstResult && groups.length) expandTimeline(timelines.get(groups[0].group), true, true);
    firstResult = false;
    for (const timeline of timelines.values()) {
      timeline.refresh.hidden = !timeline.loaded || !timeline.revision || revision === timeline.revision;
    }
  }

  async function refreshSummary(force = false) {
    if (!visible() || !activeFilters || (summaryBusy && !force)) return;
    const seq = ++summarySeq;
    summaryBusy = true;
    try {
      const data = requireSuccess(await api.get('work_memo_summary', {...activeFilters, revision:force ? '' : revision}));
      if (seq !== summarySeq || !visible()) return;
      if (!data.nochange) {
        revision = data.revision;
        renderDirectory(data.groups || []);
      }
      filterStatus.textContent = '최근 갱신 ' + clock.format(new Date(data.updatedAt));
    } catch (err) {
      if (seq === summarySeq && visible()) filterStatus.textContent = err.message + (revision ? ' · 이전 조회 결과 표시 중' : '');
    } finally {
      if (seq === summarySeq) summaryBusy = false;
    }
  }

  function entryMarkup(memo, allowRequest, inTimeline = false) {
    const impacts = memo.impacts?.length ? memo.impacts : memo.impacts?.length === 0 ? ['none'] : [];
    const stamp = dateTime(new Date(memo.occurredAt));
    const time = inTimeline ? stamp.slice(11) : stamp.replace('T', ' ');
    return '<article class="field-memo-entry"><div class="field-memo-meta"><time datetime="' + escape(new Date(memo.occurredAt).toISOString()) + '">' + escape(time) +
      '</time><span>' + escape(memo.source === 'unclassified' ? '' : sourceLabels[memo.source]) + '</span><span>' + escape(memo.author) + '</span></div><p>' + escape(memo.body) +
      '</p>' + (impacts.length ? '<div class="field-memo-meta">' + impacts.map(id => '<span>' + escape(impactLabels[id]) + '</span>').join('') + '</div>' : '') +
      '<div class="field-memo-actions">' +
      (allowRequest && memo.requestId ? '<button type="button" data-field-open-request="' + escape(memo.requestId) + '">관련 접수</button>' : '') +
      (memo.canEdit ? '<button type="button" data-field-edit="' + escape(memo.id) + '">수정</button><button type="button" data-field-archive="' +
        escape(memo.id) + '">보관</button>' : '') + '</div></article>';
  }

  const entryRecords = new Map();
  function appendTimelineEntries(timeline, memos) {
    for (const memo of memos) {
      if (timeline.ids.has(memo.id)) continue;
      timeline.ids.add(memo.id);
      entryRecords.set(memo.id, memo);
      const date = dateTime(new Date(memo.occurredAt)).slice(0,10);
      if (date !== timeline.date) {
        const day = document.createElement('section');
        day.className = 'field-records-day';
        day.innerHTML = '<h3><time datetime="' + date + '">' + date + '</time></h3>';
        timeline.entries.append(day);
        timeline.date = date;
      }
      timeline.entries.lastElementChild.insertAdjacentHTML('beforeend', entryMarkup(memo, true, true));
    }
  }

  async function loadTimeline(timeline, nextPage = false) {
    if (!active() || timeline.loading || (nextPage && !timeline.cursor)) return;
    timelineObserver.unobserve(timeline.card);
    const applied = activeFilters;
    timeline.loading = true;
    timeline.status.textContent = '기록을 불러오는 중…';
    timeline.more.disabled = timeline.refresh.disabled = true;
    const current = () => active() && activeFilters === applied && timelines.get(timeline.row.group) === timeline;
    try {
      const data = requireSuccess(await api.get('work_memo_list', {
        ...applied, groups:[timeline.row.group], cursor:nextPage ? timeline.cursor : '',
      }));
      if (!current()) return;
      if (!nextPage) {
        timeline.entries.replaceChildren();
        timeline.ids.clear();
        timeline.date = '';
        timeline.scroll.scrollTop = 0;
        timeline.revision = data.revision;
      }
      appendTimelineEntries(timeline, data.memos);
      timeline.cursor = data.cursor;
      timeline.loaded = true;
      timeline.refresh.hidden = !revision || revision === timeline.revision;
      timeline.more.hidden = !timeline.cursor;
      timeline.hint.hidden = timeline.ids.size < 2 && !timeline.cursor;
      timeline.status.textContent = timeline.ids.size ? '' : '표시할 기록이 없습니다.';
    } catch (err) {
      if (current()) {
        timeline.status.textContent = err.message;
        if (!nextPage) timeline.refresh.hidden = false;
      }
    } finally {
      timeline.loading = false;
      timeline.more.disabled = timeline.refresh.disabled = false;
    }
  }

  async function moveToRecord(timeline, direction) {
    const {scroll, entries} = timeline;
    const records = Array.from(entries.querySelectorAll('.field-memo-entry'));
    if (!records.length) return;
    const top = scroll.getBoundingClientRect().top;
    const previous = records.findIndex(record => record.hasAttribute('data-memo-current'));
    let index = previous >= 0 && Math.abs(scroll.scrollTop - timeline.jumpTop) < 2
      ? previous : Math.max(0, records.findLastIndex(record => record.getBoundingClientRect().top <= top + 44));
    index += direction;
    if (index === records.length && timeline.cursor && !timeline.loading) {
      await loadTimeline(timeline, true);
      if (!timeline.expanded) return;
      records.push(...Array.from(entries.querySelectorAll('.field-memo-entry')).slice(records.length));
    }
    const record = records[index];
    if (!record) return;
    if (previous >= 0) records[previous].removeAttribute('data-memo-current');
    const dateLabelHeight = record.parentElement.firstElementChild.getBoundingClientRect().height;
    scroll.scrollTop += record.getBoundingClientRect().top - top - dateLabelHeight - 4;
    timeline.jumpTop = scroll.scrollTop;
    record.setAttribute('data-memo-current','');
  }

  function enableTimelineGestures(timeline) {
    const {scroll} = timeline;
    let start = null;
    scroll.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0 || event.target.closest('button,a,input,select,textarea')) return;
      start = {id:event.pointerId, x:event.clientX, y:event.clientY, top:scroll.scrollTop, axis:'',
        mouse:event.pointerType === 'mouse', text:event.target.closest('p,time,.field-memo-meta')};
    });
    scroll.addEventListener('pointermove', event => {
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (!start.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 14) {
        if (start.mouse && start.text) { start = null; return; }
        start.axis = Math.abs(dx) > Math.abs(dy) * 1.25 ? 'horizontal' : 'vertical';
        if (start.mouse) scroll.setPointerCapture(event.pointerId);
      }
      if (start?.axis && start.mouse) {
        event.preventDefault();
        if (start.axis === 'vertical') scroll.scrollTop = start.top - dy;
      }
    });
    scroll.addEventListener('pointerup', event => {
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (start.axis === 'horizontal' && Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.25) {
        void moveToRecord(timeline, dx < 0 ? 1 : -1);
      }
      start = null;
    });
    scroll.addEventListener('pointercancel', () => { start = null; });
    scroll.addEventListener('keydown', event => {
      if (event.target !== scroll || !['ArrowLeft','ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      void moveToRecord(timeline, event.key === 'ArrowLeft' ? 1 : -1);
    });
  }

  async function loadRecent(more = false) {
    const seq = ++recentSeq;
    const out = byId('field-memo-recent-entries');
    const status = byId('field-memo-recent-status');
    const next = byId('field-memo-recent-more');
    const cursor = more ? recentCursor : '';
    status.textContent = '메모를 불러오는 중…';
    next.disabled = true;
    if (!more) out.textContent = '';
    try {
      const data = requireSuccess(await api.get('work_memo_list', {requestId:noteContext.requestId, cursor}));
      if (seq !== recentSeq || !active()) return;
      for (const item of data.memos) entryRecords.set(item.id, item);
      out.insertAdjacentHTML('beforeend', data.memos.map(item => entryMarkup(item, false)).join(''));
      recentCursor = data.cursor;
      next.hidden = !recentCursor;
      status.textContent = out.childElementCount ? '' : '저장된 메모가 없습니다.';
    } catch (err) {
      if (seq === recentSeq && active()) status.textContent = err.message;
    } finally {
      if (seq === recentSeq) next.disabled = false;
    }
  }

  function renderHospitalSelect() {
    const current = form.elements.hospitalKey.value;
    const rows = root.BazWorkHospitalSearch.search(bridge.hospitals(), byId('field-memo-hospital-search').value);
    form.elements.hospitalKey.innerHTML = '<option value="">병원을 선택하세요</option>' + rows.map(h =>
      '<option value="' + escape(h.key) + '">' + escape([h.name,h.region,h.sn].filter(Boolean).join(' · ')) + '</option>').join('');
    if (rows.some(h => h.key === current)) form.elements.hospitalKey.value = current;
  }

  function openForm(context = {}, draft = {}) {
    if (!active()) return;
    ++recentSeq;
    noteContext = context;
    form.reset();
    error.textContent = draft.error || '';
    const choose = !context.requestId && !context.memo;
    byId('field-memo-hospital').hidden = !choose;
    form.elements.hospitalKey.required = choose;
    if (choose) {
      byId('field-memo-hospital-search').value = '';
      renderHospitalSelect();
      if (draft.hospitalKey) form.elements.hospitalKey.value = draft.hospitalKey;
    }
    byId('field-memo-title').textContent = context.memo ? '현장 메모 수정' : '현장 메모';
    byId('field-memo-context').textContent = context.name || '';
    form.elements.occurredAt.value = draft.occurredAt || dateTime();
    form.elements.body.value = draft.body || '';
    form.elements.source.value = draft.source === 'unclassified' ? '' : draft.source || '';
    for (const input of form.elements.impacts) input.checked = draft.impacts?.includes(input.value) || (input.value === 'none' && draft.impacts?.length === 0);
    const recent = byId('field-memo-recent');
    recent.hidden = !context.requestId || Boolean(context.memo);
    recentCursor = '';
    byId('field-memo-recent-more').hidden = true;
    if (!dialog.open) dialog.showModal();
    (choose ? byId('field-memo-hospital-search') : form.elements.body).focus();
    if (!recent.hidden) void loadRecent();
  }

  function announce(message, persistent = false) {
    clearTimeout(feedbackTimer);
    feedback.textContent = message;
    feedback.hidden = false;
    if (!persistent) feedbackTimer = setTimeout(() => { feedback.hidden = true; }, 4500);
  }

  function showPending() {
    const open = pendingElement.querySelector('details')?.open;
    pendingElement.innerHTML = pending.length ? '<details' + (open ? ' open' : '') + '><summary>전송 대기 ' + pending.length + '건</summary>' +
      '<button type="button" id="field-memo-retry">다시 전송</button>' + pending.map(item =>
        '<article><p>' + escape(item.error || '서버 저장 확인 대기 중') + '</p><p>' + escape(item.payload.body || '메모 보관') + '</p>' +
        (item.error && item.action === 'work_memo_save' ? '<button type="button" data-field-draft="' + escape(item.payload.operationId) + '">내용 확인</button>' : '') +
        '</article>').join('') + '</details>' : '';
  }

  async function send(item) {
    return api.post(item.action, item.payload);
  }

  async function refreshAfterWrite(groups) {
    void hydrate();
    if (!visible()) return;
    await refreshSummary(true);
    for (const group of groups) {
      const timeline = timelines.get(group);
      if (timeline?.expanded && timeline.scroll.scrollTop < 24) void loadTimeline(timeline);
    }
  }

  async function flushQueue(manual = false) {
    if (!active()) return;
    if (queueBusy) { queueRequested = true; return; }
    const account = owner;
    queueBusy = true;
    let sent = 0;
    const savedGroups = new Set();
    try {
      const items = await cache.memoPending(account);
      if (!active() || owner !== account) return;
      pending = items;
      showPending();
      for (const item of items) {
        if (!active() || owner !== account) return;
        if (item.error && !manual) continue;
        let data;
        try { data = await send(item); } catch { break; }
        if (data.success) {
          await cache.saveMemoPending(account, item.payload.operationId, null);
          if (data.memo?.group) savedGroups.add(data.memo.group);
          sent++;
        } else if (!data.retrySameOperation) {
          item.error = data.error || '서버에서 메모를 저장하지 못했습니다.';
          item.current = data.current || null;
          await cache.saveMemoPending(account, item.payload.operationId, item);
        }
      }
      const remaining = await cache.memoPending(account);
      if (!active() || owner !== account) return;
      pending = remaining;
      showPending();
      if (sent) void refreshAfterWrite(savedGroups);
      if (pending.length) announce('현장 메모 전송 대기 ' + pending.length + '건 · 현장 기록 탭에서 확인', true);
      else if (sent) announce('현장 메모 서버 저장 완료');
    } catch {
      if (sent && active() && owner === account) announce('서버에 저장했습니다. 기기 내 전송 상태를 다시 확인하세요.', true);
    } finally {
      queueBusy = false;
      if (queueRequested) {
        queueRequested = false;
        void flushQueue();
      }
    }
  }

  async function enqueue(item, recoveryId = '') {
    const account = owner;
    await cache.saveMemoPending(account, item.payload.operationId, item);
    if (recoveryId && recoveryId !== item.payload.operationId) await cache.saveMemoPending(account, recoveryId, null);
  }

  form.onsubmit = async event => {
    event.preventDefault();
    if (!active() || submitBusy) return;
    const fields = form.elements;
    const checked = [...fields.impacts].filter(input => input.checked).map(input => input.value);
    const body = fields.body.value.trim();
    if (!body) { error.textContent = '메모를 한 줄 이상 입력하세요.'; return; }
    const memo = noteContext.memo;
    const candidate = {requestId:noteContext.requestId || '', hospitalKey:fields.hospitalKey.value, body,
      occurredAt:fields.occurredAt.value, source:fields.source.value, impacts:checked.includes('none') ? [] : checked.length ? checked : null};
    const sameDraft = noteContext.retry && Object.keys(candidate).every(key => JSON.stringify(candidate[key]) === JSON.stringify(noteContext.retry[key]));
    const payload = {...candidate, id:memo?.id || noteContext.retry?.id || api.id(), baseRevision:memo?.revision || 0,
      operationId:sameDraft ? noteContext.retry.operationId : api.id()};
    const item = {action:'work_memo_save', payload, name:noteContext.name || ''};
    noteContext.retry = payload;
    submitBusy = true;
    byId('field-memo-save').disabled = true;
    const account = owner;
    try {
      try {
        await enqueue(item, noteContext.recoveryId);
        if (active() && owner === account) announce('기기에 저장했습니다. 서버로 전송하는 중…', true);
      } catch {
        const data = requireSuccess(await send(item));
        if (data.success && active() && owner === account) {
          announce('현장 메모 서버 저장 완료');
          void refreshAfterWrite([data.memo?.group]);
        }
      }
      if (active() && owner === account && dialog.open) dialog.close();
      void flushQueue();
    } catch (err) {
      if (active() && owner === account) error.textContent = err.message || '저장 결과를 확인하지 못했습니다. 다시 저장하세요.';
    } finally {
      submitBusy = false;
      byId('field-memo-save').disabled = false;
    }
  };

  async function archive(id) {
    const memo = entryRecords.get(id), account = owner;
    if (!memo?.canEdit || !root.confirm('이 메모를 보관할까요? 병원 기록에서 숨겨집니다.')) return;
    try {
      await enqueue({action:'work_memo_archive', payload:{id, baseRevision:memo.revision, operationId:api.id()}});
      await flushQueue();
      if (active() && owner === account) {
        if (dialog.open && !byId('field-memo-recent').hidden) void loadRecent();
      }
    } catch (err) { if (active() && owner === account) announce(err.message); }
  }

  filters.onsubmit = event => { event.preventDefault(); applyFilters(); };
  filters.onchange = event => {
    if (['from','to'].includes(event.target.name)) {
      for (const button of filters.querySelectorAll('[data-memo-period]')) button.setAttribute('aria-pressed','false');
    } else if (['source','impact'].includes(event.target.name)) applyFilters();
  };
  for (const el of filters.querySelectorAll('[data-memo-period]')) {
    el.onclick = () => { setPeriod(el.dataset.memoPeriod); applyFilters(); };
  }
  byId('field-records-open-all').onclick = () => {
    for (const timeline of timelines.values()) expandTimeline(timeline, true, true);
  };
  byId('field-records-close-all').onclick = () => {
    for (const timeline of timelines.values()) expandTimeline(timeline, false);
  };
  byId('field-records-hospitals').addEventListener('toggle', event => { if (event.target.open && active()) renderHospitalFilters(); });
  byId('field-records-hospital-search').oninput = renderHospitalFilters;
  byId('field-records-hospital-clear').onclick = () => { hospitalSelection.clear(); renderHospitalFilters(); };
  byId('field-records-hospital-options').onchange = event => {
    const input = event.target;
    if (input.checked && hospitalSelection.size >= 100) { input.checked = false; return; }
    if (input.checked) hospitalSelection.add(input.value);
    else hospitalSelection.delete(input.value);
    byId('field-records-hospitals').querySelector('summary').textContent = hospitalSelection.size ? '병원 ' + hospitalSelection.size + '곳 선택' : '전체 병원';
  };
  byId('field-memo-hospital-search').oninput = renderHospitalSelect;
  byId('field-memo-new').onclick = () => openForm();
  byId('field-memo-close').onclick = () => { if (!submitBusy) dialog.close(); };
  dialog.addEventListener('cancel', event => { if (submitBusy) event.preventDefault(); });
  dialog.addEventListener('close', () => { recentSeq++; });
  byId('field-memo-recent-more').onclick = () => loadRecent(true);
  root.addEventListener('baz-work-tab', event => {
    if (event.detail.name !== 'field-records' || !active()) return;
    if (!activeFilters) applyFilters();
    else void refreshSummary();
    void flushQueue();
  });
  root.addEventListener('online', () => { void flushQueue(); void refreshSummary(); });
  document.addEventListener('visibilitychange', () => {
    if (!visible()) return;
    void refreshSummary();
    for (const timeline of timelines.values()) {
      if (timeline.expanded && !timeline.loaded && !timeline.loading) timelineObserver.observe(timeline.card);
    }
  });
  root.addEventListener('baz-auth-logout', disable);
  setInterval(() => {
    if (visible()) void refreshSummary();
    if (active() && !document.hidden && pending.some(item => !item.error)) void flushQueue();
  }, 10000);

  document.addEventListener('click', event => {
    if (!active()) return;
    const button = event.target.closest('button');
    if (!button) return;
    const data = button.dataset;
    if (data.fieldRequest) openForm({requestId:data.fieldRequest, name:data.fieldHospital});
    if (data.fieldOpenRequest) {
      root.BazWorkTabs.show('service');
      bridge.openRequest(data.fieldOpenRequest);
    }
    if (data.fieldEdit) {
      const memo = entryRecords.get(data.fieldEdit);
      if (memo) openForm({memo, requestId:memo.requestId, name:hospitalName(memo)}, {...memo, occurredAt:dateTime(new Date(memo.occurredAt))});
    }
    if (data.fieldArchive) void archive(data.fieldArchive);
    if (data.fieldDraft) {
      const item = pending.find(entry => entry.payload.operationId === data.fieldDraft);
      if (item) {
        const note = item.current || (item.payload.baseRevision ? {id:item.payload.id, revision:item.payload.baseRevision} : null);
        const latest = item.current ? ' · 최신 메모 ' + item.current.body : '';
        openForm({memo:note, requestId:item.payload.requestId, name:item.name, recoveryId:item.payload.operationId}, {...item.payload, error:item.error + latest});
      }
    }
    if (button.id === 'field-memo-retry') void flushQueue(true);
  });
  root.BazWorkMemos = {configure, enabled:active, button, hydrate};
})(window);
