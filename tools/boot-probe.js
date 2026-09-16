#!/usr/bin/env node
/*
 * Where does the launch time actually go?
 *
 *   node tools/boot-probe.js build/systole.html
 *   node tools/boot-probe.js http://localhost:8080        # the split build
 *
 * WHY THIS EXISTS. verify-stage0 asserts "launches without stalling" as
 *
 *     ok('launches without stalling', launchMs < 5000)
 *
 * where launchMs spans page.goto() to the hero being on screen. On a 42 MB
 * single file that interval is mostly the browser reading and parsing 42 MB,
 * which the app does not control and which differs by machine: the same build
 * reports 2-3s on the box the 5000 was calibrated on and 6.0-6.1s on the
 * owner's Windows laptop, 10.5s when the rest of the suite is competing for
 * the disk.
 *
 * That is one number covering two different things, and a threshold over it
 * cannot distinguish "this build stalls" from "this machine is slower than the
 * one nobody wrote down". Raising it to fit the laptop would make it mean even
 * less. So before changing anything, measure where the time goes — on whatever
 * machine is asking.
 *
 * WHAT IT PRINTS, from the page's own Performance timeline rather than a
 * stopwatch in Node:
 *
 *   fetch+parse   navigationStart → domInteractive: the browser getting
 *                 through the document. Proportional to file size.
 *   to hero       domInteractive → the hero heading existing. The app's own
 *                 boot: modules initialising, first render, whatever it does
 *                 before it can show you anything.
 *   total         the number verify-stage0 currently asserts on.
 *
 * It asserts nothing and exits 0 whatever it finds. This is an instrument, not
 * a gate — it exists to tell the person changing the gate what they are
 * looking at.
 */
'use strict';
const path = require('path');
const { launch, engineName } = require('../tests/_engine.js');

const target = process.argv[2];
if (!target) {
  console.error('usage: node tools/boot-probe.js <build/systole.html | http://host:port>');
  process.exit(1);
}
const URL = /^https?:/.test(target) ? target
                                    : 'file://' + path.resolve(target).split(path.sep).join('/');

(async () => {
  const { browser, page } = await launch();
  console.log(`Boot probe — ${engineName()}\n  ${target}\n`);

  /* Stamp the moment the hero exists, from inside the page, so the number is
     on the same clock as the navigation timings rather than Node's. */
  await page.addInitScript(() => {
    window.__heroAt = null;
    const stamp = () => {
      if (window.__heroAt === null && document.querySelector('.hero-h1')) {
        window.__heroAt = performance.now();
        return true;
      }
      return false;
    };
    if (document.readyState !== 'loading') stamp();
    new MutationObserver(() => { if (stamp()) { /* keep observing is harmless */ } })
      .observe(document.documentElement, { childList: true, subtree: true });
  });

  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => window.__heroAt !== null, null, { timeout: 120000 });
  const wallMs = Date.now() - t0;

  const t = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    return {
      responseEnd: nav.responseEnd || 0,
      domInteractive: nav.domInteractive || 0,
      domContentLoaded: nav.domContentLoadedEventEnd || 0,
      loadEvent: nav.loadEventEnd || 0,
      heroAt: window.__heroAt,
      bytes: (performance.getEntriesByType('resource')[0] || {}).transferSize || 0,
    };
  });

  const row = (label, ms, note) =>
    console.log('  ' + label.padEnd(26) + (ms / 1000).toFixed(2).padStart(7) + 's' +
                (note ? '   ' + note : ''));

  row('bytes to first byte', t.responseEnd);
  row('fetch + parse', t.domInteractive, 'navigationStart → domInteractive');
  row('to hero', Math.max(0, t.heroAt - t.domInteractive), 'domInteractive → hero on screen');
  console.log('  ' + '─'.repeat(44));
  row('hero, on the page clock', t.heroAt);
  row('wall clock in node', wallMs, 'what verify-stage0 asserts on');

  const share = t.heroAt > 0 ? Math.round(t.domInteractive / t.heroAt * 100) : 0;
  console.log(`\n  ${share}% of the time to hero is fetch and parse.`);
  console.log('  Everything after domInteractive is the app\'s own boot.\n');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
