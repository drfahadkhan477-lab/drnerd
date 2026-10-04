#!/usr/bin/env node
/*
 * tools/study-file-check.js says what Memorizer's import would say.
 *
 *   node tests/verify-study-file-check.js
 *
 * Pure Node. The checker exists so a session writing a study file can fix
 * it before the owner imports it, and the memorizer-study-file skill tells
 * Claude to trust its "clean". So each kind of problem the app would drop,
 * refuse or flag is planted in an otherwise clean file and must make it
 * report not-clean, and the clean file must pass. The fixtures start from
 * the app's own STUDY_EXAMPLE, which is what the prompt shows Claude.
 *
 * It also holds the checker to printing no item's text, and its command
 * line to the exit codes the skill relies on.
 *
 * NOT CLAIMED: that the app's checks are right. tests/verify-memorizer-
 * studyimport-pure.js holds those; this holds the checker to running them.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const TOOL = path.join(ROOT, 'tools', 'study-file-check.js');
const { checkStudyFile } = require(TOOL);
const { STUDY_EXAMPLE } = require(path.join(ROOT, 'memorizer', 'src', 'studyImport.js'));

/* The app's example is the clean fixture: it is what the prompt shows
   Claude, so it must pass the strict check it asks a file to pass. It once
   did not: its scenario named syncope, which its text never does. That
   scenario is the strict fixture below. */
const CLEAN = STUDY_EXAMPLE;
const STEM = 'develops symptoms', DIRTY_STEM = 'develops exertional syncope';
const edit = (from, to) => {
  if (CLEAN.split(from).length !== 2) throw new Error('fixture anchor not found exactly once: ' + from);
  return CLEAN.split(from).join(to);
};
const run = (src, strict) => checkStudyFile(src, 'fixture.md', strict);
const problems = r => r.lines.filter(l => /PROBLEM/.test(l));

head('a clean file is clean, and was really read');
{
  ok('the example\u2019s scenario is the one these fixtures edit', CLEAN.split(STEM).length === 2);
  const r = run(CLEAN, false), rs = run(CLEAN, true);
  ok('it passes', r.ok, problems(r).join(' | ') || 'no problems');
  ok('and under --strict: the app\u2019s own example passes its own strict check', rs.ok, problems(rs).join(' | ') || 'no problems');
  /* "clean" from a parse that read nothing is the hollow pass: the counts
     must be the example's. */
  ok('its points, table, flowchart and question were all read', /3 points, 1 tables, 1 flowcharts, 0 diagrams, 1 questions/.test(r.lines[0]), r.lines[0]);
  ok('and the last line says what it was not checked against', /not against the book or the medicine/.test(r.lines[r.lines.length - 1]));
}

head('each thing the app would drop, refuse or flag is reported');
const cases = [
  ['a question with no Correct Answer line', edit('**Correct Answer**: B\n', ''), false, /no Correct Answer/],
  ['a question with three options', edit('- D) Balloon valvotomy as definitive treatment\n', ''), false, /exactly 4 options/],
  ['an explanation with a number the text does not have',
    edit('Valve replacement is indicated once symptoms appear [p. 1460].\n\n**Why', 'Valve replacement within 90 days of symptoms [p. 1460].\n\n**Why'), false, /flagged: .*number/],
  ['under --strict, a scenario naming what the text does not', edit(STEM, DIRTY_STEM), true, /flagged: in its scenario/],
  ['a file with no points', edit('- **Peak velocity**', '**Peak velocity**').replace('- **Mean gradient**', '**Mean gradient**').replace('- **Aortic stenosis vs', '**Aortic stenosis vs'), false, /PROBLEM/],
  ['an empty file', '', false, /PROBLEM  file/],
];
for (const [label, src, strict, want] of cases) {
  const r = run(src, strict), p = problems(r);
  ok(label + ': not clean', !r.ok, p.join(' | ') || 'reported clean');
  ok(label + ': and says why', p.some(l => want.test(l)), p.join(' | ') || 'no PROBLEM line');
}

head('it never prints the text of an item');
{
  const r = run(edit(STEM, DIRTY_STEM), true), all = r.lines.join('\n');
  ok('a flagged question is reported', !r.ok);
  ok('without its stem', !/A patient with severe aortic stenosis/.test(all) && !all.includes(DIRTY_STEM));
  const r2 = run(edit('**Correct Answer**: B\n', ''), false).lines.join('\n');
  ok('and an unanswered one without its options', !/Follow-up echocardiography|Balloon valvotomy/.test(r2));
}

head('the command line exits as the skill relies on');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfc-'));
  const good = path.join(dir, 'good.md'), bad = path.join(dir, 'bad.md');
  fs.writeFileSync(good, CLEAN);
  fs.writeFileSync(bad, edit('**Correct Answer**: B\n', ''));
  const cli = args => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' }).status;
  ok('0 for a clean file', cli([good]) === 0, String(cli([good])));
  ok('1 for a file with a problem', cli([bad]) === 1, String(cli([bad])));
  const dirty = path.join(dir, 'dirty.md');
  fs.writeFileSync(dirty, edit(STEM, DIRTY_STEM));
  ok('0 for a strict-only problem without --strict', cli([dirty]) === 0, String(cli([dirty])));
  ok('1 for it with --strict: the flag reaches the exit code', cli([dirty, '--strict']) === 1, String(cli([dirty, '--strict'])));
  ok('0 for the app\u2019s own example with --strict', cli([good, '--strict']) === 0, String(cli([good, '--strict'])));
  ok('2 with no file named', cli([]) === 2, String(cli([])));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
