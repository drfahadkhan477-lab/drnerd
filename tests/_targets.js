'use strict';
/*
 * Which suites can be pointed at a URL, and which can only be given a path.
 *
 * WHY THIS IS NOT OBVIOUS FROM THE ARGUMENT. Every suite takes one target and
 * most turn it into a page URL the same way:
 *
 *     const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);
 *
 * so the presence of that line looks like the answer. It is not. THREE suites
 * have that exact line and ALSO read the target off disk, later, as text — to
 * grep the built document for something a rendered page cannot show:
 *
 *     verify-apex.js:403         const src = require('fs').readFileSync(target, 'utf8');
 *     verify-splash.js
 *     verify-splash-heart.js
 *
 * Handed a URL, those do not refuse. apex threw ENOENT and reported nothing.
 * splash-heart was worse: it swallowed the read and finished GREEN with eight
 * checks where it has fourteen, which is the failure mode this file exists to
 * prevent. A suite that quietly runs half of itself is indistinguishable from
 * one that passed.
 *
 * THE RULE, THEREFORE, IS ABOUT THE TARGET AND NOT ABOUT THE GUARD: a suite
 * can take a URL when it has the guard AND never hands its target to the
 * filesystem. Both halves are read from the suite's own source, because a
 * hardcoded list would be wrong the first time somebody converts a suite and
 * right nowhere in between.
 *
 * CONSERVATIVE BY CONSTRUCTION. Anything this cannot classify — a suite that
 * binds its target in a shape not seen here, or aliases it to a second name —
 * comes back incapable with a reason. Being wrongly excluded costs a suite
 * that has to be run against a file; being wrongly included costs a green run
 * that tested less than it said. Those are not the same mistake.
 *
 * tests/verify-engine.js holds this to ground truth: suites whose behaviour
 * against a URL was actually observed, asserted by name, so a change to the
 * matching below fails against reality rather than against itself.
 */
const fs = require('fs');
const path = require('path');

const SUITE_DIR = __dirname;
const suitePath = name => path.join(SUITE_DIR, `verify-${name}.js`);

/* The identifier a suite binds its target argument to — `target` everywhere
   today, but read rather than assumed. */
/* Wrapped forms count too — verify-pages.js writes
   `const DIST = path.resolve(process.argv[2] || …)`, which is still a suite
   taking a target, and reporting it as taking none would hide it behind the
   pure-logic suites that genuinely take none. It has no URL guard, so it is
   excluded for that reason instead, which is the true one. */
const ARGV = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=[^;\n]*process\.argv\[2\]/;
/* The line that makes a URL pass through untouched instead of being resolved
   as a path. Matched on `^https?:` because that is the anchor every one of
   them writes, whatever the variable is called around it. */
const GUARD = /\^https\?:/;

/* Comments are not code. This file's own prose quotes the shapes it matches,
   and so does verify-engine.js's section about it; scanning the raw text finds
   those and classifies a suite by its documentation. */
/* Blanked rather than stripped — see tests/_source.js. Removing a comment
   shifts every index after it, which does not matter to the patterns below
   but makes this the fifth local copy of a thing that is now in one place. */
const { blankComments } = require('./_source.js');
const stripComments = blankComments;

function classifySource(raw) {
  const src = stripComments(raw);
  const m = src.match(ARGV);
  if (!m) return { capable: false, reason: 'takes no target argument' };
  const id = m[1];

  if (!GUARD.test(src)) {
    return { capable: false, reason: 'no URL guard — it resolves its target as a path' };
  }
  /* fs.readFileSync(target) and require('fs').readFileSync(target) both. */
  const readsTarget = new RegExp(
    `(?:fs|require\\(\\s*['"]fs['"]\\s*\\))\\s*\\.\\s*\\w*Sync\\s*\\(\\s*${id}\\b`);
  if (readsTarget.test(src)) {
    return { capable: false, reason: `reads ${id} from disk as text` };
  }
  /* An alias would defeat the check above without looking like anything. No
     suite does this today; if one starts, it is excluded rather than trusted. */
  const alias = new RegExp(`(?:const|let|var)\\s+[A-Za-z_$][\\w$]*\\s*=\\s*${id}\\s*;`);
  if (alias.test(src)) {
    return { capable: false, reason: `aliases ${id}, so a disk read cannot be ruled out` };
  }
  return { capable: true, reason: '' };
}

function classify(name) {
  let src;
  try { src = fs.readFileSync(suitePath(name), 'utf8'); }
  catch (_) { return { capable: false, reason: 'suite not found' }; }
  return classifySource(src);
}

const takesUrl = name => classify(name).capable;

/* Every suite on disk, for the checks that assert over the whole set. */
function allSuiteNames() {
  return fs.readdirSync(SUITE_DIR)
    .filter(f => /^verify-.+\.js$/.test(f))
    .map(f => f.replace(/^verify-|\.js$/g, ''))
    .sort();
}

