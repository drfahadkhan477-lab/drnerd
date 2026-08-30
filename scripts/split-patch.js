#!/usr/bin/env node
/*
 * Apex beside the question, or under it — whichever the screen is shaped for.
 *
 *   node scripts/split-patch.js <input.html> <output.html>
 *
 * Below 1024px the tutor was a bottom sheet, and on an iPad in portrait — 834
 * points wide — that sheet covers the stem you are asking about. You end up
 * scrolling the question back into view to read the sentence Apex is
 * explaining, which is the one thing a tutor panel must never make you do.
 *
 * WHICH SPLIT IS RIGHT DEPENDS ON THE SHAPE OF THE SCREEN, NOT ITS SIZE.
 * Side by side wants width; stacked wants height. A 1210×834 iPad has width to
 * spare and a 834×1194 iPad has height to spare, and they are the same iPad.
 * So orientation decides, the way Mail and Notes decide it:
 *
 *   landscape → question left, Apex right
 *   portrait  → question above, Apex below, each scrolling on its own
 *
 * Measured rather than guessed: side-by-side in portrait leaves the stem 56% of
 * 834px, which is tight for a long vignette; stacked in landscape gives two
 * letterboxes and wastes the width. Adaptive costs one media query more than
 * either and is better than both.
 *
 * A PHONE GETS NEITHER. Below 700px there is no room to split anything, so the
 * bottom sheet stays exactly as it is — it is the right answer at that size.
 *
 * THE SCROLL MOVES, AND FOURTEEN CALLS HAVE TO MOVE WITH IT. Stacked panes
 * scroll themselves, which means the document stops scrolling and every
 * window.scrollTo(0,0) in the app silently does nothing — you would arrive at
 * the top of a screen and find yourself halfway down it. All fourteen go
 * through one helper that scrolls whichever thing is actually the scroller.
 *
 * Every edit asserts its match count, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/split-patch.js <input.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}
/* Same discipline, many sites: the count is stated and asserted, so a call site
   appearing or disappearing fails the build rather than being missed. */
function patchAll(label, find, replace, expected) {
  const n = html.split(find).length - 1;
  if (n !== expected) throw new Error(`[${label}] expected exactly ${expected} matches, found ${n}`);
  html = html.split(find).join(replace);
  applied.push(`${label} (${n})`);
}


/* ── 1. one scroller, whatever the layout ─────────────────────────────────
   The call sites are rewritten BEFORE the helper is inserted, because the
   helper contains the very string being replaced and would otherwise be
   rewritten into a call to itself. Fifteen matches instead of fourteen is how
   that announced itself. */
patchAll('split: send every arrival through it',
  `window.scrollTo(0,0)`, `toTop()`, 14);

patch('split: something that knows what is actually scrolling',
`function goHome(){`,
`/* In a stacked split the document does not scroll — #app does. Every "go to
   the top of this screen" has to ask the right one, or it quietly does nothing
   and you arrive halfway down. Both are scrolled because only one of them is
   ever the scroller, and which one depends on a media query. */
function toTop(){
  try{ window.scrollTo(0,0); }catch(_){}
  const a=document.getElementById('app');
  if(a&&a.scrollTop) a.scrollTop=0;
}
function goHome(){`);

/* ── 2. the two layouts ──────────────────────────────────────────────────── */
/* Anchored AFTER the max-width:1023px block, not before it. These rules and
   that one are the same specificity, so source order decides — inserted above
   it, every one of them loses and the sheet stays. That is exactly what
   happened on the first run: iPad portrait and a 900x700 tablet both kept a
   fixed-position sheet while the 1024pt iPad Pro, which the old block never
   matched, split correctly. */
patch('split: landscape puts Apex beside the question, portrait puts it under',
`  .swatches{flex-direction:row}
}

/* ── retrieval strip, peek modal, reference library ── */`,
`  .swatches{flex-direction:row}
}

/* ── Apex beside the question, or under it ──────────────────────────────────
   Which split is right depends on the SHAPE of the screen, not its size: side
   by side wants width, stacked wants height, and a 1210×834 iPad and a 834×1194
   iPad are the same iPad. So orientation decides. Below 700px neither fits and
   the bottom sheet above stays exactly as it is.

   These come after the max-width:1023px block on purpose — they undo it for
   the shapes that can do better. */

/* Landscape: question left, Apex right. Also claims the 768–1023 band that the
   sheet used to take, where there is width for two columns. */
@media (min-width:768px) and (orientation:landscape){
  #shell{display:flex;align-items:stretch}
  #ai{position:sticky;inset:auto;top:calc(var(--navh) + var(--sat));
    height:calc(100dvh - var(--navh) - var(--sat));
    width:0;flex:0 0 0;max-width:none;
    border-left:1px solid var(--border);border-top:none;
    border-radius:0;box-shadow:none;z-index:1}
  #shell.ai-open #ai{flex:0 0 min(46vw,560px);width:auto}
}

/* Portrait: question above, Apex below, each scrolling on its own so the stem
   stays where you left it while the answer arrives. The measure is untouched —
   #app keeps its max-width, because a wide line of prose is no better here. */
@media (min-width:700px) and (orientation:portrait){
  html,body{height:100%;overflow:hidden}
  #shell{display:flex;flex-direction:column;height:100dvh;min-height:0}
  #app{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain}
  #ai{position:static;inset:auto;width:100%;max-width:none;
    height:0;flex:0 0 0;min-height:0;overflow:hidden;
    border-left:none;border-top:1.5px solid var(--border);
    border-radius:18px 18px 0 0;
    box-shadow:0 -10px 30px rgba(15,30,61,.10);z-index:1}
  #shell.ai-open #app{flex:1 1 52%}
  #shell.ai-open #ai{flex:1 1 48%;height:auto}
}

/* ── retrieval strip, peek modal, reference library ── */`);

fs.writeFileSync(OUT, html);
console.log(`Apex beside the question — ${applied.length} edits applied`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
