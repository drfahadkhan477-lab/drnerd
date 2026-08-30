#!/usr/bin/env node
/*
 * The pearl gets a pressure–volume loop, and room to breathe.
 *
 *   node scripts/pvloop-patch.js <input.html> <output.html>
 *
 * The trace along the pearl's foot was the same rhythm strip that runs behind
 * the hero, forty pixels tall. Two ECG strips on one screen is one too many —
 * the second reads as a repeat of the first rather than as anything of its own
 * — and a strip is a poor shape for a corner, being all width.
 *
 * WHAT REPLACED IT, AND WHAT DID NOT. The first attempt was a
 * vectorcardiogram: this app builds its twelve leads from one dipole, and a
 * lead is that dipole projected onto an axis, so plotting the vector itself
 * should give the P, QRS and T loops. It does not. The dipole here is three
 * Gaussians in fixed directions, well separated in time, so the vector goes
 * out along the free-wall direction and comes back along it — a needle, not a
 * loop. All three planes were tried and measured; the best filled 85 cells of
 * a 56×26 grid against the pressure–volume loop's 153. A real VCG is fat
 * because the wavefront rotates continuously, and this model does not rotate.
 * It was not worth shipping a needle and calling it a vector loop.
 *
 * The pressure–volume loop is the better answer anyway. It is the single most
 * recognisable figure in cardiac physiology; it is a genuinely closed, fat
 * curve with four limbs a fellow can name — isovolumic contraction up the
 * left, ejection across the top, isovolumic relaxation down the right, filling
 * along the bottom; and this app already computes it. Physio.lvPressure() and
 * Physio.lvVolume() are the same functions the cardiac-cycle screen plots, so
 * this is the app's own physiology drawn small, not an animation invented to
 * look cardiac. The loop that appears here is the loop on that screen.
 *
 * WHAT MOVES. The whole loop is always drawn, faintly, so its shape is legible
 * at a glance rather than assembling itself over three seconds. A bright head
 * walks it counterclockwise with a short trail, one circuit every 3.4s —
 * slower than a real cycle on purpose, because this sits beside a sentence
 * meant to be read. Phase advances linearly, which means the head genuinely
 * races up the isovolumic limbs and slows through filling, exactly as the
 * ventricle does. Under prefers-reduced-motion it is drawn once and left.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/pvloop-patch.js <input.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── 1. the canvas ───────────────────────────────────────────────────────── */
patch('pearl: a loop where the strip was',
`          <canvas id="pearlECG" class="pearl-ecg" aria-hidden="true"></canvas>`,
`          <canvas id="pearlPV" class="pearl-pv" aria-hidden="true"
            title="Left ventricular pressure against volume, one cycle"></canvas>`);

