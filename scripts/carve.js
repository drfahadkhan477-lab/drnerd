#!/usr/bin/env node
/*
 * Carve a piece of app/systole.html into its own file: step 3 of retiring the
 * patch chain (docs/BUILD.md, "Retiring the patch chain").
 *
 *   node scripts/carve.js <from> <to> app/<path>
 *
 * Lines <from>..<to> of the shell (1-based, inclusive, whole lines) move to
 * app/<path>, and one token, @@SLOT[app:app/<path>]@@, stands where they
 * were. scripts/app-slots.js fills it back at assembly, so the assembled app
 * is the same bytes before and after, and that is checked here before
 * anything is kept: if it is not, or the shell cannot be written, the piece is
 * removed and the shell is left as it was.
 *
 * A carve is refused when
 *   - the lines hold a slot token (a piece is plain text; nothing is filled
 *     inside one),
 *   - their text stands in the shell more than once (freeze-shell could not
 *     tell which site to claim, as with a src module),
 *   - the path is not under app/, is the shell, or already exists.
 *
 * This proves the carve loses nothing. It cannot prove the result is still
 * the chain's build: only `node scripts/assemble-app.js --compare` beside a
 * chain build shows that, on the owner's machine.
 *
 * auditApp() is the standing check on the committed app/: every token
 * resolves, every piece is cited once, no piece holds a token.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Slots = require('./app-slots.js');

const ROOT = path.join(__dirname, '..');
const SHELL = 'app/systole.html';

/* carve({ shell, from, to, name }) → { shell, piece }. Pure: writes nothing. */
function carve({ shell, from, to, name }) {
  /* Forward slashes only, as slot names are written: on Windows a backslash is
     a separator to path.join, and "app/..\x" would leave app/ unnoticed. */
  if (!/^app\/[^@\]\\]+$/.test(name) || name.split('/').some(s => s === '' || s === '.' || s === '..')) throw new Error(`"${name}" is not a path under app/`);
  if (name === SHELL) throw new Error('the shell cannot be carved into itself');
  const lines = shell.split('\n');
  /* A shell ending in a newline splits to a last empty entry, which is not a line. */
  const total = shell.endsWith('\n') ? lines.length - 1 : lines.length;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > total)
    throw new Error(`lines ${from}..${to} are not a range of the shell's ${total} lines`);
  const before = lines.slice(0, from - 1).map(l => l + '\n').join('');
  const piece = lines.slice(from - 1, to).map(l => l + '\n').join('');
  const after = shell.slice(before.length + piece.length);
  if (before + piece + after !== shell) throw new Error(`lines ${from}..${to} do not end in a newline`);
  if (piece.includes('@@SLOT[')) throw new Error('the lines hold a slot token: a piece holds none');
  const times = shell.split(piece).length - 1;
  if (times !== 1) throw new Error(`the lines' text stands in the shell ${times} times: a piece must be found exactly once`);
  return { shell: before + Slots.token('app', name) + after, piece };
}

/* Payloads stand as themselves: a carve is judged on the app, not the content. */
const withPayloadsLeft = root => {
  const repo = Slots.repoResolver(null, root);
  return (kind, name) => (kind === 'payload' ? `<payload ${name}>` : repo(kind, name));
};

/* carveFile({ root, from, to, name }) → { bytes }. Writes the piece and the shell.
   `cut` is a parameter so the suite can hand it a carve that loses a line and
   see the same-bytes check refuse it, and `write` so it can fail either
   write and see the piece taken back; nothing else passes either.

   The shell is replaced by rename, so it is the old one or the new one, never
   part of each, and a write that fails takes the piece back with it. A process
   killed between the two writes still leaves a piece beside the old shell:
   auditApp names it as cited by no token, and deleting it is the whole repair. */
function carveFile({ root = ROOT, from, to, name, cut = carve, write = fs.writeFileSync }) {
  const shellFile = path.join(root, SHELL), pieceFile = path.join(root, name);
  const old = fs.readFileSync(shellFile, 'utf8');
  const r = cut({ shell: old, from, to, name });
  if (fs.existsSync(pieceFile)) throw new Error(`${name} already exists`);
  const was = Slots.assemble(old, withPayloadsLeft(root));
  fs.mkdirSync(path.dirname(pieceFile), { recursive: true });
  try { write(pieceFile, r.piece); } catch (e) {
    fs.rmSync(pieceFile, { force: true });
    throw new Error('the piece could not be written, so nothing was kept: ' + e.message);
  }
  let same = false;
  try { same = Slots.assemble(r.shell, withPayloadsLeft(root)) === was; } catch (e) { same = false; }
  if (!same) {
    fs.rmSync(pieceFile, { force: true });
    throw new Error('assembling the carved shell does not give the same bytes: nothing was kept');
  }
  const next = shellFile + '.carving';
  try {
    write(next, r.shell);
    fs.renameSync(next, shellFile);
  } catch (e) {
    fs.rmSync(next, { force: true });
    fs.rmSync(pieceFile, { force: true });
    throw new Error('the shell could not be written, so the piece was removed: ' + e.message);
  }
  return { bytes: r.piece.length };
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

/* auditApp(root) → { problems: [text], pieces: [name], tokens: n }
   The committed app/, with no export and no build: what assembling it will
   need from the repository is there, and nothing under app/ is left over. */
function auditApp(root = ROOT) {
  const problems = [];
  const shell = fs.readFileSync(path.join(root, SHELL), 'utf8');
  const repo = Slots.repoResolver(null, root);
  const payloads = new Set(Slots.PAYLOADS.map(p => p.name));
  const cited = new Map();
  let tokens = 0;
  for (const m of shell.matchAll(Slots.TOKEN_RE)) {
    const [, kind, name] = m;
    tokens++;
    if (kind === 'payload') { if (!payloads.has(name)) problems.push(`payload:${name} is not a payload app-slots knows`); continue; }
    if (!['src', 'asset', 'app'].includes(kind)) { problems.push(`${kind}:${name} is not a kind of slot`); continue; }
    if (typeof repo(kind, name) !== 'string') problems.push(`${kind}:${name} has no file in the repository`);
    if (kind === 'app') cited.set(name, (cited.get(name) || 0) + 1);
  }
  const pieces = walk(path.join(root, 'app')).map(f => path.relative(root, f).split(path.sep).join('/')).filter(n => n !== SHELL).sort();
  for (const name of pieces) {
    const n = cited.get(name) || 0;
    if (n !== 1) problems.push(`${name} is cited by ${n} tokens: a piece is cited by exactly one`);
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    if (text.includes('@@SLOT[')) problems.push(`${name} holds a slot token`);
    if (text.includes('\r')) problems.push(`${name} has a carriage return: the chain's output has none`);
  }
  return { problems, pieces, tokens };
}

if (require.main === module) {
  const [from, to, name] = process.argv.slice(2);
  if (!name) { console.error('usage: node scripts/carve.js <from> <to> app/<path>'); process.exit(2); }
  try {
    const r = carveFile({ from: Number(from), to: Number(to), name });
    console.log(`carved lines ${from}..${to} → ${name}  (${(r.bytes / 1e3).toFixed(1)} KB). Assembles to the same bytes.`);
    console.log('Nothing is staged. Beside a chain build: node scripts/assemble-app.js --compare build/systole.html');
  } catch (e) {
    console.error('carve: ' + e.message);
    process.exit(1);
  }
}

module.exports = { carve, carveFile, auditApp };
