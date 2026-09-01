#!/usr/bin/env node
/*
 * Two real accessibility gaps, found doing a design pass rather than
 * building a feature: no visible keyboard-focus indicator anywhere outside
 * text inputs, and --dim used for text it was never meant to carry.
 *
 * WHY --dim, NOT NEW COLOURS. welcome-patch.js already measured this once:
 * "--dim is this app's decorative tertiary token and measures 2.3:1 against
 * a light card, which is below AA for text anyone is expected to read" —
 * and fixed it locally, on the one card that step added, by using --muted
 * instead. That is the app's own standing rule. It was never applied to the
 * 46 sites already shipped before that rule was written: source captions,
 * key messages, the skip button, keyboard hints, stat labels — all real
 * text, none of it decorative. --muted already clears AA (7.6:1 light,
 * 6.5:1 dark against --card) and is already the tested, themed token for
 * "quiet but legible" everywhere else, so this migrates the 46 mis-filed
 * sites to it rather than inventing a third tone or redefining --dim, which
 * would blur the distinction the project already drew on purpose. The one
 * background:var(--dim) site is left alone — it is paint, not text.
 *
 * FOCUS-VISIBLE. Three raw :focus rules exist, all on text inputs. Every
 * button, chip, chapter tile and quiz option had :hover (37 rules) and
 * :active (28 rules) but nothing a keyboard or trackpad — a Magic Keyboard,
 * say, which is a plausible way to study on an iPad — could ever trigger.
 * One rule, keyed to the same --teal already used for input focus, closes
 * that for every interactive element at once.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/contrastfix-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patchAll(label, find, replace, expectedCount) {
  const n = html.split(find).length - 1;
  if (n !== expectedCount) throw new Error(`[${label}] expected ${expectedCount} match(es), found ${n}`);
  html = html.split(find).join(replace);
  edits.push(label);
}
function patch(label, find, replace) { patchAll(label, find, replace, 1); }

patchAll('contrastfix: migrate legible text off --dim, onto the already-AA --muted',
  'color:var(--dim)', 'color:var(--muted)', 46);

patch('contrastfix: a keyboard/trackpad focus ring, once, for every interactive element',
`  --ease-spring:cubic-bezier(.34,1.56,.64,1);
}`,
`  --ease-spring:cubic-bezier(.34,1.56,.64,1);
}

/* One ring for every element a keyboard or trackpad can land on, so tabbing
   through the app is never silent. :focus-visible (not :focus) so a mouse or
   touch tap — already answered by :active — never gets an outline it did not
   ask for. */
:focus-visible{outline:2.5px solid var(--teal);outline-offset:2px;border-radius:6px}`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('contrastfix-patch applied:');
edits.forEach(e => console.log('  ✓ ' + e));
