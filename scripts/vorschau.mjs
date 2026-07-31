/* ============================================================
   OERTLICHE VORSCHAU
   Liefert die Seite aus und haengt /api/zaehl und /api/statistik
   an dieselben Funktionen, die spaeter bei Netlify laufen. Damit
   laesst sich das Dashboard ansehen, ohne etwas zu veroeffentlichen.

   Netlify Blobs steht hier nicht bereit — zaehler.mjs zaehlt dann
   in den Arbeitsspeicher. Alles ist beim Beenden wieder weg.

   Aufruf:
     node scripts/vorschau.mjs            mit erfundenen Beispielzahlen
     node scripts/vorschau.mjs --leer     ohne, um selbst zu klicken

   Dann http://localhost:8788/dashboard.html oeffnen.
   Passwort: vorschau-passwort
   ============================================================ */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const PORT = Number(process.env.PORT || 8788);

process.env.CAPTCHA_SECRET     ||= 'vorschau-schluessel';
process.env.DASHBOARD_PASSWORT ||= 'vorschau-passwort';

const zaehler = await import(new URL('../netlify/lib/zaehler.mjs', import.meta.url));
const { default: zaehlPunkt } =
  await import(new URL('../netlify/functions/zaehl.mjs', import.meta.url));
const { default: statistik } =
  await import(new URL('../netlify/functions/statistik.mjs', import.meta.url));

/* ---------- Beispielzahlen ---------- */
async function beispiele(tage = 75) {
  const heute = Date.now();
  const zufall = (n) => Math.floor(Math.random() * n);
  const waehle = (liste) => liste[zufall(liste.length)];

  for (let t = tage - 1; t >= 0; t--) {
    const zeit = heute - t * 86400000;
    const wt = new Date(zeit).getUTCDay();
    // Am Wochenende weniger, und ueber die Wochen hinweg leicht steigend.
    const grund = (wt === 0 || wt === 6) ? 14 : 30;
    const menge = Math.round(grund * (0.6 + (tage - t) / tage * 0.8) + zufall(12));

    for (let n = 0; n < menge; n++) {
      // Tagesgang: mittags und abends mehr als nachts.
      const stunde = waehle([7,8,9,9,10,11,11,12,12,13,14,15,16,17,18,18,19,19,20,21,22,6,23,2]);
      const wann = zeit - new Date(zeit).getUTCHours() * 3600000 + stunde * 3600000;
      await zaehler.zaehle('aufruf', {
        seite:  waehle(['start','start','start','start','projekte','projekte','impressum','datenschutz']),
        quelle: waehle(['google','google','google','direkt','direkt','instagram','suche','extern','verzeichnis','facebook']),
        geraet: waehle(['handy','handy','handy','rechner','rechner','tablet']),
      }, wann);

      if (zufall(14) === 0) {
        const formular = zufall(4) ? 'anfrage' : 'bewerbung';
        await zaehler.zaehle('start', { formular }, wann);
        if (zufall(3)) {
          await zaehler.zaehle('senden', {
            formular,
            thema: formular === 'anfrage'
              ? waehle(Object.values(zaehler.ANLIEGEN))
              : waehle(Object.values(zaehler.STELLEN)),
          }, wann);
        }
      }
      if (zufall(9) === 0) {
        await zaehler.zaehle('klick', { ziel: waehle(zaehler.ZIELE) }, wann);
      }
    }
  }
}

/* ---------- Auslieferung ---------- */
const TYPEN = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.txt':'text/plain; charset=utf-8', '.xml':'application/xml; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.webp':'image/webp', '.avif':'image/avif', '.svg':'image/svg+xml',
  '.woff2':'font/woff2', '.woff':'font/woff', '.ico':'image/x-icon',
};

/* Die Funktionen erwarten ein Request-Objekt der Plattform. Hier wird
   eines daraus gebaut; der Rumpf wird vorher vollstaendig eingelesen,
   weil beide Funktionen ihn ohnehin am Stueck brauchen. */
async function alsRequest(req, rumpf) {
  return new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method,
    headers: req.headers,
    ...(rumpf.length ? { body: rumpf } : {}),
  });
}

async function antworte(res, antwort) {
  const text = antwort.body ? await antwort.text() : '';
  const kopf = {};
  antwort.headers.forEach((v, k) => { kopf[k] = v; });
  res.writeHead(antwort.status, kopf);
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  const pfad = decodeURIComponent(req.url.split('?')[0]);

  if (pfad === '/api/zaehl' || pfad === '/api/statistik') {
    const teile = [];
    for await (const stueck of req) teile.push(stueck);
    const anfrage = await alsRequest(req, Buffer.concat(teile));
    const zustand = { ip: req.socket.remoteAddress || '127.0.0.1' };
    try {
      const funktion = pfad === '/api/zaehl' ? zaehlPunkt : statistik;
      return antworte(res, await funktion(anfrage, zustand));
    } catch (fehler) {
      console.error(pfad, fehler);
      res.writeHead(500, { 'content-type':'text/plain' });
      return res.end(String(fehler.stack || fehler));
    }
  }

  const datei = path.join(WURZEL, pfad === '/' ? 'index.html' : pfad);
  // Nichts ausserhalb des Projektordners ausliefern.
  if (!datei.startsWith(WURZEL)) { res.writeHead(403); return res.end(); }
  try {
    const inhalt = await fs.readFile(datei);
    res.writeHead(200, {
      'content-type': TYPEN[path.extname(datei).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(inhalt);
  } catch {
    res.writeHead(404, { 'content-type':'text/plain; charset=utf-8' });
    res.end('Nicht gefunden: ' + pfad);
  }
});

if (!process.argv.includes('--leer')) {
  process.stdout.write('Beispielzahlen werden erzeugt … ');
  await beispiele();
  console.log('fertig.');
}

server.listen(PORT, () => {
  console.log(`\n  Seite      http://localhost:${PORT}/`);
  console.log(`  Dashboard  http://localhost:${PORT}/dashboard.html`);
  console.log(`  Passwort   ${process.env.DASHBOARD_PASSWORT}\n`);
});
