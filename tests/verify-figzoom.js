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
const { launch } = require('./_engine');

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
  const browser = await launch();
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

  head('a tap survives the wobble every real finger has');
  /* THE BUG THIS CHECKS FOR SHIPPED. Any nonzero pointermove latched "moved",
     and moved suppresses the tap so a drag cannot dismiss the viewer. A finger
     never holds still to the pixel, so once zoomed, tap-to-fit failed roughly
     whenever a human did it — while passing every synthetic test, because
     dispatched pointers move exactly 0px unless told otherwise. The fix is a
     slop threshold: movement under it is still a tap. */
  await openFig();
  const slop = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const sc = document.querySelector('.figv-scroll');
    if (!sc || !__fz()) return { skipped: true };
    const b = sc.getBoundingClientRect();
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    const pd = (x, y, t) => sc.dispatchEvent(new PointerEvent(t, { pointerId: 5, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    const tapWithWobble = async (px) => {
      pd(cx, cy, 'pointerdown');
      pd(cx + px, cy, 'pointermove');
      pd(cx + px, cy, 'pointerup');
      sc.querySelector('img').click();
      await wait(40);
      return __fz().state().scale;
    };
    __fz().zoomCentre(3); await wait(30);
    const afterWobble = await tapWithWobble(1);        // a hand, not a robot
    __fz().reset(); __fz().zoomCentre(3); await wait(30);
    const afterThree = await tapWithWobble(3);
    __fz().reset(); __fz().zoomCentre(3); await wait(30);
    const afterRealDrag = await tapWithWobble(60);     // unambiguously a pan
    return { skipped: false, afterWobble, afterThree, afterRealDrag,
             open: !!document.querySelector('.figv-scroll') };
  });
  ok('a 1px wobble is still a tap, and returns to fitted',
     slop.afterWobble === 1, `scale ${slop.afterWobble}`);
  ok('and so is 3px', slop.afterThree === 1, `scale ${slop.afterThree}`);
  /* The threshold must not be so generous that a real drag starts dismissing
     things — that is the bug the `moved` latch exists to prevent. */
  ok('but a 60px drag is a pan, not a tap — the zoom is left where it was',
     slop.afterRealDrag === 3, `scale ${slop.afterRealDrag}`);
  ok('and the viewer stayed open throughout', slop.open === true);

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

  head('a TALL figure is whole at Fit — the state that promises it');
  {
    /* The bug this defends against shipped and was found on an iPad, not here:
       max-width:100% fits the WIDTH and says nothing about the height, so a
       book-page crop overflowed. Every figure in the suite until now was wider
       than it was tall, which is why nothing noticed. */
    await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      closePeek();
      openFigure('data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="2000">' +
        '<rect width="300" height="2000" fill="%23888"/>' +
        '<rect y="0" width="300" height="40" fill="%23f00"/>' +
        '<rect y="1960" width="300" height="40" fill="%2300f"/></svg>'
      ), 'A tall figure', 'Source');
      for (let i = 0; i < 40 && !document.querySelector('.figv-scroll img'); i++) await wait(25);
      await wait(120);
    });
    const tall = await page.evaluate(() => {
      const img = document.querySelector('.figv-scroll img');
      const box = document.querySelector('.figv-scroll');
      if (!img || !box) return null;
      const i = img.getBoundingClientRect(), b = box.getBoundingClientRect();
      return {
        fitted: !!(__fz() && __fz().state && __fz().state().scale === 1),
        pct: (document.querySelector('.figv-pct') || {}).textContent,
        overflowTop: b.top - i.top, overflowBottom: i.bottom - b.bottom,
        imgH: Math.round(i.height), boxH: Math.round(b.height),
        imgW: Math.round(i.width), boxW: Math.round(b.width),
      };
    });
    ok('the tall figure opened', tall !== null);
    ok('and the controller really is at scale 1, not merely reporting it',
       !!tall && tall.fitted === true);
    /* Both ends, because flex centring splits the overflow: the old failure
       showed a band from the middle, not a top-anchored crop. */
    ok('its top edge is not clipped', !!tall && tall.overflowTop <= 1, tall ? `${Math.round(tall.overflowTop)}px above the frame` : '—');
    ok('nor its bottom edge', !!tall && tall.overflowBottom <= 1, tall ? `${Math.round(tall.overflowBottom)}px below the frame` : '—');
    ok('so the whole height sits inside the viewer',
       !!tall && tall.imgH <= tall.boxH + 1, tall ? `${tall.imgH}px in ${tall.boxH}px` : '—');
    ok('and it is still reported as 100%, because fitted is what it now is',
       !!tall && tall.pct === '100%', tall ? String(tall.pct) : '—');
    ok('the aspect ratio is intact — contained, not squashed',
       !!tall && Math.abs(tall.imgW / tall.imgH - 300 / 2000) < 0.02,
       tall ? `${tall.imgW}x${tall.imgH}` : '—');

    /* A wide figure must not have been shrunk by the same rule: max-height
       only ever caps, and the common case was already correct. */
    await openFig();
    const wide = await page.evaluate(() => {
      const i = document.querySelector('.figv-scroll img').getBoundingClientRect();
      const b = document.querySelector('.figv-scroll').getBoundingClientRect();
      return { w: Math.round(i.width), h: Math.round(i.height), bw: Math.round(b.width), bh: Math.round(b.height) };
    });
    ok('a wide figure is unchanged by the fix', wide.w <= wide.bw + 1 && wide.h <= wide.bh + 1,
       `${wide.w}x${wide.h} in ${wide.bw}x${wide.bh}`);
    ok('and keeps its own aspect ratio too',
       Math.abs(wide.w / wide.h - 400 / 300) < 0.02, `${wide.w}x${wide.h}`);
  }

  head('the real bank fits, at the frames real devices produce');
  {
    /* THE FIXTURE WAS THE BUG. Every check above this line opens a 400x300
       grey rectangle — a shape that fits any frame, in a portrait-ish viewport
       no iPad is held in. The app ships 408 figures with a median height of
       825px, and 401 of them were clipped at "Fit" on an 11-inch iPad in
       landscape while 29 checks reported green. Synthetic fixtures test the
       code; they do not test the app. These open the actual figures. */
    const sizes = await page.evaluate(() => {
      /* Dimensions straight from the WebP/PNG header — no decode, so all 408
         can be read without a gigabyte of bitmaps. */
      const urls = [];
      try { for (const id in IMGS) { const l = IMGS[id]; if (l) for (const u of l) if (typeof u === 'string') urls.push(u); } } catch (_) {}
      const head = u => {
        const i = u.indexOf(','); if (i < 0) return null;
        let bin; try { bin = atob(u.slice(i + 1, i + 1 + 120)); } catch (_) { return null; }
        const a = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) a[k] = bin.charCodeAt(k);
        if (a.length < 32) return null;
        const d = new DataView(a.buffer, a.byteOffset, a.byteLength);
        const tag = String.fromCharCode(a[0], a[1], a[2], a[3]);
        if (tag === 'RIFF') {
          const fmt = String.fromCharCode(a[12], a[13], a[14], a[15]);
          if (fmt === 'VP8X') return [1 + (a[24] | a[25] << 8 | a[26] << 16), 1 + (a[27] | a[28] << 8 | a[29] << 16)];
          if (fmt === 'VP8 ') return [d.getUint16(26, true) & 0x3fff, d.getUint16(28, true) & 0x3fff];
          if (fmt === 'VP8L') { const x = d.getUint32(21, true); return [1 + (x & 0x3fff), 1 + ((x >>> 14) & 0x3fff)]; }
        }
        if (a[1] === 0x50 && a[2] === 0x4E && a[3] === 0x47) return [d.getUint32(16), d.getUint32(20)];
        return null;
      };
      const out = [];
      for (const u of urls) { const dd = head(u); if (dd && dd[0] && dd[1]) out.push({ u, w: dd[0], h: dd[1] }); }
      return { n: urls.length, read: out.length,
        tallest: out.slice().sort((a, b) => (b.h / b.w) - (a.h / a.w))[0],
        highest: out.slice().sort((a, b) => b.h - a.h)[0],
        medianH: out.map(x => x.h).sort((a, b) => a - b)[Math.floor(out.length / 2)],
        sample: out.filter((_, i) => i % Math.max(1, Math.floor(out.length / 10)) === 0).slice(0, 10) };
    });
    ok('the real figures are readable from this build', sizes.read > 100,
       `${sizes.read} of ${sizes.n} figures`);
    ok('and they are nothing like the fixture above',
       sizes.medianH > 400, `median height ${sizes.medianH}px vs the fixture's 300px`);

    /* The frames an iPad actually produces, landscape first — the orientation
       in which the bug was total and which no other suite exercises here. */
    const frames = [
      ['iPad 11" landscape', 1194, 834],
      ['iPad 11" portrait', 834, 1194],
      ['iPhone portrait', 430, 932],
    ];
    const worstOf = async list => page.evaluate(async urls => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      let worst = 0, at = '', seen = 0;
      for (const u of urls) {
        closePeek(); openFigure(u, 'Real figure', 'Bank');
        let img = null;
        for (let t = 0; t < 60 && !img; t++) { await wait(25); img = document.querySelector('.figv-scroll img'); }
        if (img && !(img.complete && img.naturalWidth)) {
          await new Promise(r => { let d = 0; const f = () => { if (!d++) r(); };
            img.addEventListener('load', f, { once: true }); setTimeout(f, 4000); });
        }
        await wait(40);
        const box = document.querySelector('.figv-scroll');
        if (!img || !img.naturalWidth || !box) continue;
        /* Layout size, not getBoundingClientRect: the viewer animates in, and
           a rect measured mid-entrance reports an overflow that is not there. */
        const over = Math.max(0, img.offsetHeight - box.clientHeight, img.offsetWidth - box.clientWidth);
        if (over > worst) { worst = Math.round(over); at = img.naturalWidth + 'x' + img.naturalHeight; }
        seen++;
      }
      closePeek();
      return { worst, at, seen };
    }, list);

    for (const [name, w, h] of frames) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(220);
      const list = [sizes.tallest.u, sizes.highest.u].concat(sizes.sample.map(x => x.u));
      const r = await worstOf(list);
      ok(`${name}: every sampled figure fits at Fit`, r.worst <= 1 && r.seen >= 8,
         `${r.seen} figures, worst overflow ${r.worst}px${r.worst > 1 ? ' on ' + r.at : ''}`);
    }

    /* The single worst case in the bank, named, so a partial fix that handles
       the median and not the extreme cannot pass. */
    await page.setViewportSize({ width: 1194, height: 834 });
    await page.waitForTimeout(220);
    const extreme = await worstOf([sizes.tallest.u]);
    ok('the tallest figure in the bank fits too',
       extreme.worst <= 1 && extreme.seen === 1,
       `${sizes.tallest.w}x${sizes.tallest.h}, overflow ${extreme.worst}px`);

    await page.setViewportSize({ width: 900, height: 1000 });
    await page.waitForTimeout(220);
  }

  head('no stray errors');
  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
