#!/usr/bin/env node
/*
 * The Chapters screen, given the weight of the page it actually is.
 *
 *   node scripts/chapters-patch.js <in.html> <out.html>
 *
 * Three concrete gaps, not a restyle for its own sake:
 *
 * 1. THE BAR NEVER ANIMATES. .ct-bar i already carries
 *    "transition:width .9s var(--glide)", and it never fires: the width is
 *    set inline in the markup the tile is BORN with, so there is no prior
 *    value for the browser to transition from — confirmed by reading the
 *    bar's computed width on the very first painted frame and finding it
 *    already at its final value. A transition nobody has ever seen run is not
 *    a smaller bug than a missing one; it just looks like intent from the
 *    source instead of an oversight. Every bar now starts at width:0 in the
 *    markup and is set to its real value from mountChapterBars(), which is
 *    the same "set the end state in JS, after the element exists" idiom
 *    mountHomeProgress() already uses for the numbers beside it.
 *
 * 2. THE GRID NEVER STAGGERS. scripts had already worked out the timing for
 *    this — an eleven-step delay ladder sits in the stylesheet under the name
 *    .ch-grid, tuned for exactly eleven chapters. It is dead: nothing in the
 *    markup carries that class, so it has animated nothing since whichever
 *    rename left it behind. The eleven tiles have always entered on the same
 *    frame. This patch does not invent a new stagger, it finally wires the
 *    one already sitting there to .ch-tiles, the class that is actually used.
 *
 * 3. THE TILE IS SIZED FOR A DENSER SCREEN THAN THIS ONE. Chapters is a
 *    destination now, not a strip under three feed cards — homeflow gave it
 *    the whole page. Its tiles still carry the icon, type size and bar height
 *    they had before that move. Padding and gap move up exactly one step on
 *    the existing 4-point spacing scale (--s4/--s2 to --s5/--s3, matching the
 *    "restate every value so this block is the whole story" discipline the
 *    scale layer's own comment sets), and the icon, name and bar grow with
 *    them — not to arbitrary numbers, but to the sizes already used a
 *    heading-level up elsewhere in this same file.
 *
 * The story rail keeps its own already-tuned popIn stagger; it is not touched
 * beyond a proportional size increase so it does not read as an afterthought
 * beside larger tiles.
 *
 * DELIBERATELY NOT DONE: no shine sweep on the chapter bars. homeprog's single
 * hero bar carries one; eleven of them animating an infinite sweep at once on
 * one screen is noise, not craft — the glow and the fill-in are the two
 * chapter-tile motion beats that earn their place, not every beat the home
 * screen has.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/chapters-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

/* ── the grid: room, and the stagger that was already written but never wired ── */
patch('chapters: the tile grid gets real room, on the existing spacing scale',
".ch-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:10px}",
".ch-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:var(--s3)}\n" +
"/* The eleven-step delay ladder below already existed, under .ch-grid — a\n" +
"   class nothing in the markup carries. Retargeted rather than reinvented. */\n" +
".ch-tiles>*{animation:riseIn .5s var(--glide) both}\n" +
".ch-tiles>*:nth-child(1){animation-delay:.02s}.ch-tiles>*:nth-child(2){animation-delay:.05s}\n" +
".ch-tiles>*:nth-child(3){animation-delay:.08s}.ch-tiles>*:nth-child(4){animation-delay:.11s}\n" +
".ch-tiles>*:nth-child(5){animation-delay:.14s}.ch-tiles>*:nth-child(6){animation-delay:.17s}\n" +
".ch-tiles>*:nth-child(7){animation-delay:.20s}.ch-tiles>*:nth-child(8){animation-delay:.23s}\n" +
".ch-tiles>*:nth-child(9){animation-delay:.26s}.ch-tiles>*:nth-child(10){animation-delay:.29s}\n" +
".ch-tiles>*:nth-child(n+11){animation-delay:.32s}");

patch('chapters: tile padding and gap move up one step on the spacing scale',
".ch-tile{padding:var(--s4);gap:var(--s2)}",
".ch-tile{padding:var(--s5);gap:var(--s3)}");

/* ── the icon badge ── */
patch('chapters: the icon badge grows with the card it sits in',
`.ct-ico{background:var(--card);
  background:color-mix(in srgb, var(--accent,var(--teal)) 14%, transparent);
  width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;
  color:var(--accent,var(--teal))}`,
`.ct-ico{background:var(--card);
  background:color-mix(in srgb, var(--accent,var(--teal)) 14%, transparent);
  width:46px;height:46px;border-radius:13px;display:flex;align-items:center;justify-content:center;
  color:var(--accent,var(--teal))}`);

patch('chapters: the icon glyph itself, to match the larger badge',
".ct-ico{font-size:23px}",
".ct-ico{font-size:28px}");

