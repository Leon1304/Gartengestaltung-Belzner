/* ============================================================
   ZAEHLER
   Die Reichweitenmessung der Seite. Gezaehlt werden Aufrufe,
   angefangene und abgeschickte Formulare und ein paar Klicks —
   mehr nicht. Es gibt keinen Besucherschluessel, kein Cookie und
   keinen Eintrag im Geraet: was hier ankommt, wird sofort auf
   wenige grobe Merkmale reduziert und auf einen Zaehler addiert.
   Damit laesst sich niemand wiedererkennen, und aus demselben
   Grund kann diese Messung auch keine »eindeutigen Besucher«
   ausweisen. Das ist Absicht, nicht Nachlaessigkeit.

   ABLAGE
   Drei Schluesselformen im Blob-Speicher »statistik«:

     std/2026-07-31/14   Wuerfel einer Stunde. Hierhin wird geschrieben.
     tag/2026-07-31      Wuerfel eines abgeschlossenen Tages, nach
                         Stunden geordnet. Hieraus wird gelesen.
     grenze/<f>_<h>      Ereignisse je Absender und Stunde.

   Ein »Wuerfel« ist eine flache Tabelle: Merkmalskombination →
   Anzahl, etwa { "start_google_handy": 3 }. Die Kombinationen sind
   wenige (vier Seiten, sechs Quellen, drei Geraeteklassen), darum
   bleibt ein Tag bei ein paar Kilobyte, egal wie viele Aufrufe
   darauf entfallen.

   WARUM STUNDENWEISE
   @netlify/blobs 8 kennt kein bedingtes Schreiben — es gibt zwar
   ein ETag beim Lesen, aber kein »schreib nur, wenn es noch
   passt«. Ein echter Vergleich-und-Tausch ist damit nicht zu
   haben. Stattdessen faellt das Hochzaehlen auf 24 getrennte
   Blobs am Tag auseinander, und nach dem Schreiben wird geprueft,
   ob der eigene Zuwachs noch dasteht; fehlt er, war jemand
   dazwischen und es geht von vorn los. Uebrig bleibt ein Restrisiko
   von zwei Schreibvorgaengen in derselben Millisekunde nach drei
   Anlaeufen — bei dieser Seite praktisch ausgeschlossen, und der
   Preis waere ein verlorener Aufruf, nicht ein falscher.
   ============================================================ */
import crypto from 'node:crypto';

const LADEN = 'statistik';

/* ============================================================
   WORTLISTEN
   Alles, was gezaehlt wird, muss vorher hier stehen. Was nicht in
   der Liste steht, wird verworfen und nicht etwa unter »sonstiges«
   gesammelt: sonst waere der Zaehler ein Ablageort fuer alles, was
   jemand an /api/zaehl schickt.

   Die Beschriftungen wandern mit den Zahlen ins Dashboard. So
   stehen Kuerzel und Klartext an einer Stelle und koennen nicht
   auseinanderlaufen.
   ============================================================ */

/* Pfad → Kuerzel. Der Browser schickt den Pfad, nicht das Kuerzel;
   damit bleibt die Liste hier die einzige Wahrheit. */
export const SEITEN = {
  '/': 'start',
  '/index.html': 'start',
  '/projekte.html': 'projekte',
  '/impressum.html': 'impressum',
  '/datenschutz.html': 'datenschutz',
};

/* Herkunft. Aus dem Verweis kommt nur der Rechnername an, und auch
   der wird sofort auf eine dieser Schubladen abgebildet — die
   vollstaendige Adresse der vorherigen Seite wird nirgends abgelegt. */
const QUELLEN = [
  [/(^|\.)google\./,                 'google'],
  [/(^|\.)(bing|duckduckgo|ecosia)\./, 'suche'],
  [/(^|\.)instagram\./,              'instagram'],
  [/(^|\.)(facebook|fb)\./,          'facebook'],
  [/(^|\.)(gelbeseiten|dasoertliche|11880|meinestadt)\./, 'verzeichnis'],
];

export const ZIELE   = ['telefon', 'email', 'instagram', 'maps', 'projekte'];
export const GERAETE = ['handy', 'tablet', 'rechner'];
export const FORMULARE = ['anfrage', 'bewerbung'];

