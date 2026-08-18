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
/* Accepts a path (single-file build) or an http URL (the Stage 1 PWA
   build, which has to be served because it fetches its content). */
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  head('document order: the splash must not be waiting on the script it hides');
  /* Read the document as it is actually served, so this works against both the
     single-file build on disk and the Stage 1 shell over http. */
  const raw = /^https?:\/\//.test(target)
    ? await (await fetch(target)).text()
    : fs.readFileSync(target, 'utf8');
  const splashAt = raw.indexOf('<div id="splash"');
  /* Whichever way the content arrives — inline in the single file, or fetched
     by the Stage 1 loader — the splash has to come first. */
  const inlineAt = raw.indexOf('const ALL_Q=');
  const loaderAt = raw.indexOf("fetch('content/questions.json'");
  const bigScriptAt = inlineAt > -1 ? inlineAt : loaderAt;
  ok('splash markup appears before the question bank / main script',
     splashAt > -1 && bigScriptAt > -1 && splashAt < bigScriptAt,
     `splash@${splashAt} payload@${bigScriptAt} (${inlineAt > -1 ? 'inline' : 'fetched'})`);
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
    /* Record when each first appears rather than trying to catch the gap by
       polling. Racing it was fine against the 26 MB single file, where the gap
       is seconds wide; against the Stage 1 shell the app can render before the
       first poll comes back, and "I could not observe the gap" is not the same
       finding as "the splash was late". Ordering is the actual claim. */
    /* rAF rather than a MutationObserver: an init script runs before
       document.documentElement exists, so observing it throws and takes the
       rest of the init script with it. */
    await page.addInitScript(() => {
      window.__t = {};
      (function tick() {
        if (!window.__t.splash && document.getElementById('splash')) window.__t.splash = performance.now();
        if (!window.__t.app && document.querySelector('.hero-h1')) window.__t.app = performance.now();
        if (!window.__t.app) requestAnimationFrame(tick);
      })();
    });
    page.goto(URL, { waitUntil: 'commit' }).catch(() => {});
    await page.waitForSelector('#splash', { timeout: 30000 });
    await page.waitForFunction(() => window.__t && window.__t.app, { timeout: 120000 });
    const during = await page.evaluate(() => ({
      splashAt: Math.round(window.__t.splash),
      appAt: Math.round(window.__t.app),
      traceAnimated: !!document.querySelector('.sp-trace'),
    }));
    ok('the splash is on screen before the app renders',
       during.splashAt !== undefined && during.splashAt <= during.appAt,
       `splash@${during.splashAt}ms  app@${during.appAt}ms  (covered ${during.appAt - during.splashAt}ms)`);
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
  /* The Stage 1 build injects app.js only after its content fetch resolves,
     so 'load' no longer implies the app has booted. Wait for it explicitly —
     a no-op on the single-file build, where this is already true. */
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
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
  /* The Stage 1 build injects app.js only after its content fetch resolves,
     so 'load' no longer implies the app has booted. Wait for it explicitly —
     a no-op on the single-file build, where this is already true. */
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
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
