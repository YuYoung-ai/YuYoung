import workFields from '../../js/baz-work-fields.js';

const namespace = 'sales-service-v1';
const key = (...parts) => [namespace, ...parts];
const workKey = (...parts) => ['hospitalwork-v2', ...parts];
const emailKey = value => String(value || '').trim().toLowerCase();
const alias = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
const tokenPattern = /^sales_[0-9a-f]{64}$/;
const isLive = row => Boolean(row?.id && !row.deletedAt && !row.purgedAt);
const hour = 60 * 60 * 1000;
const koreaDate = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit'});
const domesticRegions = new Set([
  '서울', '서울특별시', '경기', '경기도', '서울 / 경기', '인천', '인천광역시',
  '대전', '대전광역시', '충청', '대전 / 충청', '충북', '충청북도', '충남', '충청남도', '세종', '세종특별자치시',
  '경상', '경북', '경상북도', '경남', '경상남도', '대구', '대구광역시', '부산', '부산광역시', '울산', '울산광역시',
  '전라', '전북', '전라북도', '전북특별자치도', '전남', '전라남도', '광주', '광주광역시',
  '강원', '강원도', '강원특별자치도', '제주', '제주도', '제주특별자치도',
]);

function visibleTo(scope, row, hospital) {
  if (scope.domesticRegion) {
    if (!domesticRegions.has(alias(hospital?.region || row.region))) return false;
    if (scope.level >= 2) return true;
  }
  return scope.allowed.has(alias(row.sales || hospital?.sales));
}

function failure(status, code, message) {
  return Object.assign(new Error(message), {status, code});
}

function shareableText(value, maxLength = 220) {
  return String(value || '').trim()
    .replace(/(환자(?:명| 이름)|생년월일|주민등록번호|연락처|전화번호)\s*[:：]\s*[^\r\n]*/g, '$1 [가림]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[이메일]')
    .replace(/(?:\+82[ .-]?\(?0?\)?|0)\d{1,2}[ .-]?\d{3,4}[ .-]?\d{4}(?!\d)/g, '[연락처]')
    .slice(0, maxLength);
}

const searchable = value => alias(value).toLocaleLowerCase('ko-KR');

function confirmedVisit(row) {
  return row.qrIntake?.confirmationRequired !== true || row.qrIntake.appointmentConfirmed === true;
}

function card(row, hospital) {
  const confirmed = confirmedVisit(row);
  return {
    id: row.id,
    hospital: hospital?.name || row.hospitalName || '',
    symptom: shareableText(row.salesShareSymptom ?? row.symptom),
    status: row.status || '',
    payment: workFields.terms(row, () => hospital).asType,
    visitAt: confirmed ? row.visitAt || '' : '',
    visitPending: !confirmed && !['완료', '취소'].includes(row.status),
    engineer: row.engineer || '',
    cs: row.cs || (row.qrIntake ? 'QR' : ''),
    sales: row.sales || hospital?.sales || '',
  };
}

function scopeFor(policy, email) {
  if (!Object.hasOwn(policy?.accounts || {}, email)) return null;
  const account = policy.accounts[email];
  const level = account?.level ?? {staff:1, lead:2, admin:3}[account?.role];
  if (!account || account.status === 'disabled' || ![1,2,3].includes(level)) return null;
  const domestic = new Set((policy.domesticSales || []).map(alias).filter(Boolean));
  const assigned = (account.sales || []).map(alias).filter(name => domestic.has(name));
  const mine = new Set(assigned.length ? assigned : [alias(account.name)].filter(Boolean));
  const allowed = account.domesticRegion ? mine : new Set(level >= 2 ? domestic : assigned);
  return {email, name: account.name || '', level, allowed, mine, domesticRegion: account.domesticRegion === true,
    canSend: account.canSend === true, version: account.version || '', boundSub:account.boundSub};
}

