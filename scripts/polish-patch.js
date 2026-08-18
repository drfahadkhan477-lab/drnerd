#!/usr/bin/env node
/*
 * Polish pass — Apple-Pencil-grade annotation, a real anatomical hero heart,
 * a rotating rhythm strip, and a bigger arrhythmia library.
 *
 *   node scripts/polish-patch.js <stage3-output.html> <output.html>
 *
 * Not a numbered roadmap stage (like the earlier heart/Apex work) — a
 * directed set of UX requests, applied together because they share code:
 * the rhythm registry the hero, Rhythm Lab, and the ECG engine all read
 * from, and the ink pipeline the Pencil work extends.
 *
 * PENCIL, closer to how Markup/Preview actually feels:
 *   - Width now responds to tilt as well as pressure — lay the Pencil flatter
 *     and the stroke broadens, the way graphite laid on its side does. A
 *     mouse or finger has no tilt, so this is a no-op for them.
 *   - Three named sizes (S/M/L) per tool, remembered per stroke (an old
 *     stroke with no size on it renders exactly as before — Medium
 *     reproduces the original fixed width, verified in pencil.js).
 *   - Auto-minimize is opt-in (a toggle in the rail, off by default): once
 *     on, the rail collapses a couple seconds after you lift the Pencil, and
 *     — the part that actually matches Markup — the next Pencil touch on a
 *     figure or the stem re-expands the rail AND starts the stroke in one
 *     motion, not two.
 *
 * HERO HEART: the flat SVG cartoon is replaced by a small instance of the
 * SAME anatomical Heart3D renderer Rhythm Lab uses — a coarser mesh, no
 * interaction, but genuinely the verified anatomy rather than a second
 * hand-drawn valentine shape in a different style. Falls back to the old SVG
 * heart if WebGL2 is unavailable, exactly like Rhythm Lab already does.
 *
 * HERO RHYTHM: the strip now rotates through a curated, non-repeating
 * playlist of arrhythmias every ~11s (seeded by today's accuracy, same as
 * before, then random) — deliberately excluding vfib/asystole from ambient
 * home-screen rotation; those stay teaching content you go looking for in
 * Rhythm Lab, not wallpaper. The mini heart's beat rate and the hero's own
 * heartSVG (fallback) resync to whatever rhythm is currently showing.
 *
 * RHYTHM LIBRARY: 15 more rhythms (rhythms-extra.js) — the AV blocks, the
 * common ectopy, WPW, the bundle branch blocks, hyperkalemia, long QT,
 * pericarditis — reachable everywhere the original 12 were: Rhythm Lab's
 * chip list, the hero rotation, and the underlying ECGMonitor used by the
 * one-shot answer-feedback blip.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC || !OUT) {
  console.error('usage: node scripts/polish-patch.js <stage3-output.html> <output.html>');
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

const ROOT = path.join(__dirname, '..');
const rhythmsExtra = fs.readFileSync(path.join(ROOT, 'src', 'core', 'rhythms-extra.js'), 'utf8');
const heroRhythm = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'heroRhythm.js'), 'utf8');
const pencilFx = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'pencil.js'), 'utf8');
const heart3d = fs.readFileSync(path.join(ROOT, 'src', 'core', 'heart3d.js'), 'utf8');

/* ────────────────────────────────────────────────────────────────────────────
 * 0. heart3d.js already embedded by the Apex patch predates two things this
 *    pass needs: the `target` option (to frame the mini hero heart without
 *    clipping it) and the blood-flow particle system (see the module's own
 *    header comment on that). The particle system alone is ~150 new lines
 *    threaded through several existing sections — surgically patching the
 *    already-embedded copy for that would mean a long chain of small,
 *    fragile find/replace calls against a huge blob. A single swap of the
 *    whole embedded module for the current src/core/heart3d.js is safer:
 *    one large but exact match, asserted unique like every other edit here.
 *
 *    _heart3d-embed-anchor-v16.js is a frozen copy of exactly what the Apex
 *    patch embedded into stage3 output (src/core/heart3d.js as it stood at
 *    that commit, plus the one-line wrapper comment the Apex patch put
 *    before it) — the `find` half of this edit. It's checked in rather than
 *    regenerated, because regenerating it requires the stage3 output file
 *    this script doesn't otherwise depend on; if a future change to
 *    heart3d.js needs re-embedding again, take a fresh anchor snapshot from
 *    whatever this patch step just replaced before editing the source further.
 * ──────────────────────────────────────────────────────────────────────────── */
