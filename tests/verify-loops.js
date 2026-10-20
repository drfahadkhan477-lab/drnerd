#!/usr/bin/env node
/*
 * No animation loop outlives the screen it was started for.
 *
 *   node tests/verify-loops.js build/synthetic/systole.html
 *
 * Several screens draw something that moves: the live ECG strip and the heart on the home screen, the rhythm monitor and the
 * cardiac-cycle diagram in the Lab. Each is a loop that asks for the next frame from inside the frame it is drawing. A loop
 * the screen does not end goes on for the rest of the session, drawing into a canvas that is no longer in the document: the
 * Lab's monitor did, on every screen the reader went to after it, at 60 frames a second (7 ms of every second in Chromium and
 * 10 in WebKit, at iPad size, to draw what nobody could see, and a page that never lets the device idle).
 *
 * A loop is a callback that is always waiting for the next frame, so the number of loops the page is running is the least
 * number of frame requests it has waiting, sampled between frames. That is counted here without asking any loop who it is: a
 * wrapper on requestAnimationFrame, installed before the page's own scripts, holds the requests that have not yet run. It
 * does not depend on the speed of the machine or on what any particular loop is called, so a loop added to a screen next year
 * is held to the same rule as the ones that are there now.
 *
 * The rule: a quiz at rest runs the one loop that is meant to run everywhere (the tutor's avatar, which is always beating), and
 * after the reader has been to a screen and come back it runs that one and no more. Each screen in turn is gone to (and is
 * shown to run loops of its own where it has any, or the section measures nothing), left for the quiz, and counted. The one is
 * pinned and not measured, as the Lab's seven views are in tests/verify-physio.js: the page opens on the home screen, so a
 * count taken after that would already hold whatever the home screen left behind, and a loop added to every screen on purpose
 * is a decision this line should have to be told about.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, onScreen, quiet } = require('./_render.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-loops.js <build.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);
const ALWAYS = 1;   // the tutor's avatar

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

/* Before the page's own scripts: hold the frame requests that have not run yet. A request is held from the call to the moment
   its callback starts, and a loop asks for its next frame inside the callback, so between frames it is always held. The number
   of loops is the fewest requests held at any of twelve moments over half a second: a one-shot request is held from the call to
   the next frame and is not there at every moment, and a loop is. */
const INIT = () => {
  const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window);
  const held = new Map();
  window.requestAnimationFrame = cb => { const id = raf(t => { held.delete(id); cb(t); }); held.set(id, cb.name || 'anonymous'); return id; };
  window.cancelAnimationFrame = id => { held.delete(id); caf(id); };
  window.__loops = async () => {
    let fewest = Infinity, who = [];
    for (let i = 0; i < 12; i++) { if (held.size < fewest) { fewest = held.size; who = [...held.values()]; } await new Promise(r => setTimeout(r, 40)); }
    return { n: fewest, who };
  };
};

(async () => {
  const browser = await launch();
  const errors = [], events = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));
  const page = watch(await browser.newPage({ viewport: { width: 1194, height: 834 } }), events, 'main');
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(INIT);
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await booted(page);
  await quiet(page);

  /* How many loops are running, and what they are called (most are called loop, which is why they are counted and not named). */
  const loops = async () => { await quiet(page); return page.evaluate(() => window.__loops()); };
  const quiz = async () => {
    await page.evaluate(() => { startAdhocQuiz(POOL.filter(q => q.o.length >= 4 && !q.imgopt).slice(0, 4), null); });
    await onScreen(page, 'quiz', { marker: '.q-card' });
    return loops();
  };
  const say = l => `${l.n} (${l.who.join(', ') || 'none'})`;
  /* Every screen that has something to draw, and the way to get to it. */
  const SCREENS = [
    { name: 'home', key: 'home', go: () => goHome(), marker: '.hero-h1', moves: true },
    { name: 'Study', key: 'study', go: () => goStudy(), marker: '#planCard' },
    { name: 'notes', key: 'refs', go: () => goRefs(), marker: '.ref-new' },
    { name: 'search', key: 'search', go: () => openSearch(), marker: '#sQ' },
    { name: 'stats', key: 'stats', go: () => { S.screen = 'stats'; render(); } },
    { name: 'Lab', key: 'lab', go: () => goLab(), marker: '#labCanvas', moves: true },
    { name: 'Echo Studio', key: 'echo', go: () => goEcho(), marker: '.echo-studio' },
    { name: 'memory', key: 'memory', go: () => goMemory(), marker: '.home-wrap' },
  ];
  const visit = async s => {
    await page.evaluate(s.go);
    await onScreen(page, s.key, s.marker ? { marker: s.marker } : {});
    return loops();
  };

  head('the count');
  {
    const first = await loops();
    const n = await page.evaluate(async () => {
      const before = (await window.__loops()).n;
      let on = true; (function again() { if (on) requestAnimationFrame(again); })();
      const during = (await window.__loops()).n;
      on = false; await new Promise(r => setTimeout(r, 100));
      const after = (await window.__loops()).n;
      return { before, during, after };
    });
    ok('a loop started adds one to the count and a loop stopped takes it away, so what is counted is loops', n.during === n.before + 1 && n.after === n.before, JSON.stringify(n));
    ok("the page already runs loops before the reader has been anywhere (the tutor's avatar, which is always beating)", first.n >= 1, `${say(first)} on the home screen it opened on`);
  }

  head('a quiz after the page opened on the home screen');
  const base = await quiz();
  ok('a quiz at rest runs the loop that runs everywhere and nothing the home screen it came from started', base.n === ALWAYS, say(base));

  head('each screen in turn, and back to the quiz');
  for (const s of SCREENS) {
    const during = await visit(s);
    const after = await quiz();
    if (s.moves) ok(`the ${s.name} screen runs loops of its own, so leaving it is a thing this can measure`, during.n > ALWAYS, `${say(during)} on it, ${ALWAYS} on a quiz`);
    ok(`after the ${s.name} screen is left the page runs the loops it ran before`, after.n === ALWAYS, `${say(after)} now, ${ALWAYS} before`);
  }

  head('the same, in another order and more than once');
  {
    const lab = SCREENS.find(s => s.name === 'Lab'), home = SCREENS.find(s => s.name === 'home'), study = SCREENS.find(s => s.name === 'Study');
    for (let i = 0; i < 3; i++) { await visit(lab); await visit(home); }
    await visit(study);
    const after = await quiz();
    ok('the Lab and home three times over, then Study, then the quiz: no loop is left running', after.n === ALWAYS, `${say(after)} now, ${ALWAYS} before`);
  }

  head('what an answer starts');
  {
    const seen = await page.evaluate(() => { const q = S.questions[S.qIdx]; selectOpt((q.ci + 1) % q.o.length); return !!document.querySelector('.blip-canvas'); });
    ok('answering a question starts the one-shot monitor beside it, or this section measures nothing', seen === true, String(seen));
    const gone = await page.waitForFunction(() => !document.querySelector('.blip-canvas'), null, { timeout: 8000 }).then(() => true, () => false);
    const after = await loops();
    ok('and when it has gone the page runs the loops it ran before', gone && after.n === ALWAYS, `${say(after)} now, ${ALWAYS} before${gone ? '' : '; the monitor never went'}`);
  }

  head('nothing throws');
  ok('no page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
