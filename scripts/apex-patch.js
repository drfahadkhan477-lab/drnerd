#!/usr/bin/env node
/*
 * Apex integration — wires the 3D heart and the Apex tutor persona into a
 * Stage-0-patched ACCSAP build.
 *
 *   node scripts/apex-patch.js <stage0-output.html> <output.html>
 *
 * What this does, and why it's scoped the way it is:
 *
 *   - The 3D heart mounts in Rhythm Lab, not the home screen. Home already
 *     runs a cheap always-visible 2D ECG canvas; a second, much heavier WebGL
 *     canvas running behind every screen would cost battery and thermals for
 *     a view most sessions never look at. Rhythm Lab exists specifically for
 *     rhythm exploration, so the expensive render earns its place there, next
 *     to the existing 2D trace rather than replacing it — one shows the
 *     electrical event, the other shows the mechanical consequence.
 *
 *   - "Braunwald" is renamed to "Apex" everywhere it names the persona (the
 *     tutor identity, UI strings, aria-labels). Citations of the actual
 *     textbook — "Braunwald's Heart Disease" in ACC commentary and in the
 *     system prompt's "in the tradition of" line — are left untouched; those
 *     are real bibliographic references, not the persona's name.
 *
 *   - The chat avatar becomes a live canvas wired to real state: idle when
 *     closed, listening while you type, thinking before the first token,
 *     speaking with amplitude tracking tokens as they actually arrive, tool
 *     while a tool call is in flight. LocalStorage keys are untouched, so
 *     existing chat history, notes and progress carry over unmodified.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) {
  console.error('usage: node scripts/apex-patch.js <stage0-output.html> <output.html>');
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

/* ────────────────────────────────────────────────────────────────────────────
 * 1. Embed the heart and Apex modules
 * ──────────────────────────────────────────────────────────────────────────── */
const ROOT = path.join(__dirname, '..');
const heart3d = fs.readFileSync(path.join(ROOT, 'src', 'core', 'heart3d.js'), 'utf8');
const apex = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'apex.js'), 'utf8');

patch('embed: heart3d.js and apex.js',
`function icon(name, cls){
  return \`<svg class="icon\${cls?' '+cls:''}" aria-hidden="true"><use href="#i-\${name}"></use></svg>\`;
}`,
`function icon(name, cls){
  return \`<svg class="icon\${cls?' '+cls:''}" aria-hidden="true"><use href="#i-\${name}"></use></svg>\`;
}

/* ═══════════ Heart3D + Apex — embedded, see src/core/heart3d.js and src/ui/apex.js ═══════════ */
${heart3d}
${apex}`);

/* ────────────────────────────────────────────────────────────────────────────
 * 2. CSS: room for the live avatar canvas and the lab's heart panel
 * ──────────────────────────────────────────────────────────────────────────── */
patch('css: avatar canvas fills its rounded frame',
`.ai-avatar{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;
  justify-content:center;background:linear-gradient(135deg,#1E3A8A,#0891B2);font-size:15px}`,
`.ai-avatar{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;
  justify-content:center;background:linear-gradient(135deg,#1E3A8A,#0891B2);font-size:15px;
  overflow:hidden}
.ai-avatar canvas{width:100%;height:100%;display:block}`);

patch('css: lab heart panel',
`.lab-desc{`,
`.lab-heart-panel{background:var(--card);border:1.5px solid var(--border);border-radius:var(--r);
  overflow:hidden;margin-top:14px}
.lab-heart-stage{position:relative;aspect-ratio:1/1;max-height:46vh}
.lab-heart-stage canvas{width:100%;height:100%;display:block;touch-action:none;cursor:grab}
.lab-heart-stage canvas:active{cursor:grabbing}
.lab-heart-readout{position:absolute;left:12px;bottom:10px;pointer-events:none;
  font-family:var(--font-mono);font-size:11px;color:var(--muted);
  background:color-mix(in srgb, var(--card) 78%, transparent);padding:4px 8px;border-radius:7px}
.lab-heart-readout b{color:var(--teal)}
.lab-heart-modes{display:flex;gap:6px;padding:10px 12px;flex-wrap:wrap;border-top:1px solid var(--border2)}
.lab-heart-hint{padding:0 12px 12px;font-size:12px;color:var(--dim);line-height:1.5}
.lab-desc{`);

/* ────────────────────────────────────────────────────────────────────────────
 * 3. Rhythm Lab: the beating heart, alongside the existing 2D trace
 * ──────────────────────────────────────────────────────────────────────────── */