/* Die Auswahllisten der beiden Formulare. Weicht der Wert ab, wird
   das Ereignis trotzdem gezaehlt, nur eben ohne Thema — eine
   Anfrage soll nicht deshalb verschwinden, weil jemand am Formular
   eine Zeile geaendert hat und diese Liste noch nicht nachgezogen ist. */
export const ANLIEGEN = {
  'Fertigrasen':                   'fertigrasen',
  'Steinarbeiten & Zäune':         'stein',
  'Pflanzenarbeiten & Baumschule': 'pflanzen',
  'Bewässerungssysteme':           'wasser',
  'Mähroboter':                    'maehroboter',
  'Komplette Gartenanlage':        'anlage',
  'Gartenpflege':                  'pflege',
  'Sonstiges':                     'sonstiges',
};
export const STELLEN = {
  'Ausbildung zum Gärtner (m/w/d)':            'ausbildung',
  'Garten- und Landschaftsbaugärtner (m/w/d)': 'landschaftsbau',
  'Gartenpfleger (m/w/d)':                     'gartenpfleger',
  'Initiativbewerbung':                        'initiativ',
};

export const BESCHRIFTUNG = {
  seite:    { start: 'Startseite', projekte: 'Projekte', impressum: 'Impressum',
              datenschutz: 'Datenschutz' },
  quelle:   { direkt: 'Direkt / Lesezeichen', google: 'Google', suche: 'Andere Suchmaschine',
              instagram: 'Instagram', facebook: 'Facebook', verzeichnis: 'Branchenverzeichnis',
              extern: 'Andere Website' },
  geraet:   { handy: 'Handy', tablet: 'Tablet', rechner: 'Rechner' },
  ziel:     { telefon: 'Telefonnummer', email: 'E-Mail-Adresse', instagram: 'Instagram',
              maps: 'Karte & Anfahrt', projekte: 'Zu den Projekten' },
  formular: { anfrage: 'Kontaktanfrage', bewerbung: 'Bewerbung' },
  thema:    { fertigrasen: 'Fertigrasen', stein: 'Steinarbeiten & Zäune',
              pflanzen: 'Pflanzenarbeiten & Baumschule', wasser: 'Bewässerungssysteme',
              maehroboter: 'Mähroboter', anlage: 'Komplette Gartenanlage',
              pflege: 'Gartenpflege', sonstiges: 'Sonstiges',
              ausbildung: 'Ausbildung zum Gärtner', landschaftsbau: 'Landschaftsbaugärtner',
              gartenpfleger: 'Gartenpfleger', initiativ: 'Initiativbewerbung',
              ohne: 'Ohne Angabe' },
};

/* Die vier Ereignisarten und die Merkmale, die sie tragen. Die
   Reihenfolge bestimmt den Aufbau des Schluessels im Wuerfel und
   damit auch, wie das Dashboard ihn wieder auseinandernimmt. */
export const ARTEN = {
  aufruf: ['seite', 'quelle', 'geraet'],
  start:  ['formular'],
  senden: ['formular', 'thema'],
  klick:  ['ziel'],
};

/* ============================================================
   EINORDNEN
   Aus dem, was der Browser mitschickt, werden Kuerzel. Alles
   Uneindeutige faellt hier heraus, nicht erst in der Ablage.
   ============================================================ */

export function seiteAus(pfad) {
  const p = String(pfad ?? '').split('?')[0].split('#')[0];
  return SEITEN[p] || SEITEN[p.replace(/\/+$/, '') || '/'] || null;
}

/* Aus dem Verweis wird der Rechnername gezogen und sofort
   weggeworfen — abgelegt wird nur die Schublade. Ein Verweis von
   der eigenen Seite gilt als »direkt«: das ist kein neuer Besuch
   von aussen, sondern ein Weiterklicken. */
export function quelleAus(verweis, eigen) {
  if (!verweis) return 'direkt';
  let host;
  try { host = new URL(String(verweis)).hostname.toLowerCase(); }
  catch { return 'direkt'; }
  if (eigen && (host === eigen || host.endsWith('.' + eigen))) return 'direkt';
  for (const [muster, name] of QUELLEN) if (muster.test(host)) return name;
  return 'extern';
}

