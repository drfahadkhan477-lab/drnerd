#!/usr/bin/env node
/*
 * One command that certifies a build, or refuses to.
 *
 *   node scripts/release-check.js <source.html>
 *   node scripts/release-check.js <source.html> --skip webkit,figreview
 *   node scripts/release-check.js --dry-run            # exercise the gate itself
 *
 * WHY THIS EXISTS, in the words of the audit that asked for it: a green GitHub
 * CI result does not mean the application has passed. CI runs the suites that
 * need no browser and no build, because the licensed export is not there and
 * must not be. That is stated honestly in the workflow header — but "stated
 * honestly in a file nobody opens at release time" is how a green checkmark
 * comes to mean something it does not.
 *
 * So the real gate has to run where the source is, which is one laptop, by
 * hand, with the steps remembered in the right order. This is that, written
 * down.
 *
 * ── THE ONE RULE THAT MATTERS ────────────────────────────────────────────
 *
 * It must never claim more than it measured. A gate that prints CERTIFIED
 * after skipping WebKit is worse than no gate, because it converts "I did not
 * check" into "I checked" — which is the same defect as a test that cannot
 * fail, one level up. So there are three outcomes, not two:
 *
 *   CERTIFIED      every step ran and every step passed
 *   NOT CERTIFIED  something failed
 *   INCOMPLETE     nothing failed, but something was skipped — and the report
 *                  names each skip and the reason, every time
 *
 * A skip is never silent and never folded into a pass. Exit code is 0 only
 * for CERTIFIED.
 *
 * ── WHAT IT RECORDS ──────────────────────────────────────────────────────
 *
 * The report answers "what exactly did I deploy?" three months later: the git
 * commit, the source digest, a SHA-256 for the single-file build, and a
 * content-addressed root over every file in dist/ — so two deployments can be
 * compared without either being opened. Counts and hashes only; no question
 * text, no options, no commentary, no figure data. It is written into build/,
 * which is gitignored AND refused by scripts/leak-guard.js, so it cannot be
 * committed by habit.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const has = f => argv.includes(f);
const opt = (f, d = '') => { const i = argv.indexOf(f); return i < 0 ? d : (argv[i + 1] || d); };
const SKIP = new Set(opt('--skip').split(',').map(s => s.trim()).filter(Boolean));
const SRC = argv.find(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--skip');

if (!DRY && !SRC) {
  console.error('usage: node scripts/release-check.js <source.html> [--skip webkit,figreview]');
  process.exit(2);
}

const BUILD = path.join(ROOT, 'build', 'systole.html');
const DIST  = path.join(ROOT, 'dist');
const REPORT = path.join(ROOT, 'build', 'release-report.md');

/* ── the steps, as data ──────────────────────────────────────────────────── */
/* `id` is what --skip names. `needs` is what must already exist for the step to
   be meaningful, so a skipped build does not produce a confusing verification
   failure three steps later — it produces an honest skip with a reason. */
const STEPS = [
  { id: 'source',    what: 'the licensed export is present and readable',
    run: () => { fs.accessSync(SRC, fs.constants.R_OK); return `${(fs.statSync(SRC).size / 1048576).toFixed(1)} MB`; } },
  { id: 'leakguard', what: 'nothing licensed is staged or tracked',
    cmd: ['node', ['scripts/leak-guard.js', '--all-tracked']] },
  { id: 'build',     what: 'the patch chain applies, all of it',
    cmd: ['node', ['scripts/build.js', () => SRC]] },
  { id: 'extract',   what: 'every figure decodes and reads back byte-identical',
    cmd: ['node', ['scripts/extract-content.js', () => BUILD]], after: 'build', needs: () => fs.existsSync(BUILD) },
  { id: 'pwabuild',  what: 'the split build assembles',
    cmd: ['node', ['scripts/build-pwa.js', () => BUILD]], after: 'build', needs: () => fs.existsSync(BUILD) },
  { id: 'chromium',  what: 'the full suite, on chromium',
    cmd: ['node', ['scripts/verify.js', () => BUILD]], after: 'build', needs: () => fs.existsSync(BUILD) },
  { id: 'pwa',       what: 'the full suite, against the split build over http',
    cmd: ['node', ['scripts/verify.js', () => BUILD, '--pwa']], after: 'pwabuild', needs: () => fs.existsSync(DIST) },
  /* WebKit is the ACTUAL TARGET — the app is used on an iPad — so it is on by
     default and skipping it costs you the CERTIFIED line rather than passing
     quietly. It is also the engine where the 42 MB single file takes ~100s to
     parse before a line of app code runs, which is why the boot waits matter. */
  { id: 'webkit',    what: 'the full suite, on webkit — the engine the app actually runs on',
    cmd: ['node', ['scripts/verify.js', () => BUILD, '--engine', 'webkit']], after: 'build', needs: () => fs.existsSync(BUILD) },
];

