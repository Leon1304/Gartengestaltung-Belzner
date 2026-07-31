/* ============================================================
   ABWEHR
   Zwei Dinge, die der Browser nicht allein erledigen kann:

   1. Die Rechenaufgabe. Frueher wuerfelte sie das Skript der Seite und
      pruefte sie auch selbst — wer direkt auf /api/formular postete,
      wurde davon nie behelligt. Jetzt stellt der Server die Aufgabe und
      gibt sie zusammen mit einer Unterschrift heraus; zurueck kommt nur,
      was er selbst signiert hat. Die Loesung steht nirgends in der Marke.

   2. Die Ratengrenze. Ohne sie ist das Formular ein offenes Tor zum
      Postfach: ein Skript, das im Sekundentakt sendet, laesst es
      volllaufen und bringt im Zweifel den Mailversand des Anbieters
      ins Stocken. Gezaehlt wird pro Stunde, je Absender und insgesamt.

   Der Schluessel kommt aus CAPTCHA_SECRET. Fehlt die Variable, leitet
   sich einer aus SMTP_PASS ab — nicht schoen, aber besser als eine
   Seite, deren Formulare nach dem Deploy stillstehen, weil eine
   Umgebungsvariable vergessen wurde. Gesetzt werden sollte sie trotzdem.
   ============================================================ */
import crypto from 'node:crypto';

/* ---------- Schluessel ---------- */
let zwischenSchluessel;
function schluessel() {
  if (zwischenSchluessel) return zwischenSchluessel;
  const roh = process.env.CAPTCHA_SECRET || process.env.SMTP_PASS;
  if (!roh) throw new Error('Weder CAPTCHA_SECRET noch SMTP_PASS ist gesetzt');
  // Eigener Namensraum: aus demselben Geheimnis wird nie zweimal derselbe
  // Schluessel, egal wofuer es sonst noch dient.
  zwischenSchluessel = crypto.createHash('sha256').update('belzner:abwehr:' + roh).digest();
  return zwischenSchluessel;
}

const unterschrift = (nutzlast) =>
  crypto.createHmac('sha256', schluessel()).update(nutzlast).digest('base64url');

/* Vergleich ohne fruehen Abbruch — die Laufzeit soll nichts verraten.
   Wird auch vom Dashboard fuer das Passwort gebraucht, darum exportiert. */
export function zeitgleich(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ============================================================
   RECHENAUFGABE
   ============================================================ */

/* Ausgeschriebene Zahlwoerter zaehlen auch — wer die Aufgabe vorgelesen
   bekommt, tippt eher »zwoelf« als »12«. */
const ZAHLWORT = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht',
                  'neun', 'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn',
                  'sechzehn', 'siebzehn', 'achtzehn'];

/* Untergrenze: kein Mensch loest eine Aufgabe in zwei Sekunden, ein Skript
   schon. Obergrenze: laenger als eine halbe Stunde soll eine Marke nicht
   gelten, sonst laesst sich eine einmal geloeste Aufgabe lange nachnutzen. */
const MIN_ALTER =  2 * 1000;
const MAX_ALTER = 30 * 60 * 1000;

export function neueAufgabe(jetzt = Date.now()) {
  const rnd = (n) => crypto.randomInt(n);
  const plus = crypto.randomInt(2) === 0;
  // Beim Minus bleibt das Ergebnis immer >= 2: nie negativ und nie null,
  // denn eine leere Eingabe darf keine gueltige Antwort sein.
  const a = plus ? 1 + rnd(9) : 3 + rnd(7);
  const b = plus ? 1 + rnd(9) : 1 + rnd(a - 2);
  const nutzlast = `${a}.${b}.${plus ? 'p' : 'm'}.${jetzt}`;
  return {
    aufgabe: `${a} ${plus ? '+' : '−'} ${b} =`,
    marke: `${nutzlast}.${unterschrift(nutzlast)}`,
  };
}

/* Gibt { ok } oder { ok:false, grund } zurueck. Die Gruende sind
   auseinandergehalten, damit der Besucher eine Meldung bekommt, die zu
   seiner Lage passt: eine abgelaufene Marke ist etwas anderes als eine
   falsche Antwort, und beides etwas anderes als ein Bot. */
