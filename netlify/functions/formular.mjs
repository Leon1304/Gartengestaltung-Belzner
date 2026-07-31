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
     CAPTCHA_SECRET (siehe netlify/lib/abwehr.mjs)
   ============================================================ */
import nodemailer from 'nodemailer';
import { pruefeMarke, verbrauche } from '../lib/abwehr.mjs';
import { zaehle, ANLIEGEN, STELLEN } from '../lib/zaehler.mjs';

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
   also gut 4,4 MB. Drei PDF mit zusammen 3 MB kommen auf rund 4,1 MB
   und decken Lebenslauf plus Zeugnisse ab. Bei 4 MB waeren es 5,6 MB
   gewesen: knapp unter der Grenze, aber wer sie reizt, bekommt die
   Absage von der Plattform statt aus dieser Funktion — und damit eine
   Fehlermeldung, die niemandem weiterhilft. */
const MAX_ANZAHL = 3;
const MAX_GESAMT = 3 * 1024 * 1024;

/* Das Formular laesst 5000 Zeichen zu und zeigt sie mit. Hier steht
   bewusst mehr: beim Absenden wird jeder Zeilenumbruch zu zwei Zeichen,
   ein Text am Limit waechst dabei um die Zahl seiner Absaetze. Die
   Grenze hier ist nur der Riegel gegen Missbrauch, nicht die Zusage an
   den Besucher — die haelt das Formular ein. */
const MAX_TEXT   = 6000;

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

/* Endung und MIME-Typ kommen vom Browser und lassen sich frei setzen.
   Eine echte PDF beginnt mit %PDF-; Betrachter verzeihen etwas Vorlauf,
   darum genuegt der Fund in den ersten 1024 Byte. Damit landet nichts
   im Postfach, was sich nur als PDF ausgibt. */
const istPdf = (puffer) => puffer.subarray(0, 1024).includes('%PDF-', 0, 'latin1');

/* feld benennt das Eingabefeld, an dem der Fehler haengt — die Seite
   markiert es dann und setzt den Fokus hinein. */
const antwort = (status, text, feld) =>
  Response.json({ ok: status < 400, text, feld }, { status });

