#!/usr/bin/env node
/*
 * Startup pass — a loading screen that covers the parse, and a background
 * that beats instead of just drifting.
 *
 *   node scripts/splash-patch.js <polish-output.html> <output.html>
 *
 * WHY A SPLASH, measured rather than assumed. A 25 MB single file takes real
 * time to parse. On this build:
 *
 *     CPU 1x   first-paint  56ms   first *contentful* paint  ~1330ms
 *     CPU 4x   first-paint 108ms   first *contentful* paint   5468ms
 *
 * The browser paints the page background almost immediately and then shows
 * nothing at all until the script finishes. On an iPad that is five and a
 * half seconds of blank screen on every cold open. That window is the whole
 * justification for this pass.
 *
 * Two consequences follow, and they drive the design:
 *   - The splash must be plain HTML + CSS sitting BEFORE the <script>, so it
 *     paints in the ~100ms first-paint rather than waiting on the same parse
 *     it exists to cover.
 *   - It must NOT use Heart3D. Meshing the anatomy is part of what we are
 *     waiting for, so putting the 3D heart on the loading screen would be
 *     precisely self-defeating. An SVG rhythm strip costs nothing and is
 *     more on-subject anyway.
 *
 * The theme is adopted from storage by a tiny inline script before the
 * splash paints, so a user who has chosen light or dark does not get a flash
 * of the system theme first.
 *
 * BACKGROUND: the hero already carries an aurora, drifting on a 26s cycle.
 * That is atmosphere, not cardiology. This adds one more layer pulsing at
 * 68 bpm — the rate the hero's own trace opens on — so the background is
 * tied to the subject. It is deliberately confined to the hero and the
 * splash: an animated background behind a question stem competes with
 * reading and burns battery through a long session, which is the opposite
 * of what a study tool should do.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) {
  console.error('usage: node scripts/splash-patch.js <polish-output.html> <output.html>');
  process.exit(1);
}

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];

function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) {
    throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  }
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* A four-beat rhythm strip, built rather than hand-typed so the waves stay
   consistent beat to beat. Baseline 100, R to 42, S to 120 — inside a
   0 0 640 160 viewBox with room for the stroke and its glow. */
function ecgPath() {
  const BEATS = 4, W = 160, y = 100;
  let d = '';
  for (let i = 0; i < BEATS; i++) {
    const X = i * W;
    d += (i === 0 ? `M${X},${y}` : `L${X},${y}`)
       + `L${X + 26},${y}`
       + `Q${X + 37},${y - 15} ${X + 48},${y}`          // P
       + `L${X + 62},${y}`
       + `L${X + 67},${y + 9}`                          // Q
       + `L${X + 73},${y - 58}`                         // R
       + `L${X + 79},${y + 20}`                         // S
       + `L${X + 85},${y}`
       + `L${X + 99},${y}`
       + `Q${X + 113},${y - 26} ${X + 127},${y}`        // T
       + `L${X + W},${y}`;
  }
  return d;
}
const STRIP = ecgPath();

/* ────────────────────────────────────────────────────────────────────────────
 * 1. Markup — before <div id="shell">, so it is in the very first paint.
 *    pointer-events:none throughout: it is purely decorative, and a
 *    full-screen overlay that can swallow a tap is a bug waiting to happen.
 * ──────────────────────────────────────────────────────────────────────────── */
patch('splash: theme adoption + markup, ahead of the script',
`<div id="shell">`,
`<script>/* Adopt the saved theme before anything paints, so choosing light or
   dark does not mean a flash of the system one on every cold open. Inline and
   tiny on purpose — it has to run ahead of the 25 MB below. */
try{var _t=(JSON.parse(localStorage.getItem('accsap12.v2')||'{}')||{}).theme;
    if(_t&&_t!=='auto')document.documentElement.setAttribute('data-theme',_t);}catch(_e){}</script>
<div id="splash" role="status" aria-label="Loading ACCSAP 12">
  <div class="sp-in">
    <svg class="sp-strip" viewBox="0 0 640 160" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path class="sp-base" d="${STRIP}"/>
      <path class="sp-trace" pathLength="1" d="${STRIP}"/>
    </svg>
    <div class="sp-word">ACCSAP 12</div>
    <div class="sp-sub">Cardiology board review</div>
  </div>
</div>
<div id="shell">`);

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Splash CSS. Anchored to the live-hero block so it lands in the same
 *    part of the stylesheet as the rest of the cardiac UI.
 * ──────────────────────────────────────────────────────────────────────────── */
