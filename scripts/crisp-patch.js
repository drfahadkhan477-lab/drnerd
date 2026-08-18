#!/usr/bin/env node
/*
 * A crispness pass: every canvas backs itself with enough device pixels to
 * stay sharp on a high-DPI display.
 *
 *   node scripts/crisp-patch.js <splash-output.html> <output.html>
 *
 * "8K-crisp" is not a resolution you set; it is the absence of soft edges. A
 * canvas draws into a backing store of a fixed pixel size and the browser
 * scales that to the element's CSS box, so on a 2× or 3× display a canvas sized
 * 1:1 with CSS pixels is upscaled and every hairline blurs. The fix is to size
 * the backing store by devicePixelRatio — which the app already does — and to
 * lift the ceiling on how far it will go.
 *
 * The source modules (the heart, the 12-lead, the Apex avatar) carry their own
 * lifted ceilings. This patch reaches the two canvases that live in the base
 * app rather than a module:
 *
 *   · the ECG monitor — the hero strip and the Rhythm Lab trace. Thin bright
 *     lines on a dark grid are exactly what a too-low backing store softens, so
 *     it goes to 3×, which is cheap for a short strip and the most visible win
 *     on the whole home screen.
 *   · the Pencil ink layer — annotation strokes must land as sharp as graphite
 *     on paper, so it matches at 3×.
 *
 * The ceilings are ceilings, not targets: min() with devicePixelRatio means a
 * 1× display still renders 1×. Nobody's battery pays for pixels their screen
 * cannot show.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/crisp-patch.js <splash-output.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 200)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* The ECG monitor's backing store. Written without spaces in the base app, which
   is what makes it distinct from the module canvases' own (spaced) ceilings. */
patch('the ECG strips render at up to 3x',
`const dpr=Math.min(window.devicePixelRatio||1,2);`,
`const dpr=Math.min(window.devicePixelRatio||1,3);`);

/* The Pencil ink layer. */
patch('the ink layer renders at up to 3x',
`const dpr=Math.min(window.devicePixelRatio||1,2.5);`,
`const dpr=Math.min(window.devicePixelRatio||1,3);`);

fs.writeFileSync(OUT, html);
console.log(`Crispness pass applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
