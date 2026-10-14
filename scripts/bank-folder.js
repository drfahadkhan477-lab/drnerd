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
   'figures/<file>'. figures/ is made even when no question names a figure.

   A step that fails (a full disk, a folder something holds open) leaves the
   last good bank where it was: the half-written bank is removed, and a bank
   already moved aside is moved back. If it cannot be moved back, the error
   says where it is. Once the new bank is in place, a previous bank that
   cannot be removed is an error too, saying that the new bank is in place and
   where the old copy is, so nothing is left behind unmentioned. */
function writeBankFolder(out, files) {
  const dir = out.replace(/[\\/]+$/, '');
  if (!replaceable(dir)) throw new Error(`${dir} is there and holds no bank: give --out a folder of its own (a bank there is replaced; nothing else is)`);
  const work = dir + '.tmp-' + process.pid, old = dir + '.old-' + process.pid;
  fs.rmSync(work, { recursive: true, force: true });
  let aside = false;
  try {
    fs.mkdirSync(path.join(work, 'figures'), { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(work, ...f.name.split('/')), f.bytes);
    if (fs.existsSync(dir)) { fs.renameSync(dir, old); aside = true; }
    fs.renameSync(work, dir);
  } catch (e) {
    let notBack = null;
    if (aside) { try { fs.renameSync(old, dir); } catch (r) { notBack = r; } }
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) { /* nothing more to do for it */ }
    if (notBack) throw new Error(`${e.message}; and the previous bank could not be put back, it is at ${old}: ${notBack.message}`);
    throw e;
  }
  try { fs.rmSync(old, { recursive: true, force: true }); }
  catch (e) { throw new Error(`the new bank is in place, but the previous one could not be removed from ${old}: ${e.message}`); }
}

module.exports = { writeBankFolder, replaceable };
