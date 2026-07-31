/* ============================================================
   TEST: FORMULARVERSAND
   Startet einen minimalen SMTP-Server auf 127.0.0.1, laesst
   netlify/functions/formular.mjs echte Anfragen dagegen zustellen
   und prueft Abwehr, Anhaenge und Mailaufbau. Verschickt nichts
   nach draussen — der Server nimmt nur mit, was ankommt.

   Aufruf:  node scripts/test-formular.mjs
   ============================================================ */
import net from 'node:net';

const PORT = 2526;
let letzteMail = '';

const smtp = net.createServer(sock => {
  let inDaten = false, puffer = '';
  sock.write('220 test ESMTP\r\n');
  sock.on('data', d => {
    puffer += d.toString('utf8');
    let i;
    while ((i = puffer.indexOf('\r\n')) > -1) {
      const zeile = puffer.slice(0, i);
      puffer = puffer.slice(i + 2);
      if (inDaten) {
        if (zeile === '.') { inDaten = false; sock.write('250 OK\r\n'); }
        else letzteMail += zeile + '\n';
        continue;
      }
      const b = zeile.toUpperCase();
      if (b.startsWith('EHLO') || b.startsWith('HELO')) sock.write('250-test\r\n250 AUTH PLAIN LOGIN\r\n');
      else if (b.startsWith('AUTH')) sock.write('235 OK\r\n');
      else if (b.startsWith('DATA')) { inDaten = true; sock.write('354 los\r\n'); }
      else if (b.startsWith('QUIT')) { sock.write('221 tschuess\r\n'); sock.end(); }
      else sock.write('250 OK\r\n');
    }
  });
  sock.on('error', () => {});
});
await new Promise(r => smtp.listen(PORT, '127.0.0.1', r));

process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = String(PORT);
process.env.SMTP_USER = 'webmaster@571432009.swh.strato-hosting.eu';   // interner Login
process.env.MAIL_VON  = 'webmaster@gartengestaltung-belzner.de';        // sichtbarer Absender
process.env.SMTP_PASS = 'geheim';
process.env.MAIL_AN   = 'info@gartengestaltung-belzner.de';
process.env.CAPTCHA_SECRET = 'testschluessel';

const { default: formular } =
  await import(new URL('../netlify/functions/formular.mjs', import.meta.url));
const { neueAufgabe } =
  await import(new URL('../netlify/lib/abwehr.mjs', import.meta.url));

/* Eine Marke, wie /api/aufgabe sie ausgibt, samt Loesung. Ohne Argument
   liegt sie eine Minute zurueck — so alt wie ein normal ausgefuelltes
   Formular, aber weit unter der halben Stunde Haltbarkeit. */
function aufgabe(alterMs = 60_000) {
  const { aufgabe: text, marke } = neueAufgabe(Date.now() - alterMs);
  const [a, b, op] = marke.split('.');
  return { marke, loesung: String(op === 'p' ? Number(a) + Number(b) : Number(a) - Number(b)), text };
}

const pdf = n => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], n, { type: 'application/pdf' });

/* Jeder Test bekommt eine eigene Absenderadresse: die Ratengrenze zaehlt
   pro Adresse, sonst raubten sich die Tests gegenseitig das Kontingent. */
let lfd = 0;
function bauen(paare, ip) {
  const fd = new FormData();
  for (const [k, v] of paare) fd.append(k, v);
  return new Request('https://x/api/formular', {
    method: 'POST',
    body: fd,
    headers: { 'x-nf-client-connection-ip': ip || `10.0.0.${++lfd}` },
  });
}

// Grundangaben mit frischer, geloester Aufgabe
function basis(extra = [], alterMs) {
  const a = aufgabe(alterMs);
  return [
    ['vorname', 'Maria'], ['nachname', 'Kern'], ['email', 'maria.kern@example.de'],
    ['telefon', '06251 12345'], ['anliegen', 'Wassersysteme & Bewässerung'],
    ['nachricht', 'Wir hätten gern eine automatische Bewässerung für rund 300 m² Rasen.'],
    ['datenschutz', 'on'], ['marke', a.marke], ['captcha', a.loesung],
    ...extra,
  ];
}
const ohne = (paare, ...felder) => paare.filter(([k]) => !felder.includes(k));

let fehler = 0;
async function pruefe(name, request, erwartet, extra) {
  letzteMail = '';
  const r = await formular(request);
  const j = await r.json();
  const ok = r.status === erwartet && (!extra || extra(j, letzteMail));
  console.log(`${ok ? '  ok  ' : ' FEHL '} ${name}  ->  ${r.status} ${JSON.stringify(j.text).slice(0, 62)}`);
  if (!ok) fehler++;
}

console.log('\n--- Abwehr ---');
await pruefe('GET statt POST', new Request('https://x/api/formular'), 405);
await pruefe('Honigtopf ausgefuellt', bauen(basis([['website', 'http://spam.example']])), 200,
  (j, m) => j.ok && m === '');
await pruefe('ohne Marke (roher Bot-POST)',
  bauen(ohne(basis(), 'marke')), 400, (j, m) => m === '' && j.feld === 'captcha');
await pruefe('erfundene Marke',
  bauen([...ohne(basis(), 'marke'), ['marke', '3.4.p.' + Date.now() + '.abcdef']]), 400,
  (j, m) => m === '');
