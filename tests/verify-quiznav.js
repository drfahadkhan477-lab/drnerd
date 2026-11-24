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
 *
 * And the header those moves redraw: the counter says the place in the session ("4 of 20"), and only the question's
 * tag says "Question" with the bank's own number. And Skip, Home and start over, clicked.
 * And the owner's choices of November 2026, each through the real page: the master Apex Brain that replaced the card
 * over the question (the Apex button wears the session; Apex opens on it; a tap or a key picks a question, Go goes,
 * an ask goes to Apex as written; off a question the button is Apex's alone); the keys offered only once a key is
 * pressed; the pencil's tools only once Settings turns them on.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');
const { booted, afterRender, settled } = require('./_render.js');
const { onDeath } = require('./_deathnote.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-quiznav.js <patched.html>'); process.exit(1); }
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
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  const errors = [];
  const events = [];
  page.on('crash', () => events.push('the browser CRASHED the page'));
  page.on('close', () => events.push('the page closed'));
  page.on('requestfailed', r => {
    const why = (r.failure() || {}).errorText || '';
    if (why) events.push(`request failed: ${String(r.url()).slice(-50)} — ${why}`);
  });
  /* A crash and a close are different diagnoses; Playwright reports both
     as "Target page, context or browser has been closed" on the next call,
     so only the event says which. See tests/_deathnote.js. */
  onDeath(() => ({ section, checks: passed + failed, errors,
                   events: events.length ? events.join(', ') : 'none' }));
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await booted(page);
  await page.waitForTimeout(1000);

  head('a skip is recoverable, an answer is not');
  {
    const r = await page.evaluate(async () => {
      (S.resume = {}, startQuiz)(CHAPTERS[0], 'all');
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
      const mkDue = q => { S.srs[q.id] = { difficulty: 5, stability: 10, ivl: 1,
        reps: 2, lapses: 0, last: '2020-01-01', due: todayISO() }; };
      /* TWO cards due, not one. Rating the last question in a session correctly
         does NOT advance — there is nowhere to go — so a session of one makes
         "and advances to the next question" untestable rather than false. */
      mkDue(qa); mkDue(POOL[1]);
      (S.resume = {}, startQuiz)(null, 'due');
      let at = S.questions.findIndex(q => q.id === qa.id);
      if (at < 0 || S.questions.length < 2) return { found: false };
      /* startQuiz shuffles the due queue, so this question's position is a
         fresh draw every run. When it drew last, rating it advanced nowhere and
         this block failed — intermittently, standalone, about one run in three.
         The app was right each time; the assumption that a rated question has a
         successor was what varied. Move it off the end rather than hope. */
      if (at === S.questions.length - 1) {
        const t = S.questions[0]; S.questions[0] = S.questions[at];
        S.questions[at] = t; at = 0;
      }
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
               at, sessionLen: S.questions.length,
               back, rateRowGone: !htmlNow.includes('rate-prompt'),
               revealShown: htmlNow.includes('reveal-card'), afterSecondAttempt };
    });

    ok('a due session presents the rate row when first answered', r.found && r.wasReviewing);
    ok('and the session has somewhere to advance TO — otherwise the next check is vacuous',
       r.sessionLen >= 2 && r.at < r.sessionLen - 1, `question ${r.at + 1} of ${r.sessionLen}`);
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
    await page.evaluate(() => (S.resume = {}, startQuiz)(CHAPTERS[0], 'all'));
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

  /* Two numbers sit on the quiz: where this question falls in the session, and the bank's own number for it. Both
     used to be "Q"/"Question" — "Q 1 / 20" over "Question 10 · Arrhythmias" — so the screen named one question by two
     numbers in the same words. The tag keeps the bank's number (what the source bank and Apex call it); the counter
     says only a place. */
  head('the counter is a place in the session; the tag is the question\'s own number');
  {
    await page.evaluate(() => (S.resume = {}, startQuiz)(CHAPTERS[0], 'all'));
    /* Move to a question whose place in the deck differs from its number, so the two cannot agree by accident. */
    const moved = await page.evaluate(() => { for (let k = 0; k < S.questions.length; k++) { if (S.qIdx + 1 !== S.questions[S.qIdx].n) return true; nextQ(); } return false; });
    /* The place is the Apex button's now, the master Apex Brain (the owner's choice, November 2026). */
    await afterRender(page, () => { const c = document.getElementById('fabCount'), t = document.getElementById('qTag'), q = S.questions[S.qIdx];
      return S.screen === 'quiz' && !!c && !!t && new RegExp('(^|\\D)' + (S.qIdx + 1) + '(\\D|$)').test(c.textContent) && t.textContent.indexOf('Question ' + q.n) >= 0; },
      { label: 'the quiz header to show the question now in S.qIdx' });
    const r = await page.evaluate(() => { const c = document.getElementById('fabCount'), q = S.questions[S.qIdx];
      return { seen: c.textContent.trim(), all: document.getElementById('aiFab').getAttribute('aria-label'), tag: document.getElementById('qTag').textContent.trim(), place: S.qIdx + 1, of: S.questions.length, n: q.n }; });
    ok('a question whose place differs from its number was reached (precondition)', moved, JSON.stringify({ place: r.place, n: r.n }));
    ok('the Apex button shows the place as "k of n"', r.seen === `${r.place} of ${r.of}`, JSON.stringify(r.seen));
    ok('and does not call it "Q" or "Question", the word the tag uses for the bank\'s own number',
      !/\bQ(uestion)?\b/.test(r.seen) && r.tag.indexOf('Question ' + r.n) === 0, JSON.stringify({ counter: r.seen, tag: r.tag.slice(0, 40) }));
    ok('a screen reader is told what the place counts, in the button\'s name', r.all.indexOf(`Apex, with this session: question ${r.place} of ${r.of}, `) === 0, JSON.stringify(r.all));
  }

  /* docs/ROADMAP.md, E2. The quiz's buttons name actions, not inline handlers, which the page's ACTIONS table calls
     through one listener on the document (src/core/actions.js). Next and Previous are clicked above; the flag, the
     ratings, the chips and Ask Apex why in their own suites (verify-flags, verify-apexask, verify-mockscreen). Skip, Home
     and Resumed · start over are clicked here, each from a quiz drawn for it, through the real functions. A wait is a
     precondition (the screen drawn, by afterRender); a click that cannot be made, or a state that never comes, is FAIL. */
  head('Skip, Home and start over, clicked');
  {
    const act = f => f().then(() => true, () => false);
    const until = (fn, arg) => page.waitForFunction(fn, arg === undefined ? null : arg, { timeout: 8000, polling: 40 }).then(() => true, () => false);
    const fresh = async extra => {
      await page.evaluate(x => { (S.resume = {}, startQuiz)(CHAPTERS[0], 'all'); if (x) { S.resumed = true; render(); } }, !!extra);
      await afterRender(page, sel => S.screen === 'quiz' && S.qIdx === 0 && !!document.querySelector(sel), { arg: extra || '.btn-skip', label: 'a fresh quiz with ' + (extra || '.btn-skip') });
    };
    await fresh();
    const skipped = await act(() => page.locator('.btn-skip').click({ timeout: 5000 })) && await until(() => S.screen === 'quiz' && S.qIdx === 1 && !S.answered);
    ok('Skip moves on to the next question, unanswered', skipped, await page.evaluate(() => JSON.stringify({ screen: S.screen, qIdx: S.qIdx, answered: S.answered })));
    await fresh();
    const home = await act(() => page.locator('.btn-home').click({ timeout: 5000 })) && await until(() => S.screen === 'home');
    ok('Home leaves the quiz for the home screen', home, await page.evaluate(() => S.screen));
    await fresh('#aiFab.has-brain');
    await page.evaluate(() => { S.qIdx = 1; S.resumed = true; render(); });
    await afterRender(page, () => S.qIdx === 1 && (document.getElementById('fabCount') || {}).textContent === '2 of ' + S.questions.length, { label: 'the second question, resumed' });
    /* Start over is in the session at the head of Apex's panel now (the owner's choice, November 2026). */
    const opened = await act(() => page.locator('#aiFab').click({ timeout: 5000 })) && await until(() => !!document.querySelector('#aiSession .q-restart'));
    ok('the Apex button, tapped, opens Apex on the session, with start over for a resumed session', opened, await page.evaluate(() => JSON.stringify({ session: !!document.getElementById('aiSession'), restart: !!document.querySelector('#aiSession .q-restart') })));
    /* Start over is in the session row's detail, which the row opens (a clean chat window). The same chapter and mode:
       the results screen's Restart is an action named restartQuiz too, and it would start a quiz from its first question
       with neither. */
    await act(() => page.locator('#aiSession .sb-row').click({ timeout: 5000 }));
    await until(() => { const b = document.querySelector('#aiSession .q-restart'); return !!b && b.getBoundingClientRect().width > 0; });
    const over = await act(() => page.locator('.q-restart').click({ timeout: 5000 })) && await until(ch => S.screen === 'quiz' && S.qIdx === 0 && S.resumed === false && S.chapter === ch && S.mode === 'all', await page.evaluate(() => CHAPTERS[0]));
    ok('Start over deals the same chapter again, in the same mode, from its first question, no longer resumed', over, await page.evaluate(() => JSON.stringify({ qIdx: S.qIdx, resumed: S.resumed, chapter: S.chapter === CHAPTERS[0] ? 'the same' : S.chapter, mode: S.mode })));
    await page.evaluate(() => { if (document.getElementById('shell').classList.contains('ai-open')) toggleAI(); });
  }

  head('the master Apex Brain, the keys and the pencil');
  {
    /* A context of its own, so nothing a section above pressed or saved is carried in, at an iPad's size, where the
       keys would be offered. */
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL, { waitUntil: 'load', timeout: 200000 });
    await booted(p);
    await p.evaluate(() => { (S.resume = {}, startQuiz)(CHAPTERS[0], 'all'); });
    await afterRender(p, () => S.screen === 'quiz' && S.qIdx === 0 && !!document.querySelector('#aiFab.has-brain') && !!document.querySelector('.kb-keys'),
      { label: 'a fresh quiz with the Apex button on the session and the key hint drawn' });
    const shown = sel => p.evaluate(x => { const el = document.querySelector(x); return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0; }, sel);

    ok('before a key is pressed, the hint that names keys is drawn but not shown', await shown('.kb-keys') === false && await p.evaluate(() => !document.documentElement.hasAttribute('data-keys')));
    await p.keyboard.press('Shift');
    ok('a modifier alone says nothing of a keyboard', await shown('.kb-keys') === false);
    await p.keyboard.press('x');
    ok('a key pressed shows it, and the device keeps that', await shown('.kb-keys') === true && await p.evaluate(() => localStorage.getItem('systole.keys') === '1'),
      await p.evaluate(() => String(localStorage.getItem('systole.keys'))));

    ok('the pencil\'s tools are not offered on a question until Settings turns them on', await p.evaluate(() => !!document.getElementById('rail')) && await shown('#rail') === false);
    await p.evaluate(() => openSettings());
    await p.selectOption('#generalSettings select[name="pencil"]', 'on');
    ok('Settings\' pencil tools, set On, offer them on the question, kept on the device', await shown('#rail') === true
       && await p.evaluate(() => (JSON.parse(localStorage.getItem('systole.display') || '{}')).pencil === 'on'));
    await p.evaluate(() => railAction('pen'));
    const inHand = await p.evaluate(() => T.active);
    await p.selectOption('#generalSettings select[name="pencil"]', 'off');
    ok('and set Off, take them away again', await shown('#rail') === false);
    ok('with the pen that was in hand put down, so nothing draws on a question that shows no tools',
      inHand === true && await p.evaluate(() => T.active === false && !document.querySelector('.ink-host.ink-on')), String(inHand));
    await p.evaluate(() => closeSettings());
    /* A Pencil touch with the rail folded and auto-minimize on wakes the tools and draws (verify-polish); with the tools
       away it is a touch like a finger's. The event is dispatched, as in verify-polish, for pointerType 'pen'. */
    const woke = await p.evaluate(() => {
      const cap = Element.prototype.setPointerCapture; Element.prototype.setPointerCapture = function () {};
      T.autoMin = true; T.min = true;
      const cv = document.querySelector('.q-card .ink-canvas'); if (!cv) { Element.prototype.setPointerCapture = cap; return 'no canvas'; }
      const r = cv.getBoundingClientRect();
      cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + 20, clientY: r.top + 20, pointerType: 'pen', pressure: .5, bubbles: true }));
      cv.dispatchEvent(new PointerEvent('pointerup', { clientX: r.left + 20, clientY: r.top + 20, pointerType: 'pen', bubbles: true }));
      Element.prototype.setPointerCapture = cap;
      const out = { active: T.active, min: T.min }; T.autoMin = false; return out;
    });
    ok('a Pencil touch does not wake tools that Settings has put away', woke.active === false && woke.min === true, JSON.stringify(woke));

    await p.evaluate(() => { selectOpt(S.questions[0].ci); });
    await afterRender(p, () => S.answered === true, { label: 'the first question answered' });
    await p.evaluate(() => nextQ());
    await afterRender(p, () => S.qIdx === 1 && (document.getElementById('fabCount') || {}).textContent === '2 of ' + S.questions.length, { label: 'the second question' });
    const fab = await p.evaluate(() => { const b = document.getElementById('aiFab');
      return { brain: b.classList.contains('has-brain'), dots: b.querySelectorAll('#fabBrain .sb-dot').length, n: S.questions.length, cur: !!b.querySelector('#fabBrain .sb-dot[data-current="1"]'),
        right: b.querySelectorAll('#fabBrain .sb-dot[data-state="right"]').length, label: b.getAttribute('aria-label'), mark: !!b.querySelector('#apexFabAvatar') }; });
    ok('the Apex button wears the session: a point for each question, the one answered right, the one on screen marked, beside Apex\'s own mark',
      fab.brain && fab.dots === fab.n && fab.right === 1 && fab.cur && fab.mark, JSON.stringify(fab));
    ok('and its name says the place and the counts', fab.label === `Apex, with this session: question 2 of ${fab.n}, 1 right, 0 wrong. Open`, fab.label);
    /* A key, so Apex opens on its conversation rather than its setup (nothing is sent: fire() is stood in for below). */
    await p.evaluate(() => { AI.provider = 'gemini'; AI.gemini = Object.assign({}, AI.gemini, { key: 'test-key' }); });
    await p.click('#aiFab');
    await settled(p, () => !!document.querySelector('#aiSession .sb-row') && !!document.getElementById('aiBody'), { label: 'Apex to open on the session and its conversation' }).catch(() => {});
    /* A clean chat window (the owner's word): the session one row over the conversation, shut; its asks in the tray
       under it with the actions on this device; the conversation one line until something is asked. */
    const open = await p.evaluate(() => { const x = document.getElementById('aiSession'), stat = k => ((x && x.querySelector('.sb-stat[data-state="' + k + '"] b')) || {}).textContent;
      const row = x && x.querySelector('.sb-row'), body = document.getElementById('aiBody');
      return { inApex: !!(x && x.closest('#ai')), first: !!(x && x.previousElementSibling && x.previousElementSibling.classList.contains('ai-head')), where: ((x && x.querySelector('.sb-where')) || {}).textContent,
        right: stat('right'), wrong: stat('wrong'), share: stat('share'), shut: !!row && row.getAttribute('aria-expanded') === 'false' && !!x.querySelector('#sbDetail[hidden]'),
        asks: document.querySelectorAll('#aiChips .sb-ask').length, inRow: x ? x.querySelectorAll('.sb-ask').length : -1,
        body: body ? body.textContent.trim() : null, local: !!(body && body.querySelector('[data-apex-local-actions]')) }; });
    ok('Apex opens on the session, one row under its head, shut: where the reader is, the counts and the share right', open.inApex && open.first && open.where === 'Question 2 of ' + fab.n
      && open.right === '1' && open.wrong === '0' && open.share === '100% right' && open.shut, JSON.stringify(open));
    ok('and a clean conversation: one line, the session\'s asks and the actions on this device in the tray, not over the chat', open.asks === 2 && open.inRow === 0 && !open.local
      && open.body === 'Ask about this question, or anything in cardiology.', JSON.stringify({ asks: open.asks, inRow: open.inRow, local: open.local, body: open.body }));
    await p.click('#aiSession .sb-row');
    await settled(p, () => { const b = document.querySelector('#aiSession .sb-brain'); return !!b && b.getBoundingClientRect().width > 0; }, { label: 'the session row to open on the brain' }).catch(() => {});
    ok('the row, tapped, opens on the brain, and says so', await p.evaluate(() => { const r = document.querySelector('#aiSession .sb-row'), b = document.querySelector('#aiSession .sb-brain');
      return !!r && r.getAttribute('aria-expanded') === 'true' && !!b && b.getBoundingClientRect().width > 0 && document.activeElement === r; }));
    const dot = await p.evaluate(() => { const c = document.querySelectorAll('#aiSession .sb-brain .sb-dot')[0].getBoundingClientRect(); return { x: c.left + c.width / 2, y: c.top + c.height / 2 }; });
    await p.mouse.click(dot.x, dot.y);
    const picked = await p.evaluate(() => (document.querySelector('#aiSession .sb-picked-t') || {}).textContent || '');
    ok('a tap on a point picks that question, said in words', picked === 'Question 1, answered right', picked);
    await p.keyboard.press('ArrowRight');
    const here = await p.evaluate(() => ({ t: (document.querySelector('#aiSession .sb-picked-t') || {}).textContent || '', go: !!document.querySelector('#aiSession .sb-go'), q: S.qIdx }));
    await p.keyboard.press('ArrowRight');
    const third = await p.evaluate(() => ({ go: (document.querySelector('#aiSession .sb-go') || {}).textContent || '', q: S.qIdx }));
    ok('the arrow keys walk the questions, not the quiz: the one on screen has no Go, the next has one', /^Question 2, on screen/.test(here.t) && !here.go && /Go to question 3/.test(third.go)
      && here.q === 1 && third.q === 1, JSON.stringify([here, third]));
    await p.click('#aiSession .sb-go');
    await afterRender(p, () => S.qIdx === 2 && !!document.querySelector('#aiSession .sb-where'), { label: 'question 3, gone to' }).catch(() => {});
    ok('Go goes to that question, and Apex stays open on the session, following it', await p.evaluate(() => S.screen === 'quiz' && S.qIdx === 2
      && document.getElementById('shell').classList.contains('ai-open') && document.querySelector('#aiSession .sb-where').textContent === 'Question 3 of ' + S.questions.length),
      await p.evaluate(() => S.qIdx));
    /* An ask goes to Apex as written. A key is set and fire() stood in for, so nothing leaves the page. */
    const sent = await p.evaluate(() => { AI.provider = 'gemini'; AI.gemini = Object.assign({}, AI.gemini, { key: 'test-key' }); buildAI();
      const got = []; const real = window.fire; window.fire = t => got.push(t); const b = document.querySelector('#aiChips .sb-ask');
      const want = b ? b.getAttribute('data-ask') : null; if (b) b.click(); window.fire = real; return { got, want }; });
    ok('an ask goes to Apex as written: what to study next, with the session\'s counts', sent.got.length === 1 && sent.got[0] === sent.want && /^This session on .+: 1 right and 0 wrong of 1 answered/.test(sent.want), JSON.stringify(sent));
    await p.evaluate(() => toggleAI());
    await settled(p, () => getComputedStyle(document.getElementById('aiFab')).display !== 'none', { label: 'the Apex button back' }).catch(() => {});
    ok('closed, Apex leaves the button wearing the session', await p.evaluate(() => document.getElementById('aiFab').classList.contains('has-brain') && document.getElementById('fabCount').textContent === '3 of ' + S.questions.length));
    await p.evaluate(() => goHome());
    await afterRender(p, () => S.screen === 'home', { label: 'Home' }).catch(() => {});
    ok('off a question the button is Apex\'s alone', await p.evaluate(() => { const b = document.getElementById('aiFab');
      return !b.classList.contains('has-brain') && !b.querySelector('#fabBrain svg') && b.getAttribute('aria-label') === 'Open the Apex tutor'; }));
    await ctx.close();
  }

  ok('no console or page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
