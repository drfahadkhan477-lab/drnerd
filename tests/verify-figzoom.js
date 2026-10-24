#!/usr/bin/env node
/*
 * The figure viewer, in a real browser.
 *
 *   node tests/verify-figzoom.js <build.html | http://…/>
 *
 * The viewer is PhotoSwipe (app/vendor/photoswipe), dressed and wired by
 * openFigures() in app/systole.html. PhotoSwipe's own arithmetic is its
 * authors' to test; what can only be checked here is the wiring and what this
 * app promises on top of it: the zoom row and its readout, the keys, a tap on
 * the picture that magnifies rather than closes, the figures beside it a swipe
 * away, a figure that fails to load still saying so, and — above everything —
 * that every way out of a figure still works. The first viewer exists because
 * of a bug described in its own source as "there is no way out of this image",
 * and adding gestures to something you dismiss by tapping outside it is
 * exactly how that comes back.
 *
 * Gestures go through Playwright's mouse, keyboard and touchscreen, so they
 * reach PhotoSwipe's own listeners as a person's would. Two-finger pinches are
 * pointer events dispatched on its scroll layer, which is what a pinch is to
 * it: Playwright has no second finger.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');
const { booted, watchTransitions, resized } = require('./_render.js');
const { onDeath } = require('./_deathnote.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-figzoom.js <build.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 }, hasTouch: true });
  await watchTransitions(page);   /* before goto: see _render.js */
  const errors = [];
  const events = [];
  page.on('crash', () => events.push('the browser CRASHED the page'));
  page.on('close', () => events.push('the page closed'));
  page.on('requestfailed', r => {
    const why = (r.failure() || {}).errorText || '';
    /* The broken figure below is asked for on purpose. */
    if (why && !/no-such-figure/.test(r.url())) events.push(`request failed: ${String(r.url()).slice(-50)} — ${why}`);
  });
  onDeath(() => ({ section, checks: passed + failed, errors,
                   events: events.length ? events.join(', ') : 'none' }));
  page.on('pageerror', e => errors.push(e.message));
  /* The missing figure below is asked for on purpose; Chromium's message for it
     names no URL, so its source location says whose it is. */
  page.on('console', m => { if (m.type() === 'error' && !/no-such-figure/.test(m.text() + ' ' + ((m.location() || {}).url || ''))) errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await booted(page, { timeout: 150000 });

  /* Defined on the loaded page. Guarded, not dereferenced: on a build without
     the viewer every check here reports a failure instead of the first one
     throwing and taking the rest of the suite with it. */
  await page.evaluate(() => {
    window.__svg = (w, h, extra) => 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#888"/>${extra || ''}</svg>`);
    window.__ps = () => (typeof figPs === 'undefined' || !figPs || !figPs.currSlide ? null : figPs);
    /* At rest: opened, its opening animation over, its picture loaded. A
       rectangle read mid-animation is a figure that is still growing. */
    window.__rest = async ps => {
      if (!ps || !ps.on) return null;
      await new Promise(r => { if (ps.opener && ps.opener.isOpen) return r(); ps.on('openingAnimationEnd', r); setTimeout(r, 4000); });
      const img = ps.currSlide && ps.currSlide.content && ps.currSlide.content.element;
      if (img && img.tagName === 'IMG' && !(img.complete && img.naturalWidth))
        await new Promise(r => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); setTimeout(r, 4000); });
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return ps;
    };
  });
  const openFig = (w = 400, h = 300) => page.evaluate(async ([w, h]) => {
    if (typeof openFigure !== 'function') return false;
    return !!await __rest(await openFigure(__svg(w, h), 'Test figure', 'Source'));
  }, [w, h]);
  const state = () => page.evaluate(() => {
    const ps = __ps(); if (!ps) return null;
    const s = ps.currSlide;
    return { cur: s.currZoomLevel, initial: s.zoomLevels.initial, secondary: s.zoomLevels.secondary,
      pct: (document.querySelector('.pswp__figv-pct') || {}).textContent,
      zoomedCls: ps.element.classList.contains('figv-zoomed'), pan: { x: s.pan.x, y: s.pan.y } };
  });
  const isOpen = () => page.evaluate(() => !!document.querySelector('.pswp'));
  /* Closed is the overlay gone from the page. PhotoSwipe removes it when its
     closing animation ends, which from a zoomed picture takes longer than from
     a fitted one, so this waits up to three seconds for that and no longer. */
  const closes = () => page.waitForFunction(() => !document.querySelector('.pswp'), null, { timeout: 3000 }).then(() => true, () => false);
  const settle = (ms = 420) => page.waitForTimeout(ms);   // PhotoSwipe's zoom transition is 333ms; ours 220ms
  const close = () => page.evaluate(() => { if (typeof closePeek === 'function') closePeek(); });

  head('the viewer opens as a dialog, with its zoom row and caption');
  const o0 = await openFig();
  const opened = await page.evaluate(() => {
    const root = document.querySelector('.pswp');
    const img = __ps() && __ps().currSlide.content.element;
    const btn = n => !!document.querySelector('.pswp__button--' + n);
    return { root: !!root, role: root && root.getAttribute('role'), modal: root && root.getAttribute('aria-modal'),
      label: root && root.getAttribute('aria-label'), img: !!img && img.naturalWidth > 0,
      buttons: ['figv-out', 'figv-in', 'figv-fit', 'close'].filter(btn),
      pct: (document.querySelector('.pswp__figv-pct') || {}).textContent,
      cap: (document.querySelector('.pswp__figv-cap') || {}).textContent || '',
      touch: root ? getComputedStyle(root).touchAction : '',
      locked: document.body.classList.contains('peek-locked') };
  });
  ok('the figure opens, its picture drawn', o0 && opened.root && opened.img, JSON.stringify({ o0, root: opened.root, img: opened.img }));
  ok('as a modal dialog named by its caption', opened.role === 'dialog' && opened.modal === 'true' && opened.label === 'Test figure',
     `${opened.role} / ${opened.modal} / ${opened.label}`);
  ok('with zoom out, zoom in, Fit and Close', opened.buttons.length === 4, opened.buttons.join(', '));
  ok('starting fitted at 100%', opened.pct === '100%', String(opened.pct));
  ok('the caption and its source are under it', /Test figure/.test(opened.cap) && /Source/.test(opened.cap), opened.cap);
  /* Without touch-action:none the browser claims a pinch for page zoom and
     the figure sits still while the page scales. */
  ok('the surface keeps the browser off its gestures', opened.touch === 'none', String(opened.touch));
  ok('and the page beneath is held still', opened.locked === true);

  head('the zoom row and its state change together');
  const immediateIn = await page.evaluate(() => {
    const ps=__ps(); figZoomBy(ps,FIG_STEP);
    return {ratio:ps.currSlide.currZoomLevel/ps.currSlide.zoomLevels.initial,
      pct:ps.element.querySelector('.pswp__figv-pct').textContent,
      zoomed:ps.element.classList.contains('figv-zoomed')};
  });
  ok('Zoom in updates its readout and grab cursor in the same event',
    Math.abs(immediateIn.ratio-1.4)<0.01 && immediateIn.pct==='140%' && immediateIn.zoomed, JSON.stringify(immediateIn));
  await settle();
  /* Let the previous zoom paint before testing Fit. The assertion itself runs
     synchronously with the control, before a queued animation frame can hide
     a stale readout. No animation or close deadline is changed. */
  await page.evaluate(() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const immediateFit = await page.evaluate(() => {
    const ps=__ps(); figFit(ps);
    return {ratio:ps.currSlide.currZoomLevel/ps.currSlide.zoomLevels.initial,
      pct:ps.element.querySelector('.pswp__figv-pct').textContent,
      zoomed:ps.element.classList.contains('figv-zoomed')};
  });
  ok('Fit updates its readout and removes the grab cursor in the same event',
    Math.abs(immediateFit.ratio-1)<1e-6 && immediateFit.pct==='100%' && !immediateFit.zoomed, JSON.stringify(immediateFit));
  await settle();

  head('the zoom row zooms, and Fit returns');
  await page.click('.pswp__button--figv-in'); await settle();
  const zin = await state();
  await page.click('.pswp__button--figv-out'); await settle();
  const zout = await state();
  await page.click('.pswp__button--figv-in'); await page.click('.pswp__button--figv-in'); await settle();
  await page.click('.pswp__button--figv-fit'); await settle();
  const zfit = await state();
  ok('+ magnifies 1.4 times', !!zin && Math.abs(zin.cur / zin.initial - 1.4) < 0.01, zin && (zin.cur / zin.initial).toFixed(3));
  ok('and the readout follows', !!zin && zin.pct === '140%', zin && zin.pct);
  ok('the viewer marks itself zoomed, for the grab cursor', !!zin && zin.zoomedCls === true);
  ok('− reverses it', !!zout && Math.abs(zout.cur - zout.initial) < 1e-6 && zout.pct === '100%', zout && `${zout.cur} / ${zout.pct}`);
  ok('Fit returns to fitted from anywhere', !!zfit && Math.abs(zfit.cur - zfit.initial) < 1e-6 && !zfit.zoomedCls, zfit && String(zfit.cur));

  head('the keyboard reaches the zoom');
  await page.keyboard.press('+'); await settle();
  const k1 = await state();
  await page.keyboard.press('-'); await settle();
  const k2 = await state();
  await page.keyboard.press('='); await page.keyboard.press('='); await settle();
  await page.keyboard.press('0'); await settle();
  const k3 = await state();
  ok('+ magnifies', !!k1 && k1.cur > k1.initial * 1.3, k1 && (k1.cur / k1.initial).toFixed(3));
  ok('− reverses', !!k2 && Math.abs(k2.cur - k2.initial) < 1e-6, k2 && String(k2.cur / k2.initial));
  ok('0 returns to fitted', !!k3 && Math.abs(k3.cur - k3.initial) < 1e-6, k3 && String(k3.cur / k3.initial));
  ok('and none of them closed the viewer', await isOpen());

  head('a pinch zooms, and is not a dismissal');
  const pinch = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const ps = __ps(), el = document.querySelector('.pswp__scroll-wrap');
    if (!ps || !el) return null;
    const b = el.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    const pe = (t, id, x) => el.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'touch', isPrimary: id === 1,
      clientX: x, clientY: cy, bubbles: true, cancelable: true, buttons: t === 'pointerup' ? 0 : 1 }));
    /* PhotoSwipe applies a pinch in its animation frame, not in the pointer
       handler, so the fingers move a frame at a time: spaced by a timer, a
       busy WebKit ran all eight moves before one frame and saw no pinch. */
    const frame = () => new Promise(r => requestAnimationFrame(() => r()));
    const before = ps.currSlide.currZoomLevel, ready = !!(ps.opener && ps.opener.isOpen);
    pe('pointerdown', 1, cx - 40); pe('pointerdown', 2, cx + 40);
    for (let k = 1; k <= 8; k++) { pe('pointermove', 1, cx - 40 - k * 15); pe('pointermove', 2, cx + 40 + k * 15); await frame(); await frame(); }
    const during = ps.currSlide.currZoomLevel;
    pe('pointerup', 1, cx - 160); pe('pointerup', 2, cx + 160);
    await wait(500);
    return { ready, before, during, after: ps.currSlide.currZoomLevel, initial: ps.currSlide.zoomLevels.initial };
  });
  ok('spreading two fingers magnifies', !!pinch && pinch.after > pinch.initial * 1.5, JSON.stringify(pinch));
  ok('and the viewer is still open', await isOpen());

  head('a trackpad pinch (ctrl + wheel) zooms too');
  await page.click('.pswp__button--figv-fit'); await settle();
  await page.mouse.move(450, 500);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -300); await page.keyboard.up('Control');
  await settle();
  const wheel = await state();
  ok('it magnifies about the pointer', !!wheel && wheel.cur > wheel.initial * 1.1, wheel && (wheel.cur / wheel.initial).toFixed(3));

  head('a drag pans, and does not dismiss');
  /* The gesture most likely to break the tap-outside exit: a pan ends with the
     pointer on the picture, and its mouseup is followed by a click. */
  await page.click('.pswp__button--figv-in'); await page.click('.pswp__button--figv-in'); await page.click('.pswp__button--figv-in'); await settle();
  const p0 = await state();
  await page.mouse.move(450, 500); await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(450 - k * 8, 500 - k * 5);
  await page.mouse.up(); await settle();
  const p1 = await state();
  ok('dragging moves the figure', !!p0 && !!p1 && (p1.pan.x !== p0.pan.x || p1.pan.y !== p0.pan.y), p0 && p1 ? `${JSON.stringify(p0.pan)} → ${JSON.stringify(p1.pan)}` : '—');
  ok('and the drag is not mistaken for a tap that closes it', await isOpen());
  ok('nor for the click that zooms: the zoom is left where it was', !!p0 && !!p1 && Math.abs(p1.cur - p0.cur) < 1e-6, p1 && String(p1.cur));

  head('a tap on the picture magnifies; a tap off it closes');
  /* A viewer of its own: the gestures above leave PhotoSwipe's pointer state
     however a synthetic pinch leaves it, and a tap is judged against that. */
  await close(); await openFig();
  /* A mouse click on the picture: PhotoSwipe's imageClickAction. */
  const imgBox = async () => page.evaluate(() => { const r = __ps().currSlide.content.element.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  let c = await imgBox();
  await page.mouse.click(c.x, c.y); await settle(700);
  const t1 = await state();
  ok('a click on the picture magnifies it', !!t1 && t1.cur > t1.initial * 1.5, t1 && (t1.cur / t1.initial).toFixed(3));
  await page.mouse.click(c.x, c.y); await settle(700);
  const t2 = await state();
  ok('and a second click returns it to fitted', !!t2 && Math.abs(t2.cur - t2.initial) < 1e-6, t2 && String(t2.cur / t2.initial));
  /* A finger on a touch screen: tapAction, which is ours. */
  c = await imgBox();
  await page.touchscreen.tap(c.x, c.y); await settle(900);
  const t3 = await state();
  ok('a finger\'s tap on the picture magnifies it, as on an iPad', !!t3 && t3.cur > t3.initial * 1.5, t3 && (t3.cur / t3.initial).toFixed(3));
  ok('and does not close the viewer', await isOpen());
  await page.touchscreen.tap(20, 600);
  ok('a finger\'s tap off the picture closes it', await closes());

  head('every way out of a figure still works');
  const exits = {};
  await openFig(); await page.keyboard.press('Escape');
  exits.escape = await closes();
  await openFig(); await page.click('.pswp__button--close');
  exits.button = await closes();
  await openFig(); await page.mouse.click(20, 600);
  exits.backdrop = await closes();
  /* At once: closePeek is the app drawing something else. */
  await openFig();
  exits.closePeek = await page.evaluate(() => { closePeek(); return !document.querySelector('.pswp'); });
  ok('Escape closes', exits.escape === true);
  ok('the Close button closes', exits.button === true);
  ok('a click outside the picture closes', exits.backdrop === true);
  ok('and so does the app moving on (closePeek), at once', exits.closePeek === true);
  /* The app moving on while a figure is still growing in: PhotoSwipe ignores a
     close until its opening animation ends, and a viewer left over the app
     caught every tap meant for the page (verify-pearl's next click died on it). */
  const midOpen = await page.evaluate(async () => {
    const ps = await openFigure(__svg(400, 300), 'Mid-entrance', 'Source');
    const opening = !!ps && !(ps.opener && ps.opener.isOpen);
    closePeek();
    await new Promise(r => setTimeout(r, 50));
    return { opening, left: !!document.querySelector('.pswp'), locked: document.body.classList.contains('peek-locked') };
  });
  ok('a figure closed while it is still opening goes at once', midOpen.opening && !midOpen.left && !midOpen.locked, JSON.stringify(midOpen));
  const cleared = await page.evaluate(() => typeof figPs !== 'undefined' && figPs === null && !document.body.classList.contains('peek-locked'));
  ok('closing lets go of the viewer and the page', cleared === true);

  head('a figure\'s neighbours are a swipe away');
  const gal = await page.evaluate(async () => {
    if (typeof openFigures !== 'function') return null;
    const ps = await __rest(await openFigures([
      { src: __svg(400, 300), caption: 'First', source: 'S' },
      { src: __svg(300, 400), caption: 'Second', source: 'S' },
      { src: __svg(500, 200), caption: 'Third', source: 'S' }], 1));
    return ps ? { n: ps.getNumItems(), at: ps.currIndex, counter: (document.querySelector('.pswp__counter') || {}).textContent,
      cap: document.querySelector('.pswp__figv-cap').textContent } : null;
  });
  ok('three figures open as one gallery, at the one asked for', !!gal && gal.n === 3 && gal.at === 1, JSON.stringify(gal));
  ok('which says where it is', !!gal && /2 of 3/.test(gal.counter || ''), gal && gal.counter);
  ok('and shows that figure\'s caption', !!gal && /^Second/.test(gal.cap), gal && gal.cap);
  await page.keyboard.press('ArrowRight'); await settle(700);
  const g2 = await page.evaluate(() => ({ at: __ps() && __ps().currIndex, cap: (document.querySelector('.pswp__figv-cap') || {}).textContent }));
  ok('the arrow key goes to the next, and its caption follows', g2.at === 2 && /^Third/.test(g2.cap || ''), JSON.stringify(g2));
  /* PhotoSwipe draws its arrows only where there is a mouse; on a touch screen,
     as this page is, a swipe does it (below). The button is still wired. */
  await page.evaluate(() => document.querySelector('.pswp__button--arrow--prev').click()); await settle(700);
  ok('the previous-figure button goes back', await page.evaluate(() => __ps() && __ps().currIndex === 1));
  /* A swipe, as a finger does it: one pointer, sideways. */
  const swiped = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const ps = __ps(), el = document.querySelector('.pswp__scroll-wrap');
    const b = el.getBoundingClientRect(), y = b.top + b.height / 2;
    const pe = (t, x) => el.dispatchEvent(new PointerEvent(t, { pointerId: 7, pointerType: 'touch', isPrimary: true,
      clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: t === 'pointerup' ? 0 : 1 }));
    /* A frame a move, as the pinch above: PhotoSwipe moves the slide in its animation frame, and moves spaced by a timer were
       all handled before one frame on a busy CI runner, which saw no swipe. Then up to three seconds for the slide to land. */
    const frame = () => new Promise(r => requestAnimationFrame(() => r()));
    pe('pointerdown', b.left + b.width * 0.8);
    for (let k = 1; k <= 10; k++) { pe('pointermove', b.left + b.width * (0.8 - k * 0.06)); await frame(); await frame(); }
    pe('pointerup', b.left + b.width * 0.2);
    for (let t = 0; t < 60 && ps.currIndex !== 2; t++) await wait(50);
    return ps.currIndex;
  });
  ok('a swipe goes to the next figure', swiped === 2, String(swiped));
  await close();

  head('a figure from a card brings the card\'s other figures');
  const fromEl = await page.evaluate(async () => {
    if (typeof openFigureFrom !== 'function') return null;
    const box = document.createElement('div'); box.className = 'fig-list';
    box.innerHTML = [1, 2, 3].map(i => `<figure class="ai-fig" onclick="openFigureFrom(this)"><img src="${__svg(300 + i * 50, 200)}" alt="Fig ${i}"><figcaption>Figure ${i}<span>Note ${i}</span></figcaption></figure>`).join('');
    document.body.appendChild(box);
    const ps = await __rest(await openFigureFrom(box.children[2]));
    const out = ps ? { n: ps.getNumItems(), at: ps.currIndex, cap: document.querySelector('.pswp__figv-cap').textContent } : null;
    closePeek(); box.remove();
    return out;
  });
  ok('tapping the third of three opens all three, at the third', !!fromEl && fromEl.n === 3 && fromEl.at === 2, JSON.stringify(fromEl));
  ok('with its own caption and the note it came from', !!fromEl && /Figure 3/.test(fromEl.cap) && /Note 3/.test(fromEl.cap), fromEl && fromEl.cap);

  head('a figure that will not load still opens, and says so');
  const broken = await page.evaluate(async () => {
    const ps = await __rest(await openFigure('no-such-figure.webp', 'A missing figure', 'Nowhere'));
    await new Promise(r => setTimeout(r, 600));
    const msg = document.querySelector('.pswp__error-msg');
    return { open: !!document.querySelector('.pswp'), msg: msg ? msg.textContent : '', shown: !!msg && msg.getBoundingClientRect().height > 0,
      cap: (document.querySelector('.pswp__figv-cap') || {}).textContent || '' };
  });
  ok('the viewer opens over a figure that fails', broken.open === true);
  ok('and says it could not be loaded, rather than showing an empty box', broken.shown && /could not be loaded/.test(broken.msg), broken.msg);
  ok('its caption still says what it was', /A missing figure/.test(broken.cap), broken.cap);
  await page.keyboard.press('Escape');
  ok('and it closes like any other', await closes());

  head('the question dialog is left alone');
  /* peekQuestion shows a related question and has no image: it must not open
     the figure viewer just because it shares closePeek. */
  const peek = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    closePeek();
    if (typeof peekQuestion !== 'function') return { opened: null, viewer: null };
    peekQuestion(POOL[0].id);
    await wait(80);
    return { opened: !!document.querySelector('.peek-card'), viewer: !!document.querySelector('.pswp') };
  });
  ok('it still opens', peek.opened === true);
  ok('and the figure viewer does not', peek.viewer === false, String(peek.viewer));
  await close();

  head('a question\'s figures open full screen from the card');
  const qf = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const q = POOL.find(x => x.img && IMGS[x.id] && IMGS[x.id].length > 1) || POOL.find(x => x.img && IMGS[x.id] && IMGS[x.id].length);
    if (!q) return { none: true };
    startAdhocQuiz([q], q.ch);
    for (let t = 0; t < 80 && !document.querySelector('.fig-slot .fig-full'); t++) await wait(25);
    const btns = document.querySelectorAll('.fig-slot .fig-full');
    return { none: false, n: IMGS[q.id].length, btns: btns.length, label: btns[0] && btns[0].getAttribute('aria-label') };
  });
  ok('each figure card has a full-screen button, named', !qf.none && qf.btns === qf.n && /full screen/.test(qf.label || ''), JSON.stringify(qf));
  /* No button to tap is three failures, not a suite that dies reaching for it. */
  if (!qf.none && !qf.btns) {
    ok('it opens the question\'s figures, at the one tapped', false, 'no button to tap');
    ok('and does not also zoom the card in place', false, 'no button to tap');
    ok('Escape gives the question back', false, 'no button to tap');
  } else if (!qf.none) {
    const last = qf.n - 1;
    await page.locator('.fig-slot .fig-full').nth(last).click();
    const qOpen = await page.evaluate(async () => {
      const ps = await __rest(__ps());
      return ps ? { n: ps.getNumItems(), at: ps.currIndex, zoomed: S.zoomed } : null;
    });
    ok('it opens the question\'s figures, at the one tapped', !!qOpen && qOpen.n === qf.n && qOpen.at === last, JSON.stringify(qOpen));
    ok('and does not also zoom the card in place', !!qOpen && qOpen.zoomed === -1, qOpen && String(qOpen.zoomed));
    await page.keyboard.press('Escape');
    ok('Escape gives the question back', await closes() && await page.evaluate(() => S.screen === 'quiz'));
  }

  head('a TALL figure is whole at Fit');
  {
    /* The bug this defends against shipped and was found on an iPad: fitting
       the WIDTH says nothing about the height, so a book-page crop overflowed.
       Every figure in the suite until then was wider than it was tall. */
    const fit = (w, h, extra) => page.evaluate(async ([w, h, extra]) => {
      const ps = await __rest(await openFigure(__svg(w, h, extra), 'A figure', 'Source'));
      if (!ps) return null;
      const i = ps.currSlide.content.element.getBoundingClientRect(), b = ps.element.getBoundingClientRect();
      return { pct: (document.querySelector('.pswp__figv-pct') || {}).textContent,
        fitted: Math.abs(ps.currSlide.currZoomLevel - ps.currSlide.zoomLevels.initial) < 1e-6,
        overflowTop: b.top - i.top, overflowBottom: i.bottom - b.bottom, overflowSide: Math.max(b.left - i.left, i.right - b.right),
        imgW: Math.round(i.width), imgH: Math.round(i.height) };
    }, [w, h, extra || '']);
    const tall = await fit(300, 2000, '<rect y="0" width="300" height="40" fill="#f00"/><rect y="1960" width="300" height="40" fill="#00f"/>');
    ok('the tall figure opened, fitted', !!tall && tall.fitted === true);
    ok('its top edge is inside the viewer', !!tall && tall.overflowTop <= 1, tall ? `${Math.round(tall.overflowTop)}px above` : '—');
    ok('and its bottom edge', !!tall && tall.overflowBottom <= 1, tall ? `${Math.round(tall.overflowBottom)}px below` : '—');
    ok('reported as 100%, because fitted is what it is', !!tall && tall.pct === '100%', tall ? String(tall.pct) : '—');
    ok('its aspect ratio intact, contained and not squashed', !!tall && Math.abs(tall.imgW / tall.imgH - 300 / 2000) < 0.02, tall ? `${tall.imgW}x${tall.imgH}` : '—');
    await close();
    const wide = await fit(2400, 300);
    ok('a wide figure fits its width too', !!wide && wide.overflowSide <= 1, wide ? `${Math.round(wide.overflowSide)}px past a side` : '—');
    ok('and keeps its own aspect ratio', !!wide && Math.abs(wide.imgW / wide.imgH - 8) < 0.1, wide ? `${wide.imgW}x${wide.imgH}` : '—');
    await close();
  }

  head('the real bank fits, at the frames real devices produce');
  {
    /* THE FIXTURE WAS THE BUG. Every check above this line opens a 400x300
       grey rectangle — a shape that fits any frame, in a portrait-ish viewport
       no iPad is held in. The app ships 408 figures with a median height of
       825px, and 401 of them were clipped at "Fit" on an 11-inch iPad in
       landscape while 29 checks reported green. Synthetic fixtures test the
       code; they do not test the app. These open the actual figures. */
    const sizes = await page.evaluate(async () => {
      /* Dimensions straight from the WebP/PNG header — no decode, so all 408
         can be read without a gigabyte of bitmaps.

         TWO DELIVERY SHAPES, ONE HEADER. In the single file every figure is a
         data: URI; in the split build the same figure is a path under
         content/figures/ that the browser fetches. This read data: only, so
         against the served build atob() had nothing to decode and it reported
         "0 of 408 figures" — and then `sizes.tallest.u` threw on undefined and
         took the rest of the suite with it. Measured on a fixture of 140
         synthetic headers served over HTTP: data:-only read 0, this reads 140
         in 211ms. The bytes are the same bytes either way, so the parser below
         is unchanged; only getting hold of them differs.

         The fetch asks for a Range and takes the first chunk regardless —
         scripts/serve.js does not implement 206, so the saving comes from
         cancelling the body after the header rather than from the header
         being honoured. */
      const urls = [];
      try { for (const id in IMGS) { const l = IMGS[id]; if (l) for (const u of l) if (typeof u === 'string') urls.push(u); } } catch (_) {}
      const bytesOf = async u => {
        if (/^data:/i.test(u)) {
          const i = u.indexOf(','); if (i < 0) return null;
          let bin; try { bin = atob(u.slice(i + 1, i + 1 + 120)); } catch (_) { return null; }
          const a = new Uint8Array(bin.length);
          for (let k = 0; k < bin.length; k++) a[k] = bin.charCodeAt(k);
          return a;
        }
        try {
          const r = await fetch(u, { headers: { Range: 'bytes=0-127' } });
          if (!r.ok) return null;
          const rd = r.body.getReader();
          const parts = []; let got = 0;
          while (got < 32) {
            const { value, done } = await rd.read();
            if (done) break;
            parts.push(value); got += value.length;
          }
          try { await rd.cancel(); } catch (_) {}
          const a = new Uint8Array(got); let o = 0;
          for (const part of parts) { a.set(part, o); o += part.length; }
          return a;
        } catch (_) { return null; }
      };
      const head = a => {
        if (!a || a.length < 32) return null;
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
      /* Sixteen at a time: 408 sequential round trips is a suite that takes
         minutes, 408 at once is a connection pool the server has to queue
         anyway. */
      for (let i = 0; i < urls.length; i += 16) {
        const got = await Promise.all(urls.slice(i, i + 16).map(async u => ({ u, a: await bytesOf(u) })));
        for (const g of got) { const dd = head(g.a); if (dd && dd[0] && dd[1]) out.push({ u: g.u, w: dd[0], h: dd[1] }); }
      }
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

    /* NOT DEREFERENCED ON AN EMPTY READ. When the two checks above fail there
       is no tallest figure, and `sizes.tallest.u` below threw a TypeError that
       ended the suite — so the four checks after it reported nothing at all and
       the runner showed a suite that DIED where it should have shown a suite
       that FAILED. Those are different diagnoses and only one of them points at
       the build. An empty read now feeds the frames below an empty list, which
       fails them on `seen >= 8` and says why. */
    const haveFigs = !!(sizes.tallest && sizes.highest && sizes.sample && sizes.sample.length);
    const noneWhy = 'no figure header could be read from this build';

    /* The frames an iPad actually produces, landscape first — the orientation
       in which the bug was total and which no other suite exercises here. */
    const frames = [
      ['iPad 11" landscape', 1194, 834],
      ['iPad 11" portrait', 834, 1194],
      ['iPhone portrait', 430, 932],
    ];
    const worstOf = async list => page.evaluate(async urls => {
      let worst = 0, at = '', seen = 0;
      for (const u of urls) {
        closePeek();
        const ps = await __rest(await openFigure(u, 'Real figure', 'Bank'));
        const img = ps && ps.currSlide && ps.currSlide.content.element;
        if (!img || img.tagName !== 'IMG' || !img.naturalWidth) continue;
        /* At rest (after the opening animation): every edge of the picture
           inside the viewer's own box. */
        const i = img.getBoundingClientRect(), b = ps.element.getBoundingClientRect();
        const over = Math.max(0, b.left - i.left, i.right - b.right, b.top - i.top, i.bottom - b.bottom);
        if (over > worst) { worst = Math.round(over); at = img.naturalWidth + 'x' + img.naturalHeight; }
        seen++;
      }
      closePeek();
      return { worst, at, seen };
    }, list);

    for (const [name, w, h] of frames) {
      await resized(page, w, h);
      await page.waitForTimeout(220);
      const list = haveFigs
        ? [sizes.tallest.u, sizes.highest.u].concat(sizes.sample.map(x => x.u)) : [];
      const r = await worstOf(list);
      ok(`${name}: every sampled figure fits at Fit`, r.worst <= 1 && r.seen >= 8,
         haveFigs
           ? `${r.seen} figures, worst overflow ${r.worst}px${r.worst > 1 ? ' on ' + r.at : ''}`
           : noneWhy);
    }

    /* The single worst case in the bank, named, so a partial fix that handles
       the median and not the extreme cannot pass. */
    await resized(page, 1194, 834);
    await page.waitForTimeout(220);
    const extreme = await worstOf(haveFigs ? [sizes.tallest.u] : []);
    ok('the tallest figure in the bank fits too',
       extreme.worst <= 1 && extreme.seen === 1,
       haveFigs ? `${sizes.tallest.w}x${sizes.tallest.h}, overflow ${extreme.worst}px` : noneWhy);

    await resized(page, 900, 1000);
    await page.waitForTimeout(220);
  }

  head('no stray errors');
  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
