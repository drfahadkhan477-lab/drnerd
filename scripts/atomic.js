'use strict';
/*
 * Put a file in place whole, or not at all.
 *
 * Stage the bytes in a private directory on the destination filesystem.
 * Rename the finished file into place and clean up the directory even if
 * the write or rename fails. The assembler can write licensed content here.
 */
const fs = require('fs');
const path = require('path');

function replaceWhole(out, bytes) {
  const dir = fs.mkdtempSync(path.join(path.dirname(out), '.systole.tmp-'));
  const tmp = path.join(dir, 'output');
  try {
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, out);
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
    try { fs.rmdirSync(dir); } catch (_) {}
  }
}

module.exports = { replaceWhole };
