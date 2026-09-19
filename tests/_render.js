'use strict';
/*
 * Waiting for render() to have actually happened.
 *
 * WHY THIS EXISTS. The app's render() swaps the DOM inside
 * document.startViewTransition, whose callback is asynchronous. The new markup
 * is therefore NOT in the document when render() returns, and a suite that
 * reads straight afterwards reads the previous screen. The same race was found
 * and fixed independently four times — verify-resume, verify-heartreuse,
 * verify-figsharp and verify-pwa — each time locally, each time by someone
 * (me) rediscovering the mechanism from the symptom. Four local fixes for one
 * bug is the signal that the fix belongs in one place.
 *
 * It is worth being precise about how it presents, because it does not look
 * like a race. It looks like a missing feature: a control the app definitely
 * renders is reported absent, a figure that definitely ships is reported
 * missing. In verify-figsharp it read as `captured:119 stillAttached:0` — every
 * node found, none of them still in the document, because the next render had
 * already replaced them. The instinct is to go looking for the control. The
 * control is fine; the read was early.
 *
 * WHAT MAKES A WAIT CORRECT. A fixed sleep is not a wait. waitForTimeout(900)
 * passes on a fast machine and lies on a slow one, which is exactly how these
 * survived: they were green in this container and red on the owner's laptop,
 * whose renderer is slower. A correct wait names a condition that is FALSE
 * before the render commits and TRUE after it, and polls for it.
 *
 * THE TRAP, stated once so it is not rediscovered a fifth time: DOM quiescence
 * is not a substitute for that condition. The document is perfectly quiet in
 * the window between render() returning and the transition callback running —
 * quiet() will happily return during it, still looking at the old screen. Use
 * settled() with a predicate that distinguishes the two screens. quiet() is
 * for afterwards, when the question is whether animation has finished.
 */

/* ── BEFORE MIGRATING A waitForTimeout TO settled(), READ THIS ────────────
 * There are 113 fixed sleeps left in tests/, and 66 of them are immediately
 * followed by an evaluate() that reads the thing the next assertion checks.
 * That makes the conversion look mechanical. It is not, and doing it the
 * obvious way is worse than leaving the sleep alone.
 *
 * The obvious way, on a real example from verify-apex.js:
 *
 *     await page.evaluate(() => { goLab(); render(); });
 *     await page.waitForTimeout(1200);
 *     const mounted = await page.evaluate(() => ({
 *       hasCanvas: !!document.getElementById('physioCanvas'), … }));
 *     ok('the cycle canvas is in the lab markup', mounted.hasCanvas);
 *
 * The predicate that suggests itself is "wait until physioCanvas exists" —
 * which is precisely what the next line asserts. Make that change and the
 * assertion can no longer fail: either the wait succeeds and the check is
 * tautological, or the wait times out and the suite CRASHES instead of
 * reporting a failure. A check that cannot come out false is the thing
 * verify-stats.js now fails the build over, and this is how one gets written
 * without anyone deciding to write one.
 *
 * THE RULE: a wait must be a PRECONDITION, never the proposition under test.
 * Wait for something that establishes the app got where it was going — the
 * screen flag, a container the assertion does not look at, a control the test
 * is not about — and let the assertion still be capable of failing. If no such
 * precondition exists, the sleep is doing real work and should stay, with a
 * comment saying what it is waiting for and why nothing observable marks it.
 *
 * This needs the app in front of you, one site at a time. It is not a sweep. */

/* Boot can be genuinely slow: the single-file build is ~42 MB of HTML and the
   laptop's WebKit spends ~100s parsing it before a line of app code runs. This
   is not padding for a race, it is the real cost of the target artifact. */
const BOOT_TIMEOUT   = 120000;
/* A render that has not committed in fifteen seconds is not slow, it is
   broken, and the suite should say so rather than hang to the harness timeout. */
const SETTLE_TIMEOUT = 15000;
/* Two consecutive animation frames with no mutations. One frame is not enough:
   a transition that mutates in a rAF callback leaves a single quiet frame
   between two busy ones. */
const QUIET_FRAMES   = 2;

/* The boot predicate, which was written out by hand in at least six suites and
   three times over inside some of them. S is the app's state object and
   .hero-h1 is the home screen's heading: together they mean the script has run
   AND the first render has landed, which neither alone does. */
async function booted(page, opts = {}) {
  await page.waitForFunction(
    () => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'),
    null, { timeout: opts.timeout || BOOT_TIMEOUT });
}

/* Wait for a condition that is false before a render commits and true after.
   The label is not decoration: a bare waitForFunction timeout reports
   "page.waitForFunction: Timeout 15000ms exceeded", which says nothing about
   what was being waited for, and these waits are the ones that fail on someone
   else's machine where the transcript is all anyone has to go on. */
async function settled(page, pred, opts = {}) {
  const timeout = opts.timeout || SETTLE_TIMEOUT;
  try {
    await page.waitForFunction(pred, opts.arg === undefined ? null : opts.arg, { timeout });
  } catch (e) {
    const what = opts.label || 'the expected markup';
    throw new Error(`render never settled: waited ${timeout}ms for ${what}, and it never became true. ` +
                    `The screen it was reading is most likely the previous one.`);
  }
}

