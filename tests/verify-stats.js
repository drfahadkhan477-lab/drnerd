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
const { blankComments } = require('./_source.js');
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

/* Suites registered since the last full green run. Parsed once, because the
   record is stale for them in BOTH directions: they are missing from it, and
   any number derived from it cannot account for them either. */
const PENDING = (() => {
  const v = read('scripts/verify.js');
  const block = v.slice(v.indexOf('const PENDING_RECORD = ['));
  return [...block.slice(0, block.indexOf('];') + 2).matchAll(/'([a-z0-9-]+)'/g)].map(m => m[1]);
})();

head('every registered suite is in the record');
{
  /* Read out of the runner's own registry, so adding a suite and forgetting to
     regenerate is caught here rather than by a number quietly being too low. */
  const v = read('scripts/verify.js');
  const block = v.slice(v.indexOf('const SUITES = ['), v.indexOf('\n];', v.indexOf('const SUITES = [')));
  const registered = [...block.matchAll(/^\s*\['([a-z0-9-]+)',/gm)].map(m => m[1]);
  ok('the registry was found and is not empty', registered.length > 30, `${registered.length} suites`);
  /* A suite registered since the last full green run is absent from the record
     for a legitimate reason, and scripts/verify.js says which ones those are.
     The declaration is the point: an undeclared absence is still the defect
     this block was written for — a suite registered and then quietly never
     run, visible only as a total that is mysteriously too low. */
  const missing = registered.filter(n => !(n in stats.suites) && !PENDING.includes(n));
  const stale = Object.keys(stats.suites).filter(n => !registered.includes(n));
  ok('no registered suite is missing from the record without saying so', missing.length === 0,
     missing.join(', ') || 'none');
  /* Both directions, because a one-way check would let a name be parked in
     PENDING_RECORD forever to silence a real gap. An entry that the record has
     since caught up with fails here, so the next full green run forces it out. */
  ok('nothing is declared pending that is not a registered suite',
     PENDING.every(n => registered.includes(n)),
     PENDING.filter(n => !registered.includes(n)).join(', ') || 'none');
  ok('and nothing is still declared pending that the record already holds',
     PENDING.every(n => !(n in stats.suites)),
     PENDING.filter(n => n in stats.suites).join(', ') || 'none');
  ok('and the record holds nothing that is no longer a suite', stale.length === 0,
     stale.join(', ') || 'none');
  ok('every recorded suite reported at least one check', !Object.entries(stats.suites).some(([, n]) => !(n > 0)),
     Object.entries(stats.suites).filter(([, n]) => !(n > 0)).map(([k]) => k).join(', ') || 'none');
}

/* How long the patch chain is, derived from the chain itself. Three sentences
   quote this number and none of them was checked, so all three had drifted:
   docs/BUILD.md said fifty-six, scripts/build.js said fifty-six, package.json
   said 64, and the chain was 73. Nobody had been careless — the number moves
   whenever a step is added, which is exactly the kind of fact prose loses and
   a derivation keeps. */
const chainLength = ((read('scripts/build.js').match(/const CHAIN = \[([\s\S]*?)\];/) || [, ''])[1]
                     .match(/'[^']+'/g) || []).length;

/* The honest CI number, derived rather than quoted: whichever suites the
   workflow actually invokes, summed from what they actually reported. */
const yml = read('.github/workflows/verify.yml');
const ciSuites = [...yml.matchAll(/node\s+tests\/verify-([a-z0-9-]+)\.js/g)].map(m => m[1]);
const ciTotal = ciSuites.reduce((n, s) => n + (stats.suites[s] || 0), 0);

head('CI runs what the workflow says it runs');
{
  ok('the workflow invokes some suites directly', ciSuites.length > 0, ciSuites.join(', '));
  /* A suite the workflow runs but the record has not measured yet is the same
     staleness PENDING_RECORD already declares above, seen from the other side.
     It contributes 0 to ciTotal, so the arithmetic below is unaffected, and the
     next full green run removes it from PENDING_RECORD and from this exemption
     in one move. */
  const unknown = ciSuites.filter(s => !(s in stats.suites) && !PENDING.includes(s));
  ok('and every one of them is a suite the record knows', unknown.length === 0, unknown.join(', ') || 'none');
  /* Each step is labelled "(N checks)". A label is documentation that sits
     directly beside the command, which makes it the most likely of all these
     numbers to be read and the least likely to be updated. */
  const labels = [...yml.matchAll(/name:\s*(.+?)\((\d+)\s+checks\)\s*\n\s*run:\s*node\s+tests\/verify-([a-z0-9-]+)\.js/g)];
  ok('every directly-invoked suite carries a labelled count',
     labels.length === ciSuites.length, `${labels.length} labelled of ${ciSuites.length}`);
  /* Same exemption, same reason: there is no recorded count to compare a
     pending suite's label against. Everything else is held to it exactly. */
  const wrong = labels.filter(m => !PENDING.includes(m[3]) && stats.suites[m[3]] !== +m[2])
                      .map(m => `${m[3]}: says ${m[2]}, is ${stats.suites[m[3]]}`);
  ok('and each label is the count that suite reported', wrong.length === 0, wrong.join('; ') || 'none');
}

head('CI runs everything it is capable of running');
{
  /* THE OTHER DIRECTION, and the one that was missing. Everything above asks
     whether the suites the workflow names are real and correctly labelled. It
     never asked whether a suite the workflow COULD run is absent from it — and
     one was: verify-cause-pure, registered in scripts/verify.js, 32 checks, no
     browser, and the workflow had never heard of it. Nineteen green steps read
     as "the logic suites pass", which is exactly the shape CLAUDE.md warns
     about: a guard with a hole in it is worse than no guard, because the
     surrounding green reads as coverage of the whole paragraph.

     Two lists maintained by hand will drift again, so the workflow is held to
     the registry rather than to whoever remembers. tests/_targets.js decides
     what "capable" means and is conservative in the direction that matters —
     see runsInCI() there. */
  const { runsInCI } = require('./_targets.js');
  const registered = [...read('scripts/verify.js')
    .matchAll(/\[\s*'([a-z0-9-]+)',\s*'/g)].map(m => m[1]);
  ok('the registry was read', registered.length > 40, `${registered.length} suites`);
  const able = registered.filter(n => runsInCI(n).able);
  ok('and some of them need no browser at all', able.length > 5, `${able.length} of ${registered.length}`);
  const missing = able.filter(n => !ciSuites.includes(n));
  ok('every suite CI can run, CI runs', missing.length === 0,
     missing.length ? missing.join(', ') + ' — registered, browser-free, not in the workflow' : 'none missing');
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
    /* THE LINE BETWEEN THE OTHER TWO, WHICH IS HOW IT DRIFTED. The command
       block in the README has three numbers in it and only two of them were
       guarded — this one sat between them, said "+ 76 more on the split build"
       while the real figure had been 93 for some time, and nothing noticed. A
       guard with a hole in it is worse than no guard, because the surrounding
       green reads as coverage of the whole block. */
    ['README.md', 'the split-build count in the command block',
     /#\s*\+\s*(\d+)\s+more on the split build/, r => [+r[1] === stats.pwa]],
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
    /* THE ONE UNGUARDED SENTENCE IN A BLOCK OF GUARDED ONES. The header
       describing the logic job opened "the nine suites that are pure Node" and
       still said nine when there were eighteen — it had been maintained by
       hand while every number around it was checked, so the surrounding green
       read as coverage of the paragraph. Same hole, same shape, as the split-
       build line in the README.

       This one is a fact about the workflow rather than about the record, so
       it is compared against the suites the file actually invokes — which
       means it is true today rather than after the next full run. */
    ['.github/workflows/verify.yml', 'the size of the logic job',
     /the (\d+) suites that are pure Node/, r => [+r[1] === ciSuites.length]],
    ['docs/BUILD.md', 'the length of the patch chain',
     /The chain is (\d+) patch scripts/, r => [+r[1] === chainLength]],
    ['scripts/build.js', 'the length of the patch chain',
     /applying (\d+) patch scripts/, r => [+r[1] === chainLength]],
    ['package.json', 'the length of the patch chain',
     /standard library and (\d+) patch scripts/, r => [+r[1] === chainLength]],
    /* CLAUDE.md tells the next agent "if you write a sentence containing a
       number, guard it or do not write it". It had one unguarded sentence of
       its own when it was written. This is that sentence. */
    ['CLAUDE.md', 'the length of the patch chain',
     /holds `CHAIN`: (\d+) steps/, r => [+r[1] === chainLength]],
  ];
  for (const [file, what, re, judge] of claims) {
    const m = read(file).match(re);
    if (!m) { ok(`${file}: ${what} is where it is expected`, false, 'sentence not found — reworded?'); continue; }
    const verdicts = judge(m);
    ok(`${file}: ${what}`, verdicts.every(Boolean), verdicts.every(Boolean) ? m[0].replace(/\s+/g, ' ').slice(0, 72) : `says "${m[0].replace(/\s+/g, ' ').slice(0, 72)}"`);
  }
}

head('the chain is as long as the prose says');
{
  ok('the chain has steps to count', chainLength > 0, `${chainLength} steps`);
  /* Vacuity guard: a derivation that silently returns zero would make every
     claim above compare 0 against 0 the moment somebody reformats the array. */
  const onDisk = fs.readdirSync(path.join(ROOT, 'scripts')).filter(f => f.endsWith('-patch.js')).length;
  ok('and every step in it has a patch script on disk', chainLength === onDisk,
     `${chainLength} in CHAIN, ${onDisk} scripts`);
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


/* ── a check that cannot fail is a number that means nothing ─────────────── */
/* THIS FILE'S OWN PREMISE, APPLIED ONE LEVEL DOWN. Everything above holds the
   documentation to the recorded totals. That is only worth doing if the totals
   themselves mean something, and "1758 checks" means nothing if some of those
   checks are incapable of failing. The count goes up, the confidence goes up,
   and nothing was measured.

   Two real instances, both found by sweeping for this shape rather than by
   noticing them:

     · verify-render.js asserted `ok('booted() returns once state and the first
       render are both up', true)` on the reasoning that a throw inside
       booted() means the line is never reached. That is exactly what made it
       worthless: booted() rejecting takes the suite down as an unhandled
       rejection, printing no FAIL and leaving the count wrong, so the one
       failure it described is the one it could not report.
     · verify-splash-heart.js counted a SKIP as a pass — `ok('(skipped file
       content checks …)', true)` — so "14 passed" meant thirteen things
       verified and one thing declined.

   Scoped deliberately to conditions that are literally constant. A wider sweep
   was tried first and abandoned on the evidence: 203 assertions in this repo
   are "absence" checks (=== null, .length === 0, a negated regex), and reading
   them showed the overwhelming majority are the POINT of the check — "null,
   not 0, because 0 would read as never". A lint with that false-positive rate
   would be ignored within a week, which is worse than no lint. Constant
   conditions have no such defence.

   Parenthesis walking with comments blanked, for the reasons tests/verify-
   render.js documents: predicates contain commas and braces, and an apostrophe
   inside a comment will otherwise open a string that swallows the rest. */
head('no assertion is incapable of failing');
{
  const CONSTANT = [
    [/^\s*true\s*$/,               'literal true'],
    [/^\s*!\s*(false|0)\s*$/,      'negated falsy literal'],
    [/^\s*!!\s*(true|1)\s*$/,      'double-negated truthy literal'],
    [/^\s*1\s*$/,                  'literal 1'],
    [/\.length\s*>=\s*0\s*$/,      'length >= 0, true of every array'],
  ];

  const dir = path.join(__dirname);
  const bad = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.js')) continue;
    const src = blankComments(fs.readFileSync(path.join(dir, name), 'utf8'));
    const re = /\bok\(/g;
    let m;
    while ((m = re.exec(src))) {
      let i = m.index + m[0].length, depth = 1, inS = null, start = i;
      const parts = [];
      for (; i < src.length && depth > 0; i++) {
        const c = src[i];
        if (inS) { if (c === '\\') { i++; continue; } if (c === inS) inS = null; continue; }
        if (c === "'" || c === '"' || c === '`') { inS = c; continue; }
        if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) depth--;
        if (depth === 0) break;
        if (c === ',' && depth === 1) { parts.push(src.slice(start, i)); start = i + 1; }
      }
      parts.push(src.slice(start, i));
      if (parts.length < 2) continue;
      const why = (CONSTANT.find(([p]) => p.test(parts[1])) || [])[1];
      if (why) bad.push(`${name}:${src.slice(0, m.index).split('\n').length} (${why})`);
    }
  }
  ok('every ok() has a condition that could come out false',
     bad.length === 0, bad.slice(0, 8).join(', ') || 'none');

  /* The lint is only worth having if it can fire, and the cheapest way to be
     sure is to hand it the shape it hunts for. */
  const probe = (cond) => CONSTANT.some(([p]) => p.test(cond));
  ok('and it recognises the shapes it is looking for',
     probe(' true ') && probe('x.length >= 0') && probe(' 1 ') && !probe('a === b') &&
     !probe('list.length === 0') && !probe('found !== null'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
