#!/usr/bin/env node
'use strict';
/*
 * The whole older-ACC round in one command, on the owner's laptop:
 *
 *   node tools/older-acc-all.js
 *
 *   1. node tools/older-acc-import.js            read both PDFs, stage what is new
 *   2. node scripts/build.js                     a fresh single-file build
 *   3. node tools/older-acc-import.js --merge    the staged questions into it
 *   4. node scripts/extract-content.js build/systole.html
 *   5. node scripts/verify.js --pwa              every suite, both builds
 *
 * and ONE file to upload, source/older-acc-run.txt (source/ is gitignored),
 * holding: the import report (counts, page numbers and shapes — the importer
 * prints nothing else), the merge line, the verify totals, the label of each
 * failing check (cut before its "→" detail, which is where a suite quotes
 * data), and tests/test-stats.json if the run wrote it.
 *
 * WHY. Each of those steps used to be a separate command, a separate paste
 * and a separate round trip. The owner asked for one.
 *
 * ONE GATE, before anything is merged: if the import stages FEWER questions
 * than the staging it replaces, the run stops there. A parser change that
 * loses questions is a regression to look at, not to build — and nothing past
 * step 1 has touched the build. (The staging itself has already been
 * replaced; rerunning the previous commit's importer restores it.)
 *
 * A run whose ONLY failing suite is `stats` is the expected shape when counts
 * move: verify.js still writes the record (see writeStats), and the guarded
 * prose is brought to it in the repo afterwards. Anything else red is real.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'source', 'older-acc-run.txt');
const REPORT = path.join(ROOT, 'source', 'older-staging', 'report.json');
const log = [];
const say = s => { console.log(s); log.push(s); };
const save = () => { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, log.join('\n') + '\n', 'utf8'); };
const finish = code => {
  save();
  console.log(`\nwritten: ${path.relative(process.cwd(), OUT)} — upload that one file`);
  process.exit(code);
};

/* Run a step with its output shown live and also kept. */
function step(title, args, { keep = true } = {}) {
  say(`\n=== ${title}`);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = (r.stdout || '') + (r.stderr || '');
  process.stdout.write(out);
  if (keep) log.push(out.replace(/\r/g, '').replace(/[^\n]*page \d+\/\d+[^\n]*\n?/g, '').trimEnd());
  return { ok: r.status === 0, out };
}

const readAdded = () => { try { return JSON.parse(fs.readFileSync(REPORT, 'utf8')).totals.added; } catch (_) { return null; } };
const before = readAdded();

let s = step('import', ['tools/older-acc-import.js']);
if (!s.ok) { say('\nimport failed — stopped before the build.'); finish(1); }
const after = readAdded();
say(`\nstaged: ${after} questions (the staging before this run held ${before === null ? 'none' : before})`);
if (before !== null && after !== null && after < before) {
  say(`STOPPED: fewer questions staged than before (${after} < ${before}). Nothing was built or merged.`);
  finish(1);
}

s = step('build', ['scripts/build.js'], { keep: false });
if (!s.ok) { say(s.out.split('\n').filter(Boolean).slice(-3).join('\n')); say('build failed.'); finish(1); }
say('build ok');

s = step('merge', ['tools/older-acc-import.js', '--merge']);
if (!s.ok) { say('merge failed.'); finish(1); }
s = step('extract', ['scripts/extract-content.js', 'build/systole.html'], { keep: false });
if (!s.ok) { say(s.out.split('\n').filter(Boolean).slice(-3).join('\n')); say('extract failed.'); finish(1); }
say('extract ok');

const stats = path.join(ROOT, 'tests', 'test-stats.json');
const statsBefore = fs.existsSync(stats) ? fs.statSync(stats).mtimeMs : 0;
s = step('verify --pwa', ['scripts/verify.js', '--pwa'], { keep: false });
/* From the verify output, only what counts: each suite's row (name, ✓/✗,
   passed/failed), the totals, and each failing check's LABEL — cut before its
   "→", which is where a suite quotes the data it looked at. Never the notes a
   suite prints, and never tests/last-run.log, which quotes stem text. */
const lines = s.out.replace(/\r/g, '').split('\n');
const rows = lines.filter(l => /^\s{2}\S+\s+(?:[✓✗]\s+\d+ passed|did not report)/.test(l)).map(l => l.replace(/\s{2,}\(.*$/, '').trimEnd());
const totals = lines.filter(l => /checks across|suites? failing|all green|only the counts record|^\s*pwa[: ]|^\s*pages[: ]|shell total/i.test(l)).map(l => l.trim());
const fails = lines.filter(l => /^\s*FAIL\s/.test(l)).map(l => l.split('→')[0].trim().slice(0, 140));
const bad = rows.filter(r => !/✓/.test(r));
say(`suites reported ${rows.length}, not green ${bad.length}${bad.length ? ': ' + bad.map(r => r.trim().split(/\s+/)[0]).join(', ') : ''}`);
say(totals.join('\n') || '(verify printed no totals)');
if (fails.length) {
  say(`\nfailing checks (labels only, ${fails.length}):`);
  for (const f of fails.slice(0, 80)) say('  ' + f);
}
if (fs.existsSync(stats) && fs.statSync(stats).mtimeMs > statsBefore) {
  say('\n=== tests/test-stats.json (written by this run)');
  say(fs.readFileSync(stats, 'utf8').trimEnd());
} else say('\ntests/test-stats.json was not rewritten by this run');
finish(s.ok ? 0 : 1);
