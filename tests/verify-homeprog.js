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

  head('the legend ranks its two numbers the way their bars already rank them');
  /* The mastered bar is a glowing teal gradient; the seen bar is a flat 30%
     wash. The numbers beside them used to be byte-identical to each other —
     same colour, same weight — so the card gave the reader two contradictory
     rankings of the same pair. This asserts the numbers agree with the bars:
     mastered is strictly the stronger of the two, by weight and by contrast. */
  {
    const r = await page.evaluate(async () => {
      goHome(); render();
      const card = document.getElementById('homeProgress');
      const stats = [...card.querySelectorAll('.hp-stat')];
      const mast = stats.find(s => !s.classList.contains('hp-stat-sub'));
      const seen = stats.find(s => s.classList.contains('hp-stat-sub'));
      const read = el => { const n = el && el.querySelector('.hp-num'); if (!n) return null;
        const cs = getComputedStyle(n); return { color: cs.color, weight: +cs.fontWeight }; };
      return { mast: read(mast), seen: read(seen) };
    });
    ok('both numbers are present and separately identifiable', !!(r.mast && r.seen), JSON.stringify(r));
    ok('they are no longer styled identically to each other',
       !!(r.mast && r.seen) && !(r.mast.color === r.seen.color && r.mast.weight === r.seen.weight),
       `mastered ${r.mast && r.mast.color}/${r.mast && r.mast.weight} vs seen ${r.seen && r.seen.color}/${r.seen && r.seen.weight}`);
    ok('and the mastered number is the heavier of the two',
       !!(r.mast && r.seen) && r.mast.weight > r.seen.weight,
       `${r.mast && r.mast.weight} vs ${r.seen && r.seen.weight}`);
  }

  head('every word in the legend clears WCAG AA, on all eight themes');
  /* Measured, not eyeballed, and across every theme rather than whichever one
     happened to be open. This began as a check on the hierarchy fix above and
     found something worse on the way: the legend's labels were painted in
     --dim, the app's decorative tertiary token, which lands at 2.3:1 on the
     two default light themes. These are not decoration — they are the words
     that say what the number beside them counts.

     Contrast is computed against the card's own composited background, and
     the card is only sampled once its entrance animation has actually
     finished: read a frame too early and every element reports the
     background's own colour back at you, which scores a perfect 1.00 and
     looks like a catastrophic failure rather than a mistimed measurement. */
  {
    const results = await page.evaluate(async () => {
      const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      const ratio = (a, b) => { const la = lum(a), lb = lum(b);
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
      const parse = s => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null;
        const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
        return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 }; };
      const over = (fg, bg) => fg.rgb.map((c, i) => Math.round(c * fg.a + bg[i] * (1 - fg.a)));
      const stack = el => { let a = 1, n = el;
        while (n && n !== document.documentElement) { a *= parseFloat(getComputedStyle(n).opacity || '1'); n = n.parentElement; }
        return a; };

      const out = [];
      for (const t of THEMES) {
        S.theme = t.id; applyTheme(); goHome(); render();
        // wait for the card's entrance to finish rather than guessing a delay
        let card = null;
        for (let i = 0; i < 60; i++) {
          card = document.getElementById('homeProgress');
          if (card && stack(card) > 0.999) break;
          await new Promise(r => requestAnimationFrame(r));
        }
        if (!card || stack(card) <= 0.999) { out.push({ theme: t.id, error: 'card never settled' }); continue; }
        const pageRaw = parse(getComputedStyle(document.body).backgroundColor);
        const pageBg = pageRaw && pageRaw.a === 1 ? pageRaw.rgb : [255, 255, 255];
        const cardRaw = parse(getComputedStyle(card).backgroundColor);
        const cardBg = cardRaw ? over(cardRaw, pageBg) : pageBg;
        const worst = { part: null, r: Infinity };
        for (const [sel, part] of [['.hp-stat', 'label'], ['.hp-num', 'number'], ['.hp-stat-count', 'count']]) {
          for (const el of card.querySelectorAll(sel)) {
            const c = parse(getComputedStyle(el).color);
            if (!c) continue;
            const rr = ratio(over({ rgb: c.rgb, a: c.a * stack(el) }, cardBg), cardBg);
            if (rr < worst.r) { worst.r = rr; worst.part = part; }
          }
        }
        out.push({ theme: t.id, worst: +worst.r.toFixed(2), part: worst.part });
      }
      S.theme = 'auto'; applyTheme(); goHome(); render();
      return out;
    });
    for (const r of results) {
      ok(`${r.theme}: the least-readable thing in the legend still clears AA`,
         !r.error && r.worst >= 4.5, r.error || `${r.worst}:1 (${r.part})`);
    }
  }

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