patch('lab: heart panel markup',
`    <div class="lab-desc">\${e(r.desc)}</div>
    <div class="chips lab-chips">\${RHYTHM_KEYS.map(k=>
      \`<button class="chip\${k===labKind?' hot':''}" onclick="setLab('\${k}')">\${e(RHYTHMS[k].name)}</button>\`).join('')}</div>
    <div class="ref-hint" style="margin-top:12px">Traces are generated from waveform models, not recordings —
      shapes are schematic and meant for pattern recognition, not measurement.</div>
  </div>\`;
}`,
`    <div class="lab-desc">\${e(r.desc)}</div>
    <div class="chips lab-chips">\${RHYTHM_KEYS.map(k=>
      \`<button class="chip\${k===labKind?' hot':''}" onclick="setLab('\${k}')">\${e(RHYTHMS[k].name)}</button>\`).join('')}</div>
    <div class="ref-hint" style="margin-top:12px">Traces are generated from waveform models, not recordings —
      shapes are schematic and meant for pattern recognition, not measurement.</div>
    \${buildLabHeart()}
  </div>\`;
}
const LAB_HEART_MODES=[['whole','Whole heart'],['cutaway','Cutaway'],['conduction','Conduction']];
function buildLabHeart(){
  if(!hasWebGL2()) return '';
  return \`<div class="lab-heart-panel">
    <div class="lab-heart-stage">
      <canvas id="labHeartCanvas" aria-label="Rotatable 3D heart model"></canvas>
      <div class="lab-heart-readout" id="labHeartReadout">&nbsp;</div>
    </div>
    <div class="lab-heart-modes">\${LAB_HEART_MODES.map(([k,label])=>
      \`<button class="chip\${labHeartMode===k?' hot':''}" data-heart-mode="\${k}">\${e(label)}</button>\`).join('')}</div>
    <div class="lab-heart-hint">Drag to rotate, pinch or scroll to zoom. The muscle beats on the same
      cardiac clock as the trace above — switch rhythm and both move together.</div>
  </div>\`;
}
let __webgl2Checked=null;
function hasWebGL2(){
  if(__webgl2Checked!==null) return __webgl2Checked;
  try{ const c=document.createElement('canvas'); __webgl2Checked=!!c.getContext('webgl2'); }
  catch(_){ __webgl2Checked=false; }
  return __webgl2Checked;
}`);

patch('lab: mount and tear down the heart with the rest of the lab',
`function mountLab(){
  if(labMon){ labMon.destroy(); labMon=null; }
  const cv=document.getElementById('labCanvas');
  if(!cv) return;
  labMon=new ECGMonitor(cv,{kind:labKind,speed:0.15,grid:true,amp:60,lineWidth:2.2});
  labMon.start();
}
function goLab(){ S.screen='lab'; render(); window.scrollTo(0,0); }`,
`let labHeart=null, labHeartMode='whole', labHeartCanvasEl=null;
function mountLab(){
  if(labMon){ labMon.destroy(); labMon=null; }
  const cv=document.getElementById('labCanvas');
  if(cv){ labMon=new ECGMonitor(cv,{kind:labKind,speed:0.15,grid:true,amp:60,lineWidth:2.2}); labMon.start(); }
  mountLabHeart();
}
/* Always runs, on every render — mirrors mountHero()'s pattern. The heart
   canvas only exists in the Rhythm Lab's own markup, so this destroys the
   instance the moment its canvas leaves the DOM (screen change, or WebGL2
   unavailable) and never lets a WebGL context keep animating unseen.

   Checking labHeart's truthiness alone is not enough: render() defers to
   document.startViewTransition on a screen change, and its callback can land
   after a second, faster render has already replaced #app's markup with a
   fresh canvas element. Guarding on identity rather than existence is what
   makes that race harmless instead of orphaning the instance on a detached
   canvas — which silently stops calling onCycle forever, since fit() no-ops
   once the node it's measuring has left the DOM. */
function mountLabHeart(){
  const cv=document.getElementById('labHeartCanvas');
  if(!cv){
    if(labHeart){ labHeart.destroy(); labHeart=null; labHeartCanvasEl=null; }
    return;
  }
  if(labHeart && labHeartCanvasEl===cv) return;   // already live, same node
  if(labHeart){ labHeart.destroy(); labHeart=null; }
  const dark=document.documentElement.getAttribute('data-theme')==='dark'
    || (!document.documentElement.hasAttribute('data-theme')
        && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  labHeart=Heart3D.create(cv,{rhythm:labKind,mode:labHeartMode,dark,onCycle:paintLabHeartReadout});
  if(!labHeart) return;
  labHeartCanvasEl=cv;
  document.querySelectorAll('[data-heart-mode]').forEach(b=>b.onclick=()=>{
    labHeartMode=b.dataset.heartMode; labHeart.setMode(labHeartMode);
    document.querySelectorAll('[data-heart-mode]').forEach(x=>x.classList.toggle('hot',x===b));
  });
}
let __lastReadoutPaint=0;
function paintLabHeartReadout(c){
  const now=performance.now(); if(now-__lastReadoutPaint<110) return;
  __lastReadoutPaint=now;
  const el=document.getElementById('labHeartReadout'); if(!el) return;
  const phase = c.valves[2]>0.5 ? 'ejection'
    : c.valves[0]>0.5 ? (c.a>0.25?'atrial kick':'filling')
    : 'isovolumetric';
  el.innerHTML='<b>'+phase+'</b>';
}
function goLab(){ S.screen='lab'; render(); window.scrollTo(0,0); }`);

