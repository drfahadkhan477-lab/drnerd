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
const stripComments = src => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

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

module.exports = { classify, classifySource, takesUrl, allSuiteNames };