/* Grob nach Bauart, nicht nach Modell: drei Klassen, mehr traegt
   die Kennung nicht verlaesslich und mehr braucht der Betrieb auch
   nicht. Reihenfolge zaehlt — »iPad« enthaelt kein »Mobile«, aber
   Android-Tablets melden »Android« ohne »Mobile«. */
export function geraetAus(kennung) {
  const u = String(kennung ?? '').toLowerCase();
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(u)) return 'tablet';
  if (/mobi|iphone|ipod|android|phone|blackberry|opera mini/.test(u)) return 'handy';
  return 'rechner';
}

/* Maschinen zaehlen nicht mit. Die Liste faengt nicht jeden Bot,
   aber die, die sich zu erkennen geben — und das sind fast alle,
   die eine Seite wie diese ueberhaupt abrufen. */
const MASCHINE = /bot|crawl|spider|slurp|headless|lighthouse|preview|pingdom|monitor|curl|wget|python-requests|facebookexternalhit|whatsapp|telegram|embedly|feed/i;
export const istMaschine = (kennung) => MASCHINE.test(String(kennung ?? ''));

/* ============================================================
   ZEIT
   Alles rechnet in Europe/Berlin. Ohne das laege die Tagesgrenze
   bei UTC und der Betrieb saehe die Anfragen eines Sommerabends am
   Folgetag stehen.
   ============================================================ */
const ZEIT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', hour12: false,
});

export function berliner(jetzt = Date.now()) {
  const t = {};
  for (const { type, value } of ZEIT.formatToParts(new Date(jetzt))) t[type] = value;
  // 'en-CA' liefert die Stunde je nach Umgebung als 24 statt 00.
  const stunde = t.hour === '24' ? '00' : t.hour;
  return { tag: `${t.year}-${t.month}-${t.day}`, stunde };
}

/* ============================================================
   ABLAGE
   Wie in netlify/lib/abwehr.mjs: faellt der Blob-Speicher aus,
   zaehlt eine Map im Arbeitsspeicher weiter. Fuer den oertlichen
   Test reicht das, im Betrieb faellt es nicht an — und eine
   Statistik darf ohnehin nie den Grund sein, dass eine Seite oder
   ein Formular nicht mehr funktioniert.
   ============================================================ */
const speicher = new Map();
let ablage;

async function hole() {
  if (ablage !== undefined) return ablage;
  try {
    const { getStore } = await import('@netlify/blobs');
    ablage = getStore({ name: LADEN, consistency: 'strong' });
  } catch {
    ablage = null;
  }
  return ablage;
}

async function lies(schl) {
  const a = await hole();
  if (a) {
    try { return await a.get(schl, { type: 'json' }); }
    catch { ablage = null; }
  }
  return speicher.has(schl) ? JSON.parse(speicher.get(schl)) : null;
}

async function schreib(schl, wert) {
  const a = await hole();
  if (a) {
    try { await a.setJSON(schl, wert); return; }
    catch { ablage = null; }
  }
  speicher.set(schl, JSON.stringify(wert));
}

async function loesch(schl) {
  const a = await hole();
  if (a) {
    try { await a.delete(schl); return; }
    catch { ablage = null; }
  }
  speicher.delete(schl);
}

async function schluessel(prefix) {
  const a = await hole();
  if (a) {
    try { return (await a.list({ prefix })).blobs.map(b => b.key); }
    catch { ablage = null; }
  }
  return [...speicher.keys()].filter(k => k.startsWith(prefix));
}

/* Nur fuer den Test. */
export function _speicherLeeren() {
  speicher.clear();
  ablage = undefined;
}

/* ============================================================
   ZAEHLEN
   ============================================================ */

/* Baut den Schluessel im Wuerfel aus den Merkmalen der Art. Fehlt
   ein Merkmal, steht »ohne« an seiner Stelle — die Stellenzahl
   bleibt dadurch fest und das Dashboard kann stur aufteilen. */
function kombination(art, merkmale) {
  return ARTEN[art].map(name => merkmale[name] || 'ohne').join('_');
}

const VERSUCHE = 3;

