/* ============================================================
   ZAEHLPUNKT
   Nimmt die Meldungen der Seite entgegen: ein Aufruf, ein
   angefangenes Formular, ein Klick auf die Telefonnummer. Mehr
   kommt hier nicht an, und mehr wird auch nicht angenommen —
   jedes Merkmal wird gegen eine feste Liste geprueft und alles
   Uebrige verworfen. Was durchkommt, landet als Strichliste in
   netlify/lib/zaehler.mjs; ein Besucherschluessel entsteht nirgends.

   Der abgeschickte Formularversand wird hier nicht gemeldet: den
   zaehlt netlify/functions/formular.mjs selbst, wenn die Mail
   wirklich draussen ist. Sonst stuenden im Dashboard Anfragen, die
   nie im Postfach ankamen.

   Antwort ist immer 204 — auch wenn nichts gezaehlt wurde. Die
   Seite soll aus der Antwort nichts ableiten und schon gar nicht
   darauf reagieren; das ist eine Strichliste, kein Dialog.
   ============================================================ */
import {
  ARTEN, ZIELE, FORMULARE,
  seiteAus, quelleAus, geraetAus, istMaschine, zaehle, imRahmen,
} from '../lib/zaehler.mjs';

export const config = { path: '/api/zaehl' };

const STILL = new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
const still = () => STILL.clone();

export default async (request, context) => {
  if (request.method !== 'POST') return still();

  const kennung = request.headers.get('user-agent') || '';
  if (istMaschine(kennung)) return still();

  /* sendBeacon schickt einen Blob, dessen Inhaltstyp je nach
     Browser text/plain oder application/json ist. Darum wird der
     Rumpf als Text gelesen und selbst ausgepackt, statt sich auf
     request.json() und den passenden Kopf zu verlassen. */
  let meldung;
  try {
    const roh = await request.text();
    if (roh.length > 2000) return still();
    meldung = JSON.parse(roh);
  } catch {
    return still();
  }
  if (!meldung || typeof meldung !== 'object') return still();

  const art = String(meldung.art || '');
  if (!ARTEN[art] || art === 'senden') return still();

  /* Merkmale zusammenstellen. Jedes einzeln geprueft: was nicht in
     der Liste steht, laesst das Ereignis fallen. Ein unbekannter
     Pfad ist kein Grund, ihn als »sonstige Seite« mitzuzaehlen —
     dann waere die Statistik ein Eimer fuer alles, was jemand an
     diese Adresse schickt. */
  const merkmale = {};
  if (art === 'aufruf') {
    const seite = seiteAus(meldung.seite);
    if (!seite) return still();
    merkmale.seite = seite;
    merkmale.geraet = geraetAus(kennung);
    /* Der eigene Rechnername kommt aus der Anfrage, nicht aus einer
       festen Zeile: so gilt dieselbe Regel auf der Netlify-Vorschau
       wie unter der richtigen Adresse. Aus dem Verweis wird nur die
       Schublade behalten, nie die Adresse. */
    let eigen = '';
    try { eigen = new URL(request.url).hostname.toLowerCase().replace(/^www\./, ''); } catch {}
    merkmale.quelle = quelleAus(meldung.verweis, eigen);
  } else if (art === 'start') {
    if (!FORMULARE.includes(meldung.formular)) return still();
    merkmale.formular = meldung.formular;
  } else if (art === 'klick') {
    if (!ZIELE.includes(meldung.ziel)) return still();
    merkmale.ziel = meldung.ziel;
  }

  /* Erst pruefen, dann zaehlen: eine Meldung, die ohnehin verworfen
     wird, soll niemandem sein Kontingent nehmen. */
  const adresse = context?.ip
    || request.headers.get('x-nf-client-connection-ip')
    || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();

  try {
    if (!(await imRahmen(adresse))) return still();
    await zaehle(art, merkmale);
  } catch (fehler) {
    /* Eine Statistik darf nie der Grund sein, dass eine Seite
       langsamer wird oder Fehler meldet. Ins Protokoll damit, und
       nach aussen bleibt es bei der stummen Antwort. */
    console.error('Zaehlung fehlgeschlagen:', fehler.message);
  }
  return still();
};
