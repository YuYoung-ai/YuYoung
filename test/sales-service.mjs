import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {createSalesService, enqueueSalesNotice, prepareSalesTransition, updateSalesAccess} from '../cloudflare/sales-service/service.mjs';
import {salesRequestPage} from '../cloudflare/sales-service/d1-page.mjs';
import {Kv} from './notification-test-kv.mjs';

test('sales service enforces the current assignment and returns only card fields', async () => {
  const kv = new Kv();
  const policy = {
    domesticSales: ['국내 A', '국내 B'],
    accounts: {
      'staff@example.com': {name: '영업 사원', role: 'staff', sales: ['국내 A', '해외']},
      'lead@example.com': {name: '영업 팀장', role: 'lead', sales: ['국내 B']},
    },
  };
  await kv.set(['sales-service-v1', 'access'], policy);
  await kv.set(['hospitalwork-v2', 'meta'], {ready: true});
  await kv.set(['hospitalwork-v2', 'hospitalRef', 'h2'], {key: 'h2', name: '병원 B', sales: '국내 B', asType: '무상'});
  const request = {
    id: 'r1', hospitalName: '병원 A', sales: '국내 A', symptom: '전원 불량\n전화번호: 010-1234-5678\n환자명: 테스트', status: '방문예정',
    visitAt: '2026-11-23T10:30', engineer: '엔지니어', cs: '접수자', serviceOverrides: {asType: '유상'},
    qrIntake: {confirmationRequired: true, appointmentConfirmed: false}, history: ['private'], comments: ['private'], pdf: 'private',
  };
  const rows = [request,
    {id: 'r2', hospitalKey: 'h2', hospitalName: '병원 B', status: '완료'},
    {id: 'r3', hospitalName: '해외 병원', sales: '해외'},
    {id: 'r4', sales: '국내 A', deletedAt: '2026-11-23'},
  ];
  const hash = value => createHash('sha256').update(value).digest('base64url');
  const service = createSalesService(kv, {
    hash, now: () => kv.clock,
    verifyGoogle: async email => ({email, email_verified: email !== 'unverified@example.com'}),
    requestPage: async cursor => cursor ? {rows: rows.slice(2), cursor: ''} : {rows: rows.slice(0, 2), cursor: 'next'},
  });
  const login = idToken => service.handle({action: 'sales_google_login', idToken});
  const list = (token, cursor) => service.handle({action: 'sales_list', token, cursor});

  await assert.rejects(login('unknown@example.com'), {status: 403});
  await assert.rejects(login('unverified@example.com'), {status: 401});
  await assert.rejects(list('ordinary-cs-token'), {status: 401});
  const {token} = await login('Staff@example.com');
  const {token: leadToken} = await login('lead@example.com');
  assert.match(token, /^sales_[0-9a-f]{64}$/);

  const first = await list(token);
  assert.equal(first.cursor, 'next');
  assert.deepEqual(first.items, [{
    id: 'r1', hospital: '병원 A', sales: '국내 A', symptom: '전원 불량\n전화번호 [가림]\n환자명 [가림]', status: '방문예정',
    engineer: '엔지니어', cs: '접수자', payment: '유상', visitAt: '', visitPending: true,
  }]);
  assert.deepEqual((await list(token, first.cursor)).items, []);
  const leadRows = (await list(leadToken)).items;
  assert.deepEqual(leadRows.map(row => row.id), ['r1', 'r2']);
  assert.equal(leadRows[1].payment, '무상');
  const search = (token, query, scope) => service.handle({action: 'sales_list', token, query, scope});
  assert.deepEqual((await search(leadToken, '', 'mine')).items.map(row => row.id), ['r2']);
  assert.deepEqual((await search(leadToken, '병원A', 'mine')).items.map(row => row.id), ['r1']);
  assert.deepEqual((await search(leadToken, '국내A', 'mine')).items.map(row => row.id), ['r1']);
  assert.deepEqual((await search(token, '병원B', 'mine')).items, []);
  assert.deepEqual((await search(leadToken, '병원 국내 b', 'all')).items.map(row => row.id), ['r2']);
  assert.deepEqual((await search(leadToken, '전원', 'all')).items, [], 'symptoms are outside the search scope');
  assert.deepEqual((await search(token, '국내 B', 'all')).items, [], 'search can only locate permitted cases');

  await kv.set(['hospitalwork-v2','request','r1'], {...request, status:'완료'});
  const good = {id:'h1', kind:'result', source:{recordId:'s1', date:'2026-11-23', engineer:'처리 A', detail:'전원 부품 점검', result:'정상', sn:'private serial', cost:'private cost'}};
  const changed = {...good, id:'h2', source:{...good.source, recordId:'s2'}, sourceReview:{pending:true}};
  const unrelated = {...good, id:'h3', source:{...good.source, recordId:'s3'}};
  for (const h of [good, changed, unrelated]) await kv.set(['hospitalwork-v2','history','r1',h.id],h);
  for (const h of [good, changed]) await kv.set(['hospitalwork-v2','link',h.source.recordId],{requestId:'r1', historyId:h.id});
  await kv.set(['hospitalwork-v2','link','s3'],{requestId:'r2', historyId:'h3'});
  const info = await service.handle({action:'sales_detail', token, requestId:'r1'});
  assert.equal(info.resultPending,true);
  assert.deepEqual(info.results,[{date:'2026-11-23', engineer:'처리 A', detail:'전원 부품 점검', result:'정상'}]);
  await kv.set(['hospitalwork-v2','request','r2'], rows[1]);
  await assert.rejects(service.handle({action:'sales_detail', token, requestId:'r2'}), {status:404});
  request.qrIntake.appointmentConfirmed = true;
  assert.equal((await list(token)).items[0].visitAt, '2026-11-23T10:30');
  request.sales = '국내 B';
  assert.deepEqual((await list(token)).items, []);

  delete policy.accounts['staff@example.com'];
  await kv.set(['sales-service-v1', 'access'], policy);
  await assert.rejects(list(token), {status: 403});
  await service.handle({action: 'sales_logout', token: leadToken});
  await assert.rejects(list(leadToken), {status: 401});
});

