import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'deno-auth', 'main.ts');
const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');

let passed = 0;
function ok(name) {
  passed++;
  console.log('✅ ' + name);
}

class MockKv {
  constructor() {
    this.rows = new Map();
    this.version = 0;
  }
  id(key) { return JSON.stringify(key); }
  async get(key) {
    const row = this.rows.get(this.id(key));
    return { key, value: row ? structuredClone(row.value) : null, versionstamp: row ? row.versionstamp : null };
  }
  async set(key, value) {
    this.rows.set(this.id(key), { key, value: structuredClone(value), versionstamp: String(++this.version) });
  }
  async delete(key) { this.rows.delete(this.id(key)); }
  atomic() {
    const kv = this;
    let checked = null;
    let pending = null;
    const op = {
      check(entry) { checked = entry; return op; },
      set(key, value) { pending = { key, value }; return op; },
      async commit() {
        const current = await kv.get(checked.key);
        if (current.versionstamp !== checked.versionstamp) return { ok: false };
        await kv.set(pending.key, pending.value);
        return { ok: true, versionstamp: String(kv.version) };
      },
    };
    return op;
  }
  async *list({ prefix }) {
    for (const row of this.rows.values()) {
      if (prefix.every((v, i) => row.key[i] === v)) {
        yield { key: row.key, value: structuredClone(row.value), versionstamp: row.versionstamp };
      }
    }
  }
}

const env = new Map(Object.entries({
  TOKEN_SECRET: 'test-token-secret-with-enough-entropy',
  TOKEN_EPOCH: '1',
  TOKEN_TTL_HOURS: '6',
  CREDENTIALS: JSON.stringify([{ pw: 'correct-password', level: 3, name: '테스트 관리자' }]),
  DEVICE_AUTH_ENABLED: 'false',
  ALLOWED_ORIGINS: 'https://allowed.example',
  LOGIN_RATE_MAX: '2',
  LOGIN_RATE_WINDOW_SEC: '60',
  LOGIN_RATE_BLOCK_SEC: '60',
  LOGIN_FAILURE_DELAY_MS: '0',
  GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
  GOOGLE_AUTH_ENABLED: 'true',
  GOOGLE_USERS: JSON.stringify([{ email: 'allowed@gmail.com', level: 2, name: '허용 사용자' }]),
  GITHUB_TOKEN: 'ghp_test-only-token',
  GITHUB_REPO: 'YuYoung-ai/YuYoung',
  GITHUB_BRANCH: 'main',
}));

const kv = new MockKv();
let handler = null;
let adminToken = '';
const googleKeyPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const googlePublicJwk = await crypto.subtle.exportKey('jwk', googleKeyPair.publicKey);
Object.assign(googlePublicJwk, { kid: 'test-google-key', alg: 'RS256', use: 'sig' });
/* 저장소 대신 쓰는 가짜 GitHub — 커밋된 파일 상태를 들고 있어야
   "같은 내용 재전송", "그 사이 브랜치가 움직임"까지 실제 순서대로 확인할 수 있다 */