patch('chapters: the chapter name reads at the weight the page now gives it',
".ct-name{font-size:13px;font-weight:700;letter-spacing:-.01em;line-height:1.3}",
".ct-name{font-size:16px;font-weight:700;letter-spacing:-.01em;line-height:1.3}");

/* ── the bar: taller, a glow instead of a flat fill, and it actually moves ── */
patch('chapters: the bar is taller and carries a glow in the chapter\'s own colour',
".ct-bar{height:4px;border-radius:99px;background:var(--border2);overflow:hidden;margin-top:2px}",
".ct-bar{height:8px;border-radius:99px;background:var(--border2);overflow:hidden;margin-top:6px}");

/* No reduced-motion override needed here: the app already carries a universal
   one — *,*::before,*::after{transition-duration:.001ms!important} — which
   .chp-fill next door already relies on rather than repeating for itself.
   Writing the same override a third time would be dead weight against a
   shell budget already raised once this session. */
patch('chapters: the fill is a gradient with glow, and starts at zero so the transition has something to run',
`.ct-bar i{display:block;height:100%;background:var(--accent);border-radius:99px;
  transition:width .9s var(--glide)}`,
`.ct-bar i{display:block;height:100%;border-radius:99px;width:0;
  background:linear-gradient(90deg,var(--accent),color-mix(in srgb, var(--accent) 65%, white));
  box-shadow:0 0 7px color-mix(in srgb, var(--accent) 50%, transparent);
  transition:width 1s var(--glide)}
/* ZERO IS A STATE, NOT A MISSING VALUE. An untouched chapter draws a solid
   grey track with nothing in it, which is the same thing this app's own
   loading skeletons look like — so "you have not started this yet" and
   "this failed to load" render identically, and the reader cannot tell
   which one they are looking at. Dashes carry the same visual weight as
   the solid track (same --border2, so nothing gets quieter or louder) and
   change only the texture, which is the part that actually says the
   emptiness is deliberate.

   Keyed off data-w rather than a class because the markup already ships
   the real value there and mountChapterBars only ever writes style.width,
   never touching the attribute — so the selector stays true for the life
   of the tile. Where :has() is unsupported the rule simply drops and the
   tile falls back to today's solid track, which is the current behaviour
   rather than a broken one. */
.ct-bar:has(i[data-w="0"]){background:repeating-linear-gradient(90deg,
  var(--border2) 0 5px,transparent 5px 10px)}`);

/* ── the story rail: grown proportionally, so it does not look like an
   afterthought beside the larger tiles below it ── */
patch('chapters: the story rail rings grow to match the page around them',
".story-ring{position:relative;width:58px;height:58px;display:block}",
".story-ring{position:relative;width:64px;height:64px;display:block}");
patch('chapters: and their icons with them',
"  font-size:23px}\n.story-lbl{font-size:11px;font-weight:600;color:var(--muted);text-align:center;\n  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:66px}",
"  font-size:28px}\n.story-lbl{font-size:11px;font-weight:600;color:var(--muted);text-align:center;\n  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:66px}");

/* ── the markup: width:0 plus a data attribute the mount function reads ── */
patch('chapters: the tile ships its target width as data, not as its starting width',
'      <span class="ct-bar"><i style="width:${Math.round(m*100)}%"></i></span>',
'      <span class="ct-bar"><i style="width:0" data-w="${Math.round(m*100)}"></i></span>');

/* ── the mount function, in the same idiom as mountHomeProgress ── */
patch('chapters: mountChapterBars sets the real width once the tiles exist',
"function buildStudy(){",
`/* Sets every .ct-bar to its real width after the tiles it belongs to are in
   the DOM — the same reason mountHomeProgress() exists beside it: a width set
   inline in the markup a node is born with has no "before" for a CSS
   transition to run from. Two animation frames, not one: the first commits
   the width:0 the markup shipped, the second sets the target, so the browser
   has actually painted the starting state before the transition is asked to
   run from it. A single frame is not reliably enough for that on every
   engine. A no-op wherever the study screen is not on display. */
function mountChapterBars(){
  const bars=document.querySelectorAll('.ct-bar i[data-w]');
  if(!bars.length)return;
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    bars.forEach(b=>{ b.style.width=(b.dataset.w||'0')+'%'; });
  }));
}
function buildStudy(){`);

patch('chapters: mounted alongside the home screen\'s own progress mount',
"  if(typeof mountHomeProgress==='function') mountHomeProgress();",
"  if(typeof mountHomeProgress==='function') mountHomeProgress();\n  if(typeof mountChapterBars==='function') mountChapterBars();");

fs.writeFileSync(OUT, html);
console.log(`Chapters screen — ${edits.length} edit(s)`);
edits.forEach(e => console.log('  ✓ ' + e));
console.log(`written: ${OUT}`);
