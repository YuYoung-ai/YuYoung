/************************************************************
 * Form Generator — 템플릿의 inputs 스키마 → 입력폼 자동 생성
 * 지원 타입: text · number · date · week · select · textarea · table
 * 입력값은 자동으로 localStorage 초안(draft_<템플릿id>)에 저장됩니다.
 ************************************************************/
AD.Form = (function () {

  function el(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstChild; }

  /* 최근 8주 옵션 — weekly.html 주차 로직 이관. 값 = 라벨 문자열(문서에 그대로 사용) */
  function weekOptions() {
    var out = [], mon = AD.date.monday(new Date());
    for (var i = 0; i < 8; i++) {
      var m = AD.date.addD(mon, -7 * i);
      var s = AD.date.addD(m, -2), f = AD.date.addD(m, 4);   /* 토(전주)~금 */
      out.push(AD.date.wkLabel(m) + ' (' + (s.getMonth() + 1) + '/' + s.getDate() + '~' + (f.getMonth() + 1) + '/' + f.getDate() + ')');
    }
    return out;
  }

  function build(tpl, root, onChange) {
    var inputs = tpl.inputs || [];
    var draft = AD.store.get('draft_' + tpl.id, {});
    var state = {};
    var timer = null;

    function emit() {
      AD.store.set('draft_' + tpl.id, state);
      clearTimeout(timer);
      timer = setTimeout(function () { onChange && onChange(); }, 250);
    }

    function defVal(f) {
      var d = f.default;
      if (typeof d === 'string' && d.indexOf('@fn.') === 0) return AD.Model.fn(d.slice(4));
      if (d != null) return d;
      return f.type === 'table' ? [] : '';
    }

    function bindCtl(ctl, key) {
      var h = function () { state[key] = ctl.value; emit(); };
      ctl.addEventListener('input', h);
      ctl.addEventListener('change', h);
    }

    function makeCtl(f, init) {
      var ctl;
      switch (f.type) {
        case 'textarea':
          ctl = el('<textarea rows="' + (f.rows || 4) + '" placeholder="' + AD.esc(f.placeholder || '') + '"></textarea>');
          ctl.value = init || ''; break;
        case 'select':
          ctl = document.createElement('select');
          (Array.isArray(f.options) ? f.options : []).forEach(function (o) {
            var op = document.createElement('option'); op.textContent = o; ctl.appendChild(op);
          });
          if (init) ctl.value = init; break;
        case 'week':
          ctl = document.createElement('select');
          weekOptions().forEach(function (o) {
            var op = document.createElement('option'); op.textContent = o; ctl.appendChild(op);
          });
          if (init) ctl.value = init; break;
        case 'date':
          ctl = el('<input type="date">'); ctl.value = init || ''; break;
        case 'number':
          ctl = el('<input type="number">'); ctl.value = init || ''; break;
        default:
          ctl = el('<input type="text" placeholder="' + AD.esc(f.placeholder || '') + '">');
          ctl.value = init || '';
      }
      return ctl;
    }

    /* 표형 입력 — weekly.html의 행 카드(rrow) 패턴 이관 */
    function buildTable(f, wrap) {
      if (!Array.isArray(state[f.key])) state[f.key] = [];
      var box = document.createElement('div');
      wrap.appendChild(box);
      var add = el('<button type="button" class="btn-addrow">＋ 행 추가</button>');
      add.onclick = function () { state[f.key].push({}); renderRows(); emit(); };
      wrap.appendChild(add);

      function renderRows() {
        box.innerHTML = '';
        if (!state[f.key].length) {
          box.innerHTML = '<div class="empty">[행 추가]를 눌러 입력하세요</div>';
          return;
        }
        state[f.key].forEach(function (row, i) {
          var card = document.createElement('div'); card.className = 'trow';
          var head = el('<div class="trow-head"><span class="no">' + (i + 1) + '</span>' +
            '<button type="button" class="del">🗑</button></div>');
          head.querySelector('.del').onclick = function () {
            state[f.key].splice(i, 1); renderRows(); emit();
          };
          card.appendChild(head);
          var grid = document.createElement('div'); grid.className = 'tgrid';
          (f.columns || []).forEach(function (c) {
            var cw = document.createElement('div');
            if (c.type === 'textarea') cw.className = 'full';
            cw.innerHTML = '<label>' + AD.esc(c.label) + '</label>';
            var ci;
            if (c.type === 'select') {
              ci = document.createElement('select');
              (c.options || []).forEach(function (o) {
                var op = document.createElement('option'); op.textContent = o; ci.appendChild(op);
              });
              if (!row[c.key] && c.options && c.options.length) row[c.key] = c.options[0];
            } else if (c.type === 'textarea') {
              ci = el('<textarea rows="2"></textarea>');
            } else if (c.type === 'date') {
              ci = el('<input type="date">');
            } else {
              ci = el('<input type="text">');
            }
            ci.value = row[c.key] || '';
            var h = function () { row[c.key] = ci.value; emit(); };
            ci.addEventListener('input', h);
            ci.addEventListener('change', h);
            cw.appendChild(ci);
            grid.appendChild(cw);
          });
          card.appendChild(grid);
          box.appendChild(card);
        });
      }
      renderRows();
    }

    root.innerHTML = '';
    inputs.forEach(function (f) {
      var init = draft[f.key] != null ? draft[f.key] : defVal(f);
      state[f.key] = init;
      var wrap = document.createElement('div');
      wrap.className = 'fld';
      wrap.innerHTML = '<label>' + AD.esc(f.label) +
        (f.required ? ' <span class="req">*</span>' : '') + '</label>';
      if (f.type === 'table') {
        root.appendChild(wrap);
        buildTable(f, wrap);
        return;
      }
      var ctl = makeCtl(f, init);
      state[f.key] = ctl.value != null && ctl.value !== '' ? ctl.value : init;
      if (f.type === 'week' || f.type === 'select') state[f.key] = ctl.value;   /* select 초기 선택값 반영 */
      bindCtl(ctl, f.key);
      wrap.appendChild(ctl);
      root.appendChild(wrap);
    });

    return {
      getValues: function () {
        var o = {};
        Object.keys(state).forEach(function (k) { o[k] = state[k]; });
        return o;
      },
      clearDraft: function () { AD.store.del('draft_' + tpl.id); }
    };
  }

  return { build: build };
})();
