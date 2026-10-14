#!/usr/bin/env node
/*
 * The app calls the bank what the bank calls itself, and claims nothing a bank
 * without ACCSAP's data cannot back.
 *
 *   node tests/verify-bankname.js <build.html|url>
 *
 * Which bank the app runs on is BANK in app/systole.html: the build's own
 * label (BANK_INFO, scripts/which-bank.js), or, in the code-only deploy, the
 * one the imported package names, which the loader puts on
 * window.SYSTOLE_BANK before the app's code runs. This suite takes that second
 * road to run the synthetic build as a bank that is not ACCSAP's, and reads
 * what the app actually says: the request to the tutor as it leaves the page,
 * and the text of the screens.
 *
 * As another bank:
 *   - the tutor's context names the bank, and its commentary heading names no
 *     one; the bank search tool's description names the bank;
 *   - no word of ACCSAP or the ACC reaches the tutor, open or grounded, or the
 *     home, search, notes and answered-question screens;
 *   - a question with no peer statistics shows no percentage, no answer
 *     distribution and no "undefined", and the tutor is not told how many
 *     candidates chose each option.
 * As built (ACCSAP 12, for the synthetic build), the same screens and request
 * say ACCSAP 12, the ACC commentary and the distribution, which is what shows
 * the checks above can see those words when they are there.
 *
 * The tutor's provider is answered here; no request leaves the machine.
 */
'use strict';
const path = require('path');
const { launch, isEngineNoise, routablePage } = require('./_engine');
const { booted, onScreen, resolved } = require('./_render.js');
const { onDeath } = require('./_deathnote.js');
const { systemText } = require('./_wire');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-bankname.js <build.html|url>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

const SSE = [
  'data: ' + JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Noted.' }] } }] }),
  'data: [DONE]',
  '',
].join('\n\n');

const OWN = { id: 'tested-bank', name: 'Tested Bank', by: '' };
const OWN_QUESTION = require('../scripts/synthetic-export.js').syntheticBank().bank[0];
/* A word of ACCSAP's or the ACC's as the app would write it; not the ACC/AHA
   of a guideline's name. */
const ACC_WORDS = /ACCSAP|(?<![A-Za-z/])ACC(?![A-Za-z/])/;
const flat = t => String(t || '').replace(/\s+/g, ' ');
const around = (t, re) => { const m = re.exec(t); return m ? JSON.stringify(t.slice(Math.max(0, m.index - 40), m.index + 40)) : 'none'; };

async function session(browser, bank, errors) {
  const page = await routablePage(browser, { viewport: { width: 1280, height: 950 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !isEngineNoise(m.text())) errors.push(m.text()); });
  /* The loader's hand-off, as the code-only deploy makes it. */
  if (bank) await page.addInitScript(b => { window.SYSTOLE_BANK = { source: 'imported', bank: b }; }, bank);
  const captured = [];
  await page.route('**/generativelanguage.googleapis.com/**', route => {
    try { captured.push(JSON.parse(route.request().postData() || '{}')); } catch (_) { captured.push(null); }
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: SSE }).catch(() => {});
  });
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await booted(page);
  return { page, captured };
}

/* One exchange with the tutor on the first question that is not set aside,
   as verify-braunwald drives one, and the request as it left the page. */
async function ask(s, grounded) {
  s.captured.length = 0;
  await s.page.evaluate(g => {
    if (AI_GROUNDED !== g) toggleGrounded();
    AI.provider = 'gemini';
    AI.gemini = { key: 'test-gemini-key', model: 'gemini-2.5-flash' };
    const q = ALL_Q.find(x => !x.bad);
    jumpTo(q.id);
    const sh = document.getElementById('shell');
    if (!sh.classList.contains('ai-open')) toggleAI();
    buildAI();
    fire('what is the key point here?');
  }, grounded);
  /* Until the exchange is over (a precondition): aiBusy is false again once
     the reply is handled. If fire() sent nothing, the request checks say so. */
  await resolved(s.page, () => !aiBusy, null, { timeout: 30000 })
    .catch(e => { throw new Error('the exchange never finished (aiBusy stayed true): ' + e.message); });
  return s.captured.find(Boolean) || null;
}
const searchDesc = req => {
  const fns = ((((req && req.tools) || [])[0]) || {}).functionDeclarations || [];
  const d = fns.find(f => f && f.name === 'search_question_bank');
  return d ? flat(d.description) : '';
};

/* The text of the screens a fellow reads about the bank: home, search, the
   notes, and a question answered. Each is waited for by what proves it is up. */
async function screens(page) {
  const out = {};
  await page.evaluate(() => { goHome(); render(); });
  await onScreen(page, 'home', { marker: '.hero-h1' });
  out.home = await page.evaluate(() => document.body.innerText);
  await page.evaluate(() => openSearch());
  await onScreen(page, 'search', { marker: '.sb-hint' });
  out.search = await page.evaluate(() => document.body.innerText);
  await page.evaluate(() => { goRefs(); render(); });
  await onScreen(page, 'refs', { marker: '.hero-sub' });
  out.refs = await page.evaluate(() => document.body.innerText);
  await page.evaluate(() => { goHome(); render(); startQuiz(CHAPTERS[0], 'all'); });
  await onScreen(page, 'quiz', { marker: '.opt' });
  /* Answered right: that is when the reveal says how many candidates did too. */
  await page.evaluate(() => { const q = S.questions[S.qIdx]; selectOpt(q.ci); });
  await onScreen(page, 'quiz', { marker: '.reveal-card' });
  out.quiz = await page.evaluate(() => ({
    text: document.body.innerText,
    pct: document.querySelectorAll('.opt-pct').length,
    dist: document.querySelectorAll('.dist-title').length,
  }));
  return out;
}

