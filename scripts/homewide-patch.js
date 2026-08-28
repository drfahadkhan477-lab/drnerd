#!/usr/bin/env node
/*
 * The home screen fills the screen it is on.
 *
 *   node scripts/homewide-patch.js <input.html> <output.html>
 *
 * MEASURED, on a 1366×1024 iPad in landscape, before any of this was written:
 *
 *     #app                960px of 1366   — 406px of dead space, 203 a side
 *     document height    1142px of 1024   — overflows by 118px, so it scrolls
 *
 * Four blocks stacked in a 960px column down the middle of a screen that is
 * half as wide again, and still too tall to see at once. The home screen is
 * the one place in the app that is cards rather than prose, and it was being
 * laid out as though it were prose.
 *
 * THE READING MEASURE IS NOT THE BUG. #app's 960px cap is what keeps a
 * question stem readable — a vignette set 1366px wide is genuinely worse — and
 * every native iPad app that shows prose keeps a column. So the cap stays for
 * every screen except this one, and the check that proves a quiz stem still
 * measures 960px at 1366px wide is the one that matters most here.
 *
 * WHAT LANDSCAPE GETS. Two columns and a footer:
 *
 *     ┌────────────────┬───────────────────┐
 *     │ hero + its ECG │                   │
 *     ├────────────────┤   the pearl,      │
 *     │ progress bar   │   full height     │
 *     ├────────────────┴───────────────────┤
 *     │ the door row, spanning both        │
 *     └────────────────────────────────────┘
 *
 * That solves two of the six complaints with one layout: the width stops being
 * wasted, and the pearl card stops being a 328px letterbox. A tall column is
 * what makes room for pearls that are a whole thought rather than a clause,
 * which is the next step in the chain.
 *
 * PORTRAIT AND PHONE ARE NOT TOUCHED. Portrait already fits — 1366px of
 * content in a 1366px viewport, with only 64px of width wasted — so the media
 * query is deliberately narrow: landscape only, and only from 1024px up.
 *
 * A data-screen attribute rather than #app:has(.home-wrap). :has() would work
 * on both targets, but a layout that silently reverts to a narrow column on a
 * browser that lacks it is a bad failure for one saved character, and an
 * explicit hook can be read from the DOM by a test.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/homewide-patch.js <input.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── 1. the hook ─────────────────────────────────────────────────────────── */
patch('homewide: the shell says which screen it is showing',
`  app.innerHTML=buildScreen();`,
`  /* Which screen is up, readable from CSS. The home screen is cards and wants
     the whole iPad; every other screen is prose and keeps its measure. */
  app.dataset.screen=S.screen;
  app.innerHTML=buildScreen();`);

/* ── 2. the layout ───────────────────────────────────────────────────────── */
patch('homewide: landscape gets two columns and a footer',
`/* iPAD landscape / iPad Pro */
@media(min-width:1024px){
  #app{max-width:960px}`,
`/* ── the home screen fills a landscape iPad ─────────────────────────────────
   Landscape only, and only from 1024px up: portrait already fits in one screen
   and wastes 64px, which is not worth a second layout to reclaim. Everything
   here is scoped to [data-screen="home"], so a question stem keeps its column.

   The grid rows are sized so the whole thing lands inside one viewport:
   auto for the hero and the progress bar, 1fr for the pearl — which is what
   gives a long pearl somewhere to go — and auto for the doors. */
@media (min-width:1024px) and (orientation:landscape){
  /* min-height too, not only max-width. #app carries min-height:100dvh and
     sits BELOW a fixed 62px navigation bar, so a full-height home screen was
     62px taller than the screen and scrolled by exactly that — measured, and
     it is the whole of the overflow. The portrait split already zeroes this
     for its own reasons; landscape never did. */
  #app[data-screen="home"]{max-width:none;padding:0 clamp(20px,3vw,44px);
    min-height:calc(100dvh - var(--navh) - var(--sat))}
  #app[data-screen="home"] .home-wrap{
    display:grid;
    grid-template-columns:minmax(360px,0.85fr) minmax(420px,1.15fr);
    grid-template-rows:auto auto 1fr auto;
    grid-template-areas:"hero pearl" "prog pearl" "gap pearl" "doors doors";
    column-gap:clamp(18px,2.4vw,34px);
    row-gap:0;
    align-content:start;
    /* One screen: the viewport, less the fixed nav, the status-bar strip and
       the wrap's own padding. min-height rather than height so a very long
       pearl can still push past it and scroll rather than being cut off. */
    min-height:calc(100dvh - var(--navh) - var(--sat) - 40px);
    padding:16px 0 20px}
  #app[data-screen="home"] .hero-live{grid-area:hero;margin:0}
  #app[data-screen="home"] .home-progress{grid-area:prog;margin:14px 2px 0}
  #app[data-screen="home"] .pearl-card{
    grid-area:pearl;margin:0;height:100%;min-height:0}
  #app[data-screen="home"] .door-row{grid-area:doors;margin-top:18px}
  /* The pearl's own column has to be able to shrink inside the grid row, or
     its content sets the row height and the footer is pushed off screen. */
  #app[data-screen="home"] .pearl-main{min-height:0;overflow:auto}
  /* Nothing else on the home screen belongs in a two-column arrangement — the
     story rail and the feed live on the Chapters page now, but a build that
     still renders them should stack them under the doors rather than land in
     an unnamed grid area. */
  #app[data-screen="home"] .home-wrap>*:not(.hero-live):not(.home-progress):not(.pearl-card):not(.door-row){
    grid-column:1 / -1}
}

/* iPAD landscape / iPad Pro */
@media(min-width:1024px){
  #app{max-width:960px}`);

/* ── 3. and portrait stops being sized by its own text ───────────────────── */
patch('homewide: the column is the column, whatever is in it',
`  #app{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain}`,
`  /* width:100% is doing real work here. #app carries margin:0 auto to centre
     itself, and an auto margin on the cross axis DISABLES flex stretching — so
     in this column flex container #app was sized to fit its contents and then
     centred. Measured across three launches at 1024x1366, the home screen came
     out 960px, 700px and 544px wide, because the width of the page was being
     set by the length of whichever pearl had been chosen. It is a reading
     column; it is not allowed to have an opinion about the prose inside it. */
  #app{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;width:100%}`);

fs.writeFileSync(OUT, html);
console.log(`The home screen fills the iPad — ${applied.length} edits applied`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