const heart3dAnchor = fs.readFileSync(path.join(__dirname, '_heart3d-embed-anchor-v16.js'), 'utf8');
const heart3dWrapperComment = heart3dAnchor.slice(0, heart3dAnchor.indexOf('\n') + 1);
patch('heart3d: replace the whole embedded module (adds the target option and the blood-flow particle system)',
heart3dAnchor,
heart3dWrapperComment + heart3d);

/* ────────────────────────────────────────────────────────────────────────────
 * 1. Embed the new modules. This has to land BEFORE the ECG-engine section
 *    that defines RHYTHMS a few hundred lines down — that section runs at
 *    script-load time and, once this patch's edit 2 is applied, calls
 *    RhythmsExtra.EXTRA immediately. Anchoring after the existing
 *    Heart3D/Apex embed (itself already early, right after the icon()
 *    helper) keeps the load order correct without needing a second pass
 *    over the file to find where "early enough" is.
 * ──────────────────────────────────────────────────────────────────────────── */
patch('embed: rhythms-extra.js, heroRhythm.js, pencil.js — before RHYTHMS is defined',
`root.Apex = { avatar, IDENTITY, STATES };`,
`root.Apex = { avatar, IDENTITY, STATES };

/* ═══════════ More arrhythmias, hero rotation, Pencil feel — see src/core/rhythms-extra.js, src/ui/{heroRhythm,pencil}.js ═══════════ */
${rhythmsExtra}
${heroRhythm}
${pencilFx}`);

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Rhythm library: merge the new arrhythmias into the registry everything
 *    else reads from, and let the ECG engine's dispatcher draw them.
 * ──────────────────────────────────────────────────────────────────────────── */
patch('rhythms: merge the extra arrhythmias into the shared registry',
`const RHYTHM_KEYS=Object.keys(RHYTHMS);`,
`Object.assign(RHYTHMS, RhythmsExtra.EXTRA);   // AV blocks, ectopy, WPW, BBBs, K+/QT, pericarditis
const RHYTHM_KEYS=Object.keys(RHYTHMS);`);

patch('rhythms: the waveform dispatcher tries the extra set before its own switch',
`function rhythmMV(kind,tms,state){
  const R=RHYTHMS[kind]||RHYTHMS.sinus;
  const st=state||(state={});
  if(kind==='asystole') return Math.sin(tms/700)*0.008;`,
`function rhythmMV(kind,tms,state){
  const R=RHYTHMS[kind]||RHYTHMS.sinus;
  const st=state||(state={});
  const extra=RhythmsExtra.extraRhythmMV(kind,tms,st);
  if(extra!==null) return extra;
  if(kind==='asystole') return Math.sin(tms/700)*0.008;`);

/* ────────────────────────────────────────────────────────────────────────────
 * 3. Hero: a rotating rhythm, and a real anatomical heart in the corner
 * ──────────────────────────────────────────────────────────────────────────── */
