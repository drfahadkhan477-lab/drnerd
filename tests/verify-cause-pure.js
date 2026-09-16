#!/usr/bin/env node
/*
 * What the runner says a dead suite died of.
 *
 *   node tests/verify-cause-pure.js
 *
 * No browser and no build: scripts/cause.js turns a child suite's captured
 * stdout into one line for the summary table, and the input is a string.
 *
 * THIS SUITE EXISTS BECAUSE THE FIRST VERSION WAS WRONG IN A WAY THAT READ AS
 * WORKING. It scanned the output from the top and returned the first line that
 * was not furniture, which on the first suite it met produced:
 *
 *     home           did not report  (21s)  — 51 had passed first
 *         Mastered 16%
 *
 * "Mastered 16%" is the second line of a PASS detail — verify-home.js:125
 * passes .hp-legend textContent, that element holds two spans, and the newline
 * between them wrapped the check's own output onto a line with no PASS prefix.
 * The runner presented it as the cause of a crash, and it is not even an error.
 *
 * Every case below is a shape that was actually printed by a real run, not an
 * invented one, because the failure this guards against is a filter tuned to
 * prose nobody has seen.
 */
'use strict';
const { causeOf } = require('../scripts/cause.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

/* The shape verify-home.js produced on WebKit against the served split build:
   a wrapped PASS detail early, then the death at the bottom. */
const HOME = [
  '',
  '── the progress card ──',
  '  PASS  the bar has both a coverage layer and a mastery layer  → seen 42%, mastered 16%',
  '  PASS  the caption states both figures  → Seen 42%',
  'Mastered 16%',
  '  PASS  a highlight sweeps the bar',
  '',
  'node:internal/process/promises:394',
  '            triggerUncaughtException(err, true /* fromPromise */);',
  '            ^',
  '',
  'page.evaluate: Target crashed',
  '    at /home/user/drnerd/tests/verify-home.js:213:31',
  '',
  'Node.js v22.22.2',
].join('\n');

head('the cause is at the end of the output, not the start');
{
  ok('a wrapped PASS detail is not the cause',
     causeOf(HOME) !== 'Mastered 16%', causeOf(HOME));
  ok('the thrown message is', causeOf(HOME) === 'page.evaluate: Target crashed',
     causeOf(HOME));
}

head('the shapes a dead suite actually dies in');
{
  const goto = [
    '  PASS  it loads',
    '',
    'node:internal/process/promises:394',
    '            triggerUncaughtException(err, true /* fromPromise */);',
    '            ^',
    '',
    'page.goto: Timeout 200000ms exceeded.',
    'Call log:',
    '  - navigating to "file:///home/user/drnerd/build/systole.html"',
    '    at async /home/user/drnerd/tests/verify-keys.js:40:3',
    '',
    'Node.js v22.22.2',
  ].join('\n');
  ok('a Playwright timeout, which opens with an API path and not with Error',
     causeOf(goto) === 'page.goto: Timeout 200000ms exceeded.', causeOf(goto));

  const ref = [
    '  PASS  the themes are all reachable',
    '',
    '/home/user/drnerd/tests/verify-theme.js:143',
    "    document.querySelector('[onclick=\"setTheme(\\'nocturne\\')\"]').click();",
    '    ^',
    '',
    "ReferenceError: Can't find variable: setTheme",
    '    at eval (eval at evaluate (:234:30), <anonymous>:1:1)',
    '',
    'Node.js v22.22.2',
  ].join('\n');
  ok('a ReferenceError, past the file header and the echoed source line',
     causeOf(ref) === "ReferenceError: Can't find variable: setTheme", causeOf(ref));

  const closed = [
    '  PASS  four cycles leave four contexts',
    '',
    'browserContext.newPage: Target page, context or browser has been closed',
    '    at /home/user/drnerd/tests/verify-heartreuse.js:88:24',
  ].join('\n');
  ok('a closed target, where there is no node furniture at all',
     causeOf(closed) === 'browserContext.newPage: Target page, context or browser has been closed',
     causeOf(closed));
}

head('an error-shaped line outranks a plain one inside the same tail');
{
  /* The bad case for a positional rule on its own: the LAST check's detail
     wraps, so the first line of the tail is app text and the exception is
     below it. Position finds the tail; the error shape picks within it. */
  const wrapped = [
    '  PASS  the caption states both figures  → Seen 42%',
    'Mastered 16%',
    '',
    'TypeError: Cannot read properties of undefined (reading \'u\')',
    '    at /home/user/drnerd/tests/verify-figzoom.js:428:29',
  ].join('\n');
  ok('the exception wins over the detail above it',
     causeOf(wrapped) === "TypeError: Cannot read properties of undefined (reading 'u')",
     causeOf(wrapped));
}

head('what it does when there is nothing to find');
{
  ok('empty output says nothing rather than something', causeOf('') === '');
  ok('undefined is not an exception', causeOf(undefined) === '');
  ok('output that is only checks says nothing — the death left no trace',
     causeOf('  PASS  a\n  FAIL  b  → x\n') === '');
  /* A suite that dies before its first check has no PASS boundary, so the
     whole output is the tail. Scanning from the top would also get this one
     right, which is exactly why it is not evidence on its own. */
  const early = [
    'node:internal/process/promises:394',
    '            triggerUncaughtException(err, true /* fromPromise */);',
    '            ^',
    '',
    "Error: SYSTOLE_ENGINE=\"chrome\" is not an engine. Use one of: chromium, webkit, firefox.",
    '    at engineName (/home/user/drnerd/tests/_engine.js:44:11)',
    '',
    'Node.js v22.22.2',
  ].join('\n');
  ok('a suite that died before its first check still reports',
     /^Error: SYSTOLE_ENGINE/.test(causeOf(early)), causeOf(early));
}

head('it stays one line in a table');
{
  const long = '  PASS  a\n' + 'locator.click: ' + 'x'.repeat(400);
  ok('a long message is truncated', causeOf(long).length === 96, `${causeOf(long).length} chars`);
  ok('and never carries a newline', causeOf(HOME).indexOf('\n') < 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
