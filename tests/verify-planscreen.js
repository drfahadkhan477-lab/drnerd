#!/usr/bin/env node
/*
 * The "I have N minutes" card on the Study screen: it plans a session from what the fellow has
 * actually done, and runs it as a review session.
 *
 *   node tests/verify-planscreen.js build/synthetic/systole.html
 *
 * src/core/studyplan.js is held by verify-plan-pure; this holds that the app is wired to it:
 *   · the card is on the Study screen with a 10, 20 and 40 minute button, each at least 44 px tall;
 *   · its sentence is the plan's own, and the readiness line states what the app knows (cards seen
 *     of the bank), and is absent until there is enough history to say anything;
 *   · pressing 20 starts a review session of exactly the planned size, in the planned order (not
 *     shuffled), with the most-forgotten due card first, no question twice, due cards capped by
 *     the time and not by the backlog;
 *   · rating a card in it moves that card's schedule, as the review queue does;
 *   · nothing throws.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, onScreen, quiet } = require('./_render.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-planscreen.js <build.html>'); process.exit(1); }
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
  const errors = [], events = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));
  const page = watch(await browser.newPage({ viewport: { width: 430, height: 1000 } }), events, 'main');
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await booted(page);

  /* goStudy() sets the screen at once and draws it inside a view transition: wait for the markup, then for it to stop changing. */
  const toStudy = async () => {
    await page.evaluate(() => goStudy());
    await onScreen(page, 'study', { marker: '#planCard' });
    await quiet(page);
    return page.evaluate(() => !!document.getElementById('planCard'));
  };

  head('a new fellow: the card is there and says what it can');
  {
    await page.evaluate(() => { S.srs = {}; S.chStats = {}; S.missed = new Set(); S.daily = {}; });
    ok('the Study screen has the plan card', await toStudy());
    const r = await page.evaluate(() => ({
      mins: Array.from(document.querySelectorAll('#planCard [data-plan]')).map(b => +b.dataset.plan),
      small: Array.from(document.querySelectorAll('#planCard button')).filter(b => b.offsetHeight < 44).length,
      sub: document.getElementById('planSub').textContent,
      expect: StudyPlan.plan({ minutes: 20, pool: POOL, srs: S.srs, chStats: S.chStats, missed: S.missed }).text,
      ready: !!document.getElementById('planReady'),
    }));
    ok('it offers 10, 20 and 40 minutes, every button at least 44 px tall', r.mins.join() === '10,20,40' && r.small === 0, r.mins.join() + ', ' + r.small + ' small');
    ok('its sentence is the plan\'s own, for twenty minutes', r.sub === r.expect && /20 min/.test(r.sub), r.sub);
    ok('and with nothing answered yet it says nothing about readiness rather than something wrong', r.ready === false);
  }

  head('a fellow with history: the plan is run as planned');
  const seeded = await page.evaluate(() => {
    const day = n => FSRS.localDateToISO(new Date(Date.now() + n * 86400000));
    S.srs = {}; S.chStats = {}; S.missed = new Set(); S.daily = {};
    POOL.slice(0, 30).forEach((q, i) => {
      const due = i < 20;                                   // twenty due, ten not yet
      S.srs[q.id] = { difficulty: 5, stability: 2 + i, ivl: 3, reps: 2, lapses: 0, last: day(-10), due: due ? day(-1) : day(5) };
    });
    const chs = [...new Set(POOL.map(q => q.ch))].sort();
    chs.forEach((c, i) => { S.chStats[c] = i === 0 ? { correct: 2, total: 10 } : { correct: 9, total: 10 }; });
    S.daily[FSRS.todayISO()] = { a: 14, c: 10, r: 0 };
    return { today: FSRS.todayISO(), chs: chs.length };
  });
  await toStudy();
  {
    const r = await page.evaluate(() => ({ ready: (document.getElementById('planReady') || {}).textContent || '', n: Object.keys(S.srs).length, total: POOL.length }));
    ok('the readiness line says how many of the bank have been seen, and the numbers are the app\'s own', new RegExp(`seen ${r.n} of ${r.total} questions`).test(r.ready) && /remember about \d+%/.test(r.ready), r.ready);
    ok('and names the chapter the fellow is weakest in', /Weakest: .+ \(\d+%\)/.test(r.ready));
  }
  {
    await page.click('#planCard [data-plan="20"]');
    await onScreen(page, 'quiz');
    const deck = await page.evaluate(() => {
      const t = FSRS.todayISO();
      const dueIn = S.questions.filter(q => S.srs[q.id] && S.srs[q.id].due <= t);
      const ret = q => FSRS.retrievability(S.srs[q.id].stability, FSRS.daysBetween(S.srs[q.id].last, t));
      const planned = StudyPlan.plan({ minutes: 20, pool: POOL, srs: S.srs, chStats: S.chStats, missed: S.missed });
      const dueAll = POOL.filter(q => S.srs[q.id] && S.srs[q.id].due <= t);
      return {
        screen: S.screen, mode: S.mode, n: S.questions.length, budget: planned.budget,
        ids: S.questions.map(q => q.id), plannedIds: planned.items.map(i => i.id),
        unique: new Set(S.questions.map(q => q.id)).size,
        dueInDeck: dueIn.length, dueAll: dueAll.length,
        firstIsDue: !!(S.srs[S.questions[0].id] && S.srs[S.questions[0].id].due <= t),
        firstMostForgotten: dueIn.length > 0 && !!S.srs[S.questions[0].id] && ret(S.questions[0]) <= Math.min(...dueIn.map(ret)) + 1e-9,
      };
    });
    ok('pressing 20 starts a review session', deck.screen === 'quiz' && deck.mode === 'due', deck.screen + '/' + deck.mode);
    ok('of the planned size: twenty minutes is sixteen questions at 75 seconds each', deck.n === 16 && deck.budget === 16, String(deck.n));
    ok('in the planned order, not shuffled', JSON.stringify(deck.ids) === JSON.stringify(deck.plannedIds));
    ok('no question twice', deck.unique === deck.n);
    ok('twenty are due but the time allows ten of them: the backlog does not set the length of the session', deck.dueAll === 20 && deck.dueInDeck === 10, `${deck.dueInDeck} of ${deck.dueAll} due`);
    ok('the first question is a due one, and the most forgotten of the due ones in the deck', deck.firstIsDue && deck.firstMostForgotten);
  }

  head('rating a card in the plan moves its schedule');
  {
    const r = await page.evaluate(() => {
      const q = S.questions[0], before = JSON.stringify(S.srs[q.id]);
      selectOpt(q.ci);
      rateReview(3);
      const after = S.srs[q.id];
      return { changed: JSON.stringify(after) !== before, reps: after.reps, due: after.due, today: FSRS.todayISO(), next: S.qIdx };
    });
    ok('the card was rescheduled: one more review, due after today', r.changed && r.reps === 3 && r.due > r.today, `reps ${r.reps}, due ${r.due}`);
    ok('and the session went on to the next question', r.next === 1);
  }

    ok('and nothing threw throughout', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
