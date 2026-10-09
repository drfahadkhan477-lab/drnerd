#!/usr/bin/env node
/*
 * The Voice card on the Study screen: a session of ten questions answered out loud.
 *
 *   node tests/verify-voicescreen.js build/synthetic/systole.html
 *
 * src/core/voicemode.js is held by verify-voicemode-pure. The speaker and the microphone are the device's
 * and cannot be tested here, so this stubs both with a scripted voice and holds the wiring around them:
 *   · with no speech APIs there is no card, and the rest of the Study screen is there;
 *   · with them the card has a Start button at least 44 px tall, and nothing is spoken before it is pressed;
 *   · pressing it opens the quiz, reads the stem and the options aloud, and listens;
 *   · a spoken letter is scored by the ordinary answer path (chStats moves, the miss list follows), the
 *     feedback is read, and the answer is rated: right → a later due date, wrong → due again today;
 *   · "skip" moves the quiz screen on and records no answer; "stop" ends with a spoken summary;
 *   · leaving the quiz screen ends the session and nothing more is spoken.
 * What it cannot show: that a real microphone hears a letter. That is the owner's, on the iPad.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, onScreen, quiet } = require('./_render.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-voicescreen.js <build.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

/* A scripted voice. Speaking is instant; listening waits for the next line pushed onto window.__heard. */
const STUB = () => {
  window.__said = []; window.__heard = []; window.__listens = 0;
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  /* speechSynthesis is a read-only property of window: plain assignment is silently ignored. */
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak(u) { window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 0); }, cancel() {} } });
  window.SpeechRecognition = function () {
    /* Listening waits for the test to say something, as a person would; the page's own timeout ends it otherwise. */
    this.start = () => {
      window.__listens++;
      const tick = () => {
        if (this.stopped) return;   // a listener the page has stopped must not take the next section's words
        if (window.__heard.length) this.onresult && this.onresult({ results: [[{ transcript: window.__heard.shift() }]] });
        else setTimeout(tick, 20);
      };
      tick();
    };
    this.stop = () => { this.stopped = true; };
  };
};

