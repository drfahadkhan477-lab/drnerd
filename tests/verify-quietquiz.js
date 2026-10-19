#!/usr/bin/env node
/*
 * Answering a question: the question stays where it is.
 *
 *   node tests/verify-quietquiz.js build/synthetic/systole.html
 *
 * Choosing an answer redraws the screen, and a redraw is a new set of elements, each of which runs its entrance
 * animation from the start: the question card dropped to nothing and rose back, the progress bar slid up again and
 * the options slid in again, on every answer. renderNow() now marks a redraw that leaves the fellow where they were
 * (the same screen, and on a quiz the same question) with .again, and the CSS leaves what was already there alone.
 * This holds both halves of that:
 *   · after an answer nothing that was on the screen runs its entrance again, and what is new still arrives: the
 *     verdict, the option that was right and the one that was wrong;
 *   · the next question, and a question come back to from another screen, arrive as any question does;
 *   · a screen redrawn twice in place is not entered twice;
 *   · the annotation pencil, which every draw of a screen asks the rail for, is not made again when the rail is what it was,
 *     and is when it is not.
 * Each reading is taken in the same task as the action it follows, with no frame between: a frame is a time, and an
 * engine that draws its frames late would otherwise have finished the animation before it was looked at.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, onScreen, quiet } = require('./_render.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-quietquiz.js <build.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

/* In the page: how many of an animation's runs are going on, on elements that match. */
const COUNT = `(name, sel) => document.getAnimations().filter(a => a.animationName === name && a.playState === 'running'
  && a.effect && a.effect.target && a.effect.target.matches && a.effect.target.matches(sel)).length`;

