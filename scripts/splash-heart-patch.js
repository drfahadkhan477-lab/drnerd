#!/usr/bin/env node
/*
 * A Lottie heart on the startup screen.
 *
 *   node scripts/splash-heart-patch.js <home-output.html> <output.html>
 *
 * WHAT CHANGED, AND WHY. This used to be a heart drawn by hand in SVG paths
 * and animated with CSS keyframes — an "instrument, not an organ" reading of
 * the reference the app's owner supplied. It read as a heart, but it read as
 * a FLAT one: CSS keyframes interpolate linearly between the frames you write,
 * and a hand-authored gradient is one fixed light source with no depth. A
 * real illustrator's tool — proper gradient meshes, bezier-eased keyframes on
 * every property, a trim-path primitive built for exactly "light travelling
 * along a curve" — gets closer to what the reference actually looked like,
 * and Lottie is that tool's native export format. This heart is authored the
 * same way: as data (Python generates the keyframed vector geometry — see
 * scripts/gen-splash-heart.py, kept outside the repo, and assets/splash-heart/
 * carries its output), not hand-drawn, but the RESULT is a real Lottie file
 * rather than a bespoke animation format, so it opens in Lottie tooling, can
 * be swapped for an After-Effects export later, and is portable if this app
 * ever wants the same heart somewhere else.
 *
 * TWO DELIVERY PATHS, BECAUSE THE BUDGETS ARE DIFFERENT. The Lottie player is
 * 168 KB and the animation JSON is 23 KB — irrelevant next to a single-file
 * build that is tens of megabytes already, but real money against the split
 * PWA shell, which verify-pwa holds under 800 KB and which had 720 KB used
 * before this patch. So:
 *
 *   - the single-file build gets both inlined and mounted synchronously,
 *     because "paints before the megabytes below it parse" is still the
 *     whole point of a splash and nothing here should compromise that;
 *   - build-pwa.js pulls the same two blobs back OUT into content/splash-heart/
 *     and replaces the inline scripts with a fetch-and-mount loader, so the
 *     shell stays the size it earned. The splash's static parts (background,
 *     wordmark, ECG sweep) still show instantly either way; only the animated
 *     heart itself arrives a beat later on the split build.
 *
 * WHAT WAS KEPT FROM THE OLD VERSION. The composition — a lit instrument
 * plate behind an anatomical anterior-view heart, HUD leader lines, a
 * coronary tree with travelling light — and the principle that it carries its
 * own ground so it reads the same on Parchment's cream as on Nocturne's
 * near-black. Only the authoring technique and the file format changed.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/splash-heart-patch.js <home-output.html> <output.html>'); process.exit(1); }

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets', 'splash-heart');
const LOTTIE_JS = fs.readFileSync(path.join(ASSETS, 'lottie.min.js'), 'utf8');
const HEART_JSON = fs.readFileSync(path.join(ASSETS, 'heart.json'), 'utf8');
JSON.parse(HEART_JSON);   // fail loudly here, not three build steps later

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 200)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* The mount point, above the ECG sweep exactly where the hand-drawn heart
   used to sit. Marked with data-splash-heart so build-pwa.js can find the two
   script blocks that follow it without depending on this comment surviving. */
patch('splash: the Lottie mount point above the strip',
`  <div class="sp-in">
    <svg class="sp-strip"`,
`  <div class="sp-in">
    <div class="sp-heart-mount" id="spHeartMount" aria-hidden="true"></div>
    <script id="spHeartLib" data-splash-heart="lib">${LOTTIE_JS}</script>
    <script id="spHeartData" data-splash-heart="data" type="application/json">${HEART_JSON}</script>
    <script data-splash-heart="mount">
      (function(){
        var el = document.getElementById('spHeartMount');
        if(!el || typeof lottie === 'undefined') return;
        var data = JSON.parse(document.getElementById('spHeartData').textContent);
        var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
        var anim = lottie.loadAnimation({
          container: el, renderer: 'svg', loop: true, autoplay: !reduce, animationData: data,
        });
        if(reduce) anim.goToAndStop(0, true);
      })();
    </script>
    <svg class="sp-strip"`);

patch('splash: its container sizing',
`.sp-in{display:flex;flex-direction:column;align-items:center;padding:24px}`,
`.sp-in{display:flex;flex-direction:column;align-items:center;padding:24px}
.sp-heart-mount{width:min(310px,66vw);height:min(310px,66vw);margin-bottom:16px;
  animation:spRise 1s both cubic-bezier(.2,.7,.3,1)}
.sp-heart-mount svg{display:block;width:100%;height:100%;overflow:visible;
  filter:drop-shadow(0 18px 46px rgba(3,12,24,.5))}
@keyframes spRise{from{opacity:0;transform:translateY(16px) scale(.94)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.sp-heart-mount{animation:none}}`);

fs.writeFileSync(OUT, html);
console.log(`Lottie splash heart applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`  lottie.min.js  ${(LOTTIE_JS.length / 1024).toFixed(1)} KB`);
console.log(`  heart.json     ${(HEART_JSON.length / 1024).toFixed(1)} KB`);
console.log(`written: ${OUT}`);