patch('css: the splash',
`/* ── live hero ── */`,
`/* ── startup ──
   Covers the parse window measured in this script's header. Everything here
   is HTML + CSS on purpose: it has to paint before the script it is hiding. */
#splash{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;
  background:var(--bg);pointer-events:none;
  transition:opacity .42s ease,visibility .42s ease}
#splash.gone{opacity:0;visibility:hidden}
.sp-in{display:flex;flex-direction:column;align-items:center;padding:24px}
.sp-strip{width:min(420px,72vw);height:auto;overflow:visible}
.sp-base{fill:none;stroke:var(--teal);stroke-width:2;opacity:.14;
  stroke-linecap:round;stroke-linejoin:round}
.sp-trace{fill:none;stroke:var(--teal2);stroke-width:2.6;
  stroke-linecap:round;stroke-linejoin:round;
  filter:drop-shadow(0 0 6px rgba(45,212,191,.55));
  stroke-dasharray:1;stroke-dashoffset:1;
  animation:spSweep 2.4s cubic-bezier(.4,0,.5,1) infinite}
/* pathLength="1" on the path means the dash units are fractions of the whole
   trace, so the sweep does not need the real path length measured */
@keyframes spSweep{
  0%{stroke-dashoffset:1;opacity:0}
  5%{opacity:1}
  74%{stroke-dashoffset:0;opacity:1}
  93%{stroke-dashoffset:0;opacity:0}
  100%{stroke-dashoffset:1;opacity:0}
}
.sp-word{font-size:clamp(26px,6vw,38px);font-weight:760;letter-spacing:-.03em;
  color:var(--text);margin-top:12px;animation:spRise .7s .10s both ease-out}
.sp-sub{font-family:var(--font-mono);font-size:11.5px;letter-spacing:.14em;
  text-transform:uppercase;color:var(--dim);margin-top:4px;
  animation:spRise .7s .24s both ease-out}
@keyframes spRise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){
  .sp-trace{animation:none;stroke-dashoffset:0;opacity:1}
  .sp-word,.sp-sub{animation:none}
}

/* ── live hero ── */`);

/* ────────────────────────────────────────────────────────────────────────────
 * 3. The heartbeat layer on the hero. Sits above the aurora (z-index -2) and
 *    below the ECG canvas (0); .hero-live already sets isolation:isolate, so
 *    the negative index stays inside the hero's own stacking context.
 * ──────────────────────────────────────────────────────────────────────────── */
patch('css: a hero background that beats rather than only drifting',
`.hero-ecg{position:absolute;left:0;right:0;bottom:0;height:62px;width:100%;`,
`/* The aurora above drifts on a 26 second cycle — atmospheric, but nothing to
   do with the heart. This layer pulses at 68 bpm, the rate the hero's own
   trace opens on, so the background belongs to the subject instead of just
   being weather behind it. Confined to the hero deliberately: the same effect
   behind a question stem would compete with reading. */
.hero-live::after{content:'';position:absolute;inset:-25%;z-index:-1;pointer-events:none;
  background:radial-gradient(38% 42% at 32% 62%,rgba(45,212,191,.17),transparent 62%);
  animation:heroBeat 1.76s ease-out infinite}
@keyframes heroBeat{
  0%{transform:scale(.94);opacity:.45}
  9%{transform:scale(1.04);opacity:.85}
  22%{transform:scale(.99);opacity:.60}
  32%{transform:scale(1.02);opacity:.70}
  46%,100%{transform:scale(.94);opacity:.45}
}
@media(prefers-reduced-motion:reduce){.hero-live::after{animation:none}}

.hero-ecg{position:absolute;left:0;right:0;bottom:0;height:62px;width:100%;`);

/* ────────────────────────────────────────────────────────────────────────────
 * 4. Dismissal. render() has already run by the time boot() does, so there is
 *    a real frame underneath to reveal — no need to wait on anything further.
 * ──────────────────────────────────────────────────────────────────────────── */
patch('boot: reveal the app once the first render is on screen',
`(function boot(){
  requestPersistence();`,
`/* One frame's grace so the reveal lands on a painted screen rather than
   racing it, then fade and remove — leaving the node in place would keep a
   full-screen element alive over the app for no reason. */
function dismissSplash(){
  const sp=document.getElementById('splash');
  if(!sp) return;
  requestAnimationFrame(()=>{
    sp.classList.add('gone');
    setTimeout(()=>{ if(sp.parentNode) sp.remove(); },520);
  });
}
(function boot(){
  dismissSplash();
  requestPersistence();`);

/* ──────────────────────────────────────────────────────────────────────────── */
fs.writeFileSync(OUT, html);
const before = fs.statSync(SRC).size, after = fs.statSync(OUT).size;
console.log(`Startup pass applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`\n${(before / 1048576).toFixed(2)} MB → ${(after / 1048576).toFixed(2)} MB`);
console.log(`written: ${OUT}`);