const gh = {
  head: 'a'.repeat(40), tree: 'b'.repeat(40),
  files: new Map(), pending: new Map(),
  calls: [], messages: [], parents: [],
  failRefOnce: false, seq: 0,
};
function ghSha() { return String(++gh.seq).padStart(40, '0'); }
function ghJson(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
async function ghBlobSha(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}
async function githubMock(url, init = {}) {
  const method = (init.method || 'GET').toUpperCase();
  const at = url.replace('https://api.github.com', '');
  gh.calls.push(method + ' ' + at);
  assert.equal(init.headers?.Authorization, 'Bearer ghp_test-only-token');
  const body = init.body ? JSON.parse(init.body) : null;
  const repo = '/repos/YuYoung-ai/YuYoung';

  if (method === 'POST' && at === repo + '/git/blobs') {
    assert.equal(body.encoding, 'base64');
    return ghJson(201, { sha: await ghBlobSha(Buffer.from(body.content, 'base64')) });
  }
  if (method === 'GET' && at === repo + '/git/ref/heads/main') {
    gh.parents.push(gh.head);
    return ghJson(200, { object: { sha: gh.head } });
  }
  if (method === 'GET' && at.startsWith(repo + '/git/commits/')) {
    const sha = at.split('/').pop();
    if (sha !== gh.head) return ghJson(404, { message: 'Not Found' });
    return ghJson(200, { sha, tree: { sha: gh.tree } });
  }
  if (method === 'POST' && at === repo + '/git/trees') {
    assert.equal(body.base_tree, gh.tree);
    const next = new Map(gh.files);
    for (const e of body.tree) {
      assert.equal(e.mode, '100644');
      assert.ok(e.path.startsWith('assets/type-examples/'), '자산 폴더 밖 경로: ' + e.path);
      next.set(e.path, e.content !== undefined ? e.content : 'blob:' + e.sha);
    }
    const same = next.size === gh.files.size && [...next].every(([k, v]) => gh.files.get(k) === v);
    if (same) return ghJson(201, { sha: gh.tree });
    const sha = ghSha();
    gh.pending.set(sha, next);
    return ghJson(201, { sha });
  }
  if (method === 'POST' && at === repo + '/git/commits') {
    assert.deepEqual(body.parents, [gh.head]);
    gh.messages.push(body.message);
    const sha = ghSha();
    gh.pending.set(sha, gh.pending.get(body.tree));
    gh.pending.set('tree:' + sha, body.tree);
    return ghJson(201, { sha });
  }
  if (method === 'PATCH' && at === repo + '/git/refs/heads/main') {
    if (gh.failRefOnce) {           /* 다른 커밋이 먼저 올라간 상황 */
      gh.failRefOnce = false;
      gh.head = ghSha();
      gh.tree = ghSha();
      return ghJson(422, { message: 'Update is not a fast forward' });
    }
    gh.files = new Map(gh.pending.get(body.sha));
    gh.tree = gh.pending.get('tree:' + body.sha);
    gh.head = body.sha;
    return ghJson(200, { object: { sha: body.sha } });
  }
  return ghJson(404, { message: 'unexpected github call: ' + method + ' ' + at });
}
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.github.com')) return githubMock(String(url), init);
  assert.equal(String(url), 'https://www.googleapis.com/oauth2/v3/certs');
  return new Response(JSON.stringify({ keys: [googlePublicJwk] }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' },
  });
};
globalThis.Deno = {
  env: { get: (name) => env.get(name) },
  openKv: async () => kv,
  serve: (fn) => { handler = fn; return { finished: Promise.resolve() }; },
};

await import(pathToFileURL(SOURCE_PATH).href + '?security-test=1');
assert.equal(typeof handler, 'function', 'Deno.serve handler가 등록되어야 한다');

function info(ip) {
  return { remoteAddr: { transport: 'tcp', hostname: ip, port: 443 }, completed: Promise.resolve() };
}
async function post(body, { origin = 'https://allowed.example', ip = '203.0.113.10' } = {}) {
  const req = new Request('https://auth.example/', {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=utf-8', origin },
    body: JSON.stringify(body),
  });
  const res = await handler(req, info(ip));
  return { res, body: await res.json() };
}
function b64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
async function googleIdToken(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64urlJson({ alg: 'RS256', kid: 'test-google-key', typ: 'JWT' });
  const payload = b64urlJson({
    iss: 'https://accounts.google.com',
    aud: 'test-client.apps.googleusercontent.com',
    sub: 'google-sub-allowed',
    email: 'allowed@gmail.com',
    email_verified: true,
    name: 'Google 표시 이름',
    iat: now,
    exp: now + 300,
    ...overrides,
  });
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', googleKeyPair.privateKey, new TextEncoder().encode(head + '.' + payload),
  );
  return head + '.' + payload + '.' + Buffer.from(sig).toString('base64url');
}

