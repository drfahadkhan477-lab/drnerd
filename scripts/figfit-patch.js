#!/usr/bin/env node
/*
 * Two things the iPad found that no synthetic test could.
 *
 *   node scripts/figfit-patch.js <in.html> <out.html>
 *
 * 1. "FIT" DID NOT FIT. The figure viewer's image was `max-width:100%` with
 *    `height:auto`, which fits the WIDTH of a figure and says nothing about its
 *    height. Most figures are wider than they are tall, so this looked correct
 *    for a long time. A tall one — a book page crop, a column of pressure
 *    tracings — overflowed vertically instead, and three separate decisions
 *    then conspired to trap it:
 *
 *      .figv-scroll is display:flex + align-items:center, so the overflow is
 *        split evenly and you see a band from the MIDDLE, clipped top and
 *        bottom rather than merely cut off at the end;
 *      figzoom's step set overflow:hidden, replacing scrolling with transform
 *        panning, so the old escape route is gone;
 *      panning is only enabled once scale > 1, because a fitted image is by
 *        definition entirely visible — which was the assumption that failed.
 *
 *    So the one state that promises the whole figure showed the least of it,
 *    the control row said "100%", and the Fit button returned you to exactly
 *    the same band. The figure was still reachable by zooming IN first and
 *    then panning, which is precisely backwards.
 *
 *    The fix is one declaration: max-height:100%, making scale 1 a true
 *    contain. constrain() then centres it, panning stays off because there is
 *    genuinely nothing to pan to, and zooming in behaves as it always did.
 *    The dead `transition:max-width` goes with it — it animated the old
 *    fitted↔natural toggle, and nothing has changed max-width since figzoom
 *    stopped .zoomed from touching layout.
 *
 * 2. THE FIGURES UNDER AN APEX ANSWER COULD NOT BE PUT AWAY. They appear when
 *    a reply lands, take a third of a short panel, and there was no control of
 *    any kind — not a close, not a collapse. On a landscape iPad with the
 *    panel beside the app, the answer you asked for was four lines above a
 *    stack of pictures you did not.
 *
 *    Made a disclosure, shut by default, following apexChipsOpen exactly:
 *    a module-level flag so it survives the panel's re-render, a class toggle
 *    rather than a rebuild so the draft in the textarea is not destroyed, and
 *    aria-expanded on the control. Shut by default for the reason the chips
 *    give: the panel should open as a conversation. The label gains the count,
 *    so the collapsed row still says what is behind it.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/figfit-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

/* ── 1. the fitted state fits ────────────────────────────────────────────── */

patch('figfit: scale 1 contains the whole figure, in both dimensions',
`.figv-scroll img{transform-origin:0 0;will-change:transform;display:block;max-width:100%;height:auto;margin:auto;
  border-radius:10px;background:#fff;cursor:zoom-in;
  transition:max-width .28s var(--glide,ease)}`,
`/* max-height is the half that was missing. Without it "fitted" meant "as wide
   as the viewport" and a tall figure overflowed into a clipped middle band
   with no scroll and no pan — see scripts/figfit-patch.js. Neither max- rule
   enlarges anything, so a small diagram still sits at its natural size. */
.figv-scroll img{transform-origin:0 0;will-change:transform;display:block;
  max-width:100%;max-height:100%;width:auto;height:auto;margin:auto;
  border-radius:10px;background:#fff;cursor:zoom-in}`);

/* ── 2. the Apex figure strip folds away ─────────────────────────────────── */

patch('figfit: the figure strip is a disclosure, and the list is what collapses',
`.fig-strip{display:flex;flex-direction:column;gap:8px;padding:0 18px 10px;
  max-height:min(32vh,260px);overflow-y:auto;overscroll-behavior:contain}`,
`.fig-strip{display:flex;flex-direction:column;gap:8px;padding:0 18px 10px}
/* .src-lbl is declared after this and supplies the type, so only what a
   <button> would otherwise impose is reset here. */
.fig-toggle{display:flex;align-items:center;gap:6px;width:100%;
  padding:0;border:0;background:none;cursor:pointer;text-align:left;font-family:inherit}
.fig-toggle .icon{width:14px;height:14px;flex:0 0 auto;
  transition:transform .2s var(--glide,ease)}
.fig-strip.open .fig-toggle .icon{transform:rotate(180deg)}
/* The scroll cap moves onto the list: on the container it clipped the control
   that opens it. */
.fig-list{display:none}
.fig-strip.open .fig-list{display:flex;flex-direction:column;gap:8px;
  max-height:min(32vh,260px);overflow-y:auto;overscroll-behavior:contain}`);

patch('figfit: the strip renders shut, and says how many are behind it',
`  const figStrip=figs.length?\`<div class="fig-strip"><span class="src-lbl">figure\${figs.length===1?'':'s'} from those notes</span>
    \${figs.map(f=>\`<figure class="ai-fig" onclick="openFigureFrom(this)" role="button" tabindex="0"
      title="Open this figure full size"><img src="\${f.dataUrl}" alt="\${e(f.caption)}" loading="lazy">
      <figcaption>\${e(clip(f.caption,150))}<span class="ai-fig-src">\${e(clip(f.noteTitle,44))}</span></figcaption></figure>\`).join('')}</div>\`:'';`,
`  const figStrip=figs.length?\`<div class="fig-strip\${apexFigsOpen?' open':''}" id="aiFigWrap">
    <button class="src-lbl fig-toggle" type="button" id="aiFigs" aria-controls="aiFigList"
      aria-expanded="\${apexFigsOpen?'true':'false'}">\${icon('chevron-down','icon-sm')}\${figs.length} figure\${figs.length===1?'':'s'} from those notes</button>
    <div class="fig-list" id="aiFigList">
    \${figs.map(f=>\`<figure class="ai-fig" onclick="openFigureFrom(this)" role="button" tabindex="0"
      title="Open this figure full size"><img src="\${f.dataUrl}" alt="\${e(f.caption)}" loading="lazy">
      <figcaption>\${e(clip(f.caption,150))}<span class="ai-fig-src">\${e(clip(f.noteTitle,44))}</span></figcaption></figure>\`).join('')}</div></div>\`:'';`);

patch('figfit: the open/shut state outlives the panel re-render',
`let apexChipsOpen=false;`,
`let apexChipsOpen=false;
/* Shut on every launch, for the reason above: the panel opens as a
   conversation, and figures are what the answer drew on rather than the
   answer. Kept for the session, so opening them repeatedly is not a fight. */
let apexFigsOpen=false;`);

patch('figfit: and the control that toggles it, class-only like the chips',
`    more.classList.toggle('on',apexChipsOpen);
    more.setAttribute('aria-expanded',apexChipsOpen?'true':'false');
  };`,
`    more.classList.toggle('on',apexChipsOpen);
    more.setAttribute('aria-expanded',apexChipsOpen?'true':'false');
  };
  /* Class toggle, not buildAI(): a rebuild here would discard whatever is
     half-typed in the textarea, which is the bug the chips control already
     avoids this way. */
  const figsBtn=document.getElementById('aiFigs');
  if(figsBtn) figsBtn.onclick=()=>{
    apexFigsOpen=!apexFigsOpen;
    const fw=document.getElementById('aiFigWrap');
    if(fw) fw.classList.toggle('open',apexFigsOpen);
    figsBtn.setAttribute('aria-expanded',apexFigsOpen?'true':'false');
  };`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('figfit-patch applied:');
edits.forEach(e => console.log('  ✓ ' + e));
