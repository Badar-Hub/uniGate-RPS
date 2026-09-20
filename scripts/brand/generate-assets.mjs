// Builds every icon/logo asset from the brand logo (apps/web/public/brand/logo-source.jpg, the 1000×1000
// image published on unigate.co). Run from the repo root: node scripts/brand/generate-assets.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// sharp is an optional dependency of Next.js, so it lives only in the pnpm store: find it there.
const store = path.join(ROOT, 'node_modules/.pnpm');
const sharpDir = fs.readdirSync(store).find((d) => d.startsWith('sharp@'));
if (!sharpDir) throw new Error('sharp not found in node_modules/.pnpm — run pnpm install');
const require = createRequire(path.join(store, sharpDir, 'node_modules/sharp/package.json'));
const sharp = require('sharp');

const SRC = `${ROOT}/apps/web/public/brand/logo-source.jpg`;
const MOBILE = `${ROOT}/apps/mobile/assets/images`;
const WEB = `${ROOT}/apps/web/public`;

/** White background → alpha. Darkness = 255 - min(r,g,b): a coloured stroke on white is fully opaque, anti-aliased edges partial. */
async function knockOutWhite(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const min = Math.min(data[i], data[i + 1], data[i + 2]);
    const alpha = Math.min(255, Math.max(0, Math.round((255 - min) * 1.15)));
    data[i + 3] = alpha;
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

/** Trim transparent margins. */
async function trimmed(png) {
  return sharp(png).trim({ threshold: 10 }).png().toBuffer();
}

/** Place a PNG centred on a canvas of `size`, scaled to `fraction` of it, on `background` (null = transparent). */
async function onCanvas(png, size, fraction, background) {
  const target = Math.round(size * fraction);
  const inner = await sharp(png).resize(target, target, { fit: 'inside', withoutEnlargement: false }).png().toBuffer();
  const meta = await sharp(inner).metadata();
  return sharp({ create: { width: size, height: size, channels: 4, background: background ?? { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: inner, left: Math.round((size - meta.width) / 2), top: Math.round((size - meta.height) / 2) }])
    .png()
    .toBuffer();
}

const full = await knockOutWhite(SRC);                              // whole logo, transparent
const fullTrim = await trimmed(full);
const markOnly = await trimmed(await knockOutWhite(await sharp(SRC).extract({ left: 100, top: 0, width: 800, height: 770 }).png().toBuffer()));
const white = { r: 255, g: 255, b: 255, alpha: 1 };

// Mobile
await sharp(await onCanvas(markOnly, 1024, 0.74, white)).toFile(`${MOBILE}/icon.png`);                       // iOS / generic icon: no alpha, white
await sharp(await onCanvas(markOnly, 1024, 0.56, null)).toFile(`${MOBILE}/android-icon-foreground.png`);    // adaptive foreground: safe zone is the centre 66 %
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: white } }).png().toFile(`${MOBILE}/android-icon-background.png`);
{
  // monochrome: the mark's alpha as a black silhouette
  const { data, info } = await sharp(await onCanvas(markOnly, 1024, 0.56, null)).raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) { data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(`${MOBILE}/android-icon-monochrome.png`);
}
await sharp(await onCanvas(markOnly, 512, 0.9, null)).toFile(`${MOBILE}/splash-icon.png`);
await sharp(await onCanvas(markOnly, 96, 0.9, white)).toFile(`${MOBILE}/favicon.png`);
await sharp(fullTrim).resize({ width: 1200, withoutEnlargement: true }).png().toFile(`${MOBILE}/logo-full.png`);   // login / register screens
await sharp(markOnly).resize({ width: 512, withoutEnlargement: true }).png().toFile(`${MOBILE}/logo-mark.png`);

// Web
fs.mkdirSync(`${WEB}/brand`, { recursive: true });
await sharp(fullTrim).resize({ width: 1200, withoutEnlargement: true }).png().toFile(`${WEB}/brand/logo-full.png`);
await sharp(markOnly).resize({ width: 512 }).png().toFile(`${WEB}/brand/logo-mark.png`);
await sharp(await onCanvas(markOnly, 512, 0.84, white)).toFile(`${WEB}/brand/icon-512.png`);
await sharp(await onCanvas(markOnly, 192, 0.84, white)).toFile(`${WEB}/brand/icon-192.png`);
await sharp(await onCanvas(markOnly, 180, 0.84, white)).toFile(`${WEB}/apple-touch-icon.png`);
await sharp(await onCanvas(markOnly, 64, 0.9, white)).toFile(`${WEB}/favicon.png`);
await sharp(await onCanvas(markOnly, 512, 0.84, white)).toFile(`${WEB}/icons/driver-512.png`);
await sharp(await onCanvas(markOnly, 192, 0.84, white)).toFile(`${WEB}/icons/driver-192.png`);

// Launcher / favicon files must be opaque (Apple rejects an alpha channel in the App Store icon).
for (const f of [`${MOBILE}/icon.png`, `${MOBILE}/favicon.png`, `${WEB}/brand/icon-512.png`, `${WEB}/brand/icon-192.png`, `${WEB}/apple-touch-icon.png`, `${WEB}/favicon.png`, `${WEB}/icons/driver-512.png`, `${WEB}/icons/driver-192.png`]) {
  fs.writeFileSync(f, await sharp(f).flatten({ background: '#ffffff' }).removeAlpha().png().toBuffer());
}

for (const f of ['icon.png', 'android-icon-foreground.png', 'splash-icon.png', 'logo-full.png']) {
  const m = await sharp(`${MOBILE}/${f}`).metadata();
  console.log(f, m.width + 'x' + m.height, m.hasAlpha ? 'alpha' : 'opaque');
}