{
  const req = new Request('https://auth.example/', {
    method: 'OPTIONS',
    headers: { origin: 'https://allowed.example' },
  });
  const res = await handler(req, info('203.0.113.1'));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://allowed.example');
  assert.equal(res.headers.get('vary'), 'Origin');
  ok('허용 Origin의 preflight만 정확히 반사한다');
}

{
  const out = await post({ action: 'login', password: 'correct-password' }, {
    origin: 'https://evil.example', ip: '203.0.113.2',
  });
  assert.equal(out.res.status, 403);
  assert.equal(out.body.error, 'origin_not_allowed');
  assert.equal(out.res.headers.get('access-control-allow-origin'), null);
  ok('허용 목록 밖 브라우저 Origin을 서버에서 거부한다');
}

{
  const first = await post({ action: 'login', password: 'wrong-1' });
  const second = await post({ action: 'login', password: 'wrong-2' });
  const blocked = await post({ action: 'login', password: 'correct-password' });
  assert.equal(first.body.error, 'invalid_password');
  assert.equal(second.body.error, 'invalid_password');
  assert.equal(blocked.res.status, 429);
  assert.equal(blocked.body.error, 'rate_limited');
  assert.ok(blocked.body.retryAfter >= 1);
  ok('같은 IP의 연속 로그인 실패를 KV로 잠근다');
}

{
  const out = await post({ action: 'login', password: 'correct-password', remember: true }, {
    ip: '203.0.113.11',
  });
  assert.equal(out.body.ok, true);
  assert.equal(out.body.level, 3);
  assert.equal(out.body.device, '');
  assert.equal(out.res.headers.get('access-control-allow-origin'), 'https://allowed.example');
  adminToken = out.body.token;
  ok('다른 IP의 정상 로그인은 성공하고 서버 기기 스위치를 따른다');
}

{
  const token = await googleIdToken();
  const out = await post({ action: 'google_login', idToken: token }, { ip: '203.0.113.20' });
  assert.equal(out.body.ok, true);
  assert.equal(out.body.level, 2);
  assert.equal(out.body.name, '허용 사용자');
  assert.equal(out.body.email, 'allowed@gmail.com');
  ok('서명·issuer·audience를 검증한 허용 Google 사용자를 기존 HMAC 세션으로 교환한다');
}

{
  const token = await googleIdToken({ sub: 'unknown-sub', email: 'unknown@gmail.com' });
  const out = await post({ action: 'google_login', idToken: token }, { ip: '203.0.113.21' });
  assert.equal(out.res.status, 403);
  assert.equal(out.body.error, 'access_denied');
  ok('Google 인증에 성공해도 KV 허용 명단 밖 사용자는 거부한다');
}

{
  const token = await googleIdToken({ aud: 'attacker-client.apps.googleusercontent.com' });
  const out = await post({ action: 'google_login', idToken: token }, { ip: '203.0.113.22' });
  assert.equal(out.res.status, 401);
  assert.equal(out.body.error, 'google_auth_failed');
  ok('다른 OAuth client용 Google 토큰을 거부한다');
}

{
  const list = await post({ action: 'users', token: adminToken }, { ip: '203.0.113.23' });
  assert.equal(list.body.ok, true);
  assert.equal(list.body.users.length, 1);
  assert.equal(list.body.users[0].linked, true);
  const saved = await post({
    action: 'user_save', token: adminToken,
    email: 'allowed@gmail.com', name: '허용 사용자', level: 2, status: 'disabled',
  }, { ip: '203.0.113.23' });
  assert.equal(saved.body.ok, true);
  const denied = await post({ action: 'google_login', idToken: await googleIdToken() }, { ip: '203.0.113.24' });
  assert.equal(denied.body.error, 'access_denied');
  ok('Lv.3 관리자가 사용자를 비활성화하면 다음 Google 로그인을 차단한다');
}

