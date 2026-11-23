'use strict';
/*
 * The build stamp, for scripts/assemble-app.js: one comment before </head>
 * naming the document's digest and the commit that made it.
 *
 * Over the unstamped bytes, as a Buffer: a string round trip turns a lone
 * 0x92 (the Windows-1252 apostrophe an exported corpus carries) into three
 * bytes and moves the digest away from the one extract-content.js writes.
 * tests/verify-provenance-pure.js runs this and holds it to that. (It was a
 * copy of scripts/build.js's stamping until the patch chain was deleted.)
 */
const crypto = require('crypto');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
/* The release is optional so a stamp written before it existed is still found and stripped. */
const STAMP_RE = /<!-- systole-build [0-9a-f]{16} commit [0-9a-z-]+(?: release [0-9A-Za-z.+-]+)? -->\n/g;

function gitCommit(root = ROOT) {
  try {
    const at = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'],
                            { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!/^[0-9a-f]{7,40}$/.test(at)) return 'unknown';
    const dirty = execFileSync('git', ['status', '--porcelain'],
                               { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0;
    return dirty ? at + '-dirty' : at;
  } catch (_) { return 'unknown'; }
}

/* THE RELEASE: a number a person can follow, beside the digest a machine can.
   The digest says which exact file this is; it cannot say whether one build is
   newer than another. The release can: package.json's version, then the build,
   which is the number of the last pull request merged into this commit's line
   of master (each merge adds one). Commits on top of that merge count after a
   dot, and uncommitted changes are marked. In SemVer's own form for build
   metadata: 1.0.0+441, 1.0.0+441.2, 1.0.0+441.2.dirty.

   Read from the first-parent history rather than counted, because CI and
   cloud checkouts are shallow: a count of commits there is the clone's depth,
   not the project's. A merge's own subject carries its number at any depth.
   With no merge in reach (a pull request's test merge, a tarball) the build is
   "dev": no number is better than a wrong one. The date is the commit's, not
   the clock's, so the same commit always stamps the same bytes. */
const MERGE_RE = /^Merge pull request #(\d+)\b/;

/* buildOf(subjects) → { pr, ahead }: subjects of the first-parent history,
   newest first. pr is null when none of them is a merged pull request. */
function buildOf(subjects) {
  for (let i = 0; i < subjects.length; i++) {
    const m = MERGE_RE.exec(subjects[i]);
    if (m) return { pr: +m[1], ahead: i };
  }
  return { pr: null, ahead: subjects.length };
}

function release(root = ROOT) {
  let version = '0.0.0';
  try { version = JSON.parse(require('fs').readFileSync(path.join(root, 'package.json'), 'utf8')).version || version; } catch (_) {}
  if (!/^\d+\.\d+\.\d+$/.test(version)) version = '0.0.0';
  const commit = gitCommit(root), dirty = commit.endsWith('-dirty');
  let subjects = [], date = null;
  try {
    const log = execFileSync('git', ['log', '--first-parent', '-n', '500', '--format=%cs%x09%s'],
                             { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
    subjects = log.map(l => l.slice(l.indexOf('\t') + 1));
    date = log.length ? log[0].slice(0, 10) : null;
  } catch (_) {}
  const { pr, ahead } = buildOf(subjects);
  const build = pr === null ? 'dev' : String(pr) + (ahead ? '.' + ahead : '');
  const semver = `${version}+${build}${dirty ? '.dirty' : ''}`;
  const words = pr === null ? 'development build' :
    `build ${pr}` + (ahead ? `, ${ahead} commit${ahead === 1 ? '' : 's'} after it` : '');
  const text = `Systole ${version} (${words}${dirty ? ', with uncommitted changes' : ''})` +
    (date ? `, ${date}` : '') + (commit === 'unknown' ? '' : `, commit ${commit.replace(/-dirty$/, '')}`);
  return { version, build, date, commit, semver, text };
}

/* stampBuffer(unstamped, commit[, semver]) → { out, digest }. Throws unless the document
   has exactly one </head>: a stamp going in twice is as wrong as one not going
   in, and appending blindly to a document with no head is worse than refusing. */
function stampBuffer(built, commit, semver) {
  const digest = crypto.createHash('sha256').update(built).digest('hex').slice(0, 16);
  const HEAD = Buffer.from('</head>');
  const at = built.indexOf(HEAD);
  if (at < 0 || at !== built.lastIndexOf(HEAD))
    throw new Error('the built document does not have exactly one </head>, so there is nowhere to stamp it');
  /* No "--" inside: a hex digest, a hex commit with an optional -dirty, and a
     release of digits, letters, dots, + and single hyphens. Nothing here can
     close the comment early. */
  if (semver !== undefined && !/^\d+\.\d+\.\d+\+[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*$/.test(semver))
    throw new Error(`not a release this stamp can carry: ${semver}`);
  const stamp = Buffer.from(`<!-- systole-build ${digest} commit ${commit}${semver === undefined ? '' : ' release ' + semver} -->\n`);
  return { out: Buffer.concat([built.subarray(0, at), stamp, built.subarray(at)]), digest };
}

module.exports = { gitCommit, stampBuffer, STAMP_RE, release, buildOf };
