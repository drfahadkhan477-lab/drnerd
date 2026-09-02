#!/usr/bin/env node
/*
 * A self-test the app runs on the device it is actually used on.
 *
 *   node scripts/selftest-patch.js <in.html> <out.html>
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A TEST SUITE. Two bugs reached the fellow
 * in two days. Both were invisible to 1,496 checks, and for the same reason:
 * the checks ran in Blink, at a portrait-ish desktop viewport, against a
 * 400x300 grey rectangle. The app runs in WebKit, in landscape, against 408
 * real figures with a median height of 825px. Measured afterwards, 401 of
 * those 408 were clipped at "Fit" on an 11-inch iPad — 98% — and 1% on the
 * same iPad held portrait. The defect lived entirely in the gap between the
 * harness and the device.
 *
 * That gap cannot be closed from the harness. Playwright's WebKit is a Linux
 * build of the engine, not iOS Safari, and it cannot be installed at all
 * without a second computer. So the checks come to the device instead: open
 * the app on the iPad, add #selftest, and the invariants run in the real
 * engine, at the real size, in the orientation the iPad is currently held.
 *
 * WHAT IT WILL AND WILL NOT TELL YOU. These are invariants, not a suite: five
 * properties that must hold on any screen, plus an environment row for
 * context. It cannot check that FSRS schedules correctly or that an answer key
 * is right — those are settled in Node, exhaustively, and do not vary by
 * device. It checks the things that only vary by device, which is exactly the
 * set that has been reaching the fellow.
 *
 * IT OPENS REAL FIGURES RATHER THAN COMPUTING WHETHER THEY WOULD FIT.
 * Reimplementing the sizing rule in the check would produce a check that
 * agrees with a wrong rule — it would have passed on the broken build. It
 * opens the viewer, waits for the decode, and measures the rendered rectangle
 * against the frame, which is the only version that cannot be fooled.
 *
 * #selftest, because the app has no hash routing at all, so the hash was free;
 * it works identically in the single file and the split build; and it adds no
 * control to a screen the fellow reads during study.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/selftest-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

/* ── the checks ──────────────────────────────────────────────────────────── */