test('D1 orders the full request range by confirmed visit time before paging', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE kv_entries (k TEXT PRIMARY KEY, value TEXT, expires INTEGER)');
    const encode = v => v && typeof v === 'object' ? ['o', Object.entries(v).map(([key, value]) => [key, encode(value)])] : ['p',v];
    const decode = ([type, value]) => type === 'o' ? Object.fromEntries(value.map(([key, packed]) => [key, decode(packed)])) : value;
    const insert = db.prepare('INSERT INTO kv_entries VALUES (?,?,?)');
    const put = (id, row, expires = null) => insert.run('rq:'+id, JSON.stringify(encode({id,...row})), expires);
    for (let i=0;i<192;i++) put('x'+i, {visitAt:'2026-11-23T10:30'});
    put('older', {visitAt:'2025-01-01T18:25'});
    put('later', {visitAt:'2026-12-01T10:00', qrIntake:{confirmationRequired:true, appointmentConfirmed:true}});
    put('provisional', {visitAt:'2026-12-20T11:00', qrIntake:{confirmationRequired:true, appointmentConfirmed:false}});
    put('expired', {visitAt:'2026-12-25T11:00'}, 2);
    const kv = {now: () => 10, db:{prepare(sql) {const s=db.prepare(sql); return {bind(...args) {return {all:async () => ({results:s.all(...args)})};}};}}};
    const codec = {keyHex:()=>'rq:', prefixEnd:key=>key+'\uffff', unpack:text=>decode(JSON.parse(text))};
    const first = await salesRequestPage(kv, '', codec);
    const next = await salesRequestPage(kv, first.cursor, codec);
    assert.equal(first.rows.length,192);
    assert.equal(first.rows[0].id,'later');
    assert.deepEqual(next.rows.slice(-2).map(row=>row.id), ['older','provisional']);
    assert.equal(next.cursor,'');
    assert.equal(new Set([...first.rows,...next.rows].map(row=>row.id)).size,195);
  } finally {db.close();}
});

