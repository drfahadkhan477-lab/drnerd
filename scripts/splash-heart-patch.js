#!/usr/bin/env node
/*
 * A mechanistic heart on the startup screen.
 *
 *   node scripts/splash-heart-patch.js <home-output.html> <output.html>
 *
 * WHAT IT IS. An instrument, not an organ: the cardiac silhouette of an
 * anterior chest film, drawn as a machined part on its own lit plate, with the
 * atrioventricular and interventricular grooves as section lines, the great
 * vessels as tubes, the two valve orifices as irises that open and shut, and
 * the conduction system as circuitry that lights in the order it depolarises —
 * sinus node, AV node, His, the bundle branches, Purkinje. The delays are the
 * real ones scaled to the beat, so the light genuinely runs down the septum
 * rather than blinking decoratively.
 *
 * IT IS SVG AND CSS, ON PURPOSE. The obvious thing would be to show the app's
 * real WebGL heart here. It is exactly the wrong thing: meshing that heart is
 * part of what the splash is covering for, so putting it ON the splash would
 * mean waiting for the load in order to show the loading screen. This is
 * geometry and transforms — it paints on the first frame and asks nothing of
 * the megabytes still parsing below it.
 *
 * IT CARRIES ITS OWN GROUND. The splash takes the page background, which under
 * Parchment is cream and under Nocturne is near-black. A luminous instrument
 * drawn straight onto the page would be invisible on one of them, so the heart
 * sits on a dark plate of its own and reads identically on every theme. Nothing
 * of it extends past that plate — the vessels stop inside it for that reason.
 *
 * ONE CLOCK. Every layer is driven by the same 0.92s beat, phase-shifted rather
 * than animated independently, so it reads as one machine rather than as
 * several things that happen to be moving at once.
 *
 * The conduction delays are NEGATIVE, and that is not a typo. A positive
 * animation-delay means the animation has not started yet, and until it does
 * the element renders its ordinary style — so every node below the sinus node
 * sat at full brightness for its first two hundred milliseconds and then
 * snapped into the sequence. A negative delay starts the animation already
 * running, offset into its own cycle, which is the phase shift that was wanted.
 * Measuring the opacities frame by frame is what caught it; on screen it looked
 * like the heart simply lit up on arrival.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/splash-heart-patch.js <home-output.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 200)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

const HEART = `<svg class="sp-heart" viewBox="0 0 200 200" role="img" aria-label="Systole">
      <defs>
        <radialGradient id="spPlateG" cx="50%" cy="42%" r="62%">
          <stop offset="0%" stop-color="#123047"/><stop offset="55%" stop-color="#0A1E31"/>
          <stop offset="100%" stop-color="#050F1B"/>
        </radialGradient>
        <radialGradient id="spCoreG" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#EAFFFB" stop-opacity=".95"/>
          <stop offset="35%" stop-color="#5EEAD4" stop-opacity=".55"/>
          <stop offset="100%" stop-color="#38BDF8" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="spMuscleG" x1=".15" y1="0" x2=".8" y2="1">
          <stop offset="0%" stop-color="#7FF0DE" stop-opacity=".26"/>
          <stop offset="52%" stop-color="#2DD4BF" stop-opacity=".13"/>
          <stop offset="100%" stop-color="#0EA5B8" stop-opacity=".30"/>
        </linearGradient>
        <linearGradient id="spScanG" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#5EEAD4" stop-opacity="0"/>
          <stop offset="50%" stop-color="#CFFFF8" stop-opacity=".9"/>
          <stop offset="100%" stop-color="#5EEAD4" stop-opacity="0"/>
        </linearGradient>
        <path id="spV" d="M 66,164 C 52,142 46,116 50,92 C 53,74 62,62 76,56 C 92,48 112,46 126,50 C 142,55 148,74 146,96 C 145,116 140,132 128,144 C 112,158 88,166 66,164 Z"/>
        <clipPath id="spPlateClip"><circle cx="100" cy="100" r="86"/></clipPath>
        <clipPath id="spVClip"><use href="#spV"/></clipPath>
        <filter id="spSoft" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.6"/></filter>
        <filter id="spSoftSm" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="1.2"/></filter>
      </defs>

      <!-- the plate: its own ground, so the object reads the same on cream and on
           near-black rather than borrowing whichever the theme happens to be -->
      <circle class="sp-plate" cx="100" cy="100" r="86" fill="url(#spPlateG)"/>
      <g clip-path="url(#spPlateClip)">
        <g class="sp-grid">
          <path d="M0,70 H200 M0,100 H200 M0,130 H200 M70,0 V200 M100,0 V200 M130,0 V200"/>
        </g>
        <g class="sp-scan"><rect x="0" y="-16" width="200" height="16" fill="url(#spScanG)" opacity=".55"/><rect x="0" y="-1.1" width="200" height="1.1" fill="url(#spScanG)"/></g>
      </g>

      <!-- bezel -->
      <circle class="sp-bezel" cx="100" cy="100" r="86"/>
      <g class="sp-ticks"><line x1="100.00" y1="22.00" x2="100.00" y2="14.00" class="sp-tick-major"/><line x1="108.47" y1="19.44" x2="108.99" y2="14.47"/><line x1="116.84" y1="20.77" x2="117.88" y2="15.88"/><line x1="125.03" y1="22.96" x2="126.58" y2="18.21"/><line x1="132.95" y1="26.00" x2="134.98" y2="21.44"/><line x1="139.00" y1="32.45" x2="143.00" y2="25.52" class="sp-tick-major"/><line x1="147.61" y1="34.47" x2="150.55" y2="30.42"/><line x1="154.20" y1="39.81" x2="157.55" y2="36.09"/><line x1="160.19" y1="45.80" x2="163.91" y2="42.45"/><line x1="165.53" y1="52.39" x2="169.58" y2="49.45"/><line x1="167.55" y1="61.00" x2="174.48" y2="57.00" class="sp-tick-major"/><line x1="174.00" y1="67.05" x2="178.56" y2="65.02"/><line x1="177.04" y1="74.97" x2="181.79" y2="73.42"/><line x1="179.23" y1="83.16" x2="184.12" y2="82.12"/><line x1="180.56" y1="91.53" x2="185.53" y2="91.01"/><line x1="178.00" y1="100.00" x2="186.00" y2="100.00" class="sp-tick-major"/><line x1="180.56" y1="108.47" x2="185.53" y2="108.99"/><line x1="179.23" y1="116.84" x2="184.12" y2="117.88"/><line x1="177.04" y1="125.03" x2="181.79" y2="126.58"/><line x1="174.00" y1="132.95" x2="178.56" y2="134.98"/><line x1="167.55" y1="139.00" x2="174.48" y2="143.00" class="sp-tick-major"/><line x1="165.53" y1="147.61" x2="169.58" y2="150.55"/><line x1="160.19" y1="154.20" x2="163.91" y2="157.55"/><line x1="154.20" y1="160.19" x2="157.55" y2="163.91"/><line x1="147.61" y1="165.53" x2="150.55" y2="169.58"/><line x1="139.00" y1="167.55" x2="143.00" y2="174.48" class="sp-tick-major"/><line x1="132.95" y1="174.00" x2="134.98" y2="178.56"/><line x1="125.03" y1="177.04" x2="126.58" y2="181.79"/><line x1="116.84" y1="179.23" x2="117.88" y2="184.12"/><line x1="108.47" y1="180.56" x2="108.99" y2="185.53"/><line x1="100.00" y1="178.00" x2="100.00" y2="186.00" class="sp-tick-major"/><line x1="91.53" y1="180.56" x2="91.01" y2="185.53"/><line x1="83.16" y1="179.23" x2="82.12" y2="184.12"/><line x1="74.97" y1="177.04" x2="73.42" y2="181.79"/><line x1="67.05" y1="174.00" x2="65.02" y2="178.56"/><line x1="61.00" y1="167.55" x2="57.00" y2="174.48" class="sp-tick-major"/><line x1="52.39" y1="165.53" x2="49.45" y2="169.58"/><line x1="45.80" y1="160.19" x2="42.45" y2="163.91"/><line x1="39.81" y1="154.20" x2="36.09" y2="157.55"/><line x1="34.47" y1="147.61" x2="30.42" y2="150.55"/><line x1="32.45" y1="139.00" x2="25.52" y2="143.00" class="sp-tick-major"/><line x1="26.00" y1="132.95" x2="21.44" y2="134.98"/><line x1="22.96" y1="125.03" x2="18.21" y2="126.58"/><line x1="20.77" y1="116.84" x2="15.88" y2="117.88"/><line x1="19.44" y1="108.47" x2="14.47" y2="108.99"/><line x1="22.00" y1="100.00" x2="14.00" y2="100.00" class="sp-tick-major"/><line x1="19.44" y1="91.53" x2="14.47" y2="91.01"/><line x1="20.77" y1="83.16" x2="15.88" y2="82.12"/><line x1="22.96" y1="74.97" x2="18.21" y2="73.42"/><line x1="26.00" y1="67.05" x2="21.44" y2="65.02"/><line x1="32.45" y1="61.00" x2="25.52" y2="57.00" class="sp-tick-major"/><line x1="34.47" y1="52.39" x2="30.42" y2="49.45"/><line x1="39.81" y1="45.80" x2="36.09" y2="42.45"/><line x1="45.80" y1="39.81" x2="42.45" y2="36.09"/><line x1="52.39" y1="34.47" x2="49.45" y2="30.42"/><line x1="61.00" y1="32.45" x2="57.00" y2="25.52" class="sp-tick-major"/><line x1="67.05" y1="26.00" x2="65.02" y2="21.44"/><line x1="74.97" y1="22.96" x2="73.42" y2="18.21"/><line x1="83.16" y1="20.77" x2="82.12" y2="15.88"/><line x1="91.53" y1="19.44" x2="91.01" y2="14.47"/></g>
      <circle class="sp-ring sp-ring-a" cx="100" cy="100" r="94"/>
      <circle class="sp-ring sp-ring-b" cx="100" cy="100" r="90"/>

      <g class="sp-body">
        <g class="sp-vessel">
          <path d="M 116,48 C 116,34 124,26 136,28"/><path d="M 92,50 C 88,38 82,32 72,32"/><path d="M 134,52 C 136,40 136,34 135,28"/>
        </g>
        <use class="sp-muscle" href="#spV"/>
        <g clip-path="url(#spVClip)">
          <!-- machined seams: the interventricular groove where the LAD runs,
               and the section lines of a technical drawing -->
          <!-- four chambers, said with two lines -->
          <g class="sp-groove">
            <path d="M 50,92 C 78,112 114,104 146,92"/><path d="M 100,52 C 96,86 84,126 66,164"/>
          </g>
          <g class="sp-seam">
            <path d="M 46,120 H 154"/><path d="M 56,142 H 144"/>
          </g>
        </g>
        <use class="sp-rim-glow" href="#spV"/>
        <use class="sp-rim" href="#spV"/>

        <circle class="sp-core" cx="98" cy="112" r="34" fill="url(#spCoreG)"/>

        <g class="sp-traces"><path d="M 128,62 C 122,76 112,90 104,100"/><path d="M 104,100 L 102,112"/><path d="M 102,112 C 96,120 90,128 86,134"/><path d="M 102,112 C 110,120 116,130 120,138"/><path d="M 86,134 C 82,142 78,150 74,156"/></g>
        <g class="sp-node" style="animation-delay:-0.920s"><circle class="sp-node-halo" cx="128" cy="62" r="9.240000000000002"/><circle class="sp-node-dot" cx="128" cy="62" r="2.728"/></g><g class="sp-node" style="animation-delay:-0.819s"><circle class="sp-node-halo" cx="104" cy="100" r="7.5600000000000005"/><circle class="sp-node-dot" cx="104" cy="100" r="2.232"/></g><g class="sp-node" style="animation-delay:-0.777s"><circle class="sp-node-halo" cx="102" cy="112" r="6.300000000000001"/><circle class="sp-node-dot" cx="102" cy="112" r="1.8599999999999999"/></g><g class="sp-node" style="animation-delay:-0.741s"><circle class="sp-node-halo" cx="86" cy="134" r="5.460000000000001"/><circle class="sp-node-dot" cx="86" cy="134" r="1.612"/></g><g class="sp-node" style="animation-delay:-0.741s"><circle class="sp-node-halo" cx="120" cy="138" r="5.460000000000001"/><circle class="sp-node-dot" cx="120" cy="138" r="1.612"/></g><g class="sp-node" style="animation-delay:-0.704s"><circle class="sp-node-halo" cx="74" cy="156" r="4.2"/><circle class="sp-node-dot" cx="74" cy="156" r="1.24"/></g>

        <g class="sp-iris sp-iris-a"><polygon points="110,60 116,56.5 122,60 122,67 116,70.5 110,67"/><circle cx="116" cy="63.5" r="1.5"/></g>
        <g class="sp-iris sp-iris-m"><polygon points="74,94 80,90.5 86,94 86,101 80,104.5 74,101"/><circle cx="80" cy="97.5" r="1.5"/></g>
      </g>
    </svg>`;

patch('splash: the mechanistic heart above the strip',
`  <div class="sp-in">
    <svg class="sp-strip"`,
`  <div class="sp-in">
    ${HEART}
    <svg class="sp-strip"`);

patch('splash: its styles',
`.sp-in{display:flex;flex-direction:column;align-items:center;padding:24px}`,
`.sp-in{display:flex;flex-direction:column;align-items:center;padding:24px}
/* ── the mechanistic heart ────────────────────────────────────────────────
   Drawn, not meshed. Geometry and CSS transforms only, so it paints on the
   first frame — which is the point of a screen that exists to cover a
   megabyte still parsing underneath it. One 0.92s beat drives every layer,
   phase-shifted rather than animated independently, so it reads as one
   machine rather than as several things that happen to move together.

   It carries its own dark plate. The splash takes the page background, which
   under Parchment is cream and under Nocturne is near-black; a luminous
   instrument drawn straight onto either would be invisible on one of them. */
