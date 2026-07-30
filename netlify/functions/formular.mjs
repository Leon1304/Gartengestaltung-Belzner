/* ============================================================
   FORMULARVERSAND
   Nimmt Kontaktanfrage und Bewerbung entgegen und reicht beides
   per SMTP an das Postfach des Betriebs weiter. Gespeichert wird
   hier nichts: die Funktion laeuft, verschickt und ist wieder weg.
   Damit bleibt der Datenschutzerklaerung ein weiterer Empfaenger
   erspart — die Unterlagen liegen nur dort, wo sie hingehoeren.

   Zugangsdaten stehen in den Umgebungsvariablen der Netlify-Seite,
   nie im Code und damit nie im oeffentlichen Repository:
     SMTP_HOST  SMTP_PORT  SMTP_USER  SMTP_PASS  MAIL_AN  MAIL_VON
   ============================================================ */
import nodemailer from 'nodemailer';

export const config = { path: '/api/formular' };

const AN = process.env.MAIL_AN || 'info@gartengestaltung-belzner.de';

/* Anmeldename und Absenderadresse sind zweierlei. Strato vergibt fuer
   Postfaecher im Webhosting-Paket einen internen Login der Form
   name@paketnummer.swh.strato-hosting.eu — der taugt als Anmeldung, aber
   nicht als Absender in einer Mail an Kunden. MAIL_VON traegt darum die
   Adresse, die der Empfaenger sieht. Fehlt sie, bleibt es beim Login. */
const VON = process.env.MAIL_VON || process.env.SMTP_USER;

/* Netlify puffert Anfrage und Antwort bei 6 MB, binaere Nutzlast wird
   Base64-kodiert und waechst dabei um rund ein Drittel — real bleiben
   also gut 4,5 MB. Drei PDF mit zusammen 4 MB liegen sicher darunter
   und decken Lebenslauf plus Zeugnisse ab. */
const MAX_ANZAHL = 3;
const MAX_GESAMT = 4 * 1024 * 1024;
const MAX_TEXT   = 5000;

/* Nur diese Felder wandern in die Mail. Alles andere, was im Formular
   steht oder jemand zusaetzlich mitschickt, wird ignoriert — so kann
   ueber ein untergeschobenes Feld keine eigene Zeile in den Text. */
const FELDER = {
  anfrage:   ['vorname', 'nachname', 'email', 'telefon', 'anliegen', 'nachricht'],
  bewerbung: ['vorname', 'nachname', 'email', 'telefon', 'stelle',   'nachricht'],
};
const LABEL = {
  vorname: 'Vorname', nachname: 'Nachname', email: 'E-Mail', telefon: 'Telefon',
  anliegen: 'Anliegen', stelle: 'Stelle', nachricht: 'Nachricht',
};

/* Steuerzeichen raus, dann kappen: sichtbar taeten sie nichts, aber sie
   brechen die Zeilen- und Kopfstruktur der Mail auf. */
const sauber = (s, max = 300) =>
  String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

/* Kopfzeilen duerfen keinen Umbruch enthalten: sonst liesse sich ueber
   Betreff oder Reply-To eine zweite Kopfzeile einschleusen. */
const kopfSicher = (s, max = 200) => sauber(s, max).replace(/[\r\n]/g, ' ');

const antwort = (status, text) => Response.json({ ok: status < 400, text }, { status });

