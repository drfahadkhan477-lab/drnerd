#!/usr/bin/env node
/*
 * The Chapters screen: a stagger that actually staggers, and a bar that
 * actually fills instead of arriving pre-drawn.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-chapters.js /path/to/build.html
 *
 * A METHODOLOGY NOTE, because it cost real time to work out and is worth
 * writing down rather than rediscovering later. goStudy()'s render() goes
 * through document.startViewTransition on a screen change, which mutates the
 * DOM synchronously inside its callback but leaves Chromium's headless
 * renderer in a state where a DOM reference CAPTURED IN THE SAME TICK as that
 * call returns empty strings from getComputedStyle for a few hundred
 * milliseconds — even though the node is real, attached, and correctly
 * styled. A FRESH querySelector a moment later, on what is provably the same
 * node, reads real geometry immediately. So: never hold a reference captured
 * before or during a screen-changing render(); always requery after a short
 * settle, and never conclude a fill animation is broken from a reading taken
 * in that window.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-chapters.js <patched.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 430, height: 1400 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
  await page.waitForTimeout(1000);

  head('the page cascades top to bottom, like the home screen does');
  /* Every piece here already animated on its own — the rail's own popIn
     ladder, the tile grid's own 11-step ladder, the title's own riseIn. What
     was missing is that none of them were SEQUENCED: all fired at delay 0,
     so the title, the rail, the feed and the first tile all appeared on the
     same frame. studyflow gives each section a base delay instead of adding
     new animation, so the real claim is ordering, not novelty. */
  {
    const r = await page.evaluate(() => {
      goStudy(); render();
      const delayOf = sel => { const el = document.querySelector(sel); return el ? parseFloat(getComputedStyle(el).animationDelay) : null; };
      return {
        back: delayOf('.study-back'),
        title: delayOf('.study-title'),
        rail: delayOf('.story-rail .story'),
        feed: delayOf('.feed .feed-card'),
        label: delayOf('.section-label'),
        tiles: delayOf('.ch-tiles>*'),
      };
    });
    const order = ['back', 'title', 'rail', 'feed', 'label', 'tiles'];
    const values = order.map(k => r[k]);
    ok('every section has a real, present delay', values.every(v => v !== null && Number.isFinite(v)), JSON.stringify(r));
    const ascending = values.every((v, i) => i === 0 || v >= values[i - 1]);
    ok('and the sections cascade in the order they appear on the page, not all at once',
       ascending, order.map(k => `${k}=${r[k]}s`).join(' < '));
    ok('the whole cascade spans a real amount of time, not a rounding difference',
       values[values.length - 1] - values[0] >= 0.3, `${values[0]}s → ${values[values.length - 1]}s`);
  }

  head('the eleven tiles stagger in, they do not all fire on the same frame');
  {
    const r = await page.evaluate(async () => {
      goStudy(); render();
      await new Promise(res => setTimeout(res, 100));
      const tiles = [...document.querySelectorAll('.ch-tiles>*')];
      return { count: tiles.length, delays: tiles.map(t => getComputedStyle(t).animationDelay) };
    });
    ok('all eleven chapters are present', r.count === 11, String(r.count));
    const parsed = r.delays.map(d => parseFloat(d));
    const allZero = parsed.every(d => d === 0);
    const strictlyIncreasing = parsed.every((d, i) => i === 0 || d >= parsed[i - 1]);
    const spread = Math.max(...parsed) - Math.min(...parsed);
    ok('the delays are not all zero — the tiles actually stagger', !allZero, r.delays.join(', '));
    ok('and they climb in order rather than being assigned at random', strictlyIncreasing);
    ok('with a spread wide enough to see with the eye', spread >= 0.2, `${spread.toFixed(2)}s`);
  }

  head('a chapter bar starts empty and fills to its real value');
  {
    const r = await page.evaluate(async () => {
      for (let i = 0; i < 200; i++) {
        const q = POOL[i]; if (!q) break;
        S.srs[q.id] = { difficulty: 5, stability: 12 + (i % 40), ivl: 20, reps: 3, lapses: 0, last: '2026-08-20', due: '2026-09-20' };
      }
      goStudy(); render();
      // Deliberately not read yet — see the file header on why an immediate
      // read here would be measuring the view-transition's settling, not the
      // fill animation.
      await new Promise(res => setTimeout(res, 80));
      const bar = document.querySelector('.ct-bar i[data-w]');
      return { targetPct: +bar.dataset.w, atSettle: bar.getBoundingClientRect().width };
    });

    // The 80ms settle above is itself real time into a 1s ease-out transition,
    // so its own reading is frame zero — sampling starts from there, not
    // after another wait, or the true beginning of the fill is never seen.
    const frames = [r.atSettle];
    for (let t = 150; t <= 1000; t += 150) {
      await page.waitForTimeout(150);
      const w = await page.evaluate(() => {
        const bar = document.querySelector('.ct-bar i[data-w]');
        return bar ? bar.getBoundingClientRect().width : null;
      });
      frames.push(w);
    }
    const finalPx = frames[frames.length - 1];
    ok('the target width is a real, checkable percentage', r.targetPct > 0 && r.targetPct <= 100, String(r.targetPct));
    /* --glide (cubic-bezier(.22,1,.36,1)) is a deliberately steep ease-out, so
       an early reading is not near literal zero — it is already a real
       fraction of the way there. What the original bug actually looked like
       was the bar arriving PRE-DRAWN at its exact final width with no frame
       in between, so the meaningful claim is "the earliest reading is
       genuinely short of the target", not "close to zero". */
    ok('the bar has not already reached its final width the first time it is seen',
       frames[0] < finalPx * 0.9, `first reading ${frames[0].toFixed(1)}px of ${finalPx.toFixed(1)}px final`);
    const rises = frames.every((w, i) => i === 0 || w >= frames[i - 1] - 0.5);
    ok('and rises monotonically rather than jumping straight there', rises, frames.map(f => f.toFixed(1)).join(','));
    const grew = finalPx > frames[0] + 20;
    ok('ending materially wider than it started', grew, `${frames[0].toFixed(1)}px → ${finalPx.toFixed(1)}px`);
  }

  head('reduced motion still reaches the right width, just without the transition');
  {
    const page2 = await browser.newPage({ viewport: { width: 430, height: 1400 } });
    await page2.emulateMedia({ reducedMotion: 'reduce' });
    await page2.goto(URL, { waitUntil: 'load', timeout: 200000 });
    await page2.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
    await page2.waitForTimeout(900);
    const r = await page2.evaluate(async () => {
      const q = POOL[0];
      S.srs[q.id] = { difficulty: 5, stability: 20, ivl: 20, reps: 3, lapses: 0, last: '2026-08-20', due: '2026-09-20' };
      goStudy(); render();
      await new Promise(res => setTimeout(res, 200));
      const bar = document.querySelector('.ct-bar i[data-w]');
      const transitionDuration = getComputedStyle(bar).transitionDuration;
      return { widthPx: bar.getBoundingClientRect().width, target: +bar.dataset.w, transitionDuration };
    });
    /* The app carries one universal rule for this —
       *,*::before,*::after{transition-duration:.001ms!important} — rather
       than each animated element repeating its own override, and .ct-bar i
       deliberately does not repeat it either (see chapters-patch.js). So the
       real, honest claim is "effectively instant", not literally "0s": a
       chosen near-zero epsilon rather than a hard zero is what lets
       transitionend still fire reliably, and this component inherits that
       choice rather than making its own. */
    ok('the universal reduced-motion rule reaches this bar too',
       parseFloat(r.transitionDuration) < 0.01, r.transitionDuration);
    ok('and the bar still reaches a real, non-zero width', r.widthPx > 0, `${r.widthPx}px`);
    await page2.close();
  }

  head('the tile carries the larger sizing this page now uses');
  {
    const r = await page.evaluate(() => {
      goStudy(); render();
      const ico = document.querySelector('.ct-ico');
      const name = document.querySelector('.ct-name');
      const bar = document.querySelector('.ct-bar');
      return {
        icoWidth: ico ? parseFloat(getComputedStyle(ico).width) : 0,
        nameSize: name ? parseFloat(getComputedStyle(name).fontSize) : 0,
        barHeight: bar ? parseFloat(getComputedStyle(bar).height) : 0,
      };
    });
    ok('the icon badge is larger than the old 38px', r.icoWidth >= 44, `${r.icoWidth}px`);
    ok('the chapter name is larger than the old 13px', r.nameSize >= 14, `${r.nameSize}px`);
    ok('the bar is materially taller than the old 4px', r.barHeight >= 7, `${r.barHeight}px`);
  }

  head('nothing about this overflows a phone-width screen');
  {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    ok('no horizontal scroll at 430px wide', !overflow);
  }

  head('an untouched chapter looks deliberately empty, not broken');
  /* A chapter at 0% used to draw the same flat grey track this app's loading
     skeletons use, so "not started yet" and "failed to load" were pixel-for-
     pixel the same thing. The zero state now dashes the track instead —
     same colour and weight, different texture — and the two must stay
     distinguishable from each other, which is what this asserts: the zero
     tracks carry a repeating gradient and the started ones still do not. */
  {
    const r = await page.evaluate(async () => {
      S.srs = {};
      /* Give exactly one chapter progress and leave the rest untouched, so a
         single render contains both states and the comparison is between two
         tiles on one screen rather than between two runs. */
      const target = POOL[0].ch;
      let n = 0;
      for (const q of POOL) {
        if (q.ch === target && n < 25) {
          S.srs[q.id] = { difficulty: 5, stability: 20, ivl: 20, reps: 3, lapses: 0, last: '2026-08-20', due: '2026-09-20' };
          n++;
        }
      }
      goStudy(); render();
      await new Promise(res => setTimeout(res, 160));
      const read = b => {
        const i = b.querySelector('i[data-w]');
        return { w: i ? +i.dataset.w : null, bg: getComputedStyle(b).backgroundImage };
      };
      const all = [...document.querySelectorAll('.ct-bar')].map(read);
      return { zero: all.filter(x => x.w === 0), started: all.filter(x => x.w > 0) };
    });
    const dashed = s => typeof s === 'string' && s.includes('repeating-linear-gradient');
    ok('the fixture really does put both states on screen at once',
       r.zero.length > 0 && r.started.length > 0, `${r.zero.length} at zero, ${r.started.length} started`);
    ok('every untouched chapter draws a dashed track',
       r.zero.length > 0 && r.zero.every(x => dashed(x.bg)), r.zero.length ? r.zero[0].bg.slice(0, 70) : 'none found');
    ok('and a chapter with real progress keeps its solid one',
       r.started.length > 0 && r.started.every(x => !dashed(x.bg)), r.started.length ? r.started[0].bg.slice(0, 40) : 'none found');
  }

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
