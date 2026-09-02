#!/usr/bin/env node
/*
 * The numbers in the documentation are the numbers the tests actually
 * produced — in bare Node, no browser, no build.
 *
 *   node tests/verify-stats.js
 *
 * WHY THIS EXISTS. Three files quote how many checks this project has:
 * README.md, docs/BUILD.md and .github/workflows/verify.yml. They were kept in
 * step by hand, which worked exactly as well as that always works — at the time
 * this was written the CI header claimed both "the other 1052" and "those 1210
 * checks" for the same quantity, because a total moved and only some of the
 * sentences moved with it. Nobody was lying; a person edited three files from
 * memory eight times and got one of them wrong.
 *
 * So scripts/verify.js now writes tests/test-stats.json from a full green run,
 * and this suite holds the prose to it. A count in a document is now a claim
 * that fails a check when it is false, which is the only kind of claim worth
 * writing down.
 *
 * It also derives the CI number rather than trusting it: the suites CI runs
 * are parsed out of the workflow itself and their recorded counts summed. That
 * makes "this workflow runs N" a fact about the workflow instead of a
 * statement about it.
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
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let found = null;
try { found = JSON.parse(read('tests/test-stats.json')); } catch (_) {}

/* Every check below runs whether or not the record exists, against a sentinel
   that fails all of them. Bailing out early would make this suite report a
   different NUMBER of checks depending on whether it passes — and that number
   is itself part of the total the record holds, so the record would never
   settle: each run would rewrite the total that the next run tests against.
   A suite whose size depends on its result cannot be counted. */
const stats = found || { engine: null, suiteCount: -1, total: -1, pwa: null, suites: {} };

head('the record exists, and is a record of a whole run');
ok('tests/test-stats.json is present and parses', !!found,
   found ? '' : 'regenerate with: node scripts/verify.js build/systole.html --pwa');
ok('it was produced on the default engine, so it describes the documented run',
   stats.engine === 'chromium', String(stats.engine));
ok('the total is the sum of the per-suite counts, not a separately kept number',
   stats.total === Object.values(stats.suites).reduce((a, b) => a + b, 0),
   `${stats.total} vs ${Object.values(stats.suites).reduce((a, b) => a + b, 0)}`);
ok('the suite count matches the suites recorded',
   stats.suiteCount === Object.keys(stats.suites).length,
   `${stats.suiteCount} vs ${Object.keys(stats.suites).length}`);
ok('the split build was measured too', Number.isInteger(stats.pwa), String(stats.pwa));

