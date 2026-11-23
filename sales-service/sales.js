(() => {
  'use strict';

  const apiUrl = 'https://yuyoung-production.coaptation.workers.dev';
  const storageKey = 'baz_sales_service_session';
  const el = id => document.getElementById(id);
  const state = {token: '', cursor: '', rows: new Map(), pages: 0, busy: false, scope: 'mine', criteria: ''};
  const clock = new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit'});
  let googleScript, noticeRecipient = '', noticeOperation = '', registrationTask, searchTimer, detailTrigger;
  let composing = false, detailRequest = 0;

  function feedback(message, error = false) {
    el('feedback').textContent = message;
    el('feedback').toggleAttribute('data-error', error);
  }

  async function api(action, args = {}) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch(apiUrl, {
        method: 'POST', cache: 'no-store', signal: abort.signal,
        headers: {'Content-Type': 'text/plain;charset=utf-8'},
        body: JSON.stringify({...args, action, token: state.token}),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw Object.assign(new Error(data.error || '서비스 현황을 불러오지 못했습니다.'), {status: response.status});
      }
      return data;
    } catch (error) {
      if (error.status) throw error;
      throw new Error('연결을 확인한 뒤 다시 시도해 주세요.');
    } finally {
      clearTimeout(timer);
    }
  }

  const security = window.BazSalesSecurity(api);

  function setSession(data, remember = false) {
    state.token = data?.token || '';
    for (const storage of [sessionStorage, localStorage]) {
      try { storage.removeItem(storageKey); } catch {}
    }
    if (data) {
      try { (remember ? localStorage : sessionStorage).setItem(storageKey, JSON.stringify(data)); } catch {}
    }
  }

  function restoreSession() {
    for (const storage of [sessionStorage, localStorage]) {
      try {
        const saved = JSON.parse(storage.getItem(storageKey));
        if (saved?.expiresAt > Date.now() && saved.token) return saved.token;
      } catch {}
    }
    return '';
  }

  function googleReady() {
    if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
    if (!googleScript) googleScript = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => {
        if (window.google?.accounts?.id) resolve(window.google.accounts.id);
        else reject(new Error('Google 로그인 버튼을 불러오지 못했습니다.'));
      };
      script.onerror = () => reject(new Error('Google 로그인 연결을 확인해 주세요.'));
      document.head.append(script);
    }).catch(error => { googleScript = null; throw error; });
    return googleScript;
  }

  async function signIn() {
    security.setLevel(0);
    for (const id of ['notice-dialog', 'inbox-dialog', 'detail-dialog']) if (el(id).open) el(id).close();
    el('workspace').hidden = true;
    el('sync').hidden = true;
    el('list').replaceChildren();
    el('table-list').replaceChildren();
    state.rows.clear();
    state.cursor = '';
    state.pages = 0;
    state.criteria = '';
    state.scope = 'mine';
    el('search').value = '';
    renderScope();
    el('sync-time').textContent = '';
    el('sign-in').hidden = false;
    if (el('google-sign-in').childElementCount) return;
    el('retry-login').hidden = true;
    try {
      const [config, google] = await Promise.all([api('sales_config'), googleReady()]);
      google.initialize({client_id: config.googleClientId, callback: acceptGoogle});
      google.renderButton(el('google-sign-in'), {theme: 'outline', size: 'large', width: 224, locale: 'ko'});
    } catch (error) {
      feedback(error.message, true);
      el('retry-login').hidden = false;
    }
  }

  async function acceptGoogle(response) {
    if (state.busy || state.token) return;
    state.busy = true;
    feedback('Google 계정을 확인하고 있습니다…');
    try {
      const remember = el('remember').checked;
      const data = await api('sales_google_login', {idToken: response.credential, remember});
      setSession({token: data.token, expiresAt: data.expiresAt}, remember);
    } catch (error) {
      feedback(error.message, true);
    } finally {
      state.busy = false;
    }
    if (state.token) await sync();
  }

  function renderCard(row, template = 'service-card') {
    const card = el(template).content.firstElementChild.cloneNode(true);
    card.dataset.requestId = row.id;
    const values = {
      ...row,
      symptom: row.symptom || '접수 증상 미기록',
      visitAt: row.visitPending ? '접수 확인 중' : row.visitAt ? row.visitAt.slice(0, 16).replace('T', ' ') : '미정',
      engineer: row.engineer || '미배정', cs: row.cs || '미기록', sales: row.sales || '미배정',
    };
    for (const field of card.querySelectorAll('[data-card]')) field.textContent = values[field.dataset.card];
    card.querySelector('[data-card=status]').dataset.workStatus = row.status;
    card.querySelector('[data-card=payment]').dataset.serviceType = row.payment;
    return card;
  }

  const searchText = () => el('search').value.trim();
  const lookupScope = () => searchText() ? 'all' : state.scope;
  const scopeLabel = () => lookupScope() === 'mine' ? '내 업무' : '전체 업무';
  const criteria = () => JSON.stringify([lookupScope(), searchText()]);
  function renderScope() {
    el('scope-title').textContent = scopeLabel();
    for (const button of document.querySelectorAll('[data-scope]')) {
      button.setAttribute('aria-pressed', String(button.dataset.scope === lookupScope()));
    }
  }

  async function sync(append = false) {
    if (!state.token || state.busy) return;
    state.busy = true;
    const key = criteria(), query = searchText(), scope = lookupScope();
    const same = key === state.criteria;
    append = append && same;
    el('sync').disabled = el('load-more').disabled = true;
    el('list-count').textContent = query ? '검색 중…' : '불러오는 중…';
    feedback('');
    const container = matchMedia('(max-width: 700px)').matches ? el('list') : el('table-list');
    const anchor = append || !same ? null : [...container.children].find(card => card.getBoundingClientRect().bottom > 0);
    const anchorTop = anchor?.getBoundingClientRect().top;
    const rows = append ? new Map(state.rows) : new Map();
    let cursor = append ? state.cursor : '', data, pages = 0;
    const expected = append || !same ? 1 : Math.max(1, state.pages);
    try {
      do {
        data = await api('sales_list', {cursor, query, scope});
        if (key !== criteria()) return;
        for (const row of data.items) rows.set(row.id, row);
        if (cursor && cursor === data.cursor) throw new Error('동기화로 목록을 다시 불러와 주세요.');
        cursor = data.cursor;
        pages++;
      } while (cursor && (query || scope === 'mine' || pages < expected || (!rows.size || append && rows.size === state.rows.size)));

      state.rows = rows;
      state.cursor = cursor;
      state.pages = append ? state.pages + pages : pages;
      state.criteria = key;
      el('list').replaceChildren(...Array.from(rows.values(), row => renderCard(row)));
      el('table-list').replaceChildren(...Array.from(rows.values(), row => renderCard(row, 'service-row')));
      el('desktop-list').hidden = !rows.size;
      el('list-count').textContent = `${rows.size.toLocaleString('ko-KR')}건${cursor ? ' 표시' : ''}`;
      el('list-conditions').textContent = [scopeLabel(), '방문일 기준 전체 기간', '방문 일시 내림차순', query ? `검색 “${query}”` : ''].filter(Boolean).join(' · ');
      el('empty').hidden = rows.size > 0 || Boolean(cursor);
      el('empty').textContent = query ? '검색 결과가 없습니다.' : scope === 'mine' ? '내 업무에 배정된 접수가 없습니다. 전체 업무에서 조회할 수 있습니다.' : '조회할 처리 내역이 없습니다.';
      el('load-more').hidden = !cursor;
      el('account').textContent = data.name || '영업 계정';
      el('sync-time').textContent = '마지막 동기화 ' + clock.format(new Date(data.updatedAt));
      el('sign-in').hidden = true;
      el('workspace').hidden = false;
      el('sync').hidden = false;
      el('notice-tools').hidden = !data.notifications;
      el('notice-open').hidden = !data.canSend || !rows.size;
      security.setLevel(data.level);
      const replacement = anchor && [...container.children].find(card => card.dataset.requestId === anchor.dataset.requestId);
      if (replacement) window.scrollBy(0, replacement.getBoundingClientRect().top - anchorTop);
      feedback('');
      if (data.notifications && new URLSearchParams(location.search).has('notices')) {
        history.replaceState(null, '', location.pathname);
        void openInbox();
      }
    } catch (error) {
      el('list-count').textContent = state.rows.size ? `${state.rows.size.toLocaleString('ko-KR')}건 표시` : '';
      if ([401, 403].includes(error.status)) {
        setSession(null);
        await signIn();
      } else {
        el('sync').hidden = false;
      }
      feedback(error.message, true);
    } finally {
      el('sync').disabled = el('load-more').disabled = false;
      state.busy = false;
      if (state.token && key !== criteria() && !composing) void sync();
    }
  }

  async function openDetail(button) {
    const requestId = button.closest('[data-request-id]').dataset.requestId;
    const dialog = el('detail-dialog');
    if (dialog.open) return;
    const sequence = ++detailRequest;
    detailTrigger = button;
    el('detail-feedback').textContent = '접수 상세를 불러오는 중…';
    el('detail-content').hidden = true;
    dialog.showModal();
    dialog.scrollTop = 0;
    history.pushState({salesDetail: true}, '');
    try {
      const data = await api('sales_detail', {requestId});
      if (!dialog.open || sequence !== detailRequest) return;
      const summary = renderCard(data.request);
      summary.querySelector('.sales-case-open').replaceWith(document.createTextNode(data.request.hospital));
      el('detail-summary').replaceChildren(summary);
      el('detail-receipt').textContent = data.receipt || '접수 내용 미기록';
      const results = data.results.map(result => {
        const block = document.createElement('article');
        block.className = 'sales-result';
        const facts = document.createElement('dl');
        for (const [name, value] of [['처리일', result.date], ['실제 처리자', result.engineer], ['처리 내용', result.detail], ['처리 결과', result.result]]) {
          if (!value) continue;
          const label = document.createElement('dt'), text = document.createElement('dd');
          label.textContent = name;
          text.textContent = value;
          facts.append(label, text);
        }
        block.append(facts);
        return block;
      });
      el('detail-results').replaceChildren(...results);
      if (data.resultPending || !results.length) {
        const message = document.createElement('p');
        message.className = 'sales-muted';
        message.textContent = data.resultPending ? 'CS 결과 확인 중' : '등록된 처리 결과가 없습니다.';
        el('detail-results').append(message);
      }
      el('detail-content').hidden = false;
      el('detail-feedback').textContent = '';
    } catch (error) {
      if (sequence === detailRequest && dialog.open) el('detail-feedback').textContent = error.message;
    }
  }

  function closeDetail() {
    if (history.state?.salesDetail) history.back();
    else el('detail-dialog').close();
  }

  async function signOut() {
    if (state.busy) return;
    state.busy = true;
    try {
      const reg = await navigator.serviceWorker?.getRegistration(location.href);
      const scoped = reg?.scope === new URL('./', location.href).href ? reg : null;
      const subscription = await scoped?.pushManager.getSubscription();
      if (scoped?.active) await bindDevice(scoped.active, '').catch(() => {});
      if (subscription) await subscription.unsubscribe().catch(() => {});
      await api('sales_logout', {endpoint: subscription?.endpoint});
    } catch {}
    finally {
      setSession(null);
      state.busy = false;
      await signIn();
      feedback('');
    }
  }

  async function openInbox() {
    const panel = el('inbox-dialog');
    el('inbox-items').replaceChildren();
    el('inbox-feedback').textContent = '알림을 불러오는 중…';
    if (!panel.open) panel.showModal();
    try {
      const data = await api('sales_inbox');
      for (const entry of data.items) {
        const item = document.createElement('li'), title = document.createElement('strong'), text = document.createElement('p');
        title.textContent = [entry.hospital, entry.headline].filter(Boolean).join(' · ');
        text.textContent = entry.message;
        const meta = document.createElement('span');
        meta.className = 'sales-muted';
        meta.textContent = [entry.from, new Date(entry.at).toLocaleString('ko-KR', {timeZone: 'Asia/Seoul'})].filter(Boolean).join(' · ');
        item.append(title, text, meta);
        el('inbox-items').append(item);
      }
      el('inbox-feedback').textContent = data.items.length ? '' : '받은 알림이 없습니다.';
    } catch (error) { el('inbox-feedback').textContent = error.message; }
  }

  async function selectRecipient() {
    noticeRecipient = '';
    noticeOperation = '';
    el('notice-send').disabled = true;
    el('notice-feedback').textContent = '';
    const requestId = el('notice-request').value;
    el('notice-recipient').textContent = requestId ? '수신자를 확인하고 있습니다…' : '';
    if (!requestId) return;
    try {
      const data = await api('sales_notice_target', {requestId});
      if (el('notice-request').value !== requestId) return;
      noticeRecipient = data.recipient;
      el('notice-recipient').textContent = '수신자 ' + data.name + (data.connected ? '' : ' · 기기 알림 미연결');
      el('notice-send').disabled = false;
    } catch (error) { if (el('notice-request').value === requestId) el('notice-recipient').textContent = error.message; }
  }

  function openComposer() {
    const select = el('notice-request');
    select.replaceChildren(new Option('접수를 선택해 주세요', ''));
    for (const row of state.rows.values()) {
      select.add(new Option([row.hospital, row.symptom].filter(Boolean).join(' · '), row.id));
    }
    el('notice-message').value = '';
    void selectRecipient();
    el('notice-dialog').showModal();
  }

  async function sendNotice(event) {
    event.preventDefault();
    if (!noticeRecipient || el('notice-send').disabled) return;
    if (!noticeOperation) noticeOperation = crypto.randomUUID();
    const args = {requestId: el('notice-request').value, recipient: noticeRecipient, operationId: noticeOperation, message: el('notice-message').value};
    const controls = [el('notice-request'), el('notice-message'), el('notice-send')];
    controls.forEach(control => { control.disabled = true; });
    try {
      await api('sales_notice_send', args);
      el('notice-message').value = '';
      noticeOperation = '';
      el('notice-feedback').textContent = '알림 전송을 접수했습니다.';
    } catch (error) {
      if (error.status === 409) await selectRecipient();
      el('notice-feedback').textContent = error.message;
    } finally {
      controls.slice(0, 2).forEach(control => { control.disabled = false; });
      el('notice-send').disabled = !noticeRecipient;
    }
  }

  async function enablePush() {
    if (!window.Notification || !window.PushManager || !navigator.serviceWorker) {
      feedback('아이폰에서는 홈 화면에 추가한 영업 앱을 열어 알림을 연결해 주세요.', true);
      return;
    }
    el('push-enable').disabled = true;
    try {
      if (await Notification.requestPermission() !== 'granted') throw new Error('아이폰 설정에서 알림을 허용해 주세요.');
      if (!registrationTask) registrationTask = navigator.serviceWorker.register('sw.js').catch(error => { registrationTask = null; throw error; });
      const reg = await registrationTask;
      const active = await waitForWorker(reg);
      const cfg = await api('sales_push_config');
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const text = cfg.publicKey.replace(/-/g, '+').replace(/_/g, '/');
        const applicationServerKey = Uint8Array.from(atob(text.padEnd(Math.ceil(text.length / 4) * 4, '=')), char => char.charCodeAt(0));
        sub = await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey});
      }
      await api('sales_push_subscribe', {subscription: sub.toJSON()});
      await bindDevice(active, cfg.binding);
      feedback('이 기기에 영업 알림을 연결했습니다.');
    } catch (error) { feedback(error.message, true); }
    finally { el('push-enable').disabled = false; }
  }

  function waitForWorker(registration) {
    if (registration.active?.state === 'activated') return Promise.resolve(registration.active);
    return new Promise((resolve, reject) => {
      const worker = registration.installing || registration.waiting || registration.active;
      if (!worker) { reject(new Error('영업 앱을 다시 열고 알림을 연결해 주세요.')); return; }
      const timer = setTimeout(() => {
        worker.removeEventListener('statechange', changed);
        reject(new Error('영업 앱 알림 준비를 다시 시도해 주세요.'));
      }, 10000);
      function changed() {
        if (worker.state !== 'activated') return;
        clearTimeout(timer);
        worker.removeEventListener('statechange', changed);
        resolve(worker);
      }
      worker.addEventListener('statechange', changed);
      changed();
    });
  }

  function bindDevice(worker, binding) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error('기기 알림 연결을 다시 시도해 주세요.')); }, 5000);
      channel.port1.onmessage = () => { clearTimeout(timer); channel.port1.close(); resolve(); };
      worker.postMessage({type: 'SALES_BIND', binding}, [channel.port2]);
    });
  }

  el('retry-login').onclick = () => { feedback(''); void signIn(); };
  el('sync').onclick = () => sync();
  el('load-more').onclick = () => sync(true);
  el('sign-out').onclick = signOut;
  el('inbox-open').onclick = openInbox;
  el('notice-open').onclick = openComposer;
  el('notice-request').onchange = selectRecipient;
  el('notice-message').oninput = () => { noticeOperation = ''; };
  el('notice-form').onsubmit = sendNotice;
  el('push-enable').onclick = enablePush;
  for (const button of document.querySelectorAll('[data-scope]')) button.onclick = () => {
    const previous = criteria();
    state.scope = button.dataset.scope;
    if (state.scope === 'mine') el('search').value = '';
    renderScope();
    if (previous !== criteria()) void sync();
  };
  el('search').oninput = event => {
    clearTimeout(searchTimer);
    if (!event.isComposing && !composing) scheduleSearch();
  };
  el('search').oncompositionstart = () => { composing = true; clearTimeout(searchTimer); };
  el('search').oncompositionend = () => {
    composing = false;
    clearTimeout(searchTimer);
    scheduleSearch();
  };
  function scheduleSearch() {
    renderScope();
    searchTimer = setTimeout(() => void sync(), 250);
  }
  for (const id of ['list', 'table-list']) el(id).onclick = event => {
    const button = event.target.closest('.sales-case-open') || (id === 'list' ? event.target.closest('.sales-card')?.querySelector('.sales-case-open') : null);
    if (button) void openDetail(button);
  };
  el('detail-back').onclick = closeDetail;
  el('detail-dialog').oncancel = event => { event.preventDefault(); closeDetail(); };
  el('detail-dialog').onclose = () => {
    detailRequest++;
    for (const id of ['detail-summary', 'detail-receipt', 'detail-results']) el(id).replaceChildren();
    detailTrigger?.focus({preventScroll: true});
    detailTrigger = null;
  };
  window.addEventListener('popstate', () => {
    if (!history.state?.salesDetail && el('detail-dialog').open) el('detail-dialog').close();
  });
  window.addEventListener('baz-theme-change', event => {
    document.querySelector('meta[name=theme-color]').content = event.detail.theme === 'dark' ? '#172835' : '#f4f7fa';
  });

  state.token = restoreSession();
  if (state.token) void sync();
  else { feedback(''); void signIn(); }
})();
