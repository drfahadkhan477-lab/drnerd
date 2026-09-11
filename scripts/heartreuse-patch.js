#!/usr/bin/env node
/*
 * One heart, one context, moved between screens instead of rebuilt on each.
 *
 *   node scripts/heartreuse-patch.js <in.html> <out.html>
 *
 * WHAT WAS WRONG, MEASURED. render() rebuilds the home screen's markup on
 * every visit, which means a brand-new <canvas id="heroHeart3d"> element every
 * time. mountHeroHeart3d() compared that node against the one it was holding,
 * found a stranger, destroyed the old instance and created a new WebGL2
 * context on the new node. Instrumenting getContext in the built app and
 * walking home -> chapter -> home twenty times:
 *
 *     contexts after boot ............ 2
 *     contexts after 20 round trips .. 40
 *
 * Two per return to the home screen, growing without limit for as long as the
 * app is used.
 *
 * WHY CHROMIUM NEVER COMPLAINED AND AN iPAD WILL. destroy() releases its
 * context (PR #33), and Chromium returns the slot when a page does that — so
 * on Blink the count grows and nothing is ever short. WebKit does not return
 * it. Measured on a blank page with no application code at all, twenty
 * contexts created and released one at a time: Chromium warns zero times,
 * WebKit warns four, whatever the page does. So on iPadOS the slots are spent
 * for good, the cap is sixteen, and at two per round trip the eviction of a
 * LIVE context begins after about eight visits home. The heart goes blank
 * mid-session with nothing on screen to explain it.
 *
 * THE FIX IS TO STOP MAKING NEW ONES. The canvas is created once, in script,
 * and kept for the life of the page; the markup carries an empty slot instead.
 * Each visit home moves that same canvas into the slot and starts the render
 * loop again. A canvas detached from the document keeps its context — that is
 * the property this rests on — so leaving the home screen costs nothing but a
 * cancelled animation frame.
 *
 * WHAT THIS IS NOT. It is not a cache with an invalidation rule, and there is
 * no second code path to drift: there is exactly one Heart3D instance for the
 * life of the page, and mountHeroHeart3d() either creates it (once) or adopts
 * it. Rhythm and theme are pushed onto the live instance through the setters
 * the module already exposes, which is what they were for.
 *
 * THE ONE CASE THAT STILL BUILDS A NEW ONE is a genuinely lost context — the
 * GPU reset, or iPadOS reclaiming memory. A lost context cannot be revived by
 * re-attaching its canvas, so onLost drops the canvas as well as the instance
 * and the next mount builds both afresh. That is the path that was already
 * there; it is now the only path that allocates twice.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/heartreuse-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── 1. the markup carries a slot, not a canvas ─────────────────────────── */
patch('heartreuse: the hero markup offers a place to put the heart',
`      <canvas id="heroHeart3d" class="hero-heart-3d" aria-hidden="true"></canvas>`,
`      <div id="heroHeart3dSlot" class="hero-heart-3d" aria-hidden="true"></div>`);

/* ── 2. the canvas fills whatever slot it is put in ─────────────────────── */
patch('heartreuse: the canvas fills the slot it is moved into',
`.hero-heart-3d{
  opacity:0;transition:opacity .6s var(--glide);pointer-events:none;
  background:transparent;`,
`/* The slot is the positioned box now, and the canvas inside it is told to
   fill it — the canvas is created in script and never carries layout of its
   own, so every rule about where the heart sits stays on this one class. */
.hero-heart-3d>canvas{display:block;width:100%;height:100%}
.hero-heart-3d{
  opacity:0;transition:opacity .6s var(--glide);pointer-events:none;
  background:transparent;`);

