#!/usr/bin/env node
/*
 * The answer keeps room, whatever else is in the panel.
 *
 *   node scripts/answerroom-patch.js <in.html> <out.html>
 *
 * REPORTED FROM AN IPAD, WITH A PHOTOGRAPH: the figures under an Apex answer
 * "cover the explanation". Chain step 68 had already made that strip a
 * disclosure, shut by default — but only fixed half of it, and the wrong half
 * to stop at. Open the strip and the answer is crushed:
 *
 *     .ai-body height, figures open      iPad portrait    43px
 *                                        iPhone portrait 111px
 *                                        iPad landscape  273px
 *
 * 43px is one line. The panel is a column flex box in which .ai-body was the
 * only flex:1 child and carried min-height:0, so every pixel the figure list
 * took came out of the answer and nothing stopped it reaching zero. The
 * min-height:0 is load-bearing for a different reason — a flex item will not
 * shrink below its content without it, and if it cannot shrink it cannot
 * scroll — which is exactly why this was easy to write and hard to see.
 *
 * So the floor is set explicitly rather than left at zero. 8rem is about five
 * lines at the panel's body size: enough that the answer is still being read
 * rather than glimpsed, and the list gives up the difference instead. It still
 * scrolls, because overflow-y:auto does not care that the box now has a
 * minimum — it only ever cared that the box had a definite size.
 *
 * MEASURED, NOT REASONED. Four candidates were built and measured at three
 * frames before this one was chosen. Shrinking the figures too (max-height
 * 190 -> 150) bought another 20-50px of answer, and was rejected: the figures
 * are 12-lead traces and pressure tracings, and a figure too small to read is
 * not a saving. The numbers after this step:
 *
 *     .ai-body height, figures open      iPad portrait   128px
 *                                        iPhone portrait 171px
 *                                        iPad landscape  333px
 *
 * WHY THE PHOTOGRAPH SHOWED SOMETHING WORSE THAN THIS. The build in that
 * screenshot predates step 68 — its strip has no disclosure at all and is
 * always open, so the answer had no floor AND no way to fold the figures away.
 * That is a deployment being behind, not a second defect; this step is about
 * the state the fellow reaches on a current build by tapping the control.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/answerroom-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

patch('answerroom: the answer has a floor, and the figure list gives up the difference',
`.fig-strip.open .fig-list{display:flex;flex-direction:column;gap:8px;
  max-height:min(32vh,260px);overflow-y:auto;overscroll-behavior:contain}`,
`.fig-strip.open .fig-list{display:flex;flex-direction:column;gap:8px;
  max-height:min(24vh,200px);overflow-y:auto;overscroll-behavior:contain}
/* THE ANSWER'S FLOOR. Declared after .ai-body's own rule so it wins, and set
   in rem because it is a number of LINES that matters, not a number of pixels:
   about five of them. Without it .ai-body kept min-height:0 — correct for
   letting a flex item shrink enough to scroll, and catastrophic as a lower
   bound, because the figure list then took the answer down to 43px on an iPad
   held portrait. See scripts/answerroom-patch.js for the measurements.
   .fig-strip needs min-height:0 for the same reason .ai-body needed it: it is
   now the box expected to give way. */
.ai-body{min-height:8rem}
.fig-strip{min-height:0}`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('answerroom-patch applied:');
edits.forEach(e => console.log('  ✓ ' + e));