export default async (request, context) => {
  if (request.method !== 'POST') return antwort(405, 'Nur POST.');

  let daten;
  try {
    daten = await request.formData();
  } catch {
    return antwort(400, 'Die Daten kamen unvollständig an. Bitte noch einmal versuchen.');
  }

  const art = daten.get('art') === 'bewerbung' ? 'bewerbung' : 'anfrage';

  /* Honigtopf: ein Feld, das kein Mensch zu sehen bekommt. Steht etwas
     darin, war es ein Skript. Nach aussen sieht das aus wie ein
     erfolgreicher Versand — wer es automatisiert versucht, soll nicht
     lernen, woran es lag. */
  if (sauber(daten.get('website'))) return antwort(200, 'Danke!');

  /* Die Rechenaufgabe. Geprueft wird hier, nicht im Browser: Bots posten
     direkt auf diese Adresse und fuehren das Skript der Seite gar nicht
     aus — fuer die alte Loesung, die beides dem Browser ueberliess, war
     dieser Endpunkt schlicht offen. Die Marke stammt von /api/aufgabe
     und traegt Aufgabe und Zeitpunkt mit unserer Unterschrift.
     Anders als beim Honigtopf bekommt der Besucher hier eine echte
     Meldung: eine abgelaufene Marke trifft auch den, der das Formular
     lange offen hatte, und der soll nicht ins Leere senden. */
  let marke;
  try {
    marke = pruefeMarke(daten.get('marke'), daten.get('captcha'));
  } catch (fehler) {
    /* Kommt nur vor, wenn der Schluessel fehlt — dann ist die Seite
       ohnehin nicht versandfaehig. Eine klare Meldung statt eines 500ers,
       den der Browser als »unerwartete Antwort« zeigt. */
    console.error('Sicherheitsabfrage nicht pruefbar:', fehler.message);
    return antwort(502, 'Die Nachricht ließ sich gerade nicht zustellen. '
                      + 'Bitte rufen Sie uns an: 06251 3091');
  }
  if (!marke.ok) {
    const meldung = {
      falsch:     'Das Ergebnis stimmt nicht. Bitte die neue Aufgabe lösen.',
      schnell:    'Das ging sehr schnell — bitte kurz warten und noch einmal senden.',
      abgelaufen: 'Die Sicherheitsabfrage ist abgelaufen. '
                + 'Bitte die neue Aufgabe lösen und noch einmal senden.',
    }[marke.grund] || 'Bitte lösen Sie die Rechenaufgabe.';
    return antwort(400, meldung, 'captcha');
  }

  const email = kopfSicher(daten.get('email'), 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return antwort(400, 'Bitte eine gültige E-Mail-Adresse angeben.', 'email');
  }

  /* Ohne Einwilligung fehlt die Rechtsgrundlage — das prueft nicht nur
     das Formular, sondern auch diese Stelle. Der Zeitpunkt wandert unten
     in die Mail: nach Art. 7 Abs. 1 DSGVO muss der Betrieb die
     Einwilligung nachweisen koennen, und die Mail ist der einzige Ort,
     an dem von der Anfrage ueberhaupt etwas aufbewahrt wird. */
  if (!daten.get('datenschutz')) {
    return antwort(400, 'Ohne Ihre Einwilligung dürfen wir die Angaben nicht verarbeiten.',
                   'datenschutz');
  }
  const eingang = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });

  /* ---------- Unterlagen ---------- */
  const anhaenge = [];
  if (art === 'bewerbung') {
    let summe = 0;
    for (const f of daten.getAll('unterlagen')) {
      if (typeof f === 'string' || !f.size) continue;
      if (anhaenge.length >= MAX_ANZAHL) {
        return antwort(413, `Bitte höchstens ${MAX_ANZAHL} PDF anhängen.`, 'unterlagen');
      }
      if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) {
        return antwort(415, `„${sauber(f.name, 80)}" ist kein PDF.`, 'unterlagen');
      }
      summe += f.size;
      if (summe > MAX_GESAMT) {
        return antwort(413, 'Die Unterlagen sind zusammen zu groß (höchstens 3 MB). '
                          + 'Bitte kleiner speichern oder an info@gartengestaltung-belzner.de senden.',
                       'unterlagen');
      }
      const inhalt = Buffer.from(await f.arrayBuffer());
      if (!istPdf(inhalt)) {
        return antwort(415, `„${sauber(f.name, 80)}" ist keine PDF-Datei.`, 'unterlagen');
      }
      anhaenge.push({
        // Pfadtrenner raus: der Dateiname landet als Anhangname in der Mail
        filename: sauber(f.name, 80).replace(/[/\\]/g, '_') || 'unterlage.pdf',
        content: inhalt,
        contentType: 'application/pdf',
      });
    }
    if (!anhaenge.length) return antwort(400, 'Bitte mindestens ein PDF anhängen.', 'unterlagen');
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

  /* Ratengrenze. Erst hier, kurz vor dem Versand: eine Anfrage, die
     ohnehin an der Sicherheitsabfrage scheitert, soll niemandem sein
     Kontingent wegnehmen — hinter einem Firmenanschluss teilen sich
     viele Menschen dieselbe Adresse. Der Zaehlstand haelt eine Stunde. */
  const adresse = context?.ip
    || request.headers.get('x-nf-client-connection-ip')
    || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  let grenze = { ok: true };
  try {
    grenze = await verbrauche(adresse);
  } catch (fehler) {
    // Faellt die Zaehlung aus, soll nicht die ganze Anfrage daran haengen.
    console.error('Ratengrenze nicht pruefbar:', fehler.message);
  }
  if (!grenze.ok) {
    console.warn('Ratengrenze erreicht:', grenze.grund);
    return antwort(429, grenze.grund === 'absender'
      ? 'Von hier kamen in der letzten Stunde schon mehrere Nachrichten. '
      + 'Bitte versuchen Sie es später noch einmal oder rufen Sie uns an: 06251 3091'
      : 'Es gehen gerade sehr viele Nachrichten ein. '
      + 'Bitte versuchen Sie es später noch einmal oder rufen Sie uns an: 06251 3091');
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

  /* Fuer die Strichliste des Dashboards, und erst hier: gezaehlt
     wird, was wirklich im Postfach liegt. Meldete stattdessen die
     Seite den Versand, stuenden dort auch Anfragen, die unterwegs
     haengen geblieben sind. Gespeichert wird dabei nur, welches
     Formular und welches Thema — kein Name, keine Adresse, kein
     Wort aus der Nachricht.

     Ohne await: der Besucher soll auf seine Bestaetigung nicht
     warten, weil eine Strichliste hakt. Faellt sie aus, faellt sie
     eben aus. */
  const kuerzel = art === 'bewerbung' ? STELLEN[thema] : ANLIEGEN[thema];
  zaehle('senden', { formular: art, thema: kuerzel })
    .catch(fehler => console.error('Zaehlung fehlgeschlagen:', fehler.message));

  return antwort(200, art === 'bewerbung'
    ? 'Ihre Bewerbung ist angekommen. Wir melden uns in der Regel innerhalb von zwei Wochen.'
    : 'Ihre Anfrage ist angekommen. Wir melden uns in der Regel innerhalb von zwei Werktagen.');
};
