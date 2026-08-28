#!/usr/bin/env node
/*
 * The cardiac cycle, slow enough to watch.
 *
 *   node scripts/slowcycle-patch.js <input.html> <output.html>
 *
 * The diagram ran in real time: at 68 bpm one cycle is 880 milliseconds, and
 * inside that the whole of isovolumic contraction is about 50. You can see
 * that the cursor moves. You cannot follow it through a phase and read the
 * pressures at the same time, which is the entire reason the diagram exists.
 *
 * So it slows down — and says so, rather than quietly redefining the heart
 * rate. The label still reads the rhythm's true rate; the speed control says
 * what fraction of real time the animation is running at. Those are different
 * facts and conflating them would make the diagram lie: a Wiggers diagram at
 * "34 bpm" is a bradycardia, not a slow-motion replay.
 *
 * The clock is one line — S.t advances by dt/secs() per frame — so the change
 * is a divisor on that, and everything downstream (the cursor, the phase
 * caption, the PV loop, the flow curves) follows without knowing.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/slowcycle-patch.js <input.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── 1. the clock takes a divisor ────────────────────────────────────────── */
patch('cycle: the diagram can run slower than the heart it draws',
`    hr: opts.hr || 75,
    t: 0,`,
`    hr: opts.hr || 75,
    /* How much slower than real time the animation runs. NOT a change to the
       heart rate: the rate is a fact about the patient and the slowdown is a
       fact about the playback, and a diagram that expressed one as the other
       would be labelling a slow-motion replay as a bradycardia. */
    slow: opts.slow || 1,
    t: 0,`);

patch('cycle: and the one line that advances time honours it',
`      S.t = Ph.wrap(S.t + dt / secs());`,
`      S.t = Ph.wrap(S.t + dt / (secs() * (S.slow || 1)));`);

patch('cycle: which the panel can set',
`    setRate(hr) { S.hr = hr || 75; rOffset = null; draw(); return api; },`,
`    setRate(hr) { S.hr = hr || 75; rOffset = null; draw(); return api; },
    setSlow(n) { S.slow = n > 0 ? n : 1; return api; },
    slow: () => S.slow,`);

/* ── 2. a control for it ─────────────────────────────────────────────────── */
patch('cycle: remember the chosen speed',
`let physioIv='base', physioCanvasEl=null;`,
`let physioIv='base', physioCanvasEl=null;
/* Half real time by default. A whole cycle then takes about 1.8 seconds, which
   is long enough to follow the cursor through isovolumic contraction — 50ms in
   life — and short enough that the loop still reads as a loop. */
const PHYSIO_SPEEDS=[[1,'1×'],[2,'½×'],[4,'¼×']];
let physioSlow=(()=>{ try{ return +localStorage.getItem('accsap12.physioslow')||2; }catch(_){ return 2; } })();
function setPhysioSlow(n){
  physioSlow=n;
  try{ localStorage.setItem('accsap12.physioslow',String(n)); }catch(_){}
  if(physio&&physio.setSlow) physio.setSlow(n);
  document.querySelectorAll('[data-physio-slow]').forEach(b=>
    b.classList.toggle('hot',+b.dataset.physioSlow===n));
}`);

patch('cycle: pass it in when the diagram is mounted',
`  physio=Wiggers.mount(cv,{view:physioView,dark,hr:RHYTHMS[labKind].hr||68,`,
`  physio=Wiggers.mount(cv,{view:physioView,dark,hr:RHYTHMS[labKind].hr||68,
    slow:physioSlow,`);

patch('cycle: wire the buttons up with the view buttons',
`  document.querySelectorAll('[data-physio-view]').forEach(b=>b.onclick=()=>{`,
`  document.querySelectorAll('[data-physio-slow]').forEach(b=>
    b.onclick=()=>setPhysioSlow(+b.dataset.physioSlow));
  document.querySelectorAll('[data-physio-view]').forEach(b=>b.onclick=()=>{`);

patch('cycle: and show them beside the phase caption',
`    <div class="panel-h"><span>Cardiac cycle · \${e(v[1])}</span>
      <span class="physio-phase" id="physioPhase">&nbsp;</span></div>`,
`    <div class="panel-h"><span>Cardiac cycle · \${e(v[1])}</span>
      <span class="physio-phase" id="physioPhase">&nbsp;</span></div>
    <div class="physio-chips speed-chips"><span class="speed-lbl">speed</span>\${
      PHYSIO_SPEEDS.map(([n,label])=>
        \`<button class="chip mini\${physioSlow===n?' hot':''}" data-physio-slow="\${n}"
           title="\${n===1?'Real time':'\\u0024{label} of real time'}">\${e(label)}</button>\`).join('')}</div>`);

patch('cycle: a smaller chip, since speed is a setting and not a subject',
`.physio-chips{padding:var(--s3) var(--s4) 0;gap:var(--s2)}`,
`.physio-chips{padding:var(--s3) var(--s4) 0;gap:var(--s2)}
.speed-chips{align-items:center;padding-top:var(--s2)}
.speed-lbl{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);
  margin-right:var(--s1)}
.chip.mini{padding:4px 11px;font-size:11px}`);

fs.writeFileSync(OUT, html);
console.log(`A cycle you can follow — ${applied.length} edits applied`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
