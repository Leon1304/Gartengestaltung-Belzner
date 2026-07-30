/* ============================================================
   SMTP-PROBE
   Testet die Zugangsdaten des Postfachs, bevor sie nach Netlify
   wandern: erst die Anmeldung allein, dann eine echte Testmail.
   Spart den Umweg ueber Deploy und Funktionsprotokoll.

   Zugangsdaten nicht in die Befehlszeile tippen — sie landen sonst
   in der Shell-Historie. Stattdessen eine Datei .env anlegen
   (steht in .gitignore, wird also nie committet):

     SMTP_HOST=smtp.strato.de
     SMTP_PORT=465
     SMTP_USER=webmaster@571432009.swh.strato-hosting.eu
     SMTP_PASS=...
     MAIL_VON=webmaster@gartengestaltung-belzner.de
     MAIL_AN=leon-kolb@live.de

   Aufruf:
     node --env-file=.env scripts/mail-probe.mjs          nur anmelden
     node --env-file=.env scripts/mail-probe.mjs --senden  Testmail schicken
   ============================================================ */
import nodemailer from 'nodemailer';

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_AN } = process.env;
const VON = process.env.MAIL_VON || SMTP_USER;
const port = Number(SMTP_PORT || 465);

const fehlt = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].filter(n => !process.env[n]);
if (fehlt.length) {
  console.error(`\nEs fehlen: ${fehlt.join(', ')}\n`
              + `Lege eine .env an (siehe Kopf dieser Datei) und rufe auf mit:\n`
              + `  node --env-file=.env scripts/mail-probe.mjs\n`);
  process.exit(2);
}

console.log(`\nServer    ${SMTP_HOST}:${port} (${port === 465 ? 'SSL/TLS' : 'STARTTLS'})`);
console.log(`Anmeldung ${SMTP_USER}`);
console.log(`Absender  ${VON}`);
console.log(`Empfaenger ${MAIL_AN || '— nicht gesetzt —'}\n`);

const post = nodemailer.createTransport({
  host: SMTP_HOST,
  port,
  secure: port === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

/* Die Fehler kommen als Codes und Serverantworten zurueck. Hier stehen
   die Faelle, die bei genau dieser Einrichtung wahrscheinlich sind. */
function deuten(f) {
  const code = f.code || '';
  const text = String(f.response || f.message || '');
  if (code === 'EAUTH' || /\b535\b/.test(text)) return [
    'Anmeldung abgelehnt.',
    '- Steht in SMTP_USER wirklich der interne Login aus der Strato-Postfachverwaltung',
    '  (name@paketnummer.swh.strato-hosting.eu) und nicht die schoene Adresse?',
    '- Ist SMTP_PASS das Passwort des Postfachs und nicht das des Kundenlogins?',
  ];
  if (code === 'ESOCKET' || /wrong version number|SSL/i.test(text)) return [
    'Verschluesselung passt nicht zum Port.',
    '- Port 465 spricht sofort TLS, Port 587 beginnt unverschluesselt mit STARTTLS.',
    '- Bei Strato ist 465 der richtige Weg.',
  ];
  if (['ETIMEDOUT', 'ECONNECTION', 'ECONNREFUSED', 'EDNS'].includes(code)) return [
    'Keine Verbindung zum Server.',
    '- SMTP_HOST pruefen (smtp.strato.de).',
    '- Manche Netze sperren Port 465 ausgehend — dann in einem anderen Netz testen.',
  ];
  if (/\b55[03]\b/.test(text) && /sender|from|relay/i.test(text)) return [
    'Der Server nimmt diese Absenderadresse nicht an.',
    `- Darf ${VON} von diesem Postfach aus versendet werden?`,
    '- Weiterleitungen koennen nicht senden, nur echte Postfaecher.',
  ];
  return ['Unerwarteter Fehler — vollstaendige Meldung siehe oben.'];
}

try {
  await post.verify();
  console.log('  ok   Verbindung steht und die Anmeldung wurde akzeptiert.');
} catch (f) {
  console.error(` FEHL  ${f.message}\n`);
  deuten(f).forEach(z => console.error(`       ${z}`));
  console.error('');
  process.exit(1);
}

if (!process.argv.includes('--senden')) {
  console.log('\nZum Verschicken einer Testmail:');
  console.log('  node --env-file=.env scripts/mail-probe.mjs --senden\n');
  process.exit(0);
}

if (!MAIL_AN) {
  console.error('\nMAIL_AN ist nicht gesetzt — ohne Empfaenger keine Testmail.\n');
  process.exit(2);
}

try {
  const info = await post.sendMail({
    from: `"Website Belzner" <${VON}>`,
    to: MAIL_AN,
    subject: 'Testmail vom Formular-Versand',
    text: 'Wenn diese Nachricht ankommt, stimmen Server, Anmeldung und Absender.\n\n'
        + `Gesendet: ${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}\n`
        + '— scripts/mail-probe.mjs',
  });
  console.log(`  ok   Testmail angenommen (${info.messageId})`);
  console.log(`\nSchau in ${MAIL_AN} nach — auch im Spam-Ordner.\n`);
} catch (f) {
  console.error(` FEHL  ${f.message}\n`);
  deuten(f).forEach(z => console.error(`       ${z}`));
  console.error('');
  process.exit(1);
}
