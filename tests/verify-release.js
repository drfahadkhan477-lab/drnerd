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

head('the verifier can preserve its existing record');
{
  const vm = require('vm');
  const { blankComments } = require('./_source.js');
  const source = blankComments(fs.readFileSync(path.join(ROOT, 'scripts', 'verify.js'), 'utf8'));
  const start = source.indexOf('function writeStats(pwaCount) {');
  const end = source.indexOf('function writeFailLog(', start);
  const code = start >= 0 && end > start ? source.slice(start, end) : '';
  const run = disabled => {
    let writes = 0;
    const ctx = { flag: name => name === '--no-record' && disabled, TARGET_IS_URL: false, SYNTHETIC: false,
      ENGINE: 'chromium', DEFAULT_ENGINE: 'chromium', ROOT: '/tmp', path, process,
      fs: { readFileSync: () => '{}', writeFileSync: () => { writes++; } },
      mergeRecord: () => ({ record: {} }), results: [], SUITES: [], JOBS: 1, STARTED_ON: 'test', console: { log() {} } };
    try { vm.runInNewContext(code + '\nwriteStats();', ctx); return writes; } catch (_) { return -1; }
  };
  ok('a no-record run never writes the existing record', run(true) === 0);
  ok('an ordinary complete run can still write its record', run(false) === 1);
  const list = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'verify.js'), '--no-record', '--list'], { encoding: 'utf8' });
  ok('the verifier accepts no-record as a command-line flag', list.status === 0);
}

head('a run that measured nothing says so');
{
  const r = run('--dry-run');
  ok('a dry run is not CERTIFIED', !/^\s*CERTIFIED\s*$/m.test(r.out), r.out.match(/DRY RUN.*|CERTIFIED/)?.[0] || '');
  ok('it says plainly that nothing was measured', /nothing was measured/.test(r.out));
  ok('and it exits non-zero', r.code === 1, String(r.code));
  /* The distinction the whole file turns on: skipped is not passed. */
  /* The step count is read from the gate, not written here: this said "8"
     and went stale the day a step was added. */
  const steps = (fs.readFileSync(GATE, 'utf8').match(/^\s*\{ id: '[a-z]+'/gm) || []).length;
  ok('every step is recorded as skipped, not passed',
     steps > 5 && new RegExp(`\\b${steps} skipped`).test(r.out) && !/✓/.test(r.out),
     `${(r.out.match(/\d+ skipped/) || [''])[0]} of ${steps} steps`);
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

head('a step runs one suite at a time, whatever the shell has set');
{
  /* The gate of 24 November 2026 inherited SYSTOLE_JOBS=auto and ran three suites at once on a 4-core, 8 GB laptop:
     twelve failed in the run and eleven passed alone (scripts/release-check.js). Driven here with the variable set, as
     that shell had it. Then each step's own arguments go to verify.js with SYSTOLE_JOBS set to something that is not a
     count, a placeholder build, and one quick pure suite: verify.js refuses that variable unless --jobs is given, so if
     it runs, the flag won. */
  const r = spawnSync(process.execPath, [GATE, '--dry-run'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SYSTOLE_JOBS: 'auto' } });
  const out = (r.stdout || '') + (r.stderr || '');
  const cmdOf = id => {
    const m = out.match(new RegExp(`[–✓✗] ${id}\\s[^\\n]*\\n[^\\n]*would run: ([^\\n]*)`));
    return m ? m[1].trim().split(/\s+/) : null;
  };
  const jobsOf = argv => argv && argv.indexOf('--jobs') > 0 ? argv[argv.indexOf('--jobs') + 1] : null;
  for (const id of ['chromium', 'pwa', 'webkit'])
    ok(`the ${id} step names --jobs 1 with SYSTOLE_JOBS=auto in the shell`, jobsOf(cmdOf(id)) === '1', cmdOf(id) ? cmdOf(id).join(' ') : 'no "would run" line');
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'jobs-'));
  try {
    const build = path.join(tmp, 'b.html');
    fs.writeFileSync(build, '<html></html>');
    for (const id of ['chromium', 'webkit']) {
      const argv = cmdOf(id) || [];
      const v = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'verify.js'), build, ...argv.slice(3), '--only', 'fsrs'],
        { cwd: ROOT, encoding: 'utf8', timeout: 120000, env: { ...process.env, SYSTOLE_JOBS: 'not-a-count' } });
      const said = (v.stdout || '') + (v.stderr || '');
      ok(`and verify.js lets the ${id} step's --jobs win over the variable`, v.status === 0 && !/is not a number of jobs/.test(said),
         /is not a number of jobs/.test(said) ? 'the variable won' : `exit ${v.status}`);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

