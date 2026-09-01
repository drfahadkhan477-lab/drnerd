#!/usr/bin/env node
/*
 * The content-integrity fields — bad, flag, and the mechanism that sets
 * them — actually catch what they exist to catch.
 *
 *   node tests/verify-content.js /path/to/build.html
 *
 * Pure Node, no browser: everything here operates on the parsed question
 * bank and on scripts/flags-patch.js's exported applyContentFlags(), the
 * same shape as verify-fsrs.js and verify-worker.js.
 *
 * TWO DIFFERENT CLAIMS, BOTH NECESSARY:
 *
 *   1. applyContentFlags() itself behaves correctly — idempotent on a bank
 *      that already carries its corrections, capable of restoring one that
 *      has lost them (which is exactly what happened to COR_85 before this
 *      mechanism existed: its `bad` field lived only in the untracked
 *      content bank, and a fresh extraction would have silently dropped it),
 *      and loud rather than silent if the export ever ships a fix to a
 *      question this file still thinks is broken.
 *
 *   2. THE GENERAL RULE, run against the REAL current bank rather than the
 *      two known ids: any question with imgopt set and no figure, or with
 *      empty commentary, must carry bad or flag. This is the automated
 *      validator that would have caught COR_89 and COR_85 without a human
 *      finding each by hand first — the actual gap an external audit named
 *      after both were already fixed one at a time: the fixes existed, but
 *      nothing would have caught a third one.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { FLAGS, applyContentFlags, ALL_Q_RE } = require('../scripts/flags-patch.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-content.js <build.html>'); process.exit(1); }

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const html = fs.readFileSync(path.resolve(target), 'utf8');
const m = ALL_Q_RE.exec(html);
if (!m) { console.error('could not find "const ALL_Q=" in the build'); process.exit(1); }
const REAL_BANK = JSON.parse(m[1]);
const clone = () => JSON.parse(JSON.stringify(REAL_BANK));

head('applyContentFlags on the real, current bank');
{
  const bank = clone();
  const applied = applyContentFlags(bank);
  ok('every registered id exists in the real bank', applied.length === FLAGS.length,
     `${applied.length} of ${FLAGS.length}`);
  ok('and every one is already correctly set — nothing left to apply',
     applied.every(a => /already (flagged|marked bad)/.test(a)), applied.join(' | '));
}

head('idempotent: applying twice changes nothing the second time');
{
  const bank = clone();
  applyContentFlags(bank);
  const once = JSON.stringify(bank);
  applyContentFlags(bank);
  const twice = JSON.stringify(bank);
  ok('the bank is byte-identical after a second pass', once === twice);
}

head('durable: a corrections field lost from the bank is restored');
/* This is COR_85's actual history — its bad field lived only in the
   untracked content bank until this mechanism existed, so a fresh
   extraction would have silently dropped it. Simulated here by stripping
   every registered field and confirming applyContentFlags puts it back. */
{
  const bank = clone();
  for (const f of FLAGS) {
    const q = bank.find(x => x.id === f.id);
    if (f.flag) delete q.flag;
    if (f.bad) delete q.bad;
  }
  const applied = applyContentFlags(bank);
  ok('every stripped field is reported as freshly applied, not "already set"',
     applied.every(a => /^\S+\s+(flagged|marked bad):/.test(a)), applied.join(' | '));
  for (const f of FLAGS) {
    const q = bank.find(x => x.id === f.id);
    if (f.flag) ok(`${f.id}'s flag is restored verbatim`, q.flag === f.flag);
    if (f.bad) ok(`${f.id}'s bad reason is restored verbatim`, q.bad === f.bad);
  }
}

head('loud, not silent: a question the export has since fixed must fail the build');
/* The assertion is the point — it must be possible for it to fail. A check
   that cannot fail proves nothing about the check, only about the fixture. */
{
  for (const f of FLAGS) {
    if (f.wantFigs != null) {
      const bank = clone();
      const q = bank.find(x => x.id === f.id);
      q.figs = ['now-shipped.webp'];
      let threw = false;
      try { applyContentFlags(bank); } catch (_) { threw = true; }
      ok(`${f.id}: a figure appearing where none was recorded throws rather than re-flagging silently`, threw);
    }
    if (f.wantEx != null) {
      const bank = clone();
      const q = bank.find(x => x.id === f.id);
      q.ex = 'The export now explains this fully.';
      let threw = false;
      try { applyContentFlags(bank); } catch (_) { threw = true; }
      ok(`${f.id}: real commentary appearing where none was recorded throws rather than re-marking bad silently`, threw);
    }
  }
}

head('the general rule: any FUTURE occurrence of either defect must be caught automatically');
/* Run against the real bank as it ships today, not a fixture — this is the
   check an external audit asked for after finding COR_89 and COR_85 one at a
   time by hand. It must be genuinely general: a question is examined by its
   own shape, never by its id, or this degenerates back into a hand-maintained
   list wearing the shape of a validator. */
{
  /* img is a COUNT (how many figures this question's own extraction carries),
     not the figs array — that field belongs to a different population
     entirely, questions brought in later by an imported chapter (see
     assets-patch.js). Checked directly against the real bank before writing
     this: COR_102, HEA_3, HEA_40, HEA_56 and VAL_65 all carry imgopt with a
     real img count and empty/absent figs, and the app's own rendering code
     (buildQuiz, the per-chapter figure count, TOTAL_IMG) reads img
     everywhere a question's figure count actually matters — figs would have
     flagged all five of them as broken when none of them are. */
  const unresolvedImgopt = REAL_BANK.filter(q =>
    q.imgopt && !q.img && !q.bad && !q.flag);
  ok('no question ships with imgopt set, no figure, and no bad/flag notice',
     unresolvedImgopt.length === 0, unresolvedImgopt.map(q => q.id).join(', '));

  const unresolvedEmptyEx = REAL_BANK.filter(q => q.ex === '' && !q.bad && !q.flag);
  ok('no question ships with empty commentary and no bad/flag notice',
     unresolvedEmptyEx.length === 0, unresolvedEmptyEx.map(q => q.id).join(', '));
}

head('the general rule can actually fail — proven against a deliberately broken bank');
{
  const victim = REAL_BANK.find(q => !q.bad && !q.flag && q.ex !== '');
  if (!victim) {
    ok('a normal, unflagged question exists to sabotage', false, 'bank has no unflagged item at all');
  } else {
    const bank = clone();
    const v = bank.find(q => q.id === victim.id);
    v.ex = '';
    const found = bank.filter(q => q.ex === '' && !q.bad && !q.flag);
    ok('an artificially emptied commentary field is caught by the same rule that checks the real bank',
       found.some(q => q.id === victim.id), victim.id);
  }

  const figVictim = REAL_BANK.find(q => !q.imgopt && !q.bad && !q.flag);
  if (!figVictim) {
    ok('a normal, non-imgopt question exists to sabotage', false, 'bank has no such item at all');
  } else {
    const bank = clone();
    const v = bank.find(q => q.id === figVictim.id);
    v.imgopt = 1; v.img = 0;
    const found = bank.filter(q => q.imgopt && !q.img && !q.bad && !q.flag);
    ok('an artificially imgopt-with-no-figure question is caught by the same rule that checks the real bank',
       found.some(q => q.id === figVictim.id), figVictim.id);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
