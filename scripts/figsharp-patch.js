#!/usr/bin/env node
/*
 * A figure is drawn at the size it has, not stretched to the size of the card.
 *
 *   node scripts/figsharp-patch.js <in.html> <out.html>
 *
 * REPORTED AS "the images in the notes are blurry", and they were, for a
 * reason that measures cleanly.
 *
 * TWO PIPELINES, TWO RESOLUTIONS. The question figures were extracted at 1100
 * px — 408 of them, only two under 900. The reference-note figures were cut by
 * a different pass and came out at a median of 644 px, with 95 of 119 under
 * 900 and the narrowest at 278. The app never knew the difference, because
 * both were handed the same rule:
 *
 *     .ref-body .ref-fig img { width: 100% }
 *
 * width:100% is an instruction to fill the card whatever the picture has to
 * say about it. Measured in the built app on an iPad viewport, both
 * orientations render a note figure at 876 CSS px. At a device pixel ratio of
 * 2 that is 1752 device pixels asked of a 644-pixel crop — a 2.7x upscale, and
 * 2.7x upscaled is what "blurry" looks like. On the narrowest crops it is over
 * six times.
 *
 * THE FIX IS TO STOP ASKING. width:auto with max-width:100% draws each figure
 * at its own width and still shrinks the four wide ones (up to 1328 px) to fit
 * — so nothing overflows and nothing is stretched. A 644-pixel crop renders
 * 644 CSS px and is as sharp as the pixels allow.
 *
 * WHAT THIS DOES NOT DO, and it matters for what to expect. It does not create
 * detail that was never captured. On a 2x display a 644-pixel crop shown at
 * 644 CSS px is still a 2x upscale in device pixels; it is simply the best
 * available from that crop. The remaining half of this problem is upstream:
 * the note figures want re-cutting at the resolution the question figures
 * already use. That needs the source PDFs and is the owner's pipeline, not
 * this build's.
 *
 * WHY THE FIGURE STILL LOOKS DELIBERATE AT 644 px IN AN 876 px CARD. The frame
 * shrinks to the picture and centres, rather than leaving a wide bordered box
 * with a small image adrift at one end. And every one of these figures is
 * already a button into the full-screen zoom viewer — md() has emitted
 * onclick="openFigureFrom(this)" since the figures were introduced — so the
 * inline size is an overview, not the only way to read a table.
 *
 * THE CHAT COPY GETS THE SAME TREATMENT. .msg .ref-fig renders the same
 * figures from the same store into the Apex transcript with the same
 * width:100%. Fixing one and not the other would leave the identical picture
 * sharp in a note and soft in a reply.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/figsharp-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── the note body ──────────────────────────────────────────────────────── */
patch('figsharp: a note figure is drawn at its own size',
`.ref-body .ref-fig{margin:0 0 14px;padding:0;border:1px solid var(--border);
  border-radius:10px;overflow:hidden;background:var(--card)}
.ref-body .ref-fig img{display:block;width:100%;height:auto}`,
`/* The frame shrinks to the picture instead of the picture stretching to the
   frame. width:fit-content with max-width:100% keeps a 1328px figure inside
   the card and lets a 278px table stay 278px, and the auto margins centre
   whatever is left over so a narrow figure reads as placed rather than
   stranded. */
.ref-body .ref-fig{margin:0 auto 14px;padding:0;border:1px solid var(--border);
  border-radius:10px;overflow:hidden;background:var(--card);
  width:fit-content;max-width:100%}
/* width:auto, NOT width:100%. The old rule asked a 644px crop to fill an 876px
   card — 1752 device pixels on a 2x iPad, a 2.7x upscale, which is what was
   reported as blurry. max-width still shrinks the wide ones to fit. */
.ref-body .ref-fig img{display:block;width:auto;max-width:100%;height:auto}`);

/* ── the same figures, in a chat reply ──────────────────────────────────── */
patch('figsharp: and so is the copy Apex shows',
`.msg .ref-fig img{display:block;width:100%;height:auto;max-width:100%;`,
`.msg .ref-fig img{display:block;width:auto;max-width:100%;height:auto;`);

fs.writeFileSync(OUT, html);
console.log(`Figure sharpness applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
