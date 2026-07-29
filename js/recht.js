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

  // Die theme-color-Metas haengen an prefers-color-scheme — nach manuellem
  // Umschalten behielte die Browserleiste sonst die Farbe des Systemschemas.
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  function farbeAngleichen() {
    var dunkel = document.documentElement.dataset.theme === 'dark';
    for (var i = 0; i < metas.length; i++) {
      metas[i].setAttribute('content', dunkel ? '#0B0C0B' : '#FAFAF8');
    }
  }
  farbeAngleichen();   // gespeicherte Wahl kann vom Systemschema abweichen

  knopf.addEventListener('click', function () {
    var wurzel = document.documentElement;
    wurzel.dataset.theme = wurzel.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('theme', wurzel.dataset.theme); } catch (e) {}
    farbeAngleichen();
  });
})();
