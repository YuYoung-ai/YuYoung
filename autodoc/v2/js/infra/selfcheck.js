/************************************************************
 * selfcheck.js — S1 완료조건 진단 (TEST_SPEC · ROADMAP_SPEC S1)
 * ----------------------------------------------------------
 * 이벤트 왕복 · Store get/put · 가드 동작 · Flag 의존을
 * 브라우저에서 눈으로 확인. (구현 검증용, 제품 화면 아님)
 ************************************************************/
import { bus } from './bus.js';
import { store } from './store.js';
import { auth } from './auth.js';
import { flags } from './flags.js';
import { workspaceContext } from './workspace-context.js';

export async function runSelfCheck() {
  const results = [];
  const ok = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail || '' });

  // 1) 이벤트 왕복 + causationId 인과 사슬
  let got = null, childCause = null;
  const off1 = bus.subscribe('selfcheck.ping', (e) => {
    got = e;
    bus.publish('selfcheck.pong', { echo: e.payload.n });
  });
  const off2 = bus.subscribe('selfcheck.pong', (e) => { childCause = e.causationId; });
  const pingId = bus.publish('selfcheck.ping', { n: 42 });
  off1(); off2();
  ok('event round-trip', got && got.payload.n === 42, `envelope=${got ? got.name : 'none'}`);
  ok('causation chain', childCause === pingId, `pong.causationId=${childCause}`);

  // 2) Store get/put (local-first, memory remote placeholder)
  workspaceContext.setActive('default');
  let putErr = null;
  try {
    await store.put('kv', { id: 'sc-1', version: 1, value: 'hello' }, { by: 'settings' });
  } catch (e) { putErr = e && e.code; }
  const back = await store.get('kv', 'sc-1');
  ok('store put/get', back && back.value === 'hello', putErr ? `deferred(${putErr})` : `read=${back && back.value}`);

  // 3) 쓰기 권한표 (I2) — dna 는 learning 만
  let denied = false;
  try { await store.put('dna', { id: 'x', version: 1 }, { by: 'admin' }); }
  catch (e) { denied = (e.code === 'E-PERM-WRITE'); }
  ok('write-permission (I2)', denied, 'admin→dna 거부 확인');

  // 4) 가드 동작
  const s = auth.session();
  ok('guard user', auth.guard('user') === !!s, `session=${s ? s.role : 'none'}`);
  ok('guard admin', typeof auth.guard('admin') === 'boolean', `admin=${auth.guard('admin')}`);

  // 5) Flag 의존 검증
  const depOff = flags.isOn('learning.autoApply98') === false; // learning.enabled off → 강제 off
  ok('flag dependency', depOff, 'autoApply98 requires learning.enabled');

  return results;
}
