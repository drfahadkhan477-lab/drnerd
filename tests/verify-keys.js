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
const { chromium } = require('playwright');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-keys.js <build.html>'); process.exit(1); }
const URL = 'file://' + require('path').resolve(target);

let passed = 0, failed = 0;
const ok = (l, c, d = '') => { c ? passed++ : failed++; console.log((c ? '  PASS  ' : '  FAIL  ') + l + (d ? '  → ' + d : '')); };
const head = t => console.log('\n── ' + t + ' ──');

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
const AFTER  = /\b(?:the\s+)?(?:correct|best)\s+(?:answer|response)(?:\s+choice)?\s*(?:is|:)\s*/i;
const BEFORE = /\b(?:is|are|would\s+be|remains)\s+(?:\w+\s+){0,2}?the\s+(?:correct|best|preferred)\s+(?:answer|response)(?:\s+choice)?\b/i;
const STOP = new Set(('a an the is are was were be been being of in on at to for with by from as that this these those ' +
  'and or but not no it its his her their there which who whom whose would should could may might can will shall ' +
  'patient patients most likely best next step following one because since due given about after before during ' +
  'choice answer correct measurement level levels').split(/\s+/));
const words = s => (s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
const firstSentence = t => { const r = /[.!?](?=\s+[A-Z(])/.exec(t); return (r ? t.slice(0, r.index) : t).slice(0, 170); };
const lastSentence = t => { const re = /[.!?]\s+(?=[A-Z(])/g; let s = 0, r; while ((r = re.exec(t))) s = r.index + r[0].length; return t.slice(s).slice(-170); };
const NEGATED = /\b(?:not|never|neither|nor|rather\s+than|incorrect)\b/i;
const covers = (claim, option) => {
  const C = new Set(words(claim)), O = words(option);
  if (!O.length) return 0;
  let hit = 0; for (const w of O) if (C.has(w)) hit++;
  return hit / O.length;
};

const checkable = [], disagree = [];
for (const q of bank) {
  const ex = q.ex || '';
  const a = AFTER.exec(ex), b = BEFORE.exec(ex);
  let claim = null, at = -1;
  if (a && (!b || a.index <= b.index)) { claim = firstSentence(ex.slice(a.index + a[0].length)); at = a.index; }
  else if (b) { claim = lastSentence(ex.slice(0, b.index)); at = b.index; }
  if (!claim || !words(claim).length) continue;
  /* "Prinzmetal angina is not the correct answer choice" is an argument about a
     distractor, not a statement of the key. Read as a claim it accuses the
     right answer of being wrong. */
  if (NEGATED.test(ex.slice(Math.max(0, at - 90), at + 60))) continue;
  checkable.push(q.id);
  const sc = q.o.map(o => covers(claim, o.t));
  const best = sc.indexOf(Math.max(...sc));
  if (sc[q.ci] < 0.6 && sc[best] >= 0.6 && best !== q.ci) disagree.push(q.id);
}

ok('the cross-check still has something to check', checkable.length > 300,
   `${checkable.length} of ${bank.length} commentaries name their answer`);
const unexpected = disagree.filter(id => !MATCHER_MISSES.includes(id));
ok('every checkable key now matches the prose that explains it', unexpected.length === 0,
   unexpected.length ? unexpected.join(', ') : `${disagree.length} known acronym mismatches, no key mismatches`);
ok('with nothing on a tolerated list to hide behind', MATCHER_MISSES.length === 0);

head('and it reaches the screen');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'load', timeout: 250000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && !!document.querySelector('.hero-h1'), { timeout: 150000 });

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
