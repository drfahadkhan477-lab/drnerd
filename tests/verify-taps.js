#!/usr/bin/env node
/*
 * Touch targets on the way through a question and on the bar every screen carries.
 *
 *   node tests/verify-taps.js build/synthetic/systole.html
 *
 * A thumb is about 44 px: Apple's minimum, and the size the newer controls here are held to by their own suites. Four
 * kinds of control on the oldest screens were 24 to 36:
 *   · the "How sure?" chips before an answer and the "Why did you miss it?" chips after one, which every question passes
 *     through, were 24 px tall, and are 44 now (they wrap, and have nothing to overflow);
 *   · the Back button on the Study screen (35 px) and the welcome card's "Got it" (33 px), 44 now;
 *   · the navigation's icon buttons (36 px) and its brand (42 px), which keep the size they are drawn at and take a press
 *     a few pixels outside it. They are 8 px apart, so the two slops meet in the gap and do not cross: a press near the
 *     edge of one is that one's and never its neighbour's.
 * The slop cannot be seen in a rectangle, so it is read the way a finger reads it: what the browser says is under a point.
 * And none of it may push a control off the phone it is on: at 375 and 320 px the chips and the two buttons lie inside the
 * screen and inside the card that holds them. A card clips what runs past it, so a row of chips made too wide is cut off and
 * the page does not scroll sideways; the chip is the witness, and the page's own width is read beside it.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, onScreen, quiet, resized, watchTransitions } = require('./_render.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-taps.js <build.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

/* In the page: for each control a selector names, whether the browser says that control is what is under each of nine points
   across the square round its centre that reaches dx and dy from it (the corners, the edges and the middle). The slop is made
   44 px square by the stylesheet; a press is read to the half pixel, and where two buttons meet the edge of one is the edge of
   the other at that half pixel, so the points are a pixel inside the 22 the stylesheet gives each side. */
const UNDER = `(sel, dx, dy) => [...document.querySelectorAll(sel)].map(el => {
  const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const pts = [[0, 0], [-dx, -dy], [dx, -dy], [-dx, dy], [dx, dy], [0, -dy], [0, dy], [-dx, 0], [dx, 0]];
  const wrong = pts.filter(([x, y]) => { const u = document.elementFromPoint(cx + x, cy + y); return !(u && u.closest(sel) === el); }).length;
  return { id: el.id || el.className.split(' ')[0], w: Math.round(r.width), h: Math.round(r.height), wrong };
})`;

/* In the page: for each control a selector names, whether it lies inside the phone and inside the card that holds it (the card
   that would clip it, or the page where no card does). Half a pixel is the browser's own rounding. */
const FITS = `(sel) => [...document.querySelectorAll(sel)].map(el => {
  const r = el.getBoundingClientRect(), box = (el.closest('.reveal-card, .q-card') || document.getElementById('app')).getBoundingClientRect();
  return { chip: el.textContent.trim().slice(0, 16), left: Math.round(r.left), right: Math.round(r.right), phone: window.innerWidth,
    out: r.left < Math.max(0, box.left) - 0.5 || r.right > Math.min(window.innerWidth, box.right) + 0.5 };
})`;

