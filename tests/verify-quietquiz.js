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
 *     and is when it is not;
 *   · a screen redrawn in place (the search screen at each pause in typing, home, Study and the notes when the theme changes)
 *     starts no entrance again, and starts them when it is arrived at; one that goes on for ever is left going; and the step
 *     that does it cannot take a draw down;
 *   · the cards below the fold of a long list start nothing when it is drawn, and fade in when they are scrolled to.
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

  head('a screen redrawn in place');
  {
    /* The search screen redraws itself at each pause in typing; home, Study and the notes when the theme changes. Each reading is
       taken in the same task as the draw it follows, and counts the animations that have an end and are running in the screen.
       A screen is waited for until it has finished arriving, which is a precondition: the reading is of the redraw, not of that. */
    await page.evaluate(() => { for (let i = 0; i < 6; i++) REF.push({ id: 'qq' + i, ts: i + 1, title: 'Invented note ' + i, tags: '', body: 'Invented text for note ' + i + '.' }); });
    const r = await page.evaluate(`(async () => {
      const RUNNING = () => document.getAnimations().filter(a => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest
        && a.effect.target.closest('#app') && a.effect.getComputedTiming().iterations !== Infinity).length;
      const wait = ms => new Promise(r => setTimeout(r, ms));
      const frames = async until => { for (let i = 0; i < 120 && !until(); i++) await new Promise(r => requestAnimationFrame(r)); };
      const arrived = async () => { await frames(() => RUNNING() === 0); return RUNNING() === 0; };
      const real = render;
      const record = () => { const seen = []; render = function () { real.apply(this, arguments); seen.push(RUNNING()); }; return seen; };
      const out = {};
      goHome(); await frames(() => S.screen === 'home' && document.querySelector('.hero-h1')); out.homeArrives = RUNNING(); out.homeQuiet = await arrived();
      let seen = record(); render(); render = real; out.homeRedrawn = seen.slice();
      goStudy(); await frames(() => S.screen === 'study' && document.getElementById('planCard')); out.studyArrives = RUNNING(); out.studyQuiet = await arrived();
      seen = record(); render(); render = real; out.studyRedrawn = seen.slice();
      goRefs(); await frames(() => S.screen === 'refs' && document.querySelector('.ref-card')); out.refsArrives = RUNNING(); out.refsQuiet = await arrived();
      seen = record(); render(); render = real; out.refsRedrawn = seen.slice();
      openSearch(); await frames(() => S.screen === 'search' && document.getElementById('sQ')); out.searchArrives = RUNNING(); out.searchQuiet = await arrived();
      let word = null;
      for (const q of ALL_Q) { for (const x of (q.s + ' ' + q.ex).split(/[^A-Za-z]+/)) { if (x.length >= 7 && search(x, { limit: 5 }).filter(h => h.meta.kind === 'q').length) { word = x; break; } } if (word) break; }
      seen = record(); searchInput(word); await wait(500); searchInput(word + ' ' + word); await wait(500); render = real;
      out.searchRedrawn = seen.slice(); out.hits = SQ.hits.length;
      return out;
    })()`);
    ok('home, Study, the notes and the search screen each arrive with their animations running', r.homeArrives > 0 && r.studyArrives > 0 && r.refsArrives > 0 && r.searchArrives > 0, JSON.stringify([r.homeArrives, r.studyArrives, r.refsArrives, r.searchArrives]));
    ok('and each had finished arriving before it was redrawn, or the readings below would be of the arrival', r.homeQuiet && r.studyQuiet && r.refsQuiet && r.searchQuiet, JSON.stringify([r.homeQuiet, r.studyQuiet, r.refsQuiet, r.searchQuiet]));
    ok('and none starts when home, Study or the notes are redrawn in place', r.homeRedrawn.length === 1 && r.studyRedrawn.length === 1 && r.refsRedrawn.length === 1 && r.homeRedrawn[0] === 0 && r.studyRedrawn[0] === 0 && r.refsRedrawn[0] === 0, JSON.stringify([r.homeRedrawn, r.studyRedrawn, r.refsRedrawn]));
    ok('nor when the search screen is redrawn, with its results, for a query typed in it twice', r.hits > 5 && r.searchRedrawn.length >= 2 && r.searchRedrawn.every(n => n === 0), `${r.hits} results; ${JSON.stringify(r.searchRedrawn)}`);

    /* The step itself: what has an end is put at it, what goes on for ever is not. The animations are held, because one that has
       finished is no longer in the document's list. And every one is read before any is finished: finishing one and then asking
       the next for its timing had the page work its styles out again between each, which on a long list was seconds. */
    const s = await page.evaluate(() => {
      const app = document.getElementById('app');
      const box = document.createElement('div'); box.style.cssText = 'position:absolute;left:0;top:0;width:10px;height:10px';
      for (let i = 0; i < 3; i++) { const a = document.createElement('i'); a.style.animation = 'fadeIn 30s linear'; box.append(a); }
      const b = document.createElement('i'); b.style.animation = 'fadeIn 30s linear infinite'; box.append(b);
      app.appendChild(box);
      /* And one outside the screen, which is not the screen's to settle (the bar, the rail, a toast). */
      const apart = document.createElement('div'); apart.style.cssText = 'position:absolute;left:0;top:0;width:10px;height:10px;animation:fadeIn 30s linear';
      document.body.appendChild(apart);
      const held = document.getAnimations().filter(x => box.contains(x.effect.target));
      const aside = document.getAnimations().filter(x => x.effect.target === apart);
      const before = held.map(x => x.playState).sort().join();
      const log = [], finish = Animation.prototype.finish, timing = AnimationEffect.prototype.getComputedTiming;
      Animation.prototype.finish = function () { log.push(box.contains(this.effect.target) ? 'mine' : 'other'); return finish.apply(this, arguments); };
      AnimationEffect.prototype.getComputedTiming = function () { log.push('read'); return timing.apply(this, arguments); };
      try { settleEntrances(app); } finally { Animation.prototype.finish = finish; AnimationEffect.prototype.getComputedTiming = timing; }
      const after = held.map(x => x.playState + (x.effect.getComputedTiming().iterations === Infinity ? '/infinite' : '')).sort().join();
      const outside = aside.map(x => x.playState).join();
      box.remove(); apart.remove();
      /* Between the first of the box's animations to be finished and the last the step is finishing, and a reading in there is one
         that came after a finish. */
      const span = log.slice(log.indexOf('mine'), log.lastIndexOf('mine') + 1);
      return { held: held.length, aside: aside.length, before, after, outside, finished: log.filter(x => x === 'mine').length, interleaved: span.filter(x => x === 'read').length };
    });
    ok('an animation with an end is put at it and one that goes on for ever is left running', s.held === 4 && s.before === 'running,running,running,running' && s.after === 'finished,finished,finished,running/infinite', JSON.stringify(s));
    ok('and one outside the screen is left alone', s.aside === 1 && s.outside === 'running', JSON.stringify([s.aside, s.outside]));
    ok('and only the ones with an end are finished, each once', s.finished === 3, String(s.finished));
    ok('and every animation is read before any is finished', s.finished === 3 && s.interleaved === 0, `${s.interleaved} read(s) between the first finish and the last`);

    /* The step is made after the screen is drawn, so it cannot be allowed to take the draw down: an engine that cannot list its
       animations, or one that lists something it cannot read, still has a screen. */
    const safe = await page.evaluate(() => {
      const had = Object.prototype.hasOwnProperty.call(document, 'getAnimations');
      document.getAnimations = function () { throw new Error('no animations to be had'); };
      let threw = null, drawn = false;
      try { renderNow(); drawn = !!document.querySelector('#app .hero-h1, #app #sQ, #app .home-wrap'); } catch (e) { threw = e.message; } finally { if (!had) delete document.getAnimations; }
      return { threw, drawn, restored: typeof document.getAnimations === 'function' };
    });
    ok('and a draw is not taken down by a step that cannot run', safe.threw === null && safe.drawn && safe.restored, JSON.stringify(safe));
  }

  head('cards below the fold');
  {
    /* A long list of notes: most of its cards are below the fold when it is drawn, and each is hidden until it is scrolled to. The
       draw is read with the settling step switched off, so that what the page itself started is what is counted. (However many of
       the notes the screen draws at a time, it draws a good few more than fit above the fold.) */
    const r = await page.evaluate(`(async () => {
      for (let i = 0; i < 90; i++) REF.push({ id: 'fold' + i, ts: 100 + i, title: 'Fold note ' + i, tags: '', body: 'Invented text for note ' + i + '.' });
      goRefs();
      for (let i = 0; i < 120 && !(S.screen === 'refs' && document.querySelectorAll('.ref-card').length >= 20); i++) await new Promise(r => requestAnimationFrame(r));
      const real = settleEntrances; settleEntrances = () => {};
      try { renderNow(); } finally { settleEntrances = real; }
      const drawn = document.querySelectorAll('.scroll-reveal').length;
      const started = document.getAnimations().filter(a => typeof a.transitionProperty === 'string' && a.playState === 'running'
        && a.effect.target.classList && a.effect.target.classList.contains('scroll-reveal')).length;
      const card = document.querySelector('.scroll-reveal:not(.is-visible)');
      const hidden = card ? getComputedStyle(card).opacity : null;
      if (card) card.dispatchEvent(new Event('focusin'));
      const fades = card ? document.getAnimations().filter(a => a.effect.target === card && a.transitionProperty === 'opacity' && a.playState === 'running').length : -1;
      return { cards: document.querySelectorAll('.ref-card').length, drawn, started, hidden, fades, shown: card ? card.classList.contains('is-visible') : null };
    })()`);
    ok('a long list of notes is drawn with most of its cards waiting below the fold, and drawing it starts no transition on them', r.cards >= 20 && r.drawn >= 8 && r.started === 0, JSON.stringify([r.cards, r.drawn, r.started]));
    ok('a card is hidden until it is scrolled to, and then fades in', r.hidden === '0' && r.shown === true && r.fades === 1, JSON.stringify([r.hidden, r.shown, r.fades]));
  }

  head('nothing throws');
  ok('no page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