patch('hero: markup gains a rhythm label and a mount point for the mini heart',
`      <div class="hero-inner">
        <div class="hero-greet">\${greet()}</div>
        <div class="hero-h1">ACCSAP 12</div>
        <div class="hero-line">
          <span class="hl-item"><b>\${TOTAL_Q}</b> questions</span>
          <span class="hl-dot"></span>
          <span class="hl-item"><b>\${covered}%</b> started</span>
          <span class="hl-dot"></span>
          <span class="hl-item"><b>\${today.a}</b> today</span>
        </div>
      </div>
      \${heartSVG('heroHeart')}
    </div>`,
`      <div class="hero-inner">
        <div class="hero-greet">\${greet()}</div>
        <div class="hero-h1">ACCSAP 12</div>
        <div class="hero-line">
          <span class="hl-item"><b>\${TOTAL_Q}</b> questions</span>
          <span class="hl-dot"></span>
          <span class="hl-item"><b>\${covered}%</b> started</span>
          <span class="hl-dot"></span>
          <span class="hl-item"><b>\${today.a}</b> today</span>
        </div>
        <div class="hero-rhythm-label" id="heroRhythmLabel">&nbsp;</div>
      </div>
      \${heartSVG('heroHeart')}
      <canvas id="heroHeart3d" class="heart-3d-mini" aria-hidden="true"></canvas>
    </div>`);

patch('hero: rotate through the rhythm playlist, drive the mini heart and the SVG fallback together',
`let heroMon=null;
function mountHero(){
  if(heroMon){ heroMon.destroy(); heroMon=null; }
  const cv=document.getElementById('heroECG');
  if(!cv) return;
  heroMon=new ECGMonitor(cv,{kind:heroRhythm(),speed:0.12,amp:34,lineWidth:2,color:'#5EEAD4'});
  heroMon.start();
}
/* the hero trace reflects how the day is going — a small, honest bit of feedback */
function heroRhythm(){
  const d=S.daily[todayISO()];
  if(!d||!d.a) return 'sinus';
  const acc=d.c/d.a;
  return acc>=0.8?'sinus':acc>=0.6?'sinus':'tachy';
}`,
`let heroMon=null, heroHeart3d=null, heroHeart3dCanvas=null, heroRotateTimer=null, heroCurrentKind=null;
function mountHero(){
  if(heroMon){ heroMon.destroy(); heroMon=null; }
  if(heroRotateTimer){ clearInterval(heroRotateTimer); heroRotateTimer=null; }
  const cv=document.getElementById('heroECG');
  if(!cv){
    if(heroHeart3d){ heroHeart3d.destroy(); heroHeart3d=null; heroHeart3dCanvas=null; }
    return;
  }
  heroCurrentKind=heroRhythm();
  heroMon=new ECGMonitor(cv,{kind:heroCurrentKind,speed:0.12,amp:34,lineWidth:2,color:'#5EEAD4'});
  heroMon.start();
  mountHeroHeart3d();
  paintHeroLabel(heroCurrentKind);
  heroRotateTimer=setInterval(()=>{
    heroCurrentKind=HeroRhythm.nextInPlaylist(heroCurrentKind);
    heroMon.setRhythm(heroCurrentKind);
    if(heroHeart3d) heroHeart3d.setRhythm(heroCurrentKind);
    setHeroBeatRate(heroCurrentKind);
    paintHeroLabel(heroCurrentKind);
  },11000);
}
/* Same identity-checked mount pattern as the lab heart (see mountLabHeart) —
   a screen-change render() can replace this canvas node out from under a
   running instance, so we compare nodes, not just check truthiness. Falls
   back to the flat SVG heart, already in the markup, if WebGL2 is missing. */
function mountHeroHeart3d(){
  const cv=document.getElementById('heroHeart3d');
  if(!cv||typeof Heart3D==='undefined'||!hasWebGL2()){
    document.getElementById('heroHeart')?.classList.remove('heart-3d-active');
    return;
  }
  if(heroHeart3d && heroHeart3dCanvas===cv) return;
  if(heroHeart3d){ heroHeart3d.destroy(); heroHeart3d=null; }
  const dark=document.documentElement.getAttribute('data-theme')==='dark'
    || (!document.documentElement.hasAttribute('data-theme')
        && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  heroHeart3d=Heart3D.create(cv,{rhythm:heroCurrentKind||'sinus',mode:'whole',dark,
    resolution:[40,52,32], distance:26, yaw:0.32, pitch:0.10, autoRotate:true});
  if(!heroHeart3d) return;
  heroHeart3dCanvas=cv;
  cv.style.pointerEvents='none';           // decorative — never eats a home-screen scroll
  document.getElementById('heroHeart')?.classList.add('heart-3d-active');
}
/* the fallback SVG's CSS beat animation is keyed to a fixed 1.1s regardless
   of what's on the trace — sync its duration to the rhythm actually showing,
   so a 150bpm flutter doesn't beat at the same rate as 44bpm bradycardia. */
function setHeroBeatRate(kind){
  const hr=(RHYTHMS[kind]||{}).hr;
  const beatEl=document.querySelector('#heroHeart .h-beat');
  if(beatEl) beatEl.style.animationDuration=HeroRhythm.beatDurationMs(hr)+'ms';
}
function paintHeroLabel(kind){
  const el=document.getElementById('heroRhythmLabel');
  if(!el) return;
  const r=RHYTHMS[kind]; if(!r) return;
  el.classList.remove('anim-in'); void el.offsetWidth; el.classList.add('anim-in');
  el.textContent=r.name+(r.hr?' · '+r.hr+' bpm':'');
  setHeroBeatRate(kind);
}
/* the hero's FIRST rhythm still reflects how the day is going — a small,
   honest bit of feedback — before the rotation takes over and shows variety */
function heroRhythm(){
  const d=S.daily[todayISO()];
  if(!d||!d.a) return 'sinus';
  const acc=d.c/d.a;
  return acc>=0.8?'sinus':acc>=0.6?'sinus':'tachy';
}`);

