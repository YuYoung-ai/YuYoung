/************************************************************
 * form-engine.js — 폼 자동 생성 (FORM_ENGINE_SPEC)
 * ----------------------------------------------------------
 * Template inputs 스키마 → 입력 컴포넌트 트리(DOM).
 * 값 바인딩 · 진행률 · blur 검증 · 변경 시 changedPaths 통지.
 * S2 지원 타입: text/number/date/week/textarea/select/radio/checkbox/table
 ************************************************************/
import { validator } from './validator.js';

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v != null) el.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

const uid = (() => { let n = 0; return () => 'f' + (++n); })();

export function createForm(tpl, opts = {}) {
  const values = { ...(opts.initialValues || {}) };
  const onChange = opts.onChange || (() => {});
  const fieldEls = new Map(); // key -> { wrap, errEl }

  function emit(changedPaths) {
    onChange({ values: { ...values }, changedPaths, progress: validator.progress(values, tpl) });
  }

  function labelFor(f, id) {
    return h('label', { for: id, class: 'field-label' }, [
      f.label || f.key, f.required ? h('span', { class: 'req', text: ' *', 'aria-hidden': 'true' }) : null,
    ]);
  }

  function setVal(key, val, path) {
    values[key] = val;
    emit([path || key]);
  }

  function control(f) {
    const id = uid();
    const type = f.type || 'text';

    if (type === 'textarea') {
      const ta = h('textarea', { id, class: 'field-input', rows: f.rows || 3, placeholder: f.placeholder || '',
        'aria-required': f.required ? 'true' : null,
        oninput: e => setVal(f.key, e.target.value), onblur: () => validateField(f) });
      ta.value = values[f.key] || '';
      return { id, node: ta };
    }
    if (type === 'select') {
      const sel = h('select', { id, class: 'field-input', 'aria-required': f.required ? 'true' : null,
        onchange: e => setVal(f.key, e.target.value), onblur: () => validateField(f) });
      sel.appendChild(h('option', { value: '', text: '선택…' }));
      for (const o of (f.options || [])) {
        const opt = h('option', { value: o, text: o });
        if (values[f.key] === o) opt.selected = true;
        sel.appendChild(opt);
      }
      return { id, node: sel };
    }
    if (type === 'radio') {
      const group = h('div', { id, class: 'field-radio', role: 'radiogroup', 'aria-label': f.label || f.key });
      for (const o of (f.options || [])) {
        const rid = uid();
        const input = h('input', { type: 'radio', id: rid, name: f.key, value: o,
          onchange: () => setVal(f.key, o) });
        if (values[f.key] === o) input.checked = true;
        group.appendChild(h('label', { for: rid, class: 'radio-opt' }, [input, ' ' + o]));
      }
      return { id, node: group };
    }
    if (type === 'checkbox') {
      const cid = uid();
      const input = h('input', { type: 'checkbox', id: cid, onchange: e => setVal(f.key, e.target.checked) });
      if (values[f.key]) input.checked = true;
      return { id: cid, node: h('label', { class: 'checkbox-opt', for: cid }, [input, ' ' + (f.text || f.label || '')]) };
    }
    if (type === 'table') {
      return { id, node: tableControl(f) };
    }
    // text / number / date / week (기본 input)
    const nativeType = { number: 'number', date: 'date', week: 'week' }[type] || 'text';
    const input = h('input', { id, class: 'field-input', type: nativeType, placeholder: f.placeholder || '',
      'aria-required': f.required ? 'true' : null,
      oninput: e => setVal(f.key, nativeType === 'number' ? e.target.valueAsNumber : e.target.value),
      onblur: () => validateField(f) });
    if (values[f.key] != null) input.value = values[f.key];
    return { id, node: input };
  }

  function tableControl(f) {
    const cols = f.columns || [];
    const rows = Array.isArray(values[f.key]) ? values[f.key] : (values[f.key] = []);
    const wrap = h('div', { class: 'field-table-wrap' });
    const table = h('table', { class: 'field-table' });
    const thead = h('thead', {}, [h('tr', {}, cols.map(c => h('th', { text: c.label || c.key })).concat(h('th', { text: '' })))]);
    const tbody = h('tbody');

    function renderRows() {
      tbody.innerHTML = '';
      rows.forEach((row, ri) => {
        const tds = cols.map(c => {
          const ctype = c.type || 'text';
          let cell;
          if (ctype === 'select') {
            cell = h('select', { class: 'cell-input', onchange: e => { row[c.key] = e.target.value; emit([`${f.key}[${ri}].${c.key}`]); } });
            cell.appendChild(h('option', { value: '', text: '-' }));
            for (const o of (c.options || [])) { const opt = h('option', { value: o, text: o }); if (row[c.key] === o) opt.selected = true; cell.appendChild(opt); }
          } else if (ctype === 'textarea') {
            cell = h('textarea', { class: 'cell-input', rows: 1, oninput: e => { row[c.key] = e.target.value; emit([`${f.key}[${ri}].${c.key}`]); } });
            cell.value = row[c.key] || '';
          } else {
            const nt = { date: 'date', number: 'number' }[ctype] || 'text';
            cell = h('input', { class: 'cell-input', type: nt, oninput: e => { row[c.key] = e.target.value; emit([`${f.key}[${ri}].${c.key}`]); } });
            if (row[c.key] != null) cell.value = row[c.key];
          }
          return h('td', {}, [cell]);
        });
        const del = h('button', { type: 'button', class: 'btn small', 'aria-label': '행 삭제',
          onclick: () => { rows.splice(ri, 1); renderRows(); emit([f.key]); } }, ['🗑']);
        tbody.appendChild(h('tr', {}, tds.concat(h('td', {}, [del]))));
      });
    }
    renderRows();
    table.appendChild(thead); table.appendChild(tbody);
    const add = h('button', { type: 'button', class: 'btn small',
      onclick: () => { rows.push({}); renderRows(); emit([f.key]); } }, ['+ 행 추가']);
    wrap.appendChild(table); wrap.appendChild(add);
    return wrap;
  }

  function validateField(f) {
    const r = validator.validateField(f, values);
    const rec = fieldEls.get(f.key);
    if (rec) {
      rec.errEl.textContent = r.ok ? '' : r.msg;
      rec.wrap.classList.toggle('has-error', !r.ok);
    }
    return r.ok;
  }

  // 폼 조립: 필수 먼저, 선택은 접어서
  const root = h('form', { class: 'ad-form', onsubmit: e => e.preventDefault() });
  const required = (tpl.inputs || []).filter(f => f.required);
  const optional = (tpl.inputs || []).filter(f => !f.required);

  function fieldRow(f) {
    const { id, node } = control(f);
    const errEl = h('div', { class: 'field-err', 'aria-live': 'polite' });
    const wrap = h('div', { class: 'field' }, [labelFor(f, id), node, errEl]);
    fieldEls.set(f.key, { wrap, errEl });
    return wrap;
  }

  required.forEach(f => root.appendChild(fieldRow(f)));
  if (optional.length) {
    const details = h('details', { class: 'optional-group' }, [h('summary', { text: `추가 정보 (${optional.length})` })]);
    optional.forEach(f => details.appendChild(fieldRow(f)));
    root.appendChild(details);
  }

  return {
    el: root,
    getValues: () => ({ ...values }),
    setValues: (v) => { Object.assign(values, v); },
    validate: () => validator.validate(values, tpl),
    progress: () => validator.progress(values, tpl),
    focusFirstError: () => {
      const r = validator.validate(values, tpl);
      if (!r.ok && r.errors[0]) {
        const rec = fieldEls.get(r.errors[0].key);
        if (rec) { rec.wrap.classList.add('has-error'); rec.errEl.textContent = r.errors[0].msg; rec.wrap.scrollIntoView({ block: 'center' }); }
      }
      return r;
    },
    destroy: () => { root.remove(); fieldEls.clear(); },
  };
}
