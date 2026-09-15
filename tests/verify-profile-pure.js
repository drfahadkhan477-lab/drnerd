#!/usr/bin/env node
/*
 * The profile block never takes the turn down with it.
 *
 *   node tests/verify-profile-pure.js
 *
 * Pure Node, no browser, no build. profile.js reads app globals — S, QBYID,
 * FSRS, todayISO, dueQuestions — so they are supplied here as plain objects,
 * which is the whole reason this is testable without a forty-minute build.
 *
 * THE POINT. This file runs on the path that assembles EVERY prompt, and its
 * caller invokes it bare:
 *
 *     + ((typeof Profile!=='undefined') ? Profile.build() : '')
 *
 * guarded against the module being absent and against nothing else. A throw in
 * here is not a missing profile line — it is the whole Apex turn failing, on
 * the screen the fellow was trying to use.
 *
 * And it could throw. accsap12.v2 carries S and is restored wholesale from a
 * user-picked file by the backup importer, so a truncated or hand-edited
 * backup can supply an S with no `missed` or no `practice`. Measured before
 * the fix: `for (const k in undefined)` is a harmless no-op, but
 * `[...undefined]` throws and so does `undefined['x']` — and recentMisses()
 * did both. fsrs.js learned this lesson already and wrote it down; this file
 * had the same exposure and one try/catch around one call.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'profile.js'), 'utf8');

/* profile.js reads its globals by bare name, so they are passed as parameters
   of the wrapper — the same trick verify-fsrs uses, and it means each case
   gets its own world with no leakage between them. */
function withWorld({ S, QBYID, FSRS, todayISO, dueQuestions }) {
  const root = {};
  new Function('S', 'QBYID', 'FSRS', 'todayISO', 'dueQuestions', SRC)
    .call(root, S, QBYID, FSRS, todayISO, dueQuestions);
  return root.Profile;
}
const FSRS_STUB = { retrievability: () => 0.9, daysBetween: () => 3 };
const healthy = (over) => Object.assign({
  S: {
    sessionTotal: 40, sessionCorrect: 30,
    chStats: { 'Valvular Disease': { total: 20, correct: 8 }, 'Coronary Disease': { total: 12, correct: 11 } },
    missed: new Set(['VAL_1', 'VAL_2']),
    practice: { VAL_1: { t: 2 }, VAL_2: { t: 1 } },
    srs: { VAL_1: { stability: 4, last: '2026-01-01' } },
  },
  QBYID: { VAL_1: { id: 'VAL_1', ch: 'Valvular Disease', n: 7 }, VAL_2: { id: 'VAL_2', ch: 'Valvular Disease', n: 9 } },
  FSRS: FSRS_STUB, todayISO: () => '2026-01-04', dueQuestions: () => [1, 2],
}, over || {});

head('with a healthy store it says the useful things');
{
  const P = withWorld(healthy());
  const b = P.build();
  ok('it reports the overall score', /Answered 30\/40 overall \(75%\)/.test(b), b.split('\n')[2] || '');
  ok('weakest chapter first', /Valvular Disease 40%/.test(b) && b.indexOf('Valvular') < b.indexOf('Coronary'));
  ok('retention is summarised', /Predicted retention 90% across 1 scheduled card\b/.test(b));
  ok('due load is stated', /2 cards due for review right now/.test(b));
  ok('recent misses are named, newest first', /Recently missed: VAL_1 \(Valvular Disease, item 7\), VAL_2/.test(b));
  ok('and it tells the model not to read it back', /do not read it back to them as a report/.test(b));
}

head('a fresh install is told nothing rather than told zeroes');
{
  const P = withWorld({ S: { chStats: {}, missed: new Set(), practice: {}, srs: {} },
                        QBYID: {}, FSRS: FSRS_STUB, todayISO: () => '2026-01-04', dueQuestions: () => [] });
  ok('an empty store produces an empty block', P.build() === '', JSON.stringify(P.build()).slice(0, 60));
  /* Below the threshold there is no score worth reporting — four answers is
     not an accuracy, and telling the model it is teaches it something false. */
  const few = withWorld(healthy({ S: Object.assign({}, healthy().S, { sessionTotal: 4, sessionCorrect: 1, chStats: {} }) }));
  ok('four answers is not reported as an accuracy', !/Answered 1\/4/.test(few.build()));
}

head('a torn store costs the line, never the turn');
{
  /* Each of these is a shape the backup importer can actually deliver. Before
     the guards, the first two threw — and a throw here is the whole Apex turn,
     not a missing line. */
  const shapes = {
    'no missed set':       { missed: undefined },
    'no practice map':     { practice: undefined },
    'no chapter stats':    { chStats: undefined },
    'no srs map':          { srs: undefined },
    'missed as an array':  { missed: ['VAL_1'] },
    'chStats not an object': { chStats: 'nonsense' },
    'everything missing':  { missed: undefined, practice: undefined, chStats: undefined, srs: undefined },
  };
  for (const [label, over] of Object.entries(shapes)) {
    const P = withWorld(healthy({ S: Object.assign({}, healthy().S, over) }));
    let threw = null;
    try { P.build(); } catch (e) { threw = e; }
    ok(`${label}: build() does not throw`, threw === null, threw && threw.message);
  }

  /* And the globals themselves can be absent — an old build, a module that
     loaded before the bank did. */
  const bare = withWorld({ S: undefined, QBYID: undefined, FSRS: undefined,
                           todayISO: undefined, dueQuestions: undefined });
  let threw = null;
  try { threw = bare.build() === '' ? null : new Error('expected empty'); } catch (e) { threw = e; }
  ok('no S at all: build() returns empty rather than throwing', threw === null, threw && threw.message);
}

head('a number nobody has is not reported as a number');
{
  /* A chapter with attempts but no correct count yields NaN. It does not
     throw — it reaches the model as "Cardiomyopathy NaN%", which is a
     confident statement about nothing. */
  const P = withWorld(healthy({ S: Object.assign({}, healthy().S, {
    chStats: { Cardiomyopathy: { total: 9 }, 'Coronary Disease': { total: 12, correct: 11 } } }) }));
  const b = P.build();
  ok('a chapter with no correct count is dropped, not rendered as NaN',
     !/NaN/.test(b), (b.match(/.*NaN.*/) || [''])[0]);
  ok('and the sound chapter beside it still appears', /Coronary Disease 92%/.test(b));
}

head('a broken helper does not take the rest with it');
{
  /* dueQuestions was the one call already wrapped; the guarantee is now the
     whole function's, so a thrower anywhere costs its own line only. */
  const P = withWorld(healthy({ dueQuestions: () => { throw new Error('bank not loaded'); } }));
  const b = P.build();
  ok('a throwing dueQuestions costs only the due line', !/due for review/.test(b) && /Answered 30\/40/.test(b));
  const P2 = withWorld(healthy({ FSRS: { retrievability: () => { throw new Error('boom'); }, daysBetween: () => 3 } }));
  let threw = null;
  try { P2.build(); } catch (e) { threw = e; }
  ok('and a throwing FSRS costs the profile, not the turn', threw === null, threw && threw.message);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