/* ── 3. the mount adopts the heart instead of rebuilding it ─────────────── */
patch('heartreuse: mount moves the one heart, and only builds it once',
`function mountHeroHeart3d(){
  const cv=document.getElementById('heroHeart3d');
  if(!cv||typeof Heart3D==='undefined'||!hasWebGL2()){
    document.getElementById('heroHeart')?.classList.remove('heart-3d-active');
    return;
  }
  if(heroHeart3d && heroHeart3dCanvas===cv) return;
  if(heroHeart3d){ heroHeart3d.destroy(); heroHeart3d=null; }`,
`function mountHeroHeart3d(){
  const slot=document.getElementById('heroHeart3dSlot');
  /* Not on a screen that has a slot — the home markup is gone. The instance
     stays alive with its context; only the render loop stops, because a rAF
     loop drawing into a detached canvas is a frame budget spent on nothing. */
  if(!slot){ if(heroHeart3d) heroHeart3d.stop(); return; }
  if(typeof Heart3D==='undefined'||!hasWebGL2()){
    document.getElementById('heroHeart')?.classList.remove('heart-3d-active');
    return;
  }
  /* THE HEART IS ALREADY BUILT: move it and wake it. This is the path taken on
     every visit home after the first, and it allocates nothing. */
  if(heroHeart3d&&heroHeart3dCanvas){
    if(heroHeart3dCanvas.parentNode!==slot) slot.appendChild(heroHeart3dCanvas);
    const darkNow=document.documentElement.getAttribute('data-theme')==='dark'
      || (!document.documentElement.hasAttribute('data-theme')
          && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    heroHeart3d.setDark(darkNow);
    heroHeart3d.setRhythm(heroCurrentKind||'sinus');
    heroHeart3d.start();
    document.getElementById('heroHeart')?.classList.add('heart-3d-active');
    return;
  }
  /* First mount of the page, or a rebuild after a genuinely lost context. The
     canvas is made here rather than in the markup precisely so that render()
     cannot replace it. */
  const cv=document.createElement('canvas');
  /* KEEPS THE ID THE MARKUP USED TO CARRY. The element moved from the template
     into script, but #heroHeart3d is a contract: verify-heroart samples the
     pixels through it to prove the specimen style really rendered, and nothing
     else in the app should have to learn a new name for the same canvas. */
  cv.id='heroHeart3d';
  slot.appendChild(cv);`);

/* ── 4. the instance keeps the canvas it was built on ───────────────────── */
patch('heartreuse: a lost context is the one case that rebuilds both',
`    onLost:function(){
      heroHeart3d=null; heroHeart3dCanvas=null;
      document.getElementById('heroHeart')?.classList.remove('heart-3d-active');
    },`,
`    /* A lost context cannot be revived by re-attaching its canvas, so this
       drops the canvas too and the next mount builds a new one. It is the only
       remaining path in the app that allocates a second context, and it fires
       when the GPU resets or iPadOS reclaims memory — not on navigation. */
    onLost:function(){
      if(heroHeart3dCanvas&&heroHeart3dCanvas.parentNode) heroHeart3dCanvas.remove();
      heroHeart3d=null; heroHeart3dCanvas=null;
      document.getElementById('heroHeart')?.classList.remove('heart-3d-active');
    },`);

/* ── 5. the guard that made a new canvas necessary is gone ──────────────── */
patch('heartreuse: remember the canvas that was built, not the one in the markup',
`  if(!heroHeart3d) return;
  heroHeart3dCanvas=cv;
  cv.style.pointerEvents='none';           // decorative — never eats a home-screen scroll`,
`  if(!heroHeart3d){ cv.remove(); return; }
  heroHeart3dCanvas=cv;
  cv.style.pointerEvents='none';           // decorative — never eats a home-screen scroll`);

/* ── 5b. leaving the home screen pauses the heart, it does not end it ───── */
/* THE EDIT THIS STEP WAS INCOMPLETE WITHOUT. mountHero() tears down the hero
   ECG monitor when #heroECG is absent — which means "not on the home screen" —
   and it took the 3D heart down with it. With the canvas now persistent, that
   was the one remaining path still destroying the context: measured, it turned
   20 round trips into 6 contexts rather than the 2 the rest of this step
   achieves, firing on some visits and not others depending on which renders
   found the strip. Stopping the render loop is all that was ever wanted here;
   the instance and its context stay. */
patch('heartreuse: leaving home pauses the heart rather than destroying it',
`  const cv=document.getElementById('heroECG');
  if(!cv){
    if(heroHeart3d){ heroHeart3d.destroy(); heroHeart3d=null; heroHeart3dCanvas=null; }
    return;
  }`,
`  const cv=document.getElementById('heroECG');
  if(!cv){
    if(heroHeart3d) heroHeart3d.stop();
    return;
  }`);

/* ── 6. the guard ───────────────────────────────────────────────────────── */
/* The whole point of the step is that the markup no longer carries a canvas.
   If a later chain step reintroduces one, mountHeroHeart3d would find a slot
   that is not empty and the reuse would quietly stop reusing. */
if (/<canvas id="heroHeart3d"/.test(html)) {
  throw new Error('heartreuse: the hero markup still emits a <canvas>, so the context would be rebuilt on every render');
}
if (!/id="heroHeart3dSlot"/.test(html)) {
  throw new Error('heartreuse: the hero slot did not reach the markup');
}
applied.push('heartreuse: the markup carries a slot and no canvas');

fs.writeFileSync(OUT, html);
console.log(`Heart reuse applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
