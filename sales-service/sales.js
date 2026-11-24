(() => {
  'use strict';

  const apiUrl = 'https://yuyoung-production.coaptation.workers.dev';
  const storageKey = 'baz_sales_service_session';
  const el = id => document.getElementById(id);
  const state = {token: '', rows: new Map(), busy: false, scope: 'mine', period: 'month', criteria: '', shown:80, snapshot:null};
  const periodNames = {week:'이번 주', month:'이번 달', all:'전체 기간'};
  const cache = window.BazWorkCache;
  const details = new Map();
  const mobileCards = matchMedia('(max-width: 700px)');
  let fullReady = false;
  const koreanDate = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
  const clock = new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit'});
  let googleScript, noticeRecipient = '', noticeOperation = '', registrationTask, searchTimer, detailTrigger;
  let detailRequest = 0, swipeTimer;
  let installPrompt, appInstalled = false;
  const installDialog = el('app-install-dialog');

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
        throw Object.assign(new Error(data.error || '서비스 현황을 불러오지 못했습니다.'), {status: response.status, code:data.code});
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
    el('notice-tools').hidden = true;
    el('install-notice-help').hidden = false;
    el('install-notice-help').textContent = '로그인 후 알림을 설정할 수 있습니다.';
    noticeStatus('');
    el('workspace').hidden = true;
    el('sync').hidden = true;
    el('list').replaceChildren();
    el('table-list').replaceChildren();
    state.rows.clear();
    state.snapshot = null;
    details.clear();
    fullReady = false;
    state.criteria = '';
    state.scope = 'mine';
    state.period = 'month';
    el('search').value = '';
    renderScope();
    renderPeriod();
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
    if (state.token) await sync(true);
  }

  function renderCard(row, template = 'service-card') {
    const card = el(template).content.firstElementChild.cloneNode(true);
    card.dataset.requestId = row.id;
    const values = {
      ...row,
      symptom: row.symptom || '접수 증상 미기록',
      visitAt: row.visitPending ? '접수 확인 중' : row.visitAt ? row.visitAt.slice(0, 10) : '미정',
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
  const criteria = () => JSON.stringify([lookupScope(), state.period, searchText()]);
  function renderScope() {
    el('scope-title').textContent = scopeLabel();
    for (const button of document.querySelectorAll('[data-scope]')) {
      button.setAttribute('aria-pressed', String(button.dataset.scope === lookupScope()));
    }
  }
  function renderPeriod() {
    for (const button of document.querySelectorAll('[data-period]')) {
      button.setAttribute('aria-pressed', String(button.dataset.period === state.period));
      if (button.dataset.period === 'all') button.disabled = !fullReady;
    }
  }

  function periodProgress(message, retry = false) {
    el('period-progress').textContent = message;
    el('retry-period').hidden = !retry;
    renderPeriod();
  }

  function cardIndex() {
    const list = el('list');
    const center = list.scrollTop + list.clientHeight/2;
    let index = 0;
    for (let next = 1; next < list.children.length && list.children[next].offsetTop <= center; next++) index=next;
    return index;
  }

  function updateCardPosition() {
    const index = cardIndex(), total = state.rows.size, rendered = el('list').children.length;
    el('swipe-controls').hidden = !mobileCards.matches || !rendered;
    const counter = `${index+1} / ${total}`;
    if (el('swipe-position').textContent !== counter) el('swipe-position').textContent = counter;
    el('previous-card').disabled = index===0;
    el('next-card').disabled = index>=total-1;
  }

  function goToCard(index) {
    const list = el('list'), card = list.children[index];
    list.scrollTop = card ? card.offsetTop : 0;
    updateCardPosition();
  }

  function renderRows() {
    if (!state.snapshot) return;
    const key = criteria(), query = searchText(), scope = lookupScope(), period = state.period;
    const same = key === state.criteria;
    if (!same) state.shown = 80;
    const mobile = mobileCards.matches, container = mobile ? el('list') : el('table-list');
    const previousIndex = mobile && same ? cardIndex() : 0;
    const anchor = same ? (mobile ? container.children[previousIndex] : [...container.children].find(card => card.getBoundingClientRect().bottom > 0)) : null;
    const anchorTop = anchor?.getBoundingClientRect().top;
    const today = koreanDate.format(new Date());
    const range = window.BazWorkFields.range(period,today,today.slice(0,7));
    const normalize = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase('ko-KR');
    const terms = normalize(query).split(/\s+/).filter(Boolean), joined = terms.join('');
    let outsidePeriod = 0;
    const rows = state.snapshot.items.filter(row => {
      if (scope === 'mine' && !row.mine) return false;
      if (joined) {
        const labels = [row.hospital,row.sales].map(value=>normalize(value).replace(/\s+/g,''));
        const matches = labels.some(label=>label.includes(joined)) || terms.every(term=>labels.some(label=>label.includes(term)));
        if (!matches) return false;
      }
      const day = row.visitAt.slice(0,10);
      if (range && (day < range[0] || day > range[1])) {
        outsidePeriod++;
        return false;
      }
      return true;
    });
    rows.sort((a,b)=>b.visitAt.localeCompare(a.visitAt) || b.changed.localeCompare(a.changed) || a.id.localeCompare(b.id));
    state.rows = new Map(rows.map(row=>[row.id,row]));
    state.criteria = key;
    const keptIndex = mobile && anchor ? rows.findIndex(row=>row.id===anchor.dataset.requestId) : -1;
    if (keptIndex>=state.shown) state.shown = keptIndex+1;
    const shown = rows.slice(0,state.shown);
    el('list').replaceChildren(...shown.map(row=>renderCard(row)));
    el('table-list').replaceChildren(...shown.map(row=>renderCard(row,'service-row')));
    el('desktop-list').hidden = !shown.length;
    el('list-count').textContent = `${rows.length.toLocaleString('ko-KR')}건`;
    el('list-conditions').textContent = [scopeLabel(), `방문일 기준 ${periodNames[period]}`, '방문일 내림차순', query ? `검색 “${query}”` : ''].filter(Boolean).join(' · ');
    el('empty').hidden = rows.length>0;
    if (query && outsidePeriod && !rows.length && fullReady) {
      el('empty').textContent = `선택한 기간에 검색 결과가 없습니다. 전체 기간에 ${outsidePeriod.toLocaleString('ko-KR')}건이 있습니다.`;
    } else {
      el('empty').textContent = query ? '검색 결과가 없습니다.' : scope === 'mine' ? '선택한 기간에 내 업무로 배정된 접수가 없습니다.' : '선택한 기간에 조회할 처리 내역이 없습니다.';
    }
    el('load-more').hidden = shown.length>=rows.length;
    const replacement = anchor && [...container.children].find(card=>card.dataset.requestId===anchor.dataset.requestId);
    if (mobile) goToCard(keptIndex >= 0 ? keptIndex : Math.min(previousIndex,shown.length-1));
    else if (replacement) window.scrollBy(0,replacement.getBoundingClientRect().top-anchorTop);
    updateCardPosition();
  }

  async function receiveDelta(previous) {
    const items = new Map(previous.items.map(item=>[item.syncKey,item]));
    let data, revision=previous.revision, snapshotSeq;
    do {
      data = await api('sales_cache_delta',{revision,snapshotSeq,stamp:previous.stamp,ref:previous.ref});
      if (data.revision<revision || data.more && data.revision===revision || snapshotSeq!==undefined && snapshotSeq!==data.snapshotSeq) {
        throw new Error('동기화 기준이 바뀌었습니다. 다시 시도해 주세요.');
      }
      for (const id of data.removed) items.delete(id);
      for (const row of data.items) items.set(row.syncKey,row);
      revision=data.revision;
      snapshotSeq=data.snapshotSeq;
    } while(data.more);
    return {...previous,items:[...items.values()],revision,updatedAt:data.updatedAt};
  }

  async function receiveSnapshot(context, preview = false) {
    let cursor='', snapshotSeq, ref, previewDay, data;
    const items = new Map(), visited = new Set();
    do {
      data = await api(preview ? 'sales_cache_preview' : 'sales_cache_bootstrap',{cursor,snapshotSeq,stamp:context.stamp,ref,previewDay});
      for (const row of data.items) items.set(row.syncKey,row);
      snapshotSeq = data.snapshotSeq;
      ref=data.ref;
      previewDay=data.previewDay;
      cursor=data.cursor;
      if (cursor && visited.has(cursor)) throw new Error('목록을 다시 동기화해 주세요.');
      visited.add(cursor);
    } while(cursor);
    const snapshot = {cacheKey:context.cacheKey,stamp:context.stamp,ref,revision:snapshotSeq,items:[...items.values()],updatedAt:data.updatedAt};
    return preview ? {...snapshot,partial:true} : receiveDelta(snapshot);
  }

  function showWorkspace(context, snapshot) {
    state.snapshot=snapshot;
    const available = new Set(snapshot.items.map(item=>item.id));
    for (const id of details.keys()) if (!available.has(id)) details.delete(id);
    el('account').textContent = context.name || '영업 계정';
    el('sync-time').textContent = '마지막 동기화 ' + clock.format(new Date(snapshot.updatedAt));
    el('sign-in').hidden = true;
    el('workspace').hidden = false;
    el('sync').hidden = false;
    renderRows();
    el('notice-tools').hidden = !context.notifications;
    el('notice-open').hidden = !context.canSend || !snapshot.items.length;
    el('install-notice-help').hidden = Boolean(context.notifications);
    el('install-notice-help').textContent = context.notifications ? '' : '현재 알림 서비스가 활성화되지 않았습니다.';
    security.setLevel(context.level);
    if (context.notifications && new URLSearchParams(location.search).has('notices')) {
      history.replaceState(null, '', location.pathname);
      void openInbox();
    }
  }

  async function sync(useSaved = false) {
    if (!state.token || state.busy) return;
    state.busy = true;
    el('sync').disabled = true;
    el('sign-out').disabled = true;
    feedback(useSaved ? '로그인 확인 중…' : '동기화 중…');
    try {
      const context = await api('sales_cache_context');
      const previous = state.snapshot || await cache.snapshot(context.cacheKey).catch(()=>null);
      const sameScope = previous?.cacheKey===context.cacheKey && previous.stamp===context.stamp;
      const valid = sameScope && !previous.partial;
      if (previous && !sameScope) {
        state.snapshot=null;
        details.clear();
        fullReady=false;
        el('workspace').hidden=true;
        await cache.save(previous.cacheKey,null).catch(()=>{});
      }
      let current;
      if (useSaved && valid) {
        fullReady=true;
        current=previous;
      }
      else {
        if (!valid) {
          fullReady=false;
          state.period = state.period === 'all' ? 'month' : state.period;
          periodProgress('전체 기간 준비 중…');
          feedback('이번 달과 이번 주 목록을 불러오는 중…');
          const preview = sameScope ? previous : await receiveSnapshot(context,true);
          showWorkspace(context,preview);
          feedback('');
        }
        try { current=valid ? await receiveDelta(previous) : await receiveSnapshot(context); }
        catch (error) {
          if (error.code !== 'SYNC_RESET') throw error;
          // Recheck access before retaining a partial view after a reset.
          const latest = await api('sales_cache_context');
          if (latest.stamp !== context.stamp || latest.cacheKey !== context.cacheKey) {
            state.snapshot=null;
            details.clear();
            fullReady=false;
            el('workspace').hidden=true;
            await cache.save(context.cacheKey,null).catch(()=>{});
            throw error;
          }
          current = await receiveSnapshot(context);
        }
        await cache.save(context.cacheKey,current).catch(()=>{
          throw new Error('이 기기에 동기화 목록을 저장하지 못했습니다.');
        });
        fullReady=true;
      }
      periodProgress('');
      showWorkspace(context,current);
      feedback('');
    } catch (error) {
      if ([401, 403].includes(error.status)) {
        if (state.snapshot) await cache.save(state.snapshot.cacheKey,null).catch(()=>{});
        setSession(null);
        await signIn();
      } else {
        el('sync').hidden = false;
        if (!fullReady) periodProgress('전체 기간 준비를 완료하지 못했습니다.',true);
      }
      feedback(error.message, true);
    } finally {
      el('sync').disabled = false;
      el('sign-out').disabled = false;
      state.busy = false;
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
      const saved = details.get(requestId);
      const fresh = await api('sales_detail', {requestId,detailVersion:saved?.detailVersion});
      const data = fresh.unchanged ? saved : fresh;
      if (!dialog.open || sequence !== detailRequest) return;
      if (data.detailVersion) details.set(requestId,data);
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
      if ([401,403,404].includes(error.status)) details.delete(requestId);
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
      if (state.snapshot) await cache.save(state.snapshot.cacheKey,null).catch(()=>{});
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

  function noticeStatus(message, error = false) {
    el('install-notice-status').textContent = message;
    el('install-notice-status').toggleAttribute('data-error',error);
  }

  function renderInstall() {
    const installed = appInstalled || navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
    const appleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    el('app-install').hidden = installed || !installPrompt;
    el('app-install-help').textContent = installed ? '영업 앱이 설치되어 있습니다.'
      : installPrompt ? '홈 화면에 BAZ 영업 아이콘을 추가합니다.'
      : appleMobile ? 'Safari에서 공유 → 홈 화면에 추가를 누르고 웹 앱으로 열기를 켠 뒤 추가하세요.'
      : '브라우저 메뉴에서 앱 설치 또는 홈 화면에 추가를 선택하세요.';
  }

  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();
    installPrompt=event;
    renderInstall();
  });
  window.addEventListener('appinstalled',()=>{
    installPrompt=null;
    appInstalled=true;
    renderInstall();
  });

  async function enablePush() {
    if (!window.Notification || !window.PushManager || !navigator.serviceWorker) {
      noticeStatus('아이폰에서는 홈 화면에 추가한 영업 앱을 열어 알림을 연결해 주세요.', true);
      return;
    }
    el('push-enable').disabled = true;
    noticeStatus('이 기기의 알림을 연결하는 중…');
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
      noticeStatus('이 기기에 영업 알림을 연결했습니다.');
    } catch (error) { noticeStatus(error.message, true); }
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
  el('app-install-open').onclick = () => { renderInstall(); installDialog.showModal(); };
  el('app-install').onclick = async () => {
    const prompt=installPrompt;
    if (!prompt) return;
    installPrompt=null;
    try {
      await prompt.prompt();
      if ((await prompt.userChoice).outcome === 'accepted') appInstalled=true;
      renderInstall();
    } catch {
      renderInstall();
    }
  };
  el('retry-period').onclick = () => sync();
  el('load-more').onclick = () => { state.shown+=80; renderRows(); };
  el('previous-card').onclick = () => goToCard(cardIndex()-1);
  el('next-card').onclick = () => {
    const next = cardIndex()+1;
    if (next >= el('list').children.length) { state.shown+=80; renderRows(); }
    goToCard(next);
  };
  el('list').addEventListener('scroll', () => {
    if (!mobileCards.matches) return;
    updateCardPosition();
    clearTimeout(swipeTimer);
    swipeTimer=setTimeout(()=>{
      const count=el('list').children.length;
      if (count<state.rows.size && cardIndex()>=count-2) { state.shown+=80; renderRows(); }
    },150);
  }, {passive:true});
  mobileCards.addEventListener('change',updateCardPosition);
  el('sign-out').onclick = signOut;
  el('inbox-open').onclick = () => { installDialog.close(); void openInbox(); };
  el('notice-open').onclick = () => { installDialog.close(); openComposer(); };
  el('notice-request').onchange = selectRecipient;
  el('notice-message').oninput = () => { noticeOperation = ''; };
  el('notice-form').onsubmit = sendNotice;
  el('push-enable').onclick = enablePush;
  for (const button of document.querySelectorAll('[data-scope]')) button.onclick = () => {
    const previous = criteria();
    state.scope = button.dataset.scope;
    if (state.scope === 'mine') el('search').value = '';
    renderScope();
    if (previous !== criteria()) renderRows();
  };
  for (const button of document.querySelectorAll('[data-period]')) button.onclick = () => {
    if (state.period === button.dataset.period || button.dataset.period === 'all' && !fullReady) return;
    state.period = button.dataset.period;
    renderPeriod();
    renderRows();
  };
  function scheduleSearch() {
    clearTimeout(searchTimer);
    renderScope();
    searchTimer = setTimeout(renderRows, 180);
  }
  for (const event of ['input','compositionend','search']) el('search').addEventListener(event,scheduleSearch);
  el('work-search').onsubmit = event => {
    event.preventDefault();
    clearTimeout(searchTimer);
    renderScope();
    renderRows();
  };
  for (const id of ['list', 'table-list']) el(id).onclick = event => {
    const button = event.target.closest('.sales-case-open') || (id === 'list' ? event.target.closest('.sales-card')?.querySelector('.sales-case-open') : null);
    if (button) void openDetail(button);
  };
  el('detail-back').onclick = closeDetail;
  el('detail-dialog').oncancel = event => { event.preventDefault(); closeDetail(); };
  el('detail-dialog').onclose = () => {
    detailRequest++;
    for (const id of ['detail-summary', 'detail-receipt', 'detail-results']) el(id).replaceChildren();
    const requestId = detailTrigger?.closest('[data-request-id]')?.dataset.requestId;
    const list = el(mobileCards.matches ? 'list' : 'table-list');
    const replacement = [...list.children].find(card=>card.dataset.requestId===requestId);
    replacement?.querySelector('.sales-case-open')?.focus({preventScroll:true});
    detailTrigger = null;
  };
  window.addEventListener('popstate', () => {
    if (!history.state?.salesDetail && el('detail-dialog').open) el('detail-dialog').close();
  });
  window.addEventListener('baz-theme-change', event => {
    document.querySelector('meta[name=theme-color]').content = event.detail.theme === 'dark' ? '#172835' : '#f4f7fa';
  });

  state.token = restoreSession();
  if (state.token) void sync(true);
  else { feedback(''); void signIn(); }
})();
