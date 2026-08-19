#!/usr/bin/env node
/*
 * Fixes from a full code review.
 *
 *   node scripts/review-patch.js <type-output.html> <output.html>
 *
 * Small things, each one real, found by auditing the built app rather than the
 * source — which is the only place some of them are visible.
 *
 * ── A STRIPE THAT WAS NEVER VISIBLE ─────────────────────────────────────────
 * The strongest finding: the coloured accent stripe that marks a correct or
 * wrong answer has been 0px wide the whole time. Two passes defined the same
 * pseudo-element with two different reveal mechanisms, and the survivor was a
 * mixture of both that only works on hover. Details at the edit below.
 *
 * ── AND ONE MORE BAR THAT RAN LAYOUT ────────────────────────────────────────
 * The quiz progress bar advances on every question and animated `width`, so it
 * ran layout on every frame of every advance. Its track already clips and its
 * radius is on the track, so scaleX from the left edge is exact.
 *
 * ── DEAD CSS ────────────────────────────────────────────────────────────────
 * .ch-fill and .ch-bar have rules but no markup and no JS that creates them —
 * left behind by an earlier redesign. Three rules that can only ever mislead
 * the next person grepping for what styles a bar.
 *
 * ── ACCESSIBILITY ───────────────────────────────────────────────────────────
 * The two canvases with no accessible treatment get it: the home ECG strip is
 * decorative and is hidden from assistive tech; the Rhythm Lab monitor is
 * meaningful and gets a label. The icon-only Pencil buttons carry `title`,
 * which most screen readers announce but none are required to — `aria-label`
 * is the attribute that actually guarantees it.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/review-patch.js <type-output.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 200)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── a stripe that was never visible ─────────────────────────────────────────
 * The accent stripe down the left edge of an answer option is drawn by
 * .opt::before. An early pass gave it width:3px and revealed it with
 * transform:scaleY(0→1). A later pass redefined the same pseudo-element with
 * width:0 and revealed it by animating width to 3px on hover.
 *
 * The later rule wins for the properties it sets — width and transition — but
 * it never mentions transform, so the earlier scaleY reveal survives alongside
 * it. Hover works, because something sets width there. Correct and wrong do
 * not: they set transform and background, never width, so the stripe stays 0px
 * wide. The green and red are computed and never painted.
 *
 * Deleting the later override is the whole fix: the earlier rule is correct,
 * animates transform rather than width, and every reveal state already speaks
 * its language.
 */
patch('css: delete the override that made the option stripe 0px wide',
`.opt::before{content:'';position:absolute;left:0;top:0;bottom:0;width:0;
  background:var(--acc,var(--teal));transition:width .22s var(--glide)}`,
`/* .opt::before is defined above with width:3px and a scaleY reveal. It used to
   be redefined here with width:0 and a width transition, which left the correct
   and wrong stripes permanently invisible — they set transform, not width. */`);

patch('css: and the hover rule that was propping it up',
`  .opt:hover:not(:disabled)::before{width:3px}`,
`  /* no width to restore: the stripe reveals with transform */`);

/* ── the quiz progress bar ────────────────────────────────────────────────── */
patch('css: the quiz progress bar scales instead of widening',
`.prog-fill{height:100%;background:linear-gradient(90deg,var(--teal),var(--teal2));border-radius:3px;
  transition:width .4s var(--ease)}`,
`.prog-fill{height:100%;width:100%;background:linear-gradient(90deg,var(--teal),var(--teal2));
  transform-origin:left center;transition:transform .4s var(--ease)}`);

patch('js: the quiz progress bar is scaled, not widened',
`<div class="prog-track"><div class="prog-fill" style="width:\${prog.toFixed(1)}%"></div></div>`,
`<div class="prog-track"><div class="prog-fill" style="transform:scaleX(\${(prog / 100).toFixed(4)})"></div></div>`);

/* ── dead rules ───────────────────────────────────────────────────────────── */
patch('css: drop the dead .ch-bar / .ch-fill rules',
`.ch-fill{height:100%;border-radius:2px;transition:width .6s var(--ease)}`,
`/* .ch-bar / .ch-fill removed — no markup and no JS ever created them. */`);
patch('css: and their later override',
`.ch-fill{transition:width .9s var(--glide)}`,
``);

/* ── accessibility ────────────────────────────────────────────────────────── */
patch('a11y: the home ECG strip is decorative',
`<canvas id="heroECG" class="hero-ecg"></canvas>`,
`<canvas id="heroECG" class="hero-ecg" aria-hidden="true"></canvas>`);

patch('a11y: the Rhythm Lab monitor is meaningful, so it is labelled',
`<canvas id="labCanvas"></canvas>`,
`<canvas id="labCanvas" aria-label="Live electrocardiogram trace"></canvas>`);

/* title is announced by most screen readers but guaranteed by none. */
const TOOLS = [
  ['pen', 'Pen'], ['hl', 'Highlighter'], ['erase', 'Eraser'],
  ['undo', 'Undo'], ['clear', 'Clear this question'], ['note', 'Sticky note'],
];
let labelled = 0;
for (const [a, title] of TOOLS) {
  const re = new RegExp(`(data-a="${a}"[^>]*title="${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}")`, 'g');
  const n = (html.match(re) || []).length;
  if (n !== 1) throw new Error(`[a11y ${a}] expected exactly 1 match, found ${n}`);
  html = html.replace(re, `$1 aria-label="${title}"`);
  labelled++;
}
applied.push(`a11y: ${labelled} icon-only Pencil buttons given an aria-label`);

fs.writeFileSync(OUT, html);
console.log(`Review fixes applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
