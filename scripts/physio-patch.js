#!/usr/bin/env node
/*
 * The cardiac cycle, in Rhythm Lab.
 *
 *   node scripts/physio-patch.js <scan-output.html> <output.html>
 *
 * Rhythm Lab could already show you a rhythm and a beating heart. What it could
 * not show you was the mechanical consequence — which is most of what a
 * cardiologist is actually reasoning about. This adds it: the Wiggers diagram,
 * the pressure-volume loop, valve and coronary flow, the right heart, and the
 * Starling and Guyton curves.
 *
 * ONE CLOCK. The point of building this rather than shipping a picture is that
 * the diagram is not a picture. Its cursor is driven by the heart model's own
 * cycle — Heart3D.cycle() now reports where in the cardiac cycle it is, and the
 * diagram reads that — so the muscle contracting on screen, the ECG sweeping
 * beneath it and the pressure crossing on the diagram are one event seen three
 * ways. Change the rhythm and all three change, because there is nothing to
 * keep in sync.
 *
 * AND IT CAN BE INTERROGATED. Every curve is computed from src/core/physio.js,
 * so the pressure-volume loop responds to preload, afterload, contractility and
 * diastolic stiffness by SOLVING for the new end-systolic volume rather than by
 * being redrawn. Raising afterload lowers the ejection fraction on screen with
 * contractility untouched — the single most misread relationship in ventricular
 * physiology, and one no static figure can demonstrate.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/physio-patch.js <scan-output.html> <output.html>'); process.exit(1); }
const ROOT = path.join(__dirname, '..');
const physio = fs.readFileSync(path.join(ROOT, 'src', 'core', 'physio.js'), 'utf8');
const wiggers = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'wiggers.js'), 'utf8');

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 260)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

patch('embed: physio.js and wiggers.js',
`/* ═══════════ 12-lead — see src/core/leads12.js and src/ui/ecg12.js ═══════════ */`,
`/* ═══════════ Cardiac physiology — see src/core/physio.js and src/ui/wiggers.js ═══════════ */
${physio}
${wiggers}

/* ═══════════ 12-lead — see src/core/leads12.js and src/ui/ecg12.js ═══════════ */`);

patch('lab: the cardiac cycle panel',
`    \${buildTwelveLead()}
    \${buildLabHeart()}`,
`    \${buildTwelveLead()}
    \${buildPhysio()}
    \${buildLabHeart()}`);

patch('lab: build it',
`/* Which of the lab's 27 rhythms have a genuinely modelled vector sequence.`,
`/* The cardiac cycle. Remembered across sessions like every other lab choice,
   because someone working through the PV loop comes back to the PV loop. */
const PHYSIO_VIEWS=[['wiggers','Wiggers'],['pv','PV loop'],['flow','Flow'],
                    ['right','Right heart'],['curves','Curves']];
let physio=null;
let physioView=(()=>{try{const v=localStorage.getItem('accsap12.physioview');
  return PHYSIO_VIEWS.some(x=>x[0]===v)?v:'wiggers';}catch(_){return 'wiggers';}})();
let physioIv='base', physioCanvasEl=null;

