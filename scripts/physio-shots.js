#!/usr/bin/env node
/*
 * Contact sheet for the physiology views.
 *
 *   NODE_PATH=$(npm root -g) node scripts/physio-shots.js [out.png]
 *
 * A diagram is the one thing that cannot be checked by reading its source: the
 * numbers were verified in Node, but whether a label lands on top of a trace,
 * or an axis runs off the panel, is only visible once it is drawn. So it gets
 * drawn, in both themes, and looked at.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');

const OUT = process.argv[2] || path.join(os.tmpdir(), 'physio-sheet.png');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SRC = ['src/core/leads12.js', 'src/core/physio.js', 'src/ui/wiggers.js'].map(read).join('\n');

const VIEWS = ['wiggers', 'pv', 'flow', 'right', 'curves'];
const CELL_W = 760, CELL_H = 520;

const page_html = dark => `<!doctype html><meta charset=utf-8>
<style>
  :root{--card:${dark ? '#0F1826' : '#FFFFFF'};--text:${dark ? '#E7EDF5' : '#0F172A'};
        --muted:${dark ? '#9AA9BC' : '#475569'};--dim:${dark ? '#6B7C93' : '#94A3B8'};
        --teal:${dark ? '#2DD4BF' : '#0D9488'}}
  html,body{margin:0;background:${dark ? '#0A111C' : '#F1F5F9'};font-family:system-ui}
  .grid{display:grid;grid-template-columns:repeat(2,${CELL_W}px);gap:16px;padding:16px}
  .cell{background:var(--card);border-radius:12px;overflow:hidden;
        box-shadow:0 1px 3px rgba(0,0,0,.2)}
  .lab{font:700 12px ui-monospace,monospace;color:var(--muted);padding:8px 12px 0}
  canvas{width:${CELL_W}px;height:${CELL_H}px;display:block}
</style>
<div class="grid" id="g"></div>
<script>${SRC}</script>
<script>
  window.__ready = false;
  const g = document.getElementById('g');
  const views = ${JSON.stringify(VIEWS)};
  window.__w = [];
  for (const v of views) {
    const d = document.createElement('div'); d.className = 'cell';
    d.innerHTML = '<div class="lab">' + v + '</div>';
    const c = document.createElement('canvas'); d.appendChild(c); g.appendChild(d);
    const w = Wiggers.mount(c, { view: v, dark: ${dark}, hr: 75, playing: false });
    w.setTime(0.30);
    window.__w.push(w);
  }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.__w.forEach(w => w.draw());
    window.__ready = true;
  }));
</script>`;

(async () => {
  const browser = await chromium.launch();
  const shots = [];
  for (const dark of [false, true]) {
    const page = await browser.newPage({
      viewport: { width: CELL_W * 2 + 48, height: Math.ceil(VIEWS.length / 2) * (CELL_H + 40) + 32 },
      deviceScaleFactor: 2,
    });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.setContent(page_html(dark), { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready, { timeout: 20000 });
    await page.waitForTimeout(250);
    const file = OUT.replace(/\.png$/, (dark ? '-dark' : '-light') + '.png');
    await page.screenshot({ path: file, fullPage: true });
    shots.push(file);
    if (errs.length) { console.error('ERRORS (' + (dark ? 'dark' : 'light') + '):'); errs.forEach(e => console.error('  ' + e)); }
    else console.log((dark ? 'dark ' : 'light') + ': no console or page errors');
    await page.close();
  }
  await browser.close();
  shots.forEach(s => console.log('written: ' + s));
})();
