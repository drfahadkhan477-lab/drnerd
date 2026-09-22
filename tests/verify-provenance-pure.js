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

head('the one-command split build runs the extract it depends on');
{
  /* THE GATE ABOVE MADE THIS VISIBLE. `npm run pwa` was
   *
   *     node scripts/build-pwa.js build/systole.html
   *
   * with no extract step — the same two-command sequence docs/IPAD.md used
   * to print, and the one staleContent() now refuses. Since the refusal is
   * loud, the script no longer produces a mixed dist/; what it still did was
   * TEACH the wrong sequence, from package.json, which is the first place
   * anyone looks for how to build. The docs were corrected and this was not.
   *
   * Order is the whole property: build-pwa reads content/ at its very first
   * lines, so an extract that ran afterwards would be a rebuild of the thing
   * already consumed. */
  const pkg = JSON.parse(require('fs').readFileSync(require('path').join(ROOT, 'package.json'), 'utf8'));
  const pwa = (pkg.scripts || {}).pwa || '';
  ok('npm run pwa exists', !!pwa, pwa || 'absent');
  ok('it extracts the content', /scripts\/extract-content\.js/.test(pwa), pwa);
  ok('and it splits the build', /scripts\/build-pwa\.js/.test(pwa), pwa);
  ok('in that order, since build-pwa reads content/ before it does anything else',
     pwa.indexOf('extract-content.js') >= 0
     && pwa.indexOf('extract-content.js') < pwa.indexOf('build-pwa.js'), pwa);
  /* Both halves read the SAME file, or the freshness check is being handed
     two different builds on purpose. */
  const args = [...pwa.matchAll(/scripts\/(?:extract-content|build-pwa)\.js\s+(\S+)/g)].map(m => m[1]);
  ok('both halves are given the same build to work from',
     args.length === 2 && args[0] === args[1], args.join(' vs ') || 'not found');
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

head('the single file says which commit made it, too');
{
  /* IT SAID NOTHING AT ALL until now. The split build has carried a BUILD_ID
     since the shell/content split and a commit since the provenance pass;
     systole.html carried neither — and it is the artifact that actually
     travels, dropped into Files and opened on a tablet away from the
     repository that made it. "Is this the build with the fix?" had no answer
     in the file.

     AFTER THE CHAIN, NOT INSIDE IT, and that is the property worth holding:
     a stamping step would be an 83rd link whose output every later anchor
     would have to tolerate. Asserted by position — the stamp must be written
     below the loop that runs CHAIN. */
  const BUILD = fs.readFileSync(path.join(ROOT, 'scripts', 'build.js'), 'utf8');
  ok('build.js stamps the finished document', /systole-build \$\{digest\} commit \$\{commit\}/.test(BUILD));
  const loopAt = BUILD.indexOf('for (const step of CHAIN)');
  const stampAt = BUILD.indexOf('systole-build ${digest}');
  ok('and does it after the chain has run, so no patch anchor can see it',
     loopAt > 0 && stampAt > loopAt, `chain@${loopAt} stamp@${stampAt}`);
  /* The chain itself must not have grown a step for this. */
  ok('the chain is not one step longer for it',
     !/stamp-patch|provenance-patch/.test(BUILD));

  /* A COMMENT, NOT A SCRIPT: nothing to execute, so no CSP question and no
     new inline script for verify-csp or verify-stage0 to account for. */
  ok('the stamp is an HTML comment',
     /const stamp = Buffer\.from\(`<!-- systole-build/.test(BUILD));

  /* </head> is the boundary build-pwa.js already holds to exactly one
     occurrence, so this reuses a checked anchor rather than guessing a new
     one — and refuses rather than appending blindly when it is not there. */
  /* BYTE-EXACT, and this is the check that would have caught what the first
     version of this stamp did. The line it replaced was copyFileSync, which
     is byte-exact by definition; reading with encoding 'utf8' and writing the
     string back is not. A lone 0x92 — the Windows-1252 apostrophe an exported
     HTML corpus carries — goes in as one byte and comes out as three, in a
     42 MB file nobody reads by eye. It would also have moved the digest apart
     from the one extract-content.js writes, so build-pwa's freshness check
     would then refuse the build for looking stale: a true refusal for
     entirely the wrong reason. */
  ok('the document is read as bytes, not decoded to a string',
     /const built = fs\.readFileSync\(input\);/.test(BUILD)
     && !/fs\.readFileSync\(input, 'utf8'\)/.test(BUILD));
  ok('and spliced as bytes, so nothing is re-encoded on the way out',
     /Buffer\.concat\(\[built\.subarray\(0, at\), stamp, built\.subarray\(at\)\]\)/.test(BUILD));
  ok('it is placed at the one anchor this repo already checks',
     /const at = built\.indexOf\(HEAD\);/.test(BUILD)
     && /at < 0 \|\| at !== built\.lastIndexOf\(HEAD\)/.test(BUILD));
  ok('and a document without exactly one </head> is refused, not stamped',
     /process\.exit\(1\)/.test(BUILD.slice(BUILD.indexOf('nowhere to stamp it'), BUILD.indexOf('nowhere to stamp it') + 120)));

  /* Over the UNSTAMPED bytes, because stamping changes them — the same move
     BUILD_ID makes in build-pwa.js, for the same reason. */
  ok('the digest is taken before the stamp goes in, over those same bytes',
     /const built = fs\.readFileSync\(input\);[\s\S]{0,120}?createHash\('sha256'\)\.update\(built\)/.test(BUILD));

  /* NO CLOCK. The same export at the same commit must produce the same
     bytes; a timestamp in the artifact would end that for nothing. */
  ok('no timestamp rides along, so the build stays reproducible',
     !/new Date\(\)/.test(BUILD.slice(stampAt - 900, stampAt + 300)));

  /* Same two rules as everywhere else: a tarball is a legitimate place to
     build from, and a dirty tree is a claim the repository cannot honour. */
  ok('a missing git is "unknown" here as well', /return 'unknown';/.test(BUILD));
  ok('and a dirty tree is marked', /dirty \? at \+ '-dirty' : at/.test(BUILD));
}

head('the built artifacts are checked where only a build can check them');
{
  /* WHAT THIS FILE CANNOT DO, said once rather than implied. Everything above
     reads build-pwa.js and build.js as TEXT: it proves they EMIT the stamps.
     It cannot tell whether a stamp survived substitution, the split, the font
     lift or eight later rewrites of `html`. Only the artifact answers that,
     and only a run with the licensed export produces one.

     So the browser suite must carry the other half, and this asserts it does
     — otherwise "provenance is tested" would be true of the emitting and
     false of the artifact, which is the shape of hole this repository keeps
     finding: green that covers the paragraph beside the one with the hole. */
  const PWASUITE = fs.readFileSync(path.join(ROOT, 'tests', 'verify-pwa.js'), 'utf8');
  ok('verify-pwa reads the commit off the served shell', /SHELL_COMMIT = '\(\[\^'\]\*\)'/.test(PWASUITE));
  ok('and off app.js and the worker',
     /var APP_COMMIT='\(\[\^'\]\*\)'/.test(PWASUITE) && /const COMMIT\\s\*=\\s\*'\(\[\^'\]\*\)'/.test(PWASUITE));
  ok('and holds all three to the same commit', /all three agree on which commit that was/.test(PWASUITE));
  ok('and refuses an unsubstituted placeholder in the artifact',
     /no unsubstituted placeholder reached the artifact/.test(PWASUITE));
  ok('and will not accept the build stamp in the commit slot',
     /the commit is a commit, not a copy of the build stamp/.test(PWASUITE));
  ok('and checks the content manifest the freshness gate compares against',
     /the extracted content records a commit as well/.test(PWASUITE));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
