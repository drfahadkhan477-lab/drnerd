#!/usr/bin/env node
/*
 * The home hero wears the photograph, and stops spending a WebGL context on it.
 *
 *   node scripts/heroart-patch.js <in.html> <out.html>
 *
 * WHAT IT REPLACES. The hero on the home screen carried two hearts stacked:
 * a flat SVG (heartSVG('heroHeart')) as the always-there fallback, and a
 * <canvas id="heroHeart3d"> running the same Heart3D renderer Rhythm Lab uses,
 * revealed by a .heart-3d-active class once a WebGL2 context existed. The
 * splash now shows a photographed heart; the home screen showing a different,
 * lower-fidelity one directly underneath the same wordmark read as two apps.
 * So the hero takes the same picture.
 *
 * WHAT IS ACTUALLY LOST, SAID PLAINLY. The 3D hero was not decoration alone.
 * It took setRhythm() from the 11-second rotation, so the model's beat tracked
 * whichever rhythm the strip was drawing, and setDark() on a theme change.
 * A photograph cannot deform per rhythm. What it CAN do is beat at the right
 * rate, and that path already exists and is untouched by this step:
 * setHeroBeatRate() writes animationDuration onto '#heroHeart .h-beat', which
 * is how the flat SVG fallback has always followed the rotation. The markup
 * below keeps that exact selector, so the picture beats at 72 in sinus and at
 * whatever HeroRhythm says in atrial fibrillation, with no new wiring.
 *
 * WHAT IS GAINED BESIDES THE PICTURE. The home screen stops creating a WebGL2
 * context at all. That context was live on the app's most-visited screen,
 * competed with Rhythm Lab's for the browser's small context budget, and
 * brought with it the whole context-loss dance — onLost nulling two handles so
 * the identity guard would stop refusing to re-mount, onRestored re-calling the
 * mount, and a fallback class to toggle. All of it goes.
 *
 * AND THAT LEAVES Heart3D WITH NO CALLERS AT ALL. Stated here rather than
 * discovered later. An earlier step took the 3D heart out of Rhythm Lab, so
 * the hero was its last consumer; grep the build after this step and the only
 * mentions of Heart3D are its own export line and a usage example inside its
 * own header comment. That is ~79 KB of renderer shipped for nothing —
 * irrelevant against a 37 MB single file, but 79 KB of a 705 KB PWA shell.
 *
 * IT IS DELIBERATELY NOT DELETED HERE. This step was asked to change a
 * picture, and deleting a renderer the app's owner built over several sessions
 * and has already chosen twice where to place is their call, not a side effect
 * of swapping an image. src/core/heart3d.js is untouched and still embedded.
 * If it is to go, that is its own step, with the apex/polish/theme suites'
 * references to it updated in the same commit.
 *
 * ONE CONSEQUENCE FOR THE TEST SUITE, RECORDED HERE. verify-calibrate.js
 * asserts the hero's WebGL context-loss recovery — it loses the context and
 * waits for the fallback. There is no hero context to lose after this step, so
 * those checks describe an app that no longer exists and are removed rather
 * than left passing vacuously on a screen with no canvas. The equivalent
 * recovery on the Rhythm Lab heart, which is still real, keeps its coverage.
 *
 * THE IMAGE ARRIVES ALREADY IN THE DOCUMENT. splash-heart-patch.js has already
 * put the same photograph on the page as a data: URI (or, in the split build,
 * as a URL that build-pwa.js rewrote). This step reads it back out of the
 * splash markup rather than re-encoding the file, so the two hearts can never
 * be different pictures, and so the split build gets one request for one image
 * instead of two copies of it.
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

/* Whatever the splash's img is pointing at — a data: URI in the single-file
   build, 'content/splash-heart/heart.webp' after build-pwa.js has run. Taking
   it from the document rather than from disk is what guarantees the hero and
   the splash are the same heart. */
const srcMatch = /<img class="sp-heart-img" data-splash-heart="img" alt="" decoding="sync" src="([^"]+)">/.exec(html);
if (!srcMatch) {
  throw new Error('heroart: the splash heart <img> was not found, so there is no image to reuse.\n'
    + '  This step reads the picture out of the splash markup that splash-heart-patch.js writes.\n'
    + '  If that step changed its markup, this is the line that needs to follow it.');
}
const IMG_SRC = srcMatch[1];