export default async (request) => {
  if (request.method !== 'POST') return antwort(405, 'Nur POST.');

  let daten;
  try {
    daten = await request.formData();
  } catch {
    return antwort(400, 'Die Daten kamen unvollständig an. Bitte noch einmal versuchen.');
  }

  const art = daten.get('art') === 'bewerbung' ? 'bewerbung' : 'anfrage';

  /* Honigtopf und Zeitschloss. Die Rechenaufgabe im Browser haelt hier
     niemanden mehr auf: Bots posten direkt auf diese Adresse und fuehren
     das Skript der Seite gar nicht aus. Beide Werte unten setzt die Seite
     selbst — fehlen sie, kam die Anfrage nicht aus dem Formular.
     Nach aussen sieht das aus wie ein erfolgreicher Versand; wer es
     automatisiert versucht, soll nicht lernen, woran es lag. */
  if (sauber(daten.get('website'))) return antwort(200, 'Danke!');
  const geladen = Number(daten.get('geladen'));
  if (!geladen || Date.now() - geladen < 3000) return antwort(200, 'Danke!');

  const email = kopfSicher(daten.get('email'), 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return antwort(400, 'Bitte eine gültige E-Mail-Adresse angeben.');
  }

  /* Ohne Einwilligung fehlt die Rechtsgrundlage — das prueft nicht nur
     das Formular, sondern auch diese Stelle. Der Zeitpunkt wandert unten
     in die Mail: nach Art. 7 Abs. 1 DSGVO muss der Betrieb die
     Einwilligung nachweisen koennen, und die Mail ist der einzige Ort,
     an dem hier ueberhaupt etwas aufbewahrt wird. */
  if (!daten.get('datenschutz')) {
    return antwort(400, 'Ohne Ihre Einwilligung dürfen wir die Angaben nicht verarbeiten.');
  }
  const eingang = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });

  /* ---------- Unterlagen ---------- */
  const anhaenge = [];
  if (art === 'bewerbung') {
    let summe = 0;
    for (const f of daten.getAll('unterlagen')) {
      if (typeof f === 'string' || !f.size) continue;
      if (anhaenge.length >= MAX_ANZAHL) {
        return antwort(413, `Bitte höchstens ${MAX_ANZAHL} PDF anhängen.`);
      }
      if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) {
        return antwort(415, `„${sauber(f.name, 80)}" ist kein PDF.`);
      }
      summe += f.size;
      if (summe > MAX_GESAMT) {
        return antwort(413, 'Die Unterlagen sind zusammen zu groß (höchstens 4 MB). '
                          + 'Bitte kleiner speichern oder an info@gartengestaltung-belzner.de senden.');
      }
      anhaenge.push({
        // Pfadtrenner raus: der Dateiname landet als Anhangname in der Mail
        filename: sauber(f.name, 80).replace(/[/\\]/g, '_') || 'unterlage.pdf',
        content: Buffer.from(await f.arrayBuffer()),
        contentType: 'application/pdf',
      });
    }
    if (!anhaenge.length) return antwort(400, 'Bitte mindestens ein PDF anhängen.');
  }

  /* ---------- Text ---------- */
  const name = [sauber(daten.get('vorname'), 80), sauber(daten.get('nachname'), 80)]
    .filter(Boolean).join(' ');
  const thema = kopfSicher(daten.get(art === 'bewerbung' ? 'stelle' : 'anliegen'), 120);
  const text = FELDER[art]
    .map(feld => [LABEL[feld], sauber(daten.get(feld), feld === 'nachricht' ? MAX_TEXT : 300)])
    .filter(([, wert]) => wert)
    .map(([label, wert]) => `${label}: ${wert}`)
    .join('\n');

  /* ---------- Versand ---------- */
  /* Fehlt die Konfiguration, liegt es nicht am Mailserver — dann sind die
     Umgebungsvariablen gar nicht angekommen. Eigene Meldung, sonst sucht
     man den Fehler bei Strato statt in den Netlify-Einstellungen. */
  const fehlt = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].filter(n => !process.env[n]);
  if (fehlt.length) {
    console.error('SMTP-Konfiguration unvollstaendig, es fehlen:', fehlt.join(', '));
    return antwort(502, 'Die Nachricht ließ sich gerade nicht zustellen. '
                      + 'Bitte rufen Sie uns an: 06251 3091'
                      + (process.env.MAIL_DEBUG ? ` [Konfiguration fehlt: ${fehlt.join(', ')}]` : ''));
  }

  const port = Number(process.env.SMTP_PORT || 465);
  const post = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,          // 465 spricht direkt TLS, 587 startet mit STARTTLS
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    /* Ohne diese Grenzen haengt ein gesperrter Port, bis die Funktion
       selbst abbricht — dann steht im Protokoll ein Timeout der Plattform
       statt der eigentlichen Ursache. So kommt nach zehn Sekunden ein
       sauberes ETIMEDOUT zurueck. */
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });

  try {
    await post.sendMail({
      /* Absender bleibt eine eigene Adresse des Betriebs. Stuende hier die
         des Besuchers, wiesen SPF und DMARC die Mail ab — antworten laesst
         sich trotzdem direkt, dafuer ist Reply-To da. */
      from: `"Website Belzner" <${VON}>`,
      to: AN,
      replyTo: name ? `"${name.replace(/"/g, '')}" <${email}>` : email,
      subject: (art === 'bewerbung' ? 'Bewerbung' : 'Anfrage')
             + (thema ? `: ${thema}` : '')
             + (name ? ` — ${name}` : ''),
      text: `${text}\n\n`
          + `Eingegangen: ${eingang}\n`
          + `Einwilligung in die Datenschutzerklärung: erteilt\n\n`
          + `— gesendet über das Formular auf gartengestaltung-belzner.de`,
      attachments: anhaenge,
    });
  } catch (fehler) {
    /* Der Code sagt, wo es klemmt: EAUTH am Passwort, ETIMEDOUT am
       gesperrten Port, ESOCKET an der Verschluesselung, EENVELOPE am
       abgelehnten Absender. Ausfuehrlich ins Funktionsprotokoll; an den
       Besucher nur, solange MAIL_DEBUG gesetzt ist. */
    const code = fehler.code || fehler.responseCode || 'unbekannt';
    console.error(`Mailversand fehlgeschlagen [${code}]`,
      fehler.response || fehler.message, fehler);
    return antwort(502, 'Die Nachricht ließ sich gerade nicht zustellen. '
                      + 'Bitte rufen Sie uns an: 06251 3091'
                      + (process.env.MAIL_DEBUG ? ` [${code}]` : ''));
  }

  return antwort(200, art === 'bewerbung'
    ? 'Ihre Bewerbung ist angekommen. Wir melden uns in der Regel innerhalb von zwei Wochen.'
    : 'Ihre Anfrage ist angekommen. Wir melden uns in der Regel innerhalb von zwei Werktagen.');
};
