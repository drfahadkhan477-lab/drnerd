#!/usr/bin/env node
'use strict';
/*
 * The one check branch protection needs for the browser jobs.
 *
 *   NEEDS='${{ toJSON(needs) }}' node scripts/browser-done.js   (verify.yml's browser-done job)
 *
 * The browser jobs are matrices of shards and engines, and a matrix job that
 * is skipped reports one check under its unexpanded name, so no list of
 * per-shard names can be made required. browser-done needs every browser job
 * and passes only when each one passed, or was skipped because the `changes`
 * job said the pull request cannot reach it. A matrix job's result is
 * `failure` if any of its legs failed and `cancelled` if any was cancelled;
 * both fail this. So does a skip `changes` did not ask for: a job skipped
 * because the job it needs failed is not a pass.
 */

/* Each browser job, and the `changes` output that may skip it. */
const JOBS = {
  'public-browser': 'public',
  'synthetic-build': 'synthetic',
  'synthetic-browser': 'synthetic',
  'synthetic-webkit': 'synthetic',
  'split-build': 'synthetic',
};

/* needs: the workflow's `needs` context. Returns { ok, lines }. */
function verdict(needs) {
  const lines = [];
  let ok = true;
  const say = (good, text) => { if (!good) ok = false; lines.push(`${good ? 'PASS' : 'FAIL'}  ${text}`); };
  if (!needs || typeof needs !== 'object') return { ok: false, lines: ['FAIL  no needs context was handed in'] };
  const changes = needs.changes || {};
  say(changes.result === 'success', `changes: ${changes.result || 'not reported'}`);
  const outputs = changes.outputs || {};
  for (const [job, key] of Object.entries(JOBS)) {
    const r = (needs[job] || {}).result;
    if (r === 'success') say(true, `${job}: success`);
    else if (r === 'skipped') say(outputs[key] === 'false', `${job}: skipped, and changes said ${key}=${outputs[key] === undefined ? '(nothing)' : outputs[key]}`);
    else say(false, `${job}: ${r || 'not reported'}`);
  }
  return { ok, lines };
}

module.exports = { verdict, JOBS };

if (require.main === module) {
  let needs = null;
  try { needs = JSON.parse(process.env.NEEDS || ''); } catch (e) { needs = null; }
  const v = verdict(needs);
  for (const l of v.lines) console.log(l);
  console.log(v.ok ? 'every browser job passed, or was skipped for a change it cannot see' : 'a browser job did not pass');
  process.exit(v.ok ? 0 : 1);
}