export async function updateSalesAccess(kv, input, now = Date.now()) {
  const invalid = () => failure(400, 'INVALID_ACCESS', '국내 영업명, Google 계정과 권한을 확인해 주세요.');
  if (!input || !Array.isArray(input.domesticSales) || !input.accounts || typeof input.accounts !== 'object' || Array.isArray(input.accounts)) throw invalid();
  const domestic = new Set(input.domesticSales.map(alias).filter(Boolean));
  const accounts = {};
  const primary = new Set();
  const entries = Object.entries(input.accounts);
  if (entries.length > 200 || domestic.size > 200) throw invalid();
  for (const [rawEmail, record] of entries) {
    const email = emailKey(rawEmail);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || Object.hasOwn(accounts, email) || !['lead', 'staff'].includes(record?.role)) throw invalid();
    const sales = Array.isArray(record.sales) ? [...new Set(record.sales.map(alias))] : [];
    const primaryFor = Array.isArray(record.primaryFor) ? [...new Set(record.primaryFor.map(alias))] : [];
    if (sales.some(name => !domestic.has(name)) || primaryFor.some(name => !domestic.has(name) || primary.has(name) || record.role === 'staff' && !sales.includes(name))) throw invalid();
    primaryFor.forEach(name => primary.add(name));
    accounts[email] = {name: String(record.name || '').trim().slice(0, 80), role: record.role, sales, primaryFor, canSend: record.canSend === true};
  }
  const previous = await kv.get(key('access'));
  const notifications = input.notifications === true;
  const enabledAt = notifications ? previous.value?.enabledAt || now : 0;
  const policy = {domesticSales: [...domestic], accounts, notifications, enabledAt};
  if (!(await kv.atomic().check(previous).set(previous.key, policy).commit()).ok) throw failure(409, 'ACCESS_CHANGED', '영업 앱 설정을 다시 저장해 주세요.');
  return {success: true, accounts: entries.length, notifications};
}

export function salesTransition(before, after) {
  if (!isLive(before) || !isLive(after)) return '';
  if (after.status === '완료' && before.status !== '완료') return '완료';
  const scheduled = row => row.status === '방문예정' && row.visitAt && confirmedVisit(row);
  return scheduled(after) && !scheduled(before) ? '방문예정' : '';
}

export async function prepareSalesTransition(kv, before, after, eventKind, now = Date.now()) {
  const stage = salesTransition(before, after);
  if (!stage || ['flow_import', 'restore'].includes(eventKind)) return null;
  const policy = (await kv.get(key('access'))).value;
  if (policy?.notifications !== true || !policy.enabledAt || now < policy.enabledAt) return null;
  const id = `${after.id}:${stage}`, previous = await kv.get(key('notice', id));
  if (previous.value) return null;
  return {previous, notice: {id, requestId: after.id, stage, at: now, attempts: 0}};
}

export function enqueueSalesNotice(tx, {previous, notice}) {
  const expiry = {expireIn: 48 * hour};
  return tx.check(previous).set(previous.key, notice, notice.stage ? {} : expiry).set(key('due', notice.at, notice.id), true, expiry);
}

