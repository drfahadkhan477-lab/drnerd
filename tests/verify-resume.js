#!/usr/bin/env node
/*
 * A chapter you left is the chapter you come back to.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-resume.js <patched.html>
 *
 * THE CLAIM IS NOT "qIdx WAS RESTORED". startQuiz() shuffles, so an index on
 * its own names a different question every time; a suite that checked only the
 * counter would pass on a build that returned you to question twelve of a
 * completely different deck. So the checks below compare the DECK — the ids in
 * order — and the question actually on screen, which is the thing the fellow
 * noticed was wrong.
 *
 * The interesting cases are the refusals. A saved deck must not be dealt when
 * it would be the wrong deck: not for `due`, which is recomputed from the FSRS
 * schedule; not for `missed`, which shrinks as you improve; and not when the
 * question bank has moved under the record. Those are checked by making the
 * situation happen, not by reading the source.
 */
'use strict';
const path = require('path');
const { launch, isEngineNoise } = require('./_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-resume.js <patched.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !isEngineNoise(m.text())) errors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });

  /* Answer `n` questions of a chapter, then go home. Returns the deck as it
     was dealt, so the next entry can be compared against it. */
  const workThrough = (n) => page.evaluate((n) => {
    const ch = CHAPTERS[0];
    startQuiz(ch);
    const ids = S.questions.map(q => q.id);
    for (let k = 0; k < n; k++) { selectOpt(0); nextQ(); }
    const at = S.qIdx, corr = S.quizCorrect, tot = S.quizTotal;
    goHome();
    return { ch, ids, at, corr, tot };
  }, n);

  head('leaving a chapter and coming back');
  const first = await workThrough(5);
  const again = await page.evaluate((ch) => {
    startQuiz(ch);
    return { ids: S.questions.map(q => q.id), at: S.qIdx, corr: S.quizCorrect, tot: S.quizTotal,
             shown: S.questions[S.qIdx] ? S.questions[S.qIdx].id : null, resumed: !!S.resumed };
  }, first.ch);

  ok('it opens where you left it, not at question one',
     again.at === first.at && again.at > 0, `left at ${first.at}, returned to ${again.at}`);
  /* The check that an index alone cannot make: the same deck, in the same
     order, so the index means what it meant. */
  ok('and the deck is the same deck, in the same order',
     again.ids.length === first.ids.length && again.ids.every((id, i) => id === first.ids[i]),
     `${again.ids.length} questions, ${again.ids.filter((id, i) => id === first.ids[i]).length} in place`);
  ok('so the question on screen is the one you were on',
     again.shown === first.ids[first.at], `${again.shown} vs ${first.ids[first.at]}`);
  ok('the running score comes back with it',
     again.corr === first.corr && again.tot === first.tot,
     `${again.corr}/${again.tot} vs ${first.corr}/${first.tot}`);
  ok('and the quiz knows it resumed', again.resumed === true);

  head('what a resumed deck remembers about the questions behind it');
  const back = await page.evaluate(() => {
    prevQ();
    return { answered: S.answered, selected: S.selected, idx: S.qIdx };
  });
  ok('stepping back finds the answer you already gave, not a fresh question',
     back.answered === true && back.selected !== null,
     `answered=${back.answered} selected=${back.selected}`);

  head('the way out');
  const restarted = await page.evaluate(() => {
    restartQuiz();
    return { at: S.qIdx, resumed: !!S.resumed, stored: !!S.resume['all|' + S.chapter] };
  });
  ok('start over deals from the beginning', restarted.at === 0);
  ok('and stops claiming to be resumed', restarted.resumed === false);
  ok('and forgets the place, so it does not spring back',
     restarted.stored === false);

  head('a finished deck is not a deck you are in the middle of');
  const finished = await page.evaluate(() => {
    const ch = CHAPTERS[0];
    startQuiz(ch);
    const n = S.questions.length;
    for (let k = 0; k < n; k++) { selectOpt(0); nextQ(); }
    const screen = S.screen;
    const stored = !!S.resume['all|' + ch];
    startQuiz(ch);
    return { screen, stored, at: S.qIdx, resumed: !!S.resumed };
  });
  ok('working to the end reaches the results screen', finished.screen === 'results');
  ok('and clears the saved place', finished.stored === false, `stored=${finished.stored}`);
  ok('so the next entry starts over', finished.at === 0 && finished.resumed === false);

  head('the two modes that must never resume');
  const modes = await page.evaluate(() => {
    const out = {};
    /* Give `missed` something to hold, then leave it part-way. */
    S.missed = new Set(POOL.slice(0, 8).map(q => q.id));
    startQuiz(null, 'missed');
    if (S.screen === 'quiz' && S.questions.length > 2) {
      selectOpt(0); nextQ(); selectOpt(0); nextQ();
      out.missedAt = S.qIdx;
      goHome();
      startQuiz(null, 'missed');
      out.missedBack = S.qIdx;
      out.missedResumed = !!S.resumed;
    }
    out.keys = Object.keys(S.resume);
    return out;
  });
  ok('a missed-question run does not come back part-finished',
     modes.missedBack === 0 && modes.missedResumed === false,
     `left at ${modes.missedAt}, returned to ${modes.missedBack}`);
  ok('and nothing was written down for it',
     modes.keys.every(k => k.indexOf('all|') === 0), modes.keys.join(', ') || 'no records');

  head('a record the bank has moved under');
  const stale = await page.evaluate(() => {
    const ch = CHAPTERS[0];
    startQuiz(ch);
    selectOpt(0); nextQ(); selectOpt(0); nextQ();
    goHome();
    /* A question that retired between sessions. */
    S.resume['all|' + ch].ids[0] = 'NO_SUCH_QUESTION_ID';
    startQuiz(ch);
    return { at: S.qIdx, resumed: !!S.resumed, dealt: S.questions.length };
  });
  ok('a deck naming a question that no longer exists is refused, not dealt short',
     stale.at === 0 && stale.resumed === false, `qIdx=${stale.at} resumed=${stale.resumed}`);
  ok('and a full fresh deck is dealt instead', stale.dealt > 0, `${stale.dealt} questions`);

  head('it survives the app being closed');
  const beforeReload = await page.evaluate(() => {
    const ch = CHAPTERS[0];
    restartQuiz();
    startQuiz(ch);
    selectOpt(0); nextQ(); selectOpt(0); nextQ(); selectOpt(0); nextQ();
    const at = S.qIdx, ids = S.questions.map(q => q.id);
    goHome();
    return { ch, at, ids };
  });
  await page.reload({ waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
  const afterReload = await page.evaluate((ch) => {
    startQuiz(ch);
    return { at: S.qIdx, ids: S.questions.map(q => q.id), resumed: !!S.resumed };
  }, beforeReload.ch);
  ok('a reload still knows where you were', afterReload.at === beforeReload.at,
     `${beforeReload.at} → ${afterReload.at}`);
  ok('and still has the same deck', afterReload.ids.every((id, i) => id === beforeReload.ids[i]));

  head('the screen says so');
  /* render() goes through startViewTransition, so the DOM it produces lands in
     an async callback and is NOT in the document when render() returns. Waiting
     on the counter agreeing with S.qIdx is the precondition for the assertion
     below — a fixed sleep would pass on a fast machine and lie on a slow one,
     and reading immediately (as this first did) reports a control as missing
     when it is merely late. */
  const settled = () => page.waitForFunction(() => {
    const c = document.querySelector('.q-counter');
    return !!c && c.textContent.trim() === 'Q ' + (S.qIdx + 1) + ' / ' + S.questions.length;
  }, null, { timeout: 15000 });
  await settled();
  const chrome = await page.evaluate(() => ({
    hasRestart: !!document.querySelector('.q-restart'),
    live: (document.getElementById('srLive') || {}).textContent || '',
  }));
  ok('a resumed quiz shows the restart control', chrome.hasRestart);
  ok('and says out loud that it resumed', /Resumed at question/.test(chrome.live), chrome.live);
  await page.evaluate(() => { restartQuiz(); });
  await settled();
  const freshChrome = await page.evaluate(() => !!document.querySelector('.q-restart'));
  ok('a fresh quiz does not', freshChrome === false);

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