(async () => {
  const browser = await launch();
  const errors = [];
  onDeath(() => ({ section, checks: passed + failed, errors }));

  head('as a bank that is not ACCSAP\'s');
  {
    const s = await session(browser, OWN, errors);
    const named = await s.page.evaluate(() => ({ name: BANK.name, by: BANK_BY }));
    ok('the app takes the bank the loader hands it', named.name === OWN.name && named.by === '', JSON.stringify(named));

    /* This bank has no peer statistics: none of its options says how many
       candidates chose it. */
    // Relabelling a private bank does not erase legitimate source citations
    // inside its questions or notes. Give the personal-bank scenario public
    // study content; keep the real app chrome and every branding assertion.
    await s.page.evaluate(fixture => {
      for (const q of ALL_Q) {
        q.s = fixture.s; q.ex = fixture.ex; q.ci = fixture.ci;
        q.o = fixture.o.map(o => { const copy = { ...o }; delete copy.p; return copy; });
      }
      REF = [{ id: 'tested-study-note', title: 'Reviewed study note',
        source: 'Tested Bank', text: fixture.ex, tags: [] }];
      pearlCurrent = null;
    }, OWN_QUESTION);
    const sc = await screens(s.page);
    const all = [sc.home, sc.search, sc.refs, sc.quiz.text].join('\n');
    ok('the home, search, notes and answered-question screens name neither ACCSAP nor the ACC',
       !ACC_WORDS.test(all), around(all, ACC_WORDS));
    ok('the search screen says it searches the full commentary', /full commentary across all \d+ questions/.test(flat(sc.search)),
       around(flat(sc.search), /commentary across/));
    ok('and the notes screen, that notes are searched beside the bank\'s commentary', /searched alongside the bank's commentary/.test(flat(sc.refs)),
       around(flat(sc.refs), /searched alongside/));
    ok('a question with no peer statistics shows no percentage and no answer distribution',
       sc.quiz.pct === 0 && sc.quiz.dist === 0 && !/% of candidates/.test(sc.quiz.text), `${sc.quiz.pct} percentages, ${sc.quiz.dist} distributions`);
    ok('and nowhere says undefined', !/undefined/.test(sc.quiz.text), around(sc.quiz.text, /undefined/));

    const open = await ask(s, false);
    const sys = flat(systemText(open));
    ok('the tutor is told the bank\'s name with the question', /CURRENT QUESTION — Tested Bank, /.test(sys), around(sys, /CURRENT QUESTION/));
    ok('its commentary heading names no one, and it is still keyed', /OFFICIAL COMMENTARY /.test(sys) && /← CORRECT/.test(sys), around(sys, /COMMENTARY/));
    ok('it is not told how many candidates chose each option', open !== null && !/of candidates chose/.test(sys), around(sys, /of candidates/));
    ok('the bank search tool names the bank', /own Tested Bank question bank/.test(searchDesc(open)), searchDesc(open).slice(0, 80));
    ok('and no word of ACCSAP or the ACC reaches the tutor', open !== null && !ACC_WORDS.test(sys) && !ACC_WORDS.test(searchDesc(open)),
       open ? around(sys + ' ' + searchDesc(open), ACC_WORDS) : 'no request was sent');

    const grounded = await ask(s, true);
    const gsys = flat(systemText(grounded));
    ok('grounded, the tutor is told the commentary is withheld, naming no one',
       /The commentary on the current question is deliberately withheld/.test(gsys) && /\(The official commentary for this item is withheld/.test(gsys),
       around(gsys, /withheld/));
    ok('and no word of ACCSAP or the ACC reaches it either', grounded !== null && !ACC_WORDS.test(gsys), grounded ? around(gsys, ACC_WORDS) : 'no request was sent');
    await s.page.close();
  }

  head('as built: the same words, ACCSAP\'s, where the label says ACCSAP 12');
  {
    const s = await session(browser, null, errors);
    const named = await s.page.evaluate(() => ({ name: BANK.name, by: BANK_BY }));
    ok('the build names ACCSAP 12, its commentary the ACC\'s', named.name === 'ACCSAP 12' && named.by === 'ACC ', JSON.stringify(named));
    const sc = await screens(s.page);
    ok('so the search screen says the full ACC commentary', /full ACC commentary across all/.test(flat(sc.search)), around(flat(sc.search), /commentary across/));
    ok('and a question with peer statistics shows them', sc.quiz.pct > 0 && sc.quiz.dist === 1 && /\d+% of candidates answered correctly/.test(sc.quiz.text),
       `${sc.quiz.pct} percentages, ${sc.quiz.dist} distributions`);
    const open = await ask(s, false);
    const sys = flat(systemText(open));
    ok('the tutor is told ACCSAP 12, the ACC commentary, and how many chose each option',
       /CURRENT QUESTION — ACCSAP 12, /.test(sys) && /OFFICIAL ACC COMMENTARY/.test(sys) && /of candidates chose this/.test(sys), around(sys, /CURRENT QUESTION/));
    await s.page.close();
  }

  ok('no page error in either', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