{
  const out = await post({ action: 'audits', token: adminToken }, { ip: '203.0.113.25' });
  assert.equal(out.body.ok, true);
  assert.ok(out.body.audits.some((a) => a.event === 'google_login' && a.actor === 'allowed@gmail.com'));
  assert.ok(out.body.audits.some((a) => a.event === 'user_save' && a.target === 'allowed@gmail.com'));
  assert.ok(out.body.audits.every((a) => !('ip' in a) && /^[A-Za-z0-9_-]{12}$/.test(a.client)));
  ok('Lv.3 감사 목록에 로그인·권한 변경을 남기되 원 IP는 노출하지 않는다');
}

/* ── 예시자료 게시(te_blob · te_commit) ────────────────────────────────
   대시보드 관리 화면의 "🚀 바로 게시"가 부르는 경로다. 브라우저가 보낸 값을
   서버가 다시 검증하는지, 저장소에는 assets/type-examples/ 아래만 커밋되는지,
   같은 요청이 두 번 와도 빈 커밋이 생기지 않는지를 GitHub API를 흉내 내 확인한다. */
async function hash12(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...d.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function manifestFor(paths, extra = {}) {
  const items = {};
  paths.forEach((p, i) => { items['장비|유형' + i] = { symptom: { src: p, text: '설명' } }; });
  return JSON.stringify({ schema: 1, updatedAt: '2026-08-28', items: { ...items, ...extra } }, null, 2) + '\n';
}

{
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5, 6, 7, 8]);
  const good = 'assets/type-examples/media/' + (await hash12(png)) + '.webp';
  const data = Buffer.from(png).toString('base64');

  const anon = await post({ action: 'te_blob', path: good, data }, { ip: '203.0.113.40' });
  assert.equal(anon.res.status, 401);
  assert.equal(gh.calls.length, 0);
  ok('예시자료 게시는 Lv.3 토큰 없이는 GitHub를 건드리지도 않는다');

  const outside = await post({
    action: 'te_blob', token: adminToken, data,
    path: 'assets/type-examples/../../.github/workflows/static.yml',
  }, { ip: '203.0.113.41' });
  assert.equal(outside.res.status, 400);
  assert.equal(outside.body.error, 'bad_path');

  const renamed = await post({
    action: 'te_blob', token: adminToken, data,
    path: 'assets/type-examples/media/000000000000.webp',
  }, { ip: '203.0.113.41' });
  assert.equal(renamed.res.status, 400);
  assert.equal(renamed.body.error, 'hash_mismatch');

  const huge = await post({
    action: 'te_blob', token: adminToken,
    path: 'assets/type-examples/media/' + '0'.repeat(12) + '.webp',
    data: Buffer.alloc(1024 * 1024 + 4).toString('base64'),
  }, { ip: '203.0.113.41' });
  assert.equal(huge.res.status, 413);
  assert.equal(gh.calls.length, 0);
  ok('저장소 밖 경로·내용과 다른 파일명·용량 초과를 서버가 다시 막는다');

  const blob = await post({ action: 'te_blob', token: adminToken, path: good, data }, { ip: '203.0.113.42' });
  assert.equal(blob.body.ok, true);
  assert.match(blob.body.sha, /^[0-9a-f]{40}$/);
  assert.equal(gh.calls.length, 1);
  assert.equal(gh.calls[0], 'POST /repos/YuYoung-ai/YuYoung/git/blobs');
  ok('검증을 통과한 파일만 blob으로 올린다(커밋 전이라 저장소에는 아직 보이지 않는다)');

  gh.calls.length = 0;
  const stray = await post({
    action: 'te_commit', token: adminToken,
    files: [{ path: good, sha: blob.body.sha }],
    manifest: manifestFor([]),                      /* 새 파일을 참조하지 않는 매니페스트 */
  }, { ip: '203.0.113.43' });
  assert.equal(stray.res.status, 400);
  assert.equal(stray.body.error, 'invalid_manifest');
  assert.equal(gh.calls.length, 0);

  const badSrc = await post({
    action: 'te_commit', token: adminToken, files: [],
    manifest: JSON.stringify({
      schema: 1, updatedAt: '2026-08-28',
      items: { '장비|외부': { symptom: { src: 'https://evil.example/x.webp', text: '' } } },
    }),
  }, { ip: '203.0.113.43' });
  assert.equal(badSrc.res.status, 400);
  assert.equal(badSrc.body.error, 'invalid_manifest');
  assert.equal(gh.calls.length, 0);
  ok('매니페스트가 검증을 통과하지 못하면 커밋을 시작조차 하지 않는다');

  const manifest = manifestFor([good]);
  const published = await post({
    action: 'te_commit', token: adminToken, summary: 'RFID 스캔 불량 증상',
    files: [{ path: good, sha: blob.body.sha }], manifest,
  }, { ip: '203.0.113.44' });
  assert.equal(published.body.ok, true, JSON.stringify(published.body));
  assert.equal(published.body.files, 1);
  assert.equal(published.body.branch, 'main');
  assert.match(published.body.url, /^https:\/\/github\.com\/YuYoung-ai\/YuYoung\/commit\/[0-9a-f]{40}$/);
  assert.deepEqual(gh.calls, [
    'GET /repos/YuYoung-ai/YuYoung/git/ref/heads/main',
    'GET /repos/YuYoung-ai/YuYoung/git/commits/' + gh.parents[0],
    'POST /repos/YuYoung-ai/YuYoung/git/trees',
    'POST /repos/YuYoung-ai/YuYoung/git/commits',
    'PATCH /repos/YuYoung-ai/YuYoung/git/refs/heads/main',
  ]);
  assert.deepEqual([...gh.files.keys()].sort(), [good, 'assets/type-examples/index.json'].sort());
  assert.equal(gh.files.get('assets/type-examples/index.json'), manifest);
  assert.match(gh.messages[0], /^예시자료 갱신 · RFID 스캔 불량 증상\n\n작업자: 테스트 관리자\n새 파일: 1개\n$/);
  ok('파일과 index.json을 커밋 하나로 묶고 작업자 이름을 커밋 메시지에 남긴다');

  gh.calls.length = 0;
  const again = await post({
    action: 'te_commit', token: adminToken, summary: 'RFID 스캔 불량 증상',
    files: [{ path: good, sha: blob.body.sha }], manifest,
  }, { ip: '203.0.113.44' });
  assert.equal(again.body.ok, true);
  assert.equal(again.body.unchanged, true);
  assert.equal(again.body.files, 0);
  assert.ok(!gh.calls.includes('POST /repos/YuYoung-ai/YuYoung/git/commits'));
  ok('같은 내용이 다시 오면(자동 재시도 등) 빈 커밋을 만들지 않는다');

  gh.calls.length = 0;
  gh.failRefOnce = true;
  const png2 = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 9, 9, 9, 9]);
  const good2 = 'assets/type-examples/media/' + (await hash12(png2)) + '.webp';
  const blob2 = await post({
    action: 'te_blob', token: adminToken, path: good2, data: Buffer.from(png2).toString('base64'),
  }, { ip: '203.0.113.45' });
  const raced = await post({
    action: 'te_commit', token: adminToken,
    files: [{ path: good2, sha: blob2.body.sha }], manifest: manifestFor([good, good2]),
  }, { ip: '203.0.113.45' });
  assert.equal(raced.body.ok, true, JSON.stringify(raced.body));
  assert.equal(gh.calls.filter((c) => c.startsWith('PATCH')).length, 2);
  assert.equal(gh.head, raced.body.commit);
  ok('그 사이 브랜치가 움직이면 base를 다시 읽어 한 번 재시도한다');

  const audits = await post({ action: 'audits', token: adminToken }, { ip: '203.0.113.46' });
  assert.ok(audits.body.audits.some((a) => a.event === 'te_publish' && a.result === 'ok'));
  assert.ok(audits.body.audits.every((a) => !('ip' in a)));
  ok('게시 이력을 감사 기록에 남긴다');
}

