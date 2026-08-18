#!/usr/bin/env node
/*
 * A crystal heart on the startup screen, beating over the ECG sweep.
 *
 *   node scripts/splash-heart-patch.js <home-output.html> <output.html>
 *
 * The splash already draws a sweeping rhythm strip. This adds the heart above
 * it — a faceted crystal one, with a specular glint, a glow disc behind it, and
 * a beat.
 *
 * IT IS SVG AND CSS, ON PURPOSE. The obvious thing would be to show the app's
 * real WebGL heart here. It is exactly the wrong thing: meshing that heart is
 * part of what the splash is covering for, so putting it ON the splash would
 * mean waiting for the load in order to show the loading screen. So the splash
 * heart is drawn with gradients and clipped polygons — it costs nothing, paints
 * on the first frame, and asks nothing of the megabytes still parsing below it.
 * The real heart takes over the moment the app is ready.
 *
 * It reads on every theme because it carries its own translucent crystal
 * palette and sits on its own glow, rather than borrowing the page's colours —
 * so it looks like cut glass on Parchment's cream and on Nocturne's near-black
 * alike.
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

/* The crystal heart, as inline SVG. viewBox 0 0 120 120; a heart clip, eight
   facets radiating from the centre for the cut-gem look, a bright rim, and a
   specular highlight on the upper-left lobe. */
const CRYSTAL = `<svg class="sp-heart" viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <radialGradient id="spGlowG" cx="50%" cy="46%" r="52%">
          <stop offset="0%" stop-color="#5EEAD4" stop-opacity=".55"/>
          <stop offset="45%" stop-color="#38BDF8" stop-opacity=".22"/>
          <stop offset="100%" stop-color="#38BDF8" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="spBaseG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#A7F3EB" stop-opacity=".5"/>
          <stop offset="100%" stop-color="#0EA5B8" stop-opacity=".5"/>
        </linearGradient>
        <clipPath id="spHeartClip">
          <path d="M60,106 C26,80 12,58 12,40 C12,22 28,13 43,19 C52,23 58,30 60,38
                   C62,30 68,23 77,19 C92,13 108,22 108,40 C108,58 94,80 60,106 Z"/>
        </clipPath>
        <filter id="spBlur" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3.2"/>
        </filter>
      </defs>
      <circle class="sp-heart-glow" cx="60" cy="55" r="56" fill="url(#spGlowG)"/>
      <g clip-path="url(#spHeartClip)">
        <rect x="0" y="0" width="120" height="120" fill="url(#spBaseG)"/>
        <polygon points="60,54 12,42 30,18"  fill="#38BDF8" fill-opacity=".34"/>
        <polygon points="60,54 30,18 60,33"  fill="#2DD4BF" fill-opacity=".50"/>
        <polygon points="60,54 60,33 90,18"  fill="#5EEAD4" fill-opacity=".40"/>
        <polygon points="60,54 90,18 108,42" fill="#38BDF8" fill-opacity=".30"/>
        <polygon points="60,54 108,42 90,72" fill="#2DD4BF" fill-opacity=".44"/>
        <polygon points="60,54 90,72 60,106" fill="#0E7C86" fill-opacity=".50"/>
        <polygon points="60,54 60,106 30,72" fill="#12909B" fill-opacity=".46"/>
        <polygon points="60,54 30,72 12,42"  fill="#2DD4BF" fill-opacity=".38"/>
        <ellipse class="sp-heart-glint" cx="41" cy="34" rx="9" ry="14" transform="rotate(-32 41 34)"
          fill="#FFFFFF" fill-opacity=".6" filter="url(#spBlur)"/>
      </g>
      <path class="sp-heart-rim" d="M60,106 C26,80 12,58 12,40 C12,22 28,13 43,19 C52,23 58,30 60,38
              C62,30 68,23 77,19 C92,13 108,22 108,40 C108,58 94,80 60,106 Z"/>
    </svg>`;

patch('splash: the crystal heart above the strip',
`  <div class="sp-in">
    <svg class="sp-strip"`,
`  <div class="sp-in">
    ${CRYSTAL}
    <svg class="sp-strip"`);

patch('splash: the crystal heart styles',
`.sp-in{display:flex;flex-direction:column;align-items:center;padding:24px}`,
`.sp-in{display:flex;flex-direction:column;align-items:center;padding:24px}
.sp-heart{width:min(150px,34vw);height:auto;overflow:visible;margin-bottom:14px;
  transform-box:fill-box;transform-origin:center;
  animation:spBeat .92s ease-in-out infinite, spRise .8s both ease-out}
.sp-heart-rim{fill:none;stroke:#7FF0DE;stroke-width:1.5;stroke-linejoin:round;
  filter:drop-shadow(0 0 5px rgba(94,234,212,.7))}
.sp-heart-glow{transform-box:fill-box;transform-origin:center;
  animation:spHeartGlow .92s ease-in-out infinite}
@keyframes spBeat{
  0%,100%{transform:scale(1)}
  9%{transform:scale(1.07)}
  20%{transform:scale(.99)}
  32%{transform:scale(1.025)}
  48%{transform:scale(1)}
}
@keyframes spHeartGlow{
  0%,100%{opacity:.5}
  9%{opacity:1}
  40%{opacity:.62}
}`);

patch('splash: the heart holds still when motion is reduced',
`@media(prefers-reduced-motion:reduce){
  .sp-trace{animation:none;stroke-dashoffset:0;opacity:1}
  .sp-word,.sp-sub{animation:none}
}`,
`@media(prefers-reduced-motion:reduce){
  .sp-trace{animation:none;stroke-dashoffset:0;opacity:1}
  .sp-word,.sp-sub{animation:none}
  .sp-heart{animation:none}
  .sp-heart-glow{animation:none;opacity:.7}
}`);

fs.writeFileSync(OUT, html);
console.log(`Crystal splash heart applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
