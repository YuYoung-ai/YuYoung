import workFields from '../../js/baz-work-fields.js';

const namespace = 'sales-service-v1';
const key = (...parts) => [namespace, ...parts];
const workKey = (...parts) => ['hospitalwork-v2', ...parts];
const emailKey = value => String(value || '').trim().toLowerCase();
const alias = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
const tokenPattern = /^sales_[0-9a-f]{64}$/;
const isLive = row => Boolean(row?.id && !row.deletedAt && !row.purgedAt);
const hour = 60 * 60 * 1000;
const domesticRegions = new Set([
  '서울', '서울특별시', '경기', '경기도', '서울 / 경기', '인천', '인천광역시',
  '대전', '대전광역시', '충청', '대전 / 충청', '충북', '충청북도', '충남', '충청남도', '세종', '세종특별자치시',
  '경상', '경북', '경상북도', '경남', '경상남도', '대구', '대구광역시', '부산', '부산광역시', '울산', '울산광역시',
  '전라', '전북', '전라북도', '전북특별자치도', '전남', '전라남도', '광주', '광주광역시',
  '강원', '강원도', '강원특별자치도', '제주', '제주도', '제주특별자치도',
]);

function visibleTo(scope, row, hospital) {
  if (scope.csAdmin) return domesticRegions.has(alias(hospital?.region || row.region));
  return scope.allowed.has(alias(row.sales || hospital?.sales));
}

function failure(status, code, message) {
  return Object.assign(new Error(message), {status, code});
}

function cleanSymptom(value) {
  return String(value || '').trim()
    .replace(/(환자(?:명| 이름)|생년월일|주민등록번호|연락처|전화번호)\s*[:：]\s*[^\r\n]*/g, '$1 [가림]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[이메일]')
    .replace(/(?:\+82[ .-]?\(?0?\)?|0)\d{1,2}[ .-]?\d{3,4}[ .-]?\d{4}(?!\d)/g, '[연락처]')
    .slice(0, 220);
}

function confirmedVisit(row) {
  return row.qrIntake?.confirmationRequired !== true || row.qrIntake.appointmentConfirmed === true;
}

function card(row, hospital) {
  const confirmed = confirmedVisit(row);
  return {
    id: row.id,
    hospital: hospital?.name || row.hospitalName || '',
    symptom: cleanSymptom(row.salesShareSymptom ?? row.symptom),
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
  if (!account || !['staff', 'lead'].includes(account.role)) return null;
  const domestic = new Set((policy.domesticSales || []).map(alias).filter(Boolean));
  const assigned = (account.sales || []).map(alias).filter(name => domestic.has(name));
  return {email, name: account.name || '', allowed: new Set(account.role === 'lead' ? domestic : assigned), canSend: account.canSend === true};
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

export function createSalesService(kv, {verifyGoogle, hash, now = Date.now, requestPage, sender, validateSubscription, getCsAdmin} = {}) {
  async function accessFor(policy, email) {
    const assigned = scopeFor(policy, email);
    if (assigned) return assigned;
    const admin = await getCsAdmin?.(email);
    return admin ? {email, name: admin.name, csAdmin: true, canSend: true} : null;
  }

  async function security(token) {
    if (!tokenPattern.test(String(token))) throw failure(401, 'LOGIN_REQUIRED', 'Google 계정으로 로그인해 주세요.');
    const entry = await kv.get(key('session', await hash(token)));
    const session = entry.value;
    if (!session || session.expiresAt <= now()) throw failure(401, 'LOGIN_REQUIRED', '로그인 시간이 만료되었습니다.');
    const policy = (await kv.get(key('access'))).value;
    const scope = await accessFor(policy, session.email);
    if (!scope) throw failure(403, 'ACCESS_DENIED', '이 계정에 영업 앱 이용 권한이 없습니다.');
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
    const random = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    const token = `sales_${random}`, ttl = p.remember === true ? 30 * 24 * hour : 8 * hour;
    const expiresAt = now() + ttl;
    const saved = await kv.set(key('session', await hash(token)), {email, expiresAt}, {expireIn: ttl});
    if (saved?.ok === false) throw failure(503, 'TEMPORARY', '로그인 저장을 다시 시도해 주세요.');
    return {success: true, token, expiresAt, name: scope.name};
  }

  async function lookups() {
    const hospitals = [];
    for await (const entry of kv.list({prefix: workKey('hospitalRef')})) hospitals.push(entry.value);
    return workFields.hospitalLookup(hospitals);
  }

  async function list(p, scope, policy) {
    const cursor = typeof p.cursor === 'string' && p.cursor.length <= 1200 ? p.cursor : '';
    const meta = (await kv.get(workKey('meta'))).value;
    if (!meta?.ready) throw failure(503, 'TEMPORARY', '서비스 현황을 잠시 후 다시 확인해 주세요.');
    const lookup = await lookups();
    const page = await requestPage(cursor);
    const items = [];
    for (const row of page.rows) {
      if (!isLive(row)) continue;
      const hospital = lookup(row);
      if (visibleTo(scope, row, hospital)) items.push(card(row, hospital));
    }
    const notifications = policy?.notifications === true;
    return {success: true, name: scope.name, notifications, canSend: notifications && scope.canSend, items, cursor: page.cursor, updatedAt: new Date(now()).toISOString()};
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
    return {entry, row, owner, hospital, recipient: recipient?.allowed.has(owner) ? recipient : null};
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
      const hospital = row.sales && !scope.csAdmin ? null : (await lookups())(row);
      if (visibleTo(scope, row, hospital)) items.push(entry.value);
    }
    return {success: true, items};
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
