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
  lese, berliner, raeumeAuf, tagesliste,
  standAbfragen, standErhoehen, standLoeschen,
} from '../lib/zaehler.mjs';

export const config = { path: '/api/statistik' };

const KOPF = { 'Cache-Control': 'no-store' };
const MIN_LAENGE = 10;
const MAX_TAGE   = 400;

/* Zehn Fehlversuche in der Stunde. Das reicht fuer vertippte Finger
   und fuehrt beim Durchprobieren nirgendwohin. Gelungene Anmeldungen
   zaehlen nicht mit — siehe unten.

   Eigener Topf: der alte hiess »anmeldung« und zaehlte etwas anderes.
   Mit dem neuen Namen faellt kein alter Stand mehr ins Gewicht, und
   wer sich damals ausgesperrt hat, kommt sofort wieder hinein. */
const VERSUCHE = 10;
const TOPF = 'fehlversuch';

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

  /* Gezaehlt werden nur Fehlversuche, und der Stand wird gelesen,
     bevor das Passwort ueberhaupt geprueft wird.

     Anfangs zaehlte hier jede Anfrage — das war ein Fehler: das
     Dashboard fragt bei jedem Zeitraumwechsel neu an, und nach ein
     paar Klicks stand der Betrieb vor seiner eigenen Auswertung und
     las »Zu viele Versuche«. Ein richtiges Passwort raeumt den Stand
     jetzt sogar weg. Gegen Durchprobieren wirkt das unveraendert:
     wer das Passwort nicht hat, kommt ueber zehn Fehlgriffe in der
     Stunde nicht hinaus. */
  const adresse = context?.ip
    || request.headers.get('x-nf-client-connection-ip')
    || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();

  let stand = 0;
  try {
    stand = await standAbfragen(TOPF, adresse);
  } catch (fehler) {
    // Faellt die Zaehlung aus, soll das Dashboard trotzdem aufgehen.
    console.error('Anmeldegrenze nicht pruefbar:', fehler.message);
  }
  if (stand >= VERSUCHE) {
    return antwort(429, { text: 'Zu viele Fehlversuche. Bitte in einer Stunde noch einmal.' });
  }

  if (!zeitgleich(String(anfrage?.passwort ?? ''), passwort)) {
    const uebrig = Math.max(0, VERSUCHE - 1 - stand);
    try { await standErhoehen(TOPF, adresse); } catch { /* nicht der Rede wert */ }
    return antwort(401, { text: 'Passwort stimmt nicht.'
      + (uebrig <= 3 ? ` Noch ${uebrig} Versuch${uebrig === 1 ? '' : 'e'}.` : '') });
  }

  // Richtig — der Zaehler kann weg, sonst wirkt ein alter Fehlgriff nach.
  try { await standLoeschen(TOPF, adresse); } catch { /* nicht der Rede wert */ }

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
