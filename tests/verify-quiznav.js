#!/usr/bin/env node
/*
 * The quiz's Previous button, and the write-once guarantees around it.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-quiznav.js /path/to/build.html
 *
 * selectOpt() and rateReview() each write something that must happen exactly
 * once per question: chapter stats and the missed set for the first, an FSRS
 * schedule update for the second. Going back and forth must never be able to
 * trigger either a second time — that is not a UI nicety, it is the
 * difference between a chapter's percentage being accurate and a card's due
 * date drifting further out every time its question is revisited.
 */
'use strict';
const path = require('path');
const { chromium } = require('playwright');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-quiznav.js <patched.html>'); process.exit(1); }
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

  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 120000 });
  await page.waitForTimeout(1000);

  head('a skip is recoverable, an answer is not');
  {
    const r = await page.evaluate(async () => {
      startQuiz(CHAPTERS[0], 'all');
      const q0 = S.questions[0];
      /* Deliberately the WRONG option where one exists, so "the restored
         selection matches" is a real assertion rather than one that would
         pass by coincidence whenever the correct answer happens to be picked. */
      const q0Choice = q0.o.length > 1 && q0.ci !== 0 ? 0 : q0.ci;
      selectOpt(q0Choice);
      const afterQ0 = { total: S.quizTotal, correct: S.quizCorrect };

      nextQ();                          // Q1: skip it
      const q1id = S.questions[1].id;
      nextQ();                          // Q2: answer it, deliberately wrong when possible
      const q2 = S.questions[2];
      selectOpt(q2.ci === 0 ? 1 : 0);
      const afterQ2 = { total: S.quizTotal, correct: S.quizCorrect };

      prevQ();                          // -> Q1 (skipped)
      const onQ1 = { idMatches: S.questions[S.qIdx].id === q1id, answered: S.answered, selected: S.selected };

      prevQ();                          // -> Q0 (answered)
      const onQ0 = { qIdx: S.qIdx, answered: S.answered, selected: S.selected };

      // Bypass the disabled UI entirely and call the grading function directly —
      // the guard has to hold at the function level, not just in the markup.
      const otherOption = (q0Choice + 1) % q0.o.length;
      selectOpt(otherOption);
      const reanswerAttempt = { total: S.quizTotal, correct: S.quizCorrect, selectionUnchanged: S.selected === q0Choice };

      nextQ();                          // -> Q1 again, answer it for real this time
      const q1 = S.questions[1];
      selectOpt(q1.ci);
      const q1AnsweredNow = { answered: S.answered, total: S.quizTotal };

      prevQ(); prevQ(); prevQ(); prevQ(); prevQ();   // clamp at zero
      const clamped = S.qIdx;

      return { afterQ0, afterQ2, onQ1, onQ0, reanswerAttempt, q1AnsweredNow, clamped, q0Choice };
    });

    ok('answering Q0 records exactly one attempt', r.afterQ0.total === 1);
    ok('answering Q2 brings the total to two', r.afterQ2.total === 2, String(r.afterQ2.total));
    ok('going back twice lands on the skipped question, unanswered', r.onQ1.idMatches && r.onQ1.answered === false);
    ok('and its selection is genuinely empty, not stale', r.onQ1.selected === null);
    ok('going back once more restores the answered question, locked', r.onQ0.answered === true);
    ok('with the exact option that was originally chosen, not just any answered state',
       r.onQ0.selected === r.q0Choice, `chose ${r.q0Choice}, restored ${r.onQ0.selected}`);
    ok('calling selectOpt directly on an answered question changes nothing',
       r.reanswerAttempt.total === 2 && r.reanswerAttempt.correct === r.afterQ2.correct,
       `total=${r.reanswerAttempt.total} correct=${r.reanswerAttempt.correct}`);
    ok('and the recorded selection is untouched by the attempt', r.reanswerAttempt.selectionUnchanged);
    ok('a question that was only skipped is fully answerable once revisited',
       r.q1AnsweredNow.answered && r.q1AnsweredNow.total === 3, `total=${r.q1AnsweredNow.total}`);
    ok('Previous does nothing before the first question', r.clamped === 0, String(r.clamped));
  }

  head('a rated review question cannot be rated twice');
  {
    const r = await page.evaluate(async () => {
      const qa = POOL[0];
      S.srs[qa.id] = { difficulty: 5, stability: 10, ivl: 1, reps: 2, lapses: 0, last: '2020-01-01', due: todayISO() };
      startQuiz(null, 'due');
      const at = S.questions.findIndex(q => q.id === qa.id);
      if (at < 0) return { found: false };
      S.qIdx = at; S.selected = null; S.answered = false;

      selectOpt(qa.ci);
      const wasReviewing = S.answered && S.mode === 'due';
      const before = S.srs[qa.id].stability;
      rateReview(3);
      const afterFirstRate = { stability: S.srs[qa.id].stability, rated: S.answers[at].rated, moved: S.qIdx !== at };

      prevQ();                                          // back onto the rated question
      const back = { qIdx: S.qIdx, matches: S.qIdx === at, answered: S.answered };
      const htmlNow = buildQuiz();

      const beforeSecond = S.srs[qa.id].stability;
      rateReview(1);                                     // direct call, bypassing the missing UI
      const afterSecondAttempt = { stability: S.srs[qa.id].stability, unchanged: S.srs[qa.id].stability === beforeSecond };

      return { found: true, wasReviewing, before, afterFirstRate,
               back, rateRowGone: !htmlNow.includes('rate-prompt'),
               revealShown: htmlNow.includes('reveal-card'), afterSecondAttempt };
    });

    ok('a due session presents the rate row when first answered', r.found && r.wasReviewing);
    ok('rating it writes a real schedule change',
       r.afterFirstRate.stability !== r.before && r.afterFirstRate.rated, String(r.afterFirstRate.stability));
    ok('and advances to the next question', r.afterFirstRate.moved);
    ok('going back lands on the same, now-rated question', r.back.matches && r.back.answered);
    ok('the rate row does not render for it a second time', r.rateRowGone);
    ok('a locked reveal is shown instead', r.revealShown);
    ok('calling rateReview on it directly writes nothing further', r.afterSecondAttempt.unchanged,
       String(r.afterSecondAttempt.stability));
  }

  head('the button itself, clicked rather than called');
  {
    await page.evaluate(() => startQuiz(CHAPTERS[0], 'all'));
    await page.waitForTimeout(250);
    const atStart = await page.locator('.btn-prev').count();
    await page.locator('.opt').first().click();
    await page.waitForTimeout(250);
    const answeredStillNone = await page.locator('.btn-prev').count();
    await page.locator('.btn-next').click();
    await page.waitForTimeout(250);
    const onQ1 = await page.locator('.btn-prev').count();
    await page.locator('.btn-prev').click();
    await page.waitForTimeout(250);
    const state = await page.evaluate(() => ({ qIdx: S.qIdx, answered: S.answered }));
    const disabledOpts = await page.locator('.opt[disabled]').count();

    ok('no Previous button on the very first question', atStart === 0);
    ok('still none immediately after answering it', answeredStillNone === 0);
    ok('it appears once a second question is reached', onQ1 === 1);
    ok('clicking it returns to question 0, answered', state.qIdx === 0 && state.answered === true);
    ok('and the restored options are disabled, not re-clickable', disabledOpts > 0, String(disabledOpts));
  }

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
