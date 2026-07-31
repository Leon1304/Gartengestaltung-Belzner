/* ============================================================
   STATISTIK AUSGEBEN
   Die Gegenstelle zu dashboard.html. Gibt die Strichlisten eines
   Zeitraums heraus — aber nur gegen das Passwort aus
   DASHBOARD_PASSWORT.

   WARUM POST UND NICHT GET
   Ein Passwort in der Adresszeile landet im Verlauf des Browsers,
   im Protokoll des Hosters und im Verweis-Kopf der naechsten
   Anfrage. Im Rumpf einer POST-Anfrage nichts davon.

   WAS HIER NICHT PASSIERT
   Es wird keine Sitzung angelegt, kein Cookie gesetzt, kein Token
   ausgegeben. Das Dashboard behaelt das Passwort in einer Variablen
   im Arbeitsspeicher des Browsers und schickt es bei jeder Abfrage
   mit; nach dem Neuladen der Seite ist es weg. Damit bleibt der
   Satz »Diese Website setzt keine Cookies« wortwoertlich richtig.

   Umgebungsvariablen der Netlify-Seite:
     DASHBOARD_PASSWORT   mindestens 10 Zeichen
     CAPTCHA_SECRET       fuer den Pruefwert der Absenderadresse
   ============================================================ */
import { zeitgleich } from '../lib/abwehr.mjs';
import {
  ARTEN, BESCHRIFTUNG, SEITEN,
  lese, berliner, imRahmen, raeumeAuf, tagesliste,
} from '../lib/zaehler.mjs';

export const config = { path: '/api/statistik' };

const KOPF = { 'Cache-Control': 'no-store' };
const MIN_LAENGE = 10;
const MAX_TAGE   = 400;

/* Zehn Versuche in der Stunde. Das reicht fuer vertippte Finger und
   fuehrt beim Durchprobieren nirgendwohin. */
const VERSUCHE = 10;

const antwort = (status, rumpf) => Response.json(rumpf, { status, headers: KOPF });

const istTag = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''));

export default async (request, context) => {
  if (request.method !== 'POST') return antwort(405, { text: 'Nur POST.' });

  const passwort = process.env.DASHBOARD_PASSWORT || '';
  if (!passwort) {
    console.error('DASHBOARD_PASSWORT ist nicht gesetzt — das Dashboard bleibt zu.');
    return antwort(503, { text: 'Das Dashboard ist noch nicht eingerichtet: In den '
                              + 'Netlify-Einstellungen fehlt die Variable DASHBOARD_PASSWORT.' });
  }
  if (passwort.length < MIN_LAENGE) {
    /* Lieber verschlossen als schlecht verschlossen. Wer hier steht,
       hat Zugriff auf die Einstellungen und kann es in einer Minute
       beheben — ein Besucher sieht diese Meldung nie. */
    console.error(`DASHBOARD_PASSWORT ist zu kurz (${passwort.length} Zeichen, `
                + `mindestens ${MIN_LAENGE} noetig).`);
    return antwort(503, { text: `Das hinterlegte Passwort ist zu kurz. Bitte in den `
                              + `Netlify-Einstellungen ein Passwort mit mindestens `
                              + `${MIN_LAENGE} Zeichen setzen.` });
  }

  let anfrage;
  try {
    anfrage = await request.json();
  } catch {
    return antwort(400, { text: 'Die Anfrage kam unvollständig an.' });
  }

  /* Erst die Grenze, dann der Vergleich: sonst liesse sich das
     Passwort in aller Ruhe durchprobieren. */
  const adresse = context?.ip
    || request.headers.get('x-nf-client-connection-ip')
    || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  try {
    if (!(await imRahmen(adresse, { grenze: VERSUCHE, topf: 'anmeldung' }))) {
      return antwort(429, { text: 'Zu viele Versuche. Bitte in einer Stunde noch einmal.' });
    }
  } catch (fehler) {
    // Faellt die Zaehlung aus, soll das Dashboard trotzdem aufgehen.
    console.error('Anmeldegrenze nicht pruefbar:', fehler.message);
  }

  if (!zeitgleich(String(anfrage?.passwort ?? ''), passwort)) {
    return antwort(401, { text: 'Passwort stimmt nicht.' });
  }

  /* ---------- Zeitraum ---------- */
  const heute = berliner().tag;
  let bis = istTag(anfrage.bis) ? anfrage.bis : heute;
  let von = istTag(anfrage.von) ? anfrage.von : tagesliste(heute, heute)[0];
  if (bis > heute) bis = heute;
  if (von > bis) von = bis;
  // Zu grosse Zeitraeume abschneiden statt abweisen: das Dashboard
  // bekommt dann eben weniger, aber es bekommt etwas.
  const liste = tagesliste(von, bis);
  if (liste.length > MAX_TAGE) von = liste[liste.length - MAX_TAGE];

  let tage;
  try {
    tage = await lese(von, bis);
  } catch (fehler) {
    console.error('Statistik nicht lesbar:', fehler.message);
    return antwort(502, { text: 'Die Zahlen ließen sich gerade nicht laden.' });
  }

  /* Beim Lesen faellt ohnehin schon Arbeit an — die abgelaufenen
     Fenster der Ratengrenzen gleich mit wegraeumen. Faellt es aus,
     ist es nicht der Rede wert. */
  raeumeAuf().catch(() => {});

  return antwort(200, {
    ok: true,
    von, bis, heute,
    arten: ARTEN,
    seiten: [...new Set(Object.values(SEITEN))],
    beschriftung: BESCHRIFTUNG,
    tage,
  });
};
