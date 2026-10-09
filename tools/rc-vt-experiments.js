#!/usr/bin/env node
/*
 * Which way of quieting the outgoing screen keeps this WebKit alive through a
 * view transition? Run on the rc branch's Windows job, where the crash
 * reproduces on the synthetic build. Each variant prepares the home screen,
 * then calls startQuiz() and records whether the page survived. Counts only.
 *
 *   node tools/rc-vt-experiments.js <build.html> [--runs 2]
 */
'use strict';
const path = require('path');
const { webkit } = require('playwright');
const args = process.argv.slice(2);
const target = args.find(a => !a.startsWith('--'));
const runs = parseInt((args[args.indexOf('--runs') + 1]) || '2', 10) || 2;
const URL = 'file:///' + path.resolve(target).replace(/\\/g, '/');

const CANCEL_SCREEN = () => { const app = document.getElementById('app'), bar = document.getElementById('navbar');
  for (const a of document.getAnimations()) { const t = a.effect && a.effect.target; if (a.playState !== 'idle' && t && ((app && app.contains(t)) || (bar && bar.contains(t)))) a.cancel(); } };
const CANCEL_ALL = () => { for (const a of document.getAnimations()) if (a.playState !== 'idle') a.cancel(); };
const TWO_FRAMES = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const style = css => `(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s); })()`;
const ALL = '*,*::before,*::after';
const SCREEN = '#app,#app *,#app *::before,#app *::after,#navbar,#navbar *,#navbar *::before,#navbar *::after';

const VARIANTS = [
  ['a CSS animation:none everywhere (control)', style(`${ALL}{animation:none!important}`)],
  ['b cancel every animation, page-wide', `(${CANCEL_ALL})()`],
  ['c cancel #app/#navbar, then two frames', `(${CANCEL_SCREEN})(); await (${TWO_FRAMES})()`],
  ['d cancel page-wide, then two frames', `(${CANCEL_ALL})(); await (${TWO_FRAMES})()`],
  ['e CSS animation:none in #app/#navbar only', style(`${SCREEN}{animation:none!important}`)],
  ['f CSS transition:none everywhere only', style(`${ALL}{transition:none!important}`)],
];

(async () => {
  const b = await webkit.launch();
  console.log(`webkit ${b.version()} on ${process.platform}, ${path.basename(target)}, ${runs} run(s) per variant`);
  for (const [label, prep] of VARIANTS) {
    const out = [];
    for (let i = 0; i < runs; i++) {
      const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
      const p = await ctx.newPage(); let crashed = false; p.on('crash', () => { crashed = true; });
      await p.goto(URL, { waitUntil: 'load', timeout: 120000 }).catch(() => {});
      const home = await p.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), null, { timeout: 60000 }).then(() => true, () => false);
      await p.waitForTimeout(2000).catch(() => {});
      const left = await p.evaluate(`(async () => { ${prep}; const app = document.getElementById('app'), bar = document.getElementById('navbar'); const live = document.getAnimations().filter(a => a.playState !== 'idle'); const where = live.map(a => { const t = a.effect && a.effect.target; return t && ((app && app.contains(t)) || (bar && bar.contains(t))) ? 'in' : ((t ? (t.id ? '#' + t.id : t.tagName.toLowerCase()) : '?') + (a.effect && a.effect.pseudoElement || '') + ':' + (a.animationName || a.transitionProperty || a.constructor.name)); }); return live.length + (where.some(w => w !== 'in') ? ' [outside: ' + where.filter(w => w !== 'in').join(',') + ']' : ''); })()`).catch(e => 'prep failed');
      await p.evaluate(() => startQuiz(CHAPTERS[0], 'all')).catch(() => {});
      await p.waitForTimeout(4000).catch(() => {});
      const scr = crashed ? null : await p.evaluate(() => S.screen).catch(() => null);
      out.push(!home ? 'no home' : crashed ? `CRASHED(${left} left)` : `ok(${left} left, ${scr})`);
      await ctx.close().catch(() => {});
    }
    console.log(`  ${label.padEnd(44)} -> ${out.join(' | ')}`);
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
