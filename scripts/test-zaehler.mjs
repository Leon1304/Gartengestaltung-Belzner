/* ============================================================
   TEST: REICHWEITENMESSUNG
   Prueft die Einordnung der Merkmale, das Zaehlen, das
   Zusammenfassen abgeschlossener Tage und die beiden Funktionen
   /api/zaehl und /api/statistik.

   Netlify Blobs steht hier nicht bereit; zaehler.mjs faellt dann
   auf eine Map im Arbeitsspeicher zurueck. Genau die wird hier
   geprueft — die Logik darueber ist dieselbe.

   Aufruf:  node scripts/test-zaehler.mjs
   ============================================================ */
process.env.CAPTCHA_SECRET = 'testschluessel';

const zaehler = await import(new URL('../netlify/lib/zaehler.mjs', import.meta.url));
const { default: zaehlPunkt } =
  await import(new URL('../netlify/functions/zaehl.mjs', import.meta.url));

let fehler = 0;
function pruefe(name, bedingung, zusatz = '') {
  const ok = bedingung === true;
  if (!ok) fehler++;
  console.log(`${ok ? '  ok  ' : ' FEHL '} ${name}${ok || !zusatz ? '' : '  → ' + zusatz}`);
}

/* Ein fester Zeitpunkt, damit Tag und Stunde nicht davon abhaengen,
   wann der Test laeuft: 15. Juli 2026, 14:30 Uhr in Berlin. */
const T = Date.parse('2026-07-15T12:30:00Z');
const TAG = '2026-07-15';
const TAGS_ZUVOR = '2026-07-14';

/* ============================================================ */
console.log('\n--- Einordnen ---');

pruefe('Startseite unter / erkannt',        zaehler.seiteAus('/') === 'start');
pruefe('Startseite unter /index.html',      zaehler.seiteAus('/index.html') === 'start');
pruefe('Projekte erkannt',                  zaehler.seiteAus('/projekte.html') === 'projekte');
pruefe('Abfrage am Pfad wird abgeschnitten',
  zaehler.seiteAus('/projekte.html?utm_source=x#unten') === 'projekte');
pruefe('unbekannter Pfad faellt heraus',    zaehler.seiteAus('/geheim.html') === null);
pruefe('Dashboard zaehlt nicht mit',        zaehler.seiteAus('/dashboard.html') === null);

pruefe('ohne Verweis ist direkt',           zaehler.quelleAus('', 'x.de') === 'direkt');
pruefe('Google erkannt',
  zaehler.quelleAus('https://www.google.de/search?q=garten', 'belzner.de') === 'google');
pruefe('Instagram erkannt',
  zaehler.quelleAus('https://l.instagram.com/?u=abc', 'belzner.de') === 'instagram');
pruefe('Bing zaehlt als Suche',
  zaehler.quelleAus('https://www.bing.com/search', 'belzner.de') === 'suche');
pruefe('eigener Rechner gilt als direkt',
  zaehler.quelleAus('https://www.belzner.de/projekte.html', 'belzner.de') === 'direkt');
pruefe('fremde Seite ist extern',
  zaehler.quelleAus('https://gartenforum.example/beitrag', 'belzner.de') === 'extern');
pruefe('kaputter Verweis wirft nicht',      zaehler.quelleAus('nicht-mal-eine-url', 'x.de') === 'direkt');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const IPAD   = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const MAC    = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120';
const ANDROID_TAB = 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 Chrome/120 Safari/537.36';

pruefe('iPhone ist ein Handy',              zaehler.geraetAus(IPHONE) === 'handy');
pruefe('iPad ist ein Tablet',               zaehler.geraetAus(IPAD) === 'tablet');
pruefe('Mac ist ein Rechner',               zaehler.geraetAus(MAC) === 'rechner');
pruefe('Android ohne Mobile ist ein Tablet', zaehler.geraetAus(ANDROID_TAB) === 'tablet');