export async function zaehle(art, merkmale = {}, jetzt = Date.now()) {
  if (!ARTEN[art]) return false;
  const { tag, stunde } = berliner(jetzt);
  const schl = `std/${tag}/${stunde}`;
  const komb = kombination(art, merkmale);

  /* Lesen, erhoehen, schreiben — und danach nachsehen, ob der
     eigene Zuwachs noch dasteht. Ohne bedingtes Schreiben ist das
     die einzige Art, einen verlorenen Zaehlvorgang ueberhaupt zu
     bemerken. Nach drei Anlaeufen wird aufgegeben: ein fehlender
     Aufruf in der Statistik ist hinnehmbar, eine Funktion, die
     sich an einer Schleife festhaelt, nicht. */
  for (let n = 0; n < VERSUCHE; n++) {
    const wuerfel = (await lies(schl)) || {};
    const zweig = wuerfel[art] || (wuerfel[art] = {});
    const soll = (zweig[komb] || 0) + 1;
    zweig[komb] = soll;
    await schreib(schl, wuerfel);

    const nach = await lies(schl);
    if ((nach?.[art]?.[komb] || 0) >= soll) return true;
  }
  return false;
}

/* ============================================================
   RATENGRENZE
   Wer /api/zaehl von Hand bedient, soll die Zahlen nicht beliebig
   aufblaehen koennen. Gezaehlt wird wie beim Formular in
   Stundenfenstern und nur ueber einen Pruefwert der Adresse; die
   Adresse selbst wird nirgends abgelegt.

   Hier steht bewusst kein Nachlesen wie beim Zaehlen: geht unter
   Last ein Schritt verloren, faellt die Grenze etwas milder aus.
   Das ist die harmlosere Richtung.
   ============================================================ */
const FENSTER = 60 * 60 * 1000;
const PRO_IP  = 120;   // Ereignisse je Absender und Stunde

let zwischenSchluessel;
function geheim() {
  if (zwischenSchluessel) return zwischenSchluessel;
  const roh = process.env.CAPTCHA_SECRET || process.env.SMTP_PASS || '';
  zwischenSchluessel = crypto.createHash('sha256').update('belzner:zaehler:' + roh).digest();
  return zwischenSchluessel;
}

/* Der Ablageort einer Zaehlung. Die Adresse steht nie darin, nur ein
   Pruefwert mit dem Serverschluessel; die Stunde steckt im Namen und
   laesst das Fenster von selbst ablaufen. */
function grenzSchluessel(topf, adresse, jetzt) {
  const fenster = Math.floor(jetzt / FENSTER);
  const wer = crypto.createHmac('sha256', geheim())
    .update(String(adresse)).digest('base64url').slice(0, 24);
  return `${topf}/${fenster}_${wer}`;
}

/* Lesen und Erhoehen in einem — fuer den Zaehlpunkt, wo jede Meldung
   zaehlt und es kein »richtig« oder »falsch« gibt. */
export async function imRahmen(adresse, { grenze = PRO_IP, topf = 'grenze' } = {},
                               jetzt = Date.now()) {
  if (!adresse) return true;
  const schl = grenzSchluessel(topf, adresse, jetzt);
  const stand = (await lies(schl)) || 0;
  if (stand >= grenze) return false;
  await schreib(schl, stand + 1);
  return true;
}

/* ------------------------------------------------------------
   Getrennt zaehlbar — fuer die Anmeldung am Dashboard.

   Dort waere Lesen-und-Erhoehen in einem falsch: das Dashboard
   fragt bei jedem Zeitraumwechsel neu an, und mit einer gemeinsamen
   Zaehlung haette sich der Betrieb nach ein paar Klicks aus seiner
   eigenen Auswertung ausgesperrt. Gezaehlt gehoeren nur die
   Fehlversuche — und ein richtiges Passwort raeumt sie weg.
   ------------------------------------------------------------ */
export async function standAbfragen(topf, adresse, jetzt = Date.now()) {
  if (!adresse) return 0;
  return (await lies(grenzSchluessel(topf, adresse, jetzt))) || 0;
}

export async function standErhoehen(topf, adresse, jetzt = Date.now()) {
  if (!adresse) return 0;
  const schl = grenzSchluessel(topf, adresse, jetzt);
  const stand = ((await lies(schl)) || 0) + 1;
  await schreib(schl, stand);
  return stand;
}

