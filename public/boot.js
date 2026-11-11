// Runs before first paint: apply the saved theme and mark that scripts run (entrance animations).
// Kept as a file, not inline, so the Content-Security-Policy can forbid inline scripts.
(function () {
  var d = document.documentElement;
  d.classList.add('js');
  setTimeout(function () {
    if (!window.anonimizaReady) d.classList.remove('js');
  }, 2500);
  try {
    var t = JSON.parse(localStorage.getItem('anonimiza-settings') || '{}').theme;
    if (t === 'dark' || t === 'light') d.dataset.theme = t;
  } catch (e) {}
})();
