#!/usr/bin/env node
/*
 * What the review log now records beyond right-or-wrong.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-calibrate.js <patched.html>
 *
 * The app could tell whether an answer was correct. It could not tell apart
 * knowing something cold, guessing lucky, being certain and wrong, or knowing
 * the concept and misreading the stem. This suite is about the three fields
 * that separate those, and about the ways adding them could go wrong:
 *
 *   · a confidence row that becomes a GATE rather than an option — the skip
 *     path is the common path and is checked first, before the feature itself;
 *   · a miss reason that writes a SECOND log row instead of updating the one
 *     already there, which would double-count every accuracy sum in the app;
 *   · a response time that records a walk away from the iPad as deliberation.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-calibrate.js <patched.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 150000 });

  const startAndWait = async () => page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    goHome(); render();
    startQuiz(CHAPTERS[0], 'all');
    for (let i = 0; i < 60 && !document.querySelector('.opt'); i++) await wait(50);
  });

  head('answering without touching anything still works, and costs nothing');
  /* First, and deliberately so: whatever else this step adds, the ordinary
     path — read, answer, move on — must not have acquired a step. */
  const plain = await (async () => { await startAndWait(); return page.evaluate(() => {
    const before = LOG.length;
    const q = S.questions[S.qIdx];
    selectOpt(q.ci);
    const row = LOG[LOG.length - 1];
    return { added: LOG.length - before, answered: S.answered, cf: row.cf, ok: row.ok };
  }); })();
  ok('one answer writes exactly one log row', plain.added === 1, `${plain.added} rows`);
  ok('the question is answered with no confidence chosen', plain.answered === true);
  ok('and the row records that honestly as null, not as a guess',
     plain.cf === null, JSON.stringify(plain.cf));

  head('response time is recorded');
  const timed = await (async () => { await startAndWait(); return page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    await wait(120);
    selectOpt(S.questions[S.qIdx].ci);
    return LOG[LOG.length - 1].ms;
  }); })();
  ok('the log carries how long the answer took', typeof timed === 'number', String(timed));
  ok('and it is at least as long as the wait, not a stub', timed >= 100, `${timed} ms`);

  head('a walk away from the iPad is not recorded as deliberation');
  /* The ceiling exists so one interrupted question cannot drag the median it
     is there to inform. Beyond it the honest value is null. */
  const stale = await (async () => { await startAndWait(); return page.evaluate(() => {
    S.shownAt = Date.now() - 40 * 60 * 1000;      // opened, then lunch
    selectOpt(S.questions[S.qIdx].ci);
    return LOG[LOG.length - 1].ms;
  }); })();
  ok('an answer after a long absence records null, not forty minutes',
     stale === null, String(stale));

  head('a lost WebGL context falls back, and comes back');
  const gl = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    goHome(); render();
    for (let i = 0; i < 60 && !heroHeart3d; i++) await wait(50);
    const cv = document.getElementById('heroHeart3d');
    if (!cv || !heroHeart3d) return { skipped: true };
    const ext = cv.getContext('webgl2') && cv.getContext('webgl2').getExtension('WEBGL_lose_context');
    if (!ext) return { skipped: true };
    const activeBefore = !!document.getElementById('heroHeart')?.classList.contains('heart-3d-active');
    ext.loseContext();
    await wait(120);
    const afterLoss = {
      instance: !!heroHeart3d,
      active: !!document.getElementById('heroHeart')?.classList.contains('heart-3d-active'),
    };
    ext.restoreContext();
    for (let i = 0; i < 60 && !heroHeart3d; i++) await wait(50);
    return { skipped: false, activeBefore, afterLoss, instanceAfterRestore: !!heroHeart3d };
  });
  if (gl.skipped) {
    ok('WEBGL_lose_context is available to drive this', false, 'extension or heart unavailable');
  } else {
    ok('the heart was live before the context was lost', gl.activeBefore === true);
    ok('losing the context clears the stale instance', gl.afterLoss.instance === false);
    ok('and unhides the static SVG fallback rather than leaving a blank canvas',
       gl.afterLoss.active === false, JSON.stringify(gl.afterLoss));
    ok('restoring the context brings the heart back without a reload',
       gl.instanceAfterRestore === true);
  }

  head('confidence: an option, never a gate');
  const conf = await (async () => { await startAndWait(); return page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const chips = [...document.querySelectorAll('.cf-chip')];
    if (!chips.length) return { none: true };
    chips[3].click();                                    // "Certain"
    await wait(30);
    const chosen = { on: chips[3].classList.contains('on'), pressed: chips[3].getAttribute('aria-pressed') };
    chips[3].click();                                    // tapping again clears it
    await wait(30);
    const cleared = { on: chips[3].classList.contains('on'), cf: S.answers[S.qIdx] && S.answers[S.qIdx].cf };
    chips[3].click();
    const q = S.questions[S.qIdx];
    selectOpt(q.ci);
    const row = LOG[LOG.length - 1];
    return { none: false, chosen, cleared, loggedCf: row.cf, kept: S.answers[S.qIdx].cf };
  }); })();
  ok('the confidence row is offered before answering', conf.none === false);
  ok('choosing a band marks it, for sight and for a screen reader',
     conf.chosen && conf.chosen.on === true && conf.chosen.pressed === 'true', JSON.stringify(conf.chosen));
  ok('tapping it again clears it — an accidental tap is escapable',
     conf.cleared && conf.cleared.on === false && conf.cleared.cf === null, JSON.stringify(conf.cleared));
  ok('the chosen band reaches the log row', conf.loggedCf === 3, String(conf.loggedCf));
  ok('and answering does not discard it', conf.kept === 3, String(conf.kept));

  head('confidence survives going back and forward');
  /* quiznav gave the quiz a memory; this has to live in it, or the row is
     blank the moment you check the previous question. */
  const roundTrip = await (async () => { await startAndWait(); return page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    /* Guarded, not called blind. On a build without this step the section
       should report two failures, not throw and take the rest of the suite
       with it — the same discipline verify-pearl states for its canvas. */
    if (typeof setConfidence !== 'function') return { missing: true };
    setConfidence(2);
    const before = S.answers[S.qIdx].cf;
    nextQ(); await wait(120); prevQ(); await wait(120);
    const chip = document.querySelector('.cf-chip[data-cf="2"]');
    return { before, after: S.answers[S.qIdx] && S.answers[S.qIdx].cf,
             stillMarked: !!chip && chip.classList.contains('on'),
             answered: S.answered,
             revealed: !!document.querySelector('.reveal-card') };
  }); })();
  ok('the value survives prevQ/nextQ', roundTrip.after === 2, JSON.stringify(roundTrip));
  ok('and the row still shows it on return', roundTrip.stillMarked === true, JSON.stringify(roundTrip));
  /* The bug this nearly shipped: restoreQuizState inferred "answered" from an
     S.answers entry existing, and setConfidence creates one before the answer.
     Rating your confidence and coming back would have revealed the answer to a
     question you never answered. */
  ok('rating confidence does not mark the question answered',
     roundTrip.answered === false, JSON.stringify(roundTrip.answered));
  ok('and the answer is not revealed on return',
     roundTrip.revealed === false, JSON.stringify(roundTrip.revealed));

  head('miss reasons appear only where there is a miss');
  const right = await (async () => { await startAndWait(); return page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    selectOpt(S.questions[S.qIdx].ci);
    await wait(120);
    return document.querySelectorAll('.miss-chip').length;
  }); })();
  ok('a correct answer is not asked to explain itself', right === 0, `${right} chips`);

  const wrong = await (async () => { await startAndWait(); return page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const q = S.questions[S.qIdx];
    selectOpt((q.ci + 1) % q.o.length);
    await wait(120);
    const rows = LOG.length;
    const chips = [...document.querySelectorAll('.miss-chip')];
    if (!chips.length) return { none: true };
    chips[1].click();                                     // "Misread the stem"
    await wait(30);
    const last = [...LOG].reverse().find(r => r.q === q.id);
    return { none: false, chipCount: chips.length, rowsBefore: rows, rowsAfter: LOG.length,
             why: last.why, marked: chips[1].classList.contains('on') };
  }); })();
  ok('a wrong answer offers reasons', wrong.none === false && wrong.chipCount === 5, JSON.stringify(wrong.chipCount));
  ok('choosing one records it on the answer', wrong.why === 'misread', String(wrong.why));
  ok('and marks the chip', wrong.marked === true);
  /* The check that matters: every accuracy figure in the app sums over these
     rows, so an extra row per tagged miss would quietly deflate all of them. */
  ok('it updates the existing log row rather than adding a second',
     wrong.rowsAfter === wrong.rowsBefore, `${wrong.rowsBefore} → ${wrong.rowsAfter}`);

  head('the Progress screen says nothing until it has something to say');
  /* goStats() changes screen, so render() goes through a view transition and
     the DOM is not the Progress screen synchronously. Poll, or the assertion
     measures whatever screen was up before. */
  const showStats = async () => page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    goStats(); render();
    for (let i = 0; i < 60 && !document.querySelector('.stat-grid'); i++) await wait(50);
    await wait(60);
  });
  const fresh = await (async () => { await page.evaluate(() => { LOG.length = 0; }); await showStats();
    return page.evaluate(() => {
    /* #app, not document.body: body.textContent includes the page's own
       <script> source, and calibPanel's source literally contains the strings
       being searched for — so a body-wide match passes whether the panel
       rendered or not. Caught exactly that way. */
    const app = document.getElementById('app');
    return { panel: !!document.querySelector('.cb-head'),
             text: (app.textContent || '').includes('Calibration ·') };
  }); })();
  ok('a log with nothing rated shows no calibration panel at all',
     fresh.panel === false && fresh.text === false, JSON.stringify(fresh));

  head('and reads the signals back once there are some');
  const readout = await (async () => { await page.evaluate(() => {
    LOG.length = 0;
    const N = 14;
    for (let i = 0; i < N; i++) LOG.push({ m:'practice', q:'X'+i, ok:0, cf:3, ms:5000, why:'misread' });
    for (let i = 0; i < N; i++) LOG.push({ m:'practice', q:'Y'+i, ok:1, cf:3, ms:4000, why:null });
  }); await showStats(); return page.evaluate(() => {
    const t = document.getElementById('app').textContent || '';
    return { hasPanel: !!document.querySelector('.cb-head'),
             certainWrong: /Certain, and wrong/.test(t),
             fifty: /50%/.test(t),
             pace: /Correct in/.test(t),
             misread: /Misread the stem/.test(t) };
  }); })();
  ok('the panel appears', readout.hasPanel === true, JSON.stringify(readout));
  ok('the headline names the dangerous case', readout.certainWrong === true);
  ok('and computes it — half of the Certain answers were wrong', readout.fifty === true);
  ok('pace is reported', readout.pace === true);
  ok('and the dominant miss reason is named', readout.misread === true);

  head('a sparse band asks for more rather than quoting a number');
  const thin = await (async () => { await page.evaluate(() => {
    LOG.length = 0;
    for (let i = 0; i < 3; i++) LOG.push({ m:'practice', q:'Z'+i, ok:1, cf:3, ms:3000, why:null });
  }); await showStats();
    return page.evaluate(() => (document.getElementById('app').textContent || '').includes('needs')); })();
  ok('an under-filled band says how many more it needs', thin === true, String(thin));

  head('no stray errors');
  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
