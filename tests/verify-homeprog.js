#!/usr/bin/env node
/*
 * The home-screen progress card: legend, due pill, and the count-up.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-homeprog.js /path/to/build.html
 */
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-homeprog.js <patched.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 430, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
  await page.waitForTimeout(1000);

  head('the card carries a real legend, not a bare bar');
  {
    const r = await page.evaluate(async () => {
      S.sessionTotal = 40; S.sessionCorrect = 31;
      for (let i = 0; i < 250; i++) {
        const q = POOL[i]; if (!q) break;
        S.srs[q.id] = { difficulty: 5, stability: 12 + (i % 40), ivl: 20, reps: 3, lapses: 0, last: '2026-08-20', due: '2026-09-20' };
      }
      render();
      await new Promise(res => setTimeout(res, 0));
      const card = document.getElementById('homeProgress');
      return {
        present: !!card,
        hasTrack: !!card.querySelector('.hp-track'),
        hasSeenFill: !!card.querySelector('.hp-seen'),
        hasMastFill: !!card.querySelector('.hp-mast'),
        legendStats: card.querySelectorAll('.hp-legend .hp-stat').length,
        countText: card.querySelector('.hp-stat-count')?.textContent || '',
        trackHeight: parseFloat(getComputedStyle(card.querySelector('.hp-track')).height),
        cardIsCardlike: getComputedStyle(card).backgroundColor !== 'rgba(0, 0, 0, 0)' &&
                        getComputedStyle(card).borderStyle !== 'none',
      };
    });
    ok('the progress card exists', r.present);
    ok('and is styled as a card, not bare text on the page', r.cardIsCardlike);
    ok('the track is materially taller than the original 9px', r.trackHeight >= 18, `${r.trackHeight}px`);
    ok('both fills are present', r.hasSeenFill && r.hasMastFill);
    ok('a legend explains what each colour means', r.legendStats === 2, String(r.legendStats));
    ok('and a raw count backs the percentages up', /\d+\s+of\s+\d+/.test(r.countText), r.countText);
  }

  head('the numbers climb in step with the bar, then hold');
  {
    const r = await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) S.srs[POOL[i].id] = { difficulty: 5, stability: 1, ivl: 1, reps: 1, lapses: 0, last: '2020-01-01', due: '2020-01-01' };
      render();
      await new Promise(res => setTimeout(res, 0));
      const nums = [...document.querySelectorAll('#homeProgress .hp-num')];
      const targets = nums.map(n => +n.dataset.count);
      const frames = [];
      for (let i = 0; i < 12; i++) {
        await new Promise(res => requestAnimationFrame(res));
        frames.push(nums.map(n => +n.textContent));
      }
      return { targets, frames };
    });
    const allFinite = r.frames.every(f => f.every(v => Number.isFinite(v) && v >= 0));
    ok('every intermediate value is a real, non-negative number', allFinite,
       JSON.stringify(r.frames.find(f => f.some(v => !Number.isFinite(v) || v < 0)) || 'none'));
    const monotonic = r.targets.every((t, i) => {
      const seq = r.frames.map(f => f[i]);
      return seq.every((v, j) => j === 0 || v >= seq[j - 1]);
    });
    ok('each number rises monotonically toward its target, never overshoots or wobbles',
       monotonic, JSON.stringify(r.frames.map(f => f.join(','))));
    const settled = r.frames[r.frames.length - 1];
    ok('and settles on exactly the intended value', JSON.stringify(settled) === JSON.stringify(r.targets),
       `settled ${JSON.stringify(settled)}, targets ${JSON.stringify(r.targets)}`);
  }

  head('reduced motion shows the number, not a frozen zero');
  {
    const page2 = await browser.newPage({ viewport: { width: 430, height: 1000 } });
    await page2.emulateMedia({ reducedMotion: 'reduce' });
    await page2.goto(URL, { waitUntil: 'load', timeout: 200000 });
    await page2.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
    await page2.waitForTimeout(900);
    const r = await page2.evaluate(async () => {
      S.sessionTotal = 10; S.sessionCorrect = 8;
      for (let i = 0; i < 100; i++) {
        const q = POOL[i]; if (!q) break;
        S.srs[q.id] = { difficulty: 5, stability: 20, ivl: 20, reps: 3, lapses: 0, last: '2026-08-20', due: '2026-09-20' };
      }
      render();
      await new Promise(res => setTimeout(res, 60));
      const nums = [...document.querySelectorAll('#homeProgress .hp-num')];
      return { shown: nums.map(n => n.textContent), targets: nums.map(n => n.dataset.count) };
    });
    ok('the displayed value already equals the target — no tween ran',
       JSON.stringify(r.shown) === JSON.stringify(r.targets), `${JSON.stringify(r.shown)} vs ${JSON.stringify(r.targets)}`);
    await page2.close();
  }

  head('the due pill is honest about whether there is anything due');
  {
    const withDue = await page.evaluate(async () => {
      for (let i = 0; i < 3; i++) S.srs[POOL[i].id] = { difficulty: 5, stability: 1, ivl: 1, reps: 1, lapses: 0, last: '2020-01-01', due: '2020-01-01' };
      render();
      await new Promise(res => setTimeout(res, 0));
      return document.querySelectorAll('.hp-due').length;
    });
    ok('a due pill appears when questions are due', withDue === 1, String(withDue));

    const clicked = await page.evaluate(async () => {
      document.querySelector('.hp-due').click();
      await new Promise(res => setTimeout(res, 200));
      return { screen: S.screen, mode: S.mode, got: S.questions.length > 0 };
    });
    ok('clicking it starts a review session', clicked.screen === 'quiz' && clicked.mode === 'due' && clicked.got,
       JSON.stringify(clicked));

    await page.evaluate(() => { goHome(); S.srs = {}; render(); });
    await page.waitForTimeout(200);
    const withoutDue = await page.locator('.hp-due').count();
    ok('and it is gone entirely when nothing is due', withoutDue === 0, String(withoutDue));
  }

  head('it holds up at the extremes');
  {
    const r = await page.evaluate(async () => {
      const before = getComputedStyle(document.getElementById('homeProgress') || {}).display;
      // width sanity: the card must not force horizontal scroll on a narrow phone
      const w1 = document.documentElement.scrollWidth;
      return { w1, viewport: innerWidth };
    });
    ok('no horizontal overflow at 430px wide', r.w1 <= r.viewport + 1, `${r.w1} vs ${r.viewport}`);
  }

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