/* ── 1. the markup ────────────────────────────────────────────────────────
   The flat SVG and the canvas both go. The replacement keeps the id
   #heroHeart and an inner .h-beat, because setHeroBeatRate() addresses
   '#heroHeart .h-beat' and is deliberately left alone by this step. */
patch('hero: the photograph replaces the flat SVG and the 3D canvas',
`      ${'$'}{heartSVG('heroHeart')}
      <canvas id="heroHeart3d" class="heart-3d-mini" aria-hidden="true"></canvas>`,
`      <div class="hero-heart-plate" id="heroHeart" aria-hidden="true">
        <div class="h-beat"><img data-hero-heart="img" src="${IMG_SRC}" alt="" loading="eager" decoding="async"></div>
      </div>`);

/* ── 2. the CSS ───────────────────────────────────────────────────────────
   Inherits .heart-3d-mini's box exactly — that is where the 3D heart sat and
   the composition was tuned around it — and drops the opacity gate, which
   existed only to hold the canvas hidden until WebGL proved itself. The two
   .heart-3d-active rules go with it: nothing sets that class any more. */
patch('hero: the medallion takes the box the 3D canvas had',
`/* the real anatomical heart — same renderer as Rhythm Lab, coarser mesh,
   no interaction. Sits under the flat SVG fallback and is only shown once
   a WebGL2 context actually exists (see heart-3d-active). */
.heart-3d-mini{position:absolute;right:clamp(10px,2.4vw,22px);top:clamp(6px,1.6vw,16px);
  width:clamp(92px,12vw,124px);height:clamp(98px,13vw,132px);z-index:1;
  opacity:0;transition:opacity .5s var(--glide)}
#heroHeart.heart-3d-active ~ .heart-3d-mini{opacity:1}
#heroHeart.heart-3d-active{opacity:0;pointer-events:none}`,
`/* the photographed heart, in a medallion that carries its own dark ground so
   it reads the same on Parchment's cream as on Nocturne's near-black. Same
   box the 3D canvas occupied — the composition was tuned around it. */
.hero-heart-plate{position:absolute;right:clamp(10px,2.4vw,22px);top:clamp(6px,1.6vw,16px);
  width:clamp(92px,12vw,124px);height:clamp(98px,13vw,132px);z-index:1;
  border-radius:24%;overflow:hidden;background:#0b1622;pointer-events:none;
  box-shadow:0 10px 26px rgba(3,12,24,.34), 0 0 0 1px rgba(148,190,220,.13),
             inset 0 0 34px rgba(4,10,18,.5)}
/* The beat lives on this element and nothing else, because setHeroBeatRate()
   writes animationDuration onto '#heroHeart .h-beat' — the same selector the
   flat SVG used, so the rhythm rotation drives the picture with no new code. */
.hero-heart-plate .h-beat{width:100%;height:100%;
  animation:heroBeat 850ms infinite cubic-bezier(.28,.9,.32,1)}
.hero-heart-plate img{display:block;width:100%;height:100%;object-fit:cover}
.hero-heart-plate::after{content:"";position:absolute;inset:0;border-radius:inherit;
  background:radial-gradient(118% 118% at 50% 40%,rgba(0,0,0,0) 50%,rgba(4,10,18,.6) 100%)}
@keyframes heroBeat{0%,100%{transform:scale(1)}
  17%{transform:scale(1.05)}
  31%{transform:scale(1.014)}
  45%{transform:scale(1.03)}}
@media(prefers-reduced-motion:reduce){ .hero-heart-plate .h-beat{animation:none} }`);

/* ── 3. the mount function, whole ─────────────────────────────────────────
   Deleted rather than emptied. A function that exists and does nothing is how
   a caller three months from now concludes the hero still has a 3D heart. */