patch('lab: setLab restarts the heart on the new rhythm too',
`function setLab(k){ labKind=k; render(); }`,
`function setLab(k){ labKind=k; if(labHeart) labHeart.setRhythm(k); render(); }`);

patch('render: mount/unmount the lab heart every render, not just on the lab screen',
`  if(typeof mountLab==='function'&&S.screen==='lab') mountLab();`,
`  if(typeof mountLabHeart==='function') mountLabHeart();
  if(typeof mountLab==='function'&&S.screen==='lab') mountLab();`);

patch('theme: keep the lab heart in step with light/dark switches',
`function cycleTheme(){
  S.theme=S.theme==='auto'?'light':S.theme==='light'?'dark':'auto';
  applyTheme();save();render();
}`,
`function cycleTheme(){
  S.theme=S.theme==='auto'?'light':S.theme==='light'?'dark':'auto';
  applyTheme();save();render();
  if(typeof labHeart!=='undefined'&&labHeart) labHeart.setDark(S.theme==='dark'
    ||(S.theme==='auto'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches));
}`);

/* ────────────────────────────────────────────────────────────────────────────
 * 4. Rebrand the persona: Braunwald → Apex, everywhere it names the tutor
 * ──────────────────────────────────────────────────────────────────────────── */
patch('rebrand: aside aria-label',
`<aside id="ai" aria-label="Braunwald cardiology tutor"></aside>`,
`<aside id="ai" aria-label="Apex cardiology tutor"></aside>`);

patch('rebrand: fab button',
`<button class="ai-fab" id="aiFab" aria-label="Open the Braunwald tutor">
  <svg class="icon" aria-hidden="true"><use href="#i-heart-pulse"></use></svg> Braunwald</button>`,
`<button class="ai-fab" id="aiFab" aria-label="Open the Apex tutor">
  <svg class="icon" aria-hidden="true"><use href="#i-heart-pulse"></use></svg> Apex</button>`);

patch('rebrand: comment header, agent loop',
`/* ═══════════ Braunwald agent — client-side tool loop ═══════════ */`,
`/* ═══════════ Apex agent — client-side tool loop ═══════════ */`);

patch('rebrand: reference-library hero copy',
`handed to Braunwald as context — so the tutor teaches from your understanding, not just the question bank.`,
`handed to Apex as context — so the tutor teaches from your understanding, not just the question bank.`);

patch('rebrand: chat panel comment header',
`/* ══════════════ "Braunwald" — cardiology reasoning panel ══════════════ */`,
`/* ══════════════ Apex — cardiology reasoning panel ══════════════ */`);

patch('rebrand: chat panel title',
`<div class="ai-title">Braunwald</div>`,
`<div class="ai-title">Apex</div>`);

/* ────────────────────────────────────────────────────────────────────────────
 * 5. System prompt: a name to answer to, nothing else changed
 * ──────────────────────────────────────────────────────────────────────────── */
patch('prompt: self-identification',
`const SYSTEM = \`You are a cardiology attending running a one-on-one teaching session`,
`const SYSTEM = \`You go by Apex. You are a cardiology attending running a one-on-one teaching session`);

/* ────────────────────────────────────────────────────────────────────────────
 * 6. The chat avatar becomes a live canvas, wired to real state
 * ──────────────────────────────────────────────────────────────────────────── */
patch('avatar: markup — canvas instead of a static icon',
`      <div class="ai-avatar">\${icon("heart-pulse")}</div>
      <div style="flex:1;min-width:0">
        <div class="ai-title">Apex</div>`,
`      <div class="ai-avatar"><canvas id="apexAvatar" aria-hidden="true"></canvas></div>
      <div style="flex:1;min-width:0">
        <div class="ai-title">Apex</div>`);

patch('avatar: mount after both buildAI() render paths',
`  if(!cur().key) { wrap.innerHTML=head+setupHtml(); bindSetup(); return; }`,
`  if(!cur().key) { wrap.innerHTML=head+setupHtml(); bindSetup(); mountApexAvatar(); return; }`);