export function pruefeMarke(marke, antwort, jetzt = Date.now()) {
  const teile = String(marke ?? '').split('.');
  if (teile.length !== 5) return { ok: false, grund: 'ungueltig' };

  const [a, b, op, iat, sig] = teile;
  if (!zeitgleich(sig, unterschrift(`${a}.${b}.${op}.${iat}`))) {
    return { ok: false, grund: 'ungueltig' };
  }

  /* Der Zeitpunkt kommt vom Server und traegt dessen Unterschrift — die
     Uhr des Besuchers spielt keine Rolle mehr. Genau daran scheiterte die
     alte Loesung: ging die Uhr im Geraet vor, verschwand die Anfrage
     kommentarlos, waehrend im Browser »Danke!« stand. */
  const alter = jetzt - Number(iat);
  if (!Number.isFinite(alter) || alter > MAX_ALTER || alter < -MIN_ALTER) {
    return { ok: false, grund: 'abgelaufen' };
  }
  if (alter < MIN_ALTER) return { ok: false, grund: 'schnell' };

  const soll = op === 'p' ? Number(a) + Number(b) : Number(a) - Number(b);
  return zahl(antwort) === soll ? { ok: true } : { ok: false, grund: 'falsch' };
}

function zahl(eingabe) {
  const v = String(eingabe ?? '').trim().toLowerCase().replace(/[.,!?]/g, '');
  const wort = ZAHLWORT.indexOf(v);
  if (wort > -1) return wort;
  return /^\d{1,2}$/.test(v) ? Number(v) : NaN;
}

/* ============================================================
   RATENGRENZE
   Gezaehlt wird in Stundenfenstern: der Schluessel traegt die Stunde,
   mit der naechsten faengt die Zaehlung von selbst wieder bei null an.
   Von der Adresse des Absenders wird nichts aufbewahrt — in die Ablage
   wandert nur ein mit dem Serverschluessel gebildeter Pruefwert.
   ============================================================ */
const FENSTER  = 60 * 60 * 1000;
const PRO_IP   = 3;    // Anfragen je Absender und Stunde
const GESAMT   = 60;   // Anfragen ueber alle Absender und Stunde

/* Netlify Blobs teilt den Zaehlstand ueber alle Instanzen. Steht die
   Ablage nicht bereit — beim oertlichen Test etwa —, zaehlt eine Map im
   Arbeitsspeicher weiter: schwaecher, aber besser als gar keine Grenze. */
const speicher = new Map();
let ablage;

async function hole() {
  if (ablage !== undefined) return ablage;
  try {
    const { getStore } = await import('@netlify/blobs');
    // strong: der naechste Aufruf soll sehen, was dieser gerade geschrieben hat.
    ablage = getStore({ name: 'formular-grenze', consistency: 'strong' });
  } catch {
    ablage = null;
  }
  return ablage;
}

async function lies(schl) {
  const a = await hole();
  if (a) {
    try { return (await a.get(schl, { type: 'json' })) ?? 0; }
    catch { ablage = null; }   // ab jetzt der Arbeitsspeicher
  }
  return speicher.get(schl) ?? 0;
}

async function schreib(schl, wert) {
  const a = await hole();
  if (a) {
    try { await a.setJSON(schl, wert); return; }
    catch { ablage = null; }
  }
  speicher.set(schl, wert);
}

/* Wird erst unmittelbar vor dem Versand aufgerufen: eine Anfrage, die
   ohnehin an der Sicherheitsabfrage scheitert, soll niemandem sein
   Kontingent wegnehmen — hinter einem Firmenanschluss teilen sich viele
   Menschen dieselbe Adresse. */
export async function verbrauche(adresse, jetzt = Date.now()) {
  const fenster = Math.floor(jetzt / FENSTER);
  const wer = adresse
    ? crypto.createHmac('sha256', schluessel()).update(String(adresse)).digest('base64url').slice(0, 24)
    : 'unbekannt';

  const schlIp = `ip-${fenster}-${wer}`;
  const schlAll = `alle-${fenster}`;
  const [standIp, standAll] = await Promise.all([lies(schlIp), lies(schlAll)]);

  if (standIp >= PRO_IP)  return { ok: false, grund: 'absender' };
  if (standAll >= GESAMT) return { ok: false, grund: 'gesamt' };

  await Promise.all([schreib(schlIp, standIp + 1), schreib(schlAll, standAll + 1)]);
  return { ok: true };
}

/* Nur fuer den Test: setzt die Zaehlung im Arbeitsspeicher zurueck. */
export function _speicherLeeren() {
  speicher.clear();
}
