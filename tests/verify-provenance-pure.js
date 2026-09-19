#!/usr/bin/env node
/*
 * A split build says which build it is, and refuses to be half of two.
 *
 *   node tests/verify-provenance-pure.js
 *
 * No browser, no build, no licensed export — this reads scripts/build-pwa.js
 * and scripts/extract-content.js as text and drives the one function that can
 * be lifted out.
 *
 * ── WHAT THIS IS ABOUT ────────────────────────────────────────────────────
 *
 * The split build is assembled from TWO inputs that are produced by two
 * different commands:
 *
 *     scripts/build.js            → build/systole.html
 *     scripts/extract-content.js  → content/            (from that html)
 *     scripts/build-pwa.js        → dist/               (from both)
 *
 * build-pwa.js used to check only that content/ EXISTED. So rebuilding
 * build/systole.html and splitting it again — without re-running the extract
 * in between — produced a dist/ whose index.html and app.js were the new
 * build and whose questions.json and 408 figures were the old one.
 *
 * AND EVERY GUARD DOWNSTREAM STILL AGREED. BUILD_ID is computed fresh in the
 * split run and stamped into all three files, so verify-pwa's "all three are
 * the same build" passes on a dist/ whose bank is from a different extraction
 * entirely. That is the shape this repository keeps producing: green that
 * covers the paragraph beside the one with the hole in it.
 *
 * docs/IPAD.md printed exactly that two-command sequence. It is right on a
 * clean checkout, where content/ does not exist yet, and wrong every time
 * after.
 *
 * ── AND WHICH COMMIT ──────────────────────────────────────────────────────
 *
 * BUILD_ID is a digest. It answers "are these files from the same deploy?"
 * and cannot answer "which commit do I open to see what is in this?". Three
 * months after a deploy that is the question. It was recorded only in
 * build/release-report.md — gitignored, never uploaded, on one laptop.
 *
 * ── WHAT THIS SUITE CANNOT CHECK ──────────────────────────────────────────
 *
 * That the stamps arrive in a real dist/. That needs a build and a server,
 * and tests/verify-pwa.js is where it is checked. The division is the same
 * one tests/verify-loader-pure.js documents: the arithmetic here, the wiring
 * there.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const PWA = fs.readFileSync(path.join(ROOT, 'scripts', 'build-pwa.js'), 'utf8');
const EXTRACT = fs.readFileSync(path.join(ROOT, 'scripts', 'extract-content.js'), 'utf8');

/* Lifted, not copied: a copy here would stop matching build-pwa.js the first
   time either changed, and would go on passing. `crypto` is passed in because
   new Function() has no require. */
function lift(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error(`scripts/build-pwa.js no longer defines ${name}()`);
  let depth = 0, end = -1;
  for (let k = src.indexOf('{', at); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) { end = k + 1; break; } }
  }
  if (end < 0) throw new Error(`could not find the end of ${name}()`);
  /* eslint-disable-next-line no-new-func */
  return new Function('crypto', `${src.slice(at, end)}\nreturn ${name};`)(crypto);
}

const staleContent = lift(PWA, 'staleContent');

head('the function under test is the one that ships');
{
  ok('staleContent was lifted out of build-pwa.js', typeof staleContent === 'function');
  /* It has to be CALLED, and called before the split does any work — a check
     that exists and is never reached is the "passes without measuring"
     failure with one more step in front of it. */
  ok('build-pwa.js calls it', /const stale = staleContent\(SRC_DIGEST, contentManifest\)/.test(PWA));
  ok('and exits non-zero when it answers', /if \(stale\) \{ console\.error\(stale\); process\.exit\(1\); \}/.test(PWA));
  /* BEFORE ANY WORK, or the refusal arrives after an hour of it — and after
     dist/ has already been deleted, which is the part that stings.

     THE FIRST VERSION OF THIS compared the call against `const OPEN =`, the
     declaration that opens the split. That is a few lines below the check and
     a long way above anything that MUTATES, so an injection that moved the
     check down to just above it passed — it looked like a check that could
     not fail, and it very nearly was one. The boundary that matters is the
     first assignment to `html`, so that is what is measured. */
  const callAt = PWA.indexOf('const stale = staleContent(');
  const mutAt = PWA.search(/^html = html\./m);
  const rmAt = PWA.indexOf('fs.rmSync(DIST');
  ok('before the first change to the document', callAt > 0 && mutAt > 0 && callAt < mutAt,
     `check@${callAt} first mutation@${mutAt}`);
  ok('and before dist/ is deleted, so a refusal costs nothing',
     callAt > 0 && rmAt > 0 && callAt < rmAt, `check@${callAt} rm@${rmAt}`);
}