{
  const out = await post({ action: 'device_login', device: 'stolen-device-token' }, {
    ip: '203.0.113.12',
  });
  assert.equal(out.res.status, 403);
  assert.equal(out.body.error, 'device_auth_disabled');
  ok('프런트 설정과 무관하게 서버에서 device_*를 차단한다');
}

{
  const req = new Request('https://auth.example/?action=ping');
  const res = await handler(req, info('203.0.113.13'));
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.deviceAuth, false);
  assert.equal(body.googleAuth, true);
  assert.equal(body.tePublish, true);
  assert.equal(body.originPolicy, 'allowlist');
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  ok('Origin 없는 GAS·명령줄 요청은 유지하고 ping에 보안 상태를 표시한다');
}

{
  const broken = {
    method: 'GET',
    get url() { throw new Error('TOP_SECRET_STACK'); },
    headers: new Headers({ origin: 'https://allowed.example' }),
  };
  const res = await handler(broken, info('203.0.113.14'));
  const body = await res.json();
  assert.deepEqual(body, { ok: false, error: 'server_error' });
  assert.ok(!JSON.stringify(body).includes('TOP_SECRET_STACK'));
  ok('서버 오류 상세를 응답에 노출하지 않는다');
}

{
  env.set('DEVICE_AUTH_ENABLED', 'true');
  const rememberedKv = new MockKv();
  globalThis.Deno = {
    env: { get: (name) => env.get(name) },
    openKv: async () => rememberedKv,
    serve: (fn) => { handler = fn; return { finished: Promise.resolve() }; },
  };
  const rememberedSource = path.join(ROOT, 'test', '.tmp-deno-auth-remember.ts');
  fs.copyFileSync(SOURCE_PATH, rememberedSource);
  try {
    await import(pathToFileURL(rememberedSource).href);
  } finally {
    fs.unlinkSync(rememberedSource);
  }
  const admin = await post({ action: 'login', password: 'correct-password' }, { ip: '203.0.113.30' });
  const google = await post({ action: 'google_login', idToken: await googleIdToken(), remember: true }, { ip: '203.0.113.31' });
  assert.equal(google.body.ok, true, JSON.stringify(google.body));
  assert.ok(google.body.device);
  const restored = await post({ action: 'device_login', device: google.body.device }, { ip: '203.0.113.32' });
  assert.equal(restored.body.ok, true);
  assert.equal(restored.body.level, 2);
  await post({
    action: 'user_save', token: admin.body.token,
    email: 'allowed@gmail.com', name: '허용 사용자', level: 2, status: 'disabled',
  }, { ip: '203.0.113.30' });
  const revoked = await post({ action: 'device_login', device: google.body.device }, { ip: '203.0.113.32' });
  assert.equal(revoked.res.status, 403);
  assert.equal(revoked.body.error, 'revoked');
  ok('Google에서 기억한 기기도 사용자 중지 시 다음 자동 로그인을 차단한다');
}

assert.ok(!SOURCE.includes('"Access-Control-Allow-Origin": "*"'));
assert.ok(!SOURCE.includes('detail: String(err)'));
assert.match(SOURCE, /info\.remoteAddr/);
assert.match(SOURCE, /uid: user\.email/);
assert.match(SOURCE, /user\.status !== "active"/);
ok('와일드카드 CORS·오류 detail을 제거하고 연결 메타데이터 IP를 사용한다');

console.log(`\n통과 ${passed}/${passed}`);
console.log('Deno 인증 1차 보안 회귀 테스트 통과 ✅');