function buildPhysio(){
  const v=PHYSIO_VIEWS.find(x=>x[0]===physioView)||PHYSIO_VIEWS[0];
  return \`<div class="panel physio-panel">
    <div class="panel-h">Cardiac cycle · \${e(v[1])}</div>
    <div class="physio-chips">\${PHYSIO_VIEWS.map(([k,label])=>
      \`<button class="chip\${physioView===k?' hot':''}" data-physio-view="\${k}">\${e(label)}</button>\`).join('')}</div>
    <div class="physio-stage"><canvas id="physioCanvas" aria-label="Cardiac cycle diagram"></canvas></div>
    \${physioView==='pv'?\`<div class="physio-chips iv-chips">\${Physio.INTERVENTIONS.map(iv=>
      \`<button class="chip\${physioIv===iv.id?' hot':''}" data-physio-iv="\${iv.id}">\${e(iv.label)}</button>\`).join('')}</div>\`:''}
    <div class="physio-note" id="physioNote"></div>
  </div>\`;
}
function physioNoteHtml(){
  if(physioView==='pv'){
    const iv=Physio.INTERVENTIONS.find(x=>x.id===physioIv)||Physio.INTERVENTIONS[0];
    return \`<b>\${e(iv.label)}</b> \${e(iv.note)}\`;
  }
  if(physioView==='curves')
    return \`<b>Two curves, one intersection.</b> Cardiac output is not set by the heart alone —
      it is set where what the heart can pump meets what the circulation returns. That is why an
      inotrope moves it so little, and why volume moves it so much in a failing ventricle.\`;
  if(physioView==='flow')
    return \`<b>Flow follows the gradient.</b> The left coronary bed is squeezed shut by the muscle
      around it during systole and fills in diastole; the right is perfused throughout, because RV
      cavity pressure never rises far. Shorten diastole and you starve the left side first.\`;
  if(physioView==='right')
    return \`<b>Same cycle, quarter the pressure, different timing.</b> The right ventricle has
      about 10 mmHg to overcome instead of 80, so it opens earlier and shuts later — which is the
      physiological splitting of the second heart sound, not a separate phenomenon to memorise.\`;
  const ph=Physio.phaseAt(physio?physio.time():0);
  return \`<b>\${e(ph.name)}.</b> \${e(ph.blurb)}\`;
}
function mountPhysio(){
  const cv=document.getElementById('physioCanvas');
  if(!cv||typeof Wiggers==='undefined'){
    if(physio&&physio.destroy) physio.destroy();
    physio=null; physioCanvasEl=null; return;
  }
  /* A screen change can render twice — the second render replaces the canvas
     node under the first one's deferred callback. Guarding on existence alone
     leaves the old instance animating a node that has left the document, and
     requestAnimationFrame will happily keep calling it forever. Guarding on
     identity is what makes that race harmless. */
  if(physio&&physioCanvasEl===cv) return;
  if(physio&&physio.destroy) physio.destroy();
  const dark=document.documentElement.getAttribute('data-theme')==='dark'
    || (!document.documentElement.hasAttribute('data-theme')
        && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  physio=Wiggers.mount(cv,{view:physioView,dark,hr:RHYTHMS[labKind].hr||68,
    /* Its own clock. wiggers.js integrates one when no timeSource is given,
       and onFrame is how the caption below learns what time it is — sixty
       times a second, from the thing that owns the time. */
    onFrame:()=>{ if(typeof paintPhysioNote==='function') paintPhysioNote(); }});
  if(!physio) return;
  physioCanvasEl=cv;
  physio.setIntervention(physioIv);
  document.querySelectorAll('[data-physio-view]').forEach(b=>b.onclick=()=>{
    physioView=b.dataset.physioView;
    try{localStorage.setItem('accsap12.physioview',physioView);}catch(_){}
    render();
  });
  document.querySelectorAll('[data-physio-iv]').forEach(b=>b.onclick=()=>{
    physioIv=b.dataset.physioIv;
    physio.setIntervention(physioIv);
    document.querySelectorAll('[data-physio-iv]').forEach(x=>x.classList.toggle('hot',x===b));
    paintPhysioNote();
  });
  /* Dragging the diagram scrubs the cycle. While a finger is down the heart's
     clock is ignored, so you can stop time on the dicrotic notch and read it. */
  let down=false;
  const at=ev=>{ const r=cv.getBoundingClientRect();
    return physio.scrubAt((ev.touches?ev.touches[0].clientX:ev.clientX)-r.left,
                          (ev.touches?ev.touches[0].clientY:ev.clientY)-r.top); };
  cv.onpointerdown=ev=>{ if(physioView==='pv'||physioView==='curves') return;
    down=true; physio.setScrub(true); cv.setPointerCapture(ev.pointerId); at(ev); paintPhysioNote(); };
  cv.onpointermove=ev=>{ if(!down) return; at(ev); paintPhysioNote(); };
  cv.onpointerup=cv.onpointercancel=ev=>{ if(!down) return;
    down=false; physio.setScrub(false); try{cv.releasePointerCapture(ev.pointerId);}catch(_){} };
  /* The note's repaint guard tracks the phase already on screen. render()
     hands us a fresh, empty #physioNote, so the guard has to be cleared with
     it — otherwise it reports "already painted" about an element that no
     longer exists and the note stays blank until the phase happens to turn
     over. */
  __physioNotePhase='';
  paintPhysioNote();
  requestAnimationFrame(()=>physio&&physio.draw());
}
let __physioNoteAt=0, __physioNotePhase='';
function paintPhysioNote(){
  const el=document.getElementById('physioNote'); if(!el) return;
  /* Repainting a paragraph sixty times a second is wasteful and makes the text
     unselectable, so only when the phase actually changes. */
  if(physioView==='wiggers'){
    const id=Physio.phaseAt(physio?physio.time():0).id;
    if(id===__physioNotePhase) return;
    __physioNotePhase=id;
  }
  el.innerHTML=physioNoteHtml();
}

/* Which of the lab's 27 rhythms have a genuinely modelled vector sequence.`);

patch('lab: mount it alongside the rest',
`  if(typeof mountTwelve==='function') mountTwelve();
  mountLabHeart();`,
`  if(typeof mountTwelve==='function') mountTwelve();
  mountLabHeart();
  if(typeof mountPhysio==='function') mountPhysio();`);

patch('lab: the diagram follows the rate too',
`  labKind=k; if(labHeart) labHeart.setRhythm(k); render();`,
`  labKind=k; if(labHeart) labHeart.setRhythm(k);
  if(physio) physio.setRate(RHYTHMS[k].hr||68);
  render();`);

patch('theme: the diagram follows light and dark like everything else',
`  if(typeof twelve!=='undefined'&&twelve) twelve.setDark(S.theme==='dark'
    ||(S.theme==='auto'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches));`,
`  if(typeof twelve!=='undefined'&&twelve) twelve.setDark(S.theme==='dark'
    ||(S.theme==='auto'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches));
  if(typeof physio!=='undefined'&&physio) physio.setDark(S.theme==='dark'
    ||(S.theme==='auto'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches));`);

patch('css: the cardiac cycle panel',
`.twelve-panel{padding:0;overflow:hidden}`,
`.physio-panel{padding:0;overflow:hidden}
.physio-chips{display:flex;flex-wrap:wrap;gap:6px;padding:10px 14px 0}
.physio-chips.iv-chips{padding-top:10px;border-top:1px solid var(--border);margin-top:10px}
.physio-stage{position:relative;aspect-ratio:1.5/1;max-height:60vh;margin:10px 0 0}
.physio-stage canvas{width:100%;height:100%;display:block;touch-action:none}
.physio-note{padding:12px 14px 14px;font-size:13.5px;line-height:1.55;color:var(--muted);min-height:52px}
.physio-note b{color:var(--text);font-weight:700}
@media(max-width:560px){.physio-stage{aspect-ratio:1.15/1}}
.twelve-panel{padding:0;overflow:hidden}`);

fs.writeFileSync(OUT, html);
const mb = b => (b / 1048576).toFixed(2) + ' MB';
console.log(`Cardiac cycle applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`\n${mb(fs.statSync(SRC).size)} → ${mb(fs.statSync(OUT).size)}`);
console.log(`written: ${OUT}`);
