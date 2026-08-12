/*******************************************************************
 * baz-date.js — Asia/Seoul 기준 오늘 · 경과일 (BazDate)
 * -----------------------------------------------------------------
 * 왜 분리했나
 *   hospital-pc.html 은 `const TODAY = new Date()` 를 페이지 로드 시 한 번만
 *   고정해 두고 점검 경과일(daysSince)을 계산했다. 공용 PC 는 하루 종일
 *   같은 탭을 열어 두므로, 자정을 넘겨도 경과일·상태 배지가 어제 값에
 *   머물렀다(현장 일정은 Asia/Seoul 로 초기화되는데 화면만 어제였다).
 *   → "지금 필요한 시점"에 Asia/Seoul 날짜를 계산하고, 날짜가 바뀌면
 *      구독자에게 알려 화면을 다시 그리게 한다.
 *
 * 브라우저: <script src="js/baz-date.js"></script> → window.BazDate
 * 테스트  : require('../js/baz-date.js')  (now 주입 가능 — 자정 전후 검증)
 *******************************************************************/
(function (root, factory) {
  var api = factory();
  root.BazDate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TZ = 'Asia/Seoul';
  var cache = { key: '', v: '' };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** Asia/Seoul 의 'yyyy-MM-dd'. now 를 주면 그 시각 기준(테스트용). */
  function todayStr(now) {
    var d = (now == null) ? new Date() : (now instanceof Date ? now : new Date(now));
    var ms = d.getTime();
    // 30초 캐시 — 폴링·필터에서 자주 불린다. 명시적 now 가 오면 캐시하지 않는다.
    if (now == null && cache.v && ms - cache.key < 30000) return cache.v;
    var v = '';
    try {
      var s = new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(d);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) v = s;
    } catch (e) { /* Intl 미지원 환경 → 아래 폴백 */ }
    if (!v) {
      // 폴백: UTC+9 로 직접 환산(기기 표준시간대에 의존하지 않는다)
      var k = new Date(ms + 9 * 3600000);
      v = k.getUTCFullYear() + '-' + pad2(k.getUTCMonth() + 1) + '-' + pad2(k.getUTCDate());
    }
    if (now == null) cache = { key: ms, v: v };
    return v;
  }

  /** 캐시 강제 폐기 — 자정 감시가 날짜 전환을 감지했을 때 */
  function resetCache() { cache = { key: 0, v: '' }; }

  /** 'yyyy-MM-dd' → UTC epoch(자정). 형식이 깨졌으면 null */
  function ymdToUtc(s) {
    var m = String(s || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  }

  /**
   * 점검/방문 경과일 — 기준은 "Asia/Seoul 의 오늘". 날짜 문자열끼리 비교하므로
   * 기기 표준시간대·서머타임과 무관하게 항상 같은 값이 나온다.
   * 파싱 실패 시 null.
   */
  function daysSince(dateStr, now) {
    var from = ymdToUtc(dateStr);
    if (from == null) return null;
    var to = ymdToUtc(todayStr(now));
    if (to == null) return null;
    return Math.floor((to - from) / 86400000);
  }

  /* ── 자정 감시 ────────────────────────────────────────────────────
     setInterval 로 Asia/Seoul 날짜를 지켜보다 바뀌면 구독자를 호출한다.
     (setTimeout 으로 '다음 자정'을 한 번만 예약하면 절전·탭 정지로
      타이머가 밀렸을 때 전환을 통째로 놓친다) */
  var subs = [], watchTimer = null, lastSeen = '';

  function onDayChange(fn) {
    if (typeof fn !== 'function') return function () {};
    subs.push(fn);
    return function () { subs = subs.filter(function (f) { return f !== fn; }); };
  }

  function checkDayChange(now) {
    resetCache();
    var d = todayStr(now);
    if (!lastSeen) { lastSeen = d; return false; }
    if (d === lastSeen) return false;
    lastSeen = d;
    subs.slice().forEach(function (fn) {
      try { fn(d); } catch (e) { try { console.warn('[날짜] 자정 전환 처리 오류:', e); } catch (_) {} }
    });
    return true;
  }

  function startWatch(intervalMs) {
    if (watchTimer) return watchTimer;
    lastSeen = todayStr();
    if (typeof setInterval !== 'function') return null;
    watchTimer = setInterval(function () { checkDayChange(); }, intervalMs || 30000);
    return watchTimer;
  }

  function stopWatch() {
    if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
  }

  return {
    TZ: TZ,
    todayStr: todayStr,
    daysSince: daysSince,
    ymdToUtc: ymdToUtc,
    resetCache: resetCache,
    onDayChange: onDayChange,
    checkDayChange: checkDayChange,
    startWatch: startWatch,
    stopWatch: stopWatch
  };
});
