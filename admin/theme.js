// Lu avant l'affichage de l'admin : le thème choisi sur le site (bouton lune),
// et le refus d'être affiché à l'intérieur d'une autre page (« clickjacking »).
(function () {
  'use strict';
  var racine = document.documentElement;
  if (window.top !== window.self) {
    racine.className += ' encadre';
    try { window.top.location.replace(window.self.location.href); } catch (e) { /* page étrangère : on reste caché */ }
    return;
  }
  try {
    if (localStorage.getItem('uio-theme') === 'sombre') {
      racine.setAttribute('data-theme', 'sombre');
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', '#0E1420');
    }
  } catch (e) { /* stockage bloqué : thème clair */ }
})();