/* ── running one ─────────────────────────────────────────────────────────── */
/* ── what a step is allowed to say about itself ──────────────────────────────
   THIS USED TO BE lastLines(out, 3): the last three lines of the failing
   subprocess, passed through verbatim into both the console and the report.
   The report's own footer has always promised

       "No question text, options, commentary or figure data appears in this
        report."

   and nothing enforced it. In practice those three lines are verify's summary
   and harmless, which is exactly what made it comfortable — but a crash, a
   stack trace, or a Playwright error quoting the page carries whatever it
   carries, and a suite FAIL line puts its interpolated detail after an arrow.
   A promise the code does not keep is the "claims more than it measured"
   failure this file's own header is about, sitting in the file.

   Two things it turned out to reach, not one. `detail` is printed by record()
   as well as written to the report, so it is also every line the self-hosted
   CI job would put into a GitHub Actions log — shared infrastructure, on a
   corpus that must not leave the machine.

   SO NOTHING IS PASSED THROUGH. Each shape below is a fact this function can
   PARSE, and the string that comes out is rebuilt from validated captures:
   integers stay integers, and a name is emitted only if it is a bare
   [a-z0-9-] suite id. A line that matches nothing contributes nothing.

   FAIL-CLOSED: when no shape matches — the interesting case, because that is
   what a novel crash looks like — the answer is the exit code and where the
   real output is. It is on the machine that ran it, which is the only machine
   allowed to read it. */
/* AN ALLOWLIST, BECAUSE A SHAPE IS NOT A DISCRIMINATOR. Filtering the suite
   list by "looks like an identifier" was tried and does not work: `dyspnea`
   and `exertional` are lower-case, hyphen-free and short, so every rule that
   admits `figzoom-pure` admits them too. A test proved it — the filter let
   four words of a stem through while reporting the suite id beside them as a
   success.

   The names are knowable, so they are looked up rather than judged. This is
   the registry verify.js actually runs, read at call time, so it cannot drift
   from it. If the registry cannot be read the answer is no names at all, not
   unchecked ones: the count alone still tells you to go and look. */
