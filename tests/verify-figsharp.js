#!/usr/bin/env node
/*
 * No figure is drawn larger than the pixels it has.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-figsharp.js <patched.html>
 *
 * THE CLAIM IS A RATIO, so the checks measure one. For every figure in a
 * reference note: rendered CSS width against naturalWidth. Anything above 1.0
 * is the browser inventing pixels, and on a 2x display it is inventing four
 * for every one it was given.
 *
 * This is not a check that a CSS property has a particular value. A rule can
 * be correct and lose to a later selector, and `width:auto` on an element
 * whose parent is a flex or grid item still stretches. The only thing that
 * settles it is what the layout did, so that is what is read — at two iPad
 * viewports, because the card is a different width in each and a rule can be
 * right in one and wrong in the other.
 *
 * THE OPPOSITE FAILURE IS CHECKED TOO. Refusing to upscale must not turn into
 * refusing to fit: the widest note figures are 1328 px and the card is 876,
 * so those still have to come down. A build that simply removed the width rule
 * would pass an upscale check and overflow the card instead.
 */
'use strict';
const path = require('path');
const { launch, isEngineNoise } = require('./_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-figsharp.js <patched.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

/* Open a note that cites figures, wait for the images to actually decode
   (loading="lazy" means naturalWidth is 0 until they do — a measurement taken
   too early divides by zero and reports a perfect ratio), then measure. */
const measure = (page) => page.evaluate(async () => {
  const notes = (typeof REF !== 'undefined' ? REF : []).filter(n => /refimg:\/\//.test(n.body || ''));
  if (!notes.length) return { err: 'no reference notes cite a figure' };
  /* goRefs() ALREADY RENDERS. Calling render() after it ran a SECOND view
     transition, and that is what this suite kept tripping over: each one swaps
     the DOM in an async callback, so nodes collected before the swap are
     detached afterwards. A detached <img> still decodes — naturalWidth lands
     normally — and getBoundingClientRect() is all zeros for ever. That is
     exactly the "all 55 decoded, 0 boxed" the owner's laptop reported, and why
     this machine never saw it: the same race, landing the other way on a
     faster renderer.

     So nothing is collected once. The list is re-queried every pass, eager is
     re-applied to whatever is live now, and the measurement below reads the
     set the loop actually settled on. A DOM swap mid-wait then costs an
     iteration rather than the whole run. */
  if (typeof goRefs === 'function') goRefs();

  const live = () => [...document.querySelectorAll('.ref-fig img')];
  const ready = i => i.naturalWidth > 0 && i.getBoundingClientRect().width > 0;
  let imgs = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    imgs = live();
    /* loading="lazy" keeps naturalWidth at 0 for anything below the fold, and
       most of 295 note cards are below it. Re-applied every pass because a
       swap brings back a fresh set with the attribute as authored. */
    imgs.forEach(i => { try { i.loading = 'eager'; } catch (_) {} });
    if (imgs.length && imgs.every(ready)) break;
    await new Promise(r => setTimeout(r, 150));
  }
  imgs = live();
  imgs.forEach(i => { try { i.loading = 'eager'; } catch (_) {} });

  const rows = imgs.filter(i => i.naturalWidth > 0 && i.getBoundingClientRect().width > 0).map(i => {
    const fig = i.closest('figure');
    /* The container is the figure's PARENT, never the figure itself: once the
       fix lands the figure shrink-wraps the image, so measuring against it
       would compare the image to itself and always agree. */
    const host = fig && fig.parentElement;
    return {
      nat: i.naturalWidth,
      css: i.getBoundingClientRect().width,
      over: fig ? i.getBoundingClientRect().width - fig.getBoundingClientRect().width : 0,
      avail: host ? host.getBoundingClientRect().width : 0,
    };
  });
  /* WHY, NOT JUST HOW MANY. "0 of 55 placed" has two completely different
     causes and the same wording for both: an image that never decoded
     (naturalWidth 0 — the citation did not resolve, or 20s was not enough on
     this machine) and an image that decoded perfectly into a collapsed card
     (width 0 — the refs screen simply did not lay that note out). Reported on
     the owner's laptop where this build has 55 figures and none qualified, and
     the message could not say which half was missing. */
  const gotPixels = imgs.filter(i => i.naturalWidth > 0).length;
  const gotBox = imgs.filter(i => i.getBoundingClientRect().width > 0).length;
  return { rows, decoded: rows.length, total: imgs.length, gotPixels, gotBox,
           cardW: rows.length ? Math.round(Math.max(...rows.map(r => r.avail))) : 0 };
});

(async () => {
  const browser = await launch();
  const errors = [];

  for (const vp of [{ width: 1024, height: 1366, name: 'iPad portrait' },
                    { width: 1366, height: 1024, name: 'iPad landscape' }]) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !isEngineNoise(m.text())) errors.push(m.text()); });
    await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
    await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });

    head(`${vp.name} — ${vp.width}x${vp.height} at 2x`);
    const m = await measure(page);
    if (m.err) { ok('a note with figures could be opened', false, m.err); await page.close(); continue; }

    const why = m.decoded > 0 ? ''
      : m.gotPixels === 0 ? ` — none of ${m.total} decoded at all, so the citations did not resolve or 20s was not enough here`
      : m.gotBox === 0 ? ` — all ${m.gotPixels} decoded, but every card was collapsed to zero width`
      : ` — ${m.gotPixels} decoded and ${m.gotBox} laid out, but never the same one`;
    ok('figures were found, decoded and laid out', m.decoded > 0,
     `${m.decoded} of ${m.total} placed, card ${m.cardW}px${why}`);
  if (!m.decoded) { await page.close(); continue; }

    const upscaled = m.rows.filter(r => r.css > r.nat + 1);
    const worst = m.rows.reduce((a, r) => (r.css / r.nat > (a ? a.css / a.nat : 0) ? r : a), null);
    ok('no figure is drawn wider than the pixels it has',
       upscaled.length === 0,
       upscaled.length
         ? `${upscaled.length} upscaled, worst ${worst.nat}px → ${Math.round(worst.css)}px (${(worst.css / worst.nat).toFixed(2)}x)`
         : `worst ratio ${(worst.css / worst.nat).toFixed(2)}x on a ${worst.nat}px figure`);

    /* The other direction: a build that just deleted the width rule would pass
       the check above and push 1328px figures out of the card. */
    const overflowing = m.rows.filter(r => r.over > 1);
    ok('and none overflows the frame it sits in',
       overflowing.length === 0, `${overflowing.length} overflowing`);

    const wide = m.rows.filter(r => r.avail > 0 && r.nat > r.avail);
    ok('a figure wider than its container is still brought down to fit',
       wide.every(r => r.css <= r.avail + 1),
       wide.length ? `${wide.length} wider than their container, largest drawn at ${Math.round(Math.max(...wide.map(r => r.css)))}px`
                   : 'none rendered here are wider than their container');

    await page.close();
  }

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
