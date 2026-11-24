(function (root) {
  'use strict';
  const byId = id => document.getElementById(id);
  const api = root.BazWorkAPI, cache = root.BazWorkCache;
  const panel = byId('field-records-panel'), dialog = byId('field-memo-dialog');
  const filters = byId('field-records-filters'), form = byId('field-memo-form');
  const summary = byId('field-records-summary'), detail = byId('field-records-detail');
  const pendingElement = byId('field-records-pending');
  const filterStatus = byId('field-records-status'), detailStatus = byId('field-records-detail-status');
  const error = byId('field-memo-error'), feedback = byId('field-memo-feedback');
  const sourceLabels = { sales: '영업팀', hospital: '병원', cs: 'CS 내부', other: '기타', unclassified: '미분류' };
  const impactLabels = { schedule: '일정 변경', extra_visit: '추가 방문', after_hours: '업무시간 외 대응', cost: '추가 비용', none: '영향 없음', unset: '미입력' };
  const columns = ['schedule', 'extra_visit', 'after_hours', 'cost'];
  const zoned = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'});
  const clock = new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul', hour:'2-digit', minute:'2-digit'});
  const counts = new Map(), hospitalSelection = new Set();
  let bridge, owner = '', registered = false, noteContext, queueBusy = false, queueRequested = false, feedbackTimer, pending = [];
  let groups = [], knownGroups = new Map(), selection = null, activeFilters, revision = '', summarySeq = 0, summaryBusy = false;
  let detailSeq = 0, detailCursor = '', detailRevision = '', recentSeq = 0, recentCursor = '';
  let visibleIds = [], countSeq = 0, submitBusy = false;
  let layout = root.matchMedia('(max-width: 720px)').matches ? 'vertical' : 'horizontal';
  try { layout = localStorage.getItem('baz-field-records-layout') || layout; } catch {}

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
    setLayout(layout);
    root.BazWorkTabs.register('field-records', byId('field-records-tab'), panel);
    void flushQueue();
  }

  function disable() {
    if (!registered) return;
    if (!panel.hidden) root.BazWorkTabs.show('service');
    root.BazWorkTabs.unregister('field-records');
    registered = false;
    owner = '';
    summarySeq++; detailSeq++; recentSeq++; countSeq++;
    activeFilters = undefined; revision = ''; selection = null;
    groups = []; knownGroups.clear(); hospitalSelection.clear(); counts.clear(); visibleIds = []; pending = [];
    for (const element of [summary, pendingElement, filterStatus, feedback, byId('field-records-total'), byId('field-records-entries'), byId('field-memo-recent-entries')]) element.textContent = '';
    feedback.hidden = detail.hidden = true;
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
    selection = null;
    detailSeq++;
    groups = [];
    renderSummary();
    byId('field-records-total').textContent = '';
    filterStatus.textContent = '현장 기록을 불러오는 중…';
    void refreshSummary(true);
  }

  function setLayout(next) {
    layout = next === 'vertical' ? 'vertical' : 'horizontal';
    byId('field-records-grid').dataset.layout = layout;
    for (const el of panel.querySelectorAll('[data-memo-layout]')) el.setAttribute('aria-pressed', String(el.dataset.memoLayout === layout));
    renderSummary();
  }

  function countButton(row, column, label) {
    const count = column ? row.impacts[column] || 0 : row.total;
    const selected = selection?.group === row.group && selection.impact === column;
    return count ? '<button type="button" data-memo-group="' + escape(row.group) + '" data-memo-impact="' + column +
      '" aria-pressed="' + Boolean(selected) + '" aria-label="' + escape(hospitalName(row) + ' ' + label + ' ' + count + '건') + '">' + count + '건</button>' : '<span>0건</span>';
  }

  function renderSummary() {
    const focus = document.activeElement?.dataset;
    const focusedGroup = focus?.memoGroup, focusedImpact = focus?.memoImpact;
    const grid = byId('field-records-grid');
    const restoreDetailFocus = detail.contains(document.activeElement);
    if (detail.parentNode !== grid) grid.append(detail);
    detail.hidden = !selection;
    if (!groups.length) {
      summary.textContent = activeFilters && revision ? '조건에 맞는 현장 기록이 없습니다.' : '';
      return;
    }
    const cards = layout === 'vertical';
    if (cards) {
      summary.innerHTML = groups.map(row => '<article class="field-records-hospital-card"><div><h3>' + escape(hospitalName(row)) +
        '</h3>' + countButton(row, '', '전체') + '</div><div class="field-records-impact-row">' + columns.map(column =>
          '<span>' + impactLabels[column] + ' ' + countButton(row, column, impactLabels[column]) + '</span>').join('') + '</div></article>').join('');
      const index = groups.findIndex(row => row.group === selection?.group);
      if (index >= 0) summary.children[index].append(detail);
    } else {
      summary.innerHTML = '<div class="field-records-table"><table><thead><tr><th scope="col">병원</th><th scope="col">전체</th>' +
        columns.map(column => '<th scope="col">' + impactLabels[column] + '</th>').join('') + '</tr></thead><tbody>' +
        groups.map(row => '<tr><th scope="row">' + escape(hospitalName(row)) + '</th><td>' + countButton(row, '', '전체') + '</td>' +
          columns.map(column => '<td>' + countButton(row, column, impactLabels[column]) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
    }
    if (focusedGroup !== undefined) {
      [...summary.querySelectorAll('[data-memo-group]')].find(el => el.dataset.memoGroup === focusedGroup && el.dataset.memoImpact === focusedImpact)?.focus({preventScroll:true});
    } else if (restoreDetailFocus && !detail.contains(document.activeElement)) byId('field-records-detail-title').focus({preventScroll:true});
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
        groups = (data.groups || []).sort((a, b) => b.total - a.total || hospitalName(a).localeCompare(hospitalName(b), 'ko'));
        for (const group of groups) knownGroups.set(group.group, group);
        byId('field-records-total').textContent = '전체 ' + data.total + '건 · ' + groups.length + '개 병원';
        renderSummary();
      }
      filterStatus.textContent = '최근 갱신 ' + clock.format(new Date(data.updatedAt));
      byId('field-records-changed').hidden = !selection || !detailRevision || revision === detailRevision;
    } catch (err) {
      if (seq === summarySeq && visible()) filterStatus.textContent = err.message + (revision ? ' · 이전 조회 결과 표시 중' : '');
    } finally {
      if (seq === summarySeq) summaryBusy = false;
    }
  }

  function entryMarkup(memo, allowRequest) {
    const impacts = memo.impacts === null ? ['unset'] : memo.impacts.length ? memo.impacts : ['none'];
    return '<article class="field-memo-entry"><div class="field-memo-meta"><time>' + escape(dateTime(new Date(memo.occurredAt)).replace('T', ' ')) +
      '</time><span>' + escape(sourceLabels[memo.source]) + '</span><span>' + escape(memo.author) + '</span></div><p>' + escape(memo.body) +
      '</p><div class="field-memo-meta">' + impacts.map(id => '<span>' + escape(impactLabels[id]) + '</span>').join('') + '</div><div class="field-memo-actions">' +
      (allowRequest && memo.requestId ? '<button type="button" data-field-open-request="' + escape(memo.requestId) + '">관련 접수</button>' : '') +
      (memo.canEdit ? '<button type="button" data-field-edit="' + escape(memo.id) + '">수정</button><button type="button" data-field-archive="' +
        escape(memo.id) + '">보관</button>' : '') + '</div></article>';
  }

  const entryRecords = new Map();
  async function loadEntries(context, more = false) {
    const recent = context === 'recent';
    const seq = recent ? ++recentSeq : ++detailSeq;
    const out = byId(recent ? 'field-memo-recent-entries' : 'field-records-entries');
    const status = recent ? byId('field-memo-recent-status') : detailStatus;
    const next = byId(recent ? 'field-memo-recent-more' : 'field-records-more');
    const cursor = more ? (recent ? recentCursor : detailCursor) : '';
    if (!recent && !selection) return;
    const params = recent ? {requestId:noteContext.requestId, cursor} :
      {...activeFilters, groups:[selection.group], impact:selection.impact || activeFilters.impact, cursor};
    status.textContent = '메모를 불러오는 중…';
    next.disabled = true;
    if (!more) out.textContent = '';
    try {
      const data = requireSuccess(await api.get('work_memo_list', params));
      if (seq !== (recent ? recentSeq : detailSeq) || !active()) return;
      for (const item of data.memos) entryRecords.set(item.id, item);
      out.insertAdjacentHTML('beforeend', data.memos.map(item => entryMarkup(item, !recent)).join(''));
      next.hidden = !data.cursor;
      status.textContent = out.childElementCount ? '' : '저장된 메모가 없습니다.';
      if (recent) recentCursor = data.cursor;
      else {
        detailCursor = data.cursor;
        detailRevision = data.revision;
        byId('field-records-changed').hidden = !revision || revision === detailRevision;
      }
    } catch (err) {
      if (seq === (recent ? recentSeq : detailSeq) && active()) status.textContent = err.message;
    } finally {
      if (seq === (recent ? recentSeq : detailSeq)) next.disabled = false;
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
    if (!recent.hidden) void loadEntries('recent');
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

  async function flushQueue(manual = false) {
    if (!active()) return;
    if (queueBusy) { queueRequested = true; return; }
    const account = owner;
    queueBusy = true;
    let sent = 0;
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
      if (sent) {
        void hydrate();
        if (visible()) void refreshSummary(true);
      }
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
          void hydrate(); void refreshSummary(true);
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
    if (!memo?.canEdit || !root.confirm('이 메모를 보관할까요? 현황판 집계에서 제외됩니다.')) return;
    try {
      await enqueue({action:'work_memo_archive', payload:{id, baseRevision:memo.revision, operationId:api.id()}});
      await flushQueue();
      if (active() && owner === account) {
        if (dialog.open && !byId('field-memo-recent').hidden) void loadEntries('recent');
        if (visible() && selection) void loadEntries('detail');
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
  for (const el of panel.querySelectorAll('[data-memo-layout]')) {
    el.onclick = () => {
      setLayout(el.dataset.memoLayout);
      try { localStorage.setItem('baz-field-records-layout', layout); } catch {}
    };
  }
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
  byId('field-records-more').onclick = () => loadEntries('detail', true);
  byId('field-records-changed').onclick = () => loadEntries('detail');
  byId('field-memo-recent-more').onclick = () => loadEntries('recent', true);
  root.addEventListener('baz-work-tab', event => {
    if (event.detail.name !== 'field-records' || !active()) return;
    if (!activeFilters) applyFilters();
    else void refreshSummary();
    void flushQueue();
  });
  root.addEventListener('online', () => { void flushQueue(); void refreshSummary(); });
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
    if (data.memoGroup) {
      const row = groups.find(item => item.group === data.memoGroup);
      if (!row) return;
      if (selection?.group === row.group && selection.impact === data.memoImpact) {
        selection = null; detailSeq++; renderSummary(); return;
      }
      selection = {group:row.group, impact:data.memoImpact};
      detailRevision = '';
      byId('field-records-changed').hidden = byId('field-records-more').hidden = true;
      byId('field-records-detail-title').textContent = hospitalName(row) + (data.memoImpact ? ' · ' + impactLabels[data.memoImpact] : '');
      renderSummary();
      if (!detail.hidden) byId('field-records-detail-title').focus({preventScroll:true});
      void loadEntries('detail');
    }
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