patch('selftest: the invariants, and the runner that reports them',
`(function boot(){
  dismissSplash();`,
`/* ══════════ on-device self-test — why, at length, in scripts/selftest-patch.js ══════════ */
const ST_SAMPLE=24;
const stFrame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));

/* EVERY figure, not one per question. A question can carry several and the
   later ones are not the same shape as the first — sampling only [0] quietly
   halved the bank the check could see. */
function stFigureUrls(){
  const out=[];
  try{ for(const id in IMGS){ const l=IMGS[id]; if(!l) continue;
    for(const u of l) if(typeof u==='string'&&u) out.push(u); } }catch(_){}
  return out;
}

/* THE ONE THAT BROKE. Opens real figures and measures the rendered rectangle
   against the frame — never recomputes the sizing rule, which would agree with
   a wrong one. */
async function stFiguresFit(){
  const urls=stFigureUrls();
  if(!urls.length) return {ok:null,detail:'this build carries no figures'};
  const step=Math.max(1,Math.floor(urls.length/ST_SAMPLE));
  let seen=0,missed=0,worst=0,worstAt='';
  for(let i=0;i<urls.length&&seen<ST_SAMPLE;i+=step){
    try{ closePeek(); openFigure(urls[i],'Self-test',''); }catch(_){ missed++; continue; }
    /* Wait for the element, then for the decode, separately. Polling frames
       for both together reported the first figure as unreachable on a
       perfectly healthy device — the first open also builds the overlay and
       mounts the zoom controller, so it is always the slow one. A self-test
       that cries wolf on its own timing is the failure mode this whole step
       exists to avoid. */
    let img=null;
    for(let t=0;t<120;t++){ await stFrame();
      img=document.querySelector('.figv-scroll img'); if(img) break; }
    if(img&&!(img.complete&&img.naturalWidth)){
      await new Promise(res=>{ let done=0; const fin=()=>{ if(!done++) res(); };
        img.addEventListener('load',fin,{once:true});
        img.addEventListener('error',fin,{once:true});
        setTimeout(fin,4000); });
      await stFrame();
    }
    if(!img||!img.naturalWidth){ missed++; continue; }
    await stFrame();
    /* LAYOUT SIZE, NOT THE PAINTED RECTANGLE. getBoundingClientRect() includes
       every transform above the element, and the viewer has two: its own
       entrance animation, and the zoom. Opening two dozen figures back to back
       restarts the entrance each time, so a rect measured two frames in is
       mid-animation — which reported a 12px overflow on a figure that fits
       exactly. offsetHeight against clientHeight is the question actually
       being asked: does the fitted image fit the frame it was laid out in. */
    const box=document.querySelector('.figv-scroll');
    if(box){
      const over=Math.max(0,img.offsetHeight-box.clientHeight,img.offsetWidth-box.clientWidth);
      if(over>worst){ worst=Math.round(over); worstAt=img.naturalWidth+'x'+img.naturalHeight; }
    }
    seen++;
  }
  try{ closePeek(); }catch(_){}
  if(!seen) return {ok:false,detail:missed+' figures could not be loaded — download them on this device first'};
  return {ok:worst<=1,
    detail:seen+' sampled · worst overflow '+worst+'px'+(worst>1?' on a '+worstAt+' figure':'')+
           (missed?' · '+missed+' unreachable':'')};
}

/* A sideways scrollbar is the other thing that only appears at a real width. */
function stNoSideways(){
  const d=document.documentElement, over=Math.round(d.scrollWidth-d.clientWidth);
  return {ok:over<=1,detail:over<=1?'nothing overflows the width':over+'px wider than the screen'};
}

/* The figures under an Apex answer used to arrive with no way to put them
   away. Shut-by-default is now the promise; this is where it is kept. */
function stFigStripShut(){
  const w=document.querySelector('.fig-strip');
  if(!w) return {ok:null,detail:'no Apex answer on screen to check'};
  return {ok:!w.classList.contains('open'),
    detail:w.classList.contains('open')?'it opened by itself':'arrives folded, as it should'};
}

/* Private browsing, an MDM profile, or a full disk all present as this, and
   all of them silently lose a morning of annotations. */
function stStorage(){
  try{
    const k='accsap12.selftest';
    localStorage.setItem(k,'1');
    const back=localStorage.getItem(k)==='1';
    localStorage.removeItem(k);
    const idb=typeof indexedDB!=='undefined';
    return {ok:back&&idb,detail:back?(idb?'readable and writable':'localStorage fine, IndexedDB missing')
                                   :'writes are not coming back'};
  }catch(e){ return {ok:false,detail:'storage refused: '+(e&&e.name||'error')}; }
}

/* Not a check — the context every other line has to be read against. */
function stEnv(){
  const ua=navigator.userAgent, w=innerWidth, h=innerHeight;
  const engine=/\\bCriOS|Chrome\\//.test(ua)?'Blink':(/Firefox\\//.test(ua)?'Gecko':'WebKit');
  return {ok:null,detail:engine+' · '+w+'x'+h+' '+(w>h?'landscape':'portrait')+
    ' · dpr '+(devicePixelRatio||1)+' · '+stFigureUrls().length+' figures'};
}

const ST_CHECKS=[
  ['this device and orientation',stEnv],
  ['every figure fits the viewer at Fit',stFiguresFit],
  ['nothing scrolls sideways',stNoSideways],
  ['the Apex figures arrive folded',stFigStripShut],
  ['annotations can be saved here',stStorage],
];

async function runSelfTestNow(){
  const out=[];
  for(const [name,fn] of ST_CHECKS){
    let r; try{ r=await fn(); }catch(e){ r={ok:false,detail:'threw: '+(e&&e.message||e)}; }
    out.push({name:name,ok:r.ok,detail:r.detail});
  }
  return out;
}

/* SERIALISED, NOT DROPPED. The figure check drives a single shared viewer, so
   two overlapping runs have each other's images torn out by the other's
   closePeek() — which reports as figures being "unreachable" on a device where
   every one of them is fine. Queueing rather than refusing means a caller
   always gets a real answer: arriving on #selftest fires both the boot hook
   and the hashchange listener, and Run again is a button a finger can hit
   twice. */
let stQueue=Promise.resolve();
function runSelfTest(){
  stQueue=stQueue.then(runSelfTestNow,runSelfTestNow);
  return stQueue;
}

function renderSelfTest(rows,busy){
  let el=document.getElementById('selftest');
  if(!el){ el=document.createElement('div'); el.id='selftest'; document.body.appendChild(el); }
  const real=rows.filter(r=>r.ok!==null), bad=real.filter(r=>!r.ok);
  el.innerHTML='<div class="st-card"><div class="st-head"><b>Self-test</b>'+
    '<button class="st-x" id="stClose" aria-label="Close">'+icon('x','icon-sm')+'</button></div>'+
    '<div class="st-rows">'+rows.map(r=>
      '<div class="st-row"><span class="st-dot '+(r.ok===null?'info':(r.ok?'pass':'fail'))+'">'+
      (r.ok===null?'i':(r.ok?'✓':'✗'))+'</span><span class="st-txt"><b>'+e(r.name)+'</b>'+
      '<span>'+e(r.detail||'')+'</span></span></div>').join('')+'</div>'+
    '<div class="st-foot"><span>'+(busy?'running…':
      (bad.length?bad.length+' of '+real.length+' failing':'all '+real.length+' holding here'))+
    '</span><button class="st-run" id="stRun"'+(busy?' disabled':'')+'>Run again</button></div></div>';
  const x=document.getElementById('stClose');
  if(x) x.onclick=closeSelfTest;
  const run=document.getElementById('stRun');
  if(run) run.onclick=openSelfTest;
}

function closeSelfTest(){
  const el=document.getElementById('selftest'); if(el) el.remove();
  if(location.hash==='#selftest'){
    try{ history.replaceState(null,'',location.pathname+location.search); }catch(_){}
  }
}

/* The queue above keeps runs from colliding; this keeps a second tap from
   throwing the panel back to "running…" over results that are already there. */
let stRunning=false;
async function openSelfTest(){
  if(stRunning) return;
  stRunning=true;
  renderSelfTest(ST_CHECKS.map(c=>({name:c[0],ok:null,detail:'…'})),true);
  try{
    const rows=await runSelfTest();
    renderSelfTest(rows,false);
  } finally { stRunning=false; }
}

(function boot(){
  dismissSplash();
  if(location.hash==='#selftest') setTimeout(openSelfTest,600);
  window.addEventListener('hashchange',()=>{ if(location.hash==='#selftest') openSelfTest(); });`);