(async () => {
  const browser = await launch();
  const errors = [], events = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));

  /* ONE PAGE, LOADED ONCE. This suite opened the app four times, one page per section. On the
     owner's laptop the real build is 92 MB, and the fourth load ran out at 200 s 50 minutes into a
     full run. Each section now starts from a reset instead: no voice session, an empty scripted
     voice, and empty progress. */
  const page = watch(await browser.newPage({ viewport: { width: 430, height: 1000 } }), events, 'main');
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(STUB);
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await booted(page);
  /* Home first, so the next toStudy() is a real screen change and reads a Study screen drawn after the reset. */
  const fresh = async () => {
    await page.evaluate(() => {
      stopVoice();
      window.__said = []; window.__heard = []; window.__listens = 0;
      S.srs = {}; S.chStats = {}; S.missed = new Set(); S.daily = {};
      goHome();
    });
    await onScreen(page, 'home', { marker: '.hero-h1' });
  };
  const toStudy = async (page) => {
    await page.evaluate(() => goStudy());
    await onScreen(page, 'study', { marker: '#planCard' });
    await quiet(page);
  };
  /* POLLED ON A TIMER, NOT ON FRAMES. waitForFunction re-checks on
     requestAnimationFrame by default, and a page that is not painting gives it
     none: with WebKit's screen swaps instant (tests/_engine.js takes view
     transitions away there) this page sat idle while the scripted voice
     talked, and a wait whose condition was already true timed out (4 runs in
     12 on WebKit, and once in CI). Every wait here is on page state the voice
     sets from timers, not on paint, so a 100 ms poll is what it needs: 0 in 20
     with it, on WebKit with transitions off and on. */
  const waitFor = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 15000, polling: 100 });

  head('no speech in the browser: no card, and the rest is there');
  {
    await fresh();
    /* The scripted voice is set aside and put back: the same page, without speech. */
    await page.evaluate(() => { window.__stubSynth = window.speechSynthesis; Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined }); });
    await toStudy(page);
    const r = await page.evaluate(() => ({ voice: !!document.getElementById('voiceCard'), plan: !!document.getElementById('planCard') }));
    ok('no Voice card without speech APIs', r.voice === false, JSON.stringify(r));
    ok('the plan card is still there', r.plan === true);
    await page.evaluate(() => { Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: window.__stubSynth }); });
  }

  head('the card, and nothing spoken before the tap');
  await fresh();
  await toStudy(page);
  const card = await page.evaluate(() => {
    const b = document.getElementById('voiceStart');
    return { has: !!document.getElementById('voiceCard'), h: b ? b.offsetHeight : 0, said: window.__said.length, listens: window.__listens };
  });
  ok('the Voice card is on the Study screen', card.has);
  ok('its Start button is at least 44 px tall', card.h >= 44, card.h + ' px');
  ok('nothing was spoken or listened for before the tap', card.said === 0 && card.listens === 0, JSON.stringify(card));

  head('a spoken answer, scored and rated like a tap');
  /* The first answer is the key of whatever question is first, so "right" is measured, not assumed:
     it is read from the deck once the session has opened. The second is deliberately the wrong letter. */
  await page.click('#voiceStart');
  await onScreen(page, 'quiz', { marker: '.q-card' });
  await waitFor(page, () => window.__listens >= 1);
  const first = await page.evaluate(() => ({
    said: window.__said.slice(), n: S.questions.length, stem: VoiceMode.clean(S.questions[0].s), mode: S.mode,
    opts: S.questions[0].o.length,
    /* options with nothing to say once markup is removed: a figure-only option, read as a count, never as text */
    silent: S.questions[0].o.filter(o => !VoiceMode.clean(o && o.t)).length,
  }));
  ok('the session is a review session of up to ten questions', first.mode === 'due' && first.n >= 2 && first.n <= 10, first.n + ' in ' + first.mode);
  /* Details are counts, never text: on the owner's machine this runs on the licensed bank, and a detail is printed. */
  ok('the stem was read aloud', first.said.join(' ').includes(first.stem.split(/[.?!]/)[0].trim().slice(0, 30)), `${first.said.length} parts spoken, stem ${first.stem.length} characters`);
  const optLines = first.said.filter(t => /^Option [A-H]\./.test(t)).length;
  ok('every option was read by its letter', optLines === first.opts, `${optLines} of ${first.opts} options read, ${first.silent} with no text to read`);
  await page.evaluate(() => { window.__heard.push('skip'); });
  await waitFor(page, () => S.qIdx === 1);
  const skipped = await page.evaluate(() => ({ idx: S.qIdx, answered: S.answered, total: Object.values(S.chStats).reduce((a, c) => a + c.total, 0), said: window.__said.some(t => t === 'Skipping.') }));
  ok('"skip" moved the quiz screen on to the second question', skipped.idx === 1 && skipped.answered === false, JSON.stringify(skipped));
  ok('"skip" recorded no answer', skipped.total === 0, skipped.total + ' recorded');
  ok('"skip" was acknowledged out loud', skipped.said === true);

  /* second question: answer correctly */
  await waitFor(page, () => window.__listens >= 2);
  const letter = await page.evaluate(() => 'ABCDEFGH'[S.questions[1].ci]);
  const id1 = await page.evaluate(() => S.questions[1].id);
  await page.evaluate(l => { window.__heard.push('option ' + l); }, letter);
  await waitFor(page, id => S.srs[id] != null, id1);
  const right = await page.evaluate(id => ({ card: S.srs[id], total: Object.values(S.chStats).reduce((a, c) => a + c.total, 0), missed: S.missed.has(id), said: window.__said.filter(t => /^Correct\./.test(t)).length }), id1);
  ok('the spoken letter was scored as one answer', right.total === 1 && !right.missed, JSON.stringify({ t: right.total, m: right.missed }));
  ok('"Correct." was spoken, with the reason', right.said === 1);
  ok('a right answer was rated Good: first interval of two days or more, no lapse', right.card && right.card.ivl >= 2 && right.card.lapses === 0, JSON.stringify(right.card));

  head('a wrong letter, and stop');
  await fresh();
  const p2 = page;
  await toStudy(p2);
  await p2.click('#voiceStart');
  await onScreen(p2, 'quiz', { marker: '.q-card' });
  await waitFor(p2, () => window.__listens >= 1);
  const id0 = await p2.evaluate(() => S.questions[0].id);
  const wrong = await p2.evaluate(() => { const q = S.questions[0]; return 'ABCDEFGH'[(q.ci + 1) % q.o.length]; });
  await p2.evaluate(l => { window.__heard.push('option ' + l, 'stop'); }, wrong);
  await waitFor(p2, () => window.__said.some(t => /^Finished\./.test(t)));
  const done = await p2.evaluate(id => ({ missed: S.missed.has(id), srs: S.srs[id] || null, said: window.__said.filter(t => /^Not quite\./.test(t)).length, fin: window.__said.filter(t => /^Finished\./.test(t)) }), id0);
  ok('a wrong letter put the question on the miss list', done.missed === true);
  ok('"Not quite" was spoken, naming the answer', done.said === 1);
  ok('a wrong answer was rated Again: a lapse, due again tomorrow at the latest', done.srs !== null && done.srs.lapses === 1 && done.srs.ivl <= 1, JSON.stringify(done.srs));
  ok('"stop" ended the session with a spoken summary', done.fin.length === 1 && /1 of 1 correct|0 of 1 correct/.test(done.fin[0]), done.fin[0]);

  head('leaving the quiz ends the session');
  await fresh();
  const p3 = page;
  await toStudy(p3);
  await p3.click('#voiceStart');
  await onScreen(p3, 'quiz', { marker: '.q-card' });
  await waitFor(p3, () => window.__listens >= 1);
  await p3.evaluate(() => { goStudy(); });
  await onScreen(p3, 'study', { marker: '#planCard' });
  const before = await p3.evaluate(() => ({ said: window.__said.length, listens: window.__listens }));
  await p3.waitForFunction(() => _voice === null, null, { timeout: 5000 }).catch(() => {});
  const after = await p3.evaluate(() => ({ said: window.__said.length, listens: window.__listens, live: _voice !== null }));
  ok('nothing more is spoken or listened for after leaving', after.said === before.said && after.listens === before.listens, JSON.stringify({ before, after }));
  ok('the session itself is over, not just quiet', after.live === false, JSON.stringify(after));

  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
