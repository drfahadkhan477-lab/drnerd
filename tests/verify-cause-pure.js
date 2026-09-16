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
const { causeOf, noteOf } = require('../scripts/cause.js');

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

head('a death note does not displace the cause');
{
  /* tests/_deathnote.js prints what the page said before a suite died, between
     the last check and the exception. Everything it adds lands in the tail this
     reads, so the two have to be checked together or the note quietly becomes
     the answer — which is the whole bug this suite was written for, reoccurring
     one layer up. */
  const { deathNote } = require('./_deathnote.js');
  const err = new Error('page.setViewportSize: Target page, context or browser has been closed');
  const out = [
    '  PASS  the caption states both figures  → Seen 42%',
    'Mastered 16%',
    ...deathNote(err, {
      section: 'the dismiss button is never buried under the Apex button',
      checks: 51,
      /* BARE, not "Unhandled Promise Rejection: …". This fixture used the
         wrapped form and the check below passed without the skip in causeOf
         that it exists to hold — the wrapped form is not error-shaped, so it
         never reached the code path being tested. The check was measuring
         something narrower than its label. */
      errors: ["TypeError: null is not an object (evaluating 'el.getBoundingClientRect')",
               "TypeError: null is not an object (evaluating 'el.getBoundingClientRect')"],
    }),
    'Error: page.setViewportSize: Target page, context or browser has been closed',
    '    at /home/user/drnerd/tests/verify-home.js:473:18',
  ].join('\n');
  ok('the exception still wins over the note above it',
     /^Error: page\.setViewportSize/.test(causeOf(out)), causeOf(out));

  const lines = deathNote(err, { section: 's', checks: 1, errors: [] });
  ok('its heading is in the form cause.js skips', /^── /.test(lines[1].trim()), lines[1].trim());
  ok('an empty collection says so rather than printing nothing',
     lines.some(l => /logged nothing at all/.test(l)));
  ok('repeats are collapsed — one broken resource logs on every render',
     deathNote(err, { errors: ['same', 'same', 'same'] }).filter(l => l.trim() === 'same').length === 1);
  ok('and a flood is capped',
     deathNote(err, { errors: Array.from({ length: 50 }, (_, i) => 'e' + i) })
       .some(l => /and 30 more/.test(l)));
}

head('and the note itself reaches the summary, not only the log');
{
  /* The runner prints a died suite's cause, then filters the rest of its
     output to lines opening with FAIL, Error, TypeError or ReferenceError. A
     note's lines open with none of those, so the first suite to leave one had
     it written to tests/last-run.log and shown nowhere — which for the reader
     is the same as the evidence having been thrown away one step earlier. */
  const { deathNote } = require('./_deathnote.js');
  const err = new Error('page.setViewportSize: Target page, context or browser has been closed');
  const out = [
    '  PASS  a newcomer sees it',
    ...deathNote(err, {
      section: 'the dismiss button is never buried under the Apex button',
      checks: 50,
      errors: ["TypeError: null is not an object (evaluating 'x.getBoundingClientRect')",
               'Failed to load resource: the server responded with a status of 404 (Not Found)'],
    }),
    'Error: page.setViewportSize: Target page, context or browser has been closed',
    '    at /home/user/drnerd/tests/verify-home.js:473:18',
    'Node.js v22.22.2',
  ].join('\n');
  const body = noteOf(out);
  ok('the old filter showed none of it',
     out.split('\n').filter(l => /^\s*FAIL\s/.test(l) || /^\s*(Error|TypeError|ReferenceError)/.test(l))
        .every(l => !/last section reached|checks completed|Unhandled/.test(l)));
  ok('the section reached is in the note', body.some(l => /^last section reached: the dismiss/.test(l)), body[0]);
  ok('a note with no section says so rather than omitting the line',
     deathNote(err, {}).some(l => /last section reached: none/.test(l)));
  ok('and an unknown check count is visible rather than absent',
     deathNote(err, {}).some(l => /checks completed: unknown/.test(l)));
  ok('so is the count', body.some(l => l === 'checks completed: 50'));
  ok('so is what the page logged, even error-shaped',
     body.some(l => /^TypeError: null is not an object/.test(l)), String(body.length) + ' lines');
  ok('and the line after it, which a content boundary would have cut off',
     body.some(l => /Failed to load resource/.test(l)));
  ok('the exception is NOT — report() prints that itself',
     body.every(l => !/^Error: page\.setViewportSize/.test(l)));
  ok('nor is the heading, which report() does not need to repeat',
     body.every(l => !/what the page said/.test(l)));
  ok('output with no note yields nothing rather than guessing',
     noteOf('  PASS  a\nTypeError: boom\n').length === 0);
  ok('and a long note is capped', noteOf([
       '  PASS  a', ...deathNote(err, { errors: Array.from({ length: 40 }, (_, i) => 'e' + i) }),
     ].join('\n'), 5).length === 6, `${noteOf(['  PASS  a', ...deathNote(err, { errors: Array.from({ length: 40 }, (_, i) => 'e' + i) })].join('\n'), 5).length} lines`);
}

head('it stays one line in a table');
{
  const long = '  PASS  a\n' + 'locator.click: ' + 'x'.repeat(400);
  ok('a long message is truncated', causeOf(long).length === 96, `${causeOf(long).length} chars`);
  ok('and never carries a newline', causeOf(HOME).indexOf('\n') < 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
