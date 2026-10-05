#!/usr/bin/env node
'use strict';
/*
 * Which of the two browser jobs in verify.yml a pull request needs.
 *
 *   node scripts/ci-changes.js        (in the workflow's `changes` job)
 *
 * The synthetic-browser job takes about twelve minutes and never reads
 * memorizer/; the memorizer-browser job never reads the Systole shell in app/
 * or assets/. A pull request that touches only one side was paying for both.
 *
 * THE DIRECTION OF EVERY DOUBT IS "RUN IT". A job is skipped only when every
 * changed file is on a short list known not to reach it. Anything not on a
 * list — a new directory, a helper in tests/, package.json, the workflow
 * itself — runs both jobs. So does any event other than a pull request (a
 * merge to master is always tested in full), an empty file list, and a git
 * command that failed: none of those may read as "nothing changed".
 *
 * WHAT THE LISTS ARE BASED ON, checked by reading the code rather than assumed:
 *   - No suite or build step in synthetic-browser reads memorizer/ (verify-csp
 *     walks scripts/ and src/, not memorizer/). scripts/build-memorizer.js is
 *     NOT memorizer-only: verify-csp scans it, and verify-bankstore uses it.
 *   - No suite or build step in memorizer-browser reads app/ or assets/.
 *   - No browser suite reads docs/, tasks/, .claude/ or a top-level .md; the
 *     suites that do (verify-stats, claude-*) are in the logic job, which
 *     always runs, as do syntax and build-guard.
 * tests/verify-cichanges-pure.js holds each list against the jobs it skips.
 *
 * A skipped job shows as "skipped" in the checks list, never as a pass.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');

/* Reaches neither browser job. */
const DOCS = [/^docs\//, /^tasks\//, /^\.claude\//, /^[^/]+\.md$/];
/* Reaches memorizer-browser only. */
const MEMORIZER_ONLY = [/^memorizer\//, /^tests\/verify-memorizer[a-z0-9-]*\.js$/];
/* Reaches synthetic-browser only. */
const SYSTOLE_ONLY = [/^app\//, /^assets\//];

const any = (res, f) => res.some(re => re.test(f));

/* files: the changed paths, or null when they could not be read. */
function classify(files) {
  if (!Array.isArray(files) || files.length === 0) return { memorizer: true, synthetic: true };
  return {
    memorizer: !files.every(f => any(DOCS, f) || any(SYSTOLE_ONLY, f)),
    synthetic: !files.every(f => any(DOCS, f) || any(MEMORIZER_ONLY, f)),
  };
}

function decide(event, files) {
  return event === 'pull_request' ? classify(files) : { memorizer: true, synthetic: true };
}

/* On a pull_request event the checkout is GitHub's merge commit, whose first
   parent is the base branch's tip, so HEAD^1..HEAD is the whole pull request
   as it would land. Needs fetch-depth: 2. */
function changedFiles() {
  try {
    const out = execFileSync('git', ['diff', '--name-only', 'HEAD^1', 'HEAD'], { encoding: 'utf8' });
    return out.split('\n').map(s => s.trim()).filter(Boolean);
  } catch (e) {
    console.log('could not read the changed files (' + String(e.message).split('\n')[0] + '); running both jobs');
    return null;
  }
}

if (require.main === module) {
  const event = process.env.GITHUB_EVENT_NAME || '';
  const files = event === 'pull_request' ? changedFiles() : null;
  const d = decide(event, files);
  console.log(`event: ${event || '(none)'}; changed files: ${files ? files.length : 'not read'}`);
  console.log(`memorizer-browser: ${d.memorizer ? 'runs' : 'skipped'}; synthetic-browser: ${d.synthetic ? 'runs' : 'skipped'}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `memorizer=${d.memorizer}\nsynthetic=${d.synthetic}\n`);
  }
}

module.exports = { classify, decide, DOCS, MEMORIZER_ONLY, SYSTOLE_ONLY };
