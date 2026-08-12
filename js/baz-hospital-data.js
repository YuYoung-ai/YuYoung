/*******************************************************************
 * baz-hospital-data.js — 병원정보DB 정규화 · 병합 (BazHospitalData)
 * -----------------------------------------------------------------
 * 왜 분리했나
 *   기존 applyDB() 는 `if(r.sales) h.sa=r.sales;` 처럼 truthy 검사로만
 *   덮어썼다. 그래서 시트에서 담당자·주소·N-CARE·상태를 "지워도" 브라우저
 *   메모리에는 예전 값이 그대로 남았다(공용 PC 는 탭을 며칠 열어 두므로
 *   지운 값이 계속 보였다). 좌표도 마찬가지로 이상값 검증이 없었다.
 *   → "필드가 응답에 있는가(존재)" 와 "값이 비었는가(truthy)" 를 분리한다.
 *      · 응답에 필드가 있으면 빈 문자열도 권위 있는 값으로 반영한다.
 *      · 응답에 필드가 없으면(구버전 백엔드) 기존 값을 지키지 않고 건드리지도 않는다.
 *      · null·''·0·좌표 유효범위를 한곳에서 정규화한다.
 *      · 스냅샷에서 사라진 병원은 메모리에서도 제거한다.
 *
 * 브라우저: <script src="js/baz-hospital-data.js"></script> → window.BazHospitalData
 * 테스트  : require('../js/baz-hospital-data.js')
 *******************************************************************/
