#!/usr/bin/env node
'use strict';
/*
 * Which of the two kinds of browser job in verify.yml a pull request needs:
 * public-browser (`public`), and the synthetic ones (`synthetic`):
 * synthetic-build, the shards of synthetic-browser and synthetic-webkit that
 * test its build, and split-build. browser-done reads both answers to tell a
 * skip asked for here from one that is not (scripts/browser-done.js).
 *
 *   node scripts/ci-changes.js        (in the workflow's `changes` job)
 *
 * The public-browser job never reads the Systole shell in app/ or assets/,
 * and no browser job reads the docs. A pull request that touches only those
 * was paying for jobs that cannot see the change. (The public-browser job was
 * memorizer-browser, and the synthetic job was skipped for a change to
 * memorizer/ alone, until Memorizer moved to its own repository.)
 *
 * THE DIRECTION OF EVERY DOUBT IS "RUN IT". A job is skipped only when every
 * changed file is on a short list known not to reach it. Anything not on a
 * list — a new directory, a helper in tests/, package.json, the workflow
 * itself — runs both jobs. So does any event other than a pull request (a
 * merge to master is always tested in full), an empty file list, and a git
 * command that failed: none of those may read as "nothing changed".
 *
 * WHAT THE LISTS ARE BASED ON, checked by reading the code rather than assumed:
 *   - No suite in public-browser reads app/ or assets/: verify-bankstore
 *     takes the loader from scripts/build-pwa.js and its modules from
 *     src/core/, and verify-suitecache writes its own pages.
 *   - No browser suite reads docs/, tasks/, .claude/ or a top-level .md; the
 *     suites that do (such as verify-stats) are in the logic job, which
 *     always runs, as do syntax and build-guard.
 * tests/verify-cichanges-pure.js holds each list against the jobs it skips.
 *
 * A skipped job shows as "skipped" in the checks list, never as a pass.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');

/* Reaches neither browser job.
   .gitignore is here because the two suites that read it — verify-engine.js
   ("the transcript is gitignored") and verify-leakguard.js — are both in the
   logic job, which has no `needs: changes` and so runs whatever this decides.
   Changing it was therefore starting the public-browser matrix in three
   engines, the synthetic job and the split build to measure nothing they can see. No
   browser suite reads it; checked by grepping tests/ for the name, as the
   lists above were. The other root dotfiles are NOT here: .node-version picks
   the runtime for every job, and .gitattributes can change what a checkout
   even contains. */
const DOCS = [/^docs\//, /^tasks\//, /^\.claude\//, /^[^/]+\.md$/, /^\.gitignore$/];
/* Reaches synthetic-browser only, not public-browser. */
const SYSTOLE_ONLY = [/^app\//, /^assets\//];

const any = (res, f) => res.some(re => re.test(f));

/* files: the changed paths, or null when they could not be read. */
function classify(files) {
  if (!Array.isArray(files) || files.length === 0) return { public: true, synthetic: true };
  return {
    public: !files.every(f => any(DOCS, f) || any(SYSTOLE_ONLY, f)),
    synthetic: !files.every(f => any(DOCS, f)),
  };
}

function decide(event, files) {
  return event === 'pull_request' ? classify(files) : { public: true, synthetic: true };
}

/* On a pull_request event the checkout is GitHub's merge commit, whose first
   parent is the base branch's tip, so HEAD^1..HEAD is the whole pull request
   as it would land. Needs fetch-depth: 2.
   --no-renames: by default git lists a moved file under its new name only, so
   src/core/x.js moved to app/x.js would read as a Systole-only change and skip
   the public-browser job, which had used src/core/x.js. Both paths are listed. */
function changedFiles() {
  try {
    const out = execFileSync('git', ['diff', '--name-only', '--no-renames', 'HEAD^1', 'HEAD'], { encoding: 'utf8' });
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
  console.log(`public-browser: ${d.public ? 'runs' : 'skipped'}; synthetic-browser: ${d.synthetic ? 'runs' : 'skipped'}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `public=${d.public}\nsynthetic=${d.synthetic}\n`);
  }
}

module.exports = { classify, decide, DOCS, SYSTOLE_ONLY };