test('automatic milestones and manual notices use separate idempotency and the current recipient', async () => {
  const kv = new Kv();
  const prospect = 'first@example.com', substitute = 'second@example.com', lead = 'lead@example.com';
  const policy = {notifications: true, domesticSales: ['국내 A', '국내 B'], accounts: {
    [prospect]: {role: 'staff', name: '담당 A', sales: ['국내 A'], primaryFor: ['국내 A']},
    [substitute]: {role: 'staff', name: '담당 B', sales: ['국내 B'], primaryFor: ['국내 B']},
    [lead]: {role: 'lead', name: '팀장', canSend: true},
  }};
  await updateSalesAccess(kv, policy, kv.clock);
  await assert.rejects(updateSalesAccess(kv, {...policy, accounts: {...policy.accounts, [lead]: {role: 'lead', primaryFor: ['국내 A']}}}), {code: 'INVALID_ACCESS'});
  const hash = value => createHash('sha256').update(value).digest('base64url');
  const sent = [];
  const service = createSalesService(kv, {
    hash, now: () => kv.clock,
    verifyGoogle: async email => ({email, email_verified: true}),
    validateSubscription: value => value,
    sender: {publicKey: async () => 'public-test-key', send: async (device, payload, ttl, context) => sent.push({device, payload, ttl, context})},
  });
  const login = async idToken => (await service.handle({action: 'sales_google_login', idToken})).token;
  const a = await login(prospect), b = await login(substitute), l = await login(lead);
  const call = (token, action, args) => service.handle({action: 'sales_' + action, token, ...args});
  await call(a, 'push_subscribe', {subscription: {endpoint: 'https://fcm.googleapis.com/fcm/send/sales-a'}});
  await call(b, 'push_subscribe', {subscription: {endpoint: 'https://fcm.googleapis.com/fcm/send/sales-b'}});
  const requestKey = ['hospitalwork-v2', 'request', 'case'];
  const created = {id: 'case', sales: '국내 A', status: '접수', hospitalName: '검증 병원'};
  const provisional = {...created, status: '방문예정', visitAt: '2026-12-01T14:00', qrIntake: {confirmationRequired: true}};
  const scheduled = {...provisional, qrIntake: {...provisional.qrIntake, appointmentConfirmed: true}};
  const enqueue = async (before, after, kind = 'request_update') => {
    const prepared = await prepareSalesTransition(kv, before, after, kind, kv.clock);
    if (!prepared) return false;
    return (await enqueueSalesNotice(kv.atomic(), prepared).set(requestKey, after).commit()).ok;
  };
  assert.equal(await enqueue(created, provisional), false);
  assert.equal(await enqueue(provisional, scheduled), true);
  assert.equal(await enqueue(created, scheduled), false);
  assert.equal(await enqueue(scheduled, {...scheduled, visitAt: '2026-12-02T09:00'}), false);
  assert.equal(await service.deliver(), true);
  assert.equal(await service.deliver(), false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.binding, hash(prospect));

  const requestId = 'case';
  const {recipient} = await call(l, 'notice_target', {requestId});
  const message = '방문 전 장비 전원 상태를 확인해 주세요.';
  const request = {requestId, recipient, message, operationId: crypto.randomUUID()};
  await assert.rejects(call(a, 'notice_send', request), {status: 403});
  await call(l, 'notice_send', request);
  await call(l, 'notice_send', request);
  await service.deliver();
  assert.equal(sent.length, 2);
  assert.ok(!(JSON.stringify(sent[1]).includes(message)), 'manual body stays in the authenticated inbox');
  assert.ok((await call(a, 'inbox')).items.some(item => item.message === message));
  assert.deepEqual((await call(b, 'inbox')).items, []);

  await kv.set(requestKey, {...scheduled, sales: '국내 B'});
  await assert.rejects(call(l, 'notice_send', {...request, operationId: crypto.randomUUID()}), {code: 'RECIPIENT_CHANGED'});
  assert.deepEqual((await call(a, 'inbox')).items, []);
  const completed = {...scheduled, sales: '국내 B', status: '완료'};
  assert.equal(await enqueue(scheduled, completed), true);
  assert.equal(await enqueue(scheduled, completed), false);
  await service.deliver();
  assert.equal(sent.length, 3);
  assert.equal(sent[2].payload.binding, hash(substitute));
});

