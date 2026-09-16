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
     /did not pass in this run|what it needs was not produced/.test(r.out));
  /* THE SKIP MUST NOT DEPEND ON WHAT IS ON DISK. This check used to pass for
     the wrong reason: the comment above says "nothing can run here — there is
     no licensed export in this container", and it was the ABSENCE of
     build/systole.html that made the browser steps skip. On a machine that has
     a build, this one line ran the whole 68-suite verify three times, WebKit
     included, from inside a verify run — reported as the suite hanging for
     half an hour. The gate now gates on what passed in THIS run, so the skip
     holds either way; asserted by name so it cannot quietly revert to the
     disk check. */
  ok('and they skip because the build did not pass, not because a file is missing',
     /build did not pass in this run/.test(r.out));
  ok('nothing downstream of a failed build ran at all',
     !/the full suite, on chromium\n\s+\d/.test(r.out));
}

head('a step that really runs is recorded as having passed');
{
  /* THE CHECK THAT WAS NOT HERE, and its absence hid a broken gate for three
     commits. Every other test in this file uses --dry-run, which records each
     step SKIP before any of them executes — so nothing exercised the path
     where a step runs, succeeds, and reports itself.

     It was broken the whole time. safeDetail() and its SHAPES table were
     declared BELOW the loop that calls them, and `const` in the temporal dead
     zone throws rather than reading undefined, so every step that succeeded
     threw on the way to being recorded and was written down as FAILED. A gate
     that fails a passing step is worse than no gate, and every test here was
     green.

     leakguard is the one step that needs no export, no build and no browser,
     which is what makes this cheap enough to keep. */
  const r = run('/nonexistent/export.html', '--skip',
                'source,build,extract,pwabuild,chromium,pwa,webkit');
  ok('leakguard ran and passed', /✓ leakguard/.test(r.out),
     (r.out.match(/[✓✗–] leakguard.*/) || ['not found'])[0]);
  ok('and it is not reported as having thrown', !/threw/.test(r.out),
     (r.out.match(/threw.*/) || [''])[0]);
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

head('and a failing step cannot put its output in either place');
{
  /* THE PROMISE IN THE FOOTER, ENFORCED. The report ends by claiming "no
     question text, options, commentary or figure data appears in this report",
     and for a long time nothing made that true: the failing subprocess's last
     three lines went through verbatim. Two destinations, not one — `detail` is
     printed by record() as well as written to the report, so it is also what
     the self-hosted CI job puts into a GitHub Actions log.

     Driven through safeDetail directly rather than by failing a real step:
     a real failure would need a build, and the property under test is the
     function's, not the pipeline's. A stem is the thing that must not survive,
     so the fixture is shaped like one. */
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'release-check.js'), 'utf8');
  const mod = {};
  /* Only the two pieces are lifted out — running the file would run the gate. */
  const m = src.match(/let SUITE_NAMES = null;[\s\S]*?\nfunction safeDetail[\s\S]*?\n\}/);
  ok('safeDetail and its shapes are where the test expects them', !!m);
  if (m) {
    /* fs, path and ROOT are the allowlist's dependencies — it reads the suite
       registry out of verify.js at call time. Handing it the real ones means
       the test exercises the real registry rather than a stand-in. */
    new Function('module', 'fs', 'path', 'ROOT',
      m[0] + '\nmodule.exports = { safeDetail, SHAPES, isSuiteName };')(mod, fs, path, ROOT);
    const { safeDetail, isSuiteName } = mod.exports;
    ok('the allowlist is the registry verify.js runs', isSuiteName('csp') && isSuiteName('render'));
    ok('and a word that is not a suite is not one', !isSuiteName('dyspnea') && !isSuiteName('man'));

    const STEM = 'A 54-year-old man with exertional dyspnea and a mid-systolic murmur';
    const noisy = [
      'Error: expected true',
      `  FAIL  the answer is disclosed  → ${STEM}`,
      `    at Object.<anonymous> (/Users/someone/Downloads/ACCSAP_12_super_v12.html:1:1)`,
    ].join('\n');

    const outFail = safeDetail(noisy, 'exit 1 — full output in tests/last-run.log on this machine');
    ok('nothing resembling a stem survives', !outFail.includes(STEM), outFail);
    ok('no fragment of it survives either', !/54-year-old|dyspnea|murmur/i.test(outFail));
    ok('and the export filename does not either', !/ACCSAP/i.test(outFail));
    ok('an unrecognised failure falls back to the exit code', /exit 1/.test(outFail), outFail);
    ok('and points at the machine, not at itself', /last-run\.log/.test(outFail));

    /* FAIL-CLOSED MEANS CLOSED WHEN THE LOOKUP ITSELF BREAKS, which is the
       case nothing covered until an injected defect went green: making the
       catch return true instead of an empty set passed every check here. A
       registry that cannot be read must admit no names, not all of them.

       Instantiated a second time against a ROOT with no scripts/verify.js in
       it, because that is the only way to reach the catch without breaking the
       real file. */
    const blind = {};
    new Function('module', 'fs', 'path', 'ROOT',
      m[0] + '\nmodule.exports = { safeDetail, isSuiteName };')(
        blind, fs, path, path.join(ROOT, 'no-such-directory'));
    ok('an unreadable registry admits nothing', !blind.exports.isSuiteName('csp'));
    ok('and the failing line degrades to a bare count',
       /^3 failing$/.test(blind.exports.safeDetail('  3 suites failing: csp, render, pwa\n', 'FB')),
       blind.exports.safeDetail('  3 suites failing: csp, render, pwa\n', 'FB'));

    /* Fail-closed must not mean useless: the shapes it DOES know still come
       through, because a report that says nothing is one nobody reads. */
    const real = safeDetail('  1758 checks across 65 suites in 41.2 min\n  3 suites failing: csp, render, pwa\n', 'FALLBACK');
    ok('a summary it can parse is still reported', /1758 checks across 65 suites/.test(real), real);
    ok('and failing suite names come through', /csp, render, pwa/.test(real));
    ok('the fallback is not used when a shape matched', !/FALLBACK/.test(real));

    /* The names are re-rendered from validated captures, never passed through.
       THIS FIXTURE IS LOWERCASE ON PURPOSE. The first version of it said
       "A 54-year-old man..." and passed with the filter deleted, because the
       shape's character class had already excluded uppercase — the test was
       exercising a regex and reporting it as coverage of the filter. Every
       token here is one the capture admits, so only the filter can reject it. */
    const sneaky = safeDetail('  2 suites failing: csp, a 54-year-old man with exertional dyspnea\n', 'FB');
    ok('prose smuggled into the suite list is dropped',
       !/exertional|dyspnea/i.test(sneaky), sneaky);
    ok('and the real suite id beside it still comes through', /csp/.test(sneaky), sneaky);
  }
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
