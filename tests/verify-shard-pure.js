#!/usr/bin/env node
'use strict';
/*
 * The browser jobs' shards run every suite once, and browser-done reads them
 * honestly.
 *
 *   node tests/verify-shard-pure.js
 *
 * synthetic-browser and synthetic-webkit are matrices of shards. Every shard
 * holds every suite's step, and runs the ones scripts/shard.js gives it. So a
 * suite is lost if no shard is given it, run twice if two are, and lost again
 * if its step asks for a different name than the one it runs. Each of those
 * is held here against the real workflow and record, and the reading that
 * holds it is shown to find each fault on a partition broken on purpose.
 * scripts/browser-done.js, the one required check, is held to failing on a
 * failed, cancelled or unexplained skipped job.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { jobSuites, assign, shardOf } = require('../scripts/shard.js');
const { verdict, JOBS } = require('../scripts/browser-done.js');
const { jobBody } = require('../scripts/test-public.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const ROOT = path.join(__dirname, '..');
/* Comments blanked, so a sentence about the wiring cannot stand in for it. */
const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'verify.yml'), 'utf8').replace(/(^|\s)#.*$/gm, '$1');
const stats = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'test-stats.json'), 'utf8'));
const SHARDED = ['synthetic-browser', 'synthetic-webkit'];
const PIN = /@[0-9a-f]{40}\b/;

/* What is wrong with shards as a split of `all`: a suite in none, a suite in
   two, a name in a shard that is not in the job, an empty shard. */
function partitionProblems(shards, all) {
  const out = [], seen = new Map();
  shards.forEach((list, i) => {
    if (!list.length) out.push(`shard ${i + 1} is empty`);
    for (const n of list) seen.set(n, (seen.get(n) || []).concat(i + 1));
  });
  for (const n of all) if (!seen.has(n)) out.push(`${n} is in no shard`);
  for (const [n, at] of seen) {
    if (at.length > 1) out.push(`${n} is in shards ${at.join(' and ')}`);
    if (!all.includes(n)) out.push(`${n} is in shard ${at[0]} and not in the job`);
  }
  return out;
}

head('the reading finds each fault where there is one');
{
  const all = ['verify-a', 'verify-b', 'verify-c'];
  ok('a true split has none', partitionProblems([['verify-a'], ['verify-b', 'verify-c']], all).length === 0);
  ok('a suite dropped from every shard is found', /verify-c is in no shard/.test(partitionProblems([['verify-a'], ['verify-b']], all).join()));
  ok('a suite in two shards is found', /verify-a is in shards 1 and 2/.test(partitionProblems([['verify-a'], ['verify-a', 'verify-b', 'verify-c']], all).join()));
  ok('a name no step runs is found', /verify-x is in shard 2 and not in the job/.test(partitionProblems([['verify-a', 'verify-b', 'verify-c'], ['verify-x']], all).join()));
  ok('an empty shard is found', /shard 2 is empty/.test(partitionProblems([all, []], all).join()));
}

head('the split: longest first, to the shard with least time so far');
{
  const s = assign(['verify-a', 'verify-b', 'verify-c', 'verify-d'], { a: 10, b: 7, c: 5, d: 4 }, 2);
  ok('balanced by recorded time', JSON.stringify(s) === JSON.stringify([['verify-a', 'verify-d'], ['verify-b', 'verify-c']]), JSON.stringify(s));
  const again = assign(['verify-d', 'verify-c', 'verify-b', 'verify-a'], { a: 10, b: 7, c: 5, d: 4 }, 2);
  ok('and the same whatever order the steps are in, so every shard of a run computes one split', JSON.stringify(again) === JSON.stringify(s), JSON.stringify(again));
  const fresh = assign(['verify-a', 'verify-b', 'verify-c', 'verify-new'], { a: 9, b: 5, c: 1 }, 2);
  ok('a suite the record has not timed lands in a shard, weighed as the median', partitionProblems(fresh, ['verify-a', 'verify-b', 'verify-c', 'verify-new']).length === 0 &&
     fresh[1].includes('verify-new'), JSON.stringify(fresh));
  let msg = '';
  try { assign(['verify-a'], {}, 0); } catch (e) { msg = e.message; }
  ok('zero shards is refused', /whole number of shards/.test(msg), msg || 'accepted');
  msg = '';
  try { shardOf('jobs:\n  x:\n    steps:\n      - run: node tests/verify-a.js\n', stats, 'x', 5, 4); } catch (e) { msg = e.message; }
  ok('a shard outside 1..of is refused', /not one of 1\.\.4/.test(msg), msg || 'accepted');
}

