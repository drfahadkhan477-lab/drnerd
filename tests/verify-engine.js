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
const { blankComments } = require('./_source.js');

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
    /* Blanked rather than collapsed. This replaced a whole multi-line comment
       with ONE space, which joins the code before it to the code after it —
       and every pattern below is ^-anchored with /m, so a merged line can hide
       a real launch() or invent one. */
    const code = blankComments(src);
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

  /* THE THIRD SHARED THING, AND THE ONE THAT COSTS A BROWSER RUN TO FIND.
     onScreen(page, 'home') with no marker waits on S.screen — which the
     navigation helpers set BEFORE calling render(). render hands renderNow to
     startViewTransition on a screen change, and the browser runs that
     callback only after capturing the old state, so the state flips and the
     wait returns while the render has not happened. Whatever the test reads
     next is the PREVIOUS screen's, and it reports that as an app bug.

     verify-focus did exactly this and blamed focus mode for two failures the
     app did not have. Every other call site in the tree already passed a
     marker, so this costs nothing to keep and would have turned a 20-minute
     browser run into a parse. If a call ever genuinely needs no marker, this
     going red is the place to say why. */
  const unmarked = [];
  for (const f of suites) {
    const code = blankComments(fs.readFileSync(path.join(TESTS, f), 'utf8'));
    /* Two arguments and a closing paren: a third would be the opts object
       that carries the marker. */
    if (/\bonScreen\(\s*[A-Za-z_$][\w$]*\s*,\s*(['"])[^'"]*\1\s*\)/.test(code)) unmarked.push(f);
  }
  ok('every onScreen() names a marker, so the wait is the render and not S.screen',
     unmarked.length === 0, unmarked.join(', ') || 'none');

  /* THE SAME RULE, ABOUT A DIFFERENT SHARED THING. Reading this repository's
     source as text requires blanking its comments first, because the files
     explain themselves at length and those explanations QUOTE the patterns
     being hunted — a scan that reads comments finds the paragraph warning
     about the bug and reports it as the bug. That happened three times in one
     day, in three different files, twice to the person who had just written
     the paragraph, which is precisely the shape of thing this suite exists to
     stop: one helper, not five local copies drifting apart. Two of the five
     already had: one stripped comments (shifting every index after) and one
     collapsed them to a single space (merging lines under ^-anchored /m). */
  const rolled = [];
  for (const f of suites.concat(fs.readdirSync(TESTS).filter(n => /^_.*\.js$/.test(n)))) {
    if (f === '_source.js') continue;
    const src = fs.readFileSync(path.join(TESTS, f), 'utf8');
    /* Scanned on the BLANKED copy, which is the rule applying to itself: the
       paragraph above quotes what it hunts for, and reading it would report
       this very check as a violation. The exemption is requiring _source —
       a file that uses the shared helper is not rolling its own. */
    if (/_source/.test(src)) continue;
    if (/\[\\s\\S\]\*\?\\\*\\\//.test(blankComments(src))) rolled.push(f);
  }
  ok('no suite rolls its own comment blanker — it is in tests/_source.js',
     rolled.length === 0, rolled.join(', ') || 'none');
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

  /* The cap's other message, and the same asymmetry for the same reason. Past
     sixteen contexts WebKit evicts on its own, and releasing an evicted one
     logs INVALID_OPERATION — not an exception, so nothing in the page can catch
     it. The app has one loseContext() call site and it is guarded twice over;
     eight cycles produce none of these. Chromium returns released slots, never
     reaches the cap, and so a message like this there means something real. */
  const lostMsg = 'WebGL: INVALID_OPERATION: loseContext: context already lost';
  ok('releasing a context WebKit already evicted is tolerated there',
     E.isEngineNoise(lostMsg, 'webkit'));
  ok('and stays a hard failure on Chromium, which never reaches the cap',
     !E.isEngineNoise(lostMsg, 'chromium'));
  /* The guard that message is about, asserted in the module rather than
     remembered: isContextLost() alone is not enough on WebKit. */
  const h3d = fs.readFileSync(path.join(ROOT, 'src', 'core', 'heart3d.js'), 'utf8');
  ok('and the one place that releases a context checks more than isContextLost()',
     /isContextLost\(\)[\s\S]{0,80}getParameter\(gl\.VERSION\)/.test(h3d));
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

head('no suite waits inside a page that may not survive the wait');
{
  /* TWICE IN ONE EVENING, in two suites, from the same shape:

         const settle = ms => page.evaluate(m => new Promise(r => setTimeout(r, m)), ms);
         await page.evaluate(() => new Promise(r => setTimeout(r, 500)));

     An evaluate whose entire body is a timer holds an execution context open
     in the page for the whole pause. If anything navigates or the page goes
     away in that window — and on the served build the app can navigate on its
     own, since the service worker reloads when a new one takes over — the
     wait fails, and the failure is reported as a failure OF THE WAIT:

         verify-resume      Execution context was destroyed, most likely
                            because of a navigation
         verify-heartreuse  Target page, context or browser has been closed
                            at settle (verify-heartreuse.js:84)

     Neither described what happened. One pointed at a navigation that was
     incidental and the other named the sleep as the victim. Both are
     page.waitForTimeout now, which runs in the driver, cannot be destroyed by
     anything the page does, and reports the page's death as the page's death.

     SCOPED TO SLEEP-ONLY EVALUATES on purpose. An evaluate that does real work
     AND waits has to run in the page — the work does — and moving it is not
     possible, only splitting it is. Those are left alone. What this refuses is
     the case where the evaluate exists ONLY to pass time, which never needs to
     be in the page and has now cost two debugging sessions. */
  /* THE RESOLVER PASSED STRAIGHT TO setTimeout, and nothing else — a
     backreference, so `new Promise(r => setTimeout(r, 800))` matches and
     `new Promise(r => setTimeout(() => r({ … }), 1200))` does not. The second
     is a wait that then READS something, which has to be in the page because
     the reading does. The first version of this check lacked the
     backreference and called verify-pwa:138 a violation on that basis — a
     check whose comment said "with nothing else to do" flagging something
     that had plenty. Narrowed to what it claims. */
  const SLEEP_ONLY = /\.evaluate\(\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>\s*new Promise\(\s*(\w+)\s*=>\s*setTimeout\(\s*\1\s*,/;
  const suites = fs.readdirSync(TESTS).filter(n => /^verify-.+\.js$/.test(n));
  const sleeping = [];
  let evaluates = 0;
  for (const f of suites) {
    const src = blankComments(fs.readFileSync(path.join(TESTS, f), 'utf8'));
    evaluates += (src.match(/\.evaluate\(/g) || []).length;
    /* Newlines collapsed, because the two real instances were written across
       one line and across two, and a line-by-line scan found only one. */
    const flat = src.replace(/\s+/g, ' ');
    if (SLEEP_ONLY.test(flat)) sleeping.push(f);
  }
  /* Vacuity guard: "count the sleeping evaluates and expect none" is also what
     a scan that found no evaluates at all returns. */
  ok('there are evaluates to check', evaluates > 200, `${evaluates} across ${suites.length} suites`);
  ok('and none of them is a sleep with nothing else to do',
     sleeping.length === 0, sleeping.join(', ') || 'none');
}

head('a reload is not a boot, and the split build is why');
{
  /* WHAT THIS CATCHES, found in verify-theme and not by reading it.
     page.reload() resolves on a navigation event — `load`, or worse
     `domcontentloaded`. In the SINGLE FILE that is close enough to "the app is
     running", because every line of it is inline and has executed by then. In
     the SPLIT BUILD it is not: index.html's loader fetches
     content/questions.json and only THEN injects app.js, so both events fire
     long before a single application symbol exists.

     verify-theme reloaded with `domcontentloaded`, read the pre-paint
     attributes — which is the point of that section and correct — and then
     carried straight on into a section that needs the app. Against the single
     file it passed for years. Against the served build it died with

         page.evaluate: ReferenceError: Can't find variable: setTheme

     which reads like a missing function and is a missing WAIT. That is the
     same shape as the four races tests/_render.js was written for.

     THE RULE IS "WAIT FOR SOMETHING", deliberately loose. Every other reload in
     the repository already does: booted(), a waitForFunction naming an app
     global, a waitForSelector, or a poll on `typeof S`. Requiring booted()
     specifically would have flagged five suites that are already correct —
     verify-splash reloads with `commit` precisely to catch the page BEFORE the
     app, and being made to wait for it would destroy the check. So the guard
     asks only that something between the reload and the next read is capable
     of being false before the app is up. It has no exemption list because it
     needs none. */
  const RELOAD = /await\s+page\.reload\s*\(/;
  const WAITS = /booted\s*\(|waitFor[A-Za-z]*\s*\(|typeof\s+[A-Za-z_$]/;
  const suites = fs.readdirSync(TESTS).filter(n => /^verify-.+\.js$/.test(n));
  let reloads = 0;
  const blind = [];
  for (const f of suites) {
    const lines = blankComments(fs.readFileSync(path.join(TESTS, f), 'utf8')).split('\n');
    lines.forEach((l, i) => {
      if (!RELOAD.test(l)) return;
      reloads++;
      /* AS FAR AS THE NEXT SECTION, not a fixed handful of lines. A reload
         may legitimately be followed by reads that must happen BEFORE the app
         is back — verify-theme reads the pre-paint attributes, verify-splash
         catches the splash — and the wait then comes after those. A six-line
         window called verify-theme's own fix a violation. The section is the
         real boundary: whatever a reload sets up, it sets up for the checks
         under the same heading. */
      let end = i + 1;
      while (end < lines.length && !/^\s*head\s*\(/.test(lines[end]) && end - i < 60) end++;
      if (!WAITS.test(lines.slice(i + 1, end).join('\n'))) blind.push(`${f}:${i + 1}`);
    });
  }
  /* Vacuity guard: "count the blind reloads and expect none" is also what a
     scan that found no reloads at all returns. */
  ok('there are reloads to check', reloads >= 8, `${reloads} across ${suites.length} suites`);
  ok('and every one of them waits for something afterwards',
     blind.length === 0, blind.join(', ') || 'none');
}

/* ────────────────────────────────────────────────────────────────────────────
 * A SUITE THAT DIES MUST BE ABLE TO SAY SO.
 *
 * tests/_deathnote.js prints what the page said before a suite died. It is
 * two lines to install and it is the only evidence there is when a browser
 * takes a page down — "Target page, context or browser has been closed" names
 * the survivor, never the cause. All 46 browser suites now carry one, and
 * this keeps the forty-seventh from being written without one.
 *
 * The other two checks here are both mistakes I made during the rollout, and
 * neither is visible to `node --check`:
 *
 *   · LISTENERS ABOVE THE PAGE. verify-type.js creates a page per viewport
 *     inside a loop; my listeners went on above the loop, naming a `page`
 *     that did not exist yet. That is a ReferenceError thrown from inside the
 *     handler for the crash you were trying to diagnose — the diagnostic
 *     fails exactly when it is needed. The cure is shape, not vigilance:
 *     watch() RETURNS the page, so `watch(await browser.newPage(…), events)`
 *     has no way to be written out of order. So the rule checked is that the
 *     creation and the watch are the same expression.
 *
 *   · A CATCH THAT SWALLOWS THE NOTE. Four suites ended with
 *     `})().catch(e => { console.error(e); process.exit(1); })`. A catch
 *     HANDLES the rejection, so process.on('unhandledRejection') never fires
 *     and the note never prints — a suite that looks instrumented and is not.
 *     They now pass the note's own emitter, which also moves the exception
 *     off stderr; scripts/verify.js concatenates the two pipes in no
 *     guaranteed order, and that has already cut one note in half.
 */
{
  head('every browser suite can say how it died');
  const suites = fs.readdirSync(TESTS).filter(f => /^verify-.*\.js$/.test(f)).sort();
  const browserSuites = [], noNote = [], splitWatch = [], swallowed = [];
  let watches = 0;
  for (const f of suites) {
    const code = blankComments(fs.readFileSync(path.join(TESTS, f), 'utf8'));
    /* The same test _engine.js's own guard uses, and for the same reason:
       this file discusses launch() in prose, so the scan is anchored to a
       line with no quote before the call. */
    if (!/^[^'"`\n]*\blaunch\(/m.test(code)) continue;
    browserSuites.push(f);
    if (!/require\(\s*'\.\/_deathnote(?:\.js)?'\s*\)/.test(code) || !/\bonDeath\s*\(/.test(code)) {
      noNote.push(f);
      continue;
    }
    /* Every watch() must wrap the creation. `watch(await X.newPage(…), …)` is
       the only form in which the listeners cannot precede the page. */
    for (const m of code.matchAll(/\bwatch\s*\(/g)) {
      watches++;
      const line = code.slice(code.lastIndexOf('\n', m.index) + 1,
                             (code.indexOf('\n', m.index) + 1 || code.length) - 1);
      /* The context may be awaited inside the page's own creation —
         `watch(await (await browser.newContext()).newPage(), …)` — which is
         still ONE expression and still cannot be written out of order. The
         first version of this required newPage() to follow the await
         directly and failed four honest call sites. What is actually being
         asserted is that the creation is an ARGUMENT to watch(), so that is
         what is matched. */
      if (!/\bwatch\s*\(\s*await\s[^;]*\bnewPage\s*\(/.test(line)) {
        splitWatch.push(`${f}: ${line.trim().slice(0, 60)}`);
      }
    }
    /* The tail. A handler that is not the emitter returned by onDeath() eats
       the rejection before the process ever sees it. */
    const tail = /\}\)\(\)\s*\.catch\s*\(([^\n]*)\)\s*;?\s*$/m.exec(code);
    if (tail && !/^\s*\w+\s*$/.test(tail[1])) swallowed.push(`${f}: .catch(${tail[1].trim().slice(0, 40)})`);
  }
  /* Vacuity guards, both directions. "No suite is missing a note" is also
     what a scan that found no suites returns, and "no watch() is split" is
     what a scan that found no watch() calls returns. */
  ok('there are browser suites to check', browserSuites.length >= 40, `${browserSuites.length} found`);
  ok('and watch() calls among them', watches >= 40, `${watches} found`);
  ok('every browser suite installs a death note',
     noNote.length === 0, noNote.join(', ') || 'none');
  ok('every watch() wraps the page creation, so no listener can precede its page',
     splitWatch.length === 0, splitWatch.join(' | ') || 'none');
  ok('no suite ends with a catch that would swallow the note',
     swallowed.length === 0, swallowed.join(' | ') || 'none');
}

/* ────────────────────────────────────────────────────────────────────────────
 * NO SUITE SPAWNS npm BY ITS BARE NAME.
 *
 * On Windows npm, npx, yarn and pnpm are .cmd shims, not executables. Since
 * Node 20.12 (CVE-2024-27980) spawnSync/execFileSync REFUSE to launch a .cmd
 * without shell:true — status null, no output, no error most callers look at.
 * On Linux and macOS the same call resolves a shell script and works.
 *
 * So this is a defect that cannot fail on the machine most of this was
 * written on, and it shipped: tests/verify-release.js spawned 'npm' whenever
 * npm_execpath was unset, which is every run of
 *
 *     node scripts/verify.js build/systole.html
 *
 * since nothing sets that variable outside an `npm run`. It passed here and
 * failed on the owner's laptop, inside a 22-minute full run, for a reason
 * that had nothing to do with the release gate it was checking.
 *
 * The cure is to run npm's own JavaScript entry point with process.execPath:
 * no shell, no .cmd, no PATH lookup, and the same two lines on both
 * platforms.
 *
 * NOT A BAN ON SPAWNING. git is spawned by name in several places and stays
 * that way — git.exe is a real executable and Node launches it fine. Only the
 * npm family are shims, so only they are named here.
 */
{
  head('no suite spawns a tool Windows only has as a .cmd shim');
  const suites = fs.readdirSync(TESTS).filter(f => /^verify-.*\.js$/.test(f)).sort();
  const SHIMS = /\b(?:spawnSync|spawn|execFileSync|execFile)\s*\(\s*['"](npm|npx|yarn|pnpm)['"]/;
  const bare = [];
  let spawns = 0;
  for (const f of suites) {
    const code = blankComments(fs.readFileSync(path.join(TESTS, f), 'utf8'));
    for (const line of code.split('\n')) {
      if (/\b(?:spawnSync|spawn|execFileSync|execFile)\s*\(/.test(line)) spawns++;
      const m = SHIMS.exec(line);
      if (m) bare.push(`${f}: ${m[1]}`);
    }
  }
  /* Vacuity guard: "no suite spawns npm by name" is also what a scan that
     found no spawns at all returns. */
  ok('there are spawns to check', spawns >= 5, `${spawns} across ${suites.length} suites`);
  ok('and none of them names npm, npx, yarn or pnpm directly',
     bare.length === 0, bare.join(', ') || 'none');
  /* The other half: the suite that DOES drive npm must resolve its JS entry
     point rather than trusting PATH. Checked by name because there is exactly
     one, and if a second appears this line is where it will be noticed. */
  const rel = blankComments(fs.readFileSync(path.join(TESTS, 'verify-release.js'), 'utf8'));
  ok('the one suite that drives npm runs its entry point with this node',
     /spawnSync\(process\.execPath, \[npmCli, 'run'/.test(rel));
  ok('and says so rather than comparing two nulls when it cannot find it',
     /!!npmCli, npmCli \|\| 'not found/.test(rel));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
