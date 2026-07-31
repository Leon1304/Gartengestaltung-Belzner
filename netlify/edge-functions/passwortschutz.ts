import type { Context } from "https://edge.netlify.com";

// Zugangsdaten stehen in den Umgebungsvariablen der Netlify-Seite, nie im Code
// und damit auch nie im oeffentlichen GitHub-Repository.
const BENUTZER = Netlify.env.get("SITE_BENUTZER") ?? "";
const PASSWORT = Netlify.env.get("SITE_PASSWORT") ?? "";

// 401 mit WWW-Authenticate: der Browser zeigt daraufhin seinen Anmeldedialog.
// no-store, damit weder Browser noch Netlifys CDN die Absage zwischenspeichern.
function nachfragen() {
  return new Response("Diese Seite ist noch nicht oeffentlich.\n", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Gartengestaltung Belzner", charset="UTF-8"',
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

// Vergleich ohne fruehen Abbruch, damit die Antwortzeit nichts darueber
// verraet, wie viele Zeichen bereits gestimmt haben.
function gleich(a: string, b: string) {
  if (a.length !== b.length) return false;
  let unterschied = 0;
  for (let i = 0; i < a.length; i++) unterschied |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return unterschied === 0;
}

export default async (request: Request, _context: Context) => {
  // Fehlt die Konfiguration, bleibt die Seite zu statt versehentlich offen.
  if (!BENUTZER || !PASSWORT) {
    return new Response("Passwortschutz ist nicht konfiguriert.\n", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const kopf = request.headers.get("Authorization") ?? "";
  const [art, wert] = kopf.split(" ");
  if (art?.toLowerCase() !== "basic" || !wert) return nachfragen();

  // atob liefert einzelne Bytes; erst der TextDecoder macht daraus wieder
  // UTF-8, damit auch Umlaute im Passwort ankommen.
  let angabe: string;
  try {
    angabe = new TextDecoder().decode(Uint8Array.from(atob(wert), (z) => z.charCodeAt(0)));
  } catch {
    return nachfragen();
  }

  // Nur am ersten Doppelpunkt trennen — im Passwort darf einer vorkommen.
  const trenner = angabe.indexOf(":");
  if (trenner < 0) return nachfragen();

  const stimmtBenutzer = gleich(angabe.slice(0, trenner), BENUTZER);
  const stimmtPasswort = gleich(angabe.slice(trenner + 1), PASSWORT);
  if (!stimmtBenutzer || !stimmtPasswort) return nachfragen();

  // Ohne Rueckgabe liefert Netlify die eigentliche Datei aus.
};