head('every registered suite is in the record');
{
  /* Read out of the runner's own registry, so adding a suite and forgetting to
     regenerate is caught here rather than by a number quietly being too low. */
  const v = read('scripts/verify.js');
  const block = v.slice(v.indexOf('const SUITES = ['), v.indexOf('\n];', v.indexOf('const SUITES = [')));
  const registered = [...block.matchAll(/^\s*\['([a-z0-9-]+)',/gm)].map(m => m[1]);
  ok('the registry was found and is not empty', registered.length > 30, `${registered.length} suites`);
  const missing = registered.filter(n => !(n in stats.suites));
  const stale = Object.keys(stats.suites).filter(n => !registered.includes(n));
  ok('no registered suite is missing from the record', missing.length === 0,
     missing.join(', ') || 'none');
  ok('and the record holds nothing that is no longer a suite', stale.length === 0,
     stale.join(', ') || 'none');
  ok('every recorded suite reported at least one check', !Object.entries(stats.suites).some(([, n]) => !(n > 0)),
     Object.entries(stats.suites).filter(([, n]) => !(n > 0)).map(([k]) => k).join(', ') || 'none');
}

/* The honest CI number, derived rather than quoted: whichever suites the
   workflow actually invokes, summed from what they actually reported. */
const yml = read('.github/workflows/verify.yml');
const ciSuites = [...yml.matchAll(/node\s+tests\/verify-([a-z0-9-]+)\.js/g)].map(m => m[1]);
const ciTotal = ciSuites.reduce((n, s) => n + (stats.suites[s] || 0), 0);

head('CI runs what the workflow says it runs');
{
  ok('the workflow invokes some suites directly', ciSuites.length > 0, ciSuites.join(', '));
  const unknown = ciSuites.filter(s => !(s in stats.suites));
  ok('and every one of them is a suite the record knows', unknown.length === 0, unknown.join(', ') || 'none');
  /* Each step is labelled "(N checks)". A label is documentation that sits
     directly beside the command, which makes it the most likely of all these
     numbers to be read and the least likely to be updated. */
  const labels = [...yml.matchAll(/name:\s*(.+?)\((\d+)\s+checks\)\s*\n\s*run:\s*node\s+tests\/verify-([a-z0-9-]+)\.js/g)];
  ok('every directly-invoked suite carries a labelled count',
     labels.length === ciSuites.length, `${labels.length} labelled of ${ciSuites.length}`);
  const wrong = labels.filter(m => stats.suites[m[3]] !== +m[2])
                      .map(m => `${m[3]}: says ${m[2]}, is ${stats.suites[m[3]]}`);
  ok('and each label is the count that suite reported', wrong.length === 0, wrong.join('; ') || 'none');
}

head('the prose agrees with the record');
{
  /* Each of these is one sentence somebody would otherwise maintain from
     memory. The pattern is deliberately anchored to distinctive words rather
     than to line numbers, so rewording the surrounding paragraph is free and
     changing the number is not. */
  const claims = [
    ['README.md', 'the headline count and suite count',
     /#\s*(\d+)\s+checks,\s*(\d+)\s+suites/, r => [+r[1] === stats.total, +r[2] === stats.suiteCount]],
    ['README.md', 'the badge caveat',
     /badge is not the (\d+) \+ (\d+) checks above — read it as (\d+), not (\d+)\./,
     r => [+r[1] === stats.total, +r[2] === stats.pwa, +r[3] === ciTotal, +r[4] === stats.total + stats.pwa]],
    ['docs/BUILD.md', 'the --pwa command comment',
     /→\s*(\d+)\s*\+\s*(\d+)\s+checks/, r => [+r[1] === stats.total, +r[2] === stats.pwa]],
    ['docs/BUILD.md', 'the suites paragraph',
     /(\d+) suites, (\d+) checks, plus (\d+) more on the split build/,
     r => [+r[1] === stats.suiteCount, +r[2] === stats.total, +r[3] === stats.pwa]],
    ['.github/workflows/verify.yml', 'the "read this before trusting a green checkmark" header',
     /Of the (\d+) checks in[\s\S]{0,120}?plus (\d+) more under `--pwa`, this workflow runs (\d+)\./,
     r => [+r[1] === stats.total, +r[2] === stats.pwa, +r[3] === ciTotal]],
    ['.github/workflows/verify.yml', 'the count of what CI cannot run',
     /The other (\d+) all drive/, r => [+r[1] === stats.total + stats.pwa - ciTotal]],
    ['.github/workflows/verify.yml', 'the same figure, second mention',
     /there is no way to run those (\d+) checks here/, r => [+r[1] === stats.total + stats.pwa - ciTotal]],
    ['.github/workflows/verify.yml', 'the same figure, third mention',
     /Adding the other (\d+) checks to this file/, r => [+r[1] === stats.total + stats.pwa - ciTotal]],
    ['.github/workflows/verify.yml', 'the honest subset total',
     /(\d+) real checks/, r => [+r[1] === ciTotal]],
  ];
  for (const [file, what, re, judge] of claims) {
    const m = read(file).match(re);
    if (!m) { ok(`${file}: ${what} is where it is expected`, false, 'sentence not found — reworded?'); continue; }
    const verdicts = judge(m);
    ok(`${file}: ${what}`, verdicts.every(Boolean), verdicts.every(Boolean) ? m[0].replace(/\s+/g, ' ').slice(0, 72) : `says "${m[0].replace(/\s+/g, ' ').slice(0, 72)}"`);
  }
}

head('the arithmetic in the header is self-consistent');
{
  /* This is the check that would have caught the drift that prompted the whole
     exercise: two different numbers in one file for one quantity. */
  const nums = [...yml.matchAll(/The other (\d+) all drive|those (\d+) checks here|Adding the other (\d+) checks/g)]
    .map(m => +(m[1] || m[2] || m[3]));
  ok('every mention of "what CI cannot run" is the same number',
     new Set(nums).size <= 1, nums.join(' vs ') || 'none found');
  ok('and it is exactly what is left over', nums.every(n => n === stats.total + stats.pwa - ciTotal),
     `${stats.total} + ${stats.pwa} − ${ciTotal} = ${stats.total + stats.pwa - ciTotal}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
