#!/usr/bin/env node
/*
 * Behavioural checks for the Stage 2 (FSRS) integration, exercised through
 * the real UI rather than the standalone fsrs.js module (that module is
 * verified separately, in isolation, before this ever touches the app).
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-stage2.js /path/to/patched.html
 */
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-stage2.js <patched.html>'); process.exit(1); }
/* Accepts a path (single-file build) or an http URL (the Stage 1 PWA
   build, which has to be served because it fetches its content). */
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/GroupMarker|GL Driver|swiftshader/i.test(m.text())) errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  /* The Stage 1 build injects app.js only after its content fetch resolves,
     so 'load' no longer implies the app has booted. Wait for it explicitly —
     a no-op on the single-file build, where this is already true. */
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  /* The Stage 1 build injects app.js only after its content fetch resolves,
     so 'load' no longer implies the app has booted. Wait for it explicitly —
     a no-op on the single-file build, where this is already true. */
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
  await page.waitForTimeout(1200);

  head('the actual bug: four buttons on a brand-new card, in the real rate-row UI');
  const firstReview = await page.evaluate(() => {
    startQuiz(null, 'due');
    const q = S.questions[0];
    selectOpt(q.ci);
    const scheds = [...document.querySelectorAll('.rate-btn .rate-sched')].map(el => el.textContent);
    const labels = [...document.querySelectorAll('.rate-btn .rate-label')].map(el => el.textContent);
    return { labels, scheds, srsEmpty: !S.srs[q.id] };
  });
  ok('no SRS card exists before rating (this is the first-ever review)', firstReview.srsEmpty);
  ok('four rating buttons are shown', firstReview.labels.length === 4, firstReview.labels.join(', '));
  ok('all four previews are genuinely different intervals',
     new Set(firstReview.scheds).size === 4,
     JSON.stringify(firstReview.labels.map((l, i) => l + '=' + firstReview.scheds[i])));
  ok('Again is the soonest, Easy is the furthest out (monotonic)',
     (() => {
       // fmtInterval is not linearly sortable as text, so re-derive via fsrsPreview directly
       return true; // covered numerically below — this block just documents intent
     })());

  const monotonic = await page.evaluate(() => {
    startQuiz(null, 'due');
    const q = S.questions[0];
    selectOpt(q.ci);
    return [1, 2, 3, 4].map(g => fsrsPreview(S.srs[q.id], g).ivl);
  });
  ok('previewed intervals strictly increase Again < Hard < Good < Easy',
     monotonic[0] < monotonic[1] && monotonic[1] < monotonic[2] && monotonic[2] < monotonic[3],
     JSON.stringify(monotonic));

  head('rating actually schedules the card via FSRS');
  const rated = await page.evaluate(() => {
    startQuiz(null, 'due');
    const q = S.questions[0];
    selectOpt(q.ci);
    const beforeLog = LOG.length;
    rateReview(3);   // Good
    return { card: S.srs[q.id], logEntry: LOG[beforeLog] };
  });
  ok('card now has FSRS fields', rated.card && rated.card.stability !== undefined && rated.card.difficulty !== undefined,
     JSON.stringify(rated.card));
  ok('due date moved forward, not to tomorrow-by-default', rated.card.ivl > 1, 'ivl=' + rated.card.ivl);
  ok('log entry carries the FSRS-scale grade (3=Good)', rated.logEntry.g === 3, JSON.stringify(rated.logEntry));
  ok('log entry counts Good as recalled (ok=1)', rated.logEntry.ok === 1);

  const againOk = await page.evaluate(() => {
    startQuiz(null, 'due');
    const q = S.questions[0];
    selectOpt(q.ci);
    const beforeLog = LOG.length;
    rateReview(1);   // Again
    return { card: S.srs[q.id], logEntry: LOG[beforeLog] };
  });
  ok('Again is logged as not recalled', againOk.logEntry.ok === 0, JSON.stringify(againOk.logEntry));
  ok('Again still schedules at least 1 day out, not 0 or negative', againOk.card.ivl >= 1, 'ivl=' + againOk.card.ivl);

  head('legacy SM-2 card migrates cleanly through a real review');
  const migrated = await page.evaluate(() => {
    const q = ALL_Q.find(x => !x.bad);
    S.srs[q.id] = { ef: 2.3, ivl: 14, reps: 3, due: todayISO(), lapses: 1, last: addDays(todayISO(), -14) };
    Object.assign(S, { screen: 'quiz', chapter: null, questions: [q], qIdx: 0, selected: null,
      answered: false, zoomed: -1, mode: 'due', quizCorrect: 0, quizTotal: 0 });
    render();
    selectOpt(q.ci);
    rateReview(3);
    return S.srs[q.id];
  });
  ok('legacy card gained FSRS fields on its next review', migrated.stability !== undefined, JSON.stringify(migrated));
  ok('legacy card was not silently reset to a tiny fresh stability',
     migrated.stability > 5, 'stability=' + migrated.stability.toFixed(2) +
     ' (seeded from a 14-day-old interval, should land well above a fresh-card init value)');
  ok('no NaN/undefined leaked into the migrated card',
     Number.isFinite(migrated.stability) && Number.isFinite(migrated.difficulty) && Number.isFinite(migrated.ivl));

  head('mastery reads real retrievability, not reps/3');
  const masteryCheck = await page.evaluate(() => {
    // S.srs lives in memory for the page's whole session — localStorage.clear()
    // only wipes the persisted copy, not what earlier test blocks already put
    // in this in-memory object — so reset it directly for a clean slate here.
    S.srs = {}; S.practice = {};
    const ch = CHAPTERS[0];
    const qs = POOL.filter(q => q.ch === ch);
    // one card reviewed long ago (should show low retrievability by now)
    S.srs[qs[0].id] = FSRS.update(null, 3, addDays(todayISO(), -400));
    // one card reviewed moments ago (should show high retrievability)
    S.srs[qs[1].id] = FSRS.update(null, 3, todayISO());
    const m = masteryFor(ch);
    const rOld = FSRS.retrievability(S.srs[qs[0].id].stability, FSRS.daysBetween(S.srs[qs[0].id].last, todayISO()));
    const rNew = FSRS.retrievability(S.srs[qs[1].id].stability, FSRS.daysBetween(S.srs[qs[1].id].last, todayISO()));
    // masteryFor divides by the WHOLE chapter's question count, not just the
    // two cards touched here — compute the same expectation it does, rather
    // than assume a fixed range that only holds for a two-question chapter.
    const expected = (rOld + rNew) / qs.length;
    return { mastery: m, rOld, rNew, expected, chapterSize: qs.length };
  });
  ok('a card reviewed 400 days ago shows low retrievability', masteryCheck.rOld < 0.3, masteryCheck.rOld.toFixed(3));
  ok('a card reviewed today shows high retrievability', masteryCheck.rNew > 0.85, masteryCheck.rNew.toFixed(3));
  ok('chapter mastery matches the retrievability average exactly (not reps/3)',
     Math.abs(masteryCheck.mastery - masteryCheck.expected) < 0.001,
     `mastery=${masteryCheck.mastery.toFixed(4)} expected=${masteryCheck.expected.toFixed(4)} (chapter has ${masteryCheck.chapterSize} questions)`);

  head('progress screen: retention tile and 7-day forecast');
  const noCardsYet = await page.evaluate(() => {
    S.srs = {}; S.practice = {};                  // in-memory reset, see note above
    goStats(); render();
    return { hasRetention: !!document.querySelector('.retention-num') };
  });
  ok('retention tile stays hidden with nothing scheduled yet (no null% shown)', !noCardsYet.hasRetention);

  const statsScreen = await page.evaluate(() => {
    const q = ALL_Q.find(x => !x.bad);
    S.srs[q.id] = FSRS.update(null, 3, todayISO());
    goStats(); render();
    return {
      hasRetention: !!document.querySelector('.retention-num'),
      retentionText: document.querySelector('.retention-num')?.textContent || '',
      forecastBars: document.querySelectorAll('.fc-bar-wrap').length,
    };
  });
  ok('retention tile renders once a card is scheduled', statsScreen.hasRetention);
  ok('retention shows a plausible percentage', /^\d{1,3}%$/.test(statsScreen.retentionText), statsScreen.retentionText);
  ok('7-day forecast strip renders all 7 days', statsScreen.forecastBars === 7, statsScreen.forecastBars);

  head('regression: everything Stage 0 + Apex still functions');
  const reg = await page.evaluate(() => {
    S.srs = {}; S.practice = {};                  // in-memory reset, see note above
    goHome(); render();
    const home = !!document.querySelector('.hero-h1');
    startQuiz('Arrhythmias');
    const q = S.questions[0];
    selectOpt(q.ci);
    const practiceOk = S.answered && !S.srs[q.id];   // practice still never touches SRS
    goLab(); render();
    return { home, practiceOk, labMounted: typeof labHeart !== 'undefined' };
  });
  ok('home renders', reg.home);
  ok('practice quizzes still never write an SRS card', reg.practiceOk);
  ok('lab/heart integration untouched', reg.labMounted);
  ok('no console/page errors across the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
