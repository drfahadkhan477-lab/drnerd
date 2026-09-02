#!/usr/bin/env node
/*
 * render() throwing must never leave a blank screen.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-failsafe.js /path/to/build.html
 *
 * The failure this guards against never announces itself in a normal run —
 * render() only throws when something upstream is already wrong, which is
 * exactly when a fellow needs a real message instead of silence. So every
 * assertion here works by deliberately sabotaging a throwaway copy of the
 * build first — never mutating the target file itself — then checking the
 * crash screen appears where it must, and stays out of the way where it
 * mustn't. A check against the unmodified build alone would prove nothing:
 * it would pass whether or not the circuit breaker was ever wired in.
 *
 * A METHODOLOGY NOTE worth keeping. The first draft of this suite checked
 * `document.body.textContent.includes('Something went wrong')` and it
 * PASSED on a normal boot with no crash at all — because `.textContent`
 * recurses into `<script>` elements, and that string is also just a literal
 * inside showCrashScreen()'s own source, which sits in the page's inline
 * script the whole time regardless of whether the function ever runs. Any
 * text search against the page as a whole will find its own source code.
 * The fix is to assert on something only the CRASH SCREEN'S OWN DOM
 * produces — a `button[onclick="location.reload()"]` inside `#app` — never
 * on rendered text that a `<script>` tag's source could also contain.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch } = require('./_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-failsafe.js <patched.html>'); process.exit(1); }
const SRC_PATH = path.resolve(target);
const URL = 'file://' + SRC_PATH;

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'failsafe-'));
const sabotaged = (label, transform) => {
  let html = fs.readFileSync(SRC_PATH, 'utf8');
  const before = html;
  html = transform(html);
  if (html === before) throw new Error(`[${label}] sabotage did not match — the code it targets may have moved`);
  const p = path.join(DIR, label.replace(/[^a-z0-9]+/gi, '-') + '.html');
  fs.writeFileSync(p, html);
  return 'file://' + p;
};
const crashButton = () => !!(document.getElementById('app') &&
  document.getElementById('app').querySelector('button[onclick="location.reload()"]'));

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  const browser = await launch();

  head('the real build boots clean — no false positives from the breaker itself');
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 60000 });
    const crash = await page.evaluate(crashButton);
    ok('no page errors on a normal boot', errors.length === 0, errors.slice(0, 3).join(' | '));
    ok('the crash screen never appears on a normal boot', !crash);
    await page.close();
  }

  head('renderNow() throwing on the plain path shows the crash screen, not a blank #app');
  {
    const url = sabotaged('rendernow-sync', h =>
      h.replace('function renderNow(){\n', 'function renderNow(){\n  throw new Error("INJECTED_TEST_FAILURE");\n'));
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const app = document.getElementById('app');
      return {
        crash: !!(app && app.querySelector('button[onclick="location.reload()"]')),
        appHasContent: !!(app && app.firstElementChild),
      };
    });
    ok('the crash screen is shown', r.crash);
    ok('#app is not left empty', r.appHasContent);
    await page.close();
  }

  head('renderNow() throwing on the view-transition path is caught too, not left as an unhandled rejection');
  {
    const url = sabotaged('rendernow-vt', h => {
      h = h.replace('let lastScreen=null;', 'let lastScreen="__not_a_real_screen__";');
      return h.replace('function renderNow(){\n', 'function renderNow(){\n  throw new Error("INJECTED_VT_FAILURE");\n');
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(1200);
    const crash = await page.evaluate(crashButton);
    ok('the crash screen appears when the throw happens inside startViewTransition\'s own callback', crash);
    await page.close();
  }

  head('an uncaught error unrelated to rendering, after a real screen is already up, does not take the screen over');
  {
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 60000 });
    await page.evaluate(() => {
      window.dispatchEvent(new ErrorEvent('error', { error: new Error('unrelated'), message: 'unrelated' }));
    });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const app = document.getElementById('app');
      return {
        crash: !!(app && app.querySelector('button[onclick="location.reload()"]')),
        heroStillThere: !!document.querySelector('.hero-h1'),
      };
    });
    ok('no crash takeover from an error the app already recovered from elsewhere', !r.crash);
    ok('the real screen already on-screen is untouched', r.heroStillThere);
    await page.close();
  }

  await browser.close();
  fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
