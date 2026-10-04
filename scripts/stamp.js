'use strict';
/*
 * The build stamp, for scripts/assemble-app.js: one comment before </head>
 * naming the document's digest and the commit that made it, written exactly as
 * scripts/build.js writes it after the patch chain.
 *
 * A COPY, NOT A MOVE. build.js keeps its own stamping code because
 * tests/verify-provenance-pure.js holds that code where it is: after the chain,
 * over the unstamped bytes, as a Buffer (see the comment there for why a string
 * round trip is wrong). tests/verify-assemble-pure.js holds this copy's comment
 * template to build.js's, so the two cannot drift apart unnoticed.
 */
const crypto = require('crypto');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const STAMP_RE = /<!-- systole-build [0-9a-f]{16} commit [0-9a-z-]+ -->\n/g;

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

/* stampBuffer(unstamped, commit) → { out, digest }. Throws unless the document
   has exactly one </head>: a stamp going in twice is as wrong as one not going
   in, and appending blindly to a document with no head is worse than refusing. */
function stampBuffer(built, commit) {
  const digest = crypto.createHash('sha256').update(built).digest('hex').slice(0, 16);
  const HEAD = Buffer.from('</head>');
  const at = built.indexOf(HEAD);
  if (at < 0 || at !== built.lastIndexOf(HEAD))
    throw new Error('the built document does not have exactly one </head>, so there is nowhere to stamp it');
  /* No "--" inside: a hex digest and a hex commit with an optional -dirty.
     Nothing here can close the comment early. */
  const stamp = Buffer.from(`<!-- systole-build ${digest} commit ${commit} -->\n`);
  return { out: Buffer.concat([built.subarray(0, at), stamp, built.subarray(at)]), digest };
}

module.exports = { gitCommit, stampBuffer, STAMP_RE };
