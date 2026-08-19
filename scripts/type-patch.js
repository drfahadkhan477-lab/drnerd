#!/usr/bin/env node
/*
 * A modular type scale: 28 ad-hoc sizes become one ladder.
 *
 *   node scripts/type-patch.js <scale-output.html> <output.html>
 *
 * The app had twenty-eight distinct font sizes — 8.5, 9, 9.5, 10, 10.5, 11,
 * 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15 and so on. Not a scale; a list of
 * decisions each made once and never compared with the others. Half-pixel
 * neighbours cannot express hierarchy, because nobody can see the difference
 * between 13px and 13.5px — they only make the page quietly inconsistent.
 *
 * THE LADDER is a minor third, ratio 1.2, from a 16px body:
 *
 *     9   11   13   16   19   23   28   33   40   48   58
 *                    ↑ body
 *
 * Chosen over a major third (1.25) or a fourth (1.333) because this is a dense
 * reading app: the wider ratios look better on a marketing page and cost real
 * information density on a chapter grid. 1.2 is tight enough that adjacent
 * steps still coexist in one component, and wide enough that a step is always
 * visible. Every step is a whole pixel, so nothing lands on a half-pixel and
 * blurs.
 *
 * HOW IT IS APPLIED. Mechanically: every fixed `font-size` in the stylesheet is
 * snapped to its nearest step, ties rounding up. That is deliberate rather than
 * lazy — hand-curating 200 declarations is how you end up with a twenty-ninth
 * size. The rewrite touches only CSS `font-size:` declarations; the canvas
 * `ctx.font` strings that draw the ECG and the physiology diagrams use a
 * different syntax and are left exactly alone.
 *
 * THE ONE EXCEPTION, and it matters. The question stem and the answer
 * explanation are the text this app exists to show, and they were dropping to
 * 15px and 13px at narrower widths. A modular scale would happily keep them
 * there. The typography rubric puts the ordinary body floor at 1rem, and it is
 * right: the most-read text in a study app should not be the smallest. So the
 * reading roles are pinned at 16px on every breakpoint, which raises them on
 * phones rather than letting the ladder push them down.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/type-patch.js <scale-output.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 200)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── the ladder ───────────────────────────────────────────────────────────── */
const LADDER = [9, 11, 13, 16, 19, 23, 28, 33, 40, 48, 58];
function snap(v) {
  let best = LADDER[0];
  for (const s of LADDER) {
    const d = Math.abs(s - v), bd = Math.abs(best - v);
    if (d < bd || (d === bd && s > best)) best = s;   // ties round up: legibility wins
  }
  return best;
}

patch('css: the type scale, as tokens',
`  /* Spacing — a 4-point scale.`,
`  /* Type — a minor third (1.2) from a 16px body. Named by role rather than by
     size, because a role survives a change of ratio and "--t-14" does not. */
  --t-micro:9px;--t-tiny:11px;--t-meta:13px;--t-body:16px;--t-lead:19px;
  --t-h4:23px;--t-h3:28px;--t-h2:33px;--t-h1:40px;--t-display:48px;--t-hero:58px;
  /* Spacing — a 4-point scale.`);

/* ── the mechanical rewrite ───────────────────────────────────────────────── */
const before = new Map();
let changed = 0, total = 0;
html = html.replace(/font-size:([0-9.]+)px/g, (m, n) => {
  const v = parseFloat(n), s = snap(v);
  total++;
  before.set(v, (before.get(v) || 0) + 1);
  if (s !== v) changed++;
  return `font-size:${s}px`;
});
applied.push(`css: ${total} font-size declarations snapped to the ladder (${changed} moved)`);

/* The three fluid display sizes keep their fluidity — a clamp is a deliberate
   range, not an off-scale value — but both endpoints land on steps. */
let clamps = 0;
html = html.replace(/font-size:clamp\(([0-9.]+)px,([^,]+),([0-9.]+)px\)/g, (m, lo, mid, hi) => {
  clamps++;
  return `font-size:clamp(${snap(parseFloat(lo))}px,${mid},${snap(parseFloat(hi))}px)`;
});
applied.push(`css: ${clamps} fluid display sizes bracketed by the ladder`);

/* ── the reading floor ────────────────────────────────────────────────────── */
patch('css: the reading roles never go below the body step',
`/* ═══════════ Spacing scale, applied ═══════════`,
`/* The text this app exists to show. A modular scale would happily let these
   shrink with the viewport — they were at 15px and 13px — but the most-read
   text in a study app should never be the smallest thing on the screen. Pinned
   at the body step everywhere, which RAISES them on phones. */
.q-card,.exp-text,.reveal-body .exp-text{font-size:var(--t-body)}

/* ═══════════ Spacing scale, applied ═══════════`);

/* ── prove it ─────────────────────────────────────────────────────────────── */
const after = [...new Set([...html.matchAll(/font-size:([0-9.]+)px/g)].map(m => parseFloat(m[1])))].sort((a, b) => a - b);
const stray = after.filter(v => !LADDER.includes(v));
if (stray.length) throw new Error(`font sizes left off the ladder: ${stray.join(', ')}`);

fs.writeFileSync(OUT, html);
console.log(`Type scale applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`\n  ${[...before.keys()].length} distinct sizes → ${after.length} steps`);
console.log(`  was:  ${[...before.keys()].sort((a, b) => a - b).join(' ')}`);
console.log(`  now:  ${after.join(' ')}`);
console.log(`\nwritten: ${OUT}`);
