#!/usr/bin/env node
/*
 * A documented spacing scale, and progress bars that stop causing layout.
 *
 *   node scripts/scale-patch.js <crisp-output.html> <output.html>
 *
 * Two findings from auditing the app against published design rubrics — Emil
 * Kowalski's motion principles, and the "Impeccable" layout/typography rules.
 *
 * ── 1. THE SPACING SCALE ────────────────────────────────────────────────────
 * The app had twenty-four distinct single-value paddings, including every whole
 * number from 1px to 18px, and no spacing tokens at all. That is the exact
 * anti-pattern the layout rubric names: "one-off spacing values replacing
 * documented scales", and "repeated spacing values creating equal weight
 * everywhere".
 *
 * The fix is a 4-point scale — 4 rather than 8, because a 4-unit base keeps the
 * middle steps (12, 20, 28) that an 8-only scale has to round away, and this UI
 * uses those steps constantly.
 *
 * It is applied as an override layer at the end of the stylesheet rather than by
 * rewriting the rules in place. That is deliberate: retrofitting a scale into a
 * few hundred existing rules by find-and-replace is how you silently break a
 * layout, and each surface below is a decision worth being able to read in one
 * place. The values move by at most 2px each — the point is the rhythm being
 * deliberate, not any individual number changing.
 *
 * ── 2. THE PROGRESS BARS ────────────────────────────────────────────────────
 * Two fills animated `width` for the better part of a second: the chapter
 * mastery bar and the answer-distribution bars. Animating width runs layout on
 * every frame; transform runs on the compositor. Kowalski's rule is blunt about
 * it — animate transform and opacity, nothing else.
 *
 * The reason this is not a one-line change, and the reason the rule usually
 * gets applied wrongly: scaleX squashes a border-radius into an ellipse at low
 * fill values. So the two bars get different treatments, chosen by whether
 * their radius is actually visible.
 *
 *   chapter bar        4px tall, in a track that already clips, so its own 2px
 *                      radius never showed — scaleX from the left edge, radius
 *                      dropped, nothing lost.
 *   distribution bar   20px tall with a 5px radius you can plainly see —
 *                      revealed with clip-path: inset(… round 5px) instead.
 *                      Never touches layout either, keeps the element at full
 *                      size so the radius stays circular, and rounds the
 *                      revealed edge. Which is also the primitive Kowalski
 *                      recommends for exactly this.
 *
 * The home progress bar is left on width deliberately. Its mastery layer
 * contains the sweeping highlight element, and scaling or clipping the parent
 * would take the child with it; it also animates once on load rather than on
 * every render, so it is not on a hot path. Applying the rule there would cost
 * a visible artefact to fix an invisible cost.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/scale-patch.js <crisp-output.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 200)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── the tokens ───────────────────────────────────────────────────────────── */
patch('css: the spacing scale, as tokens',
`  /* Radius & shadows */`,
`  /* Spacing — a 4-point scale. Four rather than eight because this UI leans on
     the middle steps (12, 20, 28) that an 8-only scale rounds away. --s0 is the
     hairline exception for insets inside a chip or a mark, not page rhythm. */
  --s0:2px;--s1:4px;--s2:8px;--s3:12px;--s4:16px;--s5:20px;
  --s6:24px;--s7:28px;--s8:32px;--s9:40px;--s10:48px;--s11:64px;
  /* Radius & shadows */`);

/* ── the surfaces, on the scale ───────────────────────────────────────────── */
patch('css: structural surfaces on the scale',
`/* ── live hero ── */`,
`/* ═══════════ Spacing scale, applied ═══════════
   An override layer, on purpose — see scripts/scale-patch.js for why. Every
   value below is a step on the 4-point scale; the ones that were already on it
   are restated rather than left out, so this block is the whole story of the
   app's structural rhythm rather than a list of exceptions to it. */
.feed-card{padding:var(--s4) var(--s5)}
.ch-tile{padding:var(--s4);gap:var(--s2)}
.quick{padding:var(--s3) var(--s1);gap:var(--s1)}
.q-card{padding:var(--s6) var(--s7)}
.opt{padding:var(--s4) var(--s5);gap:var(--s3)}
.qbar{padding:var(--s4) var(--s5)}
.physio-note{padding:var(--s3) var(--s4) var(--s4)}
.physio-chips{padding:var(--s3) var(--s4) 0;gap:var(--s2)}
.lead-card{padding:var(--s3) var(--s4) var(--s4)}
.twelve-hint{padding:var(--s2) var(--s4) 0}
.home-progress{margin:calc(var(--s1) * -1) var(--s0) var(--s5)}
.section-label{margin:var(--s6) 0 var(--s3)}

/* ── live hero ── */`);

patch('css: the hero on the scale too',
`.hero-live{position:relative;overflow:hidden;border-radius:24px;margin:12px 0 16px;
  padding:26px 22px 74px;isolation:isolate;`,
`.hero-live{position:relative;overflow:hidden;border-radius:24px;margin:var(--s3) 0 var(--s4);
  padding:var(--s6) var(--s6) 74px;isolation:isolate;`);

/* ── the bars ─────────────────────────────────────────────────────────────── */
/* Anchored on the 12-lead's own CSS rather than on a chip belonging to the
   Rhythm Lab heart: that heart has been removed, and an anchor that depends on
   a feature existing is an anchor that breaks when the feature goes. */
patch('css: bars reveal without running layout',
`.lead-empty{font-size:13px;color:var(--dim)}`,
`/* Two different techniques, because the two bars are not the same problem.

   The chapter bar is 4px tall inside a track that already clips, so its own
   2px radius was never visible: scaleX from the left edge is the cheapest
   thing that works, and nothing is lost by dropping the radius.

   The distribution bar is 20px tall with a 5px radius that IS visible, and
   scaleX would squash that radius into an ellipse at low percentages. So it
   reveals with clip-path instead — which still never touches layout, keeps the
   element at full size so the radius stays circular, and rounds the revealed
   edge with inset()'s own 'round'. Same rule, honoured properly. */
.lead-empty{font-size:13px;color:var(--dim)}
.chp-fill{width:100%;border-radius:0;transform-origin:left center;
  transition:transform .9s var(--glide)}
.dist-bar{width:100%;min-width:0;
  transition:clip-path .8s var(--glide) .1s}
@media(prefers-reduced-motion:reduce){
  .chp-fill{transition:none}
  .dist-bar{transition:none}
}`);

patch('js: the distribution bar is revealed, not widened',
`<div class="dist-bar-wrap"><div class="dist-bar" style="width:\${o.p}%"></div>`,
`<div class="dist-bar-wrap"><div class="dist-bar" style="clip-path:inset(0 \${(100 - Math.max(o.p, 0.6)).toFixed(2)}% 0 0 round 5px)"></div>`);

patch('js: the chapter mastery bar is scaled, not widened',
`<div class="chp-bar"><div class="chp-fill" style="width:\${cp}%;background:\${cc}"></div></div>`,
`<div class="chp-bar"><div class="chp-fill" style="transform:scaleX(\${cp / 100});background:\${cc}"></div></div>`);

fs.writeFileSync(OUT, html);
console.log(`Spacing scale + bar transforms applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
