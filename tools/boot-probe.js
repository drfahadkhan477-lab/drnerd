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
                                    : 'file:///' + path.resolve(target).split(path.sep).join('/').replace(/^\/+/, '');

(async () => {
  /* launch() returns the browser, not a {browser, page} pair — the same shape
     tools/figure-probe.js uses three lines below its own call. Assumed rather
     than read, and it cost the owner a round trip on a laptop at midnight. */
  const browser = await launch();
  const page = await (await browser.newContext()).newPage();
  console.log(`Boot probe — ${engineName()}\n  ${target}\n`);

  /* Stamp the moment the hero exists, from inside the page, so the number is
     on the same clock as the navigation timings rather than Node's. */
  /* OBSERVES `document`, NOT `document.documentElement`. An init script runs at
     document-start, where documentElement is still null, so observing it threw
     and the stamp was never installed — the probe then waited two minutes for a
     value nothing was going to write. Document is always there. The interval is
     a second route to the same answer in case a MutationObserver is not, and
     Node has a third below, because an instrument that reports nothing is
     worse than a crude number. */
  await page.addInitScript(() => {
    window.__heroAt = null;
    const stamp = () => {
      if (window.__heroAt === null && document.querySelector('.hero-h1')) {
        window.__heroAt = performance.now();
        return true;
      }
      return false;
    };
    try { new MutationObserver(stamp).observe(document, { childList: true, subtree: true }); }
    catch (_) { /* the interval below is the fallback */ }
    const tick = setInterval(() => { if (stamp()) clearInterval(tick); }, 30);
  });

  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  /* Wait on the DOM condition verify-stage0 itself waits on — proven to work
     against this build — rather than on the stamp, so a stamp that failed to
     install costs precision and not the whole reading. */
  await page.waitForFunction(() => !!document.querySelector('.hero-h1'), null, { timeout: 120000 });
  const wallMs = Date.now() - t0;
  const heroFallback = await page.evaluate(() => performance.now());

  const t = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    return {
      responseEnd: nav.responseEnd || 0,
      domInteractive: nav.domInteractive || 0,
      domContentLoaded: nav.domContentLoadedEventEnd || 0,
      loadEvent: nav.loadEventEnd || 0,
      heroAt: window.__heroAt,
      stamped: window.__heroAt !== null,
      bytes: (performance.getEntriesByType('resource')[0] || {}).transferSize || 0,
    };
  });

  /* The stamp is the moment the hero appeared; the fallback is the moment Node
     noticed, which is later by a poll interval and an RPC. Say which is being
     reported rather than presenting one as the other. */
  const heroAt = t.stamped ? t.heroAt : heroFallback;

  const row = (label, ms, note) =>
    console.log('  ' + label.padEnd(26) + (ms / 1000).toFixed(2).padStart(7) + 's' +
                (note ? '   ' + note : ''));

  row('bytes to first byte', t.responseEnd);
  row('fetch + parse', t.domInteractive, 'navigationStart → domInteractive');
  row('to hero', Math.max(0, heroAt - t.domInteractive), 'domInteractive → hero on screen');
  console.log('  ' + '─'.repeat(44));
  row('hero, on the page clock', heroAt,
      t.stamped ? 'stamped when it appeared' : 'measured when node noticed — slightly late');
  row('wall clock in node', wallMs, 'what verify-stage0 asserts on');

  const share = heroAt > 0 ? Math.round(t.domInteractive / heroAt * 100) : 0;
  console.log(`\n  ${share}% of the time to hero is fetch and parse.`);
  console.log('  Everything after domInteractive is the app\'s own boot.\n');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
