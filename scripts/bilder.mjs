/* ============================================================
   BILDER-PIPELINE
   Erzeugt aus den Originalen in Bilder/ die Groessenstaffel in
   Bilder/opt/ — je Breite einmal AVIF und einmal JPEG als
   Rueckfallebene. Dazu Favicons und das Teilen-Bild.

   Aufruf (einmalig sharp installieren):
     npm install sharp
     node scripts/bilder.mjs

   Die Ausgaben gehoeren ins Repository: Netlify baut sie nicht
   selbst nach, und Bilder/opt liegt unter derselben Cache-Regel
   wie Bilder/ (siehe netlify.toml).
   ============================================================ */
import sharp from 'sharp';
import { readdir, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, parse } from 'node:path';

const SRC = 'Bilder';
const OUT = join(SRC, 'opt');
const ASSETS = 'assets';

// Vier Stufen decken den Bereich vom Telefon bis zum Retina-Hero ab.
// Groesser als das Original wird nie skaliert.
const WIDTHS = [640, 1024, 1600, 2400];

await mkdir(OUT, { recursive: true });

const files = (await readdir(SRC))
  .filter(f => /\.(jpe?g|png)$/i.test(f) && f !== 'Logo.png');

let bytesIn = 0, bytesOut = 0;

for (const file of files) {
  const { name } = parse(file);
  const src = join(SRC, file);
  const meta = await sharp(src).metadata();
  bytesIn += (await sharp(src).toBuffer()).length;

  for (const w of WIDTHS) {
    // Eine Stufe ueber der Originalbreite darf noch entstehen, damit
    // srcset nicht ploetzlich ohne passenden Kandidaten dasteht.
    if (w > meta.width * 1.02) continue;
    const pipe = () => sharp(src).resize({ width: w, withoutEnlargement: true });

    const avif = join(OUT, `${name}-${w}.avif`);
    const jpg  = join(OUT, `${name}-${w}.jpg`);
    const a = await pipe().avif({ quality: 52, effort: 6 }).toFile(avif);
    const j = await pipe().jpeg({ quality: 74, progressive: true, mozjpeg: true }).toFile(jpg);
    bytesOut += a.size + j.size;
    process.stdout.write(`${name}-${w}: avif ${(a.size/1024|0)}K · jpg ${(j.size/1024|0)}K\n`);
  }
}

/* ---------- Favicons aus dem Logo ---------- */
/* Der schwarze Federkiel verschwindet in 32 px auf dunklem Grund fast,
   darum bekommt das Icon einen hellen Grund statt Transparenz. */
const logo = join(ASSETS, 'logo-belzner.png');
for (const size of [32, 180, 512]) {
  const pad = Math.round(size * 0.08);
  await sharp(logo)
    .resize({ width: size - pad * 2, height: size - pad * 2, fit: 'contain',
              background: { r: 250, g: 250, b: 248, alpha: 1 } })
    .extend({ top: pad, bottom: pad, left: pad, right: pad,
              background: { r: 250, g: 250, b: 248, alpha: 1 } })
    .png()
    .toFile(join(ASSETS, `favicon-${size}.png`));
}

/* ---------- Logo neu packen ---------- */
/* Die Vorlagen kamen mit rund 80 KB je Datei aus der Mediathek. Die Marke
   besteht aus zwei Farben plus Transparenz — eine Palette reicht dafuer und
   kostet ein Zwanzigstel. */
/* Beim ersten Lauf wandert die Vorlage nach assets/quelle/. Von dort wird
   danach immer neu gerechnet — sonst quantisierte jeder weitere Lauf das
   schon quantisierte Ergebnis ein Stueck weiter herunter. */
await mkdir(join(ASSETS, 'quelle'), { recursive: true });
for (const name of ['logo-belzner', 'logo-belzner-light']) {
  const out  = join(ASSETS, `${name}.png`);
  const orig = join(ASSETS, 'quelle', `${name}.png`);
  if (!existsSync(orig)) await copyFile(out, orig);
  const before = (await sharp(orig).toBuffer()).length;
  const buf = await sharp(orig).png({ palette: true, colours: 64, compressionLevel: 9 }).toBuffer();
  await writeFile(out, buf);
  console.log(`${name}.png: ${(before/1024)|0}K -> ${(buf.length/1024)|0}K`);
}

/* ---------- Teilen-Bild (WhatsApp, Facebook, LinkedIn) ---------- */
await sharp(join(SRC, 'IMG_0070-2.jpg'))
  .resize({ width: 1200, height: 630, fit: 'cover', position: 'attention' })
  .jpeg({ quality: 80, mozjpeg: true })
  .toFile(join(ASSETS, 'og-bild.jpg'));

console.log(`\nOriginale: ${(bytesIn/1024/1024).toFixed(1)} MB`);
console.log(`Staffel:   ${(bytesOut/1024/1024).toFixed(1)} MB (alle Stufen zusammen)`);