export async function standLoeschen(topf, adresse, jetzt = Date.now()) {
  if (!adresse) return;
  await loesch(grenzSchluessel(topf, adresse, jetzt));
}

/* ============================================================
   LESEN
   Ein abgeschlossener Tag liegt als einzelner Blob unter tag/,
   der laufende noch als bis zu 24 Stundenblobs unter std/. Beim
   ersten Lesen nach Mitternacht werden die Stunden des Vortags
   zusammengefasst.

   Die Reihenfolge ist dabei entscheidend: erst wird der Tagesblob
   geschrieben, dann werden die Stundenblobs geloescht. Bricht es
   dazwischen ab, bleiben Stundenblobs eines Tages liegen, der
   schon zusammengefasst ist — gelesen werden sie dann nicht mehr,
   denn wo ein Tagesblob liegt, sieht diese Funktion gar nicht erst
   nach Stunden. Nichts wird doppelt gezaehlt, nichts geht verloren;
   im schlimmsten Fall bleibt etwas Muell liegen, den der naechste
   Durchgang wegraeumt.
   ============================================================ */

/* Fasst die Wuerfel zweier Stunden zusammen. */
function dazu(ziel, quelle) {
  for (const [art, zweig] of Object.entries(quelle || {})) {
    if (!ARTEN[art]) continue;
    const z = ziel[art] || (ziel[art] = {});
    for (const [komb, anzahl] of Object.entries(zweig)) {
      z[komb] = (z[komb] || 0) + (Number(anzahl) || 0);
    }
  }
  return ziel;
}

async function stundenAus(tag) {
  const keys = await schluessel(`std/${tag}/`);
  const stunden = {};
  await Promise.all(keys.map(async k => {
    const stunde = k.slice(k.lastIndexOf('/') + 1);
    const wuerfel = await lies(k);
    if (wuerfel) stunden[stunde] = wuerfel;
  }));
  return stunden;
}

/* Gibt { '2026-07-31': { '14': {aufruf:{…}}, … }, … } zurueck.
   Tage ohne Daten fehlen — das Dashboard fuellt die Luecken. */
export async function lese(vonTag, bisTag, jetzt = Date.now()) {
  const heute = berliner(jetzt).tag;
  const tage = {};

  for (const tag of tagesliste(vonTag, bisTag)) {
    const fertig = await lies(`tag/${tag}`);
    if (fertig) { tage[tag] = fertig; continue; }

    const stunden = await stundenAus(tag);
    if (!Object.keys(stunden).length) continue;
    tage[tag] = stunden;

    /* Ein vergangener Tag aendert sich nicht mehr: zusammenfassen,
       damit der naechste Aufruf einen Blob liest statt 24. */
    if (tag < heute) {
      await schreib(`tag/${tag}`, stunden);
      for (const stunde of Object.keys(stunden)) await loesch(`std/${tag}/${stunde}`);
    }
  }
  return tage;
}

/* Die Fenster der Ratengrenze verfallen von selbst, aber ihre
   Blobs bleiben liegen. Weggeraeumt wird beim Lesen: das passiert
   nur, wenn jemand das Dashboard oeffnet, und damit selten genug,
   um nicht ins Gewicht zu fallen. */
export async function raeumeAuf(jetzt = Date.now()) {
  const aktuell = Math.floor(jetzt / FENSTER);
  let weg = 0;
  /* »anmeldung/« ist der alte Topf aus der Zeit, als jede Anfrage ans
     Dashboard zaehlte. Er wird nicht mehr geschrieben, aber noch
     weggeraeumt — sonst blieben die Staende bis in alle Ewigkeit liegen. */
  for (const topf of ['grenze/', 'fehlversuch/', 'anmeldung/']) {
    const alt = (await schluessel(topf))
      .filter(k => Number(k.slice(topf.length).split('_')[0]) < aktuell);
    for (const k of alt) await loesch(k);
    weg += alt.length;
  }
  return weg;
}

export function tagesliste(vonTag, bisTag) {
  const liste = [];
  const d = new Date(`${vonTag}T12:00:00Z`);
  const bis = new Date(`${bisTag}T12:00:00Z`);
  while (d <= bis && liste.length < 400) {
    liste.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return liste;
}