patch('render: mount/unmount the hero heart every render, mirroring the lab heart',
`  if(typeof mountLabHeart==='function') mountLabHeart();`,
`  if(typeof mountHeroHeart3d==='function') mountHeroHeart3d();
  if(typeof mountLabHeart==='function') mountLabHeart();`);

patch('theme: keep the hero heart in step with light/dark switches too',
`  if(typeof labHeart!=='undefined'&&labHeart) labHeart.setDark(S.theme==='dark'
    ||(S.theme==='auto'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches));
}`,
`  if(typeof labHeart!=='undefined'&&labHeart) labHeart.setDark(S.theme==='dark'
    ||(S.theme==='auto'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches));
  if(typeof heroHeart3d!=='undefined'&&heroHeart3d) heroHeart3d.setDark(S.theme==='dark'
    ||(S.theme==='auto'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches));
}`);

/* ────────────────────────────────────────────────────────────────────────────
 * 4. CSS: the mini heart, the rhythm label, the flame flicker, the Pencil
 *    rail's new size and auto-minimize controls
 * ──────────────────────────────────────────────────────────────────────────── */
patch('css: mini heart canvas, rhythm label, flame flicker',
`/* beating heart */
.heart-svg{position:absolute;right:16px;top:14px;width:74px;height:80px;opacity:.9;z-index:1}`,
`/* live rhythm label under the hero stats, crossfades on each rotation */
.hero-rhythm-label{margin-top:10px;font-family:var(--font-mono);font-size:11px;
  color:rgba(94,234,212,.78);letter-spacing:.02em}
.hero-rhythm-label.anim-in{animation:riseIn .4s var(--glide) both}

/* the real anatomical heart — same renderer as Rhythm Lab, coarser mesh,
   no interaction. Sits under the flat SVG fallback and is only shown once
   a WebGL2 context actually exists (see heart-3d-active). */
.heart-3d-mini{position:absolute;right:10px;top:6px;width:92px;height:98px;z-index:1;
  opacity:0;transition:opacity .5s var(--glide)}
#heroHeart.heart-3d-active ~ .heart-3d-mini{opacity:1}
#heroHeart.heart-3d-active{opacity:0;pointer-events:none}

/* streak flame — a small flicker so momentum reads as alive, not a static badge */
.fc-streak .icon{animation:flicker 2.2s ease-in-out infinite}
@keyframes flicker{
  0%,100%{transform:scale(1) translateY(0);opacity:1}
  30%{transform:scale(1.08) translateY(-0.5px);opacity:.88}
  55%{transform:scale(.95) translateY(0.5px);opacity:1}
  78%{transform:scale(1.05) translateY(-0.3px);opacity:.92}
}

/* beating heart */
.heart-svg{position:absolute;right:16px;top:14px;width:74px;height:80px;opacity:.9;z-index:1}`);

