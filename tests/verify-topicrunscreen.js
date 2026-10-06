#!/usr/bin/env node
/*
 * The Topic runs card on the Study screen: three to five questions about one thing, back to back.
 *
 *   node tests/verify-topicrunscreen.js build/synthetic/systole.html
 *
 * src/core/topicrun.js is held by verify-topicrun-pure, on an invented vocabulary. This holds that
 * the app is wired to it, measured from the questions themselves and not from the module:
 *   · the card has one to three runs, each button at least 44 px tall, each saying its chapter and
 *     how many questions it holds (three to five);
 *   · pressing one starts a review session of exactly those questions, in a single chapter, and every
 *     question in it contains every word the button says they share (so the grouping is real);
 *   · a question you have missed is what a run starts from, and the card follows when that changes;
 *   · rating a question in a run moves its schedule as the review queue does;
 *   · if the grouping cannot be worked out, the card is not there and the rest of the screen is.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, onScreen, quiet } = require('./_render.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-topicrunscreen.js <build.html>'); process.exit(1); }
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

  const toStudy = async () => {
    await page.evaluate(() => goStudy());
    await onScreen(page, 'study', { marker: '#planCard' });
    await quiet(page);
  };
  await page.evaluate(() => { S.srs = {}; S.chStats = {}; S.missed = new Set(); S.daily = {}; _runsKey = ''; });

  head('the card, and what is on it');
  await toStudy();
  const card = await page.evaluate(() => {
    const c = document.getElementById('runCard');
    return !c ? null : {
      n: c.querySelectorAll('[data-run]').length,
      small: Array.from(c.querySelectorAll('button')).filter(b => b.offsetHeight < 44).length,
      rows: Array.from(c.querySelectorAll('[data-run]')).map(b => ({ t: b.querySelector('.run-t').textContent, n: +/(\d+) questions/.exec(b.querySelector('.run-n').textContent)[1] })),
      short: Object.values(CH_SHORT),
    };
  });
  ok('the Study screen has the Topic runs card', !!card);
  ok('with one to three runs, every button at least 44 px tall', card.n >= 1 && card.n <= 3 && card.small === 0, `${card.n} runs, ${card.small} small`);
  ok('each says its chapter and holds three to five questions', card.rows.every(r => card.short.some(s => r.t.startsWith(s)) && r.n >= 3 && r.n <= 5), JSON.stringify(card.rows.map(r => r.n)));

  head('a topic with many questions on it gives a run of four, not all of them');
  {
    /* the invented bank only forms runs of three, so make a topic that could fill a longer one: twelve
       questions in one chapter that share words nothing else in the bank uses.
       On the real bank this has to hold against everything else on it, which the first version did
       not: three words prefixed to a long stem left the twelve barely similar, and with many other
       runs of four the card's top three were decided on seed id, so the run was not on it at all
       ({"found":false} on the owner's run). So the twelve are ONLY those words (stem and keyed
       option), and the first is missed, which is what a run starts from. The size under test is
       untouched: twelve alike, and the run must still stop at four. */
    const r = await page.evaluate(() => {
      const ch = POOL[0].ch, mine = POOL.filter(q => q.ch === ch && q.o && q.o[q.ci]).slice(0, 12);
      const old = mine.map(q => [q.s, q.o[q.ci].t]), wasMissed = S.missed.has(mine[0].id);
      mine.forEach(q => { q.s = 'Zebratitis quagga mongoose'; q.o[q.ci].t = 'okapi'; });
      S.missed.add(mine[0].id);
      _runsKey = ''; const runs = topicRunsNow().slice();
      const z = runs.find(x => x.shared.includes('zebratitis'));
      mine.forEach((q, i) => { q.s = old[i][0]; q.o[q.ci].t = old[i][1]; });
      if (!wasMissed) S.missed.delete(mine[0].id);
      _runsKey = '';
      return { n: mine.length, found: !!z, size: z && z.ids.length, inTopic: z && z.ids.every(id => mine.some(q => q.id === id)) };
    });
    ok('twelve questions on one invented topic make a run, all from that topic, of four', r.n === 12 && r.found && r.inTopic && r.size === 4, JSON.stringify(r));
  }

  head('pressing one asks exactly those questions, and they are about the same thing');
  {
    await page.click('#runCard [data-run="0"]');
    await onScreen(page, 'quiz', { marker: '.q-card' });
    const r = await page.evaluate(() => {
      const run = _runsShown[0], words = run.shared;
      const text = q => (q.s + ' ' + (q.o[q.ci] ? q.o[q.ci].t : '')).toLowerCase();
      return {
        mode: S.mode, ids: S.questions.map(q => q.id), want: run.ids, words,
        chapters: new Set(S.questions.map(q => q.ch)).size,
        sharing: S.questions.every(q => words.every(w => text(q).includes(w))),
        seedFirst: S.questions[0].id === run.seed,
      };
    });
    ok('it is a review session of exactly the run\'s questions, in the run\'s order', r.mode === 'due' && JSON.stringify(r.ids) === JSON.stringify(r.want), r.ids.length + ' questions');
    ok('all from one chapter', r.chapters === 1);
    ok('and each question contains every word the run says they share: the grouping is in the questions', r.words.length > 0 && r.sharing, r.words.join(','));
    ok('it starts from the seed question', r.seedFirst);
    const rated = await page.evaluate(() => {
      const q = S.questions[0], before = S.srs[q.id] ? JSON.stringify(S.srs[q.id]) : null;
      selectOpt(q.ci); rateReview(3);
      const c = S.srs[q.id];
      return { before, reps: c && c.reps, due: c && c.due, today: FSRS.todayISO(), next: S.qIdx };
    });
    ok('rating a question in the run schedules it, due after today, and moves on', rated.before === null && rated.reps >= 1 && rated.due > rated.today && rated.next === 1, JSON.stringify(rated));
  }

  head('a missed question is what a run starts from, and the card follows');
  {
    await toStudy();
    const r = await page.evaluate(() => {
      const last = _runsShown[_runsShown.length - 1];
      return { id: last.ids[0], count: _runsShown.length };
    });
    await page.evaluate(id => { S.missed.add(id); goStudy(); }, r.id);
    await onScreen(page, 'study', { marker: '#runCard' });
    await quiet(page);
    const after = await page.evaluate(() => ({ first: _runsShown[0].ids[0], shown: document.querySelector('#runCard [data-run="0"] .run-n').textContent }));
    ok('with that question missed, the first run starts from it', after.first === r.id, `${r.id} -> ${after.first}`);
    ok('and the card on the screen is the one that was worked out', /questions/.test(after.shown));
  }

  head('if the grouping cannot be worked out, the screen is still there');
  {
    await page.evaluate(() => { window.__runs = TopicRun.runs; TopicRun.runs = () => { throw new Error('boom'); }; _runsKey = ''; });
    await toStudy();
    const r = await page.evaluate(() => ({ plan: !!document.getElementById('planCard'), run: !!document.getElementById('runCard') }));
    await page.evaluate(() => { TopicRun.runs = window.__runs; _runsKey = ''; });
    ok('no Topic runs card, and the study plan is on the screen as before', r.plan && !r.run, JSON.stringify(r));
  }

  ok('and nothing threw throughout', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
