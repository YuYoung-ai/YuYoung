/* 토스트 알림 (기존 페이지 공통 패턴 이관) */
AD.toast = function (msg) {
  var e = document.getElementById('toast');
  if (!e) {
    e = document.createElement('div');
    e.id = 'toast'; e.className = 'toast';
    document.body.appendChild(e);
  }
  e.textContent = msg;
  e.classList.add('on');
  clearTimeout(AD.toast._t);
  AD.toast._t = setTimeout(function () { e.classList.remove('on'); }, 2600);
};
