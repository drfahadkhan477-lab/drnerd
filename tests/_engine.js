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
 * THEY HAVE NOW BEEN RUN THERE, and finding out cost what it usually costs:
 * a WebGL context leak Chromium had been absorbing quietly, three suites that
 * could not start at all because they asked for a Chrome DevTools Protocol
 * session, and one heap budget that passed by measuring nothing. None of
 * those were WebKit being difficult. WebKit was the engine that said so.
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

/* -- capabilities that are Chromium's, not the web's -------------------------
   Emulation.setCPUThrottlingRate and HeapProfiler.collectGarbage are Chrome
   DevTools Protocol calls. Playwright refuses newCDPSession outright on any
   other engine — "CDP session is only available in Chromium" — and three
   suites called it directly, so on WebKit they threw mid-run and printed no
   summary at all. The runner shows that as "did not report", which says
   nothing about the cause; it took a browser to find out.

   Both return whether they took effect rather than throwing or pretending,
   because the two honest failures here are opposite and equally bad: a check
   that dies on an engine it could mostly have run, and a check that passes
   because the thing it measures is unavailable and therefore reads as zero. */
async function cpuThrottle(page, rate) {
  if (engineName() !== 'chromium') return false;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  return true;
}

/* Resolves to a heap size in bytes, or null where the engine cannot say.
   NULL IS THE POINT. performance.memory is also Chromium-only, so a caller
   that read it directly on WebKit got `undefined`, coalesced it to 0, and
   compared 0 against a budget — a heap check that reports green precisely
   where it measured nothing. */
async function heapUsedBytes(page) {
  if (engineName() !== 'chromium') return null;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const n = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : null));
  return typeof n === 'number' ? n : null;
}

/* -- console noise that is the engine talking, not the app ------------------
   Twenty-five suites carried their own copy of
   /GroupMarker|GL Driver|swiftshader/ — the same copy-paste that had all of
   them calling chromium.launch(), one level up. It is here now so that adding
   an engine's quirk is one edit rather than twenty-five.

   WHY WEBKIT GETS ONE MORE. "There are too many active WebGL contexts on this
   page, the oldest context will be lost" is a resource notice from the
   browser's own bookkeeping. Measured on a BLANK PAGE with no application code
   at all, twenty contexts created and released one at a time:

                          WebKit      Chromium
     never released       4 warns     4 warns
     loseContext()        4 warns     0 warns
     loseContext() + 1x1  4 warns     0 warns

   Chromium returns the slot when a page releases a context; WebKit does not.
   So on WebKit no correct implementation can drive that message to zero, and a
   console-error check that fails on it is failing the app for a property of
   the browser — the same shape of error as a heap budget on an engine with no
   heap profiler.

   IT STAYS A HARD FAILURE ON CHROMIUM, deliberately. There it goes to zero
   when contexts are released properly, which makes it a real regression
   detector for the leak Heart3D.destroy() was fixed to stop. Suppressing it
   everywhere would trade a WebKit-only annoyance for the loss of the one
   signal that catches the bug coming back. */
function isEngineNoise(text, name = engineName()) {
  if (/GroupMarker|GL Driver|swiftshader/i.test(text)) return true;
  if (name !== 'chromium' && /too many active WebGL contexts/i.test(text)) return true;
  /* THE OTHER HALF OF THE SAME CAP, and it is the engine talking about a
     context the engine itself took away. WebKit allows a page sixteen WebGL
     contexts and does not return a slot when one is released; verify-heroart's
     destroy section deliberately builds TWENTY, to prove that destroy() hands
     its context back. Past the cap, WebKit evicts on its own, and a release of
     an evicted context logs "INVALID_OPERATION: loseContext: context already
     lost" — which is not an exception, so no try/catch can suppress it.

     Filtered rather than fixed because there is nothing left to fix: the app
     has exactly ONE loseContext() call site, in src/core/heart3d.js's
     destroy(), and it is guarded twice over — isContextLost() AND
     getParameter(VERSION) != null, because on WebKit the first still answers
     false for a context that has been evicted. Eight cycles produce zero of
     these; they appear only past sixteen, which is past what the engine
     supports and only a stress test ever reaches. Chromium returns released
     slots, never hits the cap, and so never emits this — which is why it stays
     a failure there. */
  if (name !== 'chromium' && /loseContext: context already lost/i.test(text)) return true;
  return false;
}

function launch(opts = {}) {
  const name = engineName();
  const playwright = require('playwright');
  return playwright[name].launch(launchOptions(opts, name));
}

module.exports = { ENGINES, DEFAULT_ENGINE, engineName, launchOptions, launch,
                   cpuThrottle, heapUsedBytes, isEngineNoise };
