#!/usr/bin/env node
/*
 * Does the first screen change crash this WebKit, with view transitions left
 * on? For the `rc` branch's Windows job (.github/workflows/rc-windows.yml),
 * which expects a crash: it uses raw Playwright, not tests/_engine.js, so the
 * harness's switch (startViewTransition taken away in WebKit) is not applied.
 *
 *   node tools/rc-webkit-probe.js <build.html> --expect crash|ok [--runs 3]
 *
 * WHY. If this stops crashing, the WebKit has been fixed and the harness's
 * switch can go: the step fails and says so, rather than the switch staying
 * on long after the reason for it.
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
    if (crashes > 0) { console.log('PASS  with transitions on, this WebKit still crashes: the harness switch is still needed'); process.exit(0); }
    console.log('FAIL  with transitions on, this WebKit no longer crashes here: the harness switch in tests/_engine.js may be retired');
    process.exit(1);
  }
  if (crashes === 0 && reachedQuiz === runs) { console.log('PASS  no crash, and every run reached the quiz'); process.exit(0); }
  console.log('FAIL  the build as committed still crashed or did not reach the quiz');
  process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
