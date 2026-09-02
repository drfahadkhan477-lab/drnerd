#!/usr/bin/env node
/*
 * The figure viewer's gestures, in a real browser.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-figzoom.js <patched.html>
 *
 * The arithmetic is checked separately and exhaustively in
 * verify-figzoom-pure.js. What can only be checked here is the wiring: that a
 * pinch reaches the handler at all, that a drag pans instead of dismissing,
 * and — above everything — that the four ways out of a figure still work.
 * The viewer this extends exists because of a bug described in its own source
 * as "there is no way out of this image", and adding dragging to something you
 * dismiss by tapping outside it is exactly how that comes back.
 */
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-figzoom.js <patched.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 150000 });

  /* A 1x1 data URI: this suite is about gestures, not about any figure from
     the licensed bank, and a fixed size makes the geometry predictable. */
  /* Guarded, not dereferenced. On a build without this step every check here
     should report a failure; a bare `figZ` throws a ReferenceError on the
     first one and takes the rest of the suite with it — the discipline
     verify-pearl states for its canvas, and the third time this session a
     suite needed it. */
  /* Defined on the loaded page, not via addInitScript — that only applies to
     subsequent navigations, so registering it after goto() leaves it undefined
     and every guarded call throws the very error it exists to prevent. */
  await page.evaluate(() => { window.__fz = () => (typeof figZ === 'undefined' ? null : figZ); });
  const openFig = async () => page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    closePeek();
    if (typeof openFigure !== 'function') return;
    openFigure('data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="%23888"/></svg>'
    ), 'Test figure', 'Source');
    for (let i = 0; i < 40 && !document.querySelector('.figv-scroll img'); i++) await wait(25);
    await wait(80);
  });

  head('the viewer opens with a zoom surface and its controls');
  await openFig();
  const opened = await page.evaluate(() => ({
    img: !!document.querySelector('.figv-scroll img'),
    ctl: document.querySelectorAll('.figv-ctl .figv-btn').length,
    pct: (document.querySelector('.figv-pct') || {}).textContent,
    mounted: !!__fz(),
    touchAction: getComputedStyle(document.querySelector('.figv-scroll')).touchAction,
  }));
  ok('the figure is on screen', opened.img === true);
  ok('with zoom out, in and fit', opened.ctl === 3, `${opened.ctl} buttons`);
  ok('starting fitted at 100%', opened.pct === '100%', String(opened.pct));
  ok('the zoom controller is mounted', opened.mounted === true);
  /* Without touch-action:none the browser claims a pinch for page zoom and
     pointermove never fires — the figure sits still while the page scales. */
  ok('and the surface yields its gestures to the handler',
     opened.touchAction === 'none', String(opened.touchAction));

  head('the controls zoom, and Fit returns');
  const viaButtons = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    if (!__fz() || document.querySelectorAll('.figv-btn').length < 3)
      return { zoomed: { s: 0, pct: '', cls: false }, back: 0, fitted: 0, cls: false };
    document.querySelectorAll('.figv-btn')[1].click(); await wait(40);   // +
    const zoomed = { s: __fz().state().scale, pct: document.querySelector('.figv-pct').textContent,
                     cls: document.querySelector('.figv-scroll').classList.contains('zoomed') };
    document.querySelectorAll('.figv-btn')[0].click(); await wait(40);   // −
    const back = __fz().state().scale;
    document.querySelectorAll('.figv-btn')[2].click(); await wait(40);   // Fit
    return { zoomed, back, fitted: __fz().state().scale, cls: document.querySelector('.figv-scroll').classList.contains('zoomed') };
  });
  ok('zoom in magnifies', viaButtons.zoomed.s > 1, String(viaButtons.zoomed.s));
  ok('and the readout follows', viaButtons.zoomed.pct === '140%', viaButtons.zoomed.pct);
  ok('the surface reports itself zoomed, for the grab cursor', viaButtons.zoomed.cls === true);
  ok('zoom out reverses it', Math.abs(viaButtons.back - 1) < 1e-6, String(viaButtons.back));
  ok('Fit returns to fitted', viaButtons.fitted === 1 && viaButtons.cls === false, JSON.stringify(viaButtons.fitted));

  head('the keyboard reaches the zoom');
  await openFig();
  const keys = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    if (!__fz()) return { inn: 0, out: 0, zero: 0, open: false };
    const fire = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    fire('+'); await wait(30); const inn = __fz().state().scale;
    fire('-'); await wait(30); const out = __fz().state().scale;
    fire('+'); fire('+'); await wait(30);
    fire('0'); await wait(30); const zero = __fz().state().scale;
    return { inn, out, zero, open: !!document.querySelector('.figv-scroll') };
  });
  ok('+ magnifies', keys.inn > 1, String(keys.inn));
  ok('− reverses', Math.abs(keys.out - 1) < 1e-6, String(keys.out));
  ok('0 returns to fitted', keys.zero === 1, String(keys.zero));
  ok('and none of them closed the viewer', keys.open === true);

  head('a pinch zooms about the fingers');
  await openFig();
  const pinch = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const sc = document.querySelector('.figv-scroll');
    if (!sc || !__fz()) return { after: 0, open: false };
    const b = sc.getBoundingClientRect();
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    const pd = (id, x, y, t) => sc.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    pd(1, cx - 40, cy, 'pointerdown'); pd(2, cx + 40, cy, 'pointerdown');
    pd(1, cx - 40, cy, 'pointermove'); pd(2, cx + 40, cy, 'pointermove');   // establishes the baseline
    await wait(20);
    pd(1, cx - 120, cy, 'pointermove'); pd(2, cx + 120, cy, 'pointermove'); // spread
    await wait(40);
    const after = __fz().state().scale;
    pd(1, cx - 120, cy, 'pointerup'); pd(2, cx + 120, cy, 'pointerup');
    return { after, open: !!document.querySelector('.figv-scroll') };
  });
  ok('spreading two pointers magnifies', pinch.after > 1.5, String(pinch.after));
  ok('and the viewer is still open — a pinch is not a dismissal', pinch.open === true);

  head('a drag pans, and does not dismiss');
  /* The gesture this feature adds is the one most likely to break the
     tap-outside exit, because a pan ends with the pointer on the image. */
  const drag = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const sc = document.querySelector('.figv-scroll');
    if (!sc || !__fz()) return { moved: false, open: false };
    const b = sc.getBoundingClientRect();
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    __fz().zoomCentre(3); await wait(30);
    const before = { ...__fz().state() };
    const pd = (x, y, t) => sc.dispatchEvent(new PointerEvent(t, { pointerId: 9, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    pd(cx, cy, 'pointerdown');
    pd(cx - 30, cy - 20, 'pointermove');
    pd(cx - 60, cy - 40, 'pointermove');
    await wait(30);
    const after = { ...__fz().state() };
    pd(cx - 60, cy - 40, 'pointerup');
    /* The click the browser sends after a drag lands on the image. */
    document.querySelector('.figv-scroll img').click();
    await wait(60);
    return { moved: after.tx !== before.tx || after.ty !== before.ty,
             open: !!document.querySelector('.figv-scroll') };
  });
  ok('dragging moves the figure', drag.moved === true);
  ok('and the drag is not mistaken for the tap that closes it', drag.open === true);

  head('every way out of a figure still works');
  const exits = {};
  await openFig();
  exits.escape = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(60); return !document.querySelector('.figv-scroll');
  });
  await openFig();
  exits.button = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    document.querySelector('.figv-x').click(); await wait(60);
    return !document.querySelector('.figv-scroll');
  });
  await openFig();
  exits.backdrop = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    document.querySelector('.figv').click(); await wait(60);
    return !document.querySelector('.figv-scroll');
  });
  ok('Escape closes', exits.escape === true);
  ok('the button closes', exits.button === true);
  ok('and tapping outside the picture closes', exits.backdrop === true);
  const cleared = await page.evaluate(() => __fz() === null);
  ok('closing releases the controller, so the next figure opens fitted', cleared === true);

  head('the question dialog is left alone');
  /* openPeek shows a related question and has no image. It must not acquire a
     zoom controller just because it shares the overlay. */
  const peek = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    closePeek();
    /* typeof, not truthiness: an undeclared identifier throws a
       ReferenceError before any check can read it. And peekQuestion takes an
       ID, not the question — passing the object makes it return early and the
       check then fails for a reason that has nothing to do with this step. */
    if (typeof peekQuestion !== 'function') return { opened: null, controller: __fz() };
    peekQuestion(POOL[0].id);
    await wait(80);
    return { opened: !!document.querySelector('.peek-card'), controller: __fz() };
  });
  ok('it still opens', peek.opened === true);
  ok('and has no zoom controller attached', peek.controller === null, String(peek.controller));

  head('no stray errors');
  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