patch('avatar: mount on the normal chat render path, and pick up mid-stream state',
`  wrap.querySelectorAll('[data-jump]').forEach(b=>b.onclick=()=>peekQuestion(b.dataset.jump));
  bindChat(q);
}`,
`  wrap.querySelectorAll('[data-jump]').forEach(b=>b.onclick=()=>peekQuestion(b.dataset.jump));
  bindChat(q);
  mountApexAvatar();
}
/* ── the live avatar: one instance, recreated whenever buildAI() re-renders
   the panel (a few times per exchange, not per token — see fire()/streamReply
   below for the per-token updates that happen without a full re-render) ── */
let apexAv=null;
function mountApexAvatar(){
  const cv=document.getElementById('apexAvatar');
  if(apexAv){ apexAv.destroy(); apexAv=null; }
  if(!cv) return;
  apexAv=Apex.avatar(cv, { state: aiBusy?'thinking':'idle' });
}
function apexSetState(s){ if(apexAv) apexAv.setState(s); }
function apexPulse(n){ if(apexAv) apexAv.pulse(n); }`);

patch('avatar: listening while you type, back to idle when the field empties',
`  if(ta){
    ta.oninput=()=>{ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,120)+'px';};
    ta.onkeydown=ev=>{ if(ev.key==='Enter'&&!ev.shiftKey){ev.preventDefault();fire(ta.value);} };
  }`,
`  if(ta){
    ta.oninput=()=>{
      ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,120)+'px';
      if(!aiBusy) apexSetState(ta.value.trim()?'listening':'idle');
    };
    ta.onkeydown=ev=>{ if(ev.key==='Enter'&&!ev.shiftKey){ev.preventDefault();fire(ta.value);} };
  }`);

patch('avatar: Anthropic stream — tool calls and token arrival',
`      if(j.type==='content_block_start'){
        const b=j.content_block||{};
        if(b.type==='tool_use'){ curBlk={type:'tool_use',id:b.id,name:b.name,input:{}}; jsonBuf=''; }
        else if(b.type==='text'){ curBlk={type:'text',text:''}; }
      }
      else if(j.type==='content_block_delta'){
        const d=j.delta||{};
        if(d.type==='text_delta'&&d.text){
          text+=d.text; if(curBlk&&curBlk.type==='text')curBlk.text+=d.text;
          if(live){ live.innerHTML=md(text)+toolStrip(); if(body)body.scrollTop=body.scrollHeight; }
        }`,
`      if(j.type==='content_block_start'){
        const b=j.content_block||{};
        if(b.type==='tool_use'){ curBlk={type:'tool_use',id:b.id,name:b.name,input:{}}; jsonBuf=''; apexSetState('tool'); }
        else if(b.type==='text'){ curBlk={type:'text',text:''}; apexSetState('speaking'); }
      }
      else if(j.type==='content_block_delta'){
        const d=j.delta||{};
        if(d.type==='text_delta'&&d.text){
          text+=d.text; if(curBlk&&curBlk.type==='text')curBlk.text+=d.text;
          apexPulse();
          if(live){ live.innerHTML=md(text)+toolStrip(); if(body)body.scrollTop=body.scrollHeight; }
        }`);

patch('avatar: Groq stream — tool calls and token arrival',
`      const d=ch.delta||{};
      if(d.content){
        text+=d.content;
        if(live){ live.innerHTML=md(text)+toolStrip(); if(body)body.scrollTop=body.scrollHeight; }
      }
      if(Array.isArray(d.tool_calls)){
        for(const tc of d.tool_calls){`,
`      const d=ch.delta||{};
      if(d.content){
        if(!text) apexSetState('speaking');
        text+=d.content;
        apexPulse();
        if(live){ live.innerHTML=md(text)+toolStrip(); if(body)body.scrollTop=body.scrollHeight; }
      }
      if(Array.isArray(d.tool_calls)){
        if(!d.content) apexSetState('tool');
        for(const tc of d.tool_calls){`);

patch('avatar: back to thinking at the start of every fresh turn, idle when the exchange ends',
`      const turn=await oneTurn(q,wire,extra);`,
`      apexSetState('thinking');
      const turn=await oneTurn(q,wire,extra);`);

patch('avatar: idle once the exchange finishes',
`  }finally{
    aiBusy=false; aiAbort=null; buildAI();
    try{ flushNav(); }catch(_){}
  }`,
`  }finally{
    aiBusy=false; aiAbort=null; buildAI();
    apexSetState('idle');
    try{ flushNav(); }catch(_){}
  }`);

/* ──────────────────────────────────────────────────────────────────────────── */
fs.writeFileSync(OUT, html);
const before = fs.statSync(SRC).size, after = fs.statSync(OUT).size;
console.log(`Apex integration applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`\n${(before / 1048576).toFixed(2)} MB → ${(after / 1048576).toFixed(2)} MB  (+${((after - before) / 1024).toFixed(0)} KB: heart3d.js + apex.js embedded)`);
console.log(`written: ${OUT}`);
