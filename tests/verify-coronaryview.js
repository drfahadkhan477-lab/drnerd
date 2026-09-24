#!/usr/bin/env node
/*
 * The Coronary view in Rhythm Lab: does what it DRAWS say what the
 * physiology says?
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-coronaryview.js
 *
 * Takes no build. It loads this repository's own src/core/physio.js,
 * src/ui/coronaryTree.js and src/ui/wiggers.js into a real browser, mounts
 * the diagram on the Coronary view, and measures the canvas. verify-physio
 * holds the view's chip and its mounting in the built app; this holds what
 * the view shows, which nothing else can see.
 *
 * WHAT IS MEASURED. How much ink each tree puts on the paper at a systolic
 * instant and a diastolic one — the mean darkening of its region against the
 * blank page. Brightness is drawn as the tree's opacity, so more flow is more
 * ink. Four propositions, each one physiology rather than pixels:
 *
 *   the left tree fades in systole     the LV compresses its own arteries
 *   the right tree does not            RV pressure stays low
 *   in systole, right outshines left   the same fact, side by side
 *   in diastole the two are comparable the two flows ARE comparable then
 *
 * THE LAST IS THE ONE THAT CATCHES A SCALING MISTAKE. drawCoronary puts both
 * trees on one scale. Normalised each to its own range instead, the right
 * tree's small swing is stretched to full range: in diastole the left would
 * read 100% and the right about 40%, a picture that says the right coronary
 * nearly stops in diastole. The other three would still pass.
 *
 * WHAT THIS CANNOT SAY: whether the view sits correctly inside the built Lab
 * panel — its chip, its note, its theme. verify-physio holds those.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { launch, isEngineNoise } = require('./_engine');
const { onDeath } = require('./_deathnote.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

const ROOT = path.join(__dirname, '..');
const src = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#fff} canvas{width:880px;height:500px;display:block}
</style></head><body><canvas id="c"></canvas>
<script>${src('src/core/physio.js')}</script>
<script>${src('src/ui/coronaryTree.js')}</script>
<script>${src('src/ui/wiggers.js')}</script>
</body></html>`;

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 880, height: 500 }, deviceScaleFactor: 1 });
  const errors = [];
  onDeath(() => ({ section, checks: passed + failed, errors }));
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 120)));
  page.on('console', m => { if (m.type() === 'error' && !isEngineNoise(m.text())) errors.push(m.text().slice(0, 120)); });
  await page.setContent(PAGE);

  head('the view is there');
  const mounted = await page.evaluate(() => {
    const has = !!(window.Wiggers && window.Physio && window.CoronaryTree);
    const listed = has && Wiggers.VIEWS.some(v => v.id === 'coronary');
    if (!has) return { has, listed, w: false };
    window.w = Wiggers.mount(document.getElementById('c'), { view: 'coronary', playing: false });
    if (window.w) window.w.stop();
    return { has, listed, w: !!window.w, view: window.w ? window.w.view() : null };
  });
  ok('Wiggers lists a coronary view', mounted.listed);
  ok('and mounts on it', mounted.w && mounted.view === 'coronary', String(mounted.view));

  /* Mean ink in a rectangle: how far the region darkens from blank paper. The
     regions are the thirds of the tree area either side, above the labels. */
  const inkAt = t => page.evaluate(t => {
    if (!window.w) return null;
    w.setTime(t);
    const c = document.getElementById('c'), g = c.getContext('2d');
    const region = (x0, x1) => {
      const d = g.getImageData(x0, 40, x1 - x0, 250).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += 255 - (d[i] + d[i + 1] + d[i + 2]) / 3;
      return s / (d.length / 4);
    };
    return { left: region(90, 390), right: region(490, 790) };
  }, t);

  const T = await page.evaluate(() => window.Physio ? { mc: Physio.T.mc, ac: Physio.T.ac } : null);
  const sys = T ? await inkAt((T.mc + T.ac) / 2) : null;
  const dia = T ? await inkAt(0.8) : null;
  const f = v => (v == null ? '-' : v.toFixed(2));

  head('what it draws is the physiology');
  ok('both trees are drawn at all', !!sys && !!dia && sys.left > 0.3 && sys.right > 0.3 && dia.left > 0.3,
     sys && dia ? `ink sys L ${f(sys.left)} R ${f(sys.right)}, dia L ${f(dia.left)} R ${f(dia.right)}` : 'no reading');
  ok('the left tree fades in systole — the LV compresses its own arteries',
     !!sys && !!dia && sys.left < dia.left * 0.6, sys && dia ? `sys ${f(sys.left)} vs dia ${f(dia.left)}` : '-');
  ok('the right tree does not — RV pressure stays low',
     !!sys && !!dia && sys.right >= dia.right * 0.9, sys && dia ? `sys ${f(sys.right)} vs dia ${f(dia.right)}` : '-');
  ok('in systole the right outshines the left',
     !!sys && sys.right > sys.left * 1.5, sys ? `R ${f(sys.right)} vs L ${f(sys.left)}` : '-');
  ok('in diastole the two are comparable, because the flows are — one scale for both',
     !!dia && dia.left / dia.right > 0.75 && dia.left / dia.right < 1.33,
     dia ? `L/R ${f(dia.left / dia.right)}` : '-');

  head('and nothing broke');
  ok('no page or console error', errors.length === 0, errors.slice(0, 2).join(' | ') || 'clean');

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
