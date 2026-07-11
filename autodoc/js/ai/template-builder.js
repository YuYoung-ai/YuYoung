/************************************************************
 * AI Template Builder (Phase 4) — 최종 목표
 * "회사 샘플 양식을 넣으면, 사용자는 글만 적으면 완성되는 시스템"
 *
 * 흐름:
 *   ① extract(file)   브라우저에서 양식 파일의 텍스트·구조 추출
 *                      (pptx/docx/xlsx = ZIP+OOXML → JSZip, pdf → pdf.js)
 *   ② request(...)    GAS 프록시 {action:'aiTemplate'} → Claude 가
 *                      레이아웃·입력 항목을 분석해 템플릿 JSON 초안 생성
 *   ③ normalize(raw)  스키마 검증·보정 → 관리자 편집기에서 검토 후 게시
 *
 * AI 산출물은 기존 템플릿 JSON 스키마 그 자체이므로
 * 엔진·렌더러·폼 생성기는 일절 수정 없이 동작합니다.
 ************************************************************/
AD.TemplateBuilder = (function () {

  var JSZIP_CDNS = [
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
  ];
  var PDFJS_CDNS = [
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'
  ];
  var PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  var MAX_CHARS = 15000;          /* AI에 보낼 추출 텍스트 상한 */
  var FIELD_TYPES = ['text', 'number', 'date', 'week', 'select', 'textarea', 'table'];
  var COL_TYPES = ['text', 'select', 'date', 'textarea'];
  var FORMATS = ['pptx', 'xlsx', 'docx', 'pdf'];

  function extOf(name) { return String(name || '').split('.').pop().toLowerCase(); }

  function readBuf(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej('파일 읽기 실패'); };
      r.readAsArrayBuffer(file);
    });
  }

  function xmlDecode(s) {
    return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); });
  }

  /* OOXML 조각에서 텍스트 추출: pClose(문단 닫힘)로 줄을 나누고 tRe(<a:t>/<w:t>)를 모음 */
  function xmlText(xml, tPattern, pClose) {
    return String(xml).split(pClose).map(function (chunk) {
      var re = new RegExp(tPattern, 'g'), m, out = '';
      while ((m = re.exec(chunk))) out += xmlDecode(m[1]);
      return out;
    }).filter(function (s) { return s.trim(); }).join('\n');
  }

  /* ── ① 추출 ── */

  function extractZip(buf, ext) {
    return AD.loadLib('JSZip', JSZIP_CDNS).then(function (JSZip) {
      return JSZip.loadAsync(buf);
    }).then(function (zip) {
      if (ext === 'pptx') {
        var names = Object.keys(zip.files)
          .filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n); })
          .sort(function (a, b) { return (+a.match(/\d+/g).pop()) - (+b.match(/\d+/g).pop()); });
        if (!names.length) throw '슬라이드를 찾을 수 없습니다';
        return Promise.all(names.map(function (n) { return zip.file(n).async('string'); }))
          .then(function (xmls) {
            return xmls.map(function (x, i) {
              return '[슬라이드 ' + (i + 1) + ']\n' + xmlText(x, '<a:t[^>]*>([^<]*)</a:t>', /<\/a:p>/);
            }).join('\n\n');
          });
      }
      if (ext === 'docx') {
        var f = zip.file('word/document.xml');
        if (!f) throw 'Word 본문을 찾을 수 없습니다';
        return f.async('string').then(function (x) {
          return xmlText(x, '<w:t[^>]*>([^<]*)</w:t>', /<\/w:p>/);
        });
      }
      if (ext === 'xlsx') {
        var jobs = {};
        if (zip.file('xl/workbook.xml')) jobs.wb = zip.file('xl/workbook.xml').async('string');
        if (zip.file('xl/sharedStrings.xml')) jobs.ss = zip.file('xl/sharedStrings.xml').async('string');
        var keys = Object.keys(jobs);
        return Promise.all(keys.map(function (k) { return jobs[k]; })).then(function (arr) {
          var o = {}; keys.forEach(function (k, i) { o[k] = arr[i]; });
          var out = [];
          if (o.wb) {
            var sheets = [], re = /<sheet[^>]*name="([^"]*)"/g, m;
            while ((m = re.exec(o.wb))) sheets.push(xmlDecode(m[1]));
            out.push('[시트 목록] ' + sheets.join(', '));
          }
          if (o.ss) out.push('[셀 텍스트]\n' + xmlText(o.ss, '<t[^>]*>([^<]*)</t>', /<\/si>/));
          if (!out.length) throw '엑셀 텍스트를 찾을 수 없습니다';
          return out.join('\n\n');
        });
      }
      throw '지원하지 않는 형식: ' + ext;
    });
  }

  function extractPdf(buf) {
    return AD.loadLib('pdfjsLib', PDFJS_CDNS).then(function (pdfjs) {
      pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER;
      return pdfjs.getDocument({ data: buf }).promise;
    }).then(function (doc) {
      var n = Math.min(doc.numPages, 10);
      var pages = [];
      var chain = Promise.resolve();
      var idx;
      for (idx = 1; idx <= n; idx++) {
        (function (i) {
          chain = chain.then(function () { return doc.getPage(i); })
            .then(function (pg) { return pg.getTextContent(); })
            .then(function (tc) {
              pages.push('[페이지 ' + i + ']\n' +
                tc.items.map(function (it) { return it.str; }).join(' '));
            });
        })(idx);
      }
      return chain.then(function () { return pages.join('\n\n'); });
    });
  }

  function extract(file) {
    var ext = extOf(file.name);
    if (['pptx', 'docx', 'xlsx', 'pdf'].indexOf(ext) < 0)
      return Promise.reject('지원 형식: .pptx .docx .xlsx .pdf');
    return readBuf(file).then(function (buf) {
      return (ext === 'pdf') ? extractPdf(buf) : extractZip(buf, ext);
    }).then(function (text) {
      text = String(text || '').trim();
      if (!text) throw '양식에서 텍스트를 추출하지 못했습니다';
      return { ext: ext, text: text.slice(0, MAX_CHARS) };
    });
  }

  /* ── ② AI 분석 요청 (GAS 프록시) ── */

  function request(fileName, extracted) {
    if (!AD.config.GAS_URL) return Promise.reject('GAS 백엔드 미설정');
    return fetch(AD.config.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'aiTemplate',
        fileName: fileName, fileType: extracted.ext, content: extracted.text
      })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.success && d.data) return d.data;
      throw (d && d.error) || 'AI 분석 실패';
    });
  }

  /* ── ③ 정규화: AI 산출물을 템플릿 스키마 v1 로 보정 ── */

  function slug(s) {
    var v = String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    return v || ('ai-doc-' + Date.now().toString(36));
  }

  function normKey(k, used, i) {
    var v = String(k || '').replace(/[^\w]/g, '_').replace(/^_+|_+$/g, '') || ('field' + (i + 1));
    while (used[v]) v += '_';
    used[v] = 1;
    return v;
  }

  function normalize(raw, fallbackName) {
    var t = (typeof raw === 'string') ? JSON.parse(raw) : (raw || {});
    var out = {
      id: slug(t.id || fallbackName),
      name: String(t.name || fallbackName || 'AI 생성 문서'),
      desc: String(t.desc || 'AI 템플릿 빌더로 생성'),
      category: String(t.category || '보고서'),
      version: '1.0.0',
      minLevel: Math.min(3, Math.max(1, parseInt(t.minLevel, 10) || 1)),
      formats: (Array.isArray(t.formats) ? t.formats : []).filter(function (f) { return FORMATS.indexOf(f) >= 0; }),
      theme: 'company-default',
      inputs: [], rules: []
    };
    if (!out.formats.length) out.formats = ['pptx', 'docx', 'pdf'];

    var used = {};
    (Array.isArray(t.inputs) ? t.inputs : []).forEach(function (f, i) {
      if (!f || typeof f !== 'object') return;
      var nf = {
        key: normKey(f.key || f.label, used, i),
        label: String(f.label || f.key || '항목 ' + (i + 1)),
        type: FIELD_TYPES.indexOf(f.type) >= 0 ? f.type : 'text'
      };
      if (f.required) nf.required = true;
      if (f.placeholder) nf.placeholder = String(f.placeholder);
      if (nf.type === 'select') nf.options = (Array.isArray(f.options) ? f.options : []).map(String);
      if (nf.type === 'textarea') nf.ai = ['draft', 'proofread'];   /* AI 지원 기본 부여 */
      if (nf.type === 'table') {
        var cu = {};
        nf.columns = (Array.isArray(f.columns) ? f.columns : []).map(function (c, ci) {
          var nc = { key: normKey(c && (c.key || c.label), cu, ci), label: String((c && (c.label || c.key)) || '컬럼' + (ci + 1)) };
          if (c && COL_TYPES.indexOf(c.type) >= 0 && c.type !== 'text') nc.type = c.type;
          if (c && nc.type === 'select') nc.options = (Array.isArray(c.options) ? c.options : []).map(String);
          return nc;
        });
        if (!nf.columns.length) nf.columns = [{ key: 'c1', label: '항목' }];
      }
      out.inputs.push(nf);
    });
    if (!out.inputs.length) out.inputs = [{ key: 'writer', label: '작성자', type: 'text', required: true }];

    (Array.isArray(t.rules) ? t.rules : []).forEach(function (r) {
      if (r && typeof r.if === 'string' && (r.warn || r.error)) out.rules.push(r);
    });

    /* 레이아웃: 등록된 컴포넌트·유효한 area 만 통과. 전부 무효면 null → 편집기의 자동 배치 사용 */
    var types = AD.Registry.types();
    var AREA = /^\s*\d+\s*\/\s*\d+\s*\/\s*\d+\s*\/\s*\d+\s*$/;
    var lay = t.layout || {};
    var pages = (lay.pages || []).map(function (pg) {
      return { blocks: (pg && Array.isArray(pg.blocks) ? pg.blocks : []).filter(function (b) {
        return b && types.indexOf(b.component) >= 0 && AREA.test(String(b.area || '')) &&
               b.props && typeof b.props === 'object';
      }) };
    }).filter(function (pg) { return pg.blocks.length; });
    if (pages.length) {
      var g = lay.grid || {};
      out.layout = { grid: { cols: 12, rows: Math.max(4, Math.min(20, parseInt(g.rows, 10) || 8)), gap: 0.1 },
                     pages: pages };
    } else {
      out.layout = null;   /* admin editTemplate 이 자동 배치 수행 */
    }
    return out;
  }

  return { extract: extract, request: request, normalize: normalize,
           _xmlText: xmlText /* 테스트용 */ };
})();
