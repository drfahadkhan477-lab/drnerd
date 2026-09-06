#!/usr/bin/env node
/*
 * A pearl is a whole thought, carried on a current.
 *
 *   node scripts/pearlrich-patch.js <input.html> <output.html>
 *
 * TWO COMPLAINTS, ONE STEP, because they are the same complaint from opposite
 * ends: the pearls were too small, and the thing sharing their box was too
 * loud for what little room was left.
 *
 * THE LENGTH RULES LIVE IN src/core/pearl.js and are changed there — MIN 55
 * to 90, MAX 210 to 700, and a pearl may now be a run of up to three
 * consecutive sentences within one paragraph. Measured over the 146 notes
 * shipped at the time, that takes the corpus from 96 pearls with a median of
 * 143 characters to 133 with a median of 295 — the shelf has since grown to
 * 295 notes and 273 pearls, which does not change the ratio this measured.
 * Read that file's header for why length was never what made a pearl
 * memorable — Pearl.steps() is, and it now has something worth breaking up.
 *
 * THE PV LOOP GOES. It was a good drawing in the wrong place: 104px square,
 * pinned to the bottom-right of the prose column, competing with the words for
 * a corner and winning. In its place the card gets a full-width ECG trace
 * BEHIND the text, with a bright head running along it and a decaying tail
 * behind — current moving through a conductor, which is what an ECG is.
 *
 * NOTHING NEW IS INVENTED FOR IT. The waveform is rhythmMV(), the same
 * generator the hero strip and the rhythm lab already use, so the trace is a
 * real sinus rhythm rather than a decorative squiggle. The travelling-head
 * mechanic is lifted from the PV loop it replaces — that part was always the
 * good bit — and pointed along a strip instead of around a loop.
 *
 * IT MUST NOT FIGHT THE WORDS, and that is a number rather than an opinion.
 * The trace paints under the prose at a low alpha taken from the theme's own
 * accent, and the text keeps full --text contrast on top; the check in
 * verify-pearl measures the contrast ratio of the pearl text against the card
 * with the trace painted, in all eight themes, and fails under 4.5:1.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/pearlrich-patch.js <input.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}
function cut(label, from, to) {
  const a = html.indexOf(from);
  if (a < 0 || html.indexOf(from, a + 1) > -1) throw new Error(`[${label}] start anchor not unique`);
  const b = html.indexOf(to, a);
  if (b < 0) throw new Error(`[${label}] end anchor not found`);
  html = html.slice(0, a) + html.slice(b + to.length);
  applied.push(label);
}

/* ── 1. the module, re-embedded with the new length rules ────────────────── */
{
  const mod = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'pearl.js'), 'utf8');
  const head = '/* ═══════════════════════════════════════════════════════════════════════════\n   pearl.js';
  const tail = "})(typeof window !== 'undefined' ? window : this);";
  const a = html.indexOf(head);
  if (a < 0) throw new Error('pearlrich: pearl.js is not in this build — did pearl-patch run?');
  const b = html.indexOf(tail, a);
  if (b < 0) throw new Error('pearlrich: could not find the end of the embedded pearl.js');
  html = html.slice(0, a) + mod.trim() + html.slice(b + tail.length);
  applied.push('pearlrich: the length rules, from src/core/pearl.js');
}

/* ── 2. the PV loop's markup and styles come out ─────────────────────────── */
patch('pearlrich: the corner loop leaves the card',
`          <canvas id="pearlPV" class="pearl-pv" aria-hidden="true"
            title="Left ventricular pressure against volume, one cycle"></canvas>`,
``);

patch('pearlrich: and a full-width trace goes in behind the words',
`      return \`<div class="pearl-card" id="pearlCard">
        <div class="pearl-rule"></div>`,
`      return \`<div class="pearl-card" id="pearlCard">
        <canvas id="pearlCurrent" class="pearl-current" aria-hidden="true"></canvas>
        <div class="pearl-rule"></div>`);

cut('pearlrich: the loop\'s own styles',
`.pearl-pv{position:absolute;right:18px;bottom:16px;width:104px;height:104px;`,
`@media(max-width:640px){.pearl-pv{width:82px;height:82px;right:12px;bottom:12px}}`);

patch('pearlrich: the trace sits behind everything the card holds',
`.pearl-pv{z-index:0}`,
`/* Behind the words, edge to edge, and never in the way of a tap. The prose
   columns are lifted above it rather than the trace being pushed down, so a
   long pearl scrolling inside its column still passes over the current. */
.pearl-current{position:absolute;inset:0;width:100%;height:100%;
  z-index:0;pointer-events:none;opacity:.8}
.pearl-main,.pearl-rule,.pearl-fig{position:relative;z-index:1}`);