/* Screen change plus commit, which is the shape almost every caller wants:
   S.screen is set synchronously by the app, the markup arrives later, and
   asserting on the first without the second is precisely the bug. */
async function onScreen(page, name, opts = {}) {
  await settled(page, n => typeof S !== 'undefined' && S.screen === n, {
    ...opts, arg: name, label: `S.screen === '${name}'`,
  });
  if (opts.marker) {
    await settled(page, sel => !!document.querySelector(sel), {
      ...opts, arg: opts.marker, label: `'${opts.marker}' to be in the document on the ${name} screen`,
    });
  }
}

/* No mutations for QUIET_FRAMES consecutive animation frames. A MutationObserver
   rather than a DOM fingerprint, because two different renders can produce
   markup of identical length and a fingerprint would call that no change.
   Returns true if it went quiet, false if it ran out of time — deliberately not
   a throw, because "still animating after N ms" is sometimes the finding rather
   than a failure. READ THE TRAP IN THE HEADER before reaching for this. */
async function quiet(page, opts = {}) {
  const sel = opts.selector || 'body';
  const timeout = opts.timeout || SETTLE_TIMEOUT;
  return page.evaluate(({ sel, timeout, need }) => new Promise(resolve => {
    const root = document.querySelector(sel) || document.body;
    const deadline = Date.now() + timeout;
    let calm = 0, done = false;
    const obs = new MutationObserver(() => { calm = 0; });
    obs.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
    const stop = v => { if (done) return; done = true; obs.disconnect(); resolve(v); };
    const tick = () => {
      if (done) return;
      if (++calm >= need) return stop(true);
      if (Date.now() > deadline) return stop(false);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), { sel, timeout, need: QUIET_FRAMES });
}

/* The combination that actually fixed the four races: wait for the condition
   that proves the new screen is up, THEN let whatever it started finish. */
async function afterRender(page, pred, opts = {}) {
  await settled(page, pred, opts);
  await quiet(page, opts);
}

/* ── resizing, which is not safe at any moment ───────────────────────────────

   WHAT HAPPENS IF YOU JUST CALL setViewportSize. On WebKit, shrinking the
   viewport while one of render()'s view transitions is still live kills the
   page outright — no exception, nothing logged, the process simply goes. It
   took twenty-three isolated cases to pin down and every one of them is in
   tools/resize-crash.js; the short version:

     survived  home to home, which starts no transition at all
     CRASHED   a screen change, then a shrink
     survived  a screen change, then awaiting the transition, then a shrink
     survived  a screen change, then a shrink UP instead
     CRASHED   a screen change, then skipTransition(), then a shrink
     CRASHED   300ms later          survived  2000ms later

   IT IS THE HARNESS, NOT THE APP. The owner checked the real device: open a
   question, go back, rotate the iPad immediately — it does not crash. So this
   is Playwright's WebKit, not iPadOS Safari, and the fix belongs here rather
   than in the app. Disabling the app's screen animation on the strength of a
   headless browser would have cost the target device a real feature for a bug
   it does not have. Worth saying plainly, because that was the change about to
   be made before anybody asked the device.

   A PRECONDITION, NOT A PROPOSITION — the rule at the top of this file. The
   suite is not asserting anything about transitions here; it is arranging for
   the page to be in a state where a resize means what the suite thinks it
   means. skipTransition() is deliberately not used: it skips the ANIMATION and
   the transition still settles afterwards, so the snapshot is still coming
   down when the resize lands. Measured, above.

   The watch is an init script so it survives the reloads several suites do. It
   wraps rather than replaces, so the page still goes through
   document.startViewTransition exactly as failsafe-patch wrote it. */
async function watchTransitions(page) {
  await page.addInitScript(() => {
    const orig = Document.prototype.startViewTransition;
    if (!orig) return;
    Document.prototype.startViewTransition = function (cb) {
      const vt = orig.call(this, cb);
      try {
        window.__vtLive = vt;
        const clear = () => { if (window.__vtLive === vt) window.__vtLive = null; };
        if (vt && vt.finished) vt.finished.then(clear, clear);
      } catch (_) {}
      return vt;
    };
  });
}

/* Resize, but never into a live transition. Falls back to a bounded settle
   when the watch is not installed, so a suite that forgets watchTransitions()
   is slower rather than broken — and says so, rather than crashing on WebKit
   with nothing in the log. */
async function resized(page, width, height, opts = {}) {
  const watched = await page.evaluate(() => typeof window.__vtLive !== 'undefined');
  if (watched) {
    await page.evaluate(() => (window.__vtLive && window.__vtLive.finished
      ? window.__vtLive.finished.catch(() => {}) : null));
  } else if (!opts.quiet) {
    await page.waitForTimeout(2000);   /* measured above: 300ms is not enough */
  }
  await page.setViewportSize({ width, height });
}

module.exports = { booted, settled, onScreen, quiet, afterRender,
                   watchTransitions, resized,
                   BOOT_TIMEOUT, SETTLE_TIMEOUT, QUIET_FRAMES };
