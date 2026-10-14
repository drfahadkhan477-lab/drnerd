/*
 * Writing a bank folder in the content schema (docs/CONTENT-SCHEMA.md), for
 * scripts/build-bank.js and scripts/import-bank.js.
 *
 * The bank is written beside the old one and swapped in whole, so a refusal
 * or a crash leaves the last good bank where it was. And only a bank is ever
 * replaced: a folder that is there and holds anything but a bank (a manifest
 * with a schemaVersion) is refused, never emptied, so --out pointed at build/
 * or at a folder of your own costs nothing.
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* Absent, empty, or a bank: the only folders a new bank may take the place of. */
function replaceable(dir) {
  let st;
  try { st = fs.statSync(dir); } catch (e) { if (e.code === 'ENOENT') return true; throw e; }
  if (!st.isDirectory()) return false;
  if (!fs.readdirSync(dir).length) return true;
  try { return Number.isInteger(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).schemaVersion); }
  catch (_) { return false; }
}

/* files: [{ name, bytes }], name 'manifest.json', 'questions.json' or
   'figures/<file>'. figures/ is made even when no question names a figure. */
function writeBankFolder(out, files) {
  const dir = out.replace(/[\\/]+$/, '');
  if (!replaceable(dir)) throw new Error(`${dir} is there and holds no bank: give --out a folder of its own (a bank there is replaced; nothing else is)`);
  const work = dir + '.tmp-' + process.pid, old = dir + '.old-' + process.pid;
  const clear = p => fs.rmSync(p, { recursive: true, force: true });
  clear(work);
  /* The new bank is made beside the old one; a write that fails leaves the old
     bank alone and removes the half-made one. */
  try {
    fs.mkdirSync(path.join(work, 'figures'), { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(work, ...f.name.split('/')), f.bytes);
  } catch (e) { clear(work); throw e; }
  /* The swap is two renames, and the second can fail with the first done: the
     old bank is aside and the new one is not in place. Put the old one back
     and leave nothing beside it. If even that fails, the error says where the
     last good bank is, because it is nowhere else. */
  const had = fs.existsSync(dir);
  try {
    if (had) fs.renameSync(dir, old);
    fs.renameSync(work, dir);
  } catch (e) {
    try { if (had && !fs.existsSync(dir)) fs.renameSync(old, dir); }
    catch (_) { throw Object.assign(new Error(`${e.message} (and the last good bank could not be put back: it is at ${old})`), { code: e.code, cause: e }); }
    clear(work);
    throw e;
  }
  /* The swap is done; a leftover old copy is clutter, not a failure. */
  try { clear(old); } catch (_) { /* left for the next clean-up */ }
}

module.exports = { writeBankFolder, replaceable };
