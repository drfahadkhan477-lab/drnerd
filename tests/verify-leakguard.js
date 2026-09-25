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
 * actually tracks — it said 211 here while the number was 240 — and asserts it
 * refuses none. No count on purpose now: it moves with every file added, and
 * an unguarded number in a comment is the thing CLAUDE.md says not to write.
 * That is a check against reality rather than against fixtures, and it keeps
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

  /* AND graphify-out/, WHICH CAN BE MADE OF THE CORPUS. `graphify` writes a
     knowledge graph there over whatever it indexed. Its walker respects
     .gitignore by default, so a default run over this repository skips
     content/, build/, dist/ and source/ — an earlier version of this comment
     said otherwise and was wrong. The exposure is the opt-out: `--no-gitignore`
     is one flag, and a .graphifyignore is read regardless of it and can
     re-include a path by itself. Either route puts node labels and excerpts of
     the licensed question text under a name that advertises none of it. Every
     rule in the guard used to look past it: not a licensed path, no verify header, the
     NAME regex does not match `graph.json`, and a graph of one subdirectory
     sits under rule 3's 1 MB cap and under the 200 KB floor rules 4 and 5
     need before they look. Proven before the rule existed — the guard printed
     "nothing licensed" and exited 0.

     The second assertion is why DERIVED carries a trailing slash. Without it
     the prefix test matches any name merely beginning "graphify", and a file
     called graphify-outline.md would be refused for no reason — a guard that
     over-refuses is the kind that gets switched off. Proven by setting DERIVED
     to ['graphify']: that assertion went red and the one above stayed green. */
  r = run(['graphify-out/graph.json']);
  ok('and a graphify graph, which is built from the corpus', r.code === 1 && /PATH/.test(r.out), r.out.match(/PATH.*/)?.[0] || r.out.slice(0, 60));
  r = run(['graphify-outline.md']);
  ok('but not a file that merely starts with the same letters', r.code === 0);

  /* 1b. LOG — THE SAME LOG UNDER ANOTHER NAME, which is how this rule came
     to exist. `node scripts/verify.js > 1.txt` is the obvious thing to type,
     and what it writes is byte-for-byte what last-run.log holds. One sat
     untracked in the owner's checkout for eight days: not in a licensed
     directory, not an ACCSAP filename, and a failing run's log is under both
     the 1 MB cap and the 200 KB floor the payload rules need before they
     will look at anything. Every rule in the file walked past it.

     The body here is the real header and nothing else — a fixture that
     quoted question text to prove a guard against quoting question text
     would be its own kind of joke. The header is what is recognised. */
  const LOGHEAD = '# systole verify \u2014 2026-09-11T07:45:02.389Z\n'
                + '# checkout  claude/x @ 99f7a13\n# engine    webkit\n';
  r = run([write('1.txt', LOGHEAD)]);
  ok('a verify log saved as 1.txt is refused', r.code === 1 && /LOG/.test(r.out),
     r.out.match(/LOG.*/)?.[0] || r.out.slice(0, 60));
  r = run([write('notes.md', LOGHEAD)]);
  ok('and under any other name, since the name is not what is read',
     r.code === 1 && /LOG/.test(r.out));
  /* BELOW EVERY SIZE FLOOR IN THE FILE, which is the point: rules 3, 4 and 5
     would all have declined to look. */
  ok('even though it is far too small for the payload rules to examine',
     LOGHEAD.length < 200 * 1024);
  /* AND IT IS THE HEADER, NOT THE WORD. A file that merely mentions the
     runner must not be refused, or the rule becomes a nuisance and gets
     turned off — which is what this file's header says about guards. */
  r = run([write('about-verify.md', 'Notes on systole verify and what it writes.\n')]);
  ok('while prose that merely mentions the runner is not refused', r.code === 0,
     r.out.trim().slice(0, 60));
  r = run([write('later-line.md', 'intro\n# systole verify \u2014 2026-01-01T00:00:00.000Z\n')]);
  ok('and the header only counts on the first line, where verify.js writes it',
     r.code === 0, r.out.trim().slice(0, 60));

  /* 6. PACK — the owner's textbook, by way of Memorizer's study pack
     (memorizer/src/pack.js). Both fixtures are made here by pack.js itself,
     from a two-line synthetic unit, so what is recognised is what the app
     really writes and no book is involved. */
  const Pack = require(path.join(ROOT, 'memorizer', 'src', 'pack.js'));
  const unit = { id: 'u', name: 'Unit', clusters: [{ title: 'One', pageStart: 1, pageEnd: 1, segments: [{ text: 'A synthetic sentence.', page: 1 }] }] };
  r = run([write('prompt-for-claude.txt', Pack.prompt(unit))]);
  ok('a Memorizer prompt, which carries the book\u2019s text and the pack\u2019s shape, is refused', r.code === 1 && /PACK/.test(r.out), r.out.match(/PACK.*/)?.[0] || r.out.slice(0, 60));
  const reply = JSON.stringify({ format: Pack.FORMAT, version: Pack.VERSION, unit: 'Unit', sections: [Pack.EXAMPLE] }, null, 2);
  r = run([write('chapter-7.json', reply)]);
  ok('and so is the pack Claude writes back, under any name', r.code === 1 && /PACK/.test(r.out));
  r = run([write('reply.md', 'Here is reply 1.\n```json\n' + JSON.stringify({ format: Pack.FORMAT, sections: [] }) + '\n```\n')]);
  ok('in a code fence, compact, with prose around it', r.code === 1 && /PACK/.test(r.out));
  r = run([path.join(ROOT, 'memorizer', 'src', 'pack.js'), path.join(ROOT, 'tests', 'verify-memorizer-pack-pure.js')]);
  ok('while the code that names the format is not refused', r.code === 0, r.out.trim().slice(0, 80));
  r = run([write('pack-notes.md', 'Notes on the memorizer-pack format, and its "format" key.\n')]);
  ok('nor prose that mentions it', r.code === 0, r.out.trim().slice(0, 60));

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

  /* AND FIGURES HAS NO FLOOR OF ITS OWN, unlike PAYLOAD above it. The fixture
     above is padded past 201 KB to also clear PAYLOAD's floor, which proved
     FIGURES works — not that it works WITHOUT that floor. This one is the
     real case: eight images, no padding, nowhere near 200 KB, in a file whose
     name gives nothing away. Before FIGURES had its own check ahead of
     PAYLOAD_SNIFF_BYTES, this returned code 0 — "nothing licensed" — because
     `st.size <= SNIFF_BYTES` sent it home before either rule looked. */
  const smallFigs = write('notes.js',
    Array(8).fill('const x = "data:image/png;base64,' + 'A'.repeat(200) + '";').join('\n'));
  ok('the small fixture really is under the old shared floor',
     fs.statSync(smallFigs).size < 200 * 1024, fs.statSync(smallFigs).size + ' bytes');
  r = run([smallFigs]);
  ok('a small figure dump is refused too, not just a large one',
     r.code === 1 && /FIGURES/.test(r.out), r.out.match(/FIGURES.*/)?.[0] || r.out.trim().slice(0, 60));

  /* AND IT STILL TAKES EIGHT. A couple of screenshots pasted into a small
     note is not a figure dump, and must not become unreviewable because
     FIGURES lost its floor. */
  const fewFigs = write('two-shots.js',
    Array(2).fill('const x = "data:image/png;base64,' + 'A'.repeat(200) + '";').join('\n'));
  r = run([fewFigs]);
  ok('but two embedded images in a small file are still fine', r.code === 0, r.out.trim().slice(0, 60));

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

