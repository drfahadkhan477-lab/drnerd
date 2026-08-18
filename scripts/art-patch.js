#!/usr/bin/env node
/*
 * Design pass — the highlighter, the Apex mark, and the home screen.
 *
 *   node scripts/art-patch.js <braunwald-output.html> <output.html>
 *
 * HIGHLIGHTER. Three things were wrong with it, and they compounded.
 *   · It drew from the pen palette. Saturated ink reds and blues are the wrong
 *     pigment entirely — a highlighter is a bright, weak, transparent dye, and
 *     a #EF4444 at 34% over black text comes out as mud.
 *   · It composited with `multiply` unconditionally. Multiply is exactly right
 *     on white paper and exactly wrong on a dark card, where it drives the
 *     text toward black instead of lifting it. Dark mode now uses `screen`.
 *   · Pressure and tilt drove its width, inherited from the pen. A real marker
 *     has a chisel tip and lays down a near-constant band; varying it made
 *     strokes look ragged rather than expressive. Its width response is now
 *     mostly flat, with a little left so it does not feel dead.
 *
 * APEX MARK. The floating button carried a static SVG heart. It is now the
 * same live avatar that runs in the panel header — breathing when idle,
 * quickening while a reply streams, and reacting to touch. The avatar was
 * already built and already state-driven; the button simply never used it.
 *
 * HOME. The hero's three stats sat on one line that wrapped badly at narrow
 * widths, the rhythm strip was a fixed 62px band that got lost against a tall
 * hero on iPad, and the mini heart floated without a baseline. The stats are
 * now a proper row that reflows, and the strip scales with the hero.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) {
  console.error('usage: node scripts/art-patch.js <braunwald-output.html> <output.html>');
  process.exit(1);
}
let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 260)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── 1. the highlighter ──────────────────────────────────────────────────── */
patch('ink: a real highlighter palette, separate from the pen',
`const INK_COLORS=['#EF4444','#0891B2','#F59E0B','#10B981','#111E35'];`,
`const INK_COLORS=['#EF4444','#0891B2','#F59E0B','#10B981','#111E35'];
/* Highlighter pigment, not ink. Bright, weak and transparent — these are the
   colours a marker actually lays down, and they are chosen to stay legible
   under both multiply (light) and screen (dark). */
const HL_COLORS=['#FDE047','#86EFAC','#7DD3FC','#F9A8D4','#FDBA74'];
function paletteFor(tool){ return tool==='hl'?HL_COLORS:INK_COLORS; }`);

patch('ink: highlighter lays a flat band, and lifts rather than muddies in dark',
`const INK_TOOLS={pen:{w:2.6,alpha:1,comp:'source-over'},
                 hl:{w:15,alpha:.34,comp:'multiply'}};`,
`const INK_TOOLS={pen:{w:2.6,alpha:1,comp:'source-over'},
                 hl:{w:17,alpha:.40,comp:'multiply'}};
/* Multiply is right on paper and wrong on a dark card: it drives the text it
   is meant to lift toward black. Screen does the lifting instead. Resolved at
   paint time rather than stroke time, so the same saved stroke reads correctly
   in whichever theme you open it in later. */
function inkComp(cfg){
  if(cfg.comp!=='multiply') return cfg.comp;
  return document.documentElement.getAttribute('data-theme')==='dark'
    || (!document.documentElement.hasAttribute('data-theme')
        && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
    ? 'screen' : 'multiply';
}`);

patch('ink: paint() uses the theme-aware blend',
`    ctx.globalAlpha=cfg.alpha; ctx.globalCompositeOperation=cfg.comp;`,
`    ctx.globalAlpha=cfg.alpha; ctx.globalCompositeOperation=inkComp(cfg);`);

patch('ink: a marker keeps a near-constant width',
`      ctx.lineWidth=PencilFX.widthFor(cfg.w,b[2],b[3],sz);   // pressure + tilt + size → width`,
`      /* A chisel tip lays a near-constant band. Keeping the full pen response
         here made highlights look ragged rather than expressive, so the
         highlighter gets a heavily damped version of it. */
      ctx.lineWidth = s.t==='hl'
        ? cfg.w * (sz==='S'?0.62:sz==='L'?1.5:1) * (0.88 + (b[2]||.5)*0.24)
        : PencilFX.widthFor(cfg.w,b[2],b[3],sz);              // pressure + tilt + size → width`);

patch('rail: swatches follow the tool',
`    <div class="swatches">\${INK_COLORS.map(c=>
      \`<span class="sw\${T.color===c?' on':''}" data-c="\${c}" style="background:\${c}"></span>\`).join('')}</div>`,
`    <div class="swatches">\${paletteFor(T.tool).map(c=>
      \`<span class="sw\${T.color===c?' on':''}" data-c="\${c}" style="background:\${c}"></span>\`).join('')}</div>`);

/* Switching tool has to move the colour too, or you pick the highlighter and
   it is still loaded with pen red — which is precisely how it looked wrong. */
patch('rail: each tool remembers its own colour',
`function railAction(a){`,
`let toolColor={pen:INK_COLORS[0],hl:HL_COLORS[0]};
function selectTool(t){
  if(T.tool!==t){ toolColor[T.tool]=T.color; T.tool=t; T.color=toolColor[t]||paletteFor(t)[0]; }
  T.erase=false; T.active=true;
}
function railAction(a){`);