pruefe('Googlebot als Maschine erkannt',
  zaehler.istMaschine('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'));
pruefe('curl als Maschine erkannt',         zaehler.istMaschine('curl/8.4.0'));
pruefe('iPhone ist keine Maschine',         zaehler.istMaschine(IPHONE) === false);

const b = zaehler.berliner(T);
pruefe('Berliner Tag stimmt',   b.tag === TAG, b.tag);
pruefe('Berliner Stunde stimmt (Sommerzeit)', b.stunde === '14', b.stunde);
/* Der Tageswechsel liegt in Berlin, nicht in UTC. In der Sommerzeit
   ist das genau die Stelle, an der eine Anfrage vom spaeten Abend
   sonst auf dem Folgetag landete. */
const spaet = zaehler.berliner(Date.parse('2026-07-15T21:30:00Z'));   // 23:30 Berlin
pruefe('23:30 Berlin gehoert noch zum selben Tag',
  spaet.tag === TAG && spaet.stunde === '23', spaet.tag + ' ' + spaet.stunde);
const drueber = zaehler.berliner(Date.parse('2026-07-15T22:30:00Z')); // 00:30 Berlin
pruefe('00:30 Berlin gehoert schon zum naechsten Tag',
  drueber.tag === '2026-07-16' && drueber.stunde === '00',
  drueber.tag + ' ' + drueber.stunde);
// Winterzeit: UTC+1, der Wechsel liegt eine Stunde spaeter.
const winter = zaehler.berliner(Date.parse('2026-01-15T23:30:00Z'));
pruefe('im Winter gilt UTC+1',
  winter.tag === '2026-01-16' && winter.stunde === '00',
  winter.tag + ' ' + winter.stunde);

/* ============================================================ */
console.log('\n--- Zaehlen und Lesen ---');
zaehler._speicherLeeren();

await zaehler.zaehle('aufruf', { seite:'start', quelle:'google', geraet:'handy' }, T);
await zaehler.zaehle('aufruf', { seite:'start', quelle:'google', geraet:'handy' }, T);
await zaehler.zaehle('aufruf', { seite:'projekte', quelle:'direkt', geraet:'rechner' }, T);
await zaehler.zaehle('senden', { formular:'anfrage', thema:'pflege' }, T);
await zaehler.zaehle('start',  { formular:'anfrage' }, T);
await zaehler.zaehle('klick',  { ziel:'telefon' }, T);

let tage = await zaehler.lese(TAG, TAG, T);
const heute = tage[TAG]?.['14'] || {};
pruefe('zwei gleiche Aufrufe stehen als 2',
  heute.aufruf?.['start_google_handy'] === 2, JSON.stringify(heute.aufruf));
pruefe('anderer Aufruf getrennt gezaehlt',
  heute.aufruf?.['projekte_direkt_rechner'] === 1);
pruefe('abgeschickte Anfrage gezaehlt',
  heute.senden?.['anfrage_pflege'] === 1, JSON.stringify(heute.senden));
pruefe('angefangenes Formular gezaehlt', heute.start?.['anfrage'] === 1);
pruefe('Klick gezaehlt',                 heute.klick?.['telefon'] === 1);

pruefe('unbekannte Art wird abgewiesen',
  (await zaehler.zaehle('quatsch', {}, T)) === false);

// Fehlendes Merkmal steht als »ohne« — die Stellenzahl bleibt fest.
await zaehler.zaehle('senden', { formular:'bewerbung' }, T);
tage = await zaehler.lese(TAG, TAG, T);
pruefe('fehlendes Thema steht als »ohne«',
  tage[TAG]['14'].senden['bewerbung_ohne'] === 1,
  JSON.stringify(tage[TAG]['14'].senden));

/* ============================================================ */
console.log('\n--- Abgeschlossene Tage zusammenfassen ---');
zaehler._speicherLeeren();

