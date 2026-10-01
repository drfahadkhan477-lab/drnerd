'use strict';
/*
 * Put a file in place whole, or not at all.
 *
 * Written beside the destination as <out>.tmp-<pid>, then renamed over it,
 * so nothing ever reads half of it. If the rename fails (the destination is
 * a directory, or locked, as Windows does to an open file) the temporary is
 * removed before the error goes on: it is a complete copy of whatever was
 * being written, and for scripts/build.js that is the licensed build, which
 * must not be left lying beside an --out that may be outside the gitignored
 * folders (found by review).
 */
const fs = require('fs');

function replaceWhole(out, bytes) {
  const tmp = out + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, bytes);
  try { fs.renameSync(tmp, out); }
  catch (e) { try { fs.unlinkSync(tmp); } catch (_) {} throw e; }
}

module.exports = { replaceWhole };
