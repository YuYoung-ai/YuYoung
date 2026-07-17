/************************************************************
 * form-engine.js — 폼 자동 생성 (FORM_ENGINE_SPEC)
 * ----------------------------------------------------------
 * Template inputs 스키마 → 입력 컴포넌트 트리(DOM).
 * 타입: text/number/date/week/textarea/select/radio/checkbox/table
 *       /image/signature/file/repeat/dynamic + 조건부(showIf)
 * 값 바인딩 · 진행률 · blur 검증 · 조건부 표시 · 제안 칩.
 ************************************************************/
import { validator, evalCondition } from './validator.js';

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c != null && c !== false) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}
const uid = (() => { let n = 0; return () => 'f' + (++n); })();

export function createForm(tpl, opts = {}) {
  const values = JSON.parse(JSON.stringify(opts.initialValues || {}));
  const onChange = opts.onChange || (() => {});
  const suggestFn = opts.suggest || null;            // (fieldKey, values) -> [{label,value}]
  const onSuggestAccept = opts.onSuggestAccept || (() => {});
  const fieldEls = new Map();                          // key -> { wrap, errEl, def }

  function emit(changedPaths) {
    applyConditions();
    onChange({ values: getValues(), changedPaths, progress: validator.progress(values, tpl) });
  }
  function getValues() { return JSON.parse(JSON.stringify(values)); }

  // ── 개별 컨트롤 (bind 로 중첩 값 지원) ──────────────────
  function bindTop(key) { return { get: () => values[key], set: v => { values[key] = v; } }; }

  function control(f, bind, pathLabel) {
    const id = uid();
    const type = f.type || 'text';
    const g = () => bind.get();
    const s = (v, path) => { bind.set(v); emit([path || pathLabel || f.key]); };

    if (type === 'textarea') {
      const ta = h('textarea', { id, class: 'field-input', rows: f.rows || 3, placeholder: f.placeholder || '',
        oninput: e => s(e.target.value), onblur: () => validateField(f) });
      ta.value = g() || ''; return { id, node: withSuggest(f, ta, v => { ta.value = v; s(v); }) };
    }
    if (type === 'select') {
      const sel = h('select', { id, class: 'field-input', onchange: e => s(e.target.value) });
      sel.appendChild(h('option', { value: '', text: '선택…' }));
      for (const o of (f.options || [])) { const opt = h('option', { value: o, text: o }); if (g() === o) opt.selected = true; sel.appendChild(opt); }
      return { id, node: sel };
    }
    if (type === 'radio') {
      const group = h('div', { id, class: 'field-radio', role: 'radiogroup', 'aria-label': f.label || f.key });
      for (const o of (f.options || [])) {
        const rid = uid();
        const input = h('input', { type: 'radio', id: rid, name: id, value: o, onchange: () => s(o) });
        if (g() === o) input.checked = true;
        group.appendChild(h('label', { for: rid, class: 'radio-opt' }, [input, ' ' + o]));
      }
      return { id, node: group };
    }
    if (type === 'checkbox') {
      const cid = uid();
      const input = h('input', { type: 'checkbox', id: cid, onchange: e => s(e.target.checked) });
      if (g()) input.checked = true;
      return { id: cid, node: h('label', { class: 'checkbox-opt', for: cid }, [input, ' ' + (f.text || f.label || '')]) };
    }
    if (type === 'image' || type === 'file') {
      const cid = uid();
      const isImg = type === 'image';
      const input = h('input', { type: 'file', id: cid, accept: isImg ? 'image/*' : (f.accept || '*/*'),
        onchange: e => onFile(e.target.files && e.target.files[0], isImg, cid) });
      const wrap = h('div', { class: 'field-file' }, [input, h('div', { class: 'file-preview', id: 'pv' + cid })]);
      function onFile(file, asImage, key) {
        if (!file) return;
        const pv = wrap.querySelector('#pv' + key);
        if (asImage && typeof FileReader !== 'undefined') {
          const r = new FileReader();
          r.onload = () => { s({ name: file.name, dataUrl: r.result }); if (pv) pv.innerHTML = ''; if (pv) pv.appendChild(h('img', { src: r.result, class: 'thumb', alt: file.name })); };
          r.readAsDataURL(file);
        } else { s({ name: file.name, size: file.size }); if (pv) pv.textContent = file.name; }
      }
      const cur = g();
      if (cur && cur.dataUrl) wrap.querySelector('#pv' + cid).appendChild(h('img', { src: cur.dataUrl, class: 'thumb', alt: cur.name || '' }));
      else if (cur && cur.name) wrap.querySelector('#pv' + cid).textContent = cur.name;
      return { id: cid, node: wrap };
    }
    if (type === 'signature') {
      const cnv = h('canvas', { id, class: 'sign-pad', width: 320, height: 120, 'aria-label': (f.label || '서명') + ' 패드' });
      setupSignature(cnv, dataUrl => s(dataUrl));
      const clear = h('button', { type: 'button', class: 'btn small', onclick: () => { clearCanvas(cnv); s(''); } }, ['지우기']);
      if (g() && cnv.getContext) drawDataUrl(cnv, g());
      return { id, node: h('div', { class: 'field-sign' }, [cnv, clear]) };
    }
    if (type === 'table') return { id, node: tableControl(f, bind) };
    if (type === 'repeat') return { id, node: repeatControl(f, bind) };

    // text / number / date / week
    const nativeType = { number: 'number', date: 'date', week: 'week' }[type] || 'text';
    // 기본값: week 은 이번 주차 자동, date 는 default:'today' 지원 (미지원 브라우저에서도 필수 충족)
    if (type === 'week' && (g() == null || g() === '')) bind.set(isoWeekString(new Date()));
    if (type === 'date' && (g() == null || g() === '') && f.default === 'today') bind.set(todayString());
    const input = h('input', { id, class: 'field-input', type: nativeType, placeholder: f.placeholder || '',
      oninput: e => {
        // number 를 비우면 valueAsNumber 가 NaN — 빈 값('')으로 저장해 검증·미리보기 오염 방지
        const n = e.target.valueAsNumber;
        s(nativeType === 'number' ? (Number.isNaN(n) ? '' : n) : e.target.value);
      }, onblur: () => validateField(f) });
    if (g() != null) input.value = g();
    // type=week 미지원(Firefox/Safari) → 텍스트 강등: 형식 힌트 제공
    if (type === 'week' && input.type !== 'week') {
      input.setAttribute('placeholder', '예: ' + isoWeekString(new Date()));
      const wrap = h('div', {}, [input, h('div', { class: 'field-hint', text: '주차 형식: YYYY-Www — 이번 주가 자동 입력되어 있습니다.' })]);
      return { id, node: wrap };
    }
    return { id, node: withSuggest(f, input, v => { input.value = v; s(v); }) };
  }

  // 제안 칩 (텍스트류)
  function withSuggest(f, inputEl, apply) {
    if (!suggestFn || !['text', 'textarea', undefined].includes(f.type)) return inputEl;
    const chipRow = h('div', { class: 'suggest-row' });
    function refresh() {
      const items = (suggestFn(f.key, values) || []).slice(0, 2);
      chipRow.innerHTML = '';
      for (const it of items) chipRow.appendChild(h('button', { type: 'button', class: 'chip',
        onclick: () => { apply(it.value); onSuggestAccept(f.key, it.value); refresh(); } }, ['💡 ' + (it.label || it.value)]));
    }
    refresh();
    return h('div', {}, [inputEl, chipRow]);
  }

  // 표
  function tableControl(f, bind) {
    const cols = f.columns || [];
    if (!Array.isArray(bind.get())) bind.set([]);
    const rows = bind.get();
    const wrap = h('div', { class: 'field-table-wrap' });
    const table = h('table', { class: 'field-table' });
    const thead = h('thead', {}, [h('tr', {}, cols.map(c => h('th', { text: c.label || c.key })).concat(h('th', { text: '' })))]);
    const tbody = h('tbody');
    function renderRows() {
      tbody.innerHTML = '';
      rows.forEach((row, ri) => {
        const tds = cols.map(c => h('td', {}, [cellControl(c, row, ri, f.key)]));
        const dup = h('button', { type: 'button', class: 'btn small', 'aria-label': '행 복제',
          onclick: () => { rows.splice(ri + 1, 0, JSON.parse(JSON.stringify(row))); renderRows(); emit([f.key]); } }, ['⧉']);
        const del = h('button', { type: 'button', class: 'btn small', 'aria-label': '행 삭제',
          onclick: () => { rows.splice(ri, 1); renderRows(); emit([f.key]); } }, ['🗑']);
        tbody.appendChild(h('tr', {}, tds.concat(h('td', {}, [dup, del]))));
      });
    }
    renderRows();
    table.appendChild(thead); table.appendChild(tbody);
    const add = h('button', { type: 'button', class: 'btn small', onclick: () => { rows.push({}); renderRows(); emit([f.key]); } }, ['+ 행 추가']);
    wrap.appendChild(table); wrap.appendChild(add);
    return wrap;
  }
  function cellControl(c, row, ri, key) {
    const ctype = c.type || 'text';
    if (ctype === 'select') {
      const cell = h('select', { class: 'cell-input', onchange: e => { row[c.key] = e.target.value; emit([`${key}[${ri}].${c.key}`]); } });
      cell.appendChild(h('option', { value: '', text: '-' }));
      for (const o of (c.options || [])) { const opt = h('option', { value: o, text: o }); if (row[c.key] === o) opt.selected = true; cell.appendChild(opt); }
      return cell;
    }
    if (ctype === 'textarea') { const cell = h('textarea', { class: 'cell-input', rows: 1, oninput: e => { row[c.key] = e.target.value; emit([`${key}[${ri}].${c.key}`]); } }); cell.value = row[c.key] || ''; return cell; }
    const nt = { date: 'date', number: 'number' }[ctype] || 'text';
    const cell = h('input', { class: 'cell-input', type: nt, oninput: e => { row[c.key] = e.target.value; emit([`${key}[${ri}].${c.key}`]); } });
    if (row[c.key] != null) cell.value = row[c.key];
    return cell;
  }

  // Repeat Block — 묶음 반복(그룹 배열)
  function repeatControl(f, bind) {
    if (!Array.isArray(bind.get())) bind.set([]);
    const groups = bind.get();
    const wrap = h('div', { class: 'field-repeat' });
    const listEl = h('div', { class: 'repeat-list' });
    function renderGroups() {
      listEl.innerHTML = '';
      groups.forEach((grp, gi) => {
        const body = h('div', { class: 'repeat-body' });
        (f.fields || []).forEach(sub => {
          const b = { get: () => grp[sub.key], set: v => { grp[sub.key] = v; } };
          const { id, node } = control(sub, b, `${f.key}[${gi}].${sub.key}`);
          body.appendChild(h('div', { class: 'field' }, [h('label', { for: id, class: 'field-label', text: sub.label || sub.key }), node]));
        });
        const bar = h('div', { class: 'repeat-bar' }, [
          h('span', { class: 'tpl-meta', text: `#${gi + 1}` }),
          h('button', { type: 'button', class: 'btn small', onclick: () => { groups.splice(gi + 1, 0, JSON.parse(JSON.stringify(grp))); renderGroups(); emit([f.key]); } }, ['⧉ 복제']),
          h('button', { type: 'button', class: 'btn small', onclick: () => { groups.splice(gi, 1); renderGroups(); emit([f.key]); } }, ['🗑 삭제']),
        ]);
        listEl.appendChild(h('div', { class: 'repeat-item card' }, [bar, body]));
      });
    }
    renderGroups();
    const add = h('button', { type: 'button', class: 'btn small', onclick: () => { groups.push({}); renderGroups(); emit([f.key]); } }, ['+ ' + (f.addLabel || '항목 추가')]);
    wrap.appendChild(listEl); wrap.appendChild(add);
    return wrap;
  }

  function validateField(f) {
    const r = validator.validateField(f, values);
    const rec = fieldEls.get(f.key);
    if (rec) { rec.errEl.textContent = r.ok ? '' : r.msg; rec.wrap.classList.toggle('has-error', !r.ok); }
    return r.ok;
  }

  // 조건부 표시 (showIf)
  function applyConditions() {
    for (const [, rec] of fieldEls) {
      if (rec.def.showIf) rec.wrap.hidden = !evalCondition(rec.def.showIf, values);
    }
  }

  // ── 폼 조립 ─────────────────────────────────────────────
  const root = h('form', { class: 'ad-form', onsubmit: e => e.preventDefault() });

  function fieldRow(f) {
    // dynamic 은 하위 필드를 담는 그룹 컨테이너
    if (f.type === 'dynamic') {
      const box = h('fieldset', { class: 'dynamic-section' }, [h('legend', { text: f.label || '' })]);
      (f.fields || []).forEach(sub => box.appendChild(fieldRow(sub)));
      const wrap = box;
      fieldEls.set(f.key || uid(), { wrap, errEl: h('div'), def: f });
      return wrap;
    }
    const { id, node } = control(f, bindTop(f.key), f.key);
    const errEl = h('div', { class: 'field-err', 'aria-live': 'polite' });
    const wrap = h('div', { class: 'field' }, [
      h('label', { for: id, class: 'field-label' }, [f.label || f.key, f.required ? h('span', { class: 'req', text: ' *' }) : null]),
      node, errEl,
    ]);
    fieldEls.set(f.key, { wrap, errEl, def: f });
    return wrap;
  }

  const required = (tpl.inputs || []).filter(f => f.required);
  const optional = (tpl.inputs || []).filter(f => !f.required);
  required.forEach(f => root.appendChild(fieldRow(f)));
  if (optional.length) {
    const details = h('details', { class: 'optional-group' }, [h('summary', { text: `추가 정보 (${optional.length})` })]);
    optional.forEach(f => details.appendChild(fieldRow(f)));
    root.appendChild(details);
  }
  applyConditions();

  return {
    el: root,
    getValues,
    setValues(v) { Object.assign(values, JSON.parse(JSON.stringify(v))); },
    validate: () => validator.validate(values, tpl),
    progress: () => validator.progress(values, tpl),
    focusFirstError() {
      const r = validator.validate(values, tpl);
      if (!r.ok && r.errors[0]) { const rec = fieldEls.get(r.errors[0].key); if (rec) { rec.wrap.classList.add('has-error'); rec.errEl.textContent = r.errors[0].msg; rec.wrap.scrollIntoView && rec.wrap.scrollIntoView({ block: 'center' }); } }
      return r;
    },
    isVisible(key) { const rec = fieldEls.get(key); return rec ? !rec.wrap.hidden : false; },
    destroy() { root.remove(); fieldEls.clear(); },
  };
}

