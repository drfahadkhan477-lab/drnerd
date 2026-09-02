'use strict';
/*
 * Which engine a suite runs in — a parameter, not a constant.
 *
 *   SYSTOLE_ENGINE=webkit node tests/verify-home.js build/systole.html
 *   node scripts/verify.js --engine webkit
 *
 * WHY THIS EXISTS. Every one of the browser suites opened with
 * `const { chromium } = require('playwright')` and `chromium.launch()`. That
 * is thirty-four independent decisions to test one engine, none of them
 * deliberate — each was copied from the suite written before it. The app's
 * actual target is an iPad, which is WebKit; Blink was never the engine that
 * mattered most, it was the engine that was easy. Routing the launch through
 * here makes the choice one line instead of thirty-four, so running the whole
 * suite on WebKit costs a flag rather than a refactor.
 *
 * It does NOT claim the suites pass on WebKit. Nobody has run them there yet
 * (see docs/BUILD.md); this removes the obstacle to finding out, and finding
 * out is a separate piece of work with its own failures to fix.
 *
 * Chromium stays the default deliberately. Changing what `npm test` means as
 * a side effect of making the engine configurable would be exactly the kind
 * of silent behaviour change the patch chain's exact-match rule exists to
 * prevent.
 */

/* The three Playwright ships. Kept as an explicit list rather than trusting
   whatever property name is handed in: `require('playwright')[name]` with an
   unvalidated `name` is a typo away from `undefined.launch()`, and the
   resulting "cannot read properties of undefined" says nothing about what
   actually went wrong. */
const ENGINES = ['chromium', 'webkit', 'firefox'];

const DEFAULT_ENGINE = 'chromium';

/* The engine this run wants. Read from the environment rather than argv
   because every suite already treats argv[2] as the build under test, and
   teaching thirty-four of them a second positional shape is how you get a
   suite that silently tests the string "--engine". */
function engineName() {
  const raw = String(process.env.SYSTOLE_ENGINE || DEFAULT_ENGINE).trim().toLowerCase();
  if (!ENGINES.includes(raw)) {
    throw new Error(
      `SYSTOLE_ENGINE=${JSON.stringify(raw)} is not an engine. Use one of: ${ENGINES.join(', ')}.`
    );
  }
  return raw;
}

/* Flags that only Blink understands. Playwright hands `args` to the browser
   process verbatim, so passing a Chromium switch to WebKit is at best ignored
   and at worst a refusal to start — and a suite that cannot launch reports
   zero checks, which reads as a harness problem rather than the engine
   difference it is. Dropped rather than translated: there is no WebKit
   equivalent of --enable-precise-memory-info, and the one caller already
   guards on `performance.memory` being absent. */

/* Returned rather than applied so the stripping can be asserted without
   starting a browser — the whole point of a pure suite. */
function launchOptions(opts = {}, name = engineName()) {
  const o = { ...opts };
  if (name !== 'chromium') delete o.args;
  return o;
}

function launch(opts = {}) {
  const name = engineName();
  const playwright = require('playwright');
  return playwright[name].launch(launchOptions(opts, name));
}

module.exports = { ENGINES, DEFAULT_ENGINE, engineName, launchOptions, launch };
