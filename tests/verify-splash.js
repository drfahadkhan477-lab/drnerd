#!/usr/bin/env node
/*
 * Behavioural checks for the startup pass.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-splash.js /path/to/patched.html
 *
 * The claim being tested is not "a splash element exists" — it is that the
 * splash is on screen during the window where the app is not, and gone
 * afterwards. So the checks that matter here are the timing ones: the splash
 * markup has to precede the script in the document, and it has to be visible
 * at a point when the app still has not rendered.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-splash.js <patched.html>'); process.exit(1); }
const URL = 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  head('document order: the splash must not be waiting on the script it hides');
  const raw = fs.readFileSync(target, 'utf8');
  const splashAt = raw.indexOf('<div id="splash"');
  const bigScriptAt = raw.indexOf('const ALL_Q=');
  ok('splash markup appears before the question bank / main script',
     splashAt > -1 && bigScriptAt > -1 && splashAt < bigScriptAt,
     `splash@${splashAt} script@${bigScriptAt}`);
  ok('splash never intercepts input', /#splash\{[^}]*pointer-events:none/.test(raw));
  ok('theme is adopted from storage before the splash paints',
     raw.indexOf("accsap12.v2") < splashAt && /_t&&_t!=='auto'/.test(raw));
  ok('the loading screen does not depend on Heart3D',
     !/id="splash"[\s\S]{0,900}Heart3D/.test(raw));

  const browser = await chromium.launch();

  head('the splash covers the blank window, on a throttled CPU');
  {
    const page = await browser.newPage({ viewport: { width: 834, height: 1112 } });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    /* Do not wait for load: the whole point is to look at the screen while
       the script is still parsing. domcontentloaded would also be too late. */
    page.goto(URL, { waitUntil: 'commit' }).catch(() => {});
    await page.waitForSelector('#splash', { timeout: 30000 });
    const during = await page.evaluate(() => {
      const sp = document.getElementById('splash');
      return {
        splashVisible: !!sp && getComputedStyle(sp).visibility !== 'hidden' && !sp.classList.contains('gone'),
        appRendered: !!document.querySelector('.hero-h1'),
        traceAnimated: !!document.querySelector('.sp-trace'),
      };
    });
    ok('splash is up while the app has not rendered yet',
       during.splashVisible && !during.appRendered, JSON.stringify(during));
    ok('the rhythm strip is present on it', during.traceAnimated);

    await page.waitForFunction(() => !!document.querySelector('.hero-h1'), { timeout: 120000 });
    await page.waitForTimeout(1400);
    const after = await page.evaluate(() => ({
      splashGone: !document.getElementById('splash'),
      appRendered: !!document.querySelector('.hero-h1'),
    }));
    ok('splash is removed from the DOM once the app is up', after.splashGone, JSON.stringify(after));
    ok('the app is what is left behind', after.appRendered);
    await page.close();
  }

  head('theme handover: no flash of the wrong theme');
  {
    const page = await browser.newPage({ viewport: { width: 834, height: 1112 } });
    await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
    await page.evaluate(() => { S.theme = 'dark'; applyTheme(); save(); });
    await page.reload({ waitUntil: 'commit' });
    await page.waitForSelector('#splash', { timeout: 30000 });
    const early = await page.evaluate(() => ({
      attr: document.documentElement.getAttribute('data-theme'),
      appRendered: !!document.querySelector('.hero-h1'),
    }));
    ok('a saved dark theme is already on the root element while the splash shows',
       early.attr === 'dark', JSON.stringify(early));
    await page.close();
  }

  head('the beating hero layer');
  {
    const page = await browser.newPage({ viewport: { width: 834, height: 1112 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });
    await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
    await page.waitForTimeout(2200);
    const hero = await page.evaluate(() => {
      const el = document.querySelector('.hero-live');
      if (!el) return { found: false };
      const cs = getComputedStyle(el, '::after');
      return { found: true, anim: cs.animationName, dur: cs.animationDuration, z: cs.zIndex };
    });
    ok('hero carries the heartbeat layer', hero.found && hero.anim === 'heroBeat', JSON.stringify(hero));
    ok('it beats at roughly 68 bpm', hero.dur === '1.76s', hero.dur);
    ok('it sits behind the trace, not over it', hero.z === '-1', hero.z);

    /* The rule that keeps this a study tool: no ambient animation behind
       reading. If a future change puts one there, this should fail. */
    const quiet = await page.evaluate(() => {
      startQuiz('Arrhythmias'); render();
      const card = document.querySelector('.q-card');
      if (!card) return { noCard: true };
      const bad = [];
      for (const el of [card, ...card.querySelectorAll('*')]) {
        for (const pe of ['', '::before', '::after']) {
          const n = getComputedStyle(el, pe || undefined).animationName;
          if (n && n !== 'none' && /beat|aurora|pulse/i.test(n)) bad.push(el.className + pe + ':' + n);
        }
      }
      return { bad };
    });
    ok('no ambient background animation behind the question stem',
       quiet.bad && quiet.bad.length === 0, JSON.stringify(quiet.bad || quiet));
    ok('no console or page errors across the run', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
