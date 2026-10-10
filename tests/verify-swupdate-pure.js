#!/usr/bin/env node
/*
 * What happens when a deploy lands under a running app.
 *
 *   node tests/verify-swupdate-pure.js
 *
 * No browser, no build-pwa run, no served directory. This lifts two things out
 * of scripts/build-pwa.js — the loader's build-pairing decision and the service
 * worker's cache-name derivation — and drives them directly. For the second it
 * assembles and extracts three small synthetic builds into a temporary folder
 * (the last section), because what the content cache is keyed on is decided
 * by the build, not by the worker.
 *
 * ── WHY THESE FIVE CASES ──────────────────────────────────────────────────
 *
 * sw.js serves the shell cache-first and refreshes it in the background, one
 * request at a time. A deploy that lands between the request for index.html
 * and the request for app.js leaves a launch running one build's HTML against
 * the other build's code, and the mixed pair persists in the cache until
 * something replaces it. Nothing crashes. The app behaves like neither
 * version, which is worse, because there is nothing to report.
 *
 * So the five pairings a deploy can produce:
 *
 *   a) old shell + new app.js        mixed — must be caught
 *   b) new shell + old app.js        mixed — must be caught, including the
 *                                    case where the old app.js predates the
 *                                    stamp and carries none at all
 *   c) any two different stamps      mixed, down to one character
 *   d) offline after an update       the figures must survive it
 *   e) the very first install        NOT an update, and must not be treated
 *                                    as one
 *
 * ── (b) WAS THE HOLE ──────────────────────────────────────────────────────
 *
 * The loader's condition was
 *
 *     typeof APP_BUILD_ID !== 'undefined' && APP_BUILD_ID !== SHELL_BUILD_ID
 *
 * so an app.js carrying no stamp skipped the check entirely — and an
 * unstamped app.js is exactly what a cached file from a build older than the
 * stamp looks like. The guard against a ReferenceError had become a guard
 * against the test. It is now a mismatch like any other.
 *
 * ── WHAT THIS SUITE CANNOT CHECK ──────────────────────────────────────────
 *
 * That the verdict is ACTED ON — that 'reload' really reloads, that the
 * sessionStorage guard survives it, that a real second worker really takes
 * over. Those need a page and a server, and tests/verify-pwa.js drives them
 * against a served dist/. The division is the one tests/verify-loader-pure.js
 * documents: the arithmetic here, the wiring there.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'build-pwa.js'), 'utf8');

/* The loader and the worker, as build-pwa.js will write them. Both are
   template literals in that file; both are read rather than copied, because a
   copy here would stop matching the first time either changed and would go on
   passing. */
function literal(open, close) {
  const i = SRC.indexOf(open);
  if (i < 0) throw new Error(`build-pwa.js no longer defines ${open.trim()}`);
  const j = SRC.indexOf(close, i);
  if (j < 0) throw new Error(`could not find the end of ${open.trim()}`);
  return SRC.slice(i + open.length, j).replace(/\\`/g, '`').replace(/\\\$/g, '$');
}
const LOADER = literal('const LOADER = `<script>', '</script>`;');
const SW = literal('const SW = `', '\n`;');

/* scope: the names the lifted function reads from the file around it (fs,
   path, …), handed in under the same names. */
function lift(src, name, scope = {}) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error(`${name}() is no longer defined where this expects it`);
  let depth = 0, end = -1;
  for (let k = src.indexOf('{', at); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) { end = k + 1; break; } }
  }
  if (end < 0) throw new Error(`could not find the end of ${name}()`);
  /* eslint-disable-next-line no-new-func */
  return new Function(...Object.keys(scope), `${src.slice(at, end)}\nreturn ${name};`)(...Object.values(scope));
}

const pairVerdict = lift(LOADER, 'pairVerdict');

const NEW = 'a1b2c3d4e5f6a7b8';
const OLD = '0f1e2d3c4b5a6978';