/* ── how it looks ────────────────────────────────────────────────────────── */

patch('selftest: a panel you can read on a phone held in one hand',
`.figv-hint{flex:0 0 auto;margin-top:8px;text-align:center;color:rgba(255,255,255,.55);`,
`/* Above the figure viewer's own layer, because the figure check opens it. */
#selftest{position:fixed;inset:0;z-index:400;background:rgba(6,14,28,.92);
  display:flex;align-items:center;justify-content:center;padding:16px;
  backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.st-card{width:min(560px,100%);max-height:100%;display:flex;flex-direction:column;
  background:#0F1B2E;color:#fff;border-radius:14px;overflow:hidden;
  box-shadow:0 18px 48px rgba(0,0,0,.5)}
.st-head{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;
  padding:calc(var(--sat,0px) + 14px) 16px 12px;border-bottom:1px solid rgba(255,255,255,.12)}
.st-head b{font-size:var(--t-lead);font-weight:700}
.st-x{width:40px;height:40px;border:0;border-radius:20px;cursor:pointer;
  background:rgba(255,255,255,.12);color:#fff;display:flex;align-items:center;justify-content:center}
.st-rows{flex:1;min-height:0;overflow-y:auto;padding:6px 16px}
.st-row{display:flex;gap:11px;align-items:flex-start;padding:11px 0;
  border-bottom:1px solid rgba(255,255,255,.07)}
.st-row:last-child{border-bottom:0}
.st-dot{flex:0 0 auto;width:22px;height:22px;border-radius:11px;margin-top:1px;
  display:flex;align-items:center;justify-content:center;font-size:var(--t-tiny);font-weight:700}
.st-dot.pass{background:rgba(45,212,191,.18);color:#5EEAD4}
.st-dot.fail{background:rgba(244,63,94,.2);color:#FDA4AF}
.st-dot.info{background:rgba(255,255,255,.12);color:rgba(255,255,255,.7)}
.st-txt{display:flex;flex-direction:column;gap:2px;min-width:0}
.st-txt b{font-size:var(--t-meta);font-weight:600}
.st-txt span{font-size:var(--t-tiny);color:rgba(255,255,255,.62);word-break:break-word}
.st-foot{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:12px 16px calc(var(--sab,0px) + 14px);border-top:1px solid rgba(255,255,255,.12);
  font-size:var(--t-meta);color:rgba(255,255,255,.75)}
.st-run{min-height:40px;padding:0 16px;border:0;border-radius:20px;cursor:pointer;
  background:rgba(255,255,255,.14);color:#fff;font-size:var(--t-meta);font-weight:600}
.st-run[disabled]{opacity:.5}
.figv-hint{flex:0 0 auto;margin-top:8px;text-align:center;color:rgba(255,255,255,.55);`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('selftest-patch applied:');
edits.forEach(e => console.log('  ✓ ' + e));
