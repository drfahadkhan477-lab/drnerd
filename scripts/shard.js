#!/usr/bin/env node
'use strict';
/*
 * Which of a browser job's suites one of its shards runs.
 *
 *   node scripts/shard.js <job> <shard> <of>                  one suite per line
 *   node scripts/shard.js <job> <shard> <of> --github-output  also writes
 *                         suites=,verify-a,verify-b, to $GITHUB_OUTPUT
 *
 * synthetic-browser and synthetic-webkit in verify.yml are matrices of
 * shards. Each shard is the whole job: every suite keeps its own step, and a
 * step runs only when its suite is in this shard's list
 * (`contains(steps.shard.outputs.suites, ',verify-x,')`). So the job body
 * still names every suite once, which is what scripts/test-public.js (npm
 * test) and tests/verify-stats.js read, and a shard is a choice of which of
 * those steps to run, never a second copy of them.
 *
 * THE SPLIT IS COMPUTED, NOT WRITTEN DOWN. The suites are the job's own steps,
 * read from the workflow; their weights are the seconds the record
 * (tests/test-stats.json, written only by full green runs) holds for each.
 * Longest first, each to the shard with the least time so far, ties to the
 * lower shard and then by name, so every shard of a run computes the same
 * split. A suite the record has not timed yet weighs the median of those it
 * has, so a new step lands in some shard the day it is added.
 *
 * tests/verify-shard-pure.js holds every suite to exactly one shard, and each
 * step's condition to the suite it runs.
 */
const fs = require('fs');
const path = require('path');
const { jobBody } = require('./test-public.js');

const ROOT = path.join(__dirname, '..');

/* The suites a job runs, in step order. */
function jobSuites(yml, job) {
  const body = jobBody(yml, job);
  if (body === null) throw new Error(`the workflow has no ${job} job`);
  return [...body.matchAll(/^\s*run:\s*node\s+tests\/(verify-[a-z0-9-]+)\.js\b/gm)].map(m => m[1]);
}

/* names: suite file names ("verify-x"); seconds: the record's, by registry
   name ("x"). Returns `of` lists. */
function assign(names, seconds, of) {
  if (!(Number.isInteger(of) && of >= 1)) throw new Error(`a job splits into a whole number of shards, not ${of}`);
  const known = names.map(n => seconds[n.replace(/^verify-/, '')]).filter(s => typeof s === 'number' && s >= 0).sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)] : 1;
  const weight = n => { const s = seconds[n.replace(/^verify-/, '')]; return typeof s === 'number' && s >= 0 ? s : median; };
  const order = [...new Set(names)].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : a > b ? 1 : 0));
  const shards = Array.from({ length: of }, () => ({ load: 0, suites: [] }));
  for (const n of order) {
    let k = 0;
    for (let i = 1; i < of; i++) if (shards[i].load < shards[k].load) k = i;
    shards[k].suites.push(n);
    shards[k].load += weight(n);
  }
  return shards.map(s => s.suites);
}

/* shard is 1-based, as the workflow's matrix counts it. */
function shardOf(yml, stats, job, shard, of) {
  if (!(Number.isInteger(shard) && shard >= 1 && shard <= of)) throw new Error(`shard ${shard} is not one of 1..${of}`);
  return assign(jobSuites(yml, job), (stats && stats.seconds) || {}, of)[shard - 1];
}

module.exports = { jobSuites, assign, shardOf };

if (require.main === module) {
  const args = process.argv.slice(2);
  const out = args.includes('--github-output');
  const [job, shard, of] = args.filter(a => a !== '--github-output');
  if (!job || !shard || !of) {
    console.error('Usage: node scripts/shard.js <job> <shard> <of> [--github-output]');
    process.exit(2);
  }
  try {
    const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'verify.yml'), 'utf8');
    const stats = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'test-stats.json'), 'utf8'));
    const list = shardOf(yml, stats, job, +shard, +of);
    /* An empty shard would skip every step and pass. With fewer suites than
       shards that is the arithmetic, but here it is a mistake: refuse it. */
    if (!list.length) throw new Error(`shard ${shard} of ${of} of ${job} has no suites`);
    console.log(`${job}, shard ${shard} of ${of}: ${list.length} suites`);
    for (const n of list) console.log('  ' + n);
    if (out) {
      if (!process.env.GITHUB_OUTPUT) throw new Error('--github-output, and GITHUB_OUTPUT is not set');
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `suites=,${list.join(',')},\n`);
    }
  } catch (e) {
    console.error('shard: ' + e.message);
    process.exit(1);
  }
}