patch('css: pencil rail size picker and auto-minimize toggle',
`.pen-badge{font-size:9px;font-weight:700;letter-spacing:.04em;color:var(--green);
  text-align:center;text-transform:uppercase;padding-top:2px}`,
`.pen-badge{font-size:9px;font-weight:700;letter-spacing:.04em;color:var(--green);
  text-align:center;text-transform:uppercase;padding-top:2px}
.size-picker{display:flex;flex-direction:column;gap:7px;align-items:center;padding:2px 0}
.size-dot{border:none;padding:0;cursor:pointer;border-radius:50%;background:var(--muted);
  opacity:.45;transition:all .16s var(--ease)}
.size-dot.on{opacity:1;background:var(--teal);box-shadow:0 0 0 2px var(--teal-bg,#E6FBF7)}
.size-dot[data-sz="S"]{width:7px;height:7px}
.size-dot[data-sz="M"]{width:11px;height:11px}
.size-dot[data-sz="L"]{width:16px;height:16px}
.tool.auto-on{background:var(--teal-bg,#E6FBF7);border-color:var(--teal);color:var(--teal)}
.tool-auto{font-size:8.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase}`);

/* ────────────────────────────────────────────────────────────────────────────
 * 5. Pencil: tilt-aware width, per-stroke size, auto-minimize
 * ──────────────────────────────────────────────────────────────────────────── */
patch('pencil: T carries a persisted size and an opt-in auto-minimize flag',
`let T={tool:'pen',color:INK_COLORS[0],active:false,erase:false,
       // minimised by default — an unobtrusive floating pencil until tapped or the
       // Apple Pencil actually touches the glass (see attachInk's palm-rejection path)
       min:(()=>{try{const v=localStorage.getItem('accsap12.railmin');return v===null?true:v==='1';}catch(_){return true;}})()};`,
`let T={tool:'pen',color:INK_COLORS[0],active:false,erase:false,
       // minimised by default — an unobtrusive floating pencil until tapped or the
       // Apple Pencil actually touches the glass (see attachInk's palm-rejection path)
       min:(()=>{try{const v=localStorage.getItem('accsap12.railmin');return v===null?true:v==='1';}catch(_){return true;}})(),
       sizeKey:(()=>{try{return localStorage.getItem('accsap12.inksize')||'M';}catch(_){return 'M';}})(),
       autoMin:(()=>{try{return localStorage.getItem('accsap12.autominimize')==='1';}catch(_){return false;}})()};
let autoMinTimer=null;
function armAutoMinimize(){
  disarmAutoMinimize();
  if(!T.autoMin||T.min) return;
  autoMinTimer=PencilFX.armAutoMinimize(2400,()=>{ if(T.autoMin&&!T.min) railMin(true); });
}
function disarmAutoMinimize(){ if(autoMinTimer){ clearTimeout(autoMinTimer); autoMinTimer=null; } }`);

patch('pencil: roundPt keeps a 4th tilt component when one is present',
`function roundPt(p){
  return [Math.round(p[0]*1e4)/1e4, Math.round(p[1]*1e4)/1e4, Math.round(p[2]*100)/100];
}`,
`function roundPt(p){
  const out=[Math.round(p[0]*1e4)/1e4, Math.round(p[1]*1e4)/1e4, Math.round(p[2]*100)/100];
  if(p.length>3) out.push(Math.round(p[3]*100)/100);
  return out;
}`);