head('a step that says chromium runs on chromium, whatever the shell has set');
{
  /* verify.js takes SYSTOLE_ENGINE from the environment when it is given no
     --engine, and the gate spawns every step with the caller's environment.
     The chromium and pwa steps named no engine, so with the variable set to
     webkit they ran on WebKit under a report saying "on chromium" (found by
     review). The gate is driven here the way that shell would drive it, and
     the command each step would run is read from the dry run's own line. */
  const r = spawnSync(process.execPath, [GATE, '--dry-run'],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SYSTOLE_ENGINE: 'webkit' } });
  const out = (r.stdout || '') + (r.stderr || '');
  const cmdOf = id => {
    const m = out.match(new RegExp(`[–✓✗] ${id}\\s[^\\n]*\\n[^\\n]*would run: ([^\\n]*)`));
    return m ? m[1].trim().split(/\s+/) : null;
  };
  const engineOf = argv => argv && argv.indexOf('--engine') > 0 ? argv[argv.indexOf('--engine') + 1] : null;
  const pwaCommand = cmdOf('pwa') || [];
  ok('the split-build step runs PWA phases without repeating the standalone registry',
     pwaCommand.includes('--pwa') && pwaCommand[pwaCommand.indexOf('--only') + 1] === 'pwa'
     && !cmdOf('chromium')?.includes('--only') && !cmdOf('webkit')?.includes('--only'));
  for (const id of ['chromium', 'pwa', 'webkit']) ok(`the ${id} step keeps the recorded counts unchanged`, !!cmdOf(id) && cmdOf(id).includes('--no-record'));
  for (const [id, want] of [['chromium', 'chromium'], ['pwa', 'chromium'], ['webkit', 'webkit']]) {
    const argv = cmdOf(id);
    ok(`the ${id} step shows the command it would run`, !!argv && /verify\.js$/.test(argv[1] || ''),
       argv ? argv.join(' ') : 'no "would run" line');
    ok(`and it names --engine ${want} with SYSTOLE_ENGINE=webkit in the shell`, engineOf(argv) === want,
       String(engineOf(argv)));
  }
  /* AND verify.js LETS THAT FLAG WIN. The fix rests on verify.js preferring
     --engine to SYSTOLE_ENGINE; if that precedence were ever reversed, the
     check above would stay green over a WebKit run. So each step's own
     arguments go to verify.js, with the variable set to something that is not
     an engine and the build path pointed nowhere: verify.js validates the
     engine before it looks for a build, so refusing the variable means the
     environment won, and "No build at" means the engine came from the command
     and verify.js got past it. Nothing runs either way. */
  for (const id of ['chromium', 'pwa']) {
    const argv = cmdOf(id) || [];
    const v = spawnSync(process.execPath,
      [path.join(ROOT, 'scripts', 'verify.js'), path.join(ROOT, 'no-such-dir', 'systole.html'), ...argv.slice(3)],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SYSTOLE_ENGINE: 'not-an-engine' } });
    const vout = (v.stdout || '') + (v.stderr || '');
    ok(`verify.js, given the ${id} step's arguments, ignores the shell's engine`,
       argv.length > 3 && !/is not an engine/.test(vout) && /No build at/.test(vout),
       (vout.match(/is not an engine|No build at/) || [vout.trim().split('\n')[0] || `exit ${v.status}`])[0]);
  }
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