const GESTERN_FRUEH = Date.parse('2026-07-14T07:30:00Z');   // 09 Uhr Berlin
const GESTERN_SPAET = Date.parse('2026-07-14T18:30:00Z');   // 20 Uhr Berlin
await zaehler.zaehle('aufruf', { seite:'start', quelle:'direkt', geraet:'handy' }, GESTERN_FRUEH);
await zaehler.zaehle('aufruf', { seite:'start', quelle:'direkt', geraet:'handy' }, GESTERN_SPAET);
await zaehler.zaehle('aufruf', { seite:'start', quelle:'direkt', geraet:'handy' }, T);

const vorher = await zaehler.lese(TAGS_ZUVOR, TAG, T);
pruefe('Vortag hat zwei Stunden',
  Object.keys(vorher[TAGS_ZUVOR]).sort().join(',') === '09,20',
  Object.keys(vorher[TAGS_ZUVOR]).join(','));
pruefe('heutiger Tag steht getrennt daneben',
  vorher[TAG]['14'].aufruf['start_direkt_handy'] === 1);

/* Nach dem ersten Lesen liegt der Vortag als ein Blob vor und die
   Stundenblobs sind weg. Beides darf am Ergebnis nichts aendern. */
const nachher = await zaehler.lese(TAGS_ZUVOR, TAG, T);
pruefe('nach dem Zusammenfassen stehen dieselben Zahlen',
  JSON.stringify(nachher[TAGS_ZUVOR]) === JSON.stringify(vorher[TAGS_ZUVOR]),
  JSON.stringify(nachher[TAGS_ZUVOR]));

// Ein dritter Durchgang darf ebenso wenig doppelt zaehlen.
const drittens = await zaehler.lese(TAGS_ZUVOR, TAG, T);
pruefe('auch beim dritten Lesen nichts verdoppelt',
  drittens[TAGS_ZUVOR]['09'].aufruf['start_direkt_handy'] === 1);

pruefe('Tagesliste zaehlt richtig',
  zaehler.tagesliste('2026-07-14', '2026-07-16').join(',')
    === '2026-07-14,2026-07-15,2026-07-16');
pruefe('Tagesliste ueberspringt die Sommerzeitgrenze sauber',
  zaehler.tagesliste('2026-03-28', '2026-03-30').join(',')
    === '2026-03-28,2026-03-29,2026-03-30');

/* ============================================================ */
console.log('\n--- Ratengrenze ---');
zaehler._speicherLeeren();

let durch = 0;
for (let n = 0; n < 130; n++) if (await zaehler.imRahmen('203.0.113.9', {}, T)) durch++;
pruefe('nach 120 Meldungen je Stunde ist Schluss', durch === 120, String(durch));
pruefe('andere Adresse kommt weiterhin durch',
  (await zaehler.imRahmen('203.0.113.10', {}, T)) === true);
pruefe('in der naechsten Stunde geht es weiter',
  (await zaehler.imRahmen('203.0.113.9', {}, T + 60 * 60 * 1000)) === true);
pruefe('eigener Topf zaehlt getrennt',
  (await zaehler.imRahmen('203.0.113.9', { grenze:3, topf:'anders' }, T)) === true);

/* Getrenntes Zaehlen fuer die Anmeldung: abfragen erhoeht nichts,
   erhoehen zaehlt, loeschen setzt zurueck. */
pruefe('Abfragen erhoeht den Stand nicht',
  (await zaehler.standAbfragen('fehlversuch', '203.0.113.40', T)) === 0
  && (await zaehler.standAbfragen('fehlversuch', '203.0.113.40', T)) === 0);
await zaehler.standErhoehen('fehlversuch', '203.0.113.40', T);
await zaehler.standErhoehen('fehlversuch', '203.0.113.40', T);
pruefe('Erhoehen zaehlt hoch',
  (await zaehler.standAbfragen('fehlversuch', '203.0.113.40', T)) === 2);
await zaehler.standLoeschen('fehlversuch', '203.0.113.40', T);
pruefe('Loeschen setzt zurueck',
  (await zaehler.standAbfragen('fehlversuch', '203.0.113.40', T)) === 0);