/* ── 2. what draws it ────────────────────────────────────────────────────── */
patch('pearl: draw the cardiac cycle the app already computes',
`/* The same ECGMonitor the hero runs, deliberately: a second animation written
   for the pearl would be a second thing to keep beating, and the two would
   drift apart on the same screen. Slower and shallower, because this one sits
   under prose and must not compete with the sentence above it. */
let pearlMon=null;
function mountPearlECG(){
  if(pearlMon){ pearlMon.destroy(); pearlMon=null; }
  const cv=document.getElementById('pearlECG');
  if(!cv||typeof ECGMonitor==='undefined') return;
  const accent=(getComputedStyle(document.documentElement).getPropertyValue('--teal')||'#5EEAD4').trim();
  pearlMon=new ECGMonitor(cv,{kind:'sinus',speed:0.07,amp:13,lineWidth:1.6,color:accent});
  pearlMon.start();
}`,
`/* THE APP'S OWN PHYSIOLOGY, DRAWN SMALL. Physio.lvPressure(t) and
   Physio.lvVolume(t) over one normalised cycle are the pressure–volume loop —
   the same pair of functions the cardiac-cycle screen plots, so the loop in
   this corner is the loop on that screen and cannot drift from it.

   Four limbs, counterclockwise: isovolumic contraction up the left at constant
   volume, ejection across the top as volume falls, isovolumic relaxation down
   the right, filling along the bottom. Phase advances linearly, so the head
   races the isovolumic limbs and slows through filling the way the ventricle
   does — the timing is the model's, not an easing curve. */
let pearlPV=null;
function mountPearlPV(){
  if(pearlPV){ cancelAnimationFrame(pearlPV.raf); pearlPV=null; }
  const cv=document.getElementById('pearlPV'); if(!cv) return;
  const P=(typeof Physio!=='undefined')?Physio:null;
  if(!P||typeof P.lvPressure!=='function'||typeof P.lvVolume!=='function') return;
  const ctx=cv.getContext('2d'); if(!ctx) return;

  const N=240, pts=[];
  for(let i=0;i<=N;i++){ const t=i/N; pts.push([P.lvVolume(t), P.lvPressure(t)]); }
  let vLo=1e9,vHi=-1e9,qLo=1e9,qHi=-1e9;
  for(const [v,q] of pts){ if(v<vLo)vLo=v; if(v>vHi)vHi=v; if(q<qLo)qLo=q; if(q>qHi)qHi=q; }
  const vSpan=(vHi-vLo)||1, qSpan=(qHi-qLo)||1;

  const still=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches);
  const state={raf:0}; let t0=0;

  function paint(now){
    const r=cv.getBoundingClientRect();
    if(!r.width||!r.height){ state.raf=requestAnimationFrame(paint); return; }
    /* Backed at device-pixel density like every other canvas here: a loop is
       nothing but curves, and curves are where a 1x backing store shows. */
    const dpr=Math.min(window.devicePixelRatio||1,3);
    const w=Math.round(r.width*dpr), h=Math.round(r.height*dpr);
    if(cv.width!==w||cv.height!==h){ cv.width=w; cv.height=h; }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,r.width,r.height);

    const pad=7;
    const X=v=>pad+(v-vLo)/vSpan*(r.width-pad*2);
    const Y=q=>r.height-pad-(q-qLo)/qSpan*(r.height-pad*2);
    const teal=(getComputedStyle(document.documentElement).getPropertyValue('--teal')||'#0284C7').trim();
    ctx.strokeStyle=teal; ctx.fillStyle=teal; ctx.lineJoin='round'; ctx.lineCap='round';

    /* The whole loop, always. One that assembles itself over three seconds is
       one you cannot read for three seconds. */
    ctx.globalAlpha=.34; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(X(pts[0][0]),Y(pts[0][1]));
    for(let i=1;i<pts.length;i++) ctx.lineTo(X(pts[i][0]),Y(pts[i][1]));
    ctx.closePath(); ctx.stroke();

    if(still){ ctx.globalAlpha=1; return; }

    if(!t0) t0=now;
    const u=((now-t0)%3400)/3400;
    const head=Math.max(1,Math.floor(u*N));
    const trail=Math.max(6,Math.round(N*0.16));
    ctx.lineWidth=2.2;
    for(let k=0;k<trail;k++){
      const i=head-k; if(i<1) break;
      ctx.globalAlpha=(1-k/trail)*0.95;
      ctx.beginPath();
      ctx.moveTo(X(pts[i-1][0]),Y(pts[i-1][1]));
      ctx.lineTo(X(pts[i][0]),Y(pts[i][1]));
      ctx.stroke();
    }
    const hp=pts[head];
    ctx.globalAlpha=1;
    ctx.beginPath(); ctx.arc(X(hp[0]),Y(hp[1]),2.7,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=.22;
    ctx.beginPath(); ctx.arc(X(hp[0]),Y(hp[1]),6.5,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=1;
    state.raf=requestAnimationFrame(paint);
  }
  state.raf=requestAnimationFrame(paint);
  pearlPV=state;
}`);

patch('pearl: mount the loop where the strip was mounted',
`function mountHero(){
  mountPearlECG();`,
`function mountHero(){
  mountPearlPV();`);

/* ── 3. how it sits, and room around the words ───────────────────────────────
   Anchored on the rules rather than the comments above them: a comment gets
   reworded, and a find string containing prose is one that breaks when the
   prose is improved. */
patch('pearl: the loop takes the corner the strip took the width of',
`.pearl-ecg{position:absolute;left:0;right:0;bottom:0;width:100%;height:42px;
  pointer-events:none;opacity:.5;
  -webkit-mask-image:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent);
  mask-image:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)}`,
`/* Bottom-right of the PROSE column, not of the whole card, so on a wide screen
   it sits under the sentence rather than over the figure beside it. Square,
   because a loop is — which is the whole point of replacing a strip with one. */
.pearl-pv{position:absolute;right:18px;bottom:16px;width:104px;height:104px;
  pointer-events:none;opacity:.85}
@media(max-width:640px){.pearl-pv{width:82px;height:82px;right:12px;bottom:12px}}`);

/* The strip lay along the foot where nothing else was, so being on top cost
   nothing. A loop in the corner sits where the last line of the last rung can
   reach, so it goes BEHIND the words — and the words are given a layer of
   their own rather than relying on paint order, which for a positioned element
   against in-flow content does not go the way you want. */
patch('pearl: the loop goes behind the words, not over them',
`.pearl-ecg{z-index:1}`,
`.pearl-pv{z-index:0}
.pearl-head,.pearl-steps,.pearl-body,.pearl-open{position:relative;z-index:1}`);

patch('pearl: more room around the words',
`.pearl-main{flex:1;min-width:0;padding:22px 24px 46px}`,
`.pearl-main{flex:1;min-width:0;padding:28px 30px 26px}
@media(max-width:640px){.pearl-main{padding:22px 20px 22px}}`);

patch('pearl: and more air between the rungs',
`.pearl-steps{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:11px}`,
`.pearl-steps{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:15px}`);

patch('pearl: the head has room too',
`.pearl-head{display:flex;align-items:center;gap:9px;margin-bottom:9px}`,
`.pearl-head{display:flex;align-items:center;gap:9px;margin-bottom:16px}`);

patch('pearl: and the way out sits clear of the loop',
`.pearl-open{margin-top:11px;background:transparent;border:0;padding:0;cursor:pointer;`,
`.pearl-open{margin-top:18px;background:transparent;border:0;padding:0;cursor:pointer;`);

fs.writeFileSync(OUT, html);
console.log(`A pressure–volume loop, and room to read — ${applied.length} edits applied`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