head('the knowledge graph cannot read what leak-guard refuses');
{
  /* graphify reads .gitignore and then .graphifyignore — and under
     `--no-gitignore` it reads .graphifyignore ALONE. So .gitignore listing
     the corpus protects the default run and nothing else; the flag that
     would walk the licensed export into a graph is precisely the case where
     only this file counts.

     Derived from leak-guard's OWN lists rather than retyped, so a directory
     added to the guard is a directory this file must name, and the two
     cannot drift apart. */
  const GUARD_SRC = fs.readFileSync(GUARD, 'utf8');
  const listOf = name => {
    const m = new RegExp('const ' + name + '\\s*=\\s*\\[([^\\]]*)\\]').exec(GUARD_SRC);
    return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : null;
  };
  const required = [].concat(listOf('DIRS') || [], listOf('DERIVED') || [], listOf('FILES') || []);
  /* Vacuity guard: an empty required list would make "all present" true. */
  ok('leak-guard\'s path lists were found and are not empty',
     required.length >= 5 && required.includes('content/'), required.join(' '));
  const giPath = path.join(ROOT, '.graphifyignore');
  const gi = fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf8') : '';
  ok('.graphifyignore exists', gi.length > 0);
  /* Lines that are live patterns, with comments and blanks dropped the way
     graphify's own parser drops them. */
  const live = gi.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const missing = required.filter(p => !live.includes(p));
  ok('it names every path leak-guard refuses, so --no-gitignore stays safe',
     missing.length === 0, missing.join(', ') || `${required.length} paths`);
  /* And it re-includes none of them. A `!content/` line would undo the entry
     above it by last-match-wins — the one way this file could make things
     worse than having no file at all. */
  const reincluded = live.filter(l => l.startsWith('!') &&
    required.some(p => l.slice(1).replace(/^\//, '').startsWith(p.replace(/\/$/, ''))));
  ok('and none of them is re-included by a negation', reincluded.length === 0,
     reincluded.join(', ') || 'none');
}

head('the hook is wired the way the README says');
{
  const hook = path.join(ROOT, '.githooks', 'pre-commit');
  ok('the pre-commit hook exists', fs.existsSync(hook));
  const src = fs.readFileSync(hook, 'utf8');
  ok('it calls the guard', /leak-guard\.js/.test(src));
  ok('and it says how to turn it on, since cloning does not',
     /core\.hooksPath/.test(src));
  /* ASKS GIT, NOT THE FILESYSTEM. This read fs.statSync(hook).mode & 0o111,
     which is the Unix executable bit — a thing NTFS does not have. Node reports
     0o666 for every file on Windows, so the check could not pass there however
     correct the repository was, and it failed every run on the owner's laptop.

     It was also asking the wrong question on Linux. What makes a hook
     executable in someone else's clone is the mode GIT RECORDS (100755), not
     the mode this checkout happens to have — a Windows checkout has no bit and
     the Unix clone made from the same commit still does. So the property that
     travels is the one in the index, and it is the same answer on every
     platform. */
  const mode = (() => {
    try {
      return execFileSync('git', ['ls-files', '-s', '.githooks/pre-commit'],
                          { cwd: ROOT, encoding: 'utf8' }).trim().split(/\s+/)[0];
    } catch (_) { return ''; }
  })();
  ok('git records it as executable, so a fresh clone can run it',
     mode === '100755', mode || 'git could not be asked');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
