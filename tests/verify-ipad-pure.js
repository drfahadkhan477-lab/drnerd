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

/* Everything under src/ is embedded into the app by the chain, so every
   character of it is parsed by Safari.

   NOT QUITE "VERBATIM", WHICH IS WHAT THIS SAID. Measured: at least eight
   patch steps rewrite text that lives in src/ — three of them inside
   src/core/vision.js alone, which is why that file still reads
   {anthropic:true, groq:false} while the app ships {gemini:true}. The
   direction of the error is safe for the rule below, since a line the chain
   later replaces is still scanned, but the claim was wider than the check:
   syntax a PATCH introduces is invisible here, and the comment implied
   otherwise. The bundle-level version in verify-apex is the one that covers
   that, and it needs a build. */
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

/* ── the floor, written down once and held to ───────────────────────────────
   THE PROJECT NEVER SAID WHICH iPadOS IT SUPPORTS. It defends against a
   lookbehind because that is a SyntaxError "below Safari 16.4", which fixes
   the ceiling of the problem and leaves the floor unstated — so whether `?.`
   (13.1) or crypto.randomUUID (15.4) was allowed had to be re-decided, by
   feel, every time it came up.

   IT IS NOT A PREFERENCE, IT IS ALREADY DECIDED. The shipped app uses optional
   chaining and ?? in six patch replacements — heartreuse, heroart, polish,
   calibrate, gemini and mistral — and both landed in Safari 13.1, which is
   iPadOS 13.4. Nothing can lower the floor below that without those going
   first. So 13.4 is not chosen here; it is read off the code and written down.

   WHAT THIS CHECKS IS THE CEILING ON NEW WORK. Everything below shipped AFTER
   Safari 13.4, so any of it appearing in src/ would raise the floor silently.
   Each one is the kind of thing that gets reached for without thinking —
   .at(-1) instead of [len-1], structuredClone instead of a JSON round trip —
   and none of them announces that it has just dropped support for a tablet.

   FEATURE-GUARDED USE IS NOT A FLOOR, and the app already does this properly:
   ResizeObserver is behind `typeof ResizeObserver!=='undefined'` with a resize
   listener as the fallback, and startViewTransition is guarded four times in
   failsafe-patch. Those are not caught here because they are not in src/;
   if one appears here it will be flagged, and a guard around it is the fix. */
const FLOOR = '13.4';
const ABOVE_FLOOR = [
  ['Array.prototype.at', /\.at\(\s*-?\d/, 'Safari 15.4'],
  ['Object.hasOwn', /\bObject\.hasOwn\s*\(/, 'Safari 15.4'],
  ['Array.prototype.findLast', /\.findLast(?:Index)?\s*\(/, 'Safari 15.4'],
  ['structuredClone', /\bstructuredClone\s*\(/, 'Safari 15.4'],
  ['crypto.randomUUID', /\bcrypto\.randomUUID\b/, 'Safari 15.4'],
  ['logical assignment (||= &&= ??=)', /(?:\|\||&&|\?\?)=[^=]/, 'Safari 14'],
  ['Promise.any', /\bPromise\.any\s*\(/, 'Safari 14'],
  ['Intl.RelativeTimeFormat', /\bIntl\.RelativeTimeFormat\b/, 'Safari 14'],
  ['AbortSignal.timeout', /\bAbortSignal\.timeout\b/, 'Safari 16'],
  ['Array.prototype.group', /\.group(?:By)?\s*\(/, 'Safari 17.4'],
];

/* WHAT SAFARI ACTUALLY PARSES, which is not all of src/. src/worker/apex.js
   is the Cloudflare Worker that holds the Gemini key: build-pwa.js writes it
   out as _worker.js at the root of the upload, where Cloudflare runs it, and
   it is never embedded into the HTML the iPad loads. Holding it to Safari's
   floor would be holding server code to a browser's limits — it uses
   AbortSignal.timeout quite legitimately.

   THE EXCLUSION IS ASSERTED, NOT ASSUMED, below: if that file ever starts
   being embedded into the bundle, the check that says it is not will fail
   before this list silently stops covering it. */
const SAFARI_FILES = SRC_FILES.filter(f => !/[\\/]worker[\\/]/.test(f));

head('the worker is server code, and is excluded on that basis');
{
  ok('src/ has a worker to exclude', SRC_FILES.length - SAFARI_FILES.length === 1,
     `${SRC_FILES.length - SAFARI_FILES.length} excluded`);
  const pwa = fs.readFileSync(path.join(ROOT, 'scripts', 'build-pwa.js'), 'utf8');
  ok('build-pwa writes it out as its own file, not into the bundle',
     /_worker\.js/.test(pwa) && /'worker',\s*'apex\.js'/.test(pwa));
  ok('and no patch step embeds it into the app',
     fs.readdirSync(path.join(ROOT, 'scripts'))
       .filter(n => /-patch\.js$/.test(n))
       .every(n => !/worker[\\/]apex/.test(fs.readFileSync(path.join(ROOT, 'scripts', n), 'utf8'))));
  ok('so what Safari parses is the rest', SAFARI_FILES.length > 5, `${SAFARI_FILES.length} files`);
}

head(`nothing Safari parses needs a Safari newer than the floor (iPadOS ${FLOOR})`);
{
  const hits = [];
  for (const f of SAFARI_FILES) {
    const src = blanked(f);
    for (const [name, re, since] of ABOVE_FLOOR) {
      const g = new RegExp(re.source, 'g');
      const n = (src.match(g) || []).length;
      if (n) hits.push(`${rel(f)}: ${name} ×${n} (${since})`);
    }
  }
  ok('no construct that arrived after the floor', hits.length === 0, hits.join('; ') || 'none');
  /* Vacuity guard, and a real one: the list above is only worth anything if
     its patterns match the thing they name. A typo'd regex matches nothing and
     the check passes forever. */
  const fixture = 'a.at(-1); Object.hasOwn(o,"k"); structuredClone(x); ' +
                  'crypto.randomUUID(); let z; z ||= 1; Promise.any([]); ' +
                  'new Intl.RelativeTimeFormat(); AbortSignal.timeout(1); ' +
                  'xs.findLast(f); xs.groupBy(f);';
  const matched = ABOVE_FLOOR.filter(([, re]) => re.test(fixture));
  ok('and every pattern in the list can actually match',
     matched.length === ABOVE_FLOOR.length,
     `${matched.length} of ${ABOVE_FLOOR.length}` +
     (matched.length === ABOVE_FLOOR.length ? ''
       : ' — missed: ' + ABOVE_FLOOR.filter(x => !matched.includes(x)).map(x => x[0]).join(', ')));
}

head('and the floor is written down where somebody will find it');
{
  /* Prose follows the record here too. A floor that lives only in this file is
     a floor nobody reading the README knows about, and a floor in the README
     alone is one that drifts. */
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const m = readme.match(/\*\*iPadOS (\d+\.\d+) or newer\.\*\*/);
  ok('README states a minimum iPadOS', !!m, m ? m[1] : 'no such sentence');
  ok('and it is the same floor this file checks against',
     !!m && m[1] === FLOOR, m ? `README ${m[1]} vs ${FLOOR}` : '—');
  /* \s+ RATHER THAN A SPACE. The first version matched /optional chaining/ and
     went red on a README that says exactly that — markdown hard-wraps, the
     phrase straddles a line break, and the check was testing the column width
     of a paragraph rather than its content. */
  ok('and it says why, rather than only what',
     /optional\s+chaining/.test(readme) && /<script>/.test(readme));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
