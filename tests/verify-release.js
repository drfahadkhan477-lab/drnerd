#!/usr/bin/env node
/*
 * The release gate never claims more than it measured.
 *
 *   node tests/verify-release.js
 *
 * Pure Node, no browser, no build — which is the point: a gate that can only
 * be tested by running a forty-minute certification is a gate nobody tests.
 *
 * WHAT IS ACTUALLY AT STAKE. scripts/release-check.js exists because a green
 * GitHub CI result does not mean the application passed: CI runs only the
 * suites needing no browser and no build, since the licensed export is not
 * there. The gate is the thing that runs where the source is. Its entire worth
 * is therefore in its verdict being trustworthy — and the single way it can
 * fail at that is by printing CERTIFIED over something it did not check.
 *
 * That is not hypothetical. The first version of the gate recorded a dry run's
 * steps as PASS and duly printed CERTIFIED having executed nothing at all,
 * written by the same hand that had just finished writing "it must never claim
 * more than it measured" in the file's own header. Prose in a header does not
 * enforce anything. These checks do.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const GATE = path.join(ROOT, 'scripts', 'release-check.js');
const REPORT = path.join(ROOT, 'build', 'release-report.md');
const run = (...args) => {
  const r = spawnSync(process.execPath, [GATE, ...args], { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

head('a run that measured nothing says so');
{
  const r = run('--dry-run');
  ok('a dry run is not CERTIFIED', !/^\s*CERTIFIED\s*$/m.test(r.out), r.out.match(/DRY RUN.*|CERTIFIED/)?.[0] || '');
  ok('it says plainly that nothing was measured', /nothing was measured/.test(r.out));
  ok('and it exits non-zero', r.code === 1, String(r.code));
  /* The distinction the whole file turns on: skipped is not passed. */
  ok('every step is recorded as skipped, not passed',
     /8 skipped/.test(r.out) && !/✓/.test(r.out), (r.out.match(/\d+ skipped/) || [''])[0]);
}

head('a skip costs the certificate, and is named');
{
  /* Nothing can run here — there is no licensed export in this container — so
     the source step fails and everything downstream skips for want of a build.
     That is itself the check: the gate must handle "the build never happened"
     by refusing, not by carrying on and certifying the absence. */
  const r = run('/nonexistent/export.html');
  ok('a missing source is NOT CERTIFIED', /NOT CERTIFIED/.test(r.out));
  ok('and it exits non-zero', r.code === 1, String(r.code));
  ok('the failing step is named', /source/.test(r.out));
  ok('downstream steps skip rather than fail confusingly',
     /what it needs was not produced/.test(r.out));
}

head('--skip is honoured and held against the verdict');
{
  const r = run('--dry-run', '--skip', 'webkit');
  ok('a named skip is attributed to the flag, not to a missing artifact',
     /asked for with --skip/.test(r.out));
}

head('the report is written, and is safe to share');
{
  run('--dry-run');
  ok('a report file is produced', fs.existsSync(REPORT));
  const md = fs.readFileSync(REPORT, 'utf8');
  ok('it leads with the verdict', /^# Release check — /m.test(md));
  ok('it records the commit', /commit\s+[0-9a-f]{7,}/.test(md) || /commit\s+unknown/.test(md));
  ok('it flags an uncommitted tree as not reproducible',
     !/UNCOMMITTED/.test(md) || /not a reproducible artifact/.test(md));
  ok('it lists what was not measured', /## Not measured/.test(md));
  ok('and says a skip is an absence of evidence',
     /absence of evidence, not evidence of absence/.test(md));
  /* It lands in build/, which is gitignored AND refused by the leak guard, so
     a report naming the source file cannot be committed out of habit. */
  ok('it is written into build/', REPORT.includes(`${path.sep}build${path.sep}`));
  const guard = spawnSync(process.execPath,
    [path.join(ROOT, 'scripts', 'leak-guard.js'), 'build/release-report.md'],
    { cwd: ROOT, encoding: 'utf8' });
  ok('and the leak guard refuses it, so it cannot be committed', guard.status === 1);
}

head('the steps are the ones a release actually needs');
{
  const src = fs.readFileSync(GATE, 'utf8');
  for (const id of ['source', 'leakguard', 'build', 'extract', 'pwabuild', 'chromium', 'pwa', 'webkit']) {
    ok(`it runs '${id}'`, new RegExp(`id: '${id}'`).test(src));
  }
  /* WebKit is the engine the app is actually used on. It being present but
     off-by-default would be the quiet version of not testing it. */
  ok('webkit is on by default — skipping it is a choice, not the default',
     !/SKIP\.add\('webkit'\)/.test(src) && /--skip/.test(src));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
