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
  background:var(--border2) repeating-linear-gradient(90deg,
    var(--border3) 0,var(--border3) 1px,transparent 1px,transparent 10%);
  overflow:hidden;box-shadow:inset 0 1px 3px rgba(0,0,0,.12)}`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('calibrationtrack-patch applied:');
edits.forEach(e => console.log('  ✓ ' + e));
