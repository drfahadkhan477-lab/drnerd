#!/usr/bin/env node
/*
 * The engine is a parameter, and stays one — in bare Node, no browser.
 *
 *   node tests/verify-engine.js
 *
 * The app's target device is an iPad, so the engine that matters most is
 * WebKit; every suite nonetheless launched Chromium, thirty-four times over,
 * because each was copied from the one before it. tests/_engine.js made that
 * a flag. This is what stops it drifting back: the reason all thirty-four
 * hardcoded Blink was never a decision, it was the path of least resistance,
 * and the next suite written will take the same path unless something
 * objects.
 *
 * So this asserts a property of the test suite itself rather than of the app.
 * That is unusual here and deliberate — it is the only check in the project
 * whose subject is the project's own discipline, and it needs no browser and
 * no build, which means CI can actually run it.
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

const TESTS = path.join(__dirname);
const ROOT = path.join(__dirname, '..');
const E = require('./_engine.js');

/* Read fresh each time: engineName() reads process.env at call time on
   purpose, so a suite spawned with a different SYSTOLE_ENGINE gets it without
   the module being reloaded. */
const withEnv = (value, fn) => {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'SYSTOLE_ENGINE');
  const prev = process.env.SYSTOLE_ENGINE;
  if (value === undefined) delete process.env.SYSTOLE_ENGINE;
  else process.env.SYSTOLE_ENGINE = value;
  try { return fn(); } finally {
    if (had) process.env.SYSTOLE_ENGINE = prev; else delete process.env.SYSTOLE_ENGINE;
  }
};
const threw = fn => { try { fn(); return null; } catch (e) { return e.message; } };

head('the default is unchanged — `npm test` still means Chromium');
ok('no SYSTOLE_ENGINE resolves to chromium', withEnv(undefined, () => E.engineName()) === 'chromium');
ok('an empty SYSTOLE_ENGINE resolves to chromium too, not to ""',
   withEnv('', () => E.engineName()) === 'chromium');
ok('DEFAULT_ENGINE is the one the suites were written against', E.DEFAULT_ENGINE === 'chromium');

head('and asking for another engine actually changes the answer');
ok('webkit is selectable', withEnv('webkit', () => E.engineName()) === 'webkit');
ok('firefox is selectable', withEnv('firefox', () => E.engineName()) === 'firefox');
ok('case and stray whitespace are forgiven, because a shell adds both',
   withEnv('  WebKit \n', () => E.engineName()) === 'webkit');

head('a name that is not an engine fails loudly, before any browser starts');
{
  const msg = withEnv('webkti', () => threw(() => E.engineName()));
  ok('a typo throws rather than falling back to chromium', msg !== null);
  ok('and the message names what was asked for', !!msg && msg.includes('webkti'), msg || '(no throw)');
  ok('and lists what would have worked', !!msg && msg.includes('webkit') && msg.includes('firefox'));
  /* Silently defaulting is the failure mode worth naming: a run that reports
     "all green" having quietly tested the engine you were trying to leave is
     worse than no run at all. */
  ok('safari is rejected — Playwright has no such browser type',
     withEnv('safari', () => threw(() => E.engineName())) !== null);
}

head('Chromium-only launch flags do not travel to engines that would choke');
{
  const args = { args: ['--enable-precise-memory-info'] };
  ok('chromium keeps its flags', (E.launchOptions(args, 'chromium').args || []).length === 1);
  ok('webkit is handed none', E.launchOptions(args, 'webkit').args === undefined);
  ok('firefox is handed none', E.launchOptions(args, 'firefox').args === undefined);
  ok('and everything else is passed through untouched',
     E.launchOptions({ args: ['--x'], headless: false, timeout: 5 }, 'webkit').headless === false);
  ok('the caller’s own options object is not mutated — it may be a shared constant',
     (E.launchOptions(args, 'webkit'), Array.isArray(args.args) && args.args.length === 1));
  ok('no options at all is not an error', JSON.stringify(E.launchOptions(undefined, 'webkit')) === '{}');
}