// ── 서명 패드 (canvas) ─────────────────────────────────────
function setupSignature(cnv, onEnd) {
  const ctx = cnv.getContext && cnv.getContext('2d');
  if (!ctx) return;
  ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#0F172A';
  let drawing = false;
  const pos = e => { const r = cnv.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; return { x: p.clientX - r.left, y: p.clientY - r.top }; };
  const start = e => { drawing = true; const { x, y } = pos(e); ctx.beginPath(); ctx.moveTo(x, y); e.preventDefault(); };
  const move = e => { if (!drawing) return; const { x, y } = pos(e); ctx.lineTo(x, y); ctx.stroke(); e.preventDefault(); };
  const end = () => { if (!drawing) return; drawing = false; onEnd(cnv.toDataURL('image/png')); };
  cnv.addEventListener('pointerdown', start); cnv.addEventListener('pointermove', move);
  cnv.addEventListener('pointerup', end); cnv.addEventListener('pointerleave', end);
}
function clearCanvas(cnv) { const c = cnv.getContext && cnv.getContext('2d'); if (c) c.clearRect(0, 0, cnv.width, cnv.height); }

/* ── 날짜 기본값 헬퍼 ─────────────────────────────────────── */
export function todayString(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/** ISO 8601 주차 (월요일 시작) — <input type=week> 값 형식 YYYY-Www */
export function isoWeekString(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = (d.getUTCDay() + 6) % 7;          // 월=0
  d.setUTCDate(d.getUTCDate() - day + 3);       // 이번 주 목요일
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fday = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fday + 3);
  const week = 1 + Math.round((d - firstThu) / (7 * 24 * 3600 * 1000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
function drawDataUrl(cnv, url) { const c = cnv.getContext && cnv.getContext('2d'); if (!c) return; const img = new Image(); img.onload = () => c.drawImage(img, 0, 0); img.src = url; }
