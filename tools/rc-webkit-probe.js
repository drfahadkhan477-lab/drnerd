#!/usr/bin/env node
/*
 * Does the first screen change crash this WebKit? For the `rc` branch's
 * Windows job (.github/workflows/rc-windows.yml), which runs it twice: on a
 * control build with render()'s stillOutgoing() call removed, expecting a
 * crash, and on the build as committed, expecting none.
 *
 *   node tools/rc-webkit-probe.js <build.html> --expect crash|ok [--runs 3]
 *
 * WHY A CONTROL. On the owner's Windows machine, Playwright 1.63's WebKit
 * (26.6) crashed the page on every first screen change of the real build:
 * a view transition tearing down layers mid-animation. Linux WebKit never
 * crashed on the same suites. If the synthetic build on this runner does not
 * crash either, a clean run of the fixed build proves nothing, and this says
 * so by failing the control step instead of letting the job go green.
 *
 * Prints counts and states only: the build is synthetic, but the habit holds.
 */
'use strict';
const path = require('path');
const { webkit } = require('playwright');

const args = process.argv.slice(2);
const target = args.find(a => !a.startsWith('--'));
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const expect = opt('--expect', '');
const runs = Math.max(1, parseInt(opt('--runs', '3'), 10) || 3);
if (!target || !['crash', 'ok'].includes(expect)) {
  console.error('usage: node tools/rc-webkit-probe.js <build.html> --expect crash|ok [--runs N]');
  process.exit(2);
}
const URL = 'file:///' + path.resolve(target).replace(/\\/g, '/');

(async () => {
  const b = await webkit.launch();
  console.log(`webkit ${b.version()} on ${process.platform}, ${path.basename(target)}, expecting ${expect}, ${runs} run(s)`);
  let crashes = 0, booted = 0, reachedQuiz = 0;
  for (let i = 1; i <= runs; i++) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    let crashed = false; p.on('crash', () => { crashed = true; });
    await p.goto(URL, { waitUntil: 'load', timeout: 120000 }).catch(() => {});
    const home = await p.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), null, { timeout: 60000 })
      .then(() => true, () => false);
    if (home) booted++;
    await p.waitForTimeout(1000).catch(() => {});
    const running = await p.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length).catch(() => null);
    await p.evaluate(() => startQuiz(CHAPTERS[0], 'all')).catch(() => {});
    await p.waitForTimeout(5000).catch(() => {});
    const screen = crashed ? null : await p.evaluate(() => S.screen).catch(() => null);
    if (crashed) crashes++;
    if (screen === 'quiz') reachedQuiz++;
    console.log(`  run ${i}: home ${home ? 'up' : 'NOT up'}, ${running} animations running before the change -> ${crashed ? 'PAGE CRASHED' : 'alive'}, screen after: ${screen}`);
    await ctx.close().catch(() => {});
  }
  await b.close();
  console.log(`  ${crashes} of ${runs} crashed; ${reachedQuiz} reached the quiz; home came up in ${booted}`);
  /* A run that never reached home measured nothing: neither verdict holds. */
  if (booted < runs) { console.log('FAIL  the home screen did not come up in every run, so nothing was measured'); process.exit(1); }
  if (expect === 'crash') {
    if (crashes > 0) { console.log('PASS  the control crashes here, so a clean run of the fixed build means something'); process.exit(0); }
    console.log('FAIL  the control did not crash on this runner: this job cannot show the fix, and its other steps prove nothing about it');
    process.exit(1);
  }
  if (crashes === 0 && reachedQuiz === runs) { console.log('PASS  no crash, and every run reached the quiz'); process.exit(0); }
  console.log('FAIL  the build as committed still crashed or did not reach the quiz');
  process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