head('every suite of each sharded job runs in exactly one shard');
for (const job of SHARDED) {
  const body = jobBody(yml, job) || '';
  ok(`${job} is in the workflow`, body.length > 0);
  const shards = ((body.match(/\n\s+shard:\s*\[([^\]]*)\]/) || [])[1] || '').split(',').map(s => +s.trim()).filter(Boolean);
  ok(`${job} is a matrix of shards 1..4`, JSON.stringify(shards) === '[1,2,3,4]', JSON.stringify(shards));
  ok(`${job}: a shard that fails cannot cancel the others`, /\n\s+fail-fast:\s*false\b/.test(body));
  ok(`${job}: each shard asks scripts/shard.js for its list, by the job's own name and the matrix's size`,
     /\n\s+- id: shard\n\s+name: [^\n]+\n\s+run: node scripts\/shard\.js \$\{\{ github\.job \}\} \$\{\{ matrix\.shard \}\} \$\{\{ strategy\.job-total \}\} --github-output\n/.test(body));
  const all = jobSuites(yml, job);
  ok(`${job} runs suites`, all.length > 30, `${all.length}`);
  const dup = all.filter((n, i) => all.indexOf(n) !== i);
  ok(`${job} names each suite in one step only, so no shard runs one twice`, dup.length === 0, dup.join(', ') || 'none');
  const split = shards.map(i => shardOf(yml, stats, job, i, shards.length));
  const problems = partitionProblems(split, all);
  ok(`${job}: the shards together are the job's suites, each in one shard`, shards.length > 0 && problems.length === 0, problems.join('; ') || split.map(s => s.length).join('+') + ` = ${all.length}`);
  /* Every suite step, with the condition it runs under. A step that asks for
     a name other than the one it runs is run by no shard, or by the wrong one. */
  const steps = body.split(/\n      - /).filter(s => /\n\s+run:\s*node tests\/verify-/.test('\n' + s));
  const wrong = steps.filter(s => {
    const runs = (s.match(/run:\s*node tests\/(verify-[a-z0-9-]+)\.js/) || [])[1];
    const cond = (s.match(/^if:\s*(.*)$/m) || [])[1] || '';
    return cond !== `\${{ !cancelled() && contains(steps.shard.outputs.suites, ',${runs},') }}`;
  }).map(s => (s.match(/verify-[a-z0-9-]+/) || ['?'])[0]);
  ok(`${job}: every suite step runs only in its suite's shard, and still after a failure before it`,
     steps.length === all.length && wrong.length === 0, wrong.join(', ') || `${steps.length} steps`);
  ok(`${job}: no shard builds the app again; each downloads the one synthetic-build made`,
     !/\bnode scripts\/(synthetic-export|assemble-app)\.js/.test(body) &&
     /uses: actions\/download-artifact@[0-9a-f]{40}[ \t]*\n\s+with:\n\s+name: synthetic-build\n\s+path: build\/synthetic\n/.test(body));
  const load = split.map(s => s.reduce((t, n) => t + (stats.seconds[n.replace(/^verify-/, '')] || 0), 0));
  const total = load.reduce((a, b) => a + b, 0), longest = Math.max(...all.map(n => stats.seconds[n.replace(/^verify-/, '')] || 0));
  ok(`${job}: no shard holds more than its share plus one suite`, Math.max(...load) <= total / load.length + longest,
     load.map(s => Math.round(s) + 's').join(', '));
}

