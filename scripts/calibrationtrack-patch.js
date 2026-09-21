#!/usr/bin/env node
/*
 * A calibrated-instrument motif for the one bar every user sees on every
 * visit: ten faint ticks across the home progress track, the way a monitor's
 * own scale is marked. Static — no animation, no new element, no JS — a
 * background-image layered under the existing fill bars, in the same
 * --border3 token every theme already resolves correctly. This is the
 * restrained version of "calibrated instrument-style indicators": one motif,
 * one place, not a texture applied everywhere.
 *
 * THE TICKS READ IN THE UNFILLED PART OF THE TRACK, ON PURPOSE. .hp-seen and
 * .hp-mast are absolutely-positioned children with their own backgrounds, so
 * they cover the scale as they grow: a new reader sees the whole ten, someone
 * at 80% sees the last two. Drawing the ticks over the fills instead would
 * mean a pseudo-element above .hp-shine's sweep, which is more moving parts
 * across the one element this app animates most, to put hatching over the
 * mastery gradient — the one surface on the home screen meant to read clean.
 *
 * --border3, not a literal: it is the strongest of the three border weights
 * in every palette (lighter than the track on the dark themes, darker on the
 * light ones), so the scale follows --border2's fill without this patch
 * knowing anything about which theme is on.
 *
 * HOW FAINT, MEASURED. --border3 against --border2 is 1.36:1 on Slate, 1.34
 * on Parchment, 1.23 on Nocturne, 1.34 on Cath Lab, 1.42 on Monitor and 2.06
 * on Contrast. That is a hairline, which is the intent — this is decoration
 * beside an aria-valuenow, a legend and a numeric percentage, so it carries
 * no information of its own and is not held to a contrast minimum. But 1.23
 * is close enough to nothing that "subtle" and "invisible" cannot be told
 * apart from the numbers alone, and Daylight and Midnight take their border
 * tokens from the base export, which cannot be read from here at all. So
 * whether this reads as calibration or as nothing is a judgement for the
 * first real build on a real screen: if it needs strengthening, the single
 * lever is the tick colour on the line below — var(--text) at a low alpha
 * would give every theme the same perceptual weight instead of inheriting
 * whatever its border ladder happens to provide.
 *
 * BACKGROUND-COLOR AND BACKGROUND-IMAGE, NOT THE SHORTHAND. Written as one
 * `background:` the two are a single declaration, so anything that made the
 * gradient invalid — an older Safari meeting a syntax it does not know — would
 * discard the track's own fill along with it and leave a transparent bar. Split
 * in two, the worst case is a track that simply has no ticks.
 *
 *   node scripts/calibrationtrack-patch.js <in.html> <out.html>
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/calibrationtrack-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 200)}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

patch('calibrationtrack: ten faint ticks across the progress track, like a monitor scale',
`.hp-track{position:relative;height:22px;border-radius:12px;background:var(--border2);
  overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,.12)}`,
`.hp-track{position:relative;height:22px;border-radius:12px;
  background-color:var(--border2);
  background-image:repeating-linear-gradient(90deg,
    var(--border3) 0,var(--border3) 1px,transparent 1px,transparent 10%);
  overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,.12)}`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('calibrationtrack-patch applied:');
edits.forEach(e => console.log('  ✓ ' + e));
