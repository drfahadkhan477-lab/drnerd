#!/usr/bin/env node
/*
 * A figure currently just pops in once the browser finishes decoding it —
 * no transition, no acknowledgement that anything was loading. This adds a
 * short opacity fade once the image is actually ready, using the load
 * listener figzoom-patch.js already installs (mountFigZoom/figZ.apply's own
 * hook) rather than adding a second one. Opacity only, so it never touches
 * layout or the zoom/pan transform figzoom.js owns. Under reduced motion the
 * image is simply shown at full opacity immediately — same information, no
 * animation, per this app's existing rule for every other motion site.
 *
 *   node scripts/figloadfade-patch.js <in.html> <out.html>
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/figloadfade-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 200)}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

patch('figloadfade: css — the hidden state is opt-in, so nothing can get stuck in it',
`.figv-scroll.zoomed:active{cursor:grabbing}
.figv-scroll img{transform-origin:0 0;will-change:transform;`,
`.figv-scroll.zoomed:active{cursor:grabbing}
/* A figure often opens before its full-resolution decode finishes; without
   this it just snaps into view mid-paint. Opacity only — never touches
   layout, so it cannot fight figzoom.js's transform.

   THE DEFAULT IS VISIBLE, AND THAT IS THE WHOLE DESIGN. Writing this the
   obvious way round — img{opacity:0} plus a .loaded class the script adds —
   makes every failure invisible: a figure whose script never ran, whose
   decode errored, whose 404 the offline cache handed back, is not a broken
   image icon but nothing at all, on a screen whose only content is that
   figure. So the hidden state is a class, added only by the one code path
   that has already committed to removing it on BOTH the load and the error
   event. Anything that path does not touch is simply shown. */
.figv-scroll img{transition:opacity .18s var(--ease)}
.figv-scroll img.fig-loading{opacity:0}
@media(prefers-reduced-motion:reduce){
  .figv-scroll img{transition:none}.figv-scroll img.fig-loading{opacity:1}
}
.figv-scroll img{transform-origin:0 0;will-change:transform;`);

patch('figloadfade: js — hide only while a load is genuinely pending, reveal on either outcome',
`  const fs_=wrap.querySelector('.figv-scroll');
  figZ = fs_ ? mountFigZoom(fs_) : null;
  if(figZ){ const im=fs_.querySelector('img');
    if(im&&!im.complete) im.addEventListener('load',figZ.apply,{once:true}); else figZ.apply(); }`,
`  const fs_=wrap.querySelector('.figv-scroll');
  figZ = fs_ ? mountFigZoom(fs_) : null;
  if(figZ){ const im=fs_.querySelector('img');
    /* error as well as load: a figure that fails still has to appear, as the
       browser's own broken-image mark, or the overlay is an empty black box
       with no way to tell a slow network from a missing file. */
    if(im&&!im.complete){
      im.classList.add('fig-loading');
      const reveal=()=>im.classList.remove('fig-loading');
      im.addEventListener('load',reveal,{once:true});
      im.addEventListener('error',reveal,{once:true});
    }
    if(im&&!im.complete) im.addEventListener('load',figZ.apply,{once:true}); else figZ.apply(); }`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('figloadfade-patch applied:');
edits.forEach(e => console.log('  ✓ ' + e));