(async () => {
  const browser = await launch();
  const errors = [], events = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));
  const page = watch(await browser.newPage({ viewport: { width: 1194, height: 834 } }), events, 'main');
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await booted(page);
  /* Boot does not wait for the database. It answers a moment later and redraws the screen once if what it holds differs from
     what the app already has, and starting a quiz is such a difference (the question's ink is keyed in memory before it is
     stored). A quiz started inside that moment is redrawn in place before anything is chosen, and the first reading below
     would be of a quiz that already wears .again. The database is waited for here, so that the first draw of the quiz is the
     only one until it is answered. */
  await page.evaluate(() => new Promise(done => { const go = () => setTimeout(done, 0); Store.ready().then(go, go); }));

  /* A quiz of four questions, and the entrance they have finished before anything is chosen. */
  const arrived = async () => {
    await onScreen(page, 'quiz', { marker: '.q-card' });
    await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running' || !a.effect || !a.effect.target || !a.effect.target.closest || !a.effect.target.closest('#app') || a.effect.getComputedTiming().iterations === Infinity), null, { timeout: 8000 })
      .then(() => true, () => false);
    await quiet(page);
  };
  await page.evaluate(() => { startAdhocQuiz(POOL.filter(q => q.o.length >= 4 && !q.imgopt).slice(0, 4), null); });
  await arrived();

  head('choosing an answer');
  const wrongIdx = await page.evaluate(() => (S.questions[S.qIdx].ci + 1) % S.questions[S.qIdx].o.length);
  const before = await page.evaluate(() => ({ sees: !!document.querySelector('.q-card') && !document.getElementById('app').classList.contains('again'), opts: document.querySelectorAll('.opts>.opt').length }));
  const r = await page.evaluate(`(idx => {
    const COUNT = ${COUNT};
    const first = document.querySelector('.q-card');
    document.querySelector('.opts>.opt[data-idx="' + idx + '"]').click();
    return { redrawn: document.querySelector('.q-card') !== first, again: document.getElementById('app').classList.contains('again'),
      question: COUNT('riseIn', '.q-card'), bar: COUNT('slideUp', '.qbar'), slid: COUNT('slideL', '.opts>.opt'),
      verdict: COUNT('riseIn', '.reveal-card'), right: COUNT('popIn', '.opt.correct'), wrong: COUNT('nudge', '.opt.wrong'),
      pencil: COUNT('popIn', '.rail-open'), pencils: document.querySelectorAll('.rail-open').length,
      options: document.querySelectorAll('.opts>.opt').length };
  })(${wrongIdx})`);
  ok('the screen was redrawn and was one the quiz started with, so these readings are of a redraw', before.sees && before.opts >= 4 && r.redrawn, JSON.stringify([before, r.redrawn]));
  ok('the redraw says it is the same view again', r.again === true, String(r.again));
  ok('the question card does not rise in again', r.question === 0, r.question + ' running');
  ok('the progress bar does not slide up again, and no option slides in again', r.bar === 0 && r.slid === 0, `bar ${r.bar}, options ${r.slid}`);
  ok('what is new arrives: the verdict rises in', r.verdict === 1, r.verdict + ' running');
  ok('the right option pops and the one that was wrong gives its nudge', r.right === 1 && r.wrong === 1, `right ${r.right}, wrong ${r.wrong}`);
  ok('the annotation pencil is there, and does not pop in again', r.pencils === 1 && r.pencil === 0, `${r.pencils} pencil(s), ${r.pencil} running`);
  await quiet(page);

  head('arriving');
  {
    const n = await page.evaluate(`(() => {
      const COUNT = ${COUNT};
      nextQ();
      return { again: document.getElementById('app').classList.contains('again'), question: COUNT('riseIn', '.q-card'), slid: COUNT('slideL', '.opts>.opt'), bar: COUNT('slideUp', '.qbar'),
        pencil: COUNT('popIn', '.rail-open'), pencils: document.querySelectorAll('.rail-open').length };
    })()`);
    ok('the next question is not the same view: it does not wear it', n.again === false, String(n.again));
    ok('and it arrives as a question does: the card rises in and the options slide in', n.question === 1 && n.slid >= 4 && n.bar === 1, JSON.stringify([n.question, n.slid, n.bar]));
    ok('the annotation pencil, which is on every question, does not pop in again with it', n.pencils === 1 && n.pencil === 0, `${n.pencils} pencil(s), ${n.pencil} running`);
    await arrived();

    const id = await page.evaluate(() => S.questions[S.qIdx].id);
    await page.evaluate(() => goStudy());
    await onScreen(page, 'study', { marker: '#planCard' });
    /* Changing screen is a view transition where there is one: the question is in the page a frame later, and the card's
       entrance, which runs for most of half a second, is read on the first frame it is there. */
    const back = await page.evaluate(`(async (id) => {
      const COUNT = ${COUNT};
      jumpTo(id);
      for (let i = 0; i < 120 && !(S.screen === 'quiz' && document.querySelector('.q-card')); i++) await new Promise(r => requestAnimationFrame(r));
      return { again: document.getElementById('app').classList.contains('again'), question: COUNT('riseIn', '.q-card'), slid: COUNT('slideL', '.opts>.opt') };
    })(${JSON.stringify(id)})`);
    ok('a question come back to from another screen arrives like any other', back.again === false && back.question === 1 && back.slid >= 4, JSON.stringify(back));
    await arrived();
  }

  head('redrawn in place');
  {
    const twice = await page.evaluate(`(() => {
      const COUNT = ${COUNT};
      render(); render();
      return { again: document.getElementById('app').classList.contains('again'), question: COUNT('riseIn', '.q-card'), slid: COUNT('slideL', '.opts>.opt') };
    })()`);
    ok('a quiz redrawn twice in place is not entered twice', twice.again === true && twice.question === 0 && twice.slid === 0, JSON.stringify(twice));
  }

  head('the pencil is made again when it is not what it was');
  {
    /* The rail is the full set of tools or the pencil alone. Swapped for the full set and back, the pencil is a new button, and
       a new button is entered: this is what the redraw above must not be mistaken for. */
    const back = await page.evaluate(`(() => {
      const COUNT = ${COUNT};
      railMin(false);
      const full = !!document.querySelector('#rail .rail-min') && !document.querySelector('.rail-open');
      railMin(true);
      return { full, pencils: document.querySelectorAll('.rail-open').length, pop: COUNT('popIn', '.rail-open') };
    })()`);
    ok('the full set of tools replaces the pencil, and the pencil comes back, and pops in', back.full && back.pencils === 1 && back.pop === 1, JSON.stringify(back));
  }

  head('nothing throws');
  ok('no page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