patch('rail: picking a tool loads that tool\'s own colour',
`  if(a==='pen'||a==='hl'){
    if(T.active&&!T.erase&&T.tool===a){ T.active=false; }
    else { T.tool=a; T.erase=false; T.active=true; }
  }`,
`  if(a==='pen'||a==='hl'){
    if(T.active&&!T.erase&&T.tool===a){ T.active=false; }
    else selectTool(a);
  }`);

/* And a swatch click has to file the colour under the tool it belongs to, or
   switching away and back loses it. */
patch('rail: a swatch files its colour under the current tool',
`  rail.querySelectorAll('[data-c]').forEach(s=>s.onclick=()=>{
    T.color=s.dataset.c; T.erase=false; T.active=true; buildRail(); syncInkMode();
  });`,
`  rail.querySelectorAll('[data-c]').forEach(s=>s.onclick=()=>{
    T.color=s.dataset.c; toolColor[T.tool]=T.color;
    T.erase=false; T.active=true; buildRail(); syncInkMode();
  });`);

/* ── 2. the Apex mark ────────────────────────────────────────────────────── */
patch('apex: the floating button carries the live avatar',
`<button class="ai-fab" id="aiFab" aria-label="Open the Apex tutor">
  <svg class="icon" aria-hidden="true"><use href="#i-heart-pulse"></use></svg> Apex</button>`,
`<button class="ai-fab" id="aiFab" aria-label="Open the Apex tutor">
  <canvas class="fab-av" id="apexFabAvatar" aria-hidden="true"></canvas> Apex</button>`);

patch('apex: mount it, and let it react to being touched',
`function dismissSplash(){`,
`/* The avatar was already built and already state-driven; the button just
   never used it. Mounting it here means the mark on screen is the same
   creature as the one in the panel header, running the same states. */
let fabAvatar=null;
function mountFabAvatar(){
  const cv=document.getElementById('apexFabAvatar');
  if(!cv||typeof Apex==='undefined') return;
  if(fabAvatar) return;
  fabAvatar=Apex.avatar(cv,{size:26});
  const fab=document.getElementById('aiFab');
  if(!fab) return;
  /* It should feel alive to the touch, not just animate at you. */
  fab.addEventListener('pointerenter',()=>fabAvatar&&fabAvatar.pulse(2));
  fab.addEventListener('pointerdown', ()=>fabAvatar&&fabAvatar.pulse(4));
}
/* Keep the mark in step with what Apex is actually doing. */
function setApexState(s){
  if(fabAvatar) fabAvatar.setState(s);
  if(typeof apexAvatar!=='undefined'&&apexAvatar) apexAvatar.setState(s);
}
function dismissSplash(){`);

patch('apex: start the mark at boot',
`(function boot(){
  dismissSplash();`,
`(function boot(){
  dismissSplash();
  mountFabAvatar();`);

patch('css: room for a live mark on the button',
`.ai-fab{position:fixed;right:max(14px,env(safe-area-inset-right));`,
`.fab-av{width:26px;height:26px;display:block;flex:none}
.ai-fab:active{transform:scale(.96)}
.ai-fab{transition:transform .12s var(--ease,ease),box-shadow .2s var(--ease,ease)}
.ai-fab:hover{box-shadow:0 10px 30px rgba(30,58,138,.44)}
.ai-fab{position:fixed;right:max(14px,env(safe-area-inset-right));`);

/* ── 3. the home screen ──────────────────────────────────────────────────── */
patch('css: hero stats reflow instead of wrapping raggedly',
`.hero-rhythm-label{margin-top:10px;font-family:var(--font-mono);font-size:11px;
  color:rgba(94,234,212,.78);letter-spacing:.02em}`,
`.hero-rhythm-label{margin-top:12px;font-family:var(--font-mono);font-size:11px;
  color:rgba(94,234,212,.78);letter-spacing:.02em}
/* The three stats were one inline run that broke mid-pair at narrow widths,
   leaving "638" on one line and "questions" on the next. A wrapping flex row
   with the dots as real separators keeps each pair together. */
.hero-line{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px}
.hero-line .hl-item{display:inline-flex;align-items:baseline;gap:5px;white-space:nowrap}
.hero-line .hl-dot{align-self:center}
@media(max-width:520px){ .hero-line .hl-dot{display:none} }`);

patch('css: the rhythm strip scales with the hero instead of a fixed band',
`.hero-ecg{position:absolute;left:0;right:0;bottom:0;height:62px;width:100%;`,
`/* 62px was a band lost against a tall hero on iPad and a wall on a phone.
   Scaling with the viewport keeps the trace the same visual weight either way,
   and the taller mask means the R waves are not clipped at the top. */
.hero-ecg{height:clamp(64px,9.5vw,104px)!important}
.hero-live{padding-bottom:clamp(76px,11vw,116px)!important}
.hero-ecg{position:absolute;left:0;right:0;bottom:0;height:62px;width:100%;`);

patch('css: the mini heart sits on a baseline with the strip',
`.heart-3d-mini{position:absolute;right:10px;top:6px;width:92px;height:98px;z-index:1;
  opacity:0;transition:opacity .5s var(--glide)}`,
`.heart-3d-mini{position:absolute;right:clamp(10px,2.4vw,22px);top:clamp(6px,1.6vw,16px);
  width:clamp(92px,12vw,124px);height:clamp(98px,13vw,132px);z-index:1;
  opacity:0;transition:opacity .5s var(--glide)}`);

fs.writeFileSync(OUT, html);
console.log(`Design pass applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