patch('hero: mountHeroHeart3d is deleted, not stubbed',
`/* Same identity-checked mount pattern as the lab heart (see mountLabHeart) —
   a screen-change render() can replace this canvas node out from under a
   running instance, so we compare nodes, not just check truthiness. Falls
   back to the flat SVG heart, already in the markup, if WebGL2 is missing. */
function mountHeroHeart3d(){
  const cv=document.getElementById('heroHeart3d');
  if(!cv||typeof Heart3D==='undefined'||!hasWebGL2()){
    document.getElementById('heroHeart')?.classList.remove('heart-3d-active');
    return;
  }
  if(heroHeart3d && heroHeart3dCanvas===cv) return;
  if(heroHeart3d){ heroHeart3d.destroy(); heroHeart3d=null; }
  const dark=document.documentElement.getAttribute('data-theme')==='dark'
    || (!document.documentElement.hasAttribute('data-theme')
        && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  heroHeart3d=Heart3D.create(cv,{rhythm:heroCurrentKind||'sinus',mode:'whole',dark,
    resolution:[40,52,32], distance:26, yaw:0.32, pitch:0.10, autoRotate:true,
    /* Clearing both handles matters as much as showing the fallback: the
       identity guard at the top of this function returns early while a stale
       instance is still assigned to this canvas, so without nulling them a
       restore could not re-mount even when asked. */
    onLost:function(){
      heroHeart3d=null; heroHeart3dCanvas=null;
      document.getElementById('heroHeart')?.classList.remove('heart-3d-active');
    },
    onRestored:function(){
      if(S.screen==='home') mountHeroHeart3d();
    }});
  if(!heroHeart3d) return;
  heroHeart3dCanvas=cv;
  cv.style.pointerEvents='none';           // decorative — never eats a home-screen scroll
  document.getElementById('heroHeart')?.classList.add('heart-3d-active');
}
`,
`/* The hero's heart is a photograph in the markup (see heroart-patch.js). It
   needs no mount: setHeroBeatRate() drives its beat through the same
   '#heroHeart .h-beat' selector the flat SVG used, and there is no WebGL
   context on this screen to create, lose, or restore. */
`);

/* ── 4. the three call sites and the two dead handles ─────────────────── */
patch('hero: nothing calls the mount from render()',
`  if(typeof mountHero==='function') mountHero();
  if(typeof mountHeroHeart3d==='function') mountHeroHeart3d();`,
`  if(typeof mountHero==='function') mountHero();`);

patch('hero: nothing calls the mount from mountHero()',
`  heroMon.start();
  mountHeroHeart3d();
  paintHeroLabel(heroCurrentKind);`,
`  heroMon.start();
  paintHeroLabel(heroCurrentKind);`);

patch('hero: the two handles it kept are gone',
`let heroMon=null, heroHeart3d=null, heroHeart3dCanvas=null, heroRotateTimer=null, heroCurrentKind=null;`,
`let heroMon=null, heroRotateTimer=null, heroCurrentKind=null;`);

patch('hero: the early return has no instance to destroy',
`  const cv=document.getElementById('heroECG');
  if(!cv){
    if(heroHeart3d){ heroHeart3d.destroy(); heroHeart3d=null; heroHeart3dCanvas=null; }
    return;
  }`,
`  const cv=document.getElementById('heroECG');
  if(!cv) return;`);

patch('hero: the rotation drives the strip and the beat, not a model',
`    heroMon.setRhythm(heroCurrentKind);
    if(heroHeart3d) heroHeart3d.setRhythm(heroCurrentKind);
    setHeroBeatRate(heroCurrentKind);`,
`    heroMon.setRhythm(heroCurrentKind);
    setHeroBeatRate(heroCurrentKind);`);

/* A photograph has no light model to re-tune, and the medallion carries its
   own ground on purpose, so a theme change has nothing to tell it. */
patch('hero: a theme change no longer has a model to re-light',
`  if(typeof heroHeart3d!=='undefined'&&heroHeart3d) heroHeart3d.setDark(d);
`, '');

/* ── 5. the guard ─────────────────────────────────────────────────────────
   Every mention should now be gone. If one survives, this build is shipping a
   reference to a handle that no longer exists, and that is a runtime error on
   the app's first screen — worth stopping the build over. */
const DEAD = /heroHeart3d|heart-3d-active/g;
const left = (html.match(DEAD) || []).length;
if (left) {
  const where = [];
  const re = new RegExp(DEAD.source, 'g'); let m;
  while ((m = re.exec(html))) {
    const a = html.lastIndexOf('\n', m.index) + 1;
    where.push(html.slice(a, html.indexOf('\n', m.index)).trim().slice(0, 120));
  }
  throw new Error(`heroart: ${left} dead reference(s) to the 3D hero survived:\n  ` + [...new Set(where)].join('\n  '));
}
applied.push('hero: no reference to heroHeart3d or heart-3d-active survives anywhere in the build');

fs.writeFileSync(OUT, html);
console.log(`Hero photograph applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`  image     ${IMG_SRC.startsWith('data:') ? `inline data: URI, ${(IMG_SRC.length / 1024).toFixed(1)} KB` : IMG_SRC}`);
console.log(`written: ${OUT}`);