head('a stale content/ is refused, and a matching one is not');
{
  ok('the same digest passes', staleContent('abcdef0123456789', { sourceDigest: 'abcdef0123456789' }) === null);
  const diff = staleContent('abcdef0123456789', { sourceDigest: '0000000000000000' });
  ok('a different digest is refused', typeof diff === 'string' && diff.length > 0);
  ok('and the refusal names both, so it can be believed',
     /abcdef0123456789/.test(diff) && /0000000000000000/.test(diff), String(diff).slice(0, 80));
  ok('and says which command fixes it', /extract-content\.js/.test(diff));
  /* A one-character difference is a different build. Checked explicitly
     because "!==" and "does not start with" look the same in a passing test. */
  ok('one character is enough',
     typeof staleContent('abcdef0123456789', { sourceDigest: 'abcdef012345678a' }) === 'string');
  /* A manifest from before this field existed must not read as a match. */
  ok('a manifest with no sourceDigest is refused, not shrugged at',
     typeof staleContent('abcdef0123456789', {}) === 'string');
  ok('and so is no manifest at all', typeof staleContent('abcdef0123456789', null) === 'string');
  /* THE ONE THAT MATTERS MOST. undefined === undefined is true, and a probe
     comparing two absent values is this repository's most-repeated defect. */
  ok('two absent digests do not compare equal',
     typeof staleContent(undefined, { sourceDigest: undefined }) === 'string');
}

head('the digest compared is the digest extract-content writes');
{
  /* Two files, one number. If either side changes how it hashes — the
     algorithm, the encoding, the slice — the comparison silently becomes
     "never equal", and every split build would refuse. So the shapes are
     held to each other rather than to a literal written here twice. */
  const shapeOf = src => {
    const m = /createHash\('(\w+)'\)\s*[\s\S]{0,120}?\.digest\('hex'\)\.slice\(0, (\d+)\)/.exec(src);
    return m ? m[1] + '/' + m[2] : null;
  };
  const a = shapeOf(EXTRACT), b = shapeOf(PWA.slice(PWA.indexOf('const SRC_DIGEST')));
  ok('extract-content hashes the source', !!a, a || 'not found');
  ok('build-pwa hashes it the same way', !!b && a === b, `${a} vs ${b}`);
  /* And over the file on disk, not over the half-split `html` variable. */
  ok('build-pwa hashes the file, not the variable it is about to cut up',
     /const SRC_DIGEST = crypto\.createHash\('sha256'\)\s*\n\s*\.update\(fs\.readFileSync\(SRC\)\)/.test(PWA));

  /* And the two really do agree on the same bytes. */
  const bytes = Buffer.from('a stand-in for build/systole.html');
  const d1 = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  ok('a digest of the same bytes matches itself', staleContent(d1, { sourceDigest: d1 }) === null, d1);
}

head('the artifact names the commit that produced it');
{
  /* Three files carry BUILD_ID. All three now carry the commit beside it. */
  ok('the shell loader carries a commit placeholder', /var SHELL_COMMIT = '__COMMIT__';/.test(PWA));
  ok('and it is substituted, both directions checked',
     /html\.indexOf\('__COMMIT__'\) < 0/.test(PWA)
     && /html = html\.replace\('__COMMIT__', COMMIT\)/.test(PWA)
     && /html\.indexOf\('__COMMIT__'\) >= 0/.test(PWA));
  ok('app.js carries one', /var APP_COMMIT='\$\{COMMIT\}'/.test(PWA));
  ok('the service worker carries one', /const COMMIT\s+= '\$\{COMMIT\}';/.test(PWA));
  ok('and the extracted content records one too', /^\s*commit,$/m.test(EXTRACT));

  /* IT MUST NOT BE FOLDED INTO ANYTHING. BUILD_ID answers a different
     question, and SHELL_V / CONTENT_V are cache keys: rekeying either on a
     commit id would evict a device's 19 MB of figures for a change that
     altered no byte the browser runs. */
  const buildId = /const BUILD_ID = crypto[\s\S]{0,200}?digest\('hex'\)\.slice\(0, 16\);/.exec(PWA);
  ok('BUILD_ID is still shell+content only', !!buildId && !/COMMIT/.test(buildId[0]),
     buildId ? buildId[0].replace(/\s+/g, ' ').slice(0, 70) : 'not found');
  const shellV = /const shellDigest = crypto[\s\S]{0,200}?digest\('hex'\)\.slice\(0, 16\);/.exec(PWA);
  ok('and the shell digest is still the shell bytes only',
     !!shellV && !/COMMIT/.test(shellV[0]));
  /* THIS CHECK WAS WRONG FIRST TIME, in the way this repo keeps producing: it
     looked for `commit` within eighty characters of `sourceDigest` and found
     it — in the manifest LITERAL, where the two fields simply sit on adjacent
     lines. That is adjacency, not hashing. The property is about the one line
     that computes the digest, so that is the line it reads. */
  const digestLine = /const sourceDigest = crypto[\s\S]{0,120}?;/.exec(EXTRACT);
  ok('the content digest is over the source bytes and nothing else',
     !!digestLine && /update\(html\)/.test(digestLine[0]) && !/commit/i.test(digestLine[0]),
     digestLine ? digestLine[0].replace(/\s+/g, ' ') : 'not found');
  ok('and nothing on either side hashes the commit in',
     ![...PWA.matchAll(/\.update\(([^)]*)\)/g)].some(m => /COMMIT/.test(m[1]))
     && ![...EXTRACT.matchAll(/\.update\(([^)]*)\)/g)].some(m => /commit/i.test(m[1])));

  /* A build from a tarball is a legitimate build. */
  ok('a missing git is "unknown", not a failed build',
     /catch \(_\) \{ return 'unknown'; \}/.test(PWA));
  ok('and a dirty tree is marked as one', /dirty \? at \+ '-dirty' : at/.test(PWA));
  ok('the same two rules hold in extract-content', /return 'unknown'/.test(EXTRACT)
     && /dirty \? at \+ '-dirty' : at/.test(EXTRACT));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