let SUITE_NAMES = null;
function isSuiteName(n) {
  if (SUITE_NAMES === null) {
    try {
      const src = fs.readFileSync(path.join(ROOT, 'scripts', 'verify.js'), 'utf8');
      const block = src.match(/const SUITES\s*=\s*\[([\s\S]*?)\n\];/);
      const names = block ? [...block[1].matchAll(/\[\s*'([a-z0-9-]+)'/g)].map(x => x[1]) : [];
      /* SUITES is not the whole registry. Three suites are spawned by name from
         the --pwa path instead of being registered — and they are precisely the
         ones a --pwa run reports as failing, so an allowlist built from SUITES
         alone drops exactly the names worth having. Taken from the same file by
         the path it spawns them on, so adding a fourth needs no edit here. */
      for (const m of src.matchAll(/'tests',\s*'verify-([a-z0-9-]+)\.js'/g)) names.push(m[1]);
      SUITE_NAMES = new Set(names);
    } catch (_) { SUITE_NAMES = new Set(); }
  }
  return SUITE_NAMES.has(n);
}

const SHAPES = [
  [/\b(\d+) checks across (\d+) suites in ([\d.]+) min\b/,
   m => `${m[1]} checks across ${m[2]} suites in ${m[3]} min`],
  /* THE CAPTURE IS DELIBERATELY WIDE AND THE FILTER DOES THE WORK. It was the
     other way round first — the class was [a-z0-9,\s-]+, which silently made
     the token filter below unreachable, because every token it could ever see
     already matched. The protection was an accident of a character class, and
     a test written against it passed with the filter deleted. Capturing the
     rest of the line puts the decision where it can be read and where removing
     it fails a test. Bounded as well as filtered: a suite id is short and
     there are never many, so prose cannot arrive as a long list of very short
     lowercase words. */
  [/\b(\d+) suites? failing:\s*(.+)$/m,
   m => {
     const names = m[2].split(/[,\s]+/).filter(isSuiteName).slice(0, 12);
     return names.length ? `${m[1]} failing: ${names.join(', ')}` : `${m[1]} failing`;
   }],
  [/\ball green\b/, () => 'all green'],
  [/\b(\d+) checks, all green\b/, m => `${m[1]} checks, all green`],
  [/\b(\d+) passed, (\d+) failed\b/, m => `${m[1]} passed, ${m[2]} failed`],
  [/\bshell total\s+([\d.]+)\s*([kKmM]?B)\b/, m => `shell total ${m[1]} ${m[2]}`],
  [/\b(\d+) file\(s\) checked, nothing licensed\b/, m => `${m[1]} files checked, nothing licensed`],
  [/\bwrote\s+(\d+)\s+figures?\b/, m => `wrote ${m[1]} figures`],
];

function safeDetail(out, fallback) {
  const found = [];
  for (const [re, render] of SHAPES) {
    const m = re.exec(String(out || ''));
    if (m && found.length < 3) found.push(render(m));
  }
  return found.length ? found.join(' | ') : fallback;
}

const results = [];
const outcome = new Map();
function record(step, state, detail, seconds) {
  results.push({ id: step.id, what: step.what, state, detail, seconds });
  outcome.set(step.id, state);
  const mark = { PASS: '  ✓', FAIL: '  ✗', SKIP: '  –' }[state];
  console.log(`${mark} ${step.id.padEnd(10)} ${step.what}${detail ? `\n               ${detail}` : ''}`);
}

for (const step of STEPS) {
  if (SKIP.has(step.id)) { record(step, 'SKIP', 'asked for with --skip'); outcome.set(step.id, 'SKIP'); continue; }
  /* `needs` ASKED THE DISK, WHICH IS NOT THE SAME QUESTION. build/systole.html
     existing says a build happened once, not that the build in THIS run
     succeeded — so a run whose build step failed went on to test whatever
     artifact was left over from the last one and report on it. That is the
     overclaim this file exists to prevent, in the file itself: a gate
     certifying an artifact it did not produce.

     It also made the suite for this file unsafe to run. verify-release drives
     the gate with a nonexistent source to prove a missing export is refused,
     and its comment says "nothing can run here — there is no licensed export
     in this container", which was true where it was written and false on the
     owner's laptop: with a build on disk, that one line ran the whole 68-suite
     verify three times, WebKit included, from inside a verify run. The test
     was not wrong about what it wanted to prove; the gate was wrong about what
     `needs` meant. */
  if (step.after && !DRY && outcome.get(step.after) !== 'PASS') {
    record(step, 'SKIP', `${step.after} did not pass in this run`);
    outcome.set(step.id, 'SKIP');
    continue;
  }
  if (step.needs && !DRY && !step.needs()) {
    record(step, 'SKIP', 'what it needs was not produced by an earlier step');
    outcome.set(step.id, 'SKIP');
    continue;
  }
  const t0 = Date.now();
  /* A dry run is a SKIP, not a PASS, and the difference is the whole point of
     this file. The first version recorded PASS and printed CERTIFIED having
     executed nothing — the exact overclaim the header above forbids, written
     by the person who had just finished writing the header. It survives here
     as the reason the rule is stated in code rather than in prose. */
  if (DRY) { record(step, 'SKIP', 'dry run — the step was not executed', 0); continue; }
  try {
    let detail = '';
    if (step.run) detail = step.run() || '';
    else {
      const [bin, args] = step.cmd;
      const real = args.map(a => (typeof a === 'function' ? a() : a));
      const r = spawnSync(bin, real, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const out = (r.stdout || '') + (r.stderr || '');
      if (r.status !== 0) {
        record(step, 'FAIL',
          safeDetail(out, `exit ${r.status === null ? 'signal ' + r.signal : r.status} — full output in tests/last-run.log on this machine`),
          (Date.now() - t0) / 1000);
        continue;
      }
      detail = safeDetail(out, '');
    }
    record(step, 'PASS', detail, (Date.now() - t0) / 1000);
  } catch (e) {
    /* A thrown error's message is not subprocess output, but it is still text
       from outside this file — an fs error carries a path, and a path can
       carry the export's filename. Same rule: the code, not the prose. */
    record(step, 'FAIL', `threw: ${String(e && e.code || 'Error').slice(0, 40)}`, (Date.now() - t0) / 1000);
  }
}


/* ── what was produced ───────────────────────────────────────────────────── */
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
function fileDigest(p) {
  try { return sha(fs.readFileSync(p)).slice(0, 16); } catch (_) { return null; }
}
/* Content-addressed over the whole directory: every path and every file's own
   digest, sorted, hashed together. Two deployments compare by one line. */
function treeDigest(dir) {
  if (!fs.existsSync(dir)) return null;
  const parts = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else parts.push(path.relative(dir, p).split(path.sep).join('/') + ':' + sha(fs.readFileSync(p)));
    }
  })(dir);
  return { root: sha(parts.join('\n')).slice(0, 16), files: parts.length };
}

