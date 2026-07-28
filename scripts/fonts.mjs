/* Laedt die Google-Font-CSS, behaelt nur die Subsets latin + latin-ext,
   holt die woff2-Dateien und schreibt eine CSS mit lokalen Pfaden. */
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const URL_CSS = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,400..900,0..100,0..1&family=Instrument+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap';

const DEST = process.argv[2];
await mkdir(join(DEST, 'fonts'), { recursive: true });

const css = await (await fetch(URL_CSS, { headers: { 'User-Agent': UA } })).text();

// Google liefert die Bloecke als "/* subset */ @font-face{...}"
const blocks = css.split('/*').slice(1).map(b => '/*' + b);
const keep = blocks.filter(b => /^\/\*\s*(latin|latin-ext)\s*\*\//.test(b));

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
let out = '/* Lokal gehostete Schriften — kein Aufruf an Google beim Seitenbesuch.\n' +
          '   Erzeugt von scripts/fonts.mjs, nur latin + latin-ext. */\n\n';

for (const b of keep) {
  const subset = b.match(/^\/\*\s*([\w-]+)\s*\*\//)[1];
  const family = b.match(/font-family:\s*'([^']+)'/)[1];
  const url = b.match(/url\((https:\/\/[^)]+\.woff2)\)/)[1];
  // Gewicht gehoert in den Dateinamen: Instrument Sans und IBM Plex Mono
  // kommen als eigener Schnitt je Gewicht, nicht als variable Schrift.
  const weight = (b.match(/font-weight:\s*([\d\s]+);/) || [, 'var'])[1].trim().replace(/\s+/g, '-');
  const name = `${slug(family)}-${weight}-${subset}.woff2`;
  const buf = Buffer.from(await (await fetch(url, { headers: { 'User-Agent': UA } })).arrayBuffer());
  await writeFile(join(DEST, 'fonts', name), buf);
  console.log(`${name}  ${(buf.length / 1024) | 0} KB`);
  out += b.replace(/url\(https:\/\/[^)]+\.woff2\)/, `url('fonts/${name}')`).trim() + '\n\n';
}
await writeFile(join(DEST, 'fonts.css'), out);
console.log('\nfonts.css geschrieben:', keep.length, 'Bloecke');
