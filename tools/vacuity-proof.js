#!/usr/bin/env node
/*
 * Do the checks fixed for vacuity now fail on the defect they claim to catch?
 *
 *   node tools/vacuity-proof.js build/systole.html
 *
 * THE FIXES. Five checks in four browser suites passed on nothing: a request
 * that was never sent, a self-test in which no figure loaded, an intervention
 * list with nothing in it, a deck that came back short after a reload. Each
 * read something that could be empty with "none of these is wrong" or
 * "every one of these is right" — both true of nothing. The fixes require the
 * thing to be there first. Their logic was shown on the predicates alone; this
 * shows them in the suites, which need the licensed build.
 *
 * THE METHOD. Each suite is run twice against the build: once as it was before
 * the fix (BEFORE, read out of git) and once as it is now, each with the same
 * defect injected. The fix is proven when the old check PASSES the defect and
 * the new one FAILS it. The rest of the suite is not the subject; only the
 * named checks are read.
 *
 * WHAT IS INJECTED IS THE SYMPTOM, IN THE SUITE'S OWN PAGE. Mutating the app
 * would need a rebuild per case. Instead each defect is written into a copy of
 * the suite, at the point where the app hands it what it checks: the question
 * without a figure is never sent; openFigure() throws, so no figure opens; the
 * intervention list is read as empty; the deck after the reload is cut to its
 * first three. The copies live in tests/ for the length of the run, so their
 * requires resolve, and are deleted on the way out, whatever happens.
 *
 * It asserts nothing about the app. It exits 1 if any case is not proven, so
 * the result can be quoted rather than read off a scroll of output.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TESTS = path.join(ROOT, 'tests');
const BEFORE = 'e75b14e';   // master before the fixes: the merge of PR #64

const target = process.argv[2];
if (!target || !fs.existsSync(target)) {
  console.error('usage: node tools/vacuity-proof.js build/systole.html');
  process.exit(1);
}

const CASES = [
  { suite: 'stage3',
    defect: 'the question without a figure is never sent',
    find: "      fire('why is this the answer?');",
    replace: "      if (wantFigure) fire('why is this the answer?');",
    labels: ['no image block on a text-only question',
             'the turn carries text and nothing else when there is nothing to attach'] },
  { suite: 'selftest',
    defect: 'no figure opens, so none is loaded',
    find: 'const [a, b] = await Promise.all([runSelfTest(), runSelfTest()]);',
    replace: "window.openFigure = () => { throw new Error('injected: no figure opens'); }; " +
             'const [a, b] = await Promise.all([runSelfTest(), runSelfTest()]);',
    labels: ['both runs report a full sample'] },
  { suite: 'physio',
    defect: 'the intervention list is read as empty',
    find: 'const ivErr = P.INTERVENTIONS.map(iv => {',
    replace: 'const ivErr = P.INTERVENTIONS.slice(0, 0).map(iv => {',
    labels: ['ESPVR passes through end-systole on all six interventions',
             'EDPVR passes through end-diastole on all six interventions'] },
  { suite: 'resume',
    defect: 'the deck after the reload is cut to its first three',
    find: '    return { at: S.qIdx, ids: S.questions.map(q => q.id), resumed: !!S.resumed };',
    replace: '    return { at: S.qIdx, ids: S.questions.map(q => q.id).slice(0, 3), resumed: !!S.resumed };',
    labels: ['and still has the same deck'] },
];

const written = [];
const cleanup = () => { for (const f of written) { try { fs.unlinkSync(f); } catch (_) {} } };
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130); });

const sourceOf = (suite, rev) => rev
  ? execFileSync('git', ['show', `${rev}:tests/verify-${suite}.js`], { cwd: ROOT, encoding: 'utf8' })
  : fs.readFileSync(path.join(TESTS, `verify-${suite}.js`), 'utf8');

/* PASS / FAIL for each label, or null when the line never printed — which is
   its own answer, and never read as either. */
function runWithDefect(c, rev) {
  const src = sourceOf(c.suite, rev);
  const n = src.split(c.find).length - 1;
  if (n !== 1) return { error: `injection point found ${n} times in ${rev || 'the working tree'}` };
  const file = path.join(TESTS, `_vacuity-${c.suite}-${rev ? 'before' : 'after'}.js`);
  fs.writeFileSync(file, src.replace(c.find, () => c.replace));
  written.push(file);
  const r = spawnSync(process.execPath, [file, target], { cwd: ROOT, encoding: 'utf8', timeout: 20 * 60 * 1000 });
  try { fs.unlinkSync(file); } catch (_) {}   // at most one copy exists at a time; exit cleans up the rest
  const out = (r.stdout || '') + (r.stderr || '');
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const verdicts = c.labels.map(l => {
    /* ok() prints the label, then the end of the line or "  → detail". Matching
       exactly that keeps a label from matching a longer one it begins. */
    const m = out.match(new RegExp('^\\s*(PASS|FAIL)\\s+' + esc(l) + '(?:\\s+→|\\s*$)', 'm'));
    return m ? m[1] : null;
  });
  return { verdicts };
}

let unproven = 0;
console.log(`Vacuity proof — against ${target}\n  before = ${BEFORE}, after = the working tree\n`);
for (const c of CASES) {
  process.stdout.write(`  ${c.suite}: ${c.defect} … `);
  const before = runWithDefect(c, BEFORE);
  const after = runWithDefect(c, null);
  console.log('');
  if (before.error || after.error) {
    unproven++;
    console.log(`    NOT RUN  ${before.error || after.error}`);
    continue;
  }
  c.labels.forEach((l, i) => {
    const b = before.verdicts[i], a = after.verdicts[i];
    const proven = b === 'PASS' && a === 'FAIL';
    if (!proven) unproven++;
    console.log(`    ${proven ? 'PROVEN   ' : 'NOT PROVEN'}  before ${b || 'did not report'}, after ${a || 'did not report'}  — ${l}`);
  });
}
console.log(unproven ? `\n${unproven} not proven.` : '\nEvery fixed check passed the defect before and fails it now.');
process.exit(unproven ? 1 : 0);
