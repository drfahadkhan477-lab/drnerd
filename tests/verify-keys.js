#!/usr/bin/env node
/*
 * The answer keys, and the cross-check that found six of them wrong.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-keys.js <build.html>
 *
 * There are two claims here and they defend different things.
 *
 * The first is that the six corrections are in the build and reach the screen.
 * That is a regression test in the ordinary sense.
 *
 * The second matters more. It re-runs, against the built bank, the comparison
 * that found them: half the ACCSAP commentaries name their answer in prose, and
 * that sentence is an independent record of the same fact `ci` records as an
 * index. Running it here means a future export cannot introduce a seventh
 * mis-keyed question without this suite going red — which is the only way this
 * stays fixed, because the export is regenerated and the correction list is not.
 *
 * The matcher has one trap worth naming, because it produced three false alarms
 * before it was closed. Commentaries argue against distractors in the same
 * words they use for the answer — "Prinzmetal angina is not the correct answer
 * choice" — so a sentence carrying a negation anywhere near the phrase is
 * discarded rather than read as a claim. With that rule the tolerated list is
 * empty, which is the only state worth having: a suite that permits a category
 * of mismatch would permit a real one hiding inside it.
 */
'use strict';
const fs = require('fs');
const { launch } = require('./_engine');
const { booted } = require('./_render.js');
const { onDeath } = require('./_deathnote.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-keys.js <build.html>'); process.exit(1); }
const URL = 'file://' + require('path').resolve(target);

let passed = 0, failed = 0;
const ok = (l, c, d = '') => { c ? passed++ : failed++; console.log((c ? '  PASS  ' : '  FAIL  ') + l + (d ? '  → ' + d : '')); };
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

/* What keys-patch.js claims to have done. */
const CORRECTED = [
  ['CON_16', 'C', 'Antihypertensive therapy.'],
  ['MIS_25', 'D', 'Refer for genetic testing.'],
  ['PER_9',  'A', 'Malignancy.'],
  ['SYS_9',  'A', 'Referral to an endocrinologist.'],
  ['SYS_26', 'C', 'Lower incidence of hip and pelvic fractures.'],
  ['SYS_44', 'E', 'Older age.'],
];
/* Nothing is tolerated. If this ever needs an entry, the entry needs a reason. */
const MATCHER_MISSES = [];

/* ── the bank, out of the built file ──────────────────────────────────────── */
const html = fs.readFileSync(target, 'utf8');
const m = /\nconst ALL_Q=(\[[\s\S]*?\]);\n/.exec(html);
if (!m) { console.error('could not find ALL_Q in the build'); process.exit(1); }
const bank = JSON.parse(m[1]);
const byId = new Map(bank.map(q => [q.id, q]));
const L = 'ABCDEFGH';

head('the six corrections are in the build');
for (const [id, letter, text] of CORRECTED) {
  const q = byId.get(id);
  ok(`${id} is keyed ${letter}`, !!q && L[q.ci] === letter && q.o[q.ci].t === text,
     q ? `${L[q.ci]}. ${q.o[q.ci].t}` : 'not in the bank');
}

head('the signature that gave them away is gone');
/* Before the fix, `ci` was the most-chosen option in 638 of 638 — the tell that
   it came from the response statistics rather than from an answer key. A real
   key cannot be perfect on that measure, because hard questions exist. */
const withStats = bank.filter(q => q.o.every(o => typeof o.p === 'number') && q.o.reduce((s, o) => s + o.p, 0) > 50);
const modal = withStats.filter(q => { const ps = q.o.map(o => o.p); return ps[q.ci] === Math.max(...ps); }).length;
ok('the key is no longer the most-chosen option in every single question',
   modal < withStats.length, `${modal}/${withStats.length} — was ${withStats.length}/${withStats.length}`);
ok('and the six that changed are exactly the difference', withStats.length - modal === CORRECTED.length,
   `${withStats.length - modal} now differ from the popular answer`);

head('no seventh question disagrees with its own commentary');
/* The matcher lives in tools/key-prose.js, shared with the older-bank
   importer so the two can never drift apart. */
const { keyVsProse } = require('../tools/key-prose.js');

const checkable = [], disagree = [];
for (const q of bank) {
  const r = keyVsProse(q);
  if (!r.checkable) continue;
  checkable.push(q.id);
  if (r.disagrees) disagree.push(q.id);
}

ok('the cross-check still has something to check', checkable.length > 300,
   `${checkable.length} of ${bank.length} commentaries name their answer`);
const unexpected = disagree.filter(id => !MATCHER_MISSES.includes(id));
ok('every checkable key now matches the prose that explains it', unexpected.length === 0,
   unexpected.length ? unexpected.join(', ') : `${disagree.length} known acronym mismatches, no key mismatches`);
ok('with nothing on a tolerated list to hide behind', MATCHER_MISSES.length === 0);

head('and it reaches the screen');
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
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
  await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await booted(page, { timeout: 150000 });

  const inPage = await page.evaluate(ids => ids.map(id => {
    const q = ALL_Q.find(x => x.id === id);
    return { id, letter: 'ABCDEFGH'[q.ci], text: q.o[q.ci].t };
  }), CORRECTED.map(c => c[0]));
  for (const [i, [id, letter]] of CORRECTED.entries()) {
    ok(`${id} is keyed ${letter} in the running app too`, inPage[i].letter === letter, inPage[i].letter);
  }

  /* The reveal reads q.o[q.ci], so answering the corrected option must come
     back "Correct!" — that is the whole point of the change. */
  const revealed = await page.evaluate(() => {
    localStorage.clear();
    startQuiz('Pericardial Disease');
    const i = S.questions.findIndex(q => q.id === 'PER_9');
    if (i < 0) return { found: false };
    S.qIdx = i;              /* the field selectOpt reads — the deck is shuffled */
    render();
    const q = S.questions[S.qIdx];
    if (q.id !== 'PER_9') return { found: false, on: q.id };
    selectOpt(q.ci);
    const v = document.querySelector('.reveal-verdict');
    return { found: true, letter: 'ABCDEFGH'[q.ci], verdict: v ? v.textContent.trim() : '(no reveal)' };
  });
  ok('answering the corrected option on PER_9 is marked correct',
     revealed.found && /correct!/i.test(revealed.verdict), revealed.verdict);

  ok('no page errors across the run', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
