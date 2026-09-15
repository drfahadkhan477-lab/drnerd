#!/usr/bin/env node
/*
 * Refuse to commit the licensed question bank.
 *
 *   node scripts/leak-guard.js                 # whatever is staged
 *   node scripts/leak-guard.js <path>...       # specific files
 *   node scripts/leak-guard.js --all-tracked   # everything git already has
 *
 * WHY .gitignore IS NOT ENOUGH, which is the whole point. content/, build/,
 * dist/ and source/ are ignored, and that holds right up until someone types
 * `git add -f`, or renames an export to something that does not match a
 * pattern, or drags a figure into assets/ because that is where images live.
 * .gitignore is a default, not a boundary; nothing in this repository has
 * been a boundary.
 *
 * What is at stake is not a mess in the history. It is 638 questions and 408
 * figures belonging to the American College of Cardiology, in a public
 * repository, published under the owner's name — and git history is not
 * something you can quietly take back.
 *
 * FIVE RULES, in the order they fire. Each names what it is for, because a
 * guard that refuses without saying why gets disabled the first time it is
 * inconvenient:
 *
 *   1. PATH      anything under content/, build/, dist/ or source/, plus
 *                tests/last-run.log, whose output quotes question text.
 *   2. NAME      an ACCSAP export by its filename, wherever it has been moved.
 *   3. SIZE      anything over 1 MB. The largest file this repository legiti-
 *                mately tracks is 168 KB (lottie.min.js), so there is a factor
 *                of six of headroom before this can be a nuisance.
 *   4. PAYLOAD   `const ALL_Q=[` or `const IMGS={` in a file over 200 KB. The
 *                marker ALONE is not enough and must not be: eight tracked
 *                source files contain it on purpose — the patch scripts that
 *                search for it, and the tests that assert they found it. Size
 *                is what separates a script that mentions the bank from the
 *                bank. This is the rule that catches a renamed export.
 *   5. FIGURES   many base64 image payloads in one file over 200 KB, which is
 *                a figure dump whatever it has been called.
 *
 * THE ESCAPE HATCH IS TYPED, ONCE, PER PATH. Same bargain as PENDING_RECORD in
 * scripts/verify.js: a blanket --force would be used the first time rule 3
 * fired on something innocent and never removed. ALLOW below is a list a
 * person edits with a reason attached.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MAX_BYTES     = 1024 * 1024;
const SNIFF_BYTES   = 200 * 1024;
/* Rules 4 and 5 only ever run on files BETWEEN the sniff floor and the size
   cap, so the most they can read is 1 MB and reading it whole costs nothing.
   The first version read a 64 KB head instead, on the reasoning that a marker
   would be near the top — and the test caught that it need not be. A figure
   dump behind 200 KB of preamble sailed through, and so would an export whose
   `const ALL_Q=` sits after the embedded fonts, which in the real build it
   does. The head window was protecting against reading a 40 MB export, and
   rule 3 already refuses that before these rules are reached. */

const DIRS  = ['content/', 'build/', 'dist/', 'source/'];
const FILES = ['tests/last-run.log'];
const NAME  = /ACCSAP|_super_v\d|question-bank|questions\.json$/i;
const PAYLOAD = /const\s+(ALL_Q\s*=\s*\[|IMGS\s*=\s*\{)/;
const B64IMG  = /data:image\/(?:webp|jpeg|png|gif);base64,/g;
const B64_MANY = 8;

/* Paths a person has decided are fine, with the reason. Nothing is here yet;
   when something is, it should say why on the same line. */
const ALLOW = [
  // 'tests/fixtures/big-thing.json',   // synthetic, contains no licensed text
];

function staged() {
  try {
    return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'],
      { encoding: 'utf8' }).split('\n').map(s => s.trim()).filter(Boolean);
  } catch (_) { return []; }
}
function tracked() {
  try {
    return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
      .split('\n').map(s => s.trim()).filter(Boolean);
  } catch (_) { return []; }
}

function inspect(file) {
  const p = file.split(path.sep).join('/');
  if (ALLOW.includes(p)) return null;

  if (DIRS.some(d => p.startsWith(d)))
    return { rule: 'PATH', why: `${p.split('/')[0]}/ is licensed content and is never committed` };
  if (FILES.includes(p))
    return { rule: 'PATH', why: 'its output quotes question text' };
  if (NAME.test(path.basename(p)))
    return { rule: 'NAME', why: 'the filename is an ACCSAP export, wherever it has been moved to' };

  let st;
  try { st = fs.statSync(file); } catch (_) { return null; }   /* staged-then-deleted */
  if (!st.isFile()) return null;

  if (st.size > MAX_BYTES)
    return { rule: 'SIZE', why: `${(st.size / 1048576).toFixed(1)} MB — nothing here legitimately exceeds 1 MB` };
  if (st.size <= SNIFF_BYTES) return null;

  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return null; }

  if (PAYLOAD.test(text))
    return { rule: 'PAYLOAD', why: 'it carries the question bank, not a reference to it' };
  if ((text.match(B64IMG) || []).length >= B64_MANY)
    return { rule: 'FIGURES', why: 'it is a figure dump, whatever it has been called' };
  return null;
}

const argv = process.argv.slice(2);
const files = argv.includes('--all-tracked') ? tracked()
            : argv.filter(a => !a.startsWith('--')).length ? argv.filter(a => !a.startsWith('--'))
            : staged();

const hits = [];
for (const f of files) { const h = inspect(f); if (h) hits.push({ file: f, ...h }); }

if (!hits.length) {
  if (!argv.includes('--quiet')) console.log(`leak-guard: ${files.length} file(s) checked, nothing licensed`);
  process.exit(0);
}
console.error(`\nleak-guard: refusing ${hits.length} file(s)\n`);
for (const h of hits) console.error(`  ${h.rule.padEnd(8)} ${h.file}\n           ${h.why}`);
console.error(`
This repository is public and the question bank is not yours to publish.
git history is not something you can quietly take back.

If one of these is genuinely safe, add its exact path to ALLOW in
scripts/leak-guard.js with a comment saying why — deliberately one line of
typing per path, so it cannot become a habit.
`);
process.exit(1);
