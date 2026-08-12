import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const auth = fs.readFileSync(path.join(root, 'auth.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

let passed = 0;
function ck(name, cond) {
  assert.ok(cond, name);
  passed++;
  console.log('✅ ' + name);
}

const inlineScripts = [...index.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
inlineScripts.forEach((code, i) => {
  try { new Function(code); } catch (e) { throw new Error(`index inline script ${i + 1}: ${e.message}`); }
});
ck('index의 인라인 스크립트 구문이 유효하다', inlineScripts.length >= 2);
ck('Google 로그인 버튼 컨테이너가 있다', index.includes('id="hubGoogleButton"'));
ck('Google ID credential을 서버 로그인으로 교환한다', index.includes('BazAuth.loginWithGoogle(resp&&resp.credential,'));
ck('Google 로그인도 선택 시 이 기기를 기억한다', index.includes("document.getElementById('hubRemember')") && auth.includes("action: 'google_login', idToken: idToken, remember: wantRemember"));
ck('서버 config가 활성일 때만 Google 버튼을 표시한다', index.includes('if(!cfg.googleAuth||!cfg.googleClientId) return;'));
ck('미등록 Google 계정 전용 안내가 있다', index.includes("r.error==='access_denied'"));
ck('Lv.3 보안 관리 버튼과 모달이 있다', index.includes('id="appBtnSecurityAdmin"') && index.includes('id="securityAdminModal"'));
ck('사용자 추가·권한·중지 요청이 서버 API를 사용한다', index.includes("adminRequest('user_save'") && index.includes("adminRequest('users'"));
ck('기기 목록과 개별 해지 요청이 서버 API를 사용한다', index.includes("adminRequest('devices'") && index.includes("adminRequest('device_revoke'"));
ck('최근 감사 기록을 Lv.3 관리 화면에서 조회한다', index.includes('id="securityAuditList"') && index.includes("adminRequest('audits'"));
ck('auth.js가 config·Google 로그인·관리 요청을 공개한다', /config:\s*function/.test(auth) && /loginWithGoogle:\s*function/.test(auth) && /adminRequest:\s*function/.test(auth));
ck('기기 서버 비활성 응답이면 로컬 기기 토큰도 지운다', auth.includes("r.error === 'device_auth_disabled'"));
ck('서비스워커 캐시가 새 인증 UI 버전으로 올라갔다', sw.includes("baz-cs-v123"));

console.log(`\n통과 ${passed}/${passed}`);
console.log('Google 로그인·보안 관리 UI 회귀 테스트 통과 ✅');
