#!/usr/bin/env node
/*
 * The quiz keyboard shortcuts stop at every field that takes typing.
 *
 *   node scripts/guards-patch.js <in.html> <out.html>
 *
 * The global keydown handler answers the current question when you press A–E,
 * and advances on Enter or Space. It steps aside for INPUT and TEXTAREA, which
 * covers the search box and the note editor — but not SELECT, and not anything
 * contenteditable.
 *
 * THAT GAP IS REACHABLE, and it took driving the app to be sure rather than
 * reading it. The handler also returns unless S.screen === 'quiz', which looks
 * like it should make the point moot: the chapter <select> lives on a different
 * screen. But the Apex panel is not a screen — it is a side panel over
 * whichever screen you are already on, and its settings view carries the model
 * picker, a <select>. Opening Apex on a question and choosing a model leaves a
 * SELECT focused while S.screen is still 'quiz'. Confirmed in the browser: with
 * the panel open on a question, #aiModel is visible and focusable and the quiz
 * handler is live.
 *
 * So typing "g" to jump to gemini-2.5-flash in the dropdown also answers the
 * question underneath with option G's equivalent, or advances past it. The
 * native type-ahead a <select> gives you is exactly the interaction that
 * collides here.
 *
 * SELECT and [contenteditable] both go in the exclusion. isContentEditable is
 * used rather than a matches('[contenteditable]') test because it is true for
 * elements inheriting editability from an ancestor, which is what the property
 * is for.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/guards-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];

function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

patch('guards: the quiz keyboard leaves a focused SELECT alone',
"  if(t==='INPUT'||t==='TEXTAREA')return;",
"  if(t==='INPUT'||t==='TEXTAREA'||t==='SELECT'||ev.target.isContentEditable)return;");

fs.writeFileSync(OUT, html);
console.log(`Keyboard guards — ${edits.length} edit(s)`);
edits.forEach(e => console.log('  ✓ ' + e));
console.log(`written: ${OUT}`);