(async () => {
  const browser = await launch();
  const errors = [], events = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));
  const page = watch(await browser.newPage({ viewport: { width: 834, height: 1194 } }), events, 'main');
  page.on('pageerror', e => errors.push(e.message));
  await watchTransitions(page);   /* before goto: see _render.js */
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await booted(page);
  const under = (sel, dx, dy) => page.evaluate(`(${UNDER})(${JSON.stringify(sel)}, ${dx}, ${dy})`);
  const tall = sel => page.evaluate(sel => [...document.querySelectorAll(sel)].map(e => e.offsetHeight), sel);
  const wide = () => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  const fits = sel => page.evaluate(`(${FITS})(${JSON.stringify(sel)})`);

  head('the bar every screen carries');
  {
    await page.evaluate(() => { goHome(); render(); });
    await onScreen(page, 'home', { marker: '.hero-h1' });
    await quiet(page);
    const btns = await under('.nav .icon-btn', 21, 21), brand = await under('.nav-brand', 21, 21);
    ok('the bar has icon buttons, and a brand, to measure', btns.length >= 4 && brand.length === 1, `${btns.length} buttons`);
    ok('every icon button takes a press anywhere within 21 px of its centre: corners, edges and middle', btns.every(b => b.wrong === 0), JSON.stringify(btns.filter(b => b.wrong)));
    ok('and the brand takes one anywhere within 21 px of its centre', brand.every(b => b.wrong === 0), JSON.stringify(brand));
    ok('they are still drawn at the size they were: nothing in the bar moved', btns.every(b => b.w === 36 && b.h === 36) && brand[0].h === 42, JSON.stringify([btns.map(b => b.w + 'x' + b.h), brand[0].h]));
    const gap = await page.evaluate(() => { const b = [...document.querySelectorAll('.nav .icon-btn')].map(e => e.getBoundingClientRect()).sort((a, c) => a.left - c.left); return b.slice(1).map((r, i) => Math.round(r.left - b[i].right)); });
    ok('and the buttons are far enough apart that the slops meet and do not cross', gap.every(g => g >= 8), JSON.stringify(gap));
  }

  /* The welcome card is for someone who has answered nothing: the first question answered takes it away for good. Its fit on a
     phone is read before any question is. */
  head('the welcome card and the Back button, on a phone');
  for (const w of [375, 320]) {
    await resized(page, w, 800);
    await page.evaluate(() => { goHome(); render(); });
    await onScreen(page, 'home', { marker: '.hero-h1' });
    await quiet(page);
    const hello = await fits('.hello-x'), home = await wide();
    await page.evaluate(() => { goStudy(); render(); });
    await onScreen(page, 'study', { marker: '#planCard' });
    await quiet(page);
    const back = await fits('.study-back'), study = await wide();
    ok(`at ${w} px the "Got it" button on home and the Back button on Study are inside the phone and the card that holds them`, hello.length === 1 && back.length >= 1 && ![...hello, ...back].some(c => c.out), JSON.stringify([hello.length, back.length, ...hello.filter(c => c.out), ...back.filter(c => c.out)]));
    ok(`and neither home nor Study scrolls sideways`, home.scroll <= home.inner && study.scroll <= study.inner, `home ${home.scroll} of ${home.inner}, Study ${study.scroll} of ${study.inner}`);
  }
  await resized(page, 834, 1194);
  await page.evaluate(() => { goHome(); render(); });
  await onScreen(page, 'home', { marker: '.hero-h1' });
  await quiet(page);

  head('the welcome card, the Back button and the chips are 44 px');
  {
    const hello = await tall('.hello-x');
    ok('the welcome card\'s "Got it" is at least 44 px tall', hello.length === 1 && hello[0] >= 44, JSON.stringify(hello));
    await page.evaluate(() => goStudy());
    await onScreen(page, 'study', { marker: '#planCard' });
    const back = await tall('.study-back');
    ok('the Back button on the Study screen is at least 44 px tall', back.length >= 1 && back.every(h => h >= 44), JSON.stringify(back));

    await page.evaluate(() => { startAdhocQuiz(POOL.filter(q => q.o.length >= 4 && !q.imgopt).slice(0, 3), null); });
    await onScreen(page, 'quiz', { marker: '.opt' });
    await quiet(page);
    const cf = await tall('.cf-chip');
    ok('the "How sure?" chips before an answer are at least 44 px tall', cf.length >= 3 && cf.every(h => h >= 44), JSON.stringify(cf));
    await page.evaluate(() => { const q = S.questions[S.qIdx]; selectOpt((q.ci + 1) % q.o.length); });
    await page.waitForFunction(() => document.querySelectorAll('.miss-chip').length > 0, null, { timeout: 5000 }).then(() => true, () => false);
    const miss = await tall('.miss-chip');
    ok('the "Why did you miss it?" chips after a wrong answer are at least 44 px tall', miss.length >= 3 && miss.every(h => h >= 44), JSON.stringify(miss));
  }

  head('the chips, on a phone');
  for (const w of [375, 320]) {
    await resized(page, w, 800);
    await page.evaluate(() => { startAdhocQuiz(POOL.filter(q => q.o.length >= 4 && !q.imgopt).slice(0, 3), null); });
    await onScreen(page, 'quiz', { marker: '.cf-chip' });
    await quiet(page);
    const cf = await fits('.cf-chip');
    await page.evaluate(() => { const q = S.questions[S.qIdx]; selectOpt((q.ci + 1) % q.o.length); });
    await page.waitForFunction(() => document.querySelectorAll('.miss-chip').length > 0, null, { timeout: 5000 }).then(() => true, () => false);
    await quiet(page);
    const miss = await fits('.miss-chip');
    ok(`at ${w} px the "How sure?" chips are inside the phone and the card that holds them`, cf.length >= 3 && !cf.some(c => c.out), cf.length < 3 ? `${cf.length} chips` : JSON.stringify(cf.filter(c => c.out)));
    ok(`and so are the "Why did you miss it?" chips after a wrong answer`, miss.length >= 3 && !miss.some(c => c.out), miss.length < 3 ? `${miss.length} chips` : JSON.stringify(miss.filter(c => c.out)));
  }

  head('nothing throws');
  ok('no page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
