#!/usr/bin/env node
/*
 * The leak guard refuses the licensed bank and lets the repository through.
 *
 *   node tests/verify-leakguard.js
 *
 * Pure Node, no browser, no build. The fixtures below are synthetic — the
 * point of a test for this guard is that it must never need a real export to
 * prove it would catch one.
 *
 * WHY BOTH HALVES MATTER, and the second one more. A guard that refuses
 * everything is as useless as no guard, and worse than no guard, because it
 * gets switched off. So the last block runs the guard over every file git
 * actually tracks — 211 of them — and asserts it refuses none. That is a
 * check against reality rather than against fixtures, and it is what keeps
 * rule 4 honest: eight tracked source files contain `const ALL_Q=` on purpose,
 * being the patch scripts that search for it, and a marker-only rule would
 * have refused all eight.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const GUARD = path.join(__dirname, '..', 'scripts', 'leak-guard.js');
const ROOT = path.join(__dirname, '..');
/* Returns { code, out } — the guard exits 1 and names the rule when it refuses. */
function run(args) {
  try {
    const out = execFileSync(process.execPath, [GUARD, ...args],
      { encoding: 'utf8', cwd: ROOT });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leakguard-'));
const write = (name, body) => { const p = path.join(tmp, name); fs.writeFileSync(p, body); return p; };

head('it refuses the licensed bank, by every route in');
{
  /* 1. PATH — the ordinary case, and the one .gitignore already covers until
     somebody types git add -f. */
  let r = run(['content/questions.json']);
  ok('a path under content/ is refused', r.code === 1 && /PATH/.test(r.out), r.out.match(/PATH.*/)?.[0] || r.out.slice(0, 60));
  r = run(['dist/app.js']);
  ok('and so is one under dist/', r.code === 1 && /PATH/.test(r.out));
  r = run(['tests/last-run.log']);
  ok('and the run log, whose output quotes question text', r.code === 1 && /PATH/.test(r.out));

  /* 2. NAME — the export dragged somewhere unignored. */
  r = run(['assets/ACCSAP_12_super_v12.html']);
  ok('an ACCSAP export is refused wherever it has been moved to',
     r.code === 1 && /NAME/.test(r.out));

  /* 3. SIZE — a figure, or anything else outsized, under a name nobody guessed. */
  const big = write('holiday-photo.bin', Buffer.alloc(1024 * 1024 + 1, 7));
  r = run([big]);
  ok('anything over 1 MB is refused', r.code === 1 && /SIZE/.test(r.out),
     r.out.match(/SIZE.*/)?.[0]?.trim().slice(0, 50));

  /* 4. PAYLOAD — the export renamed to something innocuous and trimmed below
     the size rule. This is the rule that earns its keep. */
  const renamed = write('notes-backup.txt',
    'const ALL_Q=[{"id":"X","q":"?"}' + ','.repeat(250 * 1024) + ']');
  r = run([renamed]);
  ok('the bank renamed and slimmed is still refused', r.code === 1 && /PAYLOAD/.test(r.out));

  /* 5. FIGURES — a figure dump under any name. */
  const figs = write('slides.json',
    'x'.repeat(201 * 1024) + Array(12).fill('data:image/webp;base64,AAAA').join(','));
  r = run([figs]);
  ok('a file full of base64 figures is refused', r.code === 1 && /FIGURES/.test(r.out));

  /* And it says what to do, because a guard that refuses without a remedy is
     a guard somebody deletes. Run fresh rather than reusing `r`: reading the
     previous fixture's output meant this check reported on whatever ran last,
     and when FIGURES stopped firing it failed for a reason that had nothing to
     do with the remedy text. */
  const refused = run(['content/questions.json']);
  ok('the refusal explains the escape hatch',
     /ALLOW in/.test(refused.out) && /public/.test(refused.out));
}

head('and it lets through what it must');
{
  /* The marker alone is not a leak: these are the patch scripts that search
     for it. If this ever fails, rule 4 has lost its size condition. */
  const mentions = write('like-a-patch-script.js',
    "/* looks for */ const RE = /const ALL_Q=\\[/; module.exports = RE;\n");
  let r = run([mentions]);
  ok('a small script that merely mentions the marker is fine', r.code === 0, r.out.trim().slice(0, 70));

  const ordinary = write('ordinary.js', 'module.exports = 1;\n');
  r = run([ordinary]);
  ok('an ordinary source file is fine', r.code === 0);

  /* A file just under each threshold, to show the bounds are bounds. */
  const justUnder = write('just-under.bin', Buffer.alloc(1024 * 1024 - 1, 7));
  r = run([justUnder]);
  ok('a file one byte under the size cap is fine', r.code === 0);
}

head('and it does not refuse this repository');
{
  /* The check against reality. 200-odd real files, including the eight that
     contain the payload marker on purpose. */
  const r = run(['--all-tracked']);
  ok('every tracked file passes', r.code === 0, r.out.trim().slice(0, 70));
  const n = +(r.out.match(/(\d+) file\(s\) checked/) || [, 0])[1];
  ok('and it actually looked at them — not an empty list', n > 100, `${n} files`);
}

head('the hook is wired the way the README says');
{
  const hook = path.join(ROOT, '.githooks', 'pre-commit');
  ok('the pre-commit hook exists', fs.existsSync(hook));
  const src = fs.readFileSync(hook, 'utf8');
  ok('it calls the guard', /leak-guard\.js/.test(src));
  ok('and it says how to turn it on, since cloning does not',
     /core\.hooksPath/.test(src));
  ok('and it is executable', (fs.statSync(hook).mode & 0o111) !== 0);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
