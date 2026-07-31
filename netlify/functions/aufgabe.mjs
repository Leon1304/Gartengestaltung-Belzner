/* ============================================================
   RECHENAUFGABE AUSGEBEN
   Die Seite holt sich hier eine Aufgabe, sobald jemand anfaengt, ein
   Formular auszufuellen. Zurueck kommen der sichtbare Text und eine
   Marke: dieselbe Aufgabe, unterschrieben und mit Zeitstempel. Die
   Loesung bleibt auf dem Server — in der Marke steht sie nicht.
   ============================================================ */
import { neueAufgabe } from '../lib/abwehr.mjs';

export const config = { path: '/api/aufgabe' };

// Keine Zwischenspeicherung: jede Aufgabe gilt genau einmal und nur kurz.
const KOPF = { 'Cache-Control': 'no-store' };

export default async () => {
  try {
    const { aufgabe, marke } = neueAufgabe();
    return Response.json({ aufgabe, marke }, { headers: KOPF });
  } catch (fehler) {
    /* Kommt praktisch nur vor, wenn weder CAPTCHA_SECRET noch SMTP_PASS
       in den Umgebungsvariablen der Netlify-Seite stehen. */
    console.error('Aufgabe liess sich nicht erzeugen:', fehler.message);
    return Response.json(
      { text: 'Die Sicherheitsabfrage steht gerade nicht bereit. '
            + 'Bitte rufen Sie uns an: 06251 3091' },
      { status: 503, headers: KOPF },
    );
  }
};