/* ── which suites CI can run at all ──────────────────────────────────────────
   .github/workflows/verify.yml names every suite it runs as its own step, and
   scripts/verify.js has its own registry of seventy. Two lists, maintained
   separately, and they had already drifted: verify-cause-pure was registered,
   passed 32 checks, needed no browser, and the workflow had never heard of it.
   Nineteen green steps read as "the logic suites pass".

   So the workflow is held to this instead of to memory. A suite can run in CI
   when it needs no browser and no built app:

     · no browser — neither it nor any repo script it spawns reaches Playwright
     · no build   — it does not take a target as process.argv[2]

   ONE LEVEL OF SPAWNING IS FOLLOWED, and that is not arbitrary: it is the
   depth the repository actually uses. verify-figprobe requires nothing from
   Playwright and launches a browser anyway, through
   tools/figure-probe.js — so reading its requires alone classifies it as
   CI-able, and CI has no browser in that job. verify-leakguard spawns too, to
   scripts/leak-guard.js and to git, and neither reaches a browser, so it stays
   correctly included. Depth one tells those two apart; nothing here needs two.

   CONSERVATIVE IN THE DIRECTION THAT MATTERS, like classify() above. A suite
   wrongly excluded costs a check CI does not run, which someone notices the
   next time the registry is read. A suite wrongly INCLUDED costs a red
   workflow, or worse a green one that launched nothing and measured nothing.
   Those are not the same mistake.

   MEASURED, NOT ASSUMED. The first version of this matched
   require('./_engine') without allowing the .js extension, and verify-render
   and verify-csp — which both write require('./_engine.js') — came back
   CI-able. Together with figprobe that was three false positives out of five,
   and all three would have gone into a workflow with no browser in it. */
/* PATH-AGNOSTIC ON PURPOSE. This matched `./_engine` with an optional `.js`
   and nothing else, which is how verify-render and
   verify-csp slipped through writing `./_engine.js`, and how
   tools/figure-probe.js slipped through writing `../tests/_engine.js`. The
   question is whether a file reaches the engine module, not how it spells the
   way there, so the prefix is no longer part of the question. */
const NEEDS_ENGINE = /require\(\s*['"][^'"]*\b_engine(?:\.js)?['"]\s*\)|require\(\s*['"]playwright['"]\s*\)/;

/* A spawn of another node script in this repository, as
   execFile(process.execPath, [path.join(__dirname, '..', 'tools', 'x.js'), …]).
   The quoted segments of the first array element are the path. */
const SPAWN = /(?:execFile|execFileSync|spawn|spawnSync)\s*\(\s*process\.execPath\s*,\s*\[([^\]]*)\]/g;
/* A require of another file in this repository, by relative path. */
const REQ = /require\(\s*['"](\.[^'"]*\.js)['"]\s*\)/g;

/* Every repo file a suite reaches directly — spawned or required. Both, because
   a browser can be reached either way and the repository does both:
   verify-figprobe SPAWNS tools/figure-probe.js, and verify-figaudit REQUIRES
   tools/figure-audit.js. Resolved against the file doing the reaching, not
   against tests/, or a tool's own '../tests/…' would point outside the repo. */
function reaches(file, src) {
  const dir = path.dirname(file);
  const out = [];
  for (const m of src.matchAll(SPAWN)) {
    const first = m[1].split(',').slice(0, 5).join(',');
    const parts = [...first.matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]);
    if (!parts.length) continue;
    const guess = path.resolve(dir, parts.join(path.sep));
    if (fs.existsSync(guess)) out.push(guess);
  }
  for (const m of src.matchAll(REQ)) {
    const guess = path.resolve(dir, m[1]);
    if (fs.existsSync(guess)) out.push(guess);
  }
  return out;
}

function runsInCI(name) {
  let src;
  try { src = stripComments(fs.readFileSync(suitePath(name), 'utf8')); }
  catch (_) { return { able: false, reason: 'suite not found' }; }
  if (NEEDS_ENGINE.test(src)) return { able: false, reason: 'needs a browser' };
  if (ARGV.test(src)) return { able: false, reason: 'needs a built app as its target' };
  const root = path.join(SUITE_DIR, '..');
  const rel = p => path.relative(root, p).split(path.sep).join('/');
  for (const p of reaches(suitePath(name), src)) {
    /* Not another suite's helper: _source, _targets and _fakeweb are required
       by everything and reach nothing, and following into tests/_engine.js
       itself would exclude verify-engine, whose whole job is to test it
       without launching it. Only tools/ and scripts/ are followed, which is
       where the two real cases live. */
    if (!/^(tools|scripts)\//.test(rel(p))) continue;
    let child;
    try { child = stripComments(fs.readFileSync(p, 'utf8')); } catch (_) { continue; }
    if (NEEDS_ENGINE.test(child)) {
      return { able: false, reason: `reaches ${rel(p)}, which needs a browser` };
    }
  }
  return { able: true, reason: '' };
}

module.exports = { classify, classifySource, takesUrl, allSuiteNames, runsInCI };