/* ── 3. the renderer ─────────────────────────────────────────────────────── */
patch('pearlrich: current, not a loop',
`let pearlPV=null;
function mountPearlPV(){`,
`/* The raf handle for whatever the card is animating. Named for the trace now
   that the pressure-volume loop it used to hold has gone. */
let pearlTrace=null;
/* ═══════════ the pearl's current ═══════════
   An ECG trace across the whole card with a bright head travelling along it
   and a fading tail behind — what current looks like on a monitor.

   The waveform is rhythmMV(), the generator the hero strip and the rhythm lab
   already share, so this is a real sinus rhythm at a real rate rather than a
   decorative wave. The travelling head is the mechanic from the pressure-volume
   loop this replaces, which was the part worth keeping.

   IT IS BACKGROUND. Everything here is tuned to stay under the words: the
   resting trace is faint, the head is small, and the whole canvas is capped in
   opacity by CSS as well. prefers-reduced-motion gets the trace with no head
   moving along it, because a still line is still worth looking at. */
function mountPearlCurrent(){
  if(pearlTrace){ cancelAnimationFrame(pearlTrace.raf); pearlTrace=null; }
  const cv=document.getElementById('pearlCurrent'); if(!cv) return;
  if(typeof rhythmMV!=='function') return;
  const ctx=cv.getContext('2d'); if(!ctx) return;

  const still=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches);
  const SPAN=4200;            // ms of rhythm across the card's width
  const state={raf:0}; let t0=0;

  function paint(now){
    const r=cv.getBoundingClientRect();
    if(!r.width||!r.height){ state.raf=requestAnimationFrame(paint); return; }
    const dpr=Math.min(window.devicePixelRatio||1,3);
    const w=Math.round(r.width*dpr), h=Math.round(r.height*dpr);
    if(cv.width!==w||cv.height!==h){ cv.width=w; cv.height=h; }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,r.width,r.height);

    /* Sampled per device pixel column, so the QRS stays a spike rather than
       being aliased into a bump on a wide card. */
    const N=Math.max(120,Math.min(1400,Math.round(r.width)));
    /* LOW IN THE CARD, AND SMALL. The trace is the card's pulse along its foot,
       not a wash across the prose — measured, a full-height trace at a readable
       brightness dropped the text contrast to 2.1:1 on the darker palettes. */
    const baseline=r.height*0.87;
    const amp=Math.min(r.height*0.13,34);
    const st={};
    const pts=new Array(N+1);
    for(let i=0;i<=N;i++){
      const x=i/N*r.width;
      pts[i]=[x, baseline-rhythmMV('sinus', i/N*SPAN, st)*amp];
    }

    const css=getComputedStyle(document.documentElement);
    const accent=(css.getPropertyValue('--teal')||'#0284C7').trim();
    /* A DARK THEME NEEDS A SMALLER BUDGET, and it is not obvious which way
       round. On a light card the text is near-black and a bright accent stroke
       stays far from it; on a dark card the text is near-white and the same
       bright accent moves TOWARD the text, so contrast collapses. Measured on
       the three darkest palettes it fell to 3.5:1 at the alphas that read
       correctly on Daylight. One factor, applied to every alpha below. */
    const K=(typeof themeIsDark==='function' && themeIsDark()) ? 0.5 : 1;
    ctx.lineJoin='round'; ctx.lineCap='round';
    ctx.strokeStyle=accent; ctx.fillStyle=accent;

    /* Every alpha here is budgeted against a contrast measurement, not chosen
       by eye: verify-pearl composites the brightest pixel this canvas paints
       over the card and fails the build under 4.5:1 in any of the eight
       themes. Raising any of them means re-running that check. */
    ctx.globalAlpha=.16*K; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]);
    for(let i=1;i<=N;i++) ctx.lineTo(pts[i][0],pts[i][1]);
    ctx.stroke();

    if(still){ ctx.globalAlpha=1; return; }

    if(!t0) t0=now;
    const u=((now-t0)%5200)/5200;
    const head=Math.max(1,Math.floor(u*N));
    const trail=Math.max(10,Math.round(N*0.13));
    ctx.lineWidth=2.1;
    for(let k=0;k<trail;k++){
      const i=head-k; if(i<1) break;
      ctx.globalAlpha=(1-k/trail)*0.30*K;
      ctx.beginPath();
      ctx.moveTo(pts[i-1][0],pts[i-1][1]);
      ctx.lineTo(pts[i][0],pts[i][1]);
      ctx.stroke();
    }
    const hp=pts[head];
    ctx.globalAlpha=.42*K;
    ctx.beginPath(); ctx.arc(hp[0],hp[1],2.2,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=.09*K;
    ctx.beginPath(); ctx.arc(hp[0],hp[1],6.5,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=1;
    state.raf=requestAnimationFrame(paint);
  }
  state.raf=requestAnimationFrame(paint);
  pearlTrace=state;
}
function mountPearlPV(){`);

/* The old renderer is left defined but unreferenced would be dead code, so it
   goes: its markup and its styles are already gone above. */
cut('pearlrich: and the loop renderer with them',
`function mountPearlPV(){
  if(pearlPV){ cancelAnimationFrame(pearlPV.raf); pearlPV=null; }
  const cv=document.getElementById('pearlPV'); if(!cv) return;`,
`  state.raf=requestAnimationFrame(paint);
  pearlPV=state;
}
`);

patch('pearlrich: mount the current where the loop was mounted',
`function mountHero(){
  mountPearlPV();`,
`function mountHero(){
  mountPearlCurrent();`);

fs.writeFileSync(OUT, html);
console.log(`A whole thought, on a current — ${applied.length} edits applied`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
