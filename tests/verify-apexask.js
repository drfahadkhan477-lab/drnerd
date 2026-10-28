#!/usr/bin/env node
/*
 * Apex is told what the fellow chose and how they miss, and answers from it — through the real panel, read off the real request.
 *
 *   node tests/verify-apexask.js build/synthetic/systole.html
 *
 * src/core/apexsignals.js and the page's wiring of it are held without a browser by verify-apexsignals-pure and
 * verify-apexctx-pure; this holds that the shipped page is wired to them:
 *   · every answer keeps the option chosen in the review log (practice, review and mock-block answers, the first option too; a
 *     self-rating has none),
 *     a backup carries it and an older backup, whose rows lack it, still restores and is read as "choice not recorded";
 *   · the request Apex receives, after a wrong answer, says what was chosen, that it was not the answer, how sure and how long;
 *     before an answer it says nothing of the kind; in grounded mode it names no option and never says whether the choice was right; how the fellow
 *     answers (certain and wrong, the last mock block) is told in both modes;
 *   · the miss row's "Ask Apex why", the chips and the results button open the panel and send the prompt, and with no key they open
 *     the setup screen and send nothing; the chip about the choice shows only once a question is answered;
 *   · a tool the model calls comes back with what the page holds: misses with the key outside grounded mode and without it inside,
 *     the performance report with how they answer, a plan that opens as a review session after the reply, a quiz of the flagged
 *     questions;
 *   · a mock block puts Apex away: nothing is sent into it, a reply that was already on its way when it opened is refused its tools,
 *     and one that had called a tool that moves the page does not move it into the block;
 *   · the button fits the row from a phone to an iPad, and nothing throws.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { launch, isEngineNoise } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, settled, quiet } = require('./_render.js');
const { blankComments } = require('./_source.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-apexask.js <build.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const has = (s, re) => typeof s === 'string' && (re instanceof RegExp ? re.test(s) : s.indexOf(re) >= 0);

/* Gemini's own stream shape, as verify-chat uses. */
const part = p => 'data: ' + JSON.stringify({ candidates: [{ content: { role: 'model', parts: [p] } }] }) + '\n\n';
const sse = text => part({ text }) + 'data: [DONE]\n\n';
const callSse = (name, args) => part({ functionCall: { name, args: args || {} } }) + 'data: [DONE]\n\n';

/* Drives the real importer with a real File, as verify-backup.js and verify-flags.js do. */
const RESTORE = `(text) => new Promise((resolve, reject) => {
  const file = new File([text], 'backup.json', { type: 'application/json' });
  const orig = document.createElement;
  let input = null;
  document.createElement = function (tag) {
    const el = orig.call(document, tag);
    if (tag === 'input') { input = el; el.click = () => {}; }
    return el;
  };
  importMarkup();
  document.createElement = orig;
  const dt = new DataTransfer();
  dt.items.add(file);
  Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
  const read = FileReader.prototype.readAsText;
  FileReader.prototype.readAsText = function () {
    const loaded = this.onload;
    this.onload = function () {
      const reader = this, args = arguments;
      Promise.resolve().then(() => loaded.apply(reader, args)).then(resolve, reject);
    };
    return read.apply(this, arguments);
  };
  try { input.onchange(); } finally { FileReader.prototype.readAsText = read; }
})`;

