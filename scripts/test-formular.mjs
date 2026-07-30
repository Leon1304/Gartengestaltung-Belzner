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

const { default: formular } =
  await import(new URL('../netlify/functions/formular.mjs', import.meta.url));

const alt = Date.now() - 60_000;   // Formular vor einer Minute geladen
const pdf = n => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], n, { type: 'application/pdf' });

function bauen(paare) {
  const fd = new FormData();
  for (const [k, v] of paare) fd.append(k, v);
  return new Request('https://x/api/formular', { method: 'POST', body: fd });
}
const basis = [
  ['vorname', 'Maria'], ['nachname', 'Kern'], ['email', 'maria.kern@example.de'],
  ['telefon', '06251 12345'], ['anliegen', 'Wassersysteme & Bewässerung'],
  ['nachricht', 'Wir hätten gern eine automatische Bewässerung für rund 300 m² Rasen.'],
  ['geladen', String(alt)], ['datenschutz', 'on'],
];

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
await pruefe('Honigtopf ausgefuellt', bauen([...basis, ['website', 'http://spam.example']]), 200,
  (j, m) => j.ok && m === '');
await pruefe('ohne Zeitstempel (roher Bot-POST)',
  bauen(basis.filter(([k]) => k !== 'geladen')), 200, (j, m) => m === '');
await pruefe('zu schnell abgeschickt',
  bauen([...basis.filter(([k]) => k !== 'geladen'), ['geladen', String(Date.now())]]), 200,
  (j, m) => m === '');
await pruefe('ohne Einwilligung',
  bauen(basis.filter(([k]) => k !== 'datenschutz')), 400);
await pruefe('ungueltige E-Mail',
  bauen([...basis.filter(([k]) => k !== 'email'), ['email', 'maria(at)example']]), 400);

console.log('\n--- Anfrage ---');
await pruefe('gueltige Anfrage', bauen(basis), 200, (j, m) =>
  j.ok
  && /^Subject:.*Anfrage/m.test(m)
  && m.includes('Reply-To:')
  && /Maria Kern/.test(m)
  && /^From:.*<webmaster@gartengestaltung-belzner\.de>/m.test(m)
  && !/strato-hosting\.eu/.test(m)
  && /Einwilligung in die Datenschutzerkl/.test(m)
  && /Eingegangen: \d/.test(m)
  && !/Content-Type: application\/pdf/.test(m));

console.log('\n--- Bewerbung ---');
const bBasis = [
  ['art', 'bewerbung'], ['vorname', 'Tim'], ['nachname', 'Roth'],
  ['email', 'tim@example.de'], ['stelle', 'Gartenpfleger (m/w/d)'],
  ['geladen', String(alt)], ['datenschutz', 'on'],
];
await pruefe('ohne Anhang', bauen(bBasis), 400);
await pruefe('kein PDF',
  bauen([...bBasis, ['unterlagen', new File(['x'], 'foto.jpg', { type: 'image/jpeg' })]]), 415);
await pruefe('vier PDF (max. drei)',
  bauen([...bBasis, ['unterlagen', pdf('a.pdf')], ['unterlagen', pdf('b.pdf')],
         ['unterlagen', pdf('c.pdf')], ['unterlagen', pdf('d.pdf')]]), 413);
await pruefe('zu gross (5 MB)',
  bauen([...bBasis, ['unterlagen',
    new File([new Uint8Array(5 * 1024 * 1024)], 'dick.pdf', { type: 'application/pdf' })]]), 413);
await pruefe('zwei PDF, gueltig',
  bauen([...bBasis, ['unterlagen', pdf('lebenslauf.pdf')], ['unterlagen', pdf('zeugnis.pdf')]]), 200,
  (j, m) => j.ok
    && /^Subject:.*Bewerbung/m.test(m)
    && m.includes('lebenslauf.pdf')
    && m.includes('zeugnis.pdf')
    && (m.match(/Content-Type: application\/pdf/g) || []).length === 2);
await pruefe('Kopfzeilen-Einschleusung im Namen',
  bauen([...bBasis.filter(([k]) => k !== 'vorname'),
         ['vorname', 'Tim\r\nBcc: angreifer@example.com'],
         ['unterlagen', pdf('cv.pdf')]]), 200,
  (j, m) => !/^Bcc:/mi.test(m));

smtp.close();
console.log(fehler ? `\n${fehler} Test(s) fehlgeschlagen\n` : '\nAlle Tests bestanden\n');
process.exit(fehler ? 1 : 0);
