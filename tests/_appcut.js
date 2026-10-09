'use strict';
/* ── a region of the app, as it ships ─────────────────────────────────────────
   Suites that used to run a retired *-patch.js over a scaffold now take the
   same code from app/ instead, where every edit has gone since the chain was
   retired. cut() returns the text between two anchors — `from` included, `to`
   excluded unless `inclusive` — and refuses unless each anchor occurs exactly
   once, the same rule patch() kept: an anchor that matches twice is not an
   anchor. Build slots for repository files (@@SLOT[src:…]@@ and
   @@SLOT[app:…]@@) are filled from the files they name, as scripts/
   assemble-app.js fills them; a payload slot is left alone, because a payload
   is the owner's licensed content and no suite reads it. */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { repoResolver } = require(path.join(ROOT, 'scripts', 'app-slots.js'));

function once(src, anchor, where) {
  const n = src.split(anchor).length - 1;
  if (n !== 1) throw new Error(`${where}: expected the anchor once, found ${n}: ${anchor.slice(0, 60)}`);
  return src.indexOf(anchor);
}

const resolve = repoResolver(null, ROOT);
function fill(text) {
  return text.replace(/@@SLOT\[(src|app):([^\]]+)\]@@/g, (m, kind, name) => {
    const body = resolve(kind, name);
    if (body === undefined) throw new Error(`no such ${kind} file for a slot: ${name}`);
    return body;
  });
}

/* cut('app/systole.html', from, to, { inclusive }) */
function cut(file, from, to, opts = {}) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const i = once(src, from, file);
  const j = once(src, to, file);
  if (j < i) throw new Error(`${file}: the end anchor comes before the start`);
  return fill(src.slice(i, opts.inclusive ? j + to.length : j));
}

/* THE STYLESHEET, AS THE APP GETS IT. It used to be one file,
   app/css/systole.css; it is now ten pieces under app/css/, each a slot in
   app/systole.html's <style>. This joins the pieces in the order the shell
   names them, which is the order the cascade sees, so a suite reading a rule
   or cutting between two anchors reads exactly what ships, wherever the piece
   boundaries fall. */
const SHEET_RE = /@@SLOT\[app:(app\/css\/[^\]]+\.css)\]@@/g;
function stylesheetPieces() {
  const shell = fs.readFileSync(path.join(ROOT, 'app', 'systole.html'), 'utf8');
  const style = shell.match(/<style>([\s\S]*?)<\/style>/);
  if (!style) throw new Error('app/systole.html has no <style>');
  const names = [...style[1].matchAll(SHEET_RE)].map(m => m[1]);
  if (!names.length) throw new Error('app/systole.html\'s <style> names no app/css/ piece');
  return names;
}
function stylesheet() {
  return stylesheetPieces().map(n => fs.readFileSync(path.join(ROOT, n), 'utf8')).join('');
}
/* cut() over the joined stylesheet. */
function cutStylesheet(from, to, opts = {}) {
  const src = stylesheet();
  const i = once(src, from, 'the stylesheet');
  const j = once(src, to, 'the stylesheet');
  if (j < i) throw new Error('the stylesheet: the end anchor comes before the start');
  return fill(src.slice(i, opts.inclusive ? j + to.length : j));
}

module.exports = { cut, fill, once, stylesheet, stylesheetPieces, cutStylesheet };