head('a failed browser step names which of its suites pass alone, and still fails');
{
  /* The gate of 23 November 2026 failed twelve suites and said nothing about why; the triage was done by hand
     (scripts/release-check.js, failingSuites). Lifted out as safeDetail is below: a real failure needs a build. */
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'release-check.js'), 'utf8');
  const m = src.match(/let SUITE_NAMES = null;[\s\S]*?\nfunction aloneSummary[\s\S]*?\n\}/);
  ok('failingSuites and aloneSummary are where the test expects them', !!m);
  if (m) {
    const mod = {};
    new Function('module', 'fs', 'path', 'ROOT', m[0] + '\nmodule.exports = { failingSuites, aloneSummary, aloneArgs };')(mod, fs, path, ROOT);
    const { failingSuites, aloneSummary, aloneArgs } = mod.exports;
    const got = failingSuites('  9175 checks across 195 suites in 79.2 min\n  3 suites failing: pearl, settings, dyspnea\n');
    ok('the suites to rerun are the failing ones verify.js names, through the same allowlist',
       JSON.stringify(got) === '["pearl","settings"]', JSON.stringify(got));
    ok('and a run that names none reruns none', failingSuites('Error: expected true\n  FAIL  a label').length === 0 && failingSuites(null).length === 0);
    const line = aloneSummary([{ name: 'pearl', passed: true }, { name: 'settings', passed: false }, { name: 'quiznav', passed: true }]);
    ok('the step\'s line says how many passed alone, and which failed alone too',
       line === 'rerun alone: 2 of 3 passed (pearl, quiznav); still failing alone: settings', line);
    ok('and says nothing when nothing was rerun', aloneSummary([]) === '');
    /* The rerun's own command, given to verify.js itself: a placeholder build and a pure suite, so it is quick,
       and bounded, because a command that lost --only would run every suite against the placeholder. Nothing
       here claims the rerun leaves the record alone: verify.js writes it only from a run of every suite, so a
       one-suite run cannot write it with or without --no-record, and dropping the flag was seen to fail nothing. */
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'alone-'));
    try {
      const build = path.join(tmp, 'b.html'), json = path.join(tmp, 'r.json');
      fs.writeFileSync(build, '<html></html>');
      const r = spawnSync(process.execPath, [...aloneArgs('fsrs', 'webkit', build), '--report-json', json], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
      const rep = fs.existsSync(json) ? JSON.parse(fs.readFileSync(json, 'utf8')) : {};
      ok('the rerun runs that one suite, and on that engine',
         r.status === 0 && rep.selected === 1 && rep.ran === 1 && rep.engine === 'webkit' && (rep.suites || []).map(x => x.suite).join() === 'fsrs',
         JSON.stringify({ status: r.status, selected: rep.selected, ran: rep.ran, engine: rep.engine, suites: (rep.suites || []).map(x => x.suite) }));
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  /* The rerun certifies nothing: in the branch for a failed step, every record() is a FAIL, whatever the
     reruns found. Read with comments blanked, so this sentence cannot satisfy it. */
  const { blankComments } = require('./_source.js');
  const code = blankComments(src);
  const at = code.indexOf('if (r.status !== 0) {');
  const block = at >= 0 ? code.slice(at, code.indexOf('\n        continue;\n      }', at)) : '';
  const records = [...block.matchAll(/record\(step,\s*'([A-Z]+)'/g)].map(x => x[1]);
  ok('a step whose suites all pass alone is still recorded as FAIL', records.length > 0 && records.every(s => s === 'FAIL') && /aloneSummary\(/.test(block),
     records.join(', ') || 'no record() in the failed branch');
}

head('the report says where it ran');
{
  const env = { ...process.env, SYSTOLE_JOBS: 'auto' };
  spawnSync(process.execPath, [GATE, '--dry-run'], { cwd: ROOT, encoding: 'utf8', env });
  const md = fs.existsSync(REPORT) ? fs.readFileSync(REPORT, 'utf8') : '';
  ok('it names the platform, the cores and the memory', new RegExp(`machine\\s+${require('os').platform()} \\S+, ${require('os').cpus().length} cores, \\d+ GB`).test(md),
     (md.match(/machine.*$/m) || ['no machine line'])[0]);
  ok('and whether the suites shared the machine', /suites with SYSTOLE_JOBS=auto/.test(md));
  spawnSync(process.execPath, [GATE, '--dry-run'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SYSTOLE_JOBS: '3 && echo leaked' } });
  const odd = fs.existsSync(REPORT) ? fs.readFileSync(REPORT, 'utf8') : '';
  ok('a SYSTOLE_JOBS that is not a count is not copied into the report', /not a count/.test(odd) && !/leaked/.test(odd));
  const { SYSTOLE_JOBS, ...plain } = process.env;
  spawnSync(process.execPath, [GATE, '--dry-run'], { cwd: ROOT, encoding: 'utf8', env: plain });
  ok('and with none set it says one at a time', /suites one at a time/.test(fs.existsSync(REPORT) ? fs.readFileSync(REPORT, 'utf8') : ''));
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
    const failedPwa = safeDetail('  0 checks across 0 suites in 0.0 min\n  all green   —   test on chromium\n  pwa: 140 checks, all green\n  shell total 940 KB\n  pwa FAILED\n', 'exit 1', true);
    ok('a failing split stage never calls its empty registry all green', !/all green|0 checks across 0 suites/.test(failedPwa) && /pwa failed/.test(failedPwa), failedPwa);
    const green = safeDetail('  10 checks across 1 suites in 0.1 min\n  all green   —   test on chromium\n', '', false);
    ok('a successful measured registry can still report all green', /10 checks across 1 suites/.test(green) && /all green/.test(green), green);

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

head('the gate builds the app the way npm run build does');
{
  const { spawnSync } = require('child_process');
  const ROOT = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  ok('npm run build assembles the app from app/ and the export, to the file the rest of the pipeline reads', /assemble-app\.js/.test(pkg.scripts.build) && /--out build\/systole\.html/.test(pkg.scripts.build), pkg.scripts.build);
  ok('and the patch chain is gone: no build.js, no build:chain, no *-patch.js',
     !fs.existsSync(path.join(ROOT, 'scripts', 'build.js')) && !pkg.scripts['build:chain'] &&
     !fs.readdirSync(path.join(ROOT, 'scripts')).some(f => f.endsWith('-patch.js')));
  const r = spawnSync('node', [GATE, '--dry-run'], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  ok('the gate\'s build step is the assembler, said in those words', /build\s+the app assembles from app\/, src\/, assets\/ and the export/.test(out), out.split('\n').find(l => /^\s*[–✓✗]\s+build/.test(l)) || '(no build step)');
  ok('and the chain\'s byte-for-byte comparison is not a step any more: not skipped, gone, because there is no chain build to compare with', !/byte for byte/.test(out) && !/assemble\s+the app assembled/.test(out));
  ok('every step after it is still there, WebKit included', ['extract', 'pwabuild', 'chromium', 'pwa', 'webkit'].every(id => new RegExp('\\s' + id + '\\s').test(out)));
}

head('there is one command, whatever you call it');
{
  /* WHY AN ALIAS IS ALLOWED TO EXIST AT ALL. `npm run release` is the name
     people reach for; `npm run release-check` is the name the gate has had.
     Two names for one thing is how they stop being one thing — so the alias
     DELEGATES rather than repeating the command:

         "release-check": "node scripts/release-check.js",
         "release":       "npm run release-check --"

     There is exactly one spelling of the path to the gate. Change it and both
     names follow. That is the property checked here; a second literal
     `node scripts/release-check.js` would pass a naive "both exist" check and
     is precisely what must not be written.

     THE TRAILING `--` IS LOAD-BEARING: it forwards arguments, so
     `npm run release -- export.html --skip webkit` still reaches the gate.
     Without it the source file is silently dropped and the gate refuses for a
     reason that has nothing to do with the build. */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const scripts = pkg.scripts || {};
  ok('npm run release-check invokes the gate', scripts['release-check'] === 'node scripts/release-check.js',
     String(scripts['release-check']));
  ok('npm run release exists', typeof scripts.release === 'string', String(scripts.release));
  ok('and it delegates rather than repeating the path',
     scripts.release === 'npm run release-check --', String(scripts.release));
  /* The check that makes the delegation mean something: the gate's path is
     written down ONCE across the whole scripts block. */
  const spellings = Object.entries(scripts)
    .filter(([, v]) => /release-check\.js/.test(v)).map(([k]) => k);
  ok('the path to the gate appears in exactly one script', spellings.length === 1,
     spellings.join(', ') || 'none');

  /* AND IT MUST NOT LAUNDER THE VERDICT. A wrapper that swallowed the exit
     code would turn NOT CERTIFIED into a shell success, which is the overclaim
     this whole file exists to prevent — arriving through the convenience alias
     rather than through the gate. Driven for real, both ways, because "npm
     forwards exit codes" is an assumption and this file does not hold those. */
  /* NEVER THE BARE NAME `npm`, and this is the whole reason this helper is
     more than one line. The first version spawned 'npm' directly whenever
     npm_execpath was unset — which is every run of

         node scripts/verify.js build/systole.html

     since nothing sets that variable outside an `npm run`. On Linux the bare
     name resolves and it passed. On WINDOWS npm is npm.cmd, and since Node
     20.12 (CVE-2024-27980) spawning a .cmd without shell:true is refused
     outright: status null, no output, and two checks failing on the owner's
     laptop for a reason that had nothing to do with the thing under test.
     A portability bug in a test, shipped because it could not fail here.

     So npm's own JavaScript entry point is resolved and run with this node.
     No shell, no .cmd, no PATH lookup, identical on both platforms. */
  const npmCli = (() => {
    const fromEnv = process.env.npm_execpath;
    if (fromEnv && /\.c?js$/.test(fromEnv) && fs.existsSync(fromEnv)) return fromEnv;
    const bin = path.dirname(fs.realpathSync(process.execPath));
    for (const rel of [['node_modules', 'npm', 'bin', 'npm-cli.js'],
                       ['..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js']]) {
      const at = path.join(bin, ...rel);
      if (fs.existsSync(at)) return at;
    }
    return null;
  })();
  /* NOT VACUOUS. If npm cannot be found the three checks below would compare
     null against null and could be made to pass, so the finding is stated
     rather than absorbed: this names the cause instead of leaving an
     exit-code mismatch to be puzzled over. */
  ok("npm's own entry point was found, so the two below mean something",
     !!npmCli, npmCli || 'not found near ' + process.execPath);
  const viaNpm = name => {
    if (!npmCli) return { code: null, out: '' };
    const r = spawnSync(process.execPath, [npmCli, 'run', '--silent', name, '--', '--dry-run'],
                        { cwd: ROOT, encoding: 'utf8' });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
  };
  const viaAlias = viaNpm('release');
  ok('npm run release reaches the gate', /nothing was measured/.test(viaAlias.out),
     (viaAlias.out.match(/DRY RUN.*|CERTIFIED/) || [''])[0]);
  ok('and a non-zero verdict survives the alias', viaAlias.code === 1, String(viaAlias.code));
  const viaReal = viaNpm('release-check');
  ok('the name it delegates to behaves identically',
     viaAlias.code !== null && viaReal.code === viaAlias.code,
     `release ${viaAlias.code}, release-check ${viaReal.code}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