head('one build, handed to the shards');
{
  const b = jobBody(yml, 'synthetic-build') || '';
  ok('synthetic-build makes the build', /node scripts\/synthetic-export\.js build\/synthetic\/export\.html/.test(b) && /node scripts\/assemble-app\.js [^\n]*--out build\/synthetic\/systole\.html/.test(b));
  ok('and uploads build/synthetic as the artifact the shards download, with an action pinned to a commit',
     /uses: actions\/upload-artifact@[0-9a-f]{40}[ \t]*\n\s+with:\n\s+name: synthetic-build\n\s+path: build\/synthetic\/\n\s+if-no-files-found: error\n/.test(b));
  ok('it waits for the same decision as the shards, failing open', /\n    needs:\s*changes\s*\n/.test(b) && /\n    if: \$\{\{ !cancelled\(\) && needs\.changes\.outputs\.synthetic != 'false' \}\}/.test(b));
  const uses = [...yml.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map(m => m[1]);
  ok('every action the workflow uses is pinned to a commit', uses.length > 10 && uses.every(u => PIN.test(u)), uses.filter(u => !PIN.test(u)).join(', ') || `${uses.length} uses`);
}

head('browser-done: one required check, which only passes on what passed');
{
  const green = () => ({ changes: { result: 'success', outputs: { public: 'true', synthetic: 'true' } },
    ...Object.fromEntries(Object.keys(JOBS).map(j => [j, { result: 'success' }])) });
  ok('every job green passes', verdict(green()).ok, verdict(green()).lines.join(' | '));
  const one = green(); one['synthetic-webkit'].result = 'failure';
  ok('one failed shard fails it, and names the job', !verdict(one).ok && verdict(one).lines.includes('FAIL  synthetic-webkit: failure'), verdict(one).lines.join(' | '));
  const cut = green(); cut['synthetic-browser'].result = 'cancelled';
  ok('a cancelled shard fails it', !verdict(cut).ok);
  const docs = green(); docs.changes.outputs = { public: 'false', synthetic: 'false' };
  for (const j of Object.keys(JOBS)) docs[j].result = 'skipped';
  ok('every job skipped because changes said so passes', verdict(docs).ok, verdict(docs).lines.join(' | '));
  const shell = green(); shell.changes.outputs.public = 'false'; shell['public-browser'].result = 'skipped';
  ok('and so does one skipped job, when its own answer was false', verdict(shell).ok);
  const sneak = green(); sneak['synthetic-browser'].result = 'skipped';
  ok('a skip changes did not ask for fails it: the job it waited on may have failed', !verdict(sneak).ok, verdict(sneak).lines.filter(l => /^FAIL/.test(l)).join(' | '));
  const blind = green(); blind.changes = { result: 'failure', outputs: {} }; blind['split-build'].result = 'skipped';
  ok('a changes job that failed wrote no answer, so nothing it skipped is a pass', !verdict(blind).ok);
  const gone = green(); delete gone['synthetic-build'];
  ok('a job missing from the context fails it, rather than reading as fine', !verdict(gone).ok);
  ok('no context at all fails it', !verdict(null).ok && !verdict(undefined).ok);

  const b = jobBody(yml, 'browser-done') || '';
  ok('the job is in the workflow', b.length > 0);
  const needs = ((b.match(/\n    needs:\s*\[([^\]]*)\]/) || [])[1] || '').split(',').map(s => s.trim()).filter(Boolean).sort();
  ok('it needs changes and every browser job the script judges', JSON.stringify(needs) === JSON.stringify(['changes'].concat(Object.keys(JOBS)).sort()), needs.join(', '));
  /* The other direction: a job that waits on `changes` is a browser job, and
     one browser-done does not need would go unseen by the required check. */
  const jobs = [...yml.matchAll(/\n  ([a-z0-9-]+):\n/g)].map(m => m[1]);
  const gated = jobs.filter(j => j !== 'browser-done' && /\n    needs:\s*\[?[^\n]*\bchanges\b/.test(jobBody(yml, j) || ''));
  ok('and every job that waits on changes is one of them', gated.length >= 5 && gated.every(j => j in JOBS), gated.filter(j => !(j in JOBS)).join(', ') || gated.join(', '));
  ok('it runs whatever happened before it', /\n    if: \$\{\{ always\(\) \}\}/.test(b));
  ok('and hands the script the whole needs context', /NEEDS: \$\{\{ toJSON\(needs\) \}\}\n\s+run: node scripts\/browser-done\.js\s*(\n|$)/.test(b));
}

head('the scripts, as the workflow runs them');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shard-'));
  try {
    const out = path.join(tmp, 'out');
    fs.writeFileSync(out, '');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'shard.js'), 'synthetic-browser', '2', '4', '--github-output'],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: out } });
    const line = fs.readFileSync(out, 'utf8');
    const want = shardOf(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'verify.yml'), 'utf8'), stats, 'synthetic-browser', 2, 4);
    ok('shard.js writes its list as one comma-fenced output', r.status === 0 && line === `suites=,${want.join(',')},\n`, line.slice(0, 120) || r.stderr);
    const bad = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'shard.js'), 'no-such-job', '1', '4'], { cwd: ROOT, encoding: 'utf8' });
    ok('and fails on a job that is not in the workflow, rather than writing an empty list', bad.status === 1 && /no no-such-job job/.test(bad.stderr), bad.stderr.trim());
    const run = needs => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'browser-done.js')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NEEDS: needs } });
    const all = { changes: { result: 'success', outputs: { public: 'true', synthetic: 'true' } }, ...Object.fromEntries(Object.keys(JOBS).map(j => [j, { result: 'success' }])) };
    ok('browser-done.js exits 0 on a green context', run(JSON.stringify(all)).status === 0);
    all['synthetic-browser'].result = 'failure';
    ok('and 1 on a failed shard', run(JSON.stringify(all)).status === 1);
    ok('and 1 on a context it cannot read', run('not json').status === 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

head('the checks branch protection requires keep their names');
{
  /* The ruleset on master requires these four by their full job names. A
     renamed job reports under a new name and the ruleset waits forever on
     the old one, so a change here must also change the ruleset
     (Settings > Rules > Rulesets), in the same change. */
  const REQUIRED = {
    'syntax': 'syntax — every file parses, both listings work',
    'logic': 'logic — every suite that needs no browser and no build',
    'build-guard': 'build-guard — refuses to run without the licensed source',
    'browser-done': 'browser-done — every browser job passed, or was skipped for a change it cannot see',
  };
  for (const [job, name] of Object.entries(REQUIRED)) {
    const got = ((jobBody(yml, job) || '').match(/\n    name:\s*(.+)/) || [])[1] || '';
    ok(`${job} is still named as the ruleset requires it; renaming it means updating the ruleset too`, got.trim() === name, got.trim() || 'no name');
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
