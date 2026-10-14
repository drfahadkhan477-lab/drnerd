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
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(path.join(work, 'figures'), { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(work, ...f.name.split('/')), f.bytes);
  if (fs.existsSync(dir)) fs.renameSync(dir, old);
  fs.renameSync(work, dir);
  fs.rmSync(old, { recursive: true, force: true });
}

module.exports = { writeBankFolder, replaceable };