patch('pencil: paint() uses pressure AND tilt AND the stroke\'s own size',
`  function paint(s,r){
    const cfg=INK_TOOLS[s.t]||INK_TOOLS.pen;
    ctx.globalAlpha=cfg.alpha; ctx.globalCompositeOperation=cfg.comp;
    ctx.strokeStyle=s.c; ctx.lineCap='round'; ctx.lineJoin='round';
    const p=s.p;
    if(p.length===1){
      ctx.beginPath();
      ctx.arc(p[0][0]*r.width,p[0][1]*r.height,(cfg.w*(p[0][2]||.5)*1.2)/2,0,6.284);
      ctx.fillStyle=s.c; ctx.fill(); ctx.globalAlpha=1;
      ctx.globalCompositeOperation='source-over'; return;
    }
    for(let i=1;i<p.length;i++){
      const a=p[i-1],b=p[i];
      ctx.lineWidth=cfg.w*(0.45+(b[2]||.5)*1.25);        // pressure → width
      ctx.beginPath();
      ctx.moveTo(a[0]*r.width,a[1]*r.height);
      ctx.lineTo(b[0]*r.width,b[1]*r.height);
      ctx.stroke();
    }
    ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over';
  }`,
`  function paint(s,r){
    const cfg=INK_TOOLS[s.t]||INK_TOOLS.pen;
    const sz=s.sz||'M';                                  // strokes saved before this feature default to Medium, reproducing the old fixed width exactly
    ctx.globalAlpha=cfg.alpha; ctx.globalCompositeOperation=cfg.comp;
    ctx.strokeStyle=s.c; ctx.lineCap='round'; ctx.lineJoin='round';
    const p=s.p;
    if(p.length===1){
      ctx.beginPath();
      ctx.arc(p[0][0]*r.width,p[0][1]*r.height,PencilFX.widthFor(cfg.w,p[0][2],p[0][3],sz)*1.2/2,0,6.284);
      ctx.fillStyle=s.c; ctx.fill(); ctx.globalAlpha=1;
      ctx.globalCompositeOperation='source-over'; return;
    }
    for(let i=1;i<p.length;i++){
      const a=p[i-1],b=p[i];
      ctx.lineWidth=PencilFX.widthFor(cfg.w,b[2],b[3],sz);   // pressure + tilt + size → width
      ctx.beginPath();
      ctx.moveTo(a[0]*r.width,a[1]*r.height);
      ctx.lineTo(b[0]*r.width,b[1]*r.height);
      ctx.stroke();
    }
    ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over';
  }`);

patch('pencil: pos() captures Pencil tilt when Safari reports it',
`  function pos(e){
    const r=cv.getBoundingClientRect();
    return roundPt([(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height,
            e.pressure&&e.pressure>0?e.pressure:.5]);
  }`,
`  function pos(e){
    const r=cv.getBoundingClientRect();
    const tilt=(e.tiltX||e.tiltY)?PencilFX.tiltFactor(e.tiltX,e.tiltY):0;
    return roundPt([(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height,
            e.pressure&&e.pressure>0?e.pressure:.5, tilt]);
  }`);

patch('pencil: a Pencil touch on a minimized+auto rail expands it and starts the stroke in one motion',
`  cv.addEventListener('pointerdown',e=>{
    if(!T.active||!allow(e))return;
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    if(T.erase){ eraseAt(pos(e)); return; }
    cur={t:T.tool,c:T.color,p:[pos(e)]}; redraw();
  });`,
`  cv.addEventListener('pointerdown',e=>{
    disarmAutoMinimize();
    if(e.pointerType==='pen'&&T.min&&T.autoMin){ T.active=true; railMin(false); }
    if(!T.active||!allow(e))return;
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    if(T.erase){ eraseAt(pos(e)); return; }
    cur={t:T.tool,c:T.color,p:[pos(e)],sz:T.sizeKey}; redraw();
  });`);