head('every browser suite goes through the helper, none launches an engine itself');
{
  const suites = fs.readdirSync(TESTS).filter(f => /^verify-.*\.js$/.test(f)).sort();
  ok('there are suites to check at all', suites.length > 30, `${suites.length} found`);

  const direct = [], unwired = [];
  for (const f of suites) {
    const src = fs.readFileSync(path.join(TESTS, f), 'utf8');
    /* Comments are stripped, and the scan is then anchored to the start of a
       line with no quote before the call. Two suites discuss Chromium in
       prose, and this file names the very call it forbids in its own PASS
       label — so a bare substring search fails on its own documentation. It
       did, on the first run. Stripping string literals with a regex failed
       too, and more interestingly: regex literals elsewhere in this file
       contain apostrophes, which puts quote-pairing out of phase and lets the
       label through anyway. You cannot lex JavaScript with a regular
       expression. But a real call sits in statement position with no quote to
       its left on the line, and a mention always has one — a distinction that
       needs no lexer. */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    if (/^[^'"`\n]*\b(?:chromium|webkit|firefox)\.launch\(/m.test(code)) direct.push(f);
    /* A suite that uses a browser must get it from here. One that does not
       (the pure-arithmetic suites, this one included) is not required to
       require anything. */
    const usesBrowser = /^[^'"`\n]*require\(\s*'playwright'\s*\)/m.test(code)
                     || /^[^'"`\n]*\blaunch\(/m.test(code);
    if (usesBrowser && !/require\(\s*'\.\/_engine(?:\.js)?'\s*\)/.test(code)) unwired.push(f);
  }
  ok('no suite calls chromium.launch() / webkit.launch() directly',
     direct.length === 0, direct.join(', ') || 'none');
  ok('no suite requires playwright behind the helper’s back',
     unwired.length === 0, unwired.join(', ') || 'none');
}

head('the runner can actually be told which engine to use');
{
  const v = fs.readFileSync(path.join(ROOT, 'scripts', 'verify.js'), 'utf8');
  /* --engine takes a value, so it has to be excluded from the positional
     scan. Without this the build path silently becomes the string "webkit"
     and the run dies on "No build at .../webkit" — which is a confusing way
     to be told about an argv bug. */
  ok('--engine is registered as a flag that takes a value', /VALUED\s*=\s*\[[^\]]*'--engine'/.test(v));
  /* THE TWO ENTRY POINTS HAVE TO AGREE ON WHICH BROWSER THIS IS.
     A single suite run directly reads SYSTOLE_ENGINE from the environment; the
     runner used to read only --engine and then hand every child an explicit
     SYSTOLE_ENGINE of its own, so the same variable set in the same shell was
     silently overwritten with chromium. `SYSTOLE_ENGINE=webkit node
     scripts/verify.js` gave a full green chromium run that read as a WebKit
     one — and nobody re-reads a green summary. */
  ok('the runner takes SYSTOLE_ENGINE as its default, so the two entry points cannot disagree',
     /opt\('--engine',\s*process\.env\.SYSTOLE_ENGINE\s*\|\|\s*DEFAULT_ENGINE\)/.test(v));
  ok('and an explicit --engine still wins over it, because a flag is a decision for this run',
     /opt\('--engine',/.test(v) && v.indexOf("opt('--engine',") < v.indexOf('process.env.SYSTOLE_ENGINE'));
  ok('and the choice reaches the suites through the environment',
     (v.match(/SYSTOLE_ENGINE:\s*ENGINE/g) || []).length >= 2,
     `${(v.match(/SYSTOLE_ENGINE:\s*ENGINE/g) || []).length} spawn site(s)`);
  ok('the split-build run gets it too, not just the file-path suites',
     /verify-pwa\.js[\s\S]{0,400}SYSTOLE_ENGINE/.test(v));
  ok('an unusable engine name stops the run instead of starting thirty-four browsers',
     /ENGINES\.includes\(ENGINE\)/.test(v));
}

head('console noise the engine makes, told apart from noise the app makes');
{
  /* THE SAME COPY-PASTE, ONE LEVEL UP. Twenty-five suites each carried
     /GroupMarker|GL Driver|swiftshader/, for exactly the reason all of them
     called chromium.launch(): the one before it did. */
  /* This file is excluded and has to be: the assertion below names the pattern
     it is looking for, so scanning itself would always find it. Same exception
     the engine scan above already makes for the two suites that discuss
     Chromium in prose. */
  const browserSuites = fs.readdirSync(TESTS)
    .filter(f => /^verify-.*\.js$/.test(f) && f !== 'verify-engine.js').sort();
  const inlined = browserSuites.filter(f => /GroupMarker/.test(fs.readFileSync(path.join(TESTS, f), 'utf8')));
  ok('every browser suite routes its console filter through the helper',
     inlined.length === 0, inlined.join(', ') || `${browserSuites.length} suites, none inline it`);

  ok('driver chatter is noise on every engine',
     E.isEngineNoise('GroupMarker not set', 'chromium')
     && E.isEngineNoise('swiftshader fallback', 'webkit'));
  ok('an application error is never noise',
     !E.isEngineNoise('TypeError: x is not a function', 'chromium')
     && !E.isEngineNoise('TypeError: x is not a function', 'webkit'));

  /* The measured asymmetry, asserted so it cannot quietly become symmetric.
     On a blank page with no application code, twenty contexts created and
     released one at a time: WebKit warns four times whatever the page does,
     Chromium warns zero once they are released. So the message is a browser
     property on one engine and a real regression detector on the other, and
     the helper has to keep telling those apart. */
  const capWarning = 'There are too many active WebGL contexts on this page, the oldest context will be lost.';
  ok('the context-cap notice is tolerated on WebKit, where no page can prevent it',
     E.isEngineNoise(capWarning, 'webkit'));
  ok('and stays a hard failure on Chromium, where releasing contexts does silence it',
     !E.isEngineNoise(capWarning, 'chromium'));
}

head('a run reported from somewhere else says where it came from');
{
  const v = fs.readFileSync(path.join(ROOT, 'scripts', 'verify.js'), 'utf8');
  /* WHY THIS EXISTS. A WebKit run came back as one line — "1335 checks across
     49 suites … 17 suites failing: apex, polish, splash, …" — and the only way
     to learn that it had been run against a three-day-old checkout was to
     notice that 49 was not 51 and do the subtraction. The summary looked
     exactly like a current run. Two properties fix that, and neither is
     something the reader should have to supply:

       - the run states its own branch and commit, so a stale tree is legible
         in the output rather than deducible from a count;
       - the failures are written to a file, so reporting a run is sending one
         file instead of scrolling a terminal and pasting the last line.

     Both are asserted against scripts/verify.js's text, as everything else in
     this block is: the alternative is spawning a full run to make one fail,
     which costs a browser and fifteen minutes to test a console.log. */
  ok('a failing run writes the failing suites out in full, not just their names',
     /function writeFailLog\(\)/.test(v) && /last-run\.log/.test(v));
  /* Printed, not silently written: a file nobody is told about is a file
     nobody sends. The check is that writeFailLog()'s return value — the path —
     reaches a console.log, rather than that some particular sentence does. */
  ok('and says on the console where it put them',
     /console\.log\([^\n]*writeFailLog\(\)/.test(v));
  ok('the run names its own branch and commit',
     /function provenance\(\)/.test(v)
     && /rev-parse --abbrev-ref HEAD/.test(v) && /rev-parse --short HEAD/.test(v));
  ok('and admits to uncommitted changes, which are the other way a run is not what it says',
     /git status --porcelain/.test(v));
  /* Provenance on the green line too. A green run from a stale tree is the
     more dangerous of the two: nobody re-reads a summary that says green. */
  ok('a green run carries the same provenance as a failing one',
     /all green[\s\S]{0,60}provenance\(\)/.test(v));
  ok('the log header names the engine and the build it tested, not only the code',
     /engine\s+\$\{ENGINE\}/.test(v) && /statSync\(TARGET\)/.test(v));
  /* The transcript quotes suite output verbatim, and suite output quotes note
     titles and stem text out of the licensed corpus. It is a local diagnostic
     and must never become a commit. */
  const ignored = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  ok('and the transcript is gitignored, because suite output quotes licensed content',
     /^tests\/last-run\.log\s*$/m.test(ignored));
}

head('the tools the suites need are pinned, and named before they are missed');
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const dev = pkg.devDependencies || {};
  /* PINNED, NOT RANGED. A suite that measures a browser is measuring a specific
     browser: "^1.56.0" makes a green run mean "green on whatever shipped this
     week", which is not a claim anybody can act on later. */
  ok('playwright is a devDependency', !!dev.playwright, dev.playwright || 'absent');
  ok('and pinned to one exact version', /^\d+\.\d+\.\d+$/.test(dev.playwright || ''), dev.playwright || '');
  /* ts-fsrs generates tests/fixtures/fsrs-oracle.json and is used for nothing
     else. The fixture is committed, so verify-oracle runs without it — but the
     version that produced the fixture has to be recorded somewhere a person can
     find, and the fixture names it too. */
  ok('ts-fsrs is a devDependency, pinned', /^\d+\.\d+\.\d+$/.test(dev['ts-fsrs'] || ''), dev['ts-fsrs'] || 'absent');
  const fx = JSON.parse(fs.readFileSync(path.join(TESTS, 'fixtures', 'fsrs-oracle.json'), 'utf8'));
  ok('and it is the version the committed oracle was generated with',
     fx.generator && fx.generator.version === dev['ts-fsrs'],
     `${fx.generator && fx.generator.version} in the fixture, ${dev['ts-fsrs']} in package.json`);
  /* The transitive tree, so "the same versions" survives a reinstall. */
  const lockPath = path.join(ROOT, 'package-lock.json');
  ok('a lockfile is committed', fs.existsSync(lockPath));
  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const pkgs = lock.packages || {};
    ok('and it pins the same playwright the manifest asks for',
       pkgs['node_modules/playwright'] && pkgs['node_modules/playwright'].version === dev.playwright,
       (pkgs['node_modules/playwright'] || {}).version || 'not in the lockfile');
    ok('down to playwright-core, which is what actually drives the browser',
       !!(pkgs['node_modules/playwright-core'] || {}).version,
       (pkgs['node_modules/playwright-core'] || {}).version || 'not in the lockfile');
  }

  /* AN ENGINE THE HARNESS ACCEPTS IS NOT AN ENGINE THAT IS INSTALLED. firefox
     is in ENGINES and is not provisioned everywhere; without a check the run
     spawns every suite, each fails identically on a missing executable, and
     fifteen minutes later says one thing once. */
  const v = fs.readFileSync(path.join(ROOT, 'scripts', 'verify.js'), 'utf8');
  ok('the runner checks the browser exists before spawning a single suite',
     /executablePath\(\)/.test(v) && /npx playwright install/.test(v));
}

head('a suite pointed at a URL either runs whole or does not run');
{
  /* WHY THIS IS ANCHORED TO NAMES. scripts/verify.js can now be given a served
     build instead of a file, and it asks tests/_targets.js which suites that
     is safe for. A classifier checked only against its own logic proves
     nothing — so the anchors below are suites whose behaviour against a URL
     was OBSERVED, and the classifier has to agree with what happened:

       apex          threw ENOENT opening 'http://localhost:8141/index.html'
       splash-heart  finished GREEN with 8 checks where it has 14
       keys          threw ENOENT — it has no URL guard at all
       type          path.resolve made '/home/user/drnerd/http:/localhost:8141/…'
       home, physio, stage0, pearl   ran and reported in full

     splash-heart is the one that matters. The other three failed loudly, which
     is survivable; it passed, with six checks missing, which is not. Any
     rewrite of the matching that readmits it fails here. */
  const T = require('./_targets.js');

  const MUST_NOT = {
    apex: 'reads its target from disk after building the page URL',
    splash: 'the same',
    'splash-heart': 'the same, and it goes GREEN with 8 of 14 checks when it happens',
    keys: 'no URL guard — path.resolve mangles the URL',
    type: 'the same',
  };
  const MUST = ['home', 'physio', 'stage0', 'pearl', 'layout', 'theme'];

  for (const [name, why] of Object.entries(MUST_NOT)) {
    const v = T.classify(name);
    ok(`${name} is not offered a URL — ${why}`, v.capable === false, v.reason || 'classified capable');
  }
  for (const name of MUST) {
    const v = T.classify(name);
    ok(`${name} can be run against a served build`, v.capable === true, v.reason);
  }

  /* The guard alone is not the test, and this is the check that says so: all
     three of the observed failures DO carry `^https?:`. A classifier that
     looked only for it would call them capable. */
  const guarded = ['apex', 'splash', 'splash-heart'].filter(n =>
    /\^https\?:/.test(fs.readFileSync(path.join(TESTS, `verify-${n}.js`), 'utf8')));
  ok('and the three that cannot are excluded despite carrying the URL guard',
     guarded.length === 3, `${guarded.length} of 3 carry it`);

  /* Vacuity guard. If the source matching stops finding anything — a renamed
     variable, a reformat — every suite would come back "takes no target
     argument", every URL run would skip everything, and each check above would
     still pass because they assert incapability for five of them. */
  const all = T.allSuiteNames();
  const capable = all.filter(T.takesUrl);
  ok('the classifier still finds suites of both kinds', capable.length > 20 && capable.length < all.length,
     `${capable.length} capable of ${all.length}`);
  /* The precise risk is the ARGV pattern silently failing to match: a suite
     that DOES bind process.argv[2] but whose binding this cannot see comes
     back "takes no target argument", which reads like the pure-logic suites
     that genuinely take none. So the two are told apart by the source itself
     rather than by a list of names — a suite that mentions process.argv[2]
     must have been parsed. */
  const uncommented = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const mentionsArgv = all.filter(n =>
    /process\.argv\[2\]/.test(uncommented(fs.readFileSync(path.join(TESTS, `verify-${n}.js`), 'utf8'))));
  const unparsed = mentionsArgv.filter(n => T.classify(n).reason === 'takes no target argument');
  ok('every suite that binds a target argument was understood to bind one',
     unparsed.length === 0, unparsed.join(', ') || `${mentionsArgv.length} parsed, none missed`);

  /* The runner has to actually consult it. The classifier being right is no
     use if verify.js keeps its own copy of the question. */
  const v = fs.readFileSync(path.join(ROOT, 'scripts', 'verify.js'), 'utf8');
  ok('the runner asks _targets.js rather than matching for itself',
     /require\([^)]*_targets\.js[^)]*\)/.test(v) && !/function takesUrl/.test(v));
  ok('and names what it skipped instead of quietly running fewer suites',
     /urlIncapable/.test(v) && /cannot take a URL/.test(v));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