head('the function under test is the one that ships');
{
  /* THAT THE FILE ITSELF PARSES, which is not implied by anything else here:
     every suite that reads build-pwa.js reads it as TEXT, so a syntax error
     in it is invisible to all of them and surfaces only when someone runs a
     build. It has been broken twice by a comment — the LOADER and the SW are
     template literals, and a backtick inside either ends it early. */
  ok('build-pwa.js parses as JavaScript', (() => {
    const r = require('child_process').spawnSync(
      process.execPath, ['--check', path.join(ROOT, 'scripts', 'build-pwa.js')], { encoding: 'utf8' });
    return r.status === 0;
  })());
  ok('the loader was found in build-pwa.js', LOADER.length > 500, `${LOADER.split('\n').length} lines`);
  ok('and it parses as JavaScript', (() => {
    try { new Function(LOADER); return true; } catch (_) { return false; }
  })());
  ok('pairVerdict was lifted out of it', typeof pairVerdict === 'function');
  ok('the loader actually calls it',
     /var verdict = pairVerdict\(SHELL_BUILD_ID, appId,/.test(LOADER));
  /* Three answers, three branches. A verdict nothing acts on is a verdict. */
  ok("and acts on 'tell'", /if\(verdict === 'tell'\)\{[\s\S]{0,200}?return fail\(/.test(LOADER));
  ok("and on 'reload'", /if\(verdict === 'reload'\)\{[\s\S]{0,200}?location\.reload\(\)/.test(LOADER));
  ok("and 'run' clears the guard rather than falling through it",
     /sessionStorage\.removeItem\('accsap-mixed-build'\)/.test(LOADER));
}

head('(a) old shell + new app.js is caught');
{
  ok('the pair is not run', pairVerdict(OLD, NEW, false) !== 'run');
  ok('the first time, it reloads — one deploy settles it', pairVerdict(OLD, NEW, false) === 'reload');
  ok('the second time, it stops and says so', pairVerdict(OLD, NEW, true) === 'tell');
}

head('(b) new shell + old app.js is caught — and an unstamped one is too');
{
  ok('the pair is not run', pairVerdict(NEW, OLD, false) !== 'run');
  ok('it is the same verdict in this direction', pairVerdict(NEW, OLD, false) === 'reload');
  ok('and it stops on the retry too', pairVerdict(NEW, OLD, true) === 'tell');
  /* THE HOLE. An app.js from before the stamp existed carries none, and the
     old condition skipped the check whenever it was absent. */
  ok('an app.js with no stamp at all is a mismatch, not a free pass',
     pairVerdict(NEW, null, false) === 'reload');
  ok('and it still stops rather than looping', pairVerdict(NEW, null, true) === 'tell');
  /* HALF OF THIS PROPERTY LIVES AT THE CALL SITE, and that half can only be
     checked as wiring. pairVerdict() decides what an absent stamp means; the
     loader decides what to HAND it when APP_BUILD_ID was never declared, and
     a typeof has to happen there or the read is a ReferenceError.

     Injecting the obvious defect — the call site passing SHELL_BUILD_ID in
     place of the missing stamp, so every unstamped app.js pairs perfectly
     with whatever shell it met — left every behavioural check above green.
     Only these two go red, which is exactly what they are for. Two of them
     rather than one: the first says what it should pass, the second says what
     it must never pass, and the second is the one that catches a substitution
     that still looks like a normalisation. */
  const appIdLine = (/var appId = [^;]+;/.exec(LOADER) || [''])[0];
  ok('the loader normalises a missing stamp to null',
     /\(typeof APP_BUILD_ID === 'undefined'\) \? null : APP_BUILD_ID/.test(appIdLine), appIdLine);
  ok('and never substitutes the shell stamp for a missing one',
     !!appIdLine && !/SHELL_BUILD_ID/.test(appIdLine), appIdLine);
  /* AND THE OTHER WAY, which is what makes the null deliberate rather than
     incidental: two absent stamps must not compare equal and run. Written as
     a bare `appId === shellId` this answered 'run' to every one of these —
     the comparison that passes hardest when nothing is there to compare, and
     the single defect this repository has produced most often. */
  for (const [a, b] of [[null, null], [undefined, undefined], [null, undefined], ['', '']]) {
    ok(`an absent pair (${String(a)}, ${String(b)}) does not run`,
       pairVerdict(a, b, false) !== 'run');
  }
  ok('a shell with no stamp cannot verify anything, so it does not try',
     pairVerdict(null, NEW, false) === 'reload');
}

head('(c) a mismatch is a mismatch, down to one character');
{
  ok('one character apart is not the same build',
     pairVerdict(NEW, NEW.slice(0, -1) + 'c', false) === 'reload');
  ok('a prefix is not the same build', pairVerdict(NEW, NEW.slice(0, 8), false) === 'reload');
  ok('case is not ignored', pairVerdict(NEW, NEW.toUpperCase(), false) === 'reload');
  ok('whitespace is not trimmed away', pairVerdict(NEW, NEW + ' ', false) === 'reload');
  ok('an empty stamp is not a wildcard', pairVerdict(NEW, '', false) === 'reload');
  /* THE ONE THAT MUST NOT BE FORGOTTEN: the matching pair has to RUN. A
     verdict function that answered 'reload' to everything would satisfy every
     check above and brick the app. */
  ok('and a matching pair runs', pairVerdict(NEW, NEW, false) === 'run');
  ok('even when a previous launch had tried a reload', pairVerdict(NEW, NEW, true) === 'run');
}

head('(d) an update must not cost the figures already on the device');
{
  /* THE WIRING, read from the worker's text. What the two versions are and
     what activate does with them is driven in the last section, over real
     builds. A model stood here once: it named its own versions ('contentX'
     before and after a code deploy) and stayed green while every code deploy
     renamed the content bucket, because nothing it compared came from a build. */
  ok('the worker derives the shell cache from SHELL_V',
     /const SHELL\s*=\s*'accsap-shell-'\s*\+\s*SHELL_V;/.test(SW));
  ok('and the content cache from CONTENT_V',
     /const CONTENT\s*=\s*'accsap-content-'\s*\+\s*CONTENT_V;/.test(SW));
  ok('and activate deletes everything that is neither',
     /ks\.filter\(k => k !== SHELL && k !== CONTENT\)/.test(SW));
}

head('(e) the first install is not an update');
{
  /* This one stays wired rather than lifted — tests/verify-pwa.js drives a
     real worker taking over a real page, which is the only honest way to
     check that a reload happens. What is checked here is the rule the handler
     encodes, and one part of it that the browser suite does not read. */
  ok('the page listens for the worker taking over',
     /addEventListener\('controllerchange'/.test(LOADER));
  ok('it records whether there was a controller BEFORE registering',
     /var hadController = !!navigator\.serviceWorker\.controller;[\s\S]{0,400}?addEventListener\('controllerchange'/
       .test(LOADER));
  ok('and the first takeover returns instead of reloading',
     /if\(!hadController\) \{ hadController = true; return; \}/.test(LOADER));
  /* THE HALF THAT IS EASY TO DROP. Returning is not enough: the flag has to
     be SET on the way out, or every later controllerchange in that tab reads
     as another first install and a genuine update is never picked up. */
  ok('setting the flag on the way out, so a later update is still an update',
     /if\(!hadController\) \{ hadController = true;/.test(LOADER));
  /* And the loop guard, which is what makes reloading safe to ship at all. */
  ok('a genuine takeover reloads exactly once per tab',
     /sessionStorage\.getItem\('accsap12\.swreloaded'\)\) return;/.test(LOADER)
     && /sessionStorage\.setItem\('accsap12\.swreloaded','1'\);/.test(LOADER));
  ok('and no sessionStorage means no reload, rather than an unguarded one',
     /\}catch\(_\)\{ return; \}/.test(LOADER));
}

head('the build cannot ship a pair this would reject');
{
  /* Now that an unstamped app.js is fatal at launch, a build that failed to
     stamp one would ship an app that refuses to start. The shell's two
     placeholders were already checked in both directions; app.js was not. */
  ok('build-pwa asserts app.js got its stamp',
     /if \(!\/\^var APP_BUILD_ID='\[0-9a-f\]\{16\}';/.test(SRC));
  ok('and throws rather than warning', /throw new Error\('app\.js did not receive its build stamp'\)/.test(SRC));
  ok('the shell placeholder is still checked both ways',
     /html\.indexOf\('__BUILD_ID__'\) < 0/.test(SRC) && /html\.indexOf\('__BUILD_ID__'\) >= 0/.test(SRC));
}

head('(d), driven: a code deploy keeps the content cache, a content deploy renames it');
/* WHAT CONTENT_V IS MADE FROM IS DECIDED BY THE BUILD, so this builds. It was
   content/manifest.json's sourceDigest, a digest of the whole single-file
   build with its code and CSS, so a stylesheet fix renamed the content bucket
   and activate deleted every figure a fellow had downloaded.

   Three small synthetic builds, in a temporary folder: A; B, with one comment
   added to app/css/base.css; C, with one question's stem changed. Each is
   assembled by scripts/assemble-app.js and extracted by
   scripts/extract-content.js into <build>/content, where dist/content would
   be. Then build-pwa.js's own worker template is evaluated over that folder,
   with contentVersion() lifted from build-pwa.js, and the worker it produces
   is run in a sandbox. A whole build-pwa run would also write the notes, the
   splash and the mesh under content/, and draw icons in a browser; the rule
   for those files is driven on its own at the end. */
(async () => {
  const os = require('os');
  const vm = require('vm');
  const crypto = require('crypto');
  const { spawnSync } = require('child_process');
  const S = p => path.join(ROOT, 'scripts', p);
  const Assemble = require(S('assemble-app.js'));
  const Syn = require(S('synthetic-export.js'));
  const contentVersion = lift(SRC, 'contentVersion', { fs, path, crypto });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swupdate-'));
  try {
    /* The notes go in the temporary folder too: left to its defaults the
       assembler reads content/refs, the licensed library. */
    const refsDir = path.join(tmp, 'refs'), imagesDir = path.join(tmp, 'refs-images');
    fs.mkdirSync(refsDir); fs.mkdirSync(imagesDir);
    const lib = Syn.syntheticRefs(1);
    for (const [n, t] of lib.files) fs.writeFileSync(path.join(refsDir, n), t);
    for (const [k, b] of lib.images) fs.writeFileSync(path.join(imagesDir, k), b);
    const base = Assemble.producers({ exportHtml: Syn.syntheticExport(2), refsDir, imagesDir });
    const shell = fs.readFileSync(path.join(ROOT, 'app', 'systole.html'), 'utf8');
    const variant = {
      A: base,
      B: (kind, name) => kind === 'app' && name === 'app/css/base.css'
        ? base(kind, name) + '\n/* a code-only change */\n' : base(kind, name),
      C: (kind, name) => {
        if (kind !== 'payload' || name !== 'ALL_Q') return base(kind, name);
        const bank = JSON.parse(base(kind, name));
        bank[bank.length - 1].s += ' One more invented sentence.';
        return JSON.stringify(bank);
      },
    };

    /* The worker as build-pwa.js writes it: the template evaluated with the
       names it interpolates. contentManifest is handed in as the build has it,
       so a worker keyed on the build's digest again is measured rather than
       refused as an unknown name. The shell digests are inputs to the
       template, as in a build: B's code differs from A's, C's does not. */
    const open = 'const SW = `', at = SRC.indexOf(open), end = SRC.indexOf('\n`;', at);
    const template = new Function('contentVersion', 'path', 'DIST', 'contentManifest', 'shellDigest',
      'BUILD_ID', 'COMMIT', 'NO_CONTENT', 'fontAssets', 'return `' + SRC.slice(at + open.length, end) + '\n`;');
    const shellDigest = { A: 'aaaaaaaaaaaaaaaa', B: 'bbbbbbbbbbbbbbbb', C: 'aaaaaaaaaaaaaaaa' };
    /* Run in a sandbox over a CacheStorage holding what a device already has;
       activate's deletions are recorded. */
    const deploy = async (sw, have) => {
      const on = {}, kept = new Set(have);
      const self = { addEventListener: (t, f) => { on[t] = f; }, clients: { claim: async () => {} } };
      const caches = { keys: async () => [...kept], delete: async k => kept.delete(k) };
      const names = vm.runInNewContext(sw + '\n;({ SHELL, CONTENT, CONTENT_V });', { self, caches });
      let job;
      on.activate({ waitUntil: p => { job = p; } });
      await job;
      return { names, kept: [...kept] };
    };

    const b = {};
    for (const k of Object.keys(variant)) {
      const html = path.join(tmp, k + '.html'), dist = path.join(tmp, k), dc = path.join(dist, 'content');
      fs.writeFileSync(html, Assemble.assembleApp({ shell, resolve: variant[k], commit: 'abc123def456' }).out);
      const x = spawnSync(process.execPath, [S('extract-content.js'), html, dc], { encoding: 'utf8' });
      if (x.status !== 0) throw new Error(`extract-content refused build ${k} (exit ${x.status})`);
      const manifest = JSON.parse(fs.readFileSync(path.join(dc, 'manifest.json'), 'utf8'));
      const sw = template(contentVersion, path, dist, manifest, shellDigest[k], '0123456789abcdef', 'abc123def456', false, []);
      const figs = fs.readdirSync(path.join(dc, 'figures')).sort();
      b[k] = { sw, manifest, figs, names: (await deploy(sw, [])).names,
               bank: fs.readFileSync(path.join(dc, 'questions.json')),
               figBytes: Buffer.concat(figs.map(f => fs.readFileSync(path.join(dc, 'figures', f)))) };
    }
    const { A, B, C } = b;

    /* Preconditions: B is a different build with the same content, C a
       different bank. Without them the checks after would compare nothing
       that moved. */
    ok('the code-only change reached the build: A and B have different digests',
       A.manifest.sourceDigest !== B.manifest.sourceDigest, `${A.manifest.sourceDigest} / ${B.manifest.sourceDigest}`);
    ok('and left the bank and every figure byte for byte as they were',
       A.figs.length > 0 && A.bank.equals(B.bank) && A.figs.join() === B.figs.join() && A.figBytes.equals(B.figBytes),
       `${A.figs.length} figures`);
    ok('the content change reached the bank', !A.bank.equals(C.bank));

    const v = k => b[k].names.CONTENT_V;
    ok('each worker names a content version', ['A', 'B', 'C'].every(k => /^[0-9a-f]{16}$/.test(v(k))),
       `${v('A')} / ${v('B')} / ${v('C')}`);
    ok('a code-only deploy keeps the content cache\'s name', v('A') === v('B'), `${v('A')} / ${v('B')}`);
    ok('a content deploy renames it', v('A') !== v('C'));

    /* The device has A's two caches when B arrives, or when C does. */
    const device = [A.names.SHELL, A.names.CONTENT];
    const afterB = (await deploy(B.sw, device)).kept, afterC = (await deploy(C.sw, device)).kept;
    ok('so the figures a fellow downloaded survive a code deploy', afterB.includes(A.names.CONTENT), afterB.join(', '));
    ok('while the old shell is deleted', !afterB.includes(A.names.SHELL), afterB.join(', '));
    ok('and a content deploy deletes the old bank rather than serving it forever',
       !afterC.includes(A.names.CONTENT), afterC.join(', '));

    /* THE REST OF dist/content/, which only a whole build-pwa run writes: a
       folder in its shape, changed one file at a time. */
    const dc = path.join(tmp, 'rule');
    const put = (rel, body) => {
      fs.mkdirSync(path.dirname(path.join(dc, rel)), { recursive: true });
      fs.writeFileSync(path.join(dc, rel), body);
    };
    put('questions.json', '[]'); put('figures/X_1.png', 'f'); put('refs-seed.json', '[]');
    put('refs-images/u.json', '{}'); put('splash-heart/heart.webp', 'h');
    put('heart-mesh-0123456789ab.bin', 'm'); put('manifest.json', '{}');
    const v0 = contentVersion(dc);
    put('refs-images/u.json', '{"u/a.png":"x"}');
    const v1 = contentVersion(dc);
    ok('a note figure file is content: changing one renames the bucket', v1 !== v0);
    put('splash-heart/heart.webp', 'h2');
    const v2 = contentVersion(dc);
    ok('so is the splash heart, which is served under a fixed name', v2 !== v1);
    fs.rmSync(path.join(dc, 'heart-mesh-0123456789ab.bin'));
    put('heart-mesh-ba9876543210.bin', 'm2');
    ok('a new heart mesh, named by its own digest and baked from code, is not', contentVersion(dc) === v2);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => ok('the driven deploys ran to the end', false, e.message))
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  });
