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
  ok('and the choice reaches the suites through the environment',
     (v.match(/SYSTOLE_ENGINE:\s*ENGINE/g) || []).length >= 2,
     `${(v.match(/SYSTOLE_ENGINE:\s*ENGINE/g) || []).length} spawn site(s)`);
  ok('the split-build run gets it too, not just the file-path suites',
     /verify-pwa\.js[\s\S]{0,400}SYSTOLE_ENGINE/.test(v));
  ok('an unusable engine name stops the run instead of starting thirty-four browsers',
     /ENGINES\.includes\(ENGINE\)/.test(v));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
