#!/usr/bin/env node
/*
 * The hero is the anatomical heart again — turning, in the photograph's
 * material, with the conduction system running through it.
 *
 *   node scripts/heroart-patch.js <in.html> <out.html>
 *
 * WHAT THIS IS. src/core/heart3d.js gained a fourth style, `specimen`: one
 * desaturated slate material instead of red muscle, the coronary tree reading
 * as relief rather than as vessels, and the conduction system drawn as a
 * source rather than a lit surface — a yellow tree threaded through the
 * muscle with a pulse travelling it. This step mounts that on the home screen.
 *
 * THE CURRENT IS NOT AN EFFECT. It is the depolarisation wave the module has
 * always modelled: `uAct` is the front in milliseconds since the sinus node
 * fired, `vExtra.y` is each vertex's own activation time, so the pulse runs
 * SA → AV → His → bundles → Purkinje at the real sequence, and the muscle
 * lights a beat behind it because that is what depolarisation spreading
 * through tissue does. It is driven by the same cardiac clock as the ECG
 * strip beside it, so when the hero rotation moves to atrial fibrillation the
 * current goes irregular and loses its atrial start — the trace and the heart
 * cannot tell different stories.
 *
 * WHY THIS STEP EXISTS TWICE OVER. Its first version replaced the hero's
 * stacked pair — a flat SVG under a WebGL canvas — with a still photograph,
 * and recorded that this left Heart3D with no callers anywhere: 79 KB of
 * renderer shipped for nothing. The answer to that was never to delete the
 * renderer. It was to give it something worth doing. The photograph supplied
 * the look; the module supplies the anatomy and the motion.
 *
 * THE PHOTOGRAPH IS STILL HERE, AS THE FALLBACK. A device with no WebGL2 —
 * an old iPad, a locked-down browser, a lost context — shows the still image
 * in the same medallion at the same size, and `.heart-3d-active` is what
 * swaps between them. That is a better fallback than the flat SVG this step
 * originally replaced: the two states now differ in motion, not in quality.
 *
 * THE SPLASH KEEPS THE STILL, DELIBERATELY. It would be easy to put this on
 * the startup screen too and it would be wrong. The splash exists to paint
 * before the app's megabytes parse; a WebGL context, a mesh built by surface
 * nets at load, and a first frame are all things that happen after parse.
 * verify-splash-heart asserts that nothing on the splash asks for WebGL, and
 * that assertion is protecting the one property the splash has.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/heroart-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 240)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* The picture the splash is already carrying — a data: URI in the single-file
   build, a URL after build-pwa.js has rewritten it. Read from the document so
   the fallback and the splash can never drift into being two different
   images. */
const srcMatch = /<img class="sp-heart-img" data-splash-heart="img" alt="" decoding="sync" src="([^"]+)">/.exec(html);
if (!srcMatch) {
  throw new Error('heroart: the splash heart <img> was not found, so there is no fallback image to reuse.\n'
    + '  This step reads the picture out of the markup splash-heart-patch.js writes.\n'
    + '  If that step changed its markup, this is the line that needs to follow it.');
}
const IMG_SRC = srcMatch[1];

/* ── 1. the markup ──────────────────────────────────────────────────────── */
patch('hero: the turning heart, with the photograph behind it as the fallback',
`      ${'$'}{heartSVG('heroHeart')}
      <canvas id="heroHeart3d" class="heart-3d-mini" aria-hidden="true"></canvas>`,
`      <div class="hero-heart-plate" id="heroHeart" aria-hidden="true">
        <div class="h-beat"><img data-hero-heart="img" src="${IMG_SRC}" alt="" loading="eager" decoding="async"></div>
      </div>
      <canvas id="heroHeart3d" class="hero-heart-3d" aria-hidden="true"></canvas>`);

