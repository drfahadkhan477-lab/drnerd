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
    cmd: ['node', ['scripts/extract-content.js', () => BUILD]], needs: () => fs.existsSync(BUILD) },
  { id: 'pwabuild',  what: 'the split build assembles',
    cmd: ['node', ['scripts/build-pwa.js', () => BUILD]], needs: () => fs.existsSync(BUILD) },
  { id: 'chromium',  what: 'the full suite, on chromium',
    cmd: ['node', ['scripts/verify.js', () => BUILD]], needs: () => fs.existsSync(BUILD) },
  { id: 'pwa',       what: 'the full suite, against the split build over http',
    cmd: ['node', ['scripts/verify.js', () => BUILD, '--pwa']], needs: () => fs.existsSync(DIST) },
  /* WebKit is the ACTUAL TARGET — the app is used on an iPad — so it is on by
     default and skipping it costs you the CERTIFIED line rather than passing
     quietly. It is also the engine where the 42 MB single file takes ~100s to
     parse before a line of app code runs, which is why the boot waits matter. */
  { id: 'webkit',    what: 'the full suite, on webkit — the engine the app actually runs on',
    cmd: ['node', ['scripts/verify.js', () => BUILD, '--engine', 'webkit']], needs: () => fs.existsSync(BUILD) },
];

/* ── running one ─────────────────────────────────────────────────────────── */
const results = [];
function record(step, state, detail, seconds) {
  results.push({ id: step.id, what: step.what, state, detail, seconds });
  const mark = { PASS: '  ✓', FAIL: '  ✗', SKIP: '  –' }[state];
  console.log(`${mark} ${step.id.padEnd(10)} ${step.what}${detail ? `\n               ${detail}` : ''}`);
}

for (const step of STEPS) {
  if (SKIP.has(step.id)) { record(step, 'SKIP', 'asked for with --skip'); continue; }
  if (step.needs && !DRY && !step.needs()) {
    record(step, 'SKIP', 'what it needs was not produced by an earlier step'); continue;
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
        record(step, 'FAIL', lastLines(out, 3), (Date.now() - t0) / 1000);
        continue;
      }
      detail = lastLines(out, 1);
    }
    record(step, 'PASS', detail, (Date.now() - t0) / 1000);
  } catch (e) {
    record(step, 'FAIL', String(e.message).split('\n')[0].slice(0, 200), (Date.now() - t0) / 1000);
  }
}

function lastLines(s, n) {
  return s.split('\n').map(l => l.trim()).filter(Boolean).slice(-n).join(' | ').slice(0, 300);
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
lines.push('data appears in this report. It is written into `build/`, which is');
lines.push('gitignored and refused by `scripts/leak-guard.js`.');

fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, lines.join('\n') + '\n');

console.log(`\n  ${verdict}`);
if (failed.length)  console.log(`  ${failed.length} failed: ${failed.map(r => r.id).join(', ')}`);
if (skipped.length) console.log(`  ${skipped.length} skipped: ${skipped.map(r => r.id).join(', ')} — skipping is why this is not CERTIFIED`);
console.log(`  report  ${path.relative(ROOT, REPORT)}\n`);
process.exit(verdict === 'CERTIFIED' ? 0 : 1);