const git = (() => {
  try {
    return {
      commit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      branch: execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
      dirty: execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim().length > 0,
    };
  } catch (_) { return { commit: 'unknown', branch: 'unknown', dirty: false }; }
})();

const failed  = results.filter(r => r.state === 'FAIL');
const skipped = results.filter(r => r.state === 'SKIP');
const verdict = DRY ? 'DRY RUN — nothing was measured'
              : failed.length ? 'NOT CERTIFIED'
              : skipped.length ? 'INCOMPLETE'
              : 'CERTIFIED';

const tree = DRY ? null : treeDigest(DIST);
const lines = [];
lines.push(`# Release check — ${verdict}`, '');
lines.push(`    when      ${new Date().toISOString()}`);
lines.push(`    commit    ${git.commit} on ${git.branch}${git.dirty ? '  (UNCOMMITTED CHANGES — this is not a reproducible artifact)' : ''}`);
if (!DRY && SRC) lines.push(`    source    ${path.basename(SRC)}  sha256:${fileDigest(SRC)}`);
lines.push(`    build     ${fileDigest(BUILD) ? 'sha256:' + fileDigest(BUILD) : 'not produced'}`);
lines.push(`    dist      ${tree ? `root:${tree.root}  (${tree.files} files)` : 'not produced'}`);
lines.push('', '## Steps', '');
for (const r of results) {
  lines.push(`- **${r.state}** \`${r.id}\` — ${r.what}` +
    (r.seconds ? `  _(${r.seconds.toFixed(0)}s)_` : '') +
    (r.detail ? `\n  - ${r.detail}` : ''));
}
if (skipped.length) {
  lines.push('', '## Not measured', '');
  lines.push('This build is **not certified**. Each of these was skipped, and a skip is');
  lines.push('an absence of evidence, not evidence of absence:', '');
  for (const r of skipped) lines.push(`- \`${r.id}\` — ${r.what}  (${r.detail})`);
}
lines.push('', '---', '');
lines.push('Counts and digests only. No question text, options, commentary or figure');
lines.push('data appears in this report — enforced rather than intended: a step reports');
lines.push('itself through safeDetail(), which rebuilds a line from facts it could parse');
lines.push('and emits nothing it could not. A failure it does not recognise becomes an');
lines.push('exit code and a pointer to `tests/last-run.log`, which stays on the machine.');
lines.push('');
lines.push('It is also written into `build/`, which is gitignored and refused by');
lines.push('`scripts/leak-guard.js`.');

fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, lines.join('\n') + '\n');

console.log(`\n  ${verdict}`);
if (failed.length)  console.log(`  ${failed.length} failed: ${failed.map(r => r.id).join(', ')}`);
if (skipped.length) console.log(`  ${skipped.length} skipped: ${skipped.map(r => r.id).join(', ')} — skipping is why this is not CERTIFIED`);
console.log(`  report  ${path.relative(ROOT, REPORT)}\n`);
process.exit(verdict === 'CERTIFIED' ? 0 : 1);
