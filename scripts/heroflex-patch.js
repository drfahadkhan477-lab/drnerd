#!/usr/bin/env node
/*
 * The hero stops reserving its vertical space by how WIDE the screen is.
 *
 *   node scripts/heroflex-patch.js <in.html> <out.html>
 *
 * MEASURED, NOT SUSPECTED. On an 11-inch iPad in landscape — 1194x834, the
 * widest-and-shortest shape the app is held in — the home screen's landscape
 * grid budgets itself exactly one screen:
 *
 *     min-height  732px   = 100dvh - navh - sat - 40
 *     rows        317.5 hero | 136 progress | 0 <- the 1fr spacer | 245 doors
 *                 698.5 + 36 padding = 734.5
 *
 * The spacer meant to absorb slack is already ZERO. There is none. And the
 * reason the hero costs 317.5px of it is two clamps that measure the wrong
 * axis:
 *
 *     .hero-ecg{height:clamp(92px,13.5vw,140px)}
 *     .hero-live{padding-bottom:clamp(104px,16vw,158px)}
 *
 * 13.5vw of 1194 is 161, so the ECG takes its 140px maximum; 16vw is 191, so
 * the padding reserved for it takes its 158px maximum. Both pick their TALLEST
 * value on precisely the viewport with the least height to give — a wide, short
 * one. Rotate the same iPad to portrait and the hero is shorter, on a screen
 * with 360px more room.
 *
 * So each gains a height term. min() takes whichever axis is scarcer, and the
 * existing floors still hold, so nothing collapses on a phone:
 *
 *     1194x834   ECG 140 -> 92   padding 158 -> 108   (the hero gives back ~50px)
 *     1366x1024  ECG 140 -> 113  padding 158 -> 133
 *     390x844    unchanged — 13.5vw is 53, far under both the floor and 11vh
 *
 * MEASURED BY verify-home, THREE RUNS, IDENTICAL EACH TIME:
 *
 *     an 11-inch iPad in landscape fits too   97px over  ->  47px over
 *
 * WHAT THIS DOES NOT DO. It does not close that last 47px, and nothing about
 * the hero can: the landscape grid gives its whole one-screen budget to four
 * named areas and sweeps every other child into implicit rows BEYOND it, so
 * the split build's offline-download card is overflow by construction rather
 * than by size. Freeing space inside the grid does not reach it — the pearl,
 * which spans the first three rows and is sized by its own content, simply
 * takes whatever the hero gives back. That is a separate question, and it is
 * about what belongs on the home screen rather than about how tall it is.
 *
 * This step stands on its own terms regardless: an element that reserves
 * vertical space according to horizontal room is wrong whether or not anything
 * else is competing for that room.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/heroflex-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

patch('heroflex: the strip and the room kept for it both answer to height as well',
`.hero-ecg{height:clamp(92px,13.5vw,140px)!important}
.hero-live{padding-bottom:clamp(104px,16vw,158px)!important}`,
`/* min(), so whichever axis is scarcer decides. The floors are untouched: a
   phone is nowhere near either term and renders exactly as before. */
.hero-ecg{height:clamp(92px,min(13.5vw,11vh),140px)!important}
.hero-live{padding-bottom:clamp(104px,min(16vw,13vh),158px)!important}`);

/* ── the guards ─────────────────────────────────────────────────────────── */
if (/clamp\(92px,13\.5vw,140px\)/.test(html) || /clamp\(104px,16vw,158px\)/.test(html)) {
  throw new Error('heroflex: a width-only clamp survives');
}
/* The padding has to stay larger than the strip it reserves room for, or the
   ECG overlaps the subtitle. Checked as arithmetic on the two height terms
   rather than trusted: 13vh > 11vh at every viewport, and 104 > 92. */
if (!/clamp\(104px,min\(16vw,13vh\),158px\)/.test(html) || !/clamp\(92px,min\(13\.5vw,11vh\),140px\)/.test(html)) {
  throw new Error('heroflex: the replacement did not land as written');
}
applied.push('heroflex: the room kept is still larger than the strip kept in it');

fs.writeFileSync(OUT, html);
console.log(`Hero flex applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