test('current BAZ CS administrators can start with domestic requests before the sales roster is configured', async () => {
  const kv = new Kv();
  const admin = 'existing-admin@example.com';
  let activeAdmin = true;
  await kv.set(['hospitalwork-v2', 'meta'], {ready:true});
  await kv.set(['hospitalwork-v2', 'hospitalRef', 'reference'], {key:'reference', name:'국내 병원', region:'서울 / 경기'});
  const service = createSalesService(kv, {
    now: () => kv.clock,
    hash: value => createHash('sha256').update(value).digest('base64url'),
    verifyGoogle: async email => ({email, email_verified:true}),
    getCsAdmin: async email => email === admin && activeAdmin ? {name:'기존 관리자'} : null,
    requestPage: async () => ({rows:[
      {id:'local', hospitalKey:'reference', region:'과거 분류'},
      {id:'abroad', region:'해외'},
      {id:'unknown-region'},
    ], cursor:''}),
  });
  const login = idToken => service.handle({action:'sales_google_login', idToken});
  await assert.rejects(login('ordinary-staff@example.com'), {status:403});
  const {token} = await login(admin);
  const request = {action:'sales_list', token};
  const list = await service.handle(request);
  assert.deepEqual(list.items.map(row => row.id), ['local']);
  assert.equal(list.notifications, false);
  activeAdmin = false;
  await assert.rejects(service.handle(request), {status:403});
});

test('Lv.3 can manage sales Google accounts and revoke remembered sessions', async () => {
  const kv = new Kv(), admin = 'admin@example.com', member = 'member@example.com';
  await kv.set(['hospitalwork-v2','meta'],{ready:true});
  const service = createSalesService(kv, {
    now:()=>kv.clock,
    hash:value=>createHash('sha256').update(value).digest('base64url'),
    getCsAdmin:async email=>email===admin ? {name:'관리자',sub:'admin-sub'} : null,
    getCsAdmins:async()=>[{email:admin,name:'관리자',linked:true}],
    verifyGoogle:async ({email,sub})=>({email,sub,email_verified:true}),
    requestPage:async()=>({rows:[{id:'own',region:'서울 / 경기',sales:'영업 A'},{id:'another',region:'인천',sales:'영업 B'}],cursor:''}),
  });
  const login = (email, sub, remember = false) => service.handle({action:'sales_google_login',idToken:{email,sub},remember,__ua:'fixture-device'});
  const call = (token,action,fields={}) => service.handle({action:'sales_'+action,token,...fields});
  await assert.rejects(login(admin,'other-sub'),{code:'GOOGLE_ACCOUNT_CHANGED'});
  const {token:chief} = await login(admin,'admin-sub');
  await assert.rejects(call(chief,'security_save',{email:admin,status:'disabled',level:3}),{code:'SELF_ADMIN'});
  await call(chief,'security_add',{email:'Member@example.com',name:'영업 A',level:1});
  const {token:staff} = await login(member,'member-sub',true);
  assert.deepEqual((await call(staff,'list')).items.map(x=>x.id),['own']);
  await assert.rejects(call(staff,'security_list'),{status:403});
  await assert.rejects(login(member,'new-member-sub'),{code:'GOOGLE_ACCOUNT_CHANGED'});
  const current = await call(chief,'security_list');
  assert.equal(current.users.find(u=>u.email===member)?.linked,true);
  assert.equal(current.devices[0].ua,'fixture-device');
  assert.equal(current.devices.length,1);
  await call(chief,'security_save',{email:member,status:'active',level:2});
  assert.deepEqual((await call(staff,'list')).items.map(x=>x.id),['own','another']);
  await call(chief,'security_revoke',{deviceId:current.devices[0].id});
  await assert.rejects(call(staff,'list'),{status:401});
  const {token:second} = await login(member,'member-sub',true);
  await call(chief,'security_save',{email:member,status:'disabled',level:2});
  await assert.rejects(login(member,'member-sub'),{status:403});
  await call(chief,'security_save',{email:member,status:'active',level:2});
  await assert.rejects(call(second,'list'),{status:403});
  assert.equal((await call(chief,'security_list')).devices.length,0);
});
