#!/usr/bin/env node
/*
 * App icons for the PWA build.
 *
 *   NODE_PATH=$(npm root -g) node scripts/make-icons.js
 *
 * Drawn as SVG and rasterised through the headless browser that is already a
 * dependency of the test suites, rather than adding an image library for
 * three PNGs. The glyph is the app's own heart-pulse mark on the same navy
 * the shell uses, so the home screen matches the splash it opens into.
 *
 * The maskable variant keeps everything inside the inner 80% — Android crops
 * maskable icons to whatever shape the launcher wants, and art that runs to
 * the edge loses its corners.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, '..', 'dist', 'icons');

const NAVY = '#0A1628', NAVY2 = '#12243F', TEAL = '#2DD4BF', TEAL2 = '#38BDF8';

/* scale = how much of the canvas the artwork fills (1 = edge to edge). */
function svg(size, scale, rounded) {
  const c = size / 2;
  const r = rounded ? size * 0.22 : 0;
  /* The mark is drawn in a 24-unit box, same as the app's icon sprites. */
  const box = size * scale, off = (size - box) / 2, u = box / 24;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${NAVY2}"/><stop offset="1" stop-color="${NAVY}"/>
    </linearGradient>
    <linearGradient id="fg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${TEAL}"/><stop offset="1" stop-color="${TEAL2}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.55" r="0.5">
      <stop offset="0" stop-color="${TEAL}" stop-opacity="0.30"/>
      <stop offset="1" stop-color="${TEAL}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#bg)"/>
  <circle cx="${c}" cy="${c}" r="${size * 0.42}" fill="url(#glow)"/>
  <g transform="translate(${off},${off}) scale(${u})" fill="none" stroke="url(#fg)"
     stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12.5 20.5 5.6 13.8C3 11.3 3 7.4 5.6 5.2 8 3.2 11 4 12.5 6.8 14 4 17 3.2 19.4 5.2 22 7.4 22 11.3 19.4 13.8l-2 1.9"/>
    <path d="M4 13h3.2l1.3-3 2 5.5 1.5-3.5h5.4"/>
  </g>
</svg>`;
}

const JOBS = [
  { file: 'icon-192.png', size: 192, scale: 0.62, rounded: true },
  { file: 'icon-512.png', size: 512, scale: 0.62, rounded: true },
  /* maskable: smaller artwork, square bleed — the launcher supplies the shape */
  { file: 'icon-maskable-512.png', size: 512, scale: 0.50, rounded: false },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const j of JOBS) {
    const page = await browser.newPage({ viewport: { width: j.size, height: j.size } });
    await page.setContent(
      `<style>html,body{margin:0;padding:0;background:transparent}</style>${svg(j.size, j.scale, j.rounded)}`,
      { waitUntil: 'load' });
    await page.screenshot({ path: path.join(OUT, j.file), omitBackground: true });
    await page.close();
    console.log(`  ✓ ${j.file}  ${j.size}×${j.size}  ${(fs.statSync(path.join(OUT, j.file)).size / 1024).toFixed(1)} KB`);
  }
  await browser.close();
  console.log(`\nwritten to ${OUT}`);
})();