pruefe('naechste Stunde zaehlt eigenstaendig',
  (await zaehler.standAbfragen('fehlversuch', '203.0.113.40', T + 60 * 60 * 1000)) === 0);

/* ============================================================ */
console.log('\n--- /api/zaehl ---');
zaehler._speicherLeeren();

const anfrage = (rumpf, { kennung = IPHONE, methode = 'POST' } = {}) =>
  new Request('https://gartengestaltung-belzner.de/api/zaehl', {
    method: methode,
    headers: { 'user-agent': kennung, 'content-type': 'text/plain' },
    ...(methode === 'POST' ? { body: typeof rumpf === 'string' ? rumpf : JSON.stringify(rumpf) } : {}),
  });

const ruf = (rumpf, opt = {}, ip = '203.0.113.20') =>
  zaehlPunkt(anfrage(rumpf, opt), { ip });

async function standVon(art, komb, zeit = Date.now()) {
  const t = zaehler.berliner(zeit);
  const tage = await zaehler.lese(t.tag, t.tag, zeit);
  return tage[t.tag]?.[t.stunde]?.[art]?.[komb] || 0;
}

let r = await ruf({ art:'aufruf', seite:'/', verweis:'https://www.google.de/' });
pruefe('gueltige Meldung wird still bestaetigt', r.status === 204, String(r.status));
pruefe('Aufruf ist angekommen',
  (await standVon('aufruf', 'start_google_handy')) === 1);

r = await ruf({ art:'aufruf', seite:'/gibtsnicht.html' });
pruefe('unbekannter Pfad wird verworfen', r.status === 204);
pruefe('und taucht nirgends auf',
  (await standVon('aufruf', 'start_google_handy')) === 1);

await ruf({ art:'aufruf', seite:'/' }, { kennung:'Googlebot/2.1' });
pruefe('Maschine wird nicht mitgezaehlt',
  (await standVon('aufruf', 'start_direkt_rechner')) === 0);

r = await ruf(null, { methode:'GET' });
pruefe('GET wird still abgewiesen', r.status === 204);

r = await ruf('{kein json');
pruefe('kaputter Rumpf wirft nicht', r.status === 204);

r = await ruf('x'.repeat(3000));
pruefe('zu langer Rumpf wird verworfen', r.status === 204);

await ruf({ art:'senden', formular:'anfrage', thema:'pflege' });
pruefe('»senden« laesst sich von aussen nicht melden',
  (await standVon('senden', 'anfrage_pflege')) === 0);

await ruf({ art:'klick', ziel:'schadcode' });
await ruf({ art:'klick', ziel:'telefon' });
pruefe('nur bekannte Klickziele zaehlen',
  (await standVon('klick', 'telefon')) === 1 && (await standVon('klick', 'schadcode')) === 0);

await ruf({ art:'start', formular:'bewerbung' });
pruefe('angefangenes Formular gezaehlt',
  (await standVon('start', 'bewerbung')) === 1);

// Der Verweis von der eigenen Seite ist kein neuer Besuch von aussen.
await ruf({ art:'aufruf', seite:'/projekte.html',
            verweis:'https://gartengestaltung-belzner.de/' });
pruefe('eigener Verweis gilt als direkt',
  (await standVon('aufruf', 'projekte_direkt_handy')) === 1);

/* ============================================================ */
console.log('\n--- /api/statistik ---');
zaehler._speicherLeeren();

const { default: statistik } =
  await import(new URL('../netlify/functions/statistik.mjs', import.meta.url));

const holen = (rumpf, ip = '203.0.113.30') =>
  statistik(new Request('https://gartengestaltung-belzner.de/api/statistik', {
    method:'POST', headers:{ 'content-type':'application/json' },
    body: JSON.stringify(rumpf),
  }), { ip });