(function (root, factory) {
  var api = factory();
  root.BazHospitalData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* 서버 필드 → 메모리 필드. kind 는 정규화 방식. */
  var FIELDS = [
    { src: 'sn', dst: 's', kind: 'text', def: '' },
    { src: 'region', dst: 'rg', kind: 'text', def: '' },
    { src: 'address', dst: 'a', kind: 'text', def: '' },
    { src: 'lastVisit', dst: 'li', kind: 'date', def: '' },
    { src: 'status', dst: 'st', kind: 'text', def: '미점검' },
    { src: 'sales', dst: 'sa', kind: 'text', def: '' },
    { src: 'asType', dst: 'as', kind: 'text', def: '' },
    { src: 'ncare', dst: 'nc', kind: 'text', def: '미가입' },
    { src: 'client', dst: 'd', kind: 'text', def: '' },
    { src: 'hpVer', dst: 'hpv', kind: 'text', def: '' },
    { src: 'uiVer', dst: 'uiv', kind: 'text', def: '' },
    { src: 'lat', dst: 'lat', kind: 'lat', def: null },
    { src: 'lng', dst: 'lng', kind: 'lng', def: null }
  ];

  /* 한반도 대략 범위 — 서버(getHospDBRich_ num_)와 같은 기준.
     0 이나 문자열 좌표가 그대로 들어와 지도가 아프리카 앞바다로 날아가던 것을 막는다. */
  var LAT_MIN = 33, LAT_MAX = 39, LNG_MIN = 124, LNG_MAX = 132;

  function normText(v) {
    if (v == null) return '';
    if (typeof v === 'number') return isFinite(v) ? String(v) : '';   // 숫자 0 도 '0' 으로 보존
    if (typeof v === 'boolean') return '';                            // 체크박스 값 유입 방어
    return String(v).trim();
  }

  /** 날짜를 yyyy-MM-dd 로 정규화. 값이 비었거나 형식이 깨졌으면 '' */
  function normDate(v) {
    var s = normText(v);
    if (!s) return '';
    var m = s.match(/(\d{4})[-.\/]\s*(\d{1,2})[-.\/]\s*(\d{1,2})/);
    if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    }
    return '';
  }

  function normCoord(v, min, max) {
    if (v == null || v === '') return null;
    var n = (typeof v === 'number') ? v : parseFloat(String(v).trim());
    if (!isFinite(n)) return null;
    if (n < min || n > max) return null;
    return n;
  }

  function normValue(kind, v) {
    if (kind === 'date') return normDate(v);
    if (kind === 'lat') return normCoord(v, LAT_MIN, LAT_MAX);
    if (kind === 'lng') return normCoord(v, LNG_MIN, LNG_MAX);
    return normText(v);
  }

  function has(obj, k) { return obj != null && Object.prototype.hasOwnProperty.call(obj, k); }

  /**
   * 서버 행 1건 → {name, present:{dst:value…}}
   * present 에는 "응답에 실제로 들어 있던" 필드만 담긴다. 응답에 없는 필드는
   * 구버전 백엔드가 아직 안 주는 것이므로 병합에서 손대지 않는다.
   */
  function normalizeRow(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = normText(raw.name);
    if (!name) return null;
    var present = {};
    FIELDS.forEach(function (f) {
      if (has(raw, f.src)) present[f.dst] = normValue(f.kind, raw[f.src]);
    });
    return { name: name, present: present };
  }

  /** 새 병원 객체 — 응답에 없던 필드는 기본값으로 채운다 */
  function buildHospital(name, present) {
    var h = { n: name };
    FIELDS.forEach(function (f) {
      h[f.dst] = has(present, f.dst) ? present[f.dst] : f.def;
    });
    return h;
  }

  /**
   * 서버 스냅샷을 HOSPITALS 배열에 병합한다(배열은 제자리 수정 — const 참조 유지).
   *
   * @param {Array} hospitals  메모리 배열(제자리 수정)
   * @param {Array} rows       서버 응답 행
   * @param {Object} [opts]    { prune:true } 스냅샷에 없는 병원 제거(기본 true)
   * @returns {Object} 통계 { changed, added, updated, removed, cleared, duplicates, invalidCoords, skipped }
   */
  function mergeRows(hospitals, rows, opts) {
    var stats = { changed: false, added: 0, updated: 0, removed: 0, cleared: 0, duplicates: 0, invalidCoords: 0, skipped: 0 };
    if (!Array.isArray(hospitals) || !Array.isArray(rows) || !rows.length) return stats;
    var prune = !(opts && opts.prune === false);

    /* 1) 행 정규화 + 병원명 중복 정리.
          같은 병원명이 시트에 두 줄 있으면 예전에는 두 번 덮어써 "마지막 줄이 이긴다"가
          암묵 규칙이었고, 새 병원 경로에서는 배열에 같은 이름이 두 개 생겨 지도 마커·
          카운트가 어긋났다. → 이름 기준으로 접고, 나중 행의 '값이 있는 필드'만 얹는다. */
    var order = [], byName = {};
    rows.forEach(function (raw) {
      var r = normalizeRow(raw);
      if (!r) { stats.skipped++; return; }
      if (has(raw, 'lat') && raw.lat != null && raw.lat !== '' && r.present.lat == null) stats.invalidCoords++;
      if (has(raw, 'lng') && raw.lng != null && raw.lng !== '' && r.present.lng == null) stats.invalidCoords++;
      if (!byName[r.name]) { byName[r.name] = r; order.push(r.name); return; }
      stats.duplicates++;
      var prev = byName[r.name];
      Object.keys(r.present).forEach(function (k) {
        var v = r.present[k];
        if (v === '' || v == null) return;        // 중복 행의 빈 칸이 앞 줄 값을 지우지 않게
        prev.present[k] = v;
      });
    });

    /* 2) 기존 항목 인덱스 (같은 이름이 이미 여러 개면 첫 번째만 남긴다) */
    var idx = {};
    for (var i = hospitals.length - 1; i >= 0; i--) {
      var name = normText(hospitals[i] && hospitals[i].n);
      if (!name) { hospitals.splice(i, 1); stats.changed = true; continue; }
      if (has(idx, name)) { hospitals.splice(i, 1); stats.duplicates++; stats.changed = true; }
      idx[name] = true;
    }
    idx = {};
    hospitals.forEach(function (h) { idx[h.n] = h; });

    /* 3) 병합 — 존재하는 필드만, 빈 값도 권위 있게 */
    order.forEach(function (name) {
      var present = byName[name].present;
      var h = idx[name];
      if (!h) {
        h = buildHospital(name, present);
        hospitals.push(h);
        idx[name] = h;
        stats.added++; stats.changed = true;
        return;
      }
      var touched = false, cleared = false;
      Object.keys(present).forEach(function (k) {
        var v = present[k];
        var was = h[k];
        if (was === v) return;
        // '값 → 빈 값' 은 서버에서 지운 것 — 메모리에서도 지운다(잔존 방지)
        if ((was != null && was !== '') && (v === '' || v == null)) cleared = true;
        h[k] = v;
        touched = true;
      });
      if (touched) { stats.updated++; stats.changed = true; }
      if (cleared) stats.cleared++;
    });

    /* 4) 스냅샷에서 사라진 병원 제거 — 메모리에만 남은 유령이 지도·카운트를 흔들지 않게 */
    if (prune) {
      for (var j = hospitals.length - 1; j >= 0; j--) {
        if (!has(byName, hospitals[j].n)) { hospitals.splice(j, 1); stats.removed++; stats.changed = true; }
      }
    }
    return stats;
  }

  return {
    FIELDS: FIELDS,
    LIMITS: { LAT_MIN: LAT_MIN, LAT_MAX: LAT_MAX, LNG_MIN: LNG_MIN, LNG_MAX: LNG_MAX },
    normText: normText,
    normDate: normDate,
    normCoord: normCoord,
    normalizeRow: normalizeRow,
    buildHospital: buildHospital,
    mergeRows: mergeRows
  };
});
