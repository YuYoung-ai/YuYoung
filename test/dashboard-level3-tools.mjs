import fs from 'fs';
import vm from 'vm';

const DASH = fs.readFileSync(new URL('../dashboard-pc.html', import.meta.url), 'utf8');
let pass = 0, total = 0;
const fails = [];
function ck(name, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(name + (detail ? ' — ' + detail : ''));
  console.log(cond ? '✅' : '❌', name, detail);
}

function button(id) {
  const m = DASH.match(new RegExp('<button\\b[^>]*\\bid="' + id + '"[^>]*>[\\s\\S]*?<\\/button>'));
  return m ? m[0] : '';
}

const ids = ['recordBtn', 'weeklyBtn', 'monthlyBtn', 'saturdayDutyBtn', 'teMgrBtn'];
const buttons = ids.map(button);
const allButtonTags = DASH.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) || [];
const restricted = allButtonTags.filter(tag => /\bdata-level3-tool\b/.test(tag));

ck('1. 요청한 다섯 버튼이 모두 고유 ID를 가진다', buttons.every(Boolean));
ck('2. 레벨 3 전용 표시는 정확히 다섯 버튼에만 붙는다',
  restricted.length === 5 && ids.every(id => restricted.some(tag => tag.includes('id="' + id + '"'))),
  'count=' + restricted.length);
ck('3. 권한 판정 전 화면 깜빡임을 막도록 다섯 버튼이 기본 hidden이다',
  buttons.every(tag => /\bdata-level3-tool\b/.test(tag) && /\bhidden\b/.test(tag)));
ck('4. 메뉴·새로고침·테마·화면 모드 버튼은 기존처럼 제한하지 않는다',
  !/data-level3-tool/.test(button('themeToggle')) &&
  /onclick="loadData\(true\)"/.test(DASH) &&
  !/<button[^>]*data-level3-tool[^>]*onclick="loadData\(true\)"/.test(DASH));

const accessBlock = (DASH.match(/function exDashboardAuthLevel_\(\)[\s\S]*?exApplyLevel3Tools_\(\);/) || [''])[0];
const nodes = ids.map(() => ({ hidden: false, disabled: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }));
const sandbox = {
  window: {},
  document: { querySelectorAll: () => nodes },
  location: { href: 'dashboard-pc.html' },
  toastMessage: '',
  toast(msg) { sandbox.toastMessage = msg; }
};
sandbox.window.BazAuth = sandbox.BazAuth = { cachedLevel: () => 2 };
vm.runInNewContext(accessBlock, sandbox);

ck('5. 레벨 1·2에서는 다섯 버튼을 숨기고 비활성화한다',
  nodes.every(n => n.hidden && n.disabled && n.attrs['aria-hidden'] === 'true'));
sandbox.BazAuth.cachedLevel = () => 3;
sandbox.exApplyLevel3Tools_();
ck('6. 레벨 3에서만 다섯 버튼을 표시하고 활성화한다',
  nodes.every(n => !n.hidden && !n.disabled && n.attrs['aria-hidden'] === 'false'));
sandbox.BazAuth.cachedLevel = () => 2;
sandbox.exOpenLevel3Page_('handover.html');
ck('7. 레벨 2의 기록 직접 호출도 이동하지 않고 안내한다',
  sandbox.location.href === 'dashboard-pc.html' && /레벨 3/.test(sandbox.toastMessage));
sandbox.BazAuth.cachedLevel = () => 3;
sandbox.exOpenLevel3Page_('handover.html');
ck('8. 레벨 3의 기록 버튼은 기존 handover 이동을 유지한다', sandbox.location.href === 'handover.html');

ck('9. 보고·당직·예시관리 진입 함수도 직접 호출을 레벨 3으로 방어한다',
  /function openWeekly\(\)\{\s*if\(!exRequireLevel3_\(\)\) return;/.test(DASH) &&
  /function openMonthly\(\)\{\s*if\(!exRequireLevel3_\(\)\) return;/.test(DASH) &&
  /function openSaturdayDuty\(\)\{\s*if\(!exRequireLevel3_\(\)\) return;/.test(DASH) &&
  /function exOpenTypeExampleManager\(\)\{\s*if\(!exRequireLevel3_\(\)\) return;/.test(DASH));
ck('10. 인증 라이브러리가 없거나 레벨값이 비정상이면 fail-closed로 숨긴다',
  /return \(window\.BazAuth&&typeof BazAuth\.cachedLevel==='function'\)[\s\S]*?return 0;/.test(accessBlock));

console.log('\n──────────────────────────────');
console.log(`통과 ${pass}/${total}`);
if (fails.length) {
  console.error('실패:\n - ' + fails.join('\n - '));
  process.exit(1);
}
console.log('모든 테스트 통과 ✅');
