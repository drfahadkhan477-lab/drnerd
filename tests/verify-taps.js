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
 *
 * A tap also leaves something behind. On a touch screen the element that was tapped goes on matching :hover until something
 * else is tapped, so a hover style that applies where nothing can hover is left on the screen: the Flag button, tapped on and
 * then off, stayed amber with no flag set. The last section holds every :hover rule to the media query that asks for hover, as
 * the stylesheets stand, and holds the Flag button to looking as it did.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, settled, onScreen, quiet, resized, watchTransitions } = require('./_render.js');
const { impliesHover } = require('./_hover.js');

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
    /* Measured on Study, where the bar carries all four: on a tablet's Home,
       Echo moves into the rail, and is measured there below. */
    await page.evaluate(() => { goStudy(); render(); });
    await onScreen(page, 'study');
    await settled(page, () => !window.__vtLive, { label: 'the view transition to Study to finish' });
    await quiet(page);
    const btns = await under('.nav .icon-btn', 21, 21), brand = await under('.nav-brand', 21, 21);
    ok('the bar has icon buttons, and a brand, to measure', btns.length >= 4 && brand.length === 1, `${btns.length} buttons`);
    ok('every icon button takes a press anywhere within 21 px of its centre: corners, edges and middle', btns.every(b => b.wrong === 0), JSON.stringify(btns.filter(b => b.wrong)));
    ok('and the brand takes one anywhere within 21 px of its centre', brand.every(b => b.wrong === 0), JSON.stringify(brand));
    ok('they are still drawn at the size they were: nothing in the bar moved', btns.every(b => b.w === 36 && b.h === 36) && brand[0].h === 42, JSON.stringify([btns.map(b => b.w + 'x' + b.h), brand[0].h]));
    const gap = await page.evaluate(() => { const b = [...document.querySelectorAll('.nav .icon-btn')].map(e => e.getBoundingClientRect()).sort((a, c) => a.left - c.left); return b.slice(1).map((r, i) => Math.round(r.left - b[i].right)); });
    ok('and the buttons are far enough apart that the slops meet and do not cross', gap.every(g => g >= 8), JSON.stringify(gap));
  }
  {
    await page.evaluate(() => { goHome(); render(); });
    await onScreen(page, 'home', { marker: '.hero-h1' });
    await settled(page, () => !window.__vtLive, { label: 'the view transition to Home to finish' });
    await quiet(page);
    const rail = await under('#homeEchoLink', 21, 21);
    ok('on Home, Echo is in the rail, and takes a press anywhere within 21 px of its centre',
       rail.length === 1 && rail[0].w >= 44 && rail[0].h >= 44 && rail[0].wrong === 0, JSON.stringify(rail));
    const home = await page.evaluate(() => [...document.querySelectorAll('.nav .icon-btn')].map(b => b.getAttribute('onclick') || b.id));
    ok('and not in the bar there as well', !home.some(c => /goEcho/.test(c)), JSON.stringify(home));
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

  head('no hover style applies where there is no hover');
  {
    /* A finger leaves :hover behind. On a touch screen the element that was tapped goes on matching :hover until something else
       is tapped, so a hover style that is not asked for only where a pointer can hover stays on the screen after the tap: the
       Flag button, tapped on and then off, stayed amber with no flag set. The stylesheets are walked as the browser holds them,
       and a :hover rule counts as asked-for only if a media query on the way down applies only where a device can hover, which
       tests/_hover.js decides (a query that merely mentions the words does not: a negation, an "or", a list with a query that
       every device satisfies). The same function reads the stylesheets as text in tests/verify-hover-pure.js. CSS reads :HOVER as
       :hover, and the engine hands the walk the selector in lower case whichever the sheet wrote (measured on Chromium and WebKit),
       so the test below is on lower case; the sheet it is tried on holds a rule written :HOVER, so that an engine that stopped
       doing so would fail that check and not let a capitalised rule through. */
    const WALK = `(() => {
      const impliesHover = ${impliesHover.toString()};
      const guarded = [], bare = []; let sheets = 0, rules = 0;
      const visit = (list, safe) => {
        for (const r of list) {
          rules++;
          if (r.selectorText && /:hover/.test(r.selectorText)) (safe ? guarded : bare).push(r.selectorText);
          if (r.cssRules && r.cssRules.length) visit(r.cssRules, safe || !!(r.media && impliesHover(r.media.mediaText)));
        }
      };
      for (const s of document.styleSheets) { let list; try { list = s.cssRules; } catch (_) { continue; } sheets++; visit(list, false); }
      return { sheets, rules, guarded, bare };
    })()`;
    /* The walk is tried on a sheet of its own first: one :hover rule that nothing guards and one that a media query does. A walk
       that finds neither, or both on the same side, measures nothing. */
    await page.evaluate(() => {
      const s = document.createElement('style'); s.id = 'hoverProbe';
      s.textContent = '.zz-bare:hover{color:red}@media (hover:hover){.zz-guarded:hover{color:red}}' +
                      '@media not (hover:hover){.zz-not:hover{color:red}}@media (hover:hover), (min-width:1px){.zz-list:hover{color:red}}' +
                      '@media (any-hover:hover){.zz-any:hover{color:red}}.zz-upper:HOVER{color:red}';
      document.head.appendChild(s);
    });
    const probe = await page.evaluate(WALK);
    await page.evaluate(() => document.getElementById('hoverProbe').remove());
    ok('the walk tells a :hover rule nothing guards from one a media query does, finds one written :HOVER, and takes none of the negation of the query, a list holding a query every device satisfies, or (any-hover: hover), which a mouse beside a touch screen satisfies, for a guard',
       ['.zz-bare:hover', '.zz-not:hover', '.zz-list:hover', '.zz-any:hover', '.zz-upper:hover'].every(s => probe.bare.includes(s)) && probe.guarded.includes('.zz-guarded:hover') && !probe.bare.includes('.zz-guarded:hover'),
       `bare ${probe.bare.length}, guarded ${probe.guarded.length}`);
    const walk = await page.evaluate(WALK);
    ok('and it reads the app\'s own stylesheets, which hold :hover rules that are guarded', walk.sheets >= 1 && walk.guarded.length > 0, `${walk.sheets} sheets, ${walk.rules} rules, ${walk.guarded.length} guarded`);
    ok('no :hover rule applies on a device that cannot hover', walk.bare.length === 0, `${walk.bare.length} bare: ${walk.bare.slice(0, 4).join(' | ')}`);

    /* And the thing it is for, on a touch screen: the Flag button tapped on and off looks as it did before the first tap. */
    const touch = await browser.newContext({ viewport: { width: 834, height: 1194 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const tp = watch(await touch.newPage(), events, 'touch');
    tp.on('pageerror', e => errors.push(e.message));
    await watchTransitions(tp);
    await tp.goto(URL, { waitUntil: 'load', timeout: 200000 });
    await booted(tp);
    await tp.evaluate(() => { startAdhocQuiz(POOL.filter(q => q.o.length >= 4 && !q.imgopt).slice(0, 3), null); });
    await onScreen(tp, 'quiz', { marker: '.btn-flag' });
    await quiet(tp);
    const still = () => settled(tp, () => { const b = document.querySelector('.btn-flag'); return !!b && b.getAnimations().length === 0; }, { label: 'the Flag button to have no transition running' });
    const looks = () => tp.evaluate(() => { const b = document.querySelector('.btn-flag'), c = getComputedStyle(b); return { look: [c.color, c.borderTopColor, c.backgroundColor].join(' | '), on: b.classList.contains('on'), hover: b.matches(':hover') }; });
    ok('the page is one that cannot hover, as a thumb on an iPad is', await tp.evaluate(() => !matchMedia('(hover: hover)').matches && matchMedia('(pointer: coarse)').matches));
    /* The page drops a second tap that comes within 350 ms of the first on a control (its guard against a double-tap zoom, so
       that a stray second tap does not misfire), and a tap dropped is a toggle that does not toggle. The window is waited out
       before each tap: it is a precondition of tapping, not what is being measured. */
    const tappable = () => settled(tp, () => Date.now() - lastTap > 400, { label: 'the page\'s double-tap guard (350 ms) to have run out' });
    await still();
    const rest = await looks();
    await tappable();
    await tp.tap('.btn-flag');
    await settled(tp, () => document.querySelector('.btn-flag').classList.contains('on'), { label: 'the Flag button to be on' });
    await tappable();
    await tp.tap('.btn-flag');
    await settled(tp, () => !document.querySelector('.btn-flag').classList.contains('on'), { label: 'the Flag button to be off again' });
    await still();
    const after = await looks();
    ok('the Flag button was on, and is off again, and the finger that tapped it left it under :hover (so this measures what a tap leaves)', rest.on === false && after.on === false && after.hover === true, JSON.stringify({ rest: rest.on, after: after.on, hover: after.hover }));
    ok('and it looks as it did before the first tap', after.look === rest.look, `${rest.look}  →  ${after.look}`);
    await touch.close();
  }

  head('nothing throws');
  ok('no page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
