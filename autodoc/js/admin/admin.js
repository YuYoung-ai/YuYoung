/************************************************************
 * AutoDoc 관리자 (admin.html)
 * - 템플릿 목록: 상태(활성/보관)·권한 레벨 관리
 * - 폼 빌더: 입력 필드를 화면에서 추가/수정 → inputs 스키마 자동 생성
 * - 레이아웃: 블록 배치(area) 편집 + [자동 배치] + 실시간 미리보기
 * - 저장: 버전 자동 증가(+GAS면 이전본 스냅샷) / GAS 없으면 JSON 다운로드
 * - 이력/롤백, 초안 승인함 (GAS 필요)
 ************************************************************/
(function () {

  var FIELD_TYPES = ['text', 'number', 'date', 'week', 'select', 'textarea', 'table'];
  var COL_TYPES = ['text', 'select', 'date', 'textarea'];

  /* 블록 [기본값] 버튼용 컴포넌트별 props 예시 */
  var DEFAULT_PROPS = {
    header: { title: '문서 제목', subtitle: '', writer: '@writer', date: '@fn.today' },
    text:   { title: '소제목', content: '@입력키' },
    table:  { title: '표 제목', columns: [{ key: 'c1', label: '항목' }], rows: '@표입력키' },
    card:   { title: '라벨', value: '@입력키', accent: '$color.primary' },
    chart:  { type: 'bar', title: '차트', source: '@표입력키', labelKey: '항목키', valueKey: '값키' },
    footer: { text: 'BAZ BIOMEDIC · 문서 · @fn.today' }
  };

  /* 편집 상태 */
  var ED = null;          /* { meta, inputs[], blocks[{component,area,propsText}], rules, grid } */
  var LIST = [];

  function $(id) { return document.getElementById(id); }
  function user() { return (window.BazAuth && BazAuth.name()) || '관리자'; }

  function bumpPatch(v) {
    var p = String(v || '1.0.0').split('.').map(function (n) { return parseInt(n, 10) || 0; });
    while (p.length < 3) p.push(0);
    p[2] += 1;
    return p.join('.');
  }

  /* ══════════ ① 템플릿 목록 ══════════ */

  function loadList() {
    $('tplList').innerHTML = '<div class="empty">로드 중…</div>';
    AD.Templates.listAll().then(function (arr) {
      LIST = arr || [];
      renderList();
    }).catch(function (e) {
      $('tplList').innerHTML = '<div class="empty">❌ ' + AD.esc(String(e)) + '</div>';
    });
  }

  function renderList() {
    if (!LIST.length) { $('tplList').innerHTML = '<div class="empty">템플릿 없음 — [새 템플릿]으로 시작</div>'; return; }
    var gas = !!AD.config.GAS_URL;
    $('tplList').innerHTML = LIST.map(function (t, i) {
      return '<div class="tpl-row">' +
        '<div class="tpl-row-main"><b>' + AD.esc(t.name) + '</b>' +
        ' <span class="mini">' + AD.esc(t.id) + ' · v' + AD.esc(t.version || '1.0.0') +
        ' · 레벨 ' + (t.minLevel || 1) + (t.status ? ' · ' + AD.esc(t.status) : '') + '</span></div>' +
        '<div class="tpl-row-btns">' +
        '<button class="btn-sm btn-edit" data-i="' + i + '">✏️ 편집</button>' +
        (gas ? '<button class="btn-sm btn-hist" data-i="' + i + '">🕘 이력</button>' : '') +
        (gas ? '<button class="btn-sm btn-stat" data-i="' + i + '">' + (t.status === '보관' ? '📂 활성화' : '📦 보관') + '</button>' : '') +
        '</div></div>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('.btn-edit'), function (b) {
      b.onclick = function () { editTemplate(LIST[+b.dataset.i]); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.btn-hist'), function (b) {
      b.onclick = function () { showHistory(LIST[+b.dataset.i].id); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.btn-stat'), function (b) {
      b.onclick = function () {
        var t = LIST[+b.dataset.i];
        var next = t.status === '보관' ? '활성' : '보관';
        AD.Templates.setStatus(t.id, next, user()).then(function () {
          AD.toast('상태 변경: ' + next); loadList();
        }).catch(function (e) { AD.toast('❌ ' + e); });
      };
    });
  }

  /* ══════════ ② 편집기 ══════════ */

  function newTemplate() {
    editTemplate({
      id: 'new-doc-' + Date.now().toString(36), name: '새 문서', desc: '', category: '보고서',
      version: '1.0.0', minLevel: 1, formats: ['pptx', 'pdf'], theme: 'company-default',
      inputs: [{ key: 'writer', label: '작성자', type: 'text', required: true }],
      rules: [],
      layout: null
    });
  }

  function editTemplate(t) {
    /* 목록의 메타만 있으면 전문 로드 */
    var p = t.inputs ? Promise.resolve(t) : AD.Templates.load(t.id);
    p.then(function (tpl) {
      ED = {
        meta: { id: tpl.id, name: tpl.name, desc: tpl.desc || '', category: tpl.category || '',
                version: tpl.version || '1.0.0', minLevel: tpl.minLevel || 1,
                formats: (tpl.formats || ['pptx']).slice(), theme: tpl.theme || 'company-default' },
        inputs: JSON.parse(JSON.stringify(tpl.inputs || [])),
        rules: JSON.parse(JSON.stringify(tpl.rules || [])),
        grid: (tpl.layout && tpl.layout.grid) || { cols: 12, rows: 8, gap: 0.1 },
        blocks: ((tpl.layout && tpl.layout.pages && tpl.layout.pages[0] || {}).blocks || []).map(function (b) {
          return { component: b.component, area: b.area || '1 / 1 / 2 / 13',
                   propsText: JSON.stringify(b.props || {}, null, 1) };
        })
      };
      if (!ED.blocks.length) autoLayout();
      renderEditor();
      $('editorSec').style.display = 'block';
      $('editorSec').scrollIntoView({ behavior: 'smooth' });
      refreshPreview();
    }).catch(function (e) { AD.toast('❌ ' + e); });
  }

  function renderEditor() {
    /* 기본 정보 */
    $('mId').value = ED.meta.id;
    $('mName').value = ED.meta.name;
    $('mDesc').value = ED.meta.desc;
    $('mCategory').value = ED.meta.category;
    $('mVersion').textContent = 'v' + ED.meta.version + ' (저장 시 자동 증가)';
    $('mMinLevel').value = String(ED.meta.minLevel);
    Array.prototype.forEach.call(document.querySelectorAll('input[name=fmt]'), function (c) {
      c.checked = ED.meta.formats.indexOf(c.value) >= 0;
    });
    renderInputs();
    renderBlocks();
  }

  function bindMeta() {
    $('mId').oninput = function () { ED.meta.id = this.value.trim(); };
    $('mName').oninput = function () { ED.meta.name = this.value; refreshPreview(); };
    $('mDesc').oninput = function () { ED.meta.desc = this.value; };
    $('mCategory').oninput = function () { ED.meta.category = this.value; };
    $('mMinLevel').onchange = function () { ED.meta.minLevel = parseInt(this.value, 10) || 1; };
    Array.prototype.forEach.call(document.querySelectorAll('input[name=fmt]'), function (c) {
      c.onchange = function () {
        ED.meta.formats = Array.prototype.filter.call(document.querySelectorAll('input[name=fmt]'), function (x) { return x.checked; })
          .map(function (x) { return x.value; });
      };
    });
  }

  /* ── 폼 빌더 (inputs) ── */

  function renderInputs() {
    var box = $('inputsBox');
    box.innerHTML = '';
    if (!ED.inputs.length) box.innerHTML = '<div class="empty">필드 없음 — [필드 추가]</div>';
    ED.inputs.forEach(function (f, i) {
      var row = document.createElement('div');
      row.className = 'inp-row';
      row.innerHTML =
        '<div class="inp-grid">' +
        '<div><label>키(key)</label><input class="i-key" value="' + AD.esc(f.key || '') + '"></div>' +
        '<div><label>라벨</label><input class="i-label" value="' + AD.esc(f.label || '') + '"></div>' +
        '<div><label>타입</label><select class="i-type">' + FIELD_TYPES.map(function (t) {
          return '<option' + (f.type === t ? ' selected' : '') + '>' + t + '</option>';
        }).join('') + '</select></div>' +
        '<div class="i-req-w"><label>필수</label><input type="checkbox" class="i-req"' + (f.required ? ' checked' : '') + '></div>' +
        '</div>' +
        '<div class="i-opts" style="display:' + (f.type === 'select' ? 'block' : 'none') + '">' +
        '<label>선택 옵션 (쉼표 구분)</label><input class="i-options" value="' + AD.esc((f.options || []).join(', ')) + '"></div>' +
        '<div class="i-cols" style="display:' + (f.type === 'table' ? 'block' : 'none') + '"></div>' +
        '<div class="inp-btns">' +
        '<button class="btn-sm i-up">↑</button><button class="btn-sm i-down">↓</button>' +
        '<button class="btn-sm i-del" style="color:var(--red)">삭제</button></div>';
      box.appendChild(row);

      row.querySelector('.i-key').oninput = function () { f.key = this.value.trim(); };
      row.querySelector('.i-label').oninput = function () { f.label = this.value; refreshPreview(); };
      row.querySelector('.i-req').onchange = function () { f.required = this.checked; };
      row.querySelector('.i-type').onchange = function () {
        f.type = this.value;
        if (f.type === 'select' && !f.options) f.options = [];
        if (f.type === 'table' && !f.columns) f.columns = [{ key: 'c1', label: '항목', type: 'text' }];
        renderInputs(); refreshPreview();
      };
      row.querySelector('.i-options').oninput = function () {
        f.options = this.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        refreshPreview();
      };
      row.querySelector('.i-up').onclick = function () { move(ED.inputs, i, -1); renderInputs(); refreshPreview(); };
      row.querySelector('.i-down').onclick = function () { move(ED.inputs, i, 1); renderInputs(); refreshPreview(); };
      row.querySelector('.i-del').onclick = function () { ED.inputs.splice(i, 1); renderInputs(); refreshPreview(); };

      if (f.type === 'table') renderCols(f, row.querySelector('.i-cols'));
    });
  }

  function renderCols(f, box) {
    box.innerHTML = '<label>표 컬럼</label>';
    (f.columns || []).forEach(function (c, ci) {
      var cr = document.createElement('div');
      cr.className = 'col-row';
      cr.innerHTML =
        '<input class="c-key" placeholder="key" value="' + AD.esc(c.key || '') + '">' +
        '<input class="c-label" placeholder="라벨" value="' + AD.esc(c.label || '') + '">' +
        '<select class="c-type">' + COL_TYPES.map(function (t) {
          return '<option' + ((c.type || 'text') === t ? ' selected' : '') + '>' + t + '</option>';
        }).join('') + '</select>' +
        '<input class="c-options" placeholder="옵션(쉼표)" style="display:' + (c.type === 'select' ? 'block' : 'none') + '" value="' + AD.esc((c.options || []).join(',')) + '">' +
        '<button class="btn-sm c-del" style="color:var(--red)">✕</button>';
      box.appendChild(cr);
      cr.querySelector('.c-key').oninput = function () { c.key = this.value.trim(); };
      cr.querySelector('.c-label').oninput = function () { c.label = this.value; refreshPreview(); };
      cr.querySelector('.c-type').onchange = function () {
        c.type = this.value;
        if (c.type === 'select' && !c.options) c.options = [];
        renderCols(f, box); refreshPreview();
      };
      cr.querySelector('.c-options').oninput = function () {
        c.options = this.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      };
      cr.querySelector('.c-del').onclick = function () { f.columns.splice(ci, 1); renderCols(f, box); refreshPreview(); };
    });
    var add = document.createElement('button');
    add.className = 'btn-sm'; add.textContent = '＋ 컬럼';
    add.onclick = function () {
      f.columns.push({ key: 'c' + (f.columns.length + 1), label: '컬럼', type: 'text' });
      renderCols(f, box); refreshPreview();
    };
    box.appendChild(add);
  }

  function move(arr, i, d) {
    var j = i + d;
    if (j < 0 || j >= arr.length) return;
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }

  /* ── 레이아웃 빌더 (blocks) ── */

  function renderBlocks() {
    var box = $('blocksBox');
    box.innerHTML = '';
    if (!ED.blocks.length) box.innerHTML = '<div class="empty">블록 없음 — [자동 배치] 또는 [블록 추가]</div>';
    ED.blocks.forEach(function (b, i) {
      var row = document.createElement('div');
      row.className = 'blk-row';
      row.innerHTML =
        '<div class="blk-head">' +
        '<select class="b-comp">' + AD.Registry.types().map(function (t) {
          return '<option' + (b.component === t ? ' selected' : '') + '>' + t + '</option>';
        }).join('') + '</select>' +
        '<input class="b-area" value="' + AD.esc(b.area) + '" title="행시작 / 열시작 / 행끝 / 열끝 (끝은 미포함, 열 1~13)">' +
        '<button class="btn-sm b-def" title="컴포넌트 기본 props 채우기">기본값</button>' +
        '<button class="btn-sm b-up">↑</button><button class="btn-sm b-down">↓</button>' +
        '<button class="btn-sm b-del" style="color:var(--red)">삭제</button></div>' +
        '<textarea class="b-props" rows="3" spellcheck="false">' + AD.esc(b.propsText) + '</textarea>';
      box.appendChild(row);

      var ta = row.querySelector('.b-props');
      row.querySelector('.b-comp').onchange = function () { b.component = this.value; refreshPreview(); };
      row.querySelector('.b-area').oninput = function () { b.area = this.value; refreshPreview(); };
      ta.oninput = function () {
        b.propsText = this.value;
        try { JSON.parse(this.value || '{}'); ta.classList.remove('bad'); refreshPreview(); }
        catch (e) { ta.classList.add('bad'); }
      };
      row.querySelector('.b-def').onclick = function () {
        b.propsText = JSON.stringify(DEFAULT_PROPS[b.component] || {}, null, 1);
        renderBlocks(); refreshPreview();
      };
      row.querySelector('.b-up').onclick = function () { move(ED.blocks, i, -1); renderBlocks(); refreshPreview(); };
      row.querySelector('.b-down').onclick = function () { move(ED.blocks, i, 1); renderBlocks(); refreshPreview(); };
      row.querySelector('.b-del').onclick = function () { ED.blocks.splice(i, 1); renderBlocks(); refreshPreview(); };
    });
  }

  /* [자동 배치] — inputs 를 읽어 layout 을 통째로 생성.
   * 짧은 필드→card 3개/행, textarea→text 블록, table→table 블록. */
  function autoLayout() {
    var blocks = [];
    var writerKey = (ED.inputs.filter(function (f) { return /writer|작성/.test(f.key + f.label); })[0] || {}).key;
    blocks.push({ component: 'header', area: '1 / 1 / 2 / 13',
      props: { title: ED.meta.name || '문서', writer: writerKey ? '@' + writerKey : '', date: '@fn.today' } });

    var row = 2;
    var shorts = ED.inputs.filter(function (f) {
      return ['text', 'number', 'date', 'week', 'select'].indexOf(f.type) >= 0 && f.key !== writerKey;
    });
    for (var i = 0; i < shorts.length; i += 3) {
      var chunk = shorts.slice(i, i + 3);
      var w = Math.floor(12 / chunk.length);
      chunk.forEach(function (f, j) {
        var c1 = 1 + j * w;
        var c2 = (j === chunk.length - 1) ? 13 : c1 + w;
        blocks.push({ component: 'card', area: row + ' / ' + c1 + ' / ' + (row + 1) + ' / ' + c2,
          props: { title: f.label, value: '@' + f.key, accent: '$color.primary' } });
      });
      row += 1;
    }
    ED.inputs.forEach(function (f) {
      if (f.type === 'table') {
        blocks.push({ component: 'table', area: row + ' / 1 / ' + (row + 3) + ' / 13',
          props: { title: f.label,
            columns: (f.columns || []).map(function (c) { return { key: c.key, label: c.label }; }),
            rows: '@' + f.key } });
        row += 3;
      } else if (f.type === 'textarea') {
        blocks.push({ component: 'text', area: row + ' / 1 / ' + (row + 2) + ' / 13',
          props: { title: f.label, content: '@' + f.key } });
        row += 2;
      }
    });
    blocks.push({ component: 'footer', area: row + ' / 1 / ' + (row + 1) + ' / 13',
      props: { text: 'BAZ BIOMEDIC · ' + (ED.meta.name || '문서') + ' · @fn.today' } });

    ED.grid = { cols: 12, rows: Math.max(8, row), gap: 0.1 };
    ED.blocks = blocks.map(function (b) {
      return { component: b.component, area: b.area, propsText: JSON.stringify(b.props, null, 1) };
    });
  }

  /* ── 미리보기 (샘플 값 자동 생성) ── */

  function sampleValues() {
    var v = {};
    ED.inputs.forEach(function (f) {
      switch (f.type) {
        case 'table':
          v[f.key] = [1, 2].map(function (n) {
            var r = {};
            (f.columns || []).forEach(function (c) {
              r[c.key] = c.type === 'date' ? AD.Model.fn('today')
                       : c.type === 'select' ? ((c.options || [])[0] || '선택')
                       : c.label + ' ' + n;
            });
            return r;
          });
          break;
        case 'textarea': v[f.key] = '(' + f.label + ' 예시)\n- 내용 1\n- 내용 2'; break;
        case 'week': v[f.key] = AD.Model.fn('currentWeek'); break;
        case 'date': v[f.key] = AD.Model.fn('today'); break;
        case 'select': v[f.key] = (f.options || [])[0] || f.label; break;
        case 'number': v[f.key] = 3; break;
        default: v[f.key] = f.label + ' 예시';
      }
    });
    return v;
  }

  function buildTpl() {
    var blocks = [];
    for (var i = 0; i < ED.blocks.length; i++) {
      var b = ED.blocks[i];
      var props;
      try { props = JSON.parse(b.propsText || '{}'); }
      catch (e) { throw '블록 ' + (i + 1) + '(' + b.component + ')의 props JSON 오류'; }
      blocks.push({ component: b.component, area: b.area, props: props });
    }
    return {
      id: ED.meta.id, name: ED.meta.name, desc: ED.meta.desc, category: ED.meta.category,
      version: ED.meta.version, minLevel: ED.meta.minLevel, formats: ED.meta.formats,
      theme: ED.meta.theme, inputs: ED.inputs, rules: ED.rules,
      layout: { grid: ED.grid, pages: [{ blocks: blocks }] }
    };
  }

  function refreshPreview() {
    if (!ED) return;
    clearTimeout(refreshPreview._t);
    refreshPreview._t = setTimeout(function () {
      try {
        var tpl = buildTpl();
        var model = AD.Model.assemble(tpl, sampleValues());
        AD.Preview.render(model, $('adminPreview'));
        $('pvStatus').textContent = '';
      } catch (e) {
        $('pvStatus').textContent = '⚠ ' + e;
      }
    }, 250);
  }

  /* ── 저장 ── */

  function save() {
    var tpl;
    try { tpl = buildTpl(); }
    catch (e) { AD.toast('❌ ' + e); return; }
    if (!tpl.id || !tpl.name) { AD.toast('❌ id와 이름은 필수입니다'); return; }
    var dup = {};
    for (var i = 0; i < tpl.inputs.length; i++) {
      var k = tpl.inputs[i].key;
      if (!k) { AD.toast('❌ 키(key)가 빈 필드가 있습니다'); return; }
      if (dup[k]) { AD.toast('❌ 중복 키: ' + k); return; }
      dup[k] = 1;
    }
    tpl.version = bumpPatch(tpl.version);
    var btn = $('btnSave');
    btn.disabled = true;
    AD.Templates.save(tpl, user()).then(function (r) {
      ED.meta.version = tpl.version;
      $('mVersion').textContent = 'v' + tpl.version + ' (저장 시 자동 증가)';
      AD.store.set('tpl_' + tpl.id, tpl);       /* 로컬 캐시 갱신 → 에디터 즉시 반영 */
      AD.toast(r.downloaded
        ? '💾 ' + tpl.id + '.json 다운로드 — templates/ 폴더에 커밋하세요 (GAS 미설정)'
        : '✅ 저장 완료 (v' + tpl.version + ', 이전본 이력 스냅샷)');
      loadList();
    }).catch(function (e) { AD.toast('❌ ' + e); })
      .then(function () { btn.disabled = false; });
  }

  /* ══════════ ③ 이력/롤백 (GAS) ══════════ */

  function showHistory(id) {
    $('histSec').style.display = 'block';
    $('histTitle').textContent = '버전 이력 — ' + id;
    $('histBox').innerHTML = '<div class="empty">로드 중…</div>';
    AD.Templates.history(id).then(function (rows) {
      if (!rows || !rows.length) { $('histBox').innerHTML = '<div class="empty">이력 없음</div>'; return; }
      $('histBox').innerHTML = rows.map(function (h) {
        return '<div class="tpl-row"><div class="tpl-row-main">v' + AD.esc(h.version) +
          ' <span class="mini">' + AD.esc(h.ts) + ' · ' + AD.esc(h.user || '') + '</span></div>' +
          '<div class="tpl-row-btns"><button class="btn-sm h-restore" data-row="' + h.row + '" data-id="' + AD.esc(id) + '">↩ 이 버전으로 복원</button></div></div>';
      }).join('');
      Array.prototype.forEach.call(document.querySelectorAll('.h-restore'), function (b) {
        b.onclick = function () {
          if (!confirm('v 이력을 현재 버전으로 복원할까요? (현재본은 이력에 스냅샷됩니다)')) return;
          AD.Templates.restore(b.dataset.id, +b.dataset.row, user()).then(function () {
            AD.toast('↩ 복원 완료'); loadList(); showHistory(b.dataset.id);
          }).catch(function (e) { AD.toast('❌ ' + e); });
        };
      });
    }).catch(function (e) { $('histBox').innerHTML = '<div class="empty">❌ ' + AD.esc(String(e)) + '</div>'; });
  }

  /* ══════════ ④ 초안 승인함 (GAS) ══════════ */

  function loadDrafts() {
    if (!AD.config.GAS_URL) { $('draftsBox').innerHTML = '<div class="empty">GAS 백엔드 배포 후 사용 가능합니다</div>'; return; }
    $('draftsBox').innerHTML = '<div class="empty">로드 중…</div>';
    AD.Drafts.list().then(function (rows) {
      rows = (rows || []).filter(function (d) { return d.status === '대기'; });
      if (!rows.length) { $('draftsBox').innerHTML = '<div class="empty">대기 중인 초안 없음</div>'; return; }
      $('draftsBox').innerHTML = rows.map(function (d) {
        return '<div class="tpl-row"><div class="tpl-row-main"><b>' + AD.esc(d.name) + '</b>' +
          ' <span class="mini">' + AD.esc(d.user) + ' · ' + AD.esc(d.ts) + '</span>' +
          '<pre class="draft-vals">' + AD.esc(prettyValues(d.values)) + '</pre></div>' +
          '<div class="tpl-row-btns">' +
          '<button class="btn-sm d-ok" data-row="' + d.row + '" style="color:var(--green)">✅ 승인</button>' +
          '<button class="btn-sm d-no" data-row="' + d.row + '" style="color:var(--red)">⛔ 반려</button></div></div>';
      }).join('');
      Array.prototype.forEach.call(document.querySelectorAll('.d-ok,.d-no'), function (b) {
        b.onclick = function () {
          var ok = b.classList.contains('d-ok');
          var comment = prompt(ok ? '승인 의견 (선택)' : '반려 사유', '') ;
          if (comment === null) return;
          AD.Drafts.review(+b.dataset.row, ok ? '승인' : '반려', user(), comment).then(function () {
            AD.toast(ok ? '✅ 승인 완료' : '⛔ 반려 완료'); loadDrafts();
          }).catch(function (e) { AD.toast('❌ ' + e); });
        };
      });
    }).catch(function (e) { $('draftsBox').innerHTML = '<div class="empty">❌ ' + AD.esc(String(e)) + '</div>'; });
  }

  function prettyValues(v) {
    try { if (typeof v === 'string') v = JSON.parse(v); } catch (e) { return String(v); }
    return Object.keys(v || {}).map(function (k) {
      var val = v[k];
      if (Array.isArray(val)) val = val.length + '건';
      return k + ': ' + String(val).slice(0, 60);
    }).join('\n');
  }

  /* ══════════ ⑤ AI 템플릿 빌더 (Phase 4) ══════════ */

  function setAiStatus(msg, cls) {
    var el = $('aiStatus');
    el.textContent = msg;
    el.className = 'status' + (cls ? ' ' + cls : '');
  }

  function aiAnalyze() {
    var input = $('aiFile');
    var file = input.files && input.files[0];
    if (!file) { AD.toast('양식 파일을 선택하세요 (.pptx .docx .xlsx .pdf)'); return; }
    if (!AD.config.GAS_URL) {
      setAiStatus('❌ GAS 백엔드 미설정 — 배포 후 config.js 의 GAS_URL 과 스크립트 속성 ANTHROPIC_API_KEY 를 설정하세요', 'err');
      return;
    }
    var btn = $('btnAiAnalyze');
    btn.disabled = true;
    setAiStatus('① "' + file.name + '" 에서 텍스트 추출 중…');
    AD.TemplateBuilder.extract(file).then(function (ex) {
      setAiStatus('② AI가 레이아웃·입력 항목 분석 중… (수십 초 걸릴 수 있습니다)');
      return AD.TemplateBuilder.request(file.name, ex);
    }).then(function (raw) {
      var tpl = AD.TemplateBuilder.normalize(raw, file.name.replace(/\.[^.]+$/, ''));
      setAiStatus('③ 생성 완료 — 아래 편집기에서 검토·수정 후 [저장]하면 게시됩니다', 'ok');
      AD.toast('🪄 템플릿 초안 생성 — 검토 후 저장하세요');
      editTemplate(tpl);
    }).catch(function (e) {
      setAiStatus('❌ ' + e, 'err');
    }).then(function () { btn.disabled = false; });
  }

  /* ══════════ 초기화 ══════════ */

  window.addEventListener('DOMContentLoaded', function () {
    bindMeta();
    $('btnNew').onclick = newTemplate;
    $('btnAddField').onclick = function () {
      ED.inputs.push({ key: 'field' + (ED.inputs.length + 1), label: '새 필드', type: 'text' });
      renderInputs(); refreshPreview();
    };
    $('btnAddBlock').onclick = function () {
      ED.blocks.push({ component: 'text', area: '2 / 1 / 4 / 13',
        propsText: JSON.stringify(DEFAULT_PROPS.text, null, 1) });
      renderBlocks(); refreshPreview();
    };
    $('btnAutoLayout').onclick = function () {
      if (!confirm('현재 레이아웃을 입력 필드 기준으로 다시 생성할까요?')) return;
      autoLayout(); renderBlocks(); refreshPreview();
    };
    $('btnSave').onclick = save;
    $('btnDraftsReload').onclick = loadDrafts;
    $('btnAiAnalyze').onclick = aiAnalyze;
    loadList();
    loadDrafts();
  });

})();