patch('pencil: arm the auto-minimize countdown once a stroke ends',
`  function end(){
    if(cur&&cur.p.length){ strokes().push(simplifyStroke(cur)); saveJSON(INK_KEY,INK); }
    cur=null; redraw(); refreshRail();
  }`,
`  function end(){
    if(cur&&cur.p.length){ strokes().push(simplifyStroke(cur)); saveJSON(INK_KEY,INK); }
    cur=null; redraw(); refreshRail(); armAutoMinimize();
  }`);

/* ────────────────────────────────────────────────────────────────────────────
 * 6. Rail UI: size picker, auto-minimize toggle
 * ──────────────────────────────────────────────────────────────────────────── */
patch('rail: add the size picker and the auto-minimize toggle',
`  rail.innerHTML=\`
    <button class="tool rail-min" data-a="min" title="Minimise" aria-label="Minimise tools">\${icon('chevron-down')}</button>
    <div class="tool-sep"></div>
    <button class="tool\${T.active&&!T.erase&&T.tool==='pen'?' on':''}" data-a="pen"  title="Pen">\${icon('pencil')}</button>
    <button class="tool\${T.active&&!T.erase&&T.tool==='hl'?' on':''}"  data-a="hl"   title="Highlighter">\${icon('highlighter')}</button>
    <button class="tool danger\${T.erase?' on':''}" data-a="erase" title="Eraser">\${icon('eraser')}</button>
    <div class="tool-sep"></div>
    <div class="swatches">\${INK_COLORS.map(c=>
      \`<span class="sw\${T.color===c?' on':''}" data-c="\${c}" style="background:\${c}"></span>\`).join('')}</div>
    <div class="tool-sep"></div>
    <button class="tool" data-a="note" title="Sticky note">\${icon('sticky-note')}</button>
    <button class="tool" data-a="undo" title="Undo">\${icon('rotate-ccw')}</button>
    <button class="tool" data-a="clear" title="Clear this question">\${icon('trash')}</button>
    \${penSeen?\`<div class="pen-badge">\${icon('pencil','icon-sm')} pencil</div>\`:''}\`;
  rail.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>railAction(b.dataset.a));
  rail.querySelectorAll('[data-c]').forEach(s=>s.onclick=()=>{
    T.color=s.dataset.c; T.erase=false; T.active=true; buildRail(); syncInkMode();
  });
  return rail;
}`,
`  rail.innerHTML=\`
    <button class="tool rail-min" data-a="min" title="Minimise" aria-label="Minimise tools">\${icon('chevron-down')}</button>
    <button class="tool\${T.autoMin?' auto-on':''} tool-auto" data-a="automin"
        title="Auto-minimise after a couple seconds" aria-label="Toggle auto-minimise">Auto</button>
    <div class="tool-sep"></div>
    <button class="tool\${T.active&&!T.erase&&T.tool==='pen'?' on':''}" data-a="pen"  title="Pen">\${icon('pencil')}</button>
    <button class="tool\${T.active&&!T.erase&&T.tool==='hl'?' on':''}"  data-a="hl"   title="Highlighter">\${icon('highlighter')}</button>
    <button class="tool danger\${T.erase?' on':''}" data-a="erase" title="Eraser">\${icon('eraser')}</button>
    <div class="tool-sep"></div>
    <div class="swatches">\${INK_COLORS.map(c=>
      \`<span class="sw\${T.color===c?' on':''}" data-c="\${c}" style="background:\${c}"></span>\`).join('')}</div>
    <div class="tool-sep"></div>
    <div class="size-picker">\${PencilFX.SIZE_ORDER.map(k=>
      \`<button class="size-dot\${T.sizeKey===k?' on':''}" data-sz="\${k}" title="\${k==='S'?'Small':k==='M'?'Medium':'Large'}" aria-label="\${k==='S'?'Small':k==='M'?'Medium':'Large'} size"></button>\`).join('')}</div>
    <div class="tool-sep"></div>
    <button class="tool" data-a="note" title="Sticky note">\${icon('sticky-note')}</button>
    <button class="tool" data-a="undo" title="Undo">\${icon('rotate-ccw')}</button>
    <button class="tool" data-a="clear" title="Clear this question">\${icon('trash')}</button>
    \${penSeen?\`<div class="pen-badge">\${icon('pencil','icon-sm')} pencil</div>\`:''}\`;
  rail.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>railAction(b.dataset.a));
  rail.querySelectorAll('[data-c]').forEach(s=>s.onclick=()=>{
    T.color=s.dataset.c; T.erase=false; T.active=true; buildRail(); syncInkMode();
  });
  rail.querySelectorAll('[data-sz]').forEach(b=>b.onclick=()=>{
    T.sizeKey=b.dataset.sz; try{localStorage.setItem('accsap12.inksize',T.sizeKey);}catch(_){}
    buildRail();
  });
  return rail;
}`);

