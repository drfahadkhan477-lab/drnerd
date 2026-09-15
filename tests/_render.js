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

module.exports = { booted, settled, onScreen, quiet, afterRender,
                   BOOT_TIMEOUT, SETTLE_TIMEOUT, QUIET_FRAMES };
