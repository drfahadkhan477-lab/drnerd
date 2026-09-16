#!/usr/bin/env node
/*
 * The constraints of the device this app is actually for, checked without one.
 *
 *   node tests/verify-ipad-pure.js
 *
 * Pure Node, no browser, no build. Every check here is a fact about the text
 * of the source, which is the only reason they can run in CI at all.
 *
 * WHY THIS FILE EXISTS. Systole is used on an iPad. The suite runs on
 * Chromium. Everything in between — a syntax Safari cannot parse, a property
 * Safari needs a prefix for — is invisible to it, and both of the rules below
 * are here because the project has already been bitten and wrote the episode
 * down beside the fix:
 *
 *   · pearl.js: "One unsupported character silently took out everything on an
 *     older tablet, and nothing in the suite would have said so, because the
 *     suite runs on Chromium."
 *   · pearlcard-patch.js: "three were written with the unprefixed property
 *     alone and simply do not blur on an iPad — the navigation bar, the figure
 *     lightbox and the Rhythm Lab readout."
 *
 * Both were fixed. Neither was made impossible to reintroduce in a way CI
 * could see, which is what this is.
 *
 * READS THE COMMENT-BLANKED SOURCE. Defensively rather than because anything
 * trips today — checked, not assumed: no comment in src/ contains a literal
 * `(?<=`, so blanking changes no result here and removing it was proven to
 * change none either. It stays because the hazard is structural: the files
 * this scans explain at length why they avoid the thing being scanned for,
 * and the first comment to quote the syntax rather than describe it would
 * otherwise be reported as a violation. Cheap now, correct later.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');
const blanked = p => blankComments(fs.readFileSync(p, 'utf8'));

/* Everything under src/ is embedded into the app verbatim by the chain, so
   every character of it is parsed by Safari. */
const SRC_FILES = walk(path.join(ROOT, 'src'));
head('the scan has something to scan');
{
  /* Vacuity guard. Every check below is "count the hits and expect zero",
     which is also what a walk over an empty list returns — the failure mode
     this project produces more than any other. */
  ok('src/ files were found', SRC_FILES.length > 5, `${SRC_FILES.length} files`);
  ok('and every one of them is a file with code in it',
     SRC_FILES.every(f => blanked(f).trim().length > 40));
  ok('and blanking leaves the code behind',
     /function\s|const\s/.test(blanked(path.join(ROOT, 'src', 'core', 'pearl.js'))));
}

head('nothing in src/ ships a regex lookbehind');
{
  /* A lookbehind is a parse-time SyntaxError on iPadOS Safari below 16.4 — not
     a caught exception but a dead <script> block, and in this app that block
     holds the rhythm registry, the scheduler and most of the rest. One
     character costs an older tablet the application.

     verify-apex already asserts this against the BUILT BUNDLE, which is
     stronger — it covers whatever the chain emits, including the ACCSAP base.
     It also needs a build and a browser, so it runs on one machine, when
     someone remembers. This is the same rule where it can run on every push,
     over the files whose every character is embedded verbatim. Narrower and
     immediate; that one stays broader and occasional. */
  const hits = [];
  for (const f of SRC_FILES) {
    const m = blanked(f).match(/\(\?<[=!]/g);
    if (m) hits.push(`${rel(f)} ×${m.length}`);
  }
  ok('no lookbehind assertion in any src/ module', hits.length === 0, hits.join(', '));
}

/* ── WHY THE backdrop-filter RULE IS NOT HERE ──────────────────────────────
   iPadOS Safari shipped backdrop-filter behind -webkit- until Safari 18, and
   three of this app's nine glass surfaces once carried the plain property
   alone and simply did not blur on the one device this is for. That is a real
   rule and it belongs in a test. It was written here first, and taken out,
   because a source-level version cannot be honest:

   1. THE CSS LIVES IN PATCH SCRIPTS, AND A PATCH HOLDS BOTH STATES. The fix
      itself reads

          patch('safari: the navigation bar blurs on an iPad too',
            `…backdrop-filter:blur(8px);`,                          // find: BEFORE
            `…backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);`);

      so a scan over the file text counts the unprefixed "before" as a live
      declaration and reports the fix as the defect. Every mismatch the first
      version found was one of these.

   2. READING ONLY THE REPLACEMENTS DOES NOT REACH FAR ENOUGH. Extracting the
      third argument of each patch() call captures 541 of 678 — the rest use
      shapes a regex over template literals does not follow. A rule that
      silently skips a fifth of the files and prints PASS is worse than no
      rule, because the green reads as coverage of all of them.

   So it is asserted against the BUILT BUNDLE in verify-apex instead, beside
   the lookbehind check, where there is no before-state and no extraction: the
   text is the CSS that ships. That costs a build and a browser, which is the
   honest price of a check that is actually exact.

   The lookbehind rule above survives here because src/ has neither problem —
   every character of it is embedded verbatim, so the file text IS the shipped
   text. Same constraint, same device; one can be checked cheaply and one
   cannot, and pretending otherwise is the failure this repository keeps
   finding in itself. */

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