.sp-heart{
  width:min(288px,66vw);height:auto;overflow:visible;margin-bottom:20px;
  animation:spRise 1s both cubic-bezier(.2,.7,.3,1);
  filter:drop-shadow(0 18px 46px rgba(3,12,24,.55));
}
.sp-body{transform-box:fill-box;transform-origin:50% 56%;
  animation:spBeat .92s cubic-bezier(.4,0,.35,1) infinite}

/* plate and bezel */
.sp-bezel{fill:none;stroke:#5EEAD4;stroke-opacity:.34;stroke-width:1.1}
.sp-grid path{fill:none;stroke:#5EEAD4;stroke-opacity:.09;stroke-width:.7}
.sp-ring{fill:none;stroke:#5EEAD4;stroke-opacity:.34;stroke-width:1;
  transform-box:fill-box;transform-origin:center}
.sp-ring-a{stroke-dasharray:58 12 5 12;animation:spSpin 16s linear infinite}
.sp-ring-b{stroke-dasharray:2 10;stroke-opacity:.20;animation:spSpin 26s linear infinite reverse}
.sp-ticks line{stroke:#5EEAD4;stroke-opacity:.24;stroke-width:.8}
.sp-ticks .sp-tick-major{stroke-opacity:.55;stroke-width:1.4}
.sp-ticks{transform-box:fill-box;transform-origin:center;animation:spSpin 70s linear infinite}

/* the muscle */
.sp-muscle{fill:url(#spMuscleG);stroke:none}
.sp-rim{fill:none;stroke:#9DF8E9;stroke-width:1.7;stroke-linejoin:round}
.sp-rim-glow{fill:none;stroke:#5EEAD4;stroke-width:4.5;stroke-opacity:.34;
  stroke-linejoin:round;filter:url(#spSoft)}
/* The grooves do the work the atrial outlines were doing badly: two lines
   that say four chambers, drawn brighter than the section seams because they
   are anatomy rather than draughtsmanship. */
.sp-groove path{fill:none;stroke:#9DF8E9;stroke-opacity:.5;stroke-width:1.3}
.sp-seam path{fill:none;stroke:#D6FFF8;stroke-opacity:.16;stroke-width:.7}
.sp-vessel path{fill:none;stroke:#9DF8E9;stroke-opacity:.78;stroke-width:2.6;
  stroke-linecap:round}

.sp-scan{animation:spScan 3.7s cubic-bezier(.55,0,.45,1) infinite}
.sp-core{transform-box:fill-box;transform-origin:center;
  animation:spCore .92s cubic-bezier(.4,0,.35,1) infinite}

/* conduction, lit in the order it depolarises: sinus node, AV node, His,
   bundle branches, Purkinje. The delays are the real ones, scaled to the beat. */
.sp-traces path{fill:none;stroke:#5EEAD4;stroke-opacity:.34;stroke-width:1.2;
  stroke-linecap:round;stroke-dasharray:3.5 4.5;
  animation:spCrawl 1.6s linear infinite}
.sp-node{transform-box:fill-box;transform-origin:center;
  animation:spFire .92s linear infinite}
.sp-node-halo{fill:#5EEAD4;fill-opacity:.5;filter:url(#spSoft)}
.sp-node-dot{fill:#F2FFFC}

/* valves: the aortic opens through ejection, the mitral is its inverse */
.sp-iris polygon{fill:none;stroke:#CFFFF8;stroke-opacity:.8;stroke-width:1.2}
.sp-iris circle{fill:#EAFFFB;fill-opacity:.85}
.sp-iris{transform-box:fill-box;transform-origin:center}
.sp-iris-a{animation:spIrisA .92s cubic-bezier(.4,0,.35,1) infinite}
.sp-iris-m{animation:spIrisM .92s cubic-bezier(.4,0,.35,1) infinite}

@keyframes spRise{from{opacity:0;transform:translateY(16px) scale(.93)}to{opacity:1;transform:none}}
/* A real beat, not a sine wave: fast upstroke, a hold through ejection, a
   slower relaxation, and the small rebound of early filling. */
@keyframes spBeat{
  0%,100%{transform:scale(1)}
  8%     {transform:scale(1.05)}
  22%    {transform:scale(1.032)}
  36%    {transform:scale(.986)}
  54%    {transform:scale(1.004)}
}
@keyframes spCore{
  0%,100%{transform:scale(.84);opacity:.40}
  8%     {transform:scale(1.14);opacity:1}
  36%    {transform:scale(.92);opacity:.58}
}
@keyframes spSpin{to{transform:rotate(360deg)}}
@keyframes spCrawl{to{stroke-dashoffset:-16}}
@keyframes spFire{
  0%,100%{opacity:.30;transform:scale(.88)}
  5%     {opacity:1;transform:scale(1.45)}
  20%    {opacity:.36;transform:scale(.95)}
}
@keyframes spScan{0%{transform:translateY(0)}62%{transform:translateY(214px)}100%{transform:translateY(214px)}}
@keyframes spIrisA{0%,100%{transform:scale(.5)}12%{transform:scale(1)}34%{transform:scale(1)}44%{transform:scale(.5)}}
@keyframes spIrisM{0%,6%{transform:scale(1)}14%{transform:scale(.5)}46%{transform:scale(.5)}58%{transform:scale(1)}}

@media(prefers-reduced-motion:reduce){
  .sp-heart,.sp-heart *{animation:none!important}
  .sp-core{opacity:.8}.sp-node{opacity:.95}
}`);

patch('splash: it holds still when motion is reduced',
`@media(prefers-reduced-motion:reduce){
  .sp-trace{animation:none;stroke-dashoffset:0;opacity:1}
  .sp-word,.sp-sub{animation:none}
}`,
`@media(prefers-reduced-motion:reduce){
  .sp-trace{animation:none;stroke-dashoffset:0;opacity:1}
  .sp-word,.sp-sub{animation:none}
}`);

fs.writeFileSync(OUT, html);
console.log(`Mechanistic splash heart applied — ${applied.length} edits`);
applied.forEach(a => console.log('  \u2713 ' + a));
console.log(`written: ${OUT}`);