delete process.env.DASHBOARD_PASSWORT;
r = await holen({ passwort:'egal' });
pruefe('ohne hinterlegtes Passwort bleibt es zu', r.status === 503, String(r.status));

process.env.DASHBOARD_PASSWORT = 'kurz';
r = await holen({ passwort:'kurz' });
pruefe('zu kurzes Passwort wird abgelehnt', r.status === 503);

process.env.DASHBOARD_PASSWORT = 'ein-ausreichend-langes-passwort';
r = await holen({ passwort:'falsch' });
pruefe('falsches Passwort ergibt 401', r.status === 401, String(r.status));

const jetzt = zaehler.berliner().tag;
await zaehler.zaehle('aufruf', { seite:'start', quelle:'direkt', geraet:'rechner' });
r = await holen({ passwort:'ein-ausreichend-langes-passwort', von: jetzt, bis: jetzt });
const d = await r.json();
pruefe('richtiges Passwort gibt die Zahlen heraus', r.status === 200 && d.ok === true);
pruefe('Beschriftungen kommen mit', d.beschriftung?.seite?.start === 'Startseite');
pruefe('Merkmalsaufbau kommt mit',
  d.arten?.aufruf?.join(',') === 'seite,quelle,geraet', JSON.stringify(d.arten?.aufruf));
pruefe('Seitenliste kommt mit', Array.isArray(d.seiten) && d.seiten.includes('projekte'));
pruefe('der Tag steht in den Daten',
  Object.keys(d.tage).includes(jetzt), Object.keys(d.tage).join(','));

// Ein Zeitraum in der Zukunft wird auf heute zurechtgestutzt.
r = await holen({ passwort:'ein-ausreichend-langes-passwort', von:'2099-01-01', bis:'2099-12-31' });
const zukunft = await r.json();
pruefe('Zukunft wird auf heute begrenzt', zukunft.bis === zukunft.heute, zukunft.bis);

/* Das Dashboard fragt bei jedem Zeitraumwechsel neu an. Gelungene
   Anmeldungen duerfen deshalb kein Kontingent verbrauchen — sonst
   sperrt sich der Betrieb nach ein paar Klicks selbst aus. Genau das
   tat die erste Fassung. */
let ok = true;
for (let n = 0; n < 25; n++) {
  const a = await holen({ passwort:'ein-ausreichend-langes-passwort' }, '203.0.113.33');
  if (a.status !== 200) { ok = false; break; }
}
pruefe('25 richtige Anmeldungen hintereinander gehen durch', ok);

// Durchprobieren laeuft nach zehn Fehlgriffen ins Leere.
let letzte;
for (let n = 0; n < 12; n++) letzte = await holen({ passwort:'raten' + n }, '203.0.113.31');
pruefe('Durchprobieren wird abgeriegelt', letzte.status === 429, String(letzte.status));

// Auch mit dem richtigen Passwort bleibt zu, wer sich verrannt hat.
letzte = await holen({ passwort:'ein-ausreichend-langes-passwort' }, '203.0.113.31');
pruefe('gesperrte Adresse bleibt eine Stunde draussen', letzte.status === 429);

/* Ein Fehlgriff darf nicht nachwirken: neun daneben, dann richtig —
   und danach steht der Zaehler wieder bei null. */
for (let n = 0; n < 9; n++) await holen({ passwort:'daneben' + n }, '203.0.113.34');
r = await holen({ passwort:'ein-ausreichend-langes-passwort' }, '203.0.113.34');
pruefe('nach neun Fehlgriffen kommt das richtige Passwort durch', r.status === 200,
  String(r.status));
pruefe('der Zaehler ist danach zurueckgesetzt',
  (await zaehler.standAbfragen('fehlversuch', '203.0.113.34')) === 0);

r = await holen({ passwort:'ein-ausreichend-langes-passwort' }, '203.0.113.32');
pruefe('andere Adresse kommt weiterhin durch', r.status === 200);

console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen\n` : '\nAlle Tests bestanden\n');
process.exit(fehler ? 1 : 0);