/* ── 2. the CSS ─────────────────────────────────────────────────────────── */
patch('hero: one medallion, two things that can fill it',
`/* the real anatomical heart — same renderer as Rhythm Lab, coarser mesh,
   no interaction. Sits under the flat SVG fallback and is only shown once
   a WebGL2 context actually exists (see heart-3d-active). */
.heart-3d-mini{position:absolute;right:clamp(10px,2.4vw,22px);top:clamp(6px,1.6vw,16px);
  width:clamp(92px,12vw,124px);height:clamp(98px,13vw,132px);z-index:1;
  opacity:0;transition:opacity .5s var(--glide)}
#heroHeart.heart-3d-active ~ .heart-3d-mini{opacity:1}
#heroHeart.heart-3d-active{opacity:0;pointer-events:none}`,
`/* THE MEDALLION IS ONE BOX WITH TWO OCCUPANTS. The still photograph is in the
   markup and visible from the first paint; the turning heart fades in over it
   once a WebGL2 context exists and its first frame is up. Sharing one box and
   one frame means the swap is a crossfade rather than a jump, and a device
   that never gets a context simply keeps what it already had.

   Larger than the box the old mini heart had — clamp(92px…) to clamp(124px…).
   At the old size the conduction tree was three yellow pixels. A drawing has
   to be big enough to be read or it is only texture. */
.hero-heart-plate,.hero-heart-3d{
  position:absolute;right:clamp(10px,2.4vw,22px);top:clamp(6px,1.6vw,16px);
  width:clamp(124px,15vw,168px);height:clamp(132px,16vw,178px);z-index:1}
.hero-heart-plate{
  border-radius:24%;overflow:hidden;background:#0b1622;pointer-events:none;
  transition:opacity .5s var(--glide);
  box-shadow:0 10px 26px rgba(3,12,24,.34), 0 0 0 1px rgba(148,190,220,.13),
             inset 0 0 34px rgba(4,10,18,.5)}
/* The beat lives here and nowhere else, because setHeroBeatRate() writes
   animationDuration onto '#heroHeart .h-beat'. It drives the still image; the
   turning heart runs its own clock from the same rhythm. */
.hero-heart-plate .h-beat{width:100%;height:100%;
  animation:heroBeat 850ms infinite cubic-bezier(.28,.9,.32,1)}
.hero-heart-plate img{display:block;width:100%;height:100%;object-fit:cover}
.hero-heart-plate::after{content:"";position:absolute;inset:0;border-radius:inherit;
  background:radial-gradient(118% 118% at 50% 40%,rgba(0,0,0,0) 50%,rgba(4,10,18,.6) 100%)}
@keyframes heroBeat{0%,100%{transform:scale(1)}
  17%{transform:scale(1.05)}
  31%{transform:scale(1.014)}
  45%{transform:scale(1.03)}}
/* NO GROUND UNDER THE MODEL. The canvas is created with alpha:true and cleared
   to (0,0,0,0), so the heart has always been transparent — the black square was
   this rule painting a plate behind it. The still photograph needs its frame
   because the picture has a dark ground baked into it and would otherwise be a
   rectangle pasted on the hero; the model needs no frame because it has no
   rectangle. So the two states are framed differently on purpose, and only one
   of them is ever on screen. */
.hero-heart-3d{
  opacity:0;transition:opacity .6s var(--glide);pointer-events:none;
  background:transparent;
  /* The shadow moves onto the heart itself rather than onto a box behind it. */
  filter:drop-shadow(0 12px 22px rgba(3,10,20,.55))}
#heroHeart.heart-3d-active{opacity:0}
#heroHeart.heart-3d-active ~ .hero-heart-3d{opacity:1}
@media(prefers-reduced-motion:reduce){ .hero-heart-plate .h-beat{animation:none} }`);

/* ── 3. the mount ───────────────────────────────────────────────────────── */
patch('hero: mount the specimen heart, and hand the medallion back if it is lost',
`/* Same identity-checked mount pattern as the lab heart (see mountLabHeart) —
   a screen-change render() can replace this canvas node out from under a
   running instance, so we compare nodes, not just check truthiness. Falls
   back to the flat SVG heart, already in the markup, if WebGL2 is missing. */
function mountHeroHeart3d(){
  const cv=document.getElementById('heroHeart3d');
  if(!cv||typeof Heart3D==='undefined'||!hasWebGL2()){
    document.getElementById('heroHeart')?.classList.remove('heart-3d-active');
    return;
  }`,
`/* Same identity-checked mount pattern as the lab heart (see mountLabHeart) —
   a screen-change render() can replace this canvas node out from under a
   running instance, so we compare nodes, not just check truthiness. Falls
   back to the photograph, already in the markup and already painted, if
   WebGL2 is missing. */
function mountHeroHeart3d(){
  const cv=document.getElementById('heroHeart3d');
  if(!cv||typeof Heart3D==='undefined'||!hasWebGL2()){
    document.getElementById('heroHeart')?.classList.remove('heart-3d-active');
    return;
  }`);

patch('hero: the specimen style, turning, on the rhythm the strip is drawing',
`  heroHeart3d=Heart3D.create(cv,{rhythm:heroCurrentKind||'sinus',mode:'whole',dark,
    resolution:[40,52,32], distance:26, yaw:0.32, pitch:0.10, autoRotate:true,`,
`  heroHeart3d=Heart3D.create(cv,{rhythm:heroCurrentKind||'sinus',mode:'whole',dark,
    /* specimen: slate material, coronaries as relief, and the conduction
       system drawn as a source with the depolarisation front travelling it.
       See the style's own comment in src/core/heart3d.js — the current is the
       module's existing wave, not an effect added for the look of it. */
    style:'specimen',
    /* THE MESH IS NO LONGER THE COARSE ONE. [40,52,32] was chosen when this
       was a 92px mark in the corner, where nobody could see a facet. At the
       size it is drawn now the low mesh showed as flat planes across the
       ventricular wall, and the coronary tree — seventeen vessels since the
       branches were added — was landing on a surface too blocky to sit on.
       Roughly 2.6x the cells and about a third of a second at mount, which
       happens once, behind the splash. */
    resolution:[58,76,48], distance:26, yaw:0.32, pitch:0.10, autoRotate:true,`);

/* ── 4. the guard ───────────────────────────────────────────────────────── */
/* The style has to survive into the build, not just into this file. A typo in
   the option name silently falls back to `anatomic` — a red heart on the home
   screen, which is wrong but not obviously broken, and exactly the kind of
   thing that ships. */
if (!/style:\s*'specimen'/.test(html)) {
  throw new Error('heroart: the specimen style did not reach the mount site');
}
if (!/uStyle > 2\.5/.test(html)) {
  throw new Error('heroart: the specimen branch is not in the embedded shader.\n'
    + '  src/core/heart3d.js is embedded by apex-patch.js earlier in the chain;\n'
    + '  if that step no longer carries the module, this style has nowhere to run.');
}
applied.push('hero: the style reaches both the mount site and the embedded shader');

fs.writeFileSync(OUT, html);
console.log(`Hero specimen heart applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`  fallback  ${IMG_SRC.startsWith('data:') ? `inline data: URI, ${(IMG_SRC.length / 1024).toFixed(1)} KB` : IMG_SRC}`);
console.log(`written: ${OUT}`);
