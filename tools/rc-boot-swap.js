#!/usr/bin/env node
/*
 * The six suites still crashed on Windows WebKit with the two-frame fix,
 * though tools/rc-webkit-probe.js (which waits a second on home) no longer
 * does. verify-type opens a quiz the moment boot finishes. This repeats that
 * timing and records, at the instant startViewTransition is called, every
 * live animation: inside #app/#navbar or not, named. Then the same with
 * stillOutgoing() widened to the whole page. Counts and names only.
 *
 *   node tools/rc-boot-swap.js <build.html> [--runs 2]
 */
'use strict';
const path = require('path');
const { webkit } = require('playwright');
const args = process.argv.slice(2);
const target = args.find(a => !a.startsWith('--'));
const runs = parseInt((args[args.indexOf('--runs') + 1]) || '2', 10) || 2;
const URL = 'file:///' + path.resolve(target).replace(/\\/g, '/');

const INSTRUMENT = () => {
  const orig = Document.prototype.startViewTransition;
  if (!orig) return;
  window.__atSwap = [];
  Document.prototype.startViewTransition = function (cb) {
    const app = document.getElementById('app'), bar = document.getElementById('navbar');
    const live = document.getAnimations().filter(a => a.playState !== 'idle').map(a => {
      const t = a.effect && a.effect.target;
      const inScreen = t && ((app && app.contains(t)) || (bar && bar.contains(t)));
      const name = t ? (t.id ? '#' + t.id : t.tagName.toLowerCase() + (typeof t.className === 'string' && t.className ? '.' + t.className.split(' ')[0] : '')) : '?';
      return (inScreen ? 'in ' : 'OUT ') + name + (a.effect && a.effect.pseudoElement || '') + ':' + (a.animationName || a.transitionProperty || a.constructor.name) + ':' + a.playState;
    });
    window.__atSwap.push(live);
    return orig.call(this, cb);
  };
};
const WIDEN = () => {
  window.stillOutgoing = function () { for (const a of document.getAnimations()) if (a.playState !== 'idle') a.cancel(); };
};

(async () => {
  const b = await webkit.launch();
  console.log(`webkit ${b.version()} on ${process.platform}, ${path.basename(target)}`);
  for (const [label, widen] of [['as built, quiz at boot', false], ['stillOutgoing page-wide, quiz at boot', true]]) {
    for (let i = 1; i <= runs; i++) {
      const p = await b.newPage({ viewport: { width: 1280, height: 1000 } });
      let crashed = false; p.on('crash', () => { crashed = true; });
      await p.addInitScript(INSTRUMENT);
      await p.goto(URL, { waitUntil: 'load', timeout: 120000 }).catch(() => {});
      await p.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), null, { timeout: 60000 }).catch(() => {});
      if (widen) await p.evaluate(WIDEN).catch(() => {});
      await p.evaluate(() => startQuiz(null)).catch(() => {});
      let swaps = null;
      for (let k = 0; k < 20 && !crashed; k++) { swaps = await p.evaluate(() => window.__atSwap).catch(() => swaps); if (swaps && swaps.length) break; await p.waitForTimeout(100).catch(() => {}); }
      await p.waitForTimeout(3000).catch(() => {});
      const scr = crashed ? null : await p.evaluate(() => S.screen).catch(() => null);
      const at = swaps && swaps[0] ? swaps[0] : null;
      const outside = at ? at.filter(x => x.startsWith('OUT')) : [];
      console.log(`  ${label}, run ${i}: ${crashed ? 'PAGE CRASHED' : 'alive (' + scr + ')'}; at the swap: ${at ? at.length + ' live, ' + (at.length - outside.length) + ' in screen' : 'no transition seen'}${outside.length ? '; outside: ' + outside.join(', ') : ''}`);
      await p.close().catch(() => {});
    }
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