patch('rail: railAction handles the auto-minimize toggle and re-arms the countdown on activity',
`function railAction(a){
  if(a==='min'){ railMin(true); return; }
  if(a==='expand'){ railMin(false); return; }`,
`function railAction(a){
  if(a==='min'){ disarmAutoMinimize(); railMin(true); return; }
  if(a==='expand'){ railMin(false); return; }
  if(a==='automin'){
    T.autoMin=!T.autoMin;
    try{localStorage.setItem('accsap12.autominimize',T.autoMin?'1':'0');}catch(_){}
    if(T.autoMin) armAutoMinimize(); else disarmAutoMinimize();
    buildRail(); return;
  }`);

patch('rail: any tool action counts as activity — re-arm the countdown',
`  else if(a==='clear'){
    const q=currentQ(); if(!q)return;
    if(!confirm('Clear all ink and notes on this question?'))return;
    Object.keys(INK).filter(k=>k.startsWith(q.id+':')).forEach(k=>delete INK[k]);
    delete NOTES[q.id];
    saveJSON(INK_KEY,INK); saveJSON(NOTE_KEY,NOTES); repaintAll();
  }
  buildRail(); syncInkMode();
}`,
`  else if(a==='clear'){
    const q=currentQ(); if(!q)return;
    if(!confirm('Clear all ink and notes on this question?'))return;
    Object.keys(INK).filter(k=>k.startsWith(q.id+':')).forEach(k=>delete INK[k]);
    delete NOTES[q.id];
    saveJSON(INK_KEY,INK); saveJSON(NOTE_KEY,NOTES); repaintAll();
  }
  buildRail(); syncInkMode(); armAutoMinimize();
}`);

/* ────────────────────────────────────────────────────────────────────────────
 * 7. Rhythm Lab: the expanded chip list needs a bit more breathing room —
 *    no logic change, RHYTHM_KEYS already includes the new rhythms via the
 *    registry merge above; this is purely so 27 chips wrap tidily instead of
 *    fighting the fixed two-per-row assumption the original 12 were sized for.
 * ──────────────────────────────────────────────────────────────────────────── */
/* The stage is a square (aspect-ratio 1/1) capped by max-height, so on any
   viewport wider than it is tall the square is narrower than the panel — and
   a block element defaults to the left edge of it. On an iPad in portrait the
   panel is narrow enough that this never showed; on a laptop the heart sat in
   the left third of a wide white card. */
patch('css: centre the square heart stage in its panel',
`.lab-heart-stage{position:relative;aspect-ratio:1/1;max-height:46vh}`,
`.lab-heart-stage{position:relative;aspect-ratio:1/1;max-height:46vh;margin-inline:auto}`);

patch('css: let the (now much longer) rhythm chip list breathe',
`.chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 10px}`,
`.chips{display:flex;flex-wrap:wrap;gap:6px 8px;padding:0 14px 10px}`);

/* ──────────────────────────────────────────────────────────────────────────── */
fs.writeFileSync(OUT, html);
const before = fs.statSync(SRC).size, after = fs.statSync(OUT).size;
console.log(`Polish pass applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`\n${(before / 1048576).toFixed(2)} MB → ${(after / 1048576).toFixed(2)} MB`);
console.log(`written: ${OUT}`);
