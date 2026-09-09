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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
