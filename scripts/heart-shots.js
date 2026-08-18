#!/usr/bin/env node
/* Renders src/core/heart3d.js from a fixed set of angles and modes into one
 * contact sheet, so shape changes can be judged against the real silhouette
 * instead of read off the source.
 *
 *   NODE_PATH=$(npm root -g) node scripts/heart-shots.js [out.png]
 *
 * Angles are the ones anatomy is actually taught from: anterior (what you see
 * opening a chest), the LAO oblique a cath lab lives in, left lateral,
 * posterior, and right lateral — plus a cutaway so the chambers are checked
 * at the same time as the outside.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = process.argv[2] || path.join(__dirname, '..', 'demo', 'shape-check.png');
const ROOT = path.join(__dirname, '..');
const heart3d = fs.readFileSync(path.join(ROOT, 'src', 'core', 'heart3d.js'), 'utf8');

const VIEWS = [
  { label: 'anterior',        yaw: 0.00, pitch: 0.06, mode: 'whole' },
  { label: 'LAO oblique',     yaw: 0.85, pitch: 0.10, mode: 'whole' },
  { label: 'left lateral',    yaw: 1.57, pitch: 0.05, mode: 'whole' },
  { label: 'posterior',       yaw: 3.14, pitch: 0.06, mode: 'whole' },
  { label: 'right lateral',   yaw: -1.57, pitch: 0.05, mode: 'whole' },
  { label: 'cutaway',         yaw: 0.20, pitch: 0.08, mode: 'cutaway' },
];

const CELL = 340;
const COLS = 3;
const ROWS = Math.ceil(VIEWS.length / COLS);

const page_html = `<!doctype html><meta charset="utf-8">
<style>
  body{margin:0;background:${process.env.SHOT_BG || '#0B111A'};font:12px ui-monospace,Menlo,monospace;color:#8DA0B4}
  .grid{display:grid;grid-template-columns:repeat(${COLS},${CELL}px);gap:0}
  .cell{position:relative;width:${CELL}px;height:${CELL}px}
  canvas{width:100%;height:100%;display:block}
  .lbl{position:absolute;left:10px;top:8px;letter-spacing:.08em;text-transform:uppercase}
</style>
<div class="grid" id="grid"></div>
<script>${heart3d}<\/script>
<script>
  window.__ready = false;
  const views = ${JSON.stringify(VIEWS)};
  const grid = document.getElementById('grid');
  const hearts = [];
  for (const v of views) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    const cv = document.createElement('canvas');
    const lbl = document.createElement('div');
    lbl.className = 'lbl'; lbl.textContent = v.label;
    cell.appendChild(cv); cell.appendChild(lbl); grid.appendChild(cell);
    const h = Heart3D.create(cv, {
      rhythm: 'sinus', mode: v.mode, dark: true,
      yaw: v.yaw, pitch: v.pitch, autoRotate: false,
    });
    hearts.push(h);
  }
  window.__failed = hearts.some(h => !h);
  // let the beat settle to mid-diastole so the shape is judged relaxed, not squeezed
  setTimeout(() => { window.__ready = true; }, 2600);
<\/script>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: CELL * COLS, height: CELL * ROWS },
    deviceScaleFactor: 2,
  });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });

  await page.setContent(page_html, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 60000 });
  if (await page.evaluate(() => window.__failed)) throw new Error('Heart3D.create returned null — no WebGL2?');

  await page.screenshot({ path: OUT });
  await browser.close();

  if (errors.length) { console.error('errors:\n  ' + errors.join('\n  ')); process.exitCode = 1; }
  console.log('wrote ' + OUT);
})();
