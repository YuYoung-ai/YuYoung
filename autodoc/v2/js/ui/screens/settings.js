/************************************************************
 * settings.js — 설정 (SETTINGS_UX.md)
 * ----------------------------------------------------------
 * 내 설정(Theme·Font) · 회사 설정(백업/복원 — GAS backup.*).
 ************************************************************/
import { h, clear } from '../dom.js';
import { prefs } from '../../core/prefs.js';
import { api } from '../../infra/api.js';
import { auth } from '../../infra/auth.js';

export function settingsScreen() {
  let outletEl = null;

  function seg(label, value, options, onPick) {
    const row = h('div', { class: 'set-row' }, [h('div', { class: 'set-label', text: label })]);
    const grp = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
    options.forEach(([v, t]) => grp.appendChild(h('button', {
      class: 'seg-btn' + (v === value ? ' on' : ''), role: 'radio', 'aria-checked': v === value ? 'true' : 'false',
      onclick: () => onPick(v),
    }, [t])));
    row.appendChild(grp);
    return row;
  }

  function render() {
    clear(outletEl);
    const p = prefs.get();
    outletEl.appendChild(h('h1', { class: 'screen-title', text: '설정' }));

    // 내 설정
    const my = h('div', { class: 'card' }, [h('b', { text: '내 설정' })]);
    my.appendChild(seg('테마', p.theme, [['light', '라이트'], ['dark', '다크'], ['system', '시스템']], v => { prefs.set({ theme: v }); render(); }));
    my.appendChild(seg('글자 크기', String(p.fontScale), [['1', '100%'], ['1.15', '115%'], ['1.3', '130%']], v => { prefs.set({ fontScale: Number(v) }); render(); }));
    my.appendChild(seg('언어', 'ko', [['ko', '한국어']], () => {}));
    outletEl.appendChild(my);

    // 회사 설정 (관리자)
    if (auth.session() && auth.session().role === 'admin') {
      const org = h('div', { class: 'card' }, [
        h('b', { text: '회사 설정' }),
        h('div', { class: 'tpl-meta', text: '모든 사용자에게 적용 · 백엔드(GAS) 기준' }),
      ]);
      const status = h('div', { class: 'gen-status' });
      const backupBtn = h('button', { class: 'btn', onclick: async () => {
        status.textContent = '백업 생성 중…';
        try {
          const r = await api.request('v2.backup.export', {});
          const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob); const a = document.createElement('a');
          a.href = url; a.download = 'autodoc-backup-' + new Date().toISOString().slice(0, 10) + '.json';
          document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
          status.textContent = '백업 다운로드 완료';
        } catch (e) { status.textContent = '백업 실패 — 백엔드 연결 확인'; }
      } }, ['백업 만들기']);

      const restoreInput = h('input', { type: 'file', accept: 'application/json', style: 'display:none',
        onchange: async (e) => {
          const f = e.target.files[0]; if (!f) return;
          if (!confirm('복원하면 현재 서버 데이터에 백업 내용이 병합됩니다. 진행할까요?')) return;
          status.textContent = '복원 중…';
          try {
            const text = await f.text(); const parsed = JSON.parse(text);
            const backup = parsed.backup || parsed.payload && parsed.payload.backup || parsed;
            const r = await api.request('v2.backup.restore', { backup });
            status.textContent = `복원 완료 — ${r.restored || 0}건 반영`;
          } catch (err) { status.textContent = '복원 실패 — 파일/연결 확인'; }
        } });
      const restoreBtn = h('button', { class: 'btn', onclick: () => restoreInput.click() }, ['복원…']);

      org.appendChild(h('div', { class: 'set-row' }, [h('div', { class: 'set-label', text: '백업 / 복원' }), h('div', { class: 'seg' }, [backupBtn, restoreBtn, restoreInput])]));
      org.appendChild(status);
      outletEl.appendChild(org);
    }
  }

  return {
    mount(outlet) { outletEl = outlet; render(); },
    unmount() { if (outletEl) clear(outletEl); },
  };
}