(async () => {
  const browser = await launch();
  const errors = [], events = [], dialogs = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));
  /* A context that blocks service workers, as routablePage() makes, so that a stubbed request is seen on every engine. */
  const page = watch(await (await browser.newContext({ viewport: { width: 1100, height: 900 }, serviceWorkers: 'block' })).newPage(), events, 'main');
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !isEngineNoise(m.text())) errors.push(m.text()); });
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });

  /* The model: every request is kept, and answered from `queued` (or with "Noted."). `hold` keeps answers waiting, from the request
   after the first `holdFrom` of them. */
  const captured = [], queued = [];
  let hold = null, holdFrom = 0;
  await page.route('**/generativelanguage.googleapis.com/**', async route => {
    let body = null;
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (_) { body = null; }
    captured.push(body);
    if (hold && captured.length > holdFrom) await hold;
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: queued.shift() || sse('Noted.') });
  });

  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await booted(page);

  const ids = await page.evaluate(() => CHAPTERS.slice(0, 4).map(ch => POOL.find(q => q.ch === ch && !q.bad).id));
  const [A, B, C, D] = ids;
  /* A question with a figure, for the chips: the first turn of its thread carries the figure. */
  const F = await page.evaluate(ids => (POOL.find(q => q.img && !q.bad && ids.indexOf(q.id) < 0) || {}).id || null, ids);
  const system = r => ((r && r.systemInstruction && r.systemInstruction.parts && r.systemInstruction.parts[0] && r.systemInstruction.parts[0].text) || '');
  const turns = r => ((r && r.contents) || []).map(c => ({ role: c.role, parts: c.parts || [] }));
  const lastUser = r => { const t = turns(r).filter(x => x.role === 'user'); const l = t[t.length - 1]; return l ? l.parts.map(p => p.text || '').join('') : ''; };
  /* What the fellow's turn asks: its last text part. The first turn of a thread on a question with a figure carries the figure
     first, after a rule about text inside images (src/core/vision.js withFigures), and the turn's own text after both; joined,
     the prompt compared equal to nothing. Every chip failed so on the owner's bank, where the question open had a figure. */
  const asks = r => { const t = turns(r).filter(x => x.role === 'user'); const l = t[t.length - 1]; const txt = l ? l.parts.filter(p => typeof p.text === 'string') : []; return txt.length ? txt[txt.length - 1].text : ''; };
  const figured = r => turns(r).some(x => x.role === 'user' && x.parts.some(p => p.inlineData));
  const toolResult = r => { const t = turns(r).filter(x => x.role === 'user'); const l = t[t.length - 1]; const p = l && l.parts.filter(x => x.functionResponse)[0]; return p ? String(p.functionResponse.response.content) : null; };
  const showing = id => page.waitForFunction(id => { const q = QBYID[id], t = document.querySelector('.q-tag'); return S.screen === 'quiz' && !!t && t.textContent.indexOf('Question ' + q.n + ' · ' + q.ch) >= 0 && !!document.getElementById('qFlag'); }, id, { timeout: 8000 }).then(() => true, () => false);
  const reached = (screen, ms) => page.waitForFunction(s => S.screen === s, screen, { timeout: ms || 8000 }).then(() => true, () => false);
  /* The model has been asked n more times: polled here, because the requests are kept here and not in the page. */
  const asked = async (n, ms) => { const end = Date.now() + (ms || 8000); while (captured.length < n && Date.now() < end) await new Promise(r => setTimeout(r, 40)); return captured.length >= n; };
  const idle = () => settled(page, () => typeof aiBusy !== 'undefined' && !aiBusy, { timeout: 30000, label: 'the exchange with the model to finish' });
  /* A world with nothing done, nothing marked and no block anywhere, and the panel on a key it will not be asked for. */
  const fresh = () => page.evaluate(() => {
    S.srs = {}; S.chStats = {}; S.missed = new Set(); S.daily = {}; S.practice = {}; S.sessionCorrect = 0; S.sessionTotal = 0; S.resume = {};
    S.flagged = new Set(); NOTES = {}; INK = {}; saveJSON(NOTE_KEY, NOTES); saveJSON(INK_KEY, INK);
    S.mocks = []; S.mock = null; S.mockLast = null; LOG.length = 0; _mockArm = false;
    localStorage.removeItem('accsap12.mock'); localStorage.removeItem('accsap12.mocklast');
    for (const k of Object.keys(CHATS)) delete CHATS[k];
    AI.provider = 'gemini'; AI.gemini = { key: 'test-gemini-key', model: 'gemini-2.5-flash' };
    AI_GROUNDED = false; aiBusy = false;
    window.apexHosted = () => false;
    save();
  });
  const openQuiz = async id => {
    await page.evaluate(id => startAdhocQuiz([QBYID[id]], null), id);
    const up = await showing(id); await quiet(page); return up;
  };
  const wrongPick = id => page.evaluate(id => (QBYID[id].ci + 1) % QBYID[id].o.length, id);
  const rightPick = id => page.evaluate(id => QBYID[id].ci, id);
  /* An answer given the way a fellow gives one: how sure, then the option. */
  const answer = async (idx, cf) => {
    if (cf != null) await page.click('.cf-chip[data-cf="' + cf + '"]');
    await page.click('.opt[data-idx="' + idx + '"]');
    await page.waitForFunction(() => S.answered === true, null, { timeout: 6000 });
    await quiet(page);
  };
  const panel = shut => page.evaluate(shut => { const sh = document.getElementById('shell'); const open = sh.classList.contains('ai-open'); if (shut ? open : !open) toggleAI(); }, !!shut);
  /* Say something to Apex through the page's own door and wait for the whole exchange. */
  const say = async text => {
    const n = captured.length;
    await page.evaluate(t => fire(t), text);
    await asked(n + 1);
    await idle();
    return captured.length - n;
  };

  head('the log keeps the option chosen');
  {
    await fresh();
    await openQuiz(A);
    const wrong = await wrongPick(A);
    await answer(wrong, 3);
    const row = await page.evaluate(() => LOG[LOG.length - 1]);
    ok('a practice answer logs the option chosen, as an index', row && row.q === A && row.m === 'practice' && row.ok === 0 && row.pick === wrong && row.cf === 3, JSON.stringify(row));
    await fresh();
    await openQuiz(B);
    const right = await rightPick(B);
    await answer(right, null);
    const row2 = await page.evaluate(() => LOG[LOG.length - 1]);
    ok('a right answer logs it too', row2 && row2.ok === 1 && row2.pick === right && row2.cf === null, JSON.stringify(row2));
    await fresh();
    await openQuiz(D);
    await answer(0, null);
    const rowA = await page.evaluate(() => LOG[LOG.length - 1]);
    ok('the first option is logged as 0, a choice, and not as no choice', rowA && rowA.q === D && rowA.pick === 0, JSON.stringify(rowA));
    await fresh();
    await page.evaluate(id => (S.resume = {}, startQuiz)(null, 'due', [QBYID[id]]), C);
    await showing(C); await quiet(page);
    const rc = await rightPick(C);
    await answer(rc, null);
    const rowDue = await page.evaluate(() => LOG[LOG.length - 1]);
    ok('a review answer logs it', rowDue && rowDue.m === 'review-answer' && rowDue.pick === rc, JSON.stringify(rowDue));
    await page.click('.rate-btn >> nth=0');
    const rated = await page.waitForFunction(() => LOG.some(r => r.m === 'review'), null, { timeout: 4000 }).then(() => true, () => false);
    const rowRate = await page.evaluate(() => LOG.filter(r => r.m === 'review').pop() || null);
    ok('a self-rating is logged with no choice: null, which is not option A', rated && rowRate && rowRate.pick === null, JSON.stringify(rowRate));
    await fresh();
    await page.evaluate(ids => { const real = MockExam.build; MockExam.build = () => ids.slice(); _mockCfg.sec = 0; _mockCfg.n = 20; _mockCfg.ch = ''; try { startMock(); } finally { MockExam.build = real; } mockStopTicker(); }, [A, B, C]);
    await reached('mock');
    const picks = await page.evaluate(([a, b]) => { MockExam.go(S.mock, 0); mockPick((QBYID[a].ci + 1) % QBYID[a].o.length); MockExam.go(S.mock, 1); mockPick(QBYID[b].ci); return [(QBYID[a].ci + 1) % QBYID[a].o.length, QBYID[b].ci]; }, [A, B]);
    await page.evaluate(() => mockSubmit());
    await reached('mockreport');
    const exam = await page.evaluate(() => LOG.filter(r => r.m === 'exam').map(r => ({ q: r.q, pick: r.pick, ok: r.ok, cf: r.cf })));
    ok('a block\'s answers log the option chosen, and the question left blank is not logged', same(exam, [{ q: A, pick: picks[0], ok: 0, cf: null }, { q: B, pick: picks[1], ok: 1, cf: null }]), JSON.stringify(exam));
  }

  head('a backup carries it, and an older one is still good');
  {
    await fresh();
    await openQuiz(A);
    const wrong = await wrongPick(A);
    await answer(wrong, 2);
    const exported = await page.evaluate(async () => {
      const create = URL.createObjectURL, click = HTMLAnchorElement.prototype.click; let blob = null;
      URL.createObjectURL = b => { blob = b; return 'blob:stub'; }; HTMLAnchorElement.prototype.click = () => {};
      try { await exportMarkup(); } finally { URL.createObjectURL = create; HTMLAnchorElement.prototype.click = click; }
      return blob ? await blob.text() : null;
    });
    const log = exported ? (JSON.parse(exported).log || []) : [];
    ok('an export holds the log with the option chosen', log.length === 1 && log[0].pick === wrong && log[0].q === A, JSON.stringify(log[0]));
    const old = { q: B, ch: 'x', ok: 0, m: 'practice', t: Date.now() - 86400000, ms: 20000, cf: 1, why: 'gap' };
    await page.evaluate(`(${RESTORE})(${JSON.stringify(JSON.stringify({ log: [old, log[0]] }))}).catch(() => {})`);
    const back = await page.evaluate(() => LOG.map(r => ({ q: r.q, pick: r.pick === undefined ? 'absent' : r.pick })));
    ok('a backup of rows with and without it restores both as they were', same(back, [{ q: B, pick: 'absent' }, { q: A, pick: wrong }]), JSON.stringify(back));
    await page.evaluate(([a, b]) => { S.missed = new Set([a, b]); }, [A, B]);
    const misses = await page.evaluate(() => String(runTool('get_misses', {}).result));
    ok('the older row is told as "choice not recorded", the newer with its letter',
      has(misses, new RegExp('\\[' + B + '\\][^\\n]*\\n  Choice not recorded')) && has(misses, new RegExp('\\[' + A + '\\][^\\n]*\\n  Chose ' + 'ABCDEFGH'[wrong] + ';')), misses.slice(0, 300));
  }

  head('what Apex is told after an answer');
  {
    await fresh();
    await openQuiz(A);
    await panel(false);
    captured.length = 0;
    await say('hello');
    ok('before an answer: nothing is said of what the fellow chose', captured.length === 1 && !has(system(captured[0]), 'WHAT THE FELLOW DID ON THIS ITEM'), String(captured.length));
    const wrong = await wrongPick(A);
    await answer(wrong, 3);
    captured.length = 0;
    await say('and now?');
    const sys = system(captured[0]);
    const L = 'ABCDEFGH'[wrong];
    ok('after a wrong answer given as Certain: what was chosen, that it was not the answer, how sure, how long',
      has(sys, new RegExp('The fellow chose ' + L + ', which was not the answer\\. Before answering they marked themselves "Certain"\\. They took \\d+ s\\.')), (sys.match(/The fellow chose[^\n]*/) || [''])[0]);
    ok('and the instruction to engage with it', has(sys, 'WHAT THE FELLOW DID ON THIS ITEM (their own answer; engage with it. A wrong answer given with high confidence is the most valuable thing to correct)'));
    await page.evaluate(() => setMissReason('misread'));
    captured.length = 0;
    await say('one more');
    ok('the reason they tag a miss with is told on the next turn', has(system(captured[0]), 'They say they missed it because: Misread the stem.'), (system(captured[0]).match(/The fellow chose[^\n]*/) || [''])[0]);
    await page.evaluate(() => { AI_GROUNDED = true; });
    captured.length = 0;
    await say('grounded now');
    const g = system(captured[0]);
    ok('in grounded mode: that they answered, how sure and how long, and not which option', has(g, /They have answered; the option they chose is withheld in grounded mode\. Before answering they marked themselves "Certain"\. They took \d+ s\./) && !has(g, 'The fellow chose') && has(g, 'commentary for this item is withheld'));
    ok('and nothing that says whether it was right or why it was missed', !has((g.match(/WHAT THE FELLOW DID ON THIS ITEM[^\n]*\n[^\n]*/) || [''])[0], /not the answer|which was right|because|most valuable/));
    await page.evaluate(() => { AI_GROUNDED = false; });
    /* A card rated in a review and looked at again: the rating is not the answer, so what is told of the answer is still the answer's. */
    await fresh();
    await page.evaluate(ids => (S.resume = {}, startQuiz)(null, 'due', ids.map(id => QBYID[id])), [C, D]);
    await showing(C); await quiet(page);
    await panel(false);
    await answer(await wrongPick(C), 2);
    await page.evaluate(() => setMissReason('misread'));
    await page.click('.rate-btn >> nth=0');
    const onD = await showing(D);
    await page.evaluate(() => prevQ());
    const backOnC = await showing(C); await quiet(page);
    captured.length = 0;
    await say('and this card again?');
    const again = system(captured[0]);
    ok('a card rated in a review and looked at again is still told as it was answered: how sure, and the reason given',
      onD && backOnC && has(again, 'marked themselves "Fairly sure"') && has(again, 'They say they missed it because: Misread the stem.'), (again.match(/The fellow chose[^\n]*/) || ['no line'])[0]);
  }

  head('how they answer, and the last mock block, in both modes');
  {
    await fresh();
    const seed = await page.evaluate(([a]) => {
      for (let i = 0; i < 14; i++) LOG.push({ t: Date.now() - (14 - i) * 3600000, q: 'SEED_' + i, ch: 'x', g: null, ok: i < 9 ? 1 : 0, m: 'practice', ms: 30000, cf: 3, why: i < 9 ? null : 'gap', pick: null });
      S.mocks = [{ ts: Date.now() - 2 * 86400000, n: 20, answered: 20, correct: 15, ms: 600000, limit: null, ch: null, by: { A: [8, 10], B: [7, 10] } }];
      S.flagged = new Set([a]); save();
      return true;
    }, [A]);
    await openQuiz(B);
    await panel(false);
    for (const grounded of [false, true]) {
      await page.evaluate(g => { AI_GROUNDED = g; }, grounded);
      captured.length = 0;
      await say('how am I doing?');
      const s = system(captured[0]);
      ok((grounded ? 'grounded' : 'open') + ': the block says how they answer: certain and wrong, the last mock block, what they flagged',
        seed && has(s, 'HOW THE FELLOW ANSWERS') && has(s, 'Marked Certain on 14 answers and was wrong on 5 of them (36%).') && has(s, 'Last mock block (2 days ago): 15 of 20 right (75%)') && has(s, '1 question flagged to come back to.'), (s.match(/HOW THE FELLOW ANSWERS[^]*?(?=\n\n[A-Z]|$)/) || [''])[0].slice(0, 300));
    }
    await page.evaluate(() => { AI_GROUNDED = false; LOG.length = 0; S.mocks = []; S.flagged = new Set(); save(); });
    captured.length = 0;
    await say('and when there is nothing to say?');
    ok('a thin record adds no block at all', !has(system(captured[0]), 'HOW THE FELLOW ANSWERS'));
  }

  head('the miss row, the chips and the results button');
  {
    await fresh();
    await panel(true);
    await openQuiz(A);
    const wrong = await wrongPick(A);
    await answer(wrong, 3);
    const row = await page.evaluate(() => { const r = document.querySelector('.miss-row'); const b = r && r.querySelector('.miss-ask'); return { chips: r ? r.querySelectorAll('.miss-chip').length : -1, ask: b ? b.textContent.trim() : null, onscreen: !!b && b.offsetWidth > 0 && b.offsetHeight > 0, shut: !document.getElementById('shell').classList.contains('ai-open') }; });
    ok('a wrong answer shows the five reasons and, beside them, Ask Apex why, on the screen', row.chips === 5 && row.ask === 'Ask Apex why' && row.onscreen, JSON.stringify(row));
    const prompts = await page.evaluate(() => ({ why: APEX_ASK.why, misses: APEX_ASK.misses, plan: APEX_ASK.plan }));
    captured.length = 0;
    await page.click('.miss-ask', { timeout: 4000 }).catch(() => {});   // a button that cannot be clicked is named by the checks below, not by a throw
    await page.waitForFunction(() => document.getElementById('shell').classList.contains('ai-open'), null, { timeout: 4000 }).catch(() => {});
    await asked(1);
    await idle();
    const opened = await page.evaluate(() => document.getElementById('shell').classList.contains('ai-open'));
    ok('it opens the panel that was shut and sends the prompt about the choice', row.shut && opened && captured.length === 1 && asks(captured[0]) === prompts.why, asks(captured[0]).slice(0, 80));
    ok('and what it sends comes with what the fellow chose', has(system(captured[0]), 'WHAT THE FELLOW DID ON THIS ITEM'));
    const chips = () => page.evaluate(() => [...document.querySelectorAll('#aiChips [data-chip]')].map(c => c.textContent.trim()).filter(t => t !== 'Clear thread'));
    const answeredChips = await chips();
    ok('the chip about the choice is in the panel once the question is answered, with the two new ones',
      answeredChips.indexOf('Why did I pick that?') >= 0 && answeredChips.indexOf('Explain my misses') >= 0 && answeredChips.indexOf('Plan my week') >= 0, answeredChips.join(' | '));
    await page.evaluate(() => { for (const k of Object.keys(CHATS)) delete CHATS[k]; });
    await openQuiz(B);
    const freshChips = await chips();
    ok('and not before: on a question not yet answered it is gone, the others stay', freshChips.indexOf('Why did I pick that?') < 0 && freshChips.indexOf('Explain my misses') >= 0 && freshChips.indexOf('Plan my week') >= 0, freshChips.join(' | '));
    /* The chips are pressed on a question with a figure, as on the owner's bank: the figure rides with the thread, and the
       prompt is still the chip's. */
    await page.evaluate(() => { for (const k of Object.keys(CHATS)) delete CHATS[k]; });
    const onFigure = !!F && await openQuiz(F);
    for (const [label, want] of [['Explain my misses', prompts.misses], ['Plan my week', prompts.plan]]) {
      captured.length = 0;
      await page.evaluate(label => { const b = [...document.querySelectorAll('#aiChips [data-chip]')].find(c => c.textContent.trim() === label); b.click(); }, label);
      await asked(1);
      await idle();
      ok('the chip "' + label + '" sends its prompt', onFigure && captured.length === 1 && figured(captured[0]) && asks(captured[0]) === want,
        !onFigure ? 'no question with a figure was open' : !captured.length ? 'nothing was sent' : !figured(captured[0]) ? 'no figure rode with the thread, so this is not the case it guards' : asks(captured[0]).slice(0, 60));
    }
    /* With no key the panel shows its setup screen: that is the answer, and nothing is sent. */
    await fresh();
    await page.evaluate(() => { AI.gemini = { key: '', model: 'gemini-2.5-flash' }; window.apexHosted = () => false; });
    await openQuiz(A);
    await answer(await wrongPick(A), 3);
    captured.length = 0;
    await page.click('.miss-ask', { timeout: 4000 }).catch(() => {});
    await page.waitForFunction(() => document.getElementById('shell').classList.contains('ai-open'), null, { timeout: 4000 }).catch(() => {});
    await quiet(page);
    await page.waitForTimeout(400);   // nothing observable marks a request that is never made: what shows it is the thread, which a send would have put the prompt in
    const setup = await page.evaluate(() => ({ open: document.getElementById('shell').classList.contains('ai-open'), composer: !!document.getElementById('aiIn'), busy: aiBusy, thread: chatFor(S.questions[S.qIdx]).length }));
    ok('with no key: the panel opens on its setup screen, there is no composer, nothing is asked and nothing is sent', setup.open && !setup.composer && !setup.busy && setup.thread === 0 && captured.length === 0, JSON.stringify(setup) + ' ' + captured.length);
    await fresh();
    await openQuiz(A);
    await answer(await rightPick(A), null);
    ok('a right answer has no miss row and so no button', await page.evaluate(() => !document.querySelector('.miss-ask')));
    /* The results screen. */
    await fresh();
    await openQuiz(A);
    await answer(await wrongPick(A), null);
    await page.evaluate(() => nextQ());
    await reached('results'); await quiet(page);
    const resBtn = await page.evaluate(() => [...document.querySelectorAll('.results-btns .btn')].map(b => b.textContent.trim().replace(/\s+/g, ' ')));
    ok('the results screen offers Explain my misses when there are misses', resBtn.some(t => /Explain my misses/.test(t)), JSON.stringify(resBtn));
    await panel(true);
    captured.length = 0;
    await page.evaluate(() => { const b = [...document.querySelectorAll('.results-btns .btn')].find(x => /Explain my misses/.test(x.textContent)); b.click(); });
    await asked(1);
    await idle();
    ok('and it opens Apex with the prompt about them', captured.length === 1 && asks(captured[0]) === prompts.misses, asks(captured[0]).slice(0, 60));
    /* A prompt asked while a reply is still on its way is not sent over it, and does not say it was. */
    await fresh();
    await openQuiz(A);
    await panel(false);
    let release3 = null;
    hold = new Promise(r => { release3 = r; }); holdFrom = 0;
    captured.length = 0;
    await page.evaluate(() => fire('a first question'));
    await asked(1);
    const second = await page.evaluate(() => askApex('a second, over the first'));
    release3(); hold = null;
    await idle();
    ok('a prompt asked while a reply is on its way is not sent over it, and the helper says so', second === false && captured.length === 1 && has(lastUser(captured[0]), 'a first question'), second + ' ' + captured.length);
    await fresh();
    await openQuiz(A);
    await answer(await rightPick(A), null);
    await page.evaluate(() => nextQ());
    await reached('results'); await quiet(page);
    ok('and does not when nothing is missed', await page.evaluate(() => ![...document.querySelectorAll('.results-btns .btn')].some(x => /Explain my misses/.test(x.textContent))));
  }

  head('the tools the model calls');
  {
    await fresh();
    await openQuiz(A);
    await panel(false);
    const wrong = await wrongPick(A);
    await answer(wrong, 3);
    await page.evaluate(() => setMissReason('gap'));
    queued.length = 0; queued.push(callSse('get_misses', {}), sse('Here is the theme.'));
    captured.length = 0;
    await say('what connects my misses?');
    const r1 = toolResult(captured[1]);
    const L = 'ABCDEFGH'[wrong];
    ok('the model asks for the misses and is given them, with the key, the stem and the wording', captured.length === 2 && has(r1, new RegExp('\\[' + A + '\\][^\\n]*\\n  Chose ' + L + '; the key is [A-H]\\. Marked "Certain"\\. Reason given: Didn\'t know it\\.')) && has(r1, '  Stem: ') && has(r1, /\n  [A-H]: /), String(r1).slice(0, 260));
    await page.evaluate(() => { AI_GROUNDED = true; });
    queued.length = 0; queued.push(callSse('get_misses', {}), sse('Noted.'));
    captured.length = 0;
    await say('and now?');
    const r2 = toolResult(captured[1]);
    ok('grounded: only which item and how sure, and a line saying the rest is withheld, the option chosen with it', captured.length === 2 && has(r2, new RegExp('\\[' + A + '\\][^\\n]*\\n  Marked "Certain"\\.')) && has(r2, 'Grounded mode: the key, the stems, the options\' wording and the option the fellow chose are withheld.') && !has((r2 || '').split('\n\n').slice(1).join('\n\n'), /Chose|Choice|the key|Stem:|Synthetic/), String(r2).slice(0, 260));
    await page.evaluate(() => { AI_GROUNDED = false; });
    await page.evaluate(() => { for (let i = 0; i < 14; i++) LOG.push({ t: Date.now() - (14 - i) * 3600000, q: 'SEED_' + i, ch: 'x', g: null, ok: i < 9 ? 1 : 0, m: 'practice', ms: 30000, cf: 3, why: i < 9 ? null : 'gap', pick: null }); });
    queued.length = 0; queued.push(callSse('get_performance', {}), sse('Noted.'));
    captured.length = 0;
    await say('how am I doing?');
    const perf = toolResult(captured[1]);
    ok('performance still gives the score, and now how they answer: the same lines the context carries',
      has(perf, /Answered overall: \d+\/\d+/) && has(perf, '\n\nHow they answer:\n') && has(perf, 'Marked Certain on 15 answers and was wrong on 6 of them (40%).'), String(perf).slice(0, 160));
    queued.length = 0; queued.push(callSse('plan_session', { minutes: 10 }), sse('Starting.'));
    captured.length = 0;
    await page.evaluate(() => goStudy());
    await reached('study');
    await page.evaluate(() => { aiBusy = false; });
    await say('what should I do today?');
    const planResult = toolResult(captured[1]);
    ok('the plan tool says what the session holds and that it opens after the reply', has(planResult, /^10 min · \d+ questions?: /) && has(planResult, 'It will open as a review session as soon as this reply finishes'), String(planResult).slice(0, 200));
    const planned = await page.waitForFunction(() => S.screen === 'quiz' && S.mode === 'due', null, { timeout: 8000 }).then(() => true, () => false);
    const n = await page.evaluate(() => S.questions.length);
    ok('and the review session opens when the reply is over', planned && n >= 1, 'questions: ' + n);
    await fresh();
    await page.evaluate(([a, b]) => { S.flagged = new Set([a, b]); save(); }, [C, D]);
    await openQuiz(A);
    await panel(false);
    queued.length = 0; queued.push(callSse('start_quiz', { flagged_only: true }), sse('Opening them.'));
    captured.length = 0;
    await say('drill my flagged ones');
    const deck = await page.waitForFunction(ids => S.screen === 'quiz' && S.questions.length === 2 && S.questions.every(q => ids.indexOf(q.id) >= 0), [C, D], { timeout: 8000 }).then(() => true, () => false);
    ok('a quiz of the flagged questions opens', deck);
  }

  head('a mock block puts Apex away');
  {
    await fresh();
    await openQuiz(A);
    await panel(false);
    const startBlock = ids => page.evaluate(ids => { const real = MockExam.build; MockExam.build = () => ids.slice(); _mockCfg.sec = 0; _mockCfg.n = 20; _mockCfg.ch = ''; try { startMock(); } finally { MockExam.build = real; } mockStopTicker(); }, ids);
    /* A reply already on its way when the block is opened: held, then let go with a tool call that would hand over a question. */
    let release = null;
    hold = new Promise(r => { release = r; });
    queued.length = 0; queued.push(callSse('open_question', { question_id: B }), sse('Done.'));
    captured.length = 0;
    await page.evaluate(() => fire('open another for me'));
    /* Precondition: the request has reached the model, which is holding its answer. */
    const sent = await (async () => { for (let i = 0; i < 100 && captured.length < 1; i++) await new Promise(r => setTimeout(r, 50)); return captured.length; })();
    ok('a reply is on its way: the request is at the model and held', sent === 1);
    await startBlock([C, D]);
    await reached('mock');
    await page.waitForSelector('#mockSub', { timeout: 8000 });
    const away = await page.evaluate(() => ({ attr: document.documentElement.hasAttribute('data-mock'), open: document.getElementById('shell').classList.contains('ai-open') }));
    ok('the block is open: the page says so and the panel is shut', away.attr && !away.open, JSON.stringify(away));
    release(); hold = null;
    await idle();
    ok('the reply that was on its way is not carried on: its tool call is not run and no further request is made', captured.length === 1, String(captured.length));
    const direct = await page.evaluate(() => String(runTool('remember', { text: 'a fact from inside the block' }).result));
    const kept = await page.evaluate(() => (typeof Memory !== 'undefined') ? Memory.build() : '');
    ok('and a tool called directly while the block is open is refused, says why, and writes nothing', has(direct, 'A mock exam block is open') && !has(kept, 'a fact from inside the block'), direct.slice(0, 100));
    const still = await page.evaluate(() => ({ screen: S.screen, mock: !!S.mock, q: S.mock ? S.mock.ids.length : 0 }));
    ok('and the page did not navigate: the block is where it was', still.screen === 'mock' && still.mock && still.q === 2, JSON.stringify(still));
    captured.length = 0;
    await page.evaluate(() => { fire('anything'); });
    await page.waitForTimeout(500);   // nothing observable marks a request that is never made; the positive control below shows the stub answers
    const asked0 = await page.evaluate(() => Object.keys(CHATS).some(k => (CHATS[k] || []).some(m => m.content === 'anything')));
    ok('nothing is sent into the block, whoever asks, and nothing is asked: the prompt is in no thread', captured.length === 0 && !asked0, captured.length + ' ' + asked0);
    ok('and the helper that opens Apex for a chip or a button says no', await page.evaluate(() => askApex('hello') === false) && captured.length === 0);
    await page.evaluate(() => mockSubmit());
    await reached('mockreport');
    await page.waitForSelector('.mock-report', { timeout: 8000 });
    await quiet(page);
    await panel(false);
    captured.length = 0;
    await say('and now the block is over');
    ok('control: once the block is handed in the same door sends', captured.length === 1 && has(lastUser(captured[0]), 'and now the block is over'));
    /* A reply that has already called a tool that moves the page, and is still saying its last words when the block is opened: the
       move waits for the end of the reply, and must not be made into the block. */
    await fresh();
    await openQuiz(A);
    await panel(false);
    let release2 = null;
    hold = new Promise(r => { release2 = r; }); holdFrom = 1;
    queued.length = 0; queued.push(callSse('open_question', { question_id: B }), sse('Done.'));
    captured.length = 0;
    await page.evaluate(() => fire('open another for me'));
    const sent2 = await (async () => { for (let i = 0; i < 100 && captured.length < 2; i++) await new Promise(r => setTimeout(r, 50)); return captured.length; })();
    const queuedNav = await page.evaluate(() => (typeof pendingNav !== 'undefined' && pendingNav) ? pendingNav.kind : null);
    ok('a reply has called a tool that opens a question, and its last words are held at the model', sent2 === 2 && queuedNav === 'open', sent2 + ' requests, nav ' + queuedNav);
    await startBlock([C, D]);
    await reached('mock');
    await page.waitForSelector('#mockSub', { timeout: 8000 });
    release2(); hold = null; holdFrom = 0;
    await idle();
    const stayed = await page.evaluate(() => ({ screen: S.screen, mock: !!S.mock, nav: (typeof pendingNav !== 'undefined' && pendingNav) ? pendingNav.kind : null }));
    ok('the question is not opened into the block: the page is still the block, and nothing waits to open', stayed.screen === 'mock' && stayed.mock && stayed.nav === null, JSON.stringify(stayed));
    await page.evaluate(() => mockSubmit());
    await reached('mockreport');
    await page.waitForSelector('.mock-report', { timeout: 8000 });
  }

  head('the button fits the row, from a phone to an iPad');
  {
    for (const w of [320, 390, 834, 1100]) {
      await page.setViewportSize({ width: w, height: 900 });
      await fresh();
      await openQuiz(A);
      await panel(true);
      const before = await page.evaluate(() => document.documentElement.scrollWidth);
      await answer(await wrongPick(A), null);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await quiet(page);
      const m = await page.evaluate(() => {
        const b = document.querySelector('.miss-ask'), r = document.querySelector('.miss-row');
        if (!b || !r) return null;
        const bb = b.getBoundingClientRect(), rr = r.getBoundingClientRect();
        return { left: Math.round(bb.left), right: Math.round(bb.right), h: Math.round(bb.height), rowRight: Math.round(rr.right), vw: innerWidth, sw: document.documentElement.scrollWidth };
      });
      ok(w + ' px: the button is inside the row and the screen and at least 32 px tall', !!m && m.left >= 0 && m.right <= m.vw && m.right <= m.rowRight + 1 && m.h >= 32, JSON.stringify(m));
      ok(w + ' px: it adds no sideways scroll to the page (what was already there is not its doing)', !!m && m.sw <= Math.max(before, m.vw), before + ' before, ' + (m && m.sw) + ' after');
    }
    await page.setViewportSize({ width: 1100, height: 900 });
  }

  head('hygiene');
  {
    const src = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'css', 'apex.css'), 'utf8'));
    ok('the new rule keeps the Safari floor: no overflow-wrap:anywhere', !/overflow-wrap\s*:\s*anywhere/.test((src.match(/\.miss-ask\s*\{[^}]*\}/) || [''])[0]));
    ok('the module is in the page', await page.evaluate(() => typeof ApexSignals === 'object' && typeof ApexSignals.digest === 'function'));
    ok('no dialog opened', dialogs.length === 0, dialogs.join('; '));
    ok('and the page threw nothing', errors.length === 0, errors.slice(0, 3).join(' | '));
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