await pruefe('Marke verbogen (andere Zahlen, alte Unterschrift)', (() => {
  const a = aufgabe();
  const [, , , iat, sig] = a.marke.split('.');
  return bauen([...ohne(basis(), 'marke', 'captcha'),
                ['marke', `9.9.p.${iat}.${sig}`], ['captcha', '18']]);
})(), 400, (j, m) => m === '');
await pruefe('falsches Ergebnis', (() => {
  const a = aufgabe();
  return bauen([...ohne(basis(), 'marke', 'captcha'),
                ['marke', a.marke], ['captcha', String(Number(a.loesung) + 1)]]);
})(), 400, (j, m) => m === '' && /stimmt nicht/.test(j.text));
await pruefe('zu schnell abgeschickt', bauen(basis([], 500)), 400,
  (j, m) => m === '' && /schnell/.test(j.text));
await pruefe('Marke abgelaufen (31 Minuten)', bauen(basis([], 31 * 60_000)), 400,
  (j, m) => m === '' && /abgelaufen/.test(j.text));
await pruefe('ohne Einwilligung', bauen(ohne(basis(), 'datenschutz')), 400);
await pruefe('ungueltige E-Mail',
  bauen([...ohne(basis(), 'email'), ['email', 'maria(at)example']]), 400);

console.log('\n--- Anfrage ---');
await pruefe('gueltige Anfrage', bauen(basis()), 200, (j, m) =>
  j.ok
  && /^Subject:.*Anfrage/m.test(m)
  && m.includes('Reply-To:')
  && /Maria Kern/.test(m)
  && /^From:.*<webmaster@gartengestaltung-belzner\.de>/m.test(m)
  && !/strato-hosting\.eu/.test(m)
  && /Einwilligung in die Datenschutzerkl/.test(m)
  && /Eingegangen: \d/.test(m)
  && !/Content-Type: application\/pdf/.test(m));
await pruefe('Zahlwort statt Ziffer', (() => {
  const a = aufgabe();
  const wort = ['null','eins','zwei','drei','vier','fünf','sechs','sieben','acht','neun',
                'zehn','elf','zwölf','dreizehn','vierzehn','fünfzehn','sechzehn','siebzehn','achtzehn'];
  return bauen([...ohne(basis(), 'marke', 'captcha'),
                ['marke', a.marke], ['captcha', wort[Number(a.loesung)]]]);
})(), 200, (j) => j.ok);

console.log('\n--- Bewerbung ---');
function bBasis(extra = []) {
  const a = aufgabe();
  return [
    ['art', 'bewerbung'], ['vorname', 'Tim'], ['nachname', 'Roth'],
    ['email', 'tim@example.de'], ['stelle', 'Gartenpfleger (m/w/d)'],
    ['datenschutz', 'on'], ['marke', a.marke], ['captcha', a.loesung],
    ...extra,
  ];
}
await pruefe('ohne Anhang', bauen(bBasis()), 400);
await pruefe('kein PDF',
  bauen(bBasis([['unterlagen', new File(['x'], 'foto.jpg', { type: 'image/jpeg' })]])), 415);
await pruefe('als PDF getarnt (richtige Endung, falscher Inhalt)',
  bauen(bBasis([['unterlagen',
    new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00])], 'lebenslauf.pdf',
             { type: 'application/pdf' })]])), 415,
  (j, m) => m === '' && /keine PDF/.test(j.text));
await pruefe('vier PDF (max. drei)',
  bauen(bBasis([['unterlagen', pdf('a.pdf')], ['unterlagen', pdf('b.pdf')],
                ['unterlagen', pdf('c.pdf')], ['unterlagen', pdf('d.pdf')]])), 413);
await pruefe('zu gross (4 MB)',
  bauen(bBasis([['unterlagen',
    new File([new Uint8Array(4 * 1024 * 1024)], 'dick.pdf', { type: 'application/pdf' })]])), 413);
await pruefe('zwei PDF, gueltig',
  bauen(bBasis([['unterlagen', pdf('lebenslauf.pdf')], ['unterlagen', pdf('zeugnis.pdf')]])), 200,
  (j, m) => j.ok
    && /^Subject:.*Bewerbung/m.test(m)
    && m.includes('lebenslauf.pdf')
    && m.includes('zeugnis.pdf')
    && (m.match(/Content-Type: application\/pdf/g) || []).length === 2);
await pruefe('Kopfzeilen-Einschleusung im Namen',
  bauen(bBasis([['vorname', 'Tim\r\nBcc: angreifer@example.com'], ['unterlagen', pdf('cv.pdf')]])
    .filter(([k, v]) => !(k === 'vorname' && v === 'Tim'))), 200,
  (j, m) => !/^Bcc:/mi.test(m));

/* Zum Schluss, weil die Grenze pro Absenderadresse zaehlt: die vierte
   Nachricht aus derselben Leitung geht nicht mehr durch. */
console.log('\n--- Ratengrenze ---');
const dieselbe = '203.0.113.7';
for (let n = 1; n <= 3; n++) {
  await pruefe(`Nachricht ${n} von derselben Adresse`, bauen(basis(), dieselbe), 200, (j) => j.ok);
}
await pruefe('vierte Nachricht wird abgewiesen', bauen(basis(), dieselbe), 429,
  (j, m) => m === '' && !j.ok);
await pruefe('andere Adresse kommt weiterhin durch', bauen(basis(), '203.0.113.8'), 200,
  (j) => j.ok);

smtp.close();
console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen\n` : '\nAlle Tests bestanden\n');
process.exit(fehler ? 1 : 0);
