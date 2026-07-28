/* Farbschema-Schalter fuer Impressum und Datenschutz.
   Das Setzen beim Seitenaufbau steht bewusst inline im <head> jeder Seite —
   liefe es erst hier, saehe man im Dunkelmodus einen hellen Aufblitzer.
   Hier bleibt nur der Knopf. */
(function () {
  'use strict';
  var knopf = document.getElementById('themeToggle');
  if (!knopf) return;

  // Ohne JavaScript liesse sich nichts umschalten, darum steht der Knopf
  // im Markup auf hidden und erscheint erst jetzt.
  knopf.hidden = false;

  knopf.addEventListener('click', function () {
    var wurzel = document.documentElement;
    wurzel.dataset.theme = wurzel.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('theme', wurzel.dataset.theme); } catch (e) {}
  });
})();
