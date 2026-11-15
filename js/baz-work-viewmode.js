(function () {
  'use strict';
  // Share the preference used by dashboard-pc.html.
  var KEY = 'baz_viewmode';
  var media = window.matchMedia('(min-width:900px)');
  var preference = read();
  var current;

  function read() {
    try {
      var saved = localStorage.getItem(KEY);
      return saved === 'window' || saved === 'mobile' ? saved : null;
    } catch (error) { return null; }
  }

  function apply() {
    current = preference || (media.matches ? 'window' : 'mobile');
    document.body.classList.toggle('mode-window', current === 'window');
    document.body.classList.toggle('mode-mobile', current === 'mobile');
    document.querySelectorAll('#modeToggle [data-mode]').forEach(function (button) {
      var selected = button.dataset.mode === current;
      button.classList.toggle('on', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    window.dispatchEvent(new Event('resize'));
  }

  apply();
  document.addEventListener('DOMContentLoaded', function () {
    apply();
    var toggle = document.getElementById('modeToggle');
    if (!toggle) return;
    toggle.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-mode]');
      if (!button || !toggle.contains(button)) return;
      preference = button.dataset.mode;
      try { localStorage.setItem(KEY, preference); } catch (error) { /* Viewing still works. */ }
      apply();
    });
  });
  function onWidthChange() { if (!preference) apply(); }
  if (media.addEventListener) media.addEventListener('change', onWidthChange);
  else media.addListener(onWidthChange);
  window.addEventListener('storage', function (event) {
    if (event.key === KEY || event.key === null) { preference = read(); apply(); }
  });
})();