export function createSalesService(kv, {verifyGoogle, hash, now = Date.now, requestPage, sender, validateSubscription, getCsAdmin, getCsAdmins} = {}) {
  async function accessFor(policy, email) {
    const assigned = scopeFor(policy, email);
    if (assigned || Object.hasOwn(policy?.accounts || {}, email)) return assigned;
    const admin = await getCsAdmin?.(email);
    return admin ? {email, name: admin.name, level:3, domesticRegion:true, mine: new Set([alias(admin.name)].filter(Boolean)), canSend: true, version:'', boundSub:admin.sub} : null;
  }

  async function security(token) {
    if (!tokenPattern.test(String(token))) throw failure(401, 'LOGIN_REQUIRED', 'Google 계정으로 로그인해 주세요.');
    const entry = await kv.get(key('session', await hash(token)));
    const session = entry.value;
    if (!session || session.expiresAt <= now()) throw failure(401, 'LOGIN_REQUIRED', '로그인 시간이 만료되었습니다.');
    const policy = (await kv.get(key('access'))).value;
    const scope = await accessFor(policy, session.email);
    if (!scope || scope.version !== (session.version || '')) throw failure(403, 'ACCESS_DENIED', '이 계정에 영업 앱 이용 권한이 없습니다.');
    return {scope, session, entry, policy};
  }

  async function login(p) {
    const claims = await verifyGoogle(p.idToken);
    const email = emailKey(claims?.email);
    if (!email || claims.email_verified !== true && claims.email_verified !== 'true') {
      throw failure(401, 'LOGIN_REQUIRED', 'Google 계정을 확인해 주세요.');
    }
    const scope = await accessFor((await kv.get(key('access'))).value, email);
    if (!scope) throw failure(403, 'ACCESS_DENIED', '이 계정에 영업 앱 이용 권한이 없습니다.');
    const identity = await kv.get(key('identity', email));
    const sub = String(claims.sub || '');
    const boundSub = identity.value?.sub || scope.boundSub;
    if (boundSub && boundSub !== sub) throw failure(403, 'GOOGLE_ACCOUNT_CHANGED', '등록된 Google 계정을 확인해 주세요.');
    const random = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    const token = `sales_${random}`, ttl = p.remember === true ? 30 * 24 * hour : 8 * hour;
    const loggedAt = now(), expiresAt = loggedAt + ttl;
    const saved = await kv.atomic().check(identity).set(identity.key, {sub, lastLogin:loggedAt})
      .set(key('session', await hash(token)), {email, expiresAt, loggedAt, remembered:p.remember === true,
        ua:String(p.__ua || '').slice(0,220), version:scope.version}, {expireIn:ttl}).commit();
    if (!saved.ok) throw failure(503, 'TEMPORARY', '로그인 저장을 다시 시도해 주세요.');
    return {success: true, token, expiresAt, name: scope.name};
  }

  async function hospitalReferences() {
    const hospitals = [];
    for await (const entry of kv.list({prefix: workKey('hospitalRef')})) hospitals.push(entry.value);
    return hospitals;
  }
  const lookups = async () => workFields.hospitalLookup(await hospitalReferences());

  async function cacheContext(scope, policy) {
    const notifications = policy?.notifications === true;
    return {success:true, cacheKey:'sales:'+await hash(scope.email), name:scope.name, level:scope.level, notifications,
      canSend:notifications && scope.canSend, stamp:await hash(JSON.stringify([scope.name, scope.level, scope.domesticRegion,
        [...(scope.allowed || [])].sort(), [...scope.mine].sort(), scope.version]))};
  }

  const resetCache = () => failure(409, 'SYNC_RESET', '전체 목록을 다시 동기화해 주세요.');
  async function cacheUpdate(p, scope, policy) {
    const context = await cacheContext(scope, policy);
    const meta = (await kv.get(workKey('meta'))).value;
    if (!meta?.ready) throw failure(503,'TEMPORARY','서비스 현황을 잠시 후 다시 확인해 주세요.');
    const current = Number(meta.seq || 0);
    const hospitals = await hospitalReferences();
    const ref = await hash(JSON.stringify(hospitals.map(h=>[h.key,h.name,h.region,h.sales,h.asType,h.sn,h.origin])));
    const lookup = workFields.hospitalLookup(hospitals);
    if ((p.stamp && p.stamp !== context.stamp) || (p.ref && p.ref !== ref)) throw resetCache();
    const snapshotSeq = p.snapshotSeq === undefined ? current : p.snapshotSeq;
    if (!Number.isSafeInteger(snapshotSeq) || snapshotSeq < 0 || snapshotSeq > current) throw resetCache();
    const delta = p.action === 'sales_cache_delta';
    const updatedAt = new Date(now()).toISOString();
    const items = [], removed = [];
    const project = async row => {
      const hospital = lookup(row);
      const allowed = isLive(row) && visibleTo(scope, row, hospital);
      if (!allowed && !delta) return;
      const syncKey = await hash(context.cacheKey + '|' + row.id);
      if (!allowed) { removed.push(syncKey); return; }
      items.push({...card(row,hospital), syncKey, mine:scope.mine.has(alias(row.sales || hospital?.sales)), changed:row.updatedAt || ''});
    };
    if (!delta) {
      const limit = 192, list = kv.list({prefix:workKey('request')},{limit,cursor:p.cursor || undefined});
      let count = 0;
      for await (const entry of list) { await project(entry.value); count++; }
      return {...context, ref, items, snapshotSeq, updatedAt, cursor:count===limit ? list.cursor : ''};
    }
    const revision = p.revision;
    if (!Number.isSafeInteger(revision) || revision < 0 || revision > snapshotSeq || !p.ref || !p.stamp) throw resetCache();
    const changes = new Map();
    let next = revision;
    for await (const entry of kv.list({start:workKey('change', revision+1),end:workKey('change',snapshotSeq+1)},{limit:128})) {
      const row = entry.value;
      if (row.seq !== next+1) throw resetCache();
      next = row.seq;
      if (row.request?.id) changes.set(row.request.id,row.request);
    }
    if (next === revision && next < snapshotSeq) throw resetCache();
    const ids = [...changes.keys()];
    for (let i=0;i<ids.length;i+=10) {
      const batch = ids.slice(i,i+10), keys = batch.map(id=>workKey('request',id));
      const entries = kv.getMany ? await kv.getMany(keys) : await Promise.all(keys.map(k=>kv.get(k)));
      for (const [index,entry] of entries.entries()) await project(entry.value || {id:batch[index],deletedAt:true});
    }
    return {...context, ref, items, removed, revision:next, snapshotSeq, more:next<snapshotSeq, updatedAt};
  }

  async function list(p, scope, policy) {
    const cursor = typeof p.cursor === 'string' && p.cursor.length <= 1200 ? p.cursor : '';
    const terms = searchable(String(p.query || '').slice(0, 100)).split(' ').filter(Boolean);
    const compactQuery = terms.join('');
    const mine = p.scope === 'mine' && !compactQuery;
    const today = koreaDate.format(new Date(now()));
    const dateRange = ['week','month'].includes(p.period) ? workFields.range(p.period, today, today.slice(0,7)) : null;
    const meta = (await kv.get(workKey('meta'))).value;
    if (!meta?.ready) throw failure(503, 'TEMPORARY', '서비스 현황을 잠시 후 다시 확인해 주세요.');
    const lookup = await lookups();
    const page = await requestPage(cursor, dateRange);
    const items = [];
    for (const row of page.rows) {
      if (!isLive(row)) continue;
      const hospital = lookup(row);
      if (!visibleTo(scope, row, hospital)) continue;
      if (mine && !scope.mine.has(alias(row.sales || hospital?.sales))) continue;
      const item = card(row, hospital);
      const day = item.visitAt.slice(0,10);
      if (dateRange && (!day || day < dateRange[0] || day > dateRange[1])) continue;
      if (!compactQuery) { items.push(item); continue; }
      const labels = [item.hospital, item.sales].map(value => searchable(value).replaceAll(' ', ''));
      if (labels.some(label => label.includes(compactQuery)) || terms.every(term => labels.some(label => label.includes(term)))) items.push(item);
    }
    const notifications = policy?.notifications === true;
    return {success: true, name: scope.name, level:scope.level, notifications, canSend: notifications && scope.canSend, items, cursor: page.cursor, updatedAt: new Date(now()).toISOString()};
  }

  async function detail(p, scope) {
    const id = typeof p.requestId === 'string' && p.requestId.length <= 100 ? p.requestId : '';
    const row = id ? (await kv.get(workKey('request', id))).value : null;
    if (!isLive(row)) throw failure(404, 'NOT_FOUND', '이 접수를 조회할 수 없습니다.');
    const hospital = (await lookups())(row);
    if (!visibleTo(scope, row, hospital)) throw failure(404, 'NOT_FOUND', '이 접수를 조회할 수 없습니다.');
    const results = [];
    let resultPending = false;
    for await (const entry of kv.list({prefix: workKey('history', id)})) {
      const history = entry.value, source = history?.source;
      if (history?.kind !== 'result' || history.deletedAt || !source?.recordId || source.origin === 'flow') continue;
      const link = (await kv.get(workKey('link', source.recordId))).value;
      if (link?.requestId !== id || link.historyId !== history.id) continue;
      if (history.sourceReview?.pending || row.status !== '완료') { resultPending = true; continue; }
      results.push({date: String(source.date || ''), engineer: shareableText(source.engineer, 80),
        detail: shareableText(source.detail, 4000), result: shareableText(source.result, 1000)});
    }
    results.sort((a, b) => b.date.localeCompare(a.date));
    return {success: true, request: card(row, hospital), receipt: shareableText(row.salesShareSymptom ?? row.symptom, 4000), results, resultPending};
  }

  async function target(requestId, policy) {
    const entry = await kv.get(workKey('request', requestId));
    if (!isLive(entry.value)) return null;
    const row = entry.value;
    const hospital = (await lookups())(row);
    const owner = alias(row.sales || hospital?.sales);
    const members = Object.entries(policy.accounts || {}).filter(([, value]) => value.primaryFor?.some(name => alias(name) === owner));
    if (!owner || members.length !== 1) return {entry, row, owner, hospital};
    const recipient = scopeFor(policy, members[0][0]);
    return {entry, row, owner, hospital, recipient: recipient && visibleTo(recipient, row, hospital) ? recipient : null};
  }

  async function manual(p, scope, policy) {
    if (!scope.canSend) throw failure(403, 'FORBIDDEN', '수동 알림 발신 권한이 없습니다.');
    const requestId = String(p.requestId || '').slice(0, 100);
    const current = await target(requestId, policy);
    if (!current || !visibleTo(scope, current.row, current.hospital)) throw failure(404, 'NOT_FOUND', '이 접수를 조회할 수 없습니다.');
    if (!current.recipient) throw failure(409, 'NO_RECIPIENT', '이 접수에 연결된 영업 알림 수신자가 없습니다.');
    const recipient = await hash(current.recipient.email + ':' + requestId);
    if (p.action === 'sales_notice_target') {
      let connected = false;
      for await (const entry of kv.list({prefix: key('deviceFor', current.recipient.email)}, {limit: 1})) connected = Boolean(entry.value);
      return {success: true, recipient, name: current.recipient.name || current.owner, connected};
    }
    if (p.recipient !== recipient) throw failure(409, 'RECIPIENT_CHANGED', '담당자가 변경되었습니다. 수신자를 다시 확인해 주세요.');
    const message = typeof p.message === 'string' ? p.message.trim() : '';
    if (!message || message.length > 500 || !/^[0-9a-f-]{36}$/.test(String(p.operationId || ''))) {
      throw failure(400, 'INVALID_NOTICE', '알림 문구를 1~500자로 입력해 주세요.');
    }
    const id = 'manual:' + await hash(scope.email + ':' + p.operationId);
    const previous = await kv.get(key('notice', id));
    if (previous.value) return {success: true, queued: true};
    const notice = {id, requestId, recipient, message, from: scope.name, at: now(), attempts: 0};
    const result = await enqueueSalesNotice(kv.atomic().check(current.entry), {previous, notice}).commit();
    if (!result.ok && !(await kv.get(previous.key)).value) throw failure(409, 'CASE_CHANGED', '접수가 변경되었습니다. 수신자를 다시 확인해 주세요.');
    return {success: true, queued: true};
  }

  async function register(p, scope) {
    let subscription;
    try { subscription = validateSubscription(p.subscription); }
    catch { throw failure(400, 'INVALID_SUBSCRIPTION', '이 기기의 알림 연결을 다시 확인해 주세요.'); }
    const id = await hash(subscription.endpoint);
    const entry = await kv.get(key('device', id));
    let tx = kv.atomic().check(entry);
    if (entry.value) tx = tx.delete(key('deviceFor', entry.value.email, id));
    const result = await tx.set(entry.key, {email: scope.email, subscription})
      .set(key('deviceFor', scope.email, id), true).commit();
    if (!result.ok) throw failure(409, 'DEVICE_CHANGED', '기기 연결을 다시 시도해 주세요.');
    return {success: true};
  }

  async function detach(email, id) {
    const entry = await kv.get(key('device', id));
    if (entry.value?.email === email) await kv.atomic().check(entry).delete(entry.key).delete(key('deviceFor', email, id)).commit();
  }

  async function inbox(scope, policy) {
    const items = [];
    for await (const entry of kv.list({prefix: key('inbox', scope.email)}, {limit: 24, reverse: true})) {
      const row = (await kv.get(workKey('request', entry.value.requestId))).value;
      if (!isLive(row)) continue;
      const hospital = row.sales && !scope.domesticRegion ? null : (await lookups())(row);
      if (visibleTo(scope, row, hospital)) items.push(entry.value);
    }
    return {success: true, items};
  }

  async function securityDirectory(policy) {
    const users = new Map();
    for (const admin of await getCsAdmins?.() || []) users.set(admin.email, {...admin, level:3, status:'active'});
    for (const [email, record] of Object.entries(policy?.accounts || {})) {
      const level = record.level ?? {staff:1, lead:2, admin:3}[record.role];
      users.set(email, {email, name:record.name, level, status:record.status || 'active', version:record.version || ''});
    }
    return users;
  }

  async function manageSecurity(p, scope, policy) {
    if (scope.level !== 3) throw failure(403, 'FORBIDDEN', 'Lv.3 관리자 권한이 필요합니다.');
    if (p.action === 'sales_security_list') {
      const users = await securityDirectory(policy);
      const devices = [];
      for await (const entry of kv.list({prefix:key('session')}, {limit:700})) {
        const session = entry.value, user = users.get(session.email);
        const remembered = session.remembered ?? (session.expiresAt - now() > 8 * hour);
        if (user?.status === 'active' && (user.version || '') === (session.version || '') && remembered && session.expiresAt > now()) {
          devices.push({id:entry.key.at(-1), email:user.email, name:user.name, level:user.level, loggedAt:session.loggedAt, ua:session.ua || ''});
        }
      }
      const records = [...users.values()];
      const summaries = [];
      for (let i=0; i<records.length; i+=10) {
        const batch = records.slice(i,i+10);
        const keys = batch.map(user => key('identity',user.email));
        const identities = kv.getMany ? await kv.getMany(keys) : await Promise.all(keys.map(k => kv.get(k)));
        batch.forEach(({email,name,level,status,linked,lastLogin}, index) => {
          const identity = identities[index].value;
          summaries.push({email,name,level,status, linked:Boolean(identity?.sub || linked), lastLogin:identity?.lastLogin || lastLogin || 0});
        });
      }
      summaries.sort((a,b)=>String(a.name || a.email).localeCompare(String(b.name || b.email),'ko'));
      devices.sort((a,b)=>(b.loggedAt||0)-(a.loggedAt||0));
      return {success:true, currentEmail:scope.email, users:summaries, devices};
    }
    if (p.action === 'sales_security_revoke') {
      const id = String(p.deviceId || '');
      if (!/^[A-Za-z0-9_-]{43}$/.test(id)) throw failure(400,'INVALID_DEVICE','해지할 기기를 확인해 주세요.');
      const session = await kv.get(key('session',id));
      if (session.value) {
        if (session.value.remembered === false) throw failure(400,'INVALID_DEVICE','해지할 기기를 확인해 주세요.');
        await kv.atomic().check(session).delete(session.key).commit();
      }
      return {success:true};
    }
    if (p.action !== 'sales_security_add' && p.action !== 'sales_security_save') throw failure(400,'UNKNOWN_ACTION','지원하지 않는 보안 관리 요청입니다.');
    const email = emailKey(p.email), level = Number(p.level), name = typeof p.name === 'string' ? p.name.trim() : '';
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || ![1,2,3].includes(level)) {
      throw failure(400,'INVALID_ACCESS','Google 이메일과 권한을 확인해 주세요.');
    }
    const entry = await kv.get(key('access'));
    const current = entry.value || {};
    if ((await accessFor(current,scope.email))?.level !== 3) throw failure(403,'FORBIDDEN','Lv.3 관리자 권한이 필요합니다.');
    const accounts = {...current.accounts};
    const stored = Object.hasOwn(accounts,email) ? accounts[email] : null;
    const inherited = !stored && await getCsAdmin?.(email);
    const exists = Boolean(stored || inherited);
    const adding = p.action === 'sales_security_add';
    if (adding && (exists || !name || name.length>80 || Object.keys(accounts).length>=200)) throw failure(409,'ACCOUNT_NOT_ADDED','이미 등록된 계정이거나 입력한 이름을 확인해 주세요.');
    if (!adding && !exists) throw failure(404,'NOT_FOUND','등록된 영업 계정을 찾을 수 없습니다.');
    const status = p.status === 'disabled' ? 'disabled' : 'active';
    if (email === scope.email && (status !== 'active' || level !== 3)) throw failure(409,'SELF_ADMIN','본인 관리자 권한이나 사용 상태는 변경할 수 없습니다.');
    accounts[email] = {...stored, name: stored?.name || inherited?.name || name,
      level, role:['','staff','lead','admin'][level], status,
      domesticRegion:stored?.domesticRegion ?? true, canSend:level>=2,
      boundSub:stored?.boundSub || inherited?.sub || '',
      version:status==='disabled' ? crypto.randomUUID() : stored?.version || ''};
    if (!(await kv.atomic().check(entry).set(entry.key,{...current,accounts}).commit()).ok) throw failure(409,'ACCESS_CHANGED','계정 설정이 변경됐습니다. 새로고침 후 다시 저장해 주세요.');
    return {success:true};
  }

  async function deliver() {
    const policy = (await kv.get(key('access'))).value;
    if (policy?.notifications !== true) return false;
    const at = now();
    for await (const job of kv.list({start: key('due', 0), end: key('due', at + 1)}, {limit: 1})) {
      const entry = await kv.get(key('notice', job.key.at(-1)));
      const notice = entry.value;
      if (!notice || notice.done || notice.at + 48 * hour <= at) { await kv.delete(job.key); return true; }
      const lease = key('due', at + 120000, notice.id), claim = crypto.randomUUID();
      const expiry = {expireIn: Math.max(1, notice.at + 48 * hour - at)};
      if (!(await kv.atomic().check(entry, job).set(entry.key, {...notice, claim}, notice.stage ? {} : expiry)
        .delete(job.key).set(lease, true, expiry).commit()).ok) return true;
      let held = await kv.get(entry.key);
      if (held.value?.claim !== claim) return true;
      const current = await target(notice.requestId, policy);
      let retry = false;
      const recipient = current?.recipient;
      const binding = recipient ? await hash(recipient.email + ':' + notice.requestId) : '';
      const available = recipient && (!notice.recipient || notice.recipient === binding);
      if (available) {
        if (!notice.recipient) {
          notice.recipient = binding;
          if (!(await kv.atomic().check(held).set(held.key, {...notice, claim}).commit()).ok) return true;
          held = await kv.get(held.key);
          if (held.value?.claim !== claim) return true;
        }
        const headline = notice.stage === '방문예정' ? '방문 일정 확정' : notice.stage === '완료' ? '서비스 처리 완료' : '영업 업무 메시지';
        const message = notice.message || (notice.stage === '방문예정' ? (current.row.visitAt || '').replace('T', ' ') : '서비스 상태가 완료로 변경되었습니다.');
        await kv.set(key('inbox', recipient.email, notice.at, notice.id), {
          requestId: notice.requestId, id: notice.id, hospital: current.row.hospitalName || '', headline, message, from: notice.from || '', at: notice.at,
        }, {expireIn: 30 * 24 * hour});
        for await (const link of kv.list({prefix: key('deviceFor', recipient.email)}, {limit: 8})) {
          const id = link.key.at(-1), device = (await kv.get(key('device', id))).value;
          if (device?.email !== recipient.email) continue;
          try {
            await sender.send(device.subscription, {title: 'BAZ 영업', body: headline, binding: await hash(recipient.email)}, 1800,
              {deliveryId: 'sales:' + await hash(notice.id + ':' + id)});
          } catch (error) {
            if ([404, 410].includes(error.statusCode)) await detach(recipient.email, id);
            else if (!error.statusCode || error.statusCode === 429 || error.statusCode >= 500) retry = true;
          }
        }
      }
      const attempts = notice.attempts + 1;
      const tx = kv.atomic().check(held).delete(lease);
      if (retry && attempts < 4) tx.set(held.key, {...notice, attempts}, notice.stage ? {} : expiry).set(key('due', at + 60000 * attempts, notice.id), true, expiry);
      else tx.set(held.key, {id: notice.id, done: true}, notice.stage ? {} : expiry);
      await tx.commit();
      return true;
    }
    return false;
  }

  async function handle(p) {
    if (p.action === 'sales_google_login') return login(p);
    const {scope, entry, policy} = await security(p.token);
    if (p.action === 'sales_list') return list(p, scope, policy);
    if (p.action === 'sales_cache_context') return cacheContext(scope, policy);
    if (['sales_cache_bootstrap','sales_cache_delta'].includes(p.action)) return cacheUpdate(p, scope, policy);
    if (p.action === 'sales_detail') return detail(p, scope);
    if (p.action.startsWith('sales_security_')) return manageSecurity(p, scope, policy);
    if (p.action === 'sales_logout') {
      if (typeof p.endpoint === 'string' && p.endpoint.length <= 2000) await detach(scope.email, await hash(p.endpoint));
      await kv.delete(entry.key);
      return {success: true};
    }
    if (policy?.notifications === true) {
      if (p.action === 'sales_notice_target' || p.action === 'sales_notice_send') return manual(p, scope, policy);
      if (p.action === 'sales_inbox') return inbox(scope, policy);
      if (p.action === 'sales_push_config') return {success: true, publicKey: await sender.publicKey(), binding: await hash(scope.email)};
      if (p.action === 'sales_push_subscribe') return register(p, scope);
    }
    throw failure(400, 'UNKNOWN_ACTION', '지원하지 않는 영업 앱 요청입니다.');
  }

  return {handle, deliver};
}
