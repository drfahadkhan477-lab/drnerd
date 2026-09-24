#!/usr/bin/env node
/*
 * Search your notes — a screen for finding a note by what is in it.
 *
 *   node scripts/notesearch-patch.js <in.html> <out.html>
 *
 * WHY A SCREEN OF ITS OWN. The owner typed "sotalol" into the top-bar search
 * on the iPad and got "0 matches" with 530 notes on the shelf, one of them
 * titled "Sotalol: …". That search answers from the question bank only, and
 * its code lives in the licensed export, which this repository does not read
 * (CLAUDE.md) and no step has ever anchored into. The Notes screen has no
 * filter at all. So the notes get their own search, reached from its own
 * button, built from what the chain already provides: search(), whose index
 * holds every note as kind 'r', and md(), which renders a note's figures.
 * The owner chose this over reading the export's search code.
 *
 * The thinking lives in src/core/notesearch.js and is held by
 * tests/verify-notesearch-pure.js; this step carries it in and gives it a way
 * in. tests/verify-notesearch.js runs this script over a scaffold and drives
 * the result in a browser.
 *
 * ── FOUR ANCHORS, ALL OF THEM ECHO'S OUTPUT ──────────────────────────────
 *
 * This runs immediately after echo (87), the last step, and every anchor is
 * text echo-patch itself emits — its router line, its nav button, the banner
 * it re-emits, and the .nav rule its CSS ends on. Nothing runs between the
 * two, so nothing can rewrite them first: the focusmode failure (an anchor
 * copied from a step thirty places earlier and rewritten in between) cannot
 * happen here by construction. verify-notesearch-pure checks both halves of
 * that claim — each anchor appears in echo-patch.js, and this step directly
 * follows echo in CHAIN.
 *
 * Same economies as echo: no state on S (the query and the open note live in
 * a closure, so no SCHEMA_KEYS or save anchor), and interaction delegated from
 * `document` once, so nothing is re-attached after a render.
 *
 * THE RESULTS ARE REPAINTED ALONE while typing, exactly as echo repaints
 * .echo-out: re-rendering the screen would rebuild the input being typed into
 * and throw the caret to the end after every letter. verify-notesearch types a
 * word one key at a time to hold that.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/notesearch-patch.js <in.html> <out.html>'); process.exit(1); }

const ROOT = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(ROOT, 'src', 'core', 'notesearch.js'), 'utf8');

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 200)}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

/* ── 1. the module and its glue ───────────────────────────────────────────
   On the banner echo-patch re-emits after its own block. */
patch('notesearch: the module and its glue',
`/* ══════════════ Durable memory — see src/core/memory.js ══════════════ */`,
`/* ══════════ Search your notes — see src/core/notesearch.js ══════════ */
${core}

var NOTESEARCH = { q: '', open: null };

function nsShelf(){ return (typeof REF !== 'undefined' && REF) ? REF : []; }
function nsSearch(q, o){ return typeof search === 'function' ? search(q, o) : []; }

function buildNoteSearch(){
  return NoteSearch.screenHtml(NOTESEARCH, nsShelf(), nsSearch, e, md, icon);
}

function goNoteSearch(){ S.screen = 'notesearch'; NOTESEARCH.open = null; render(); }

function nsRepaintResults(){
  var out = document.querySelector('.ns-out');
  if (!out) return;
  var shelf = nsShelf();
  out.innerHTML = NoteSearch.resultsHtml(NOTESEARCH.q,
    NoteSearch.results(NOTESEARCH.q, shelf, nsSearch), shelf.length, e);
}

/* Delegated once, from the document — see echo-patch for why. */
document.addEventListener('input', function(ev){
  var el = ev.target;
  if (!el || !el.hasAttribute || !el.hasAttribute('data-ns-q')) return;
  NOTESEARCH.q = el.value;
  nsRepaintResults();
});
document.addEventListener('click', function(ev){
  var el = ev.target && ev.target.closest ? ev.target.closest('[data-ns-open],[data-ns-back]') : null;
  if (!el) return;
  NOTESEARCH.open = el.hasAttribute('data-ns-open') ? el.getAttribute('data-ns-open') : null;
  render();
  try { window.scrollTo(0, 0); } catch (_) {}
});

/* ══════════════ Durable memory — see src/core/memory.js ══════════════ */`);

/* ── 2. a screen to route to ──────────────────────────────────────────────
   Beside echo's, on the line echo wrote. */
patch('notesearch: the router learns one more screen',
`    :S.screen==='echo'?buildEchoScreen()`,
`    :S.screen==='notesearch'?buildNoteSearch()
    :S.screen==='echo'?buildEchoScreen()`);

/* ── 3. the way in ────────────────────────────────────────────────────────
   Immediately before echo's own button, in the same icon-btn idiom. The glyph
   is 'book', which the nav already has; the title says what it searches so
   it is not mistaken for the question search beside it. */
patch('notesearch: a way in, beside Echo',
`      <button class="icon-btn" onclick="goEcho()" title="Echo Studio"`,
`      <button class="icon-btn" onclick="goNoteSearch()" title="Search your notes"
        aria-label="Search your notes">\${icon('book')}</button>
      <button class="icon-btn" onclick="goEcho()" title="Echo Studio"`);

/* ── 4. css ───────────────────────────────────────────────────────────────
   On the .nav rule echo's CSS ends on. Theme tokens only, as echo does, so
   every palette including Contrast styles it without a set of its own. */
patch('notesearch: css — a field, a list of notes, one note',
`.nav{color:#fff;height:var(--navh);display:flex;align-items:center;`,
`.ns-screen{padding:0 max(20px,var(--sal)) 40px max(20px,var(--sar));max-width:var(--measure);margin:0 auto}
.ns-bar{padding:14px 0 10px}
.ns-q{font:inherit;font-size:1.05em;width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;
  background:var(--card);color:var(--text);border:1px solid var(--border)}
.ns-hint,.ns-count{color:var(--muted);margin:10px 2px}
.ns-count{font-size:.8em;letter-spacing:.08em;text-transform:uppercase}
.ns-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.ns-hit{font:inherit;width:100%;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:3px;
  padding:12px 14px;border-radius:12px;background:var(--card);color:var(--text);border:1px solid var(--border)}
.ns-chapter{color:var(--muted);font-size:.78em}
.ns-title{font-weight:600}
.ns-snippet{color:var(--muted);font-size:.9em;line-height:1.45}
.ns-hit mark,.ns-note mark{background:transparent;color:var(--accent);font-weight:600}
.ns-back{font:inherit;cursor:pointer;margin:14px 0 6px;padding:6px 12px;border-radius:999px;
  background:var(--card);color:var(--text);border:1px solid var(--border)}
.ns-note-title{margin:4px 0 6px}
.ns-source{color:var(--muted);font-size:.85em;margin:0 0 14px}
.nav{color:#fff;height:var(--navh);display:flex;align-items:center;`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('notesearch-patch applied:');
for (const x of edits) console.log('  ✓ ' + x);
