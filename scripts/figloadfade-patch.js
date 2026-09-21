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

patch('figloadfade: css — hidden until loaded, instant under reduced motion',
`.figv-scroll.zoomed:active{cursor:grabbing}
.figv-scroll img{transform-origin:0 0;will-change:transform;`,
`.figv-scroll.zoomed:active{cursor:grabbing}
/* A figure often opens before its full-resolution decode finishes; without
   this it just snaps into view mid-paint. Opacity only — never touches
   layout, so it can't fight figzoom.js's transform. */
.figv-scroll img{opacity:0;transition:opacity .18s var(--ease)}
.figv-scroll img.loaded{opacity:1}
@media(prefers-reduced-motion:reduce){.figv-scroll img{opacity:1;transition:none}}
.figv-scroll img{transform-origin:0 0;will-change:transform;`);

patch('figloadfade: js — the existing load hook also marks the image loaded',
`  const fs_=wrap.querySelector('.figv-scroll');
  figZ = fs_ ? mountFigZoom(fs_) : null;
  if(figZ){ const im=fs_.querySelector('img');
    if(im&&!im.complete) im.addEventListener('load',figZ.apply,{once:true}); else figZ.apply(); }`,
`  const fs_=wrap.querySelector('.figv-scroll');
  figZ = fs_ ? mountFigZoom(fs_) : null;
  if(figZ){ const im=fs_.querySelector('img');
    if(im){
      const markLoaded=()=>im.classList.add('loaded');
      if(!im.complete) im.addEventListener('load',markLoaded,{once:true}); else markLoaded();
    }
    if(im&&!im.complete) im.addEventListener('load',figZ.apply,{once:true}); else figZ.apply(); }`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('figloadfade-patch applied:');
edits.forEach(e => console.log('  ✓ ' + e));
