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

/* THE REGISTRY, READ ONCE AND BOUNDED TO THE ARRAY IT LIVES IN.
   Two blocks below used to read it separately, with different patterns: one
   bounded to the SUITES array, one scanning the whole of scripts/verify.js.
   They disagreed by two, and a real run printed both — "86 suites" in one
   check and "88 suites" in another, which is a guard reporting confidently
   about a quantity it had got wrong. The whole-file scan matched `['--only',`
   out of a usage string and counted `focus` and `stage0` twice, because both
   appear again in PENDING_RECORD and SERIAL.

   Nothing failed because of it — runsInCI() happens to call a name with no
   suite file not-able — so it passed while feeding a polluted list to the
   check whose whole job is noticing a browser-free suite missing from the
   workflow. One read now, and the check below proves it is clean rather than
   trusting the pattern. */
function registrySuites() {
  const v = read('scripts/verify.js');
  const open = v.indexOf('const SUITES = [');
  const block = v.slice(open, v.indexOf('\n];', open));
  return [...block.matchAll(/^\s*\['([a-z0-9-]+)',/gm)].map(m => m[1]);
}

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
  const registered = registrySuites();
  ok('the registry was found and is not empty', registered.length > 30, `${registered.length} suites`);
  /* THE READ ITSELF IS CHECKED, not just its size. Every registered name must
     have a suite file on disk — which is what a name scraped out of a flag or
     a second array cannot have, and is how `--only` would be caught now. */
  const noFile = registered.filter(n => !fs.existsSync(path.join(ROOT, 'tests', `verify-${n}.js`)));
  ok('and every name in it has a suite file on disk', noFile.length === 0, noFile.join(', ') || 'none');
  ok('and none is registered twice', new Set(registered).size === registered.length,
     `${new Set(registered).size} distinct of ${registered.length}`);
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
const chainSteps = ((read('scripts/build.js').match(/const CHAIN = \[([\s\S]*?)\];/) || [, ''])[1]
                    .match(/'[^']+'/g) || []).map(s => s.slice(1, -1));
const chainLength = chainSteps.length;

/* The honest CI number, derived rather than quoted: whichever suites the
   workflow actually invokes, summed from what they actually reported. */
const yml = read('.github/workflows/verify.yml');
const ciSuites = [...yml.matchAll(/node\s+tests\/verify-([a-z0-9-]+)\.js/g)].map(m => m[1]);
const ciTotal = ciSuites.reduce((n, s) => n + (stats.suites[s] || 0), 0);
/* THE ONES OF THOSE THAT NEED NO BROWSER, which is what three sentences
   below actually count ("pure Node", "need neither a browser nor a build",
   "need no browser"). They were compared against every suite the workflow
   invokes, which was the same number while every suite it invoked was pure.
   The memorizer-browser job made it two more, and the guard then demanded
   that the prose call two browser suites pure Node — a guard insisting on a
   false sentence.

   "Uses a browser" is decided exactly as verify-engine decides it for its
   own rule that every browser suite goes through tests/_engine.js: a
   launch( call in statement position, or require('playwright'), in the
   comment-blanked source. Two shorter tests were tried first and both were
   wrong about verify-engine, which is pure Node: tests/_targets.js's
   runsInCI() (it answers "can CI run this" and says no, because
   verify-engine reads _engine.js), and "requires _engine" (it does, to test
   it, and never launches anything). The check below caught both. */
const launches = n => {
  const code = blankComments(fs.readFileSync(path.join(__dirname, `verify-${n}.js`), 'utf8'));
  return /^[^'"`\n]*require\(\s*'playwright'\s*\)/m.test(code) || /^[^'"`\n]*\blaunch\(/m.test(code);
};
const pureCI = ciSuites.filter(n => !launches(n));

head('the workflow is one GitHub can read');
{
  /* A step name with ": " in it is a YAML mapping inside a plain scalar,
     and GitHub rejects the WHOLE FILE: the run is created and fails in the
     same second with no jobs at all. Two Memorizer step names did that, and
     for as long as they were there no suite in this file ran on any push —
     while every check here, which reads the file as text, stayed green.
     Narrow on purpose: this catches that one shape in step and job names,
     not YAML errors in general (there is no YAML parser in the tests). */
  const names = [...yml.matchAll(/^\s*(?:-\s+)?name:\s+(.*)$/gm)].map(m => m[1]);
  ok('the workflow has names to check', names.length > 40, `${names.length} names`);
  const colon = names.filter(v => !/^['"]/.test(v) && /:\s/.test(v));
  ok('and no unquoted name holds ": ", which makes GitHub reject the file', colon.length === 0,
     colon.map(v => v.slice(0, 60)).join(' | ') || 'none');
}

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

head('the browser-free count is not every suite CI runs');
{
  /* Vacuity guards for pureCI, both ways: it must be a real subset (the
     classifier found something), and the browser suites the workflow runs
     must be the ones it left out — so a classifier that called everything
     pure, or nothing, fails here rather than moving the prose. */
  ok('some suites CI runs need no browser', pureCI.length > 20, `${pureCI.length} of ${ciSuites.length}`);
  const browserInCI = ciSuites.filter(n => !pureCI.includes(n));
  ok('and the ones left out are the workflow\u2019s browser job, and nothing else',
     JSON.stringify(browserInCI) === JSON.stringify([...yml.slice(yml.indexOf('\n  memorizer-browser:')).matchAll(/node\s+tests\/verify-([a-z0-9-]+)\.js/g)].map(m => m[1])),
     browserInCI.join(', ') || 'none');
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
  const registered = registrySuites();
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
    /* THE SAME HOLE AGAIN, in the README this time, and it had been open long
       enough to go three ways stale: "the two suites that are pure logic",
       naming verify-fsrs at 38 checks and verify-worker at 51 when they are 89
       and 73, and "the other 1210 checks" when it was 1646. Every number
       around that paragraph was guarded and it was not, so the surrounding
       green read as coverage of it. It no longer names individual suites —
       a sentence that lists two of twenty-four is a sentence that goes stale
       the next time one is added. */
    ['README.md', 'the size of what CI can run',
     /the (\d+) suites that need neither a browser nor a build/,
     r => [+r[1] === pureCI.length]],
    ['README.md', 'the count of what CI cannot run',
     /why the other (\d+) checks can't run here/,
     r => [+r[1] === stats.total + stats.pwa - ciTotal]],
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
     /the (\d+) suites that are pure Node/, r => [+r[1] === pureCI.length]],
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
    /* FIVE MORE IN docs/BUILD.md, ALL OF THEM STALE WHEN THIS WAS WRITTEN, and
       every one the same shape as the two CLAUDE.md already names: an
       unguarded sentence sitting near a guarded one, so the green around it
       read as coverage of it. They are grouped here because they were found
       in one sweep, not because they are related.

       The Python paragraph was the clearest case. It said "the other 53 run
       normally — it is 35 of the 1758 checks", and all three numbers were
       right the day they were typed: at 76050eb the record held total 1758,
       suiteCount 54, figreview 35. Two then moved with the suite and one did
       not have to, so the sentence went half-stale and kept reading as fact. */
    ['docs/BUILD.md', 'the paragraph on building without Python',
     /the other (\d+)\s+run normally\s*—\s*it is (\d+) of the (\d+) checks/,
     r => [+r[1] === stats.suiteCount - 1, +r[2] === stats.suites.figreview, +r[3] === stats.total]],
    /* The two numbers in the iterate-on-one-step recipe. Both move whenever a
       step is added anywhere, and the second moves when one is added BEFORE
       theme, which is how it came to say 14-20 against an 85-step chain. */
    ['docs/BUILD.md', 'the --keep intermediates count',
     /--keep\s+#\s*once, keeps all (\d+) intermediates/, r => [+r[1] === chainLength]],
    ['docs/BUILD.md', 'the step range --from theme reruns',
     /--from theme\s*#\s*only steps (\d+)-(\d+) rerun/,
     r => [+r[1] === chainSteps.indexOf('theme') + 1, +r[2] === chainLength]],
    /* The repository-shape sketch, which reads as a diagram and so gets
       re-read often and re-checked never. It said 71 patch scripts against 85,
       and "35 Playwright suites (34 single-file + pwa)" against a registry of
       75 — a sentence that had been wrong through roughly forty additions. */
    ['docs/BUILD.md', 'the patch-script count in the repository sketch',
     /verify · (\d+) \*-patch/, r => [+r[1] === chainLength]],
    ['docs/BUILD.md', 'the suite counts in the repository sketch',
     /(\d+) suites · (\d+) need no browser/,
     r => [+r[1] === stats.suiteCount, +r[2] === pureCI.length]],
    /* The corpus prerequisite quotes the two floors verify-retrieval enforces.
       They were added the day a run was spent discovering them, so they are
       held to the suite that owns them rather than to whoever remembers —
       lower either threshold and the paragraph telling people what a green
       run needs goes stale in the same commit. */
    /* verify.js describes ITSELF in its header, and that sentence has gone
       stale twice: it said 18 suites and 418 checks long after there were 75,
       was corrected by hand to 75 and 2481, and was stale again at the next
       record. Correcting a number without guarding it buys one commit. */
    ['scripts/verify.js', 'the header describing the suite count and total',
     /There are (\d+) suites and roughly (\d+) checks/,
     r => [+r[1] === stats.suiteCount, +r[2] === stats.total]],
    ['docs/BUILD.md', 'the corpus floors quoted in the prerequisite',
     /more than (\d+) notes, and an index over (\d+) documents/,
     r => {
       const rs = blankComments(read('tests/verify-retrieval.js'));
       const notes = (rs.match(/r\.notes > (\d+)/) || [])[1];
       const docs = (rs.match(/r\.docs > (\d+)/) || [])[1];
       return [+r[1] === +notes, +r[2] === +docs, notes !== undefined, docs !== undefined];
     }],
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
  /* The --from range above is anchored on chainSteps.indexOf('theme'), and a
     miss there returns -1, which +1 turns into a plausible-looking 0. A step
     renamed out from under that claim would otherwise leave it comparing a
     number nobody meant against prose nobody updated. */
  ok('and theme is one of its steps, so the --from range is not anchored on a miss',
     chainSteps.includes('theme'), `theme at ${chainSteps.indexOf('theme') + 1}`);
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

/* ── a number in a suite claim, held to the chain that builds it ──────────────

   scripts/verify.js describes each suite in one line. The theme suite's line
   said "eight palettes" from the day it was written until well after the ninth
   arrived: highcontrast-patch.js appends Contrast to THEMES fifty-odd steps
   into the chain, verify-theme.js was updated to assert nine, and the sentence
   describing the suite was not. Nothing connected the two, so nothing said so.

   It is the shape CLAUDE.md refuses — a sentence with a number in it and no
   check under it — and it is worse than usual here, because every other number
   in that file's neighbourhood IS guarded, so the surrounding green read as
   coverage of this line too.

   The count is derived, never typed: a tenth preset moves it on its own.

   NARROW ON PURPOSE, and said here rather than left for the reader to assume.
   It counts DISTINCT THEMES ids appearing in any *-patch.js, which is correct
   while every such entry is an addition — no step removes a theme today. A
   step that did would make this overcount, and would have to be taught here.
   It also holds one claim, not every claim in SUITES: the others quote counts
   ("two axes", "three layouts") whose sources are not one array, and a sweep
   that guessed at them would be the kind of lint that gets ignored. */
head('the palette count in a suite claim is the count the chain builds');
{
  const WORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
                 seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

  const ids = new Set();
  for (const name of fs.readdirSync(path.join(ROOT, 'scripts'))) {
    if (!name.endsWith('-patch.js')) continue;
    const src = blankComments(read(path.join('scripts', name)));
    const re = /\{\s*id:\s*'([a-z0-9]+)'\s*,\s*name:\s*'[^']*'\s*,\s*group:\s*'(?:light|dark)'/g;
    let m;
    while ((m = re.exec(src))) ids.add(m[1]);
  }

  const claim = (blankComments(read('scripts/verify.js'))
                  .match(/\['theme',\s*'([^']*)'\]/) || [])[1] || '';
  const named = (claim.match(/\b([a-z]+|\d+)\s+palettes\b/) || [])[1];
  const count = named === undefined ? NaN : (WORD[named] !== undefined ? WORD[named] : Number(named));
  const asserted = (blankComments(read('tests/verify-theme.js'))
                     .match(/presets\.n\s*===\s*(\d+)/) || [])[1];

  /* Three reads that can each come back empty, checked before anything is
     compared. An empty read compares equal to nothing in particular — which is
     also exactly what this section would look like if it had never run. */
  ok('the theme suite has a claim to read', claim.length > 0, claim || '(none)');
  ok('that claim names a palette count', Number.isFinite(count), String(named));
  ok('the chain defines themes to count', ids.size > 0, `${ids.size} ids`);

  ok('the claim names as many palettes as the chain defines',
     count === ids.size, `claim says ${count}, chain builds ${ids.size}`);
  ok('verify-theme.js asserts that same number, so suite and claim cannot drift',
     Number(asserted) === ids.size, `verify-theme says ${asserted}, chain builds ${ids.size}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
