#!/usr/bin/env node
/*
 * The Rhythm Lab gets its rhythms back.
 *
 *   node scripts/chipfix-patch.js <in.html> <out.html>
 *
 * apexroom moved the Apex panel's nine suggested prompts behind a button,
 * because nine chips filling the pane was most of what you saw when you opened
 * the tutor. It did that by hiding the class they carry:
 *
 *     .chips      { display:none }
 *     .chips.open { display:flex }
 *
 * `.chips` is not the Apex panel's class. It is a shared one, and three screens
 * render it. Only the Apex panel was taught to pass `.open`:
 *
 *     Apex panel      class="chips${apexChipsOpen?' open':''}"   → still works
 *     Rhythm Lab      class="chips lab-chips"                    → invisible
 *     Search          class="chips sug"                          → invisible
 *
 * So the Lab lost the row of 27 rhythm buttons that is the entire way you
 * change what it is drawing. The trace kept working, which is what made it look
 * like a missing feature rather than a broken one: one ECG on screen, no way to
 * reach Mobitz or WPW or any of the other 26, and no error anywhere. The search
 * screen lost its "Try a topic" chips the same way, silently.
 *
 * HOW IT SURVIVED THE SUITE, which is the part worth keeping. The check that
 * should have caught it counted `querySelectorAll('.chip').length`. Those 27
 * nodes are all present — built, attributed, in the DOM, and painting nothing,
 * because a node count cannot see `display:none`. Every assertion about
 * something being on screen now reads getComputedStyle and a bounding box
 * instead. Counting the DOM answers a question nobody asked.
 *
 * The fix is to scope the hiding to the thing that wanted it. `.chips` goes back
 * to being a plain flex row; the panel's own row is hidden by its id, which it
 * already has, and its existing `.open` toggle is untouched.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/chipfix-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

patch('chipfix: a chip row is visible unless something asks otherwise',
'.chips{display:none;flex-wrap:wrap;gap:7px 9px;padding:0 18px 12px}\n.chips.open{display:flex}',
'.chips{display:flex;flex-wrap:wrap;gap:7px 9px;padding:0 18px 12px}\n' +
'/* Only the tutor\'s own prompt row folds away — see chipfix-patch.js. It is\n' +
'   hidden by id rather than by class so the Lab and the search screen, which\n' +
'   share .chips and have no button to unfold them, keep theirs. */\n' +
'#aiChips{display:none}\n#aiChips.open{display:flex}');

fs.writeFileSync(OUT, html);
console.log(`Chip rows — ${edits.length} edit(s)`);
edits.forEach(e => console.log('  ✓ ' + e));
console.log(`written: ${OUT}`);
