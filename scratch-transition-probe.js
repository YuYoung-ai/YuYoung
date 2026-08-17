/* 전환 병원 진단 — 대시보드를 연 상태에서 브라우저 콘솔에 그대로 붙여넣으세요.
   아무것도 바꾸지 않고 세기만 합니다(읽기 전용).
   목적: "교육 미흡→양호", "재사용 O→2회 연속 X" 전환 병원이 실제로 몇 곳인지 확인해
        전환 전후 비교 카드를 만들 가치가 있는지 판단한다. */
(function () {
  var rows = (window.RAW || []).filter(function (r) { return recScope(r) === 'customer'; });
  if (!rows.length) return console.log('데이터가 없습니다. 대시보드 로딩 후 다시 실행하세요.');

  var key = function (r) { return (r._y || 0) * 10000 + (r._m || 0) * 100 + (r._d || 0); };
  var H = {};
  rows.forEach(function (r) {
    var nm = String(r.hosp || '').trim(); if (!nm) return;
    var k = skNorm_(nm);
    var h = H[k] || (H[k] = { name: nm, ev: [], nz: [], leak: [] });
    var f = String(r.nsFill || '').trim(), a = String(r.nsAmt || '').trim(), t = String(r.jet || '').trim();
    /* 교육 평가 — buildSkillData 와 같은 미흡 기준(NS 충진 X / 충진량 부족 / 젯 분사 "교육") */
    if (f || a || t) {
      h.ev.push({ d: key(r), bad: (f.toUpperCase() === 'X') || (a === '부족') || /교육/.test(t) });
    }
    var v = String(r.nozzleReuse || '').trim().toUpperCase();
    if (v === 'O' || v === 'X') h.nz.push({ d: key(r), o: v === 'O' });
    if (hpCleanKey_(r.type) === '노즐누수(약액유입)' && rowDate(r)) h.leak.push(key(r));
  });

  var byD = function (a, b) { return a.d - b.d; };
  var eduT = [], nozT = [], multiEv = 0, multiNz = 0;
  Object.keys(H).forEach(function (k) {
    var h = H[k];
    h.ev.sort(byD); h.nz.sort(byD);
    if (h.ev.length >= 2) multiEv++;
    if (h.nz.length >= 2) multiNz++;
    /* 교육 전환: 과거에 미흡이 있었는데 최신 평가가 양호 */
    if (h.ev.length >= 2 && !h.ev[h.ev.length - 1].bad && h.ev.some(function (e) { return e.bad; })) {
      var at = null;
      for (var i = h.ev.length - 1; i > 0; i--) { if (h.ev[i - 1].bad && !h.ev[i].bad) { at = h.ev[i].d; break; } }
      eduT.push({ name: h.name, at: at, before: h.leak.filter(function (d) { return d < at; }).length,
                  after: h.leak.filter(function (d) { return d >= at; }).length });
    }
    /* 재사용 전환: 과거에 O 가 있었는데 최근 2회가 연속 X */
    var n = h.nz.length;
    if (n >= 2 && !h.nz[n - 1].o && !h.nz[n - 2].o && h.nz.some(function (x) { return x.o; })) {
      var at2 = h.nz[n - 2].d;
      nozT.push({ name: h.name, at: at2, before: h.leak.filter(function (d) { return d < at2; }).length,
                  after: h.leak.filter(function (d) { return d >= at2; }).length });
    }
  });

  var sum = function (a, f) { return a.reduce(function (s, x) { return s + f(x); }, 0); };
  var rep = function (t, arr) {
    console.log('\n■ ' + t + ' : ' + arr.length + '곳');
    if (!arr.length) return;
    console.log('   전환 전 누수 합계 ' + sum(arr, function (x) { return x.before; })
      + '건 → 전환 후 ' + sum(arr, function (x) { return x.after; }) + '건');
    console.table(arr.map(function (x) {
      return { 병원: x.name, 전환일: x.at, 전환전_누수: x.before, 전환후_누수: x.after };
    }));
  };

  console.log('=== 전환 병원 진단 ===');
  console.log('전체 병원 ' + Object.keys(H).length + '곳 | 교육 평가 2회 이상 ' + multiEv
    + '곳 | 노즐 기록 2회 이상 ' + multiNz + '곳');
  rep('교육 미흡 → 양호 전환', eduT);
  rep('재사용 O → 최근 2회 연속 X', nozT);
  console.log('\n※ 전환 병원이 각 5곳 미만이면 전환 전후 비교는 통계로 쓰기 어렵습니다.');
})();
