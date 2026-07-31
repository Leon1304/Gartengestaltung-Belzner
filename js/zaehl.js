/* ============================================================
   REICHWEITENMESSUNG
   Meldet dem eigenen Server, dass eine Seite aufgerufen wurde,
   dass jemand ein Formular angefasst hat und dass eine Nummer,
   eine Adresse oder die Karte angeklickt wurde. Mehr geht hier
   nicht hinaus.

   Was NICHT passiert: kein Cookie, kein Eintrag im Local Storage,
   keine Kennung, keine Verweildauer, keine Mausspur. Es entsteht
   nichts, woran sich ein Besucher beim naechsten Mal wiedererkennen
   liesse — auch nicht von uns.

   Vom Verweis geht nur die Adresse der vorherigen Seite mit, und
   auch die wird auf dem Server sofort auf eine grobe Schublade
   abgebildet (»google«, »instagram«, »direkt«) und dann verworfen.

   Die Gegenstelle steht in netlify/functions/zaehl.mjs. Sie
   antwortet immer gleich, egal was ankommt — dieses Skript wertet
   die Antwort deshalb gar nicht erst aus.
   ============================================================ */
(() => {
  'use strict';

  const ZIEL = '/api/zaehl';

  /* sendBeacon ueberlebt den Seitenwechsel: ein Klick auf eine
     Telefonnummer oder einen Verweis nach draussen raeumt das
     Fenster ab, bevor ein normales fetch fertig waere. Wo es die
     Funktion nicht gibt, tut es fetch mit keepalive; und wo auch
     das fehlt, wird eben nicht gezaehlt. Ein Zaehler darf nie der
     Grund sein, dass ein Klick ins Leere geht. */
  function melde(nutzlast) {
    let text;
    try { text = JSON.stringify(nutzlast); } catch { return; }
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ZIEL, new Blob([text], { type: 'text/plain;charset=UTF-8' }));
        return;
      }
      fetch(ZIEL, { method: 'POST', body: text, keepalive: true, mode: 'same-origin' })
        .catch(() => {});
    } catch { /* geschenkt */ }
  }

  /* ---------- Aufruf ---------- */
  melde({ art: 'aufruf', seite: location.pathname, verweis: document.referrer || '' });

  /* ---------- Formular angefangen ----------
     Nicht der Versand, sondern der erste Tastendruck. Aus beidem
     zusammen wird im Dashboard die Abbruchquote: wie viele, die
     ein Formular anfangen, es auch abschicken. Je Seitenaufruf
     hoechstens einmal, sonst zaehlte jedes Zurueckspringen ins
     Feld noch einmal mit. */
  const angefangen = new Set();
  const FORMULARE = { contactForm: 'anfrage', jobForm: 'bewerbung' };

  for (const [id, formular] of Object.entries(FORMULARE)) {
    const form = document.getElementById(id);
    if (!form) continue;
    form.addEventListener('focusin', () => {
      if (angefangen.has(formular)) return;
      angefangen.add(formular);
      melde({ art: 'start', formular });
    }, { once: false });
  }

  /* ---------- Klicks ----------
     Ueber das Dokument statt an jedem Verweis einzeln: die Seite
     baut Teile ihres Inhalts erst waehrend des Scrollens auf, und
     ein spaeter eingefuegter Verweis soll genauso zaehlen. */
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('a[href], button');
    if (!el) return;

    if (el.id === 'mapLoad') return melde({ art: 'klick', ziel: 'maps' });

    const ziel = el.getAttribute('href') || '';
    if (ziel.startsWith('tel:'))    return melde({ art: 'klick', ziel: 'telefon' });
    if (ziel.startsWith('mailto:')) return melde({ art: 'klick', ziel: 'email' });
    if (/^https?:\/\/(www\.)?instagram\.com/i.test(ziel))
      return melde({ art: 'klick', ziel: 'instagram' });
    if (/^https?:\/\/(www\.)?google\.[a-z.]+\/maps/i.test(ziel))
      return melde({ art: 'klick', ziel: 'maps' });
    if (/^projekte\.html/.test(ziel) || /^\/projekte\.html/.test(ziel))
      return melde({ art: 'klick', ziel: 'projekte' });
  }, { passive: true, capture: true });
})();
