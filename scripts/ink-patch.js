#!/usr/bin/env node
/*
 * Engraved style — a second way of drawing the same anatomy.
 *
 *   node scripts/ink-patch.js <startup-output.html> <output.html>
 *
 * The shader work lives in src/core/heart3d.js and arrives here through the
 * polish pass's whole-module re-embed. This adds the control.
 *
 * WHAT IT IS. Tone stops being colour and becomes stroke density: the same
 * lighting that shades the anatomic render decides how many passes of
 * screen-space hatching a patch of muscle gets, and the silhouette is inked
 * separately because an outline is what keeps a technical drawing legible
 * where a purely tonal one goes mushy. Hatching is in SCREEN space on
 * purpose — that is what makes the strokes hold a constant weight as you
 * zoom, and what makes it read as drawn rather than as a texture wrapped
 * round a model.
 *
 * WHERE IT IS AND IS NOT BETTER. On the whole heart it is better than the
 * anatomic render, and in dark mode it comes out as a blueprint. In cutaway
 * it is worse: colour is doing real work there, telling you which chamber
 * you are looking into, and hatching cannot. So this is a toggle, not a
 * replacement, and the anatomic render stays the default.
 *
 * The hero's mini heart is left alone deliberately. At 92px the hatch period
 * would be a sizeable fraction of the icon and it would read as stripes.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) {
  console.error('usage: node scripts/ink-patch.js <startup-output.html> <output.html>');
  process.exit(1);
}

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

patch('lab heart: remember the drawing style',
`let labHeart=null, labHeartMode='whole', labHeartCanvasEl=null;`,
`let labHeart=null, labHeartMode='whole', labHeartCanvasEl=null;
let labHeartStyle=(()=>{try{return localStorage.getItem('accsap12.heartstyle')==='ink'?'ink':'anatomic';}catch(_){return 'anatomic';}})();`);

patch('lab heart: a style switch beside the mode chips',
`    <div class="lab-heart-modes">\${LAB_HEART_MODES.map(([k,label])=>
      \`<button class="chip\${labHeartMode===k?' hot':''}" data-heart-mode="\${k}">\${e(label)}</button>\`).join('')}</div>`,
`    <div class="lab-heart-modes">\${LAB_HEART_MODES.map(([k,label])=>
      \`<button class="chip\${labHeartMode===k?' hot':''}" data-heart-mode="\${k}">\${e(label)}</button>\`).join('')}
      <span class="lab-style-sep"></span>
      <button class="chip style-chip\${labHeartStyle==='ink'?' hot':''}" data-heart-style
        title="Draw it as an anatomical engraving instead">\${labHeartStyle==='ink'?'Engraved':'Anatomic'}</button></div>`);

patch('lab heart: create in the remembered style, and switch live',
`  labHeart=Heart3D.create(cv,{rhythm:labKind,mode:labHeartMode,dark,onCycle:paintLabHeartReadout});
  if(!labHeart) return;
  labHeartCanvasEl=cv;
  document.querySelectorAll('[data-heart-mode]').forEach(b=>b.onclick=()=>{
    labHeartMode=b.dataset.heartMode; labHeart.setMode(labHeartMode);
    document.querySelectorAll('[data-heart-mode]').forEach(x=>x.classList.toggle('hot',x===b));
  });`,
`  labHeart=Heart3D.create(cv,{rhythm:labKind,mode:labHeartMode,style:labHeartStyle,dark,
    onCycle:paintLabHeartReadout});
  if(!labHeart) return;
  labHeartCanvasEl=cv;
  document.querySelectorAll('[data-heart-mode]').forEach(b=>b.onclick=()=>{
    labHeartMode=b.dataset.heartMode; labHeart.setMode(labHeartMode);
    document.querySelectorAll('[data-heart-mode]').forEach(x=>x.classList.toggle('hot',x===b));
  });
  /* setStyle re-renders from the mesh already in memory — no rebuild, so this
     is a genuine toggle rather than a reload of the anatomy. */
  const sb=document.querySelector('[data-heart-style]');
  if(sb) sb.onclick=()=>{
    labHeartStyle=labHeartStyle==='ink'?'anatomic':'ink';
    try{localStorage.setItem('accsap12.heartstyle',labHeartStyle);}catch(_){}
    labHeart.setStyle(labHeartStyle);
    sb.textContent=labHeartStyle==='ink'?'Engraved':'Anatomic';
    sb.classList.toggle('hot',labHeartStyle==='ink');
    document.querySelector('.lab-heart-panel')?.classList.toggle('ink-paper',labHeartStyle==='ink');
  };
  document.querySelector('.lab-heart-panel')?.classList.toggle('ink-paper',labHeartStyle==='ink');`);

patch('css: paper for the engraving to sit on',
`.lab-heart-stage{position:relative;aspect-ratio:1/1;max-height:46vh;margin-inline:auto}`,
`.lab-heart-stage{position:relative;aspect-ratio:1/1;max-height:46vh;margin-inline:auto}
.lab-style-sep{flex:1 1 auto}
.style-chip{font-variant-numeric:tabular-nums}
/* The engraving renders its own paper into the mesh, so the panel behind it
   is tinted to match rather than left card-white — otherwise the drawing sits
   in a faintly visible rectangle of a slightly different white. */
.lab-heart-panel.ink-paper{background:#FAF7F2;transition:background .3s var(--ease,ease)}
html[data-theme="dark"] .lab-heart-panel.ink-paper{background:#0A1628}
.lab-heart-panel.ink-paper .lab-heart-stage{
  background-image:linear-gradient(rgba(120,140,170,.13) 1px,transparent 1px),
                   linear-gradient(90deg,rgba(120,140,170,.13) 1px,transparent 1px);
  background-size:22px 22px}`);

fs.writeFileSync(OUT, html);
console.log(`Engraved-style pass applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
