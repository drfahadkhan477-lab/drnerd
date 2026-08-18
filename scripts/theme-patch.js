#!/usr/bin/env node
/*
 * A theme system: several curated palettes, and a picker to choose them.
 *
 *   node scripts/theme-patch.js <name-output.html> <output.html>
 *
 * The app had a three-way light / dark / auto toggle. This keeps that axis —
 * dark is still dark — but adds a second one: the palette, a named character
 * for the colour. Eight presets in all, each a pairing of a mode with a
 * palette, and none of them fighting the eye:
 *
 *   Auto · Daylight · Slate · Parchment   — light, cool to warm
 *   Midnight · Nocturne · Cath Lab · Monitor — dark, blue to violet to amber to phosphor
 *
 * WHY IT IS BUILT THIS WAY. Every existing component style keys on
 * data-theme=dark|light, so that attribute stays exactly the mode it always
 * was and nothing downstream has to change. The palette rides on a separate
 * data-palette attribute that overrides only the core colour tokens — the
 * accent family, the surfaces, and the hero's own gradient — for each mode it
 * applies in. So a palette is a small, legible block, not a second copy of the
 * whole stylesheet, and the two axes compose instead of multiplying.
 *
 * EYE COMFORT IS A CONSTRAINT, NOT A GARNISH. No palette uses pure black or
 * pure white; body text holds a high contrast ratio on every one; accent
 * saturation is kept off the maximum so a screen read for an hour at 2 a.m.
 * does not glare. The semantic colours — green for the right answer, red for
 * the wrong one — are deliberately NOT themed, so what they mean never shifts
 * underneath you.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/theme-patch.js <name-output.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 200)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── 1. the palettes, and the new hero tokens they can reach ──────────────── */
patch('css: palette token blocks',
`.icon-btn{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);color:#fff;`,
`/* ═══════════ Themes — palette overrides on the data-palette axis ═══════════
   Defaults for the hero's own surfaces live in :root and the dark block below,
   so a palette need only restate what it changes. */
:root{
  --hero-a:#0B1B33;--hero-b:#0E2947;--hero-c:#0A1628;
  --hero-edge:rgba(94,234,212,.16);
  --aura-1:rgba(94,234,212,.20);--aura-2:rgba(56,189,248,.18);--aura-3:rgba(129,140,248,.15);
  --hero-accent:#5EEAD4;
}
html[data-theme="light"]{
  --hero-a:#12243F;--hero-b:#173A5E;--hero-c:#0F1E3D;
}

/* Slate — cool desaturated indigo on paper-white. The quietest of the light
   themes; nothing in it is fully saturated. */
html[data-palette="slate"]{
  --bg:#EDF0F6;--card:#FFFFFF;--white:#FFFFFF;
  --border:#D3D9E6;--border2:#E7EBF3;--border3:#C3CBDC;
  --text:#1E2536;--muted:#4B5568;--dim:#8A93A6;--faint:#CBD2E0;
  --teal:#4F5BD5;--teal2:#6366F1;--teal3:#C7D0FA;--teal4:#EDEFFD;
  --navy:#1E1B4B;--navy2:#312E81;--navy3:#3730A3;
  --shadow-glow:0 0 0 3px rgba(99,102,241,.16);
  --hero-a:#232056;--hero-b:#312E81;--hero-c:#1B1840;
  --hero-edge:rgba(129,140,248,.22);
  --aura-1:rgba(129,140,248,.22);--aura-2:rgba(99,102,241,.18);--aura-3:rgba(56,189,248,.12);
  --hero-accent:#A5B4FC;
}

/* Parchment — warm paper and teak ink. Made for long reading; the warm ground
   is what makes it restful rather than the colour of the type. */
html[data-palette="parchment"]{
  --bg:#F3ECDD;--card:#FBF6EC;--white:#FBF6EC;
  --border:#E2D7C2;--border2:#EFE7D6;--border3:#D6C8AF;
  --text:#372E20;--muted:#6A5B45;--dim:#9A8B72;--faint:#D8CBB2;
  --teal:#0E7C86;--teal2:#12919B;--teal3:#A9DAD6;--teal4:#E6F2EF;
  --navy:#2C2418;--navy2:#3E3320;--navy3:#524327;
  --green-bg:#EAF3E6;--green-b:#B7D8A8;--red-bg:#F7EAE4;--red-b:#E6C3B2;
  --amber-bg:#F6EEDC;--amber-b:#E0CDA0;--warn-bg:#F6EEDC;--warn-b:#E0CDA0;
  --shadow-glow:0 0 0 3px rgba(14,124,134,.16);
  --hero-a:#2B2419;--hero-b:#3A3121;--hero-c:#241E14;
  --hero-edge:rgba(18,145,155,.22);
  --aura-1:rgba(18,145,155,.20);--aura-2:rgba(217,155,60,.16);--aura-3:rgba(120,90,50,.14);
  --hero-accent:#63D6C8;
}

/* Nocturne — deep indigo-violet night. Elegant, and gentler on the eye at
   night than a blue-heavy dark because the accent carries the colour, not the
   background. */
html[data-theme="dark"][data-palette="nocturne"]{
  --bg:#0E0B1A;--card:#17132B;--white:#17132B;
  --border:#2A2348;--border2:#231D3E;--border3:#332B56;
  --text:#EDE9F7;--muted:#A79FC4;--dim:#6E6690;--faint:#362E52;
  --teal:#A78BFA;--teal2:#C4B5FD;--teal3:#4A3D7C;--teal4:#221B40;
  --navy:#1E1B4B;--navy2:#2E2760;--navy3:#3A2F7A;
  --shadow-glow:0 0 0 3px rgba(167,139,250,.20);
  --hero-a:#1A1533;--hero-b:#2A2160;--hero-c:#130E28;
  --hero-edge:rgba(167,139,250,.22);
  --aura-1:rgba(167,139,250,.22);--aura-2:rgba(139,92,246,.18);--aura-3:rgba(99,102,241,.14);
  --hero-accent:#C4B5FD;
}

/* Cath Lab — tungsten amber on a near-black warm brown, the colour of a
   fluoroscopy suite with the lights down. */
html[data-theme="dark"][data-palette="cathlab"]{
  --bg:#120C07;--card:#1D140B;--white:#1D140B;
  --border:#3A2A18;--border2:#2C1F12;--border3:#463320;
  --text:#F5EDE1;--muted:#C6AF93;--dim:#8C775D;--faint:#3A2C1C;
  --teal:#F59E0B;--teal2:#FBBF24;--teal3:#5A3E12;--teal4:#2A1E08;
  --navy:#2A1B0C;--navy2:#3E2A12;--navy3:#523618;
  --shadow-glow:0 0 0 3px rgba(245,158,11,.20);
  --hero-a:#241708;--hero-b:#3A2610;--hero-c:#190F05;
  --hero-edge:rgba(245,158,11,.22);
  --aura-1:rgba(245,158,11,.22);--aura-2:rgba(251,191,36,.16);--aura-3:rgba(180,83,9,.16);
  --hero-accent:#FBBF24;
}

/* Monitor — phosphor mint on deep charcoal-green, the bedside monitor. The
   accent is minted well clear of the emerald that means 'correct', so the two
   greens never read as the same thing. */
html[data-theme="dark"][data-palette="monitor"]{
  --bg:#08110D;--card:#0F1A15;--white:#0F1A15;
  --border:#1E3328;--border2:#16271E;--border3:#264234;
  --text:#E6F4EC;--muted:#93B7A4;--dim:#5F8571;--faint:#26382F;
  --teal:#2DD4BF;--teal2:#5EEAD4;--teal3:#14503F;--teal4:#082820;
  --navy:#0E2A1E;--navy2:#124030;--navy3:#175540;
  --shadow-glow:0 0 0 3px rgba(45,212,191,.20);
  --hero-a:#0A1F16;--hero-b:#103828;--hero-c:#07160F;
  --hero-edge:rgba(45,212,191,.22);
  --aura-1:rgba(45,212,191,.22);--aura-2:rgba(94,234,212,.16);--aura-3:rgba(16,185,129,.14);
  --hero-accent:#5EEAD4;
}

.icon-btn{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);color:#fff;`);

/* ── 2. let the hero read those tokens instead of hard-coding navy ─────────── */
patch('css: the hero greeting follows the accent',
`.hero-greet{font-size:12.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  color:rgba(94,234,212,.85);`,
`.hero-greet{font-size:12.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  color:color-mix(in srgb,var(--hero-accent) 88%,transparent);`);

patch('css: the rhythm label follows the accent too',
`.hero-rhythm-label{margin-top:12px;font-family:var(--font-mono);font-size:11px;
  color:rgba(94,234,212,.78);letter-spacing:.02em}`,
`.hero-rhythm-label{margin-top:12px;font-family:var(--font-mono);font-size:11px;
  color:color-mix(in srgb,var(--hero-accent) 82%,transparent);letter-spacing:.02em}`);

patch('js: the hero ECG strip is drawn in the theme accent',
`heroMon=new ECGMonitor(cv,{kind:heroCurrentKind,speed:0.12,amp:34,lineWidth:2,color:'#5EEAD4'});`,
`/* Read the accent off the page rather than hard-coding mint, so the strip is
     the same colour as the greeting above it under every theme. render() remounts
     the hero on a theme change, so a fresh read here is all it takes to follow. */
  const heroAccent=(getComputedStyle(document.documentElement).getPropertyValue('--hero-accent')||'#5EEAD4').trim();
  heroMon=new ECGMonitor(cv,{kind:heroCurrentKind,speed:0.12,amp:34,lineWidth:2,color:heroAccent});`);

patch('css: hero gradient and edge from tokens',
`  background:linear-gradient(145deg,#0B1B33 0%,#0E2947 48%,#0A1628 100%);
  border:1px solid rgba(94,234,212,.16);
  box-shadow:0 18px 50px rgba(3,10,22,.5),inset 0 1px 0 rgba(255,255,255,.05)}
html[data-theme="light"] .hero-live{
  background:linear-gradient(145deg,#12243F 0%,#173A5E 48%,#0F1E3D 100%)}`,
`  background:linear-gradient(145deg,var(--hero-a) 0%,var(--hero-b) 48%,var(--hero-c) 100%);
  border:1px solid var(--hero-edge);
  box-shadow:0 18px 50px rgba(3,10,22,.5),inset 0 1px 0 rgba(255,255,255,.05)}`);

patch('css: aurora from tokens',
`    radial-gradient(30% 40% at 15% 20%,rgba(94,234,212,.20),transparent 65%),
    radial-gradient(28% 36% at 85% 12%,rgba(56,189,248,.18),transparent 62%),
    radial-gradient(40% 46% at 60% 92%,rgba(129,140,248,.15),transparent 66%);`,
`    radial-gradient(30% 40% at 15% 20%,var(--aura-1),transparent 65%),
    radial-gradient(28% 36% at 85% 12%,var(--aura-2),transparent 62%),
    radial-gradient(40% 46% at 60% 92%,var(--aura-3),transparent 66%);`);

/* ── 3. the picker UI ─────────────────────────────────────────────────────── */
patch('css: the theme picker menu',
`.icon-btn:active{background:rgba(255,255,255,.26)}`,
`.icon-btn:active{background:rgba(255,255,255,.26)}
.theme-wrap{position:relative}
.theme-menu{position:absolute;top:44px;right:0;z-index:120;width:236px;
  background:var(--card);border:1px solid var(--border);border-radius:14px;
  box-shadow:var(--e4);padding:7px;opacity:0;transform:translateY(-6px) scale(.98);
  transform-origin:top right;pointer-events:none;
  transition:opacity .16s var(--ease),transform .16s var(--ease)}
.theme-menu.open{opacity:1;transform:none;pointer-events:auto}
.theme-menu-h{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  color:var(--dim);padding:6px 9px 4px}
.theme-opt{display:flex;align-items:center;gap:10px;width:100%;padding:8px 9px;border:none;
  background:none;border-radius:9px;cursor:pointer;text-align:left;color:var(--text);
  font-family:inherit;font-size:13.5px;font-weight:600;transition:background .13s var(--ease)}
@media(hover:hover){.theme-opt:hover{background:var(--border2)}}
.theme-opt.on{background:color-mix(in srgb,var(--teal) 12%,transparent)}
.theme-sw{width:22px;height:22px;border-radius:7px;flex:none;border:1px solid rgba(255,255,255,.14);
  box-shadow:inset 0 1px 2px rgba(0,0,0,.25)}
.theme-opt .tk{flex:1 1 auto}
.theme-opt .tc{color:var(--teal);opacity:0;transition:opacity .13s var(--ease)}
.theme-opt.on .tc{opacity:1}
.theme-opt .tc .icon{width:16px;height:16px}`);

patch('js: the button becomes a picker',
`      <button class="icon-btn" onclick="cycleTheme()" title="Theme: \${S.theme}" aria-label="Change theme">\${THEME_ICON[S.theme]}</button>
    </div>
  </nav>\`;`,
`      <div class="theme-wrap">
        <button class="icon-btn" onclick="toggleThemeMenu(event)" title="Theme" aria-label="Choose a theme"
          aria-haspopup="menu" id="themeBtn">\${icon('palette')}</button>
        <div class="theme-menu" id="themeMenu" role="menu" aria-label="Theme">
          <div class="theme-menu-h">Light</div>
          \${THEMES.filter(t=>t.group==='light').map(themeOptHtml).join('')}
          <div class="theme-menu-h">Dark</div>
          \${THEMES.filter(t=>t.group==='dark').map(themeOptHtml).join('')}
        </div>
      </div>
    </div>
  </nav>\`;`);

/* ── 4. the model and its wiring ──────────────────────────────────────────── */
patch('js: themes replace the light/dark/auto toggle',
`/* ── theme ── */
function applyTheme(){
  const h=document.documentElement;
  if(S.theme==='auto')h.removeAttribute('data-theme');
  else h.setAttribute('data-theme',S.theme);
  const m=document.querySelector('meta[name="theme-color"]');
  if(m)m.setAttribute('content',S.theme==='light'?'#0F1E3D':'#0A1628');
}
function cycleTheme(){
  S.theme=S.theme==='auto'?'light':S.theme==='light'?'dark':'auto';
  applyTheme();save();render();
  if(typeof labHeart!=='undefined'&&labHeart) labHeart.setDark(S.theme==='dark'
    ||(S.theme==='auto'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches));
  if(typeof heroHeart3d!=='undefined'&&heroHeart3d) heroHeart3d.setDark(S.theme==='dark'
    ||(S.theme==='auto'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches));
  if(typeof twelve!=='undefined'&&twelve) twelve.setDark(S.theme==='dark'
    ||(S.theme==='auto'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches));
  if(typeof physio!=='undefined'&&physio) physio.setDark(S.theme==='dark'
    ||(S.theme==='auto'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches));
}
const THEME_ICON={auto:icon('sun-moon'),light:icon('sun'),dark:icon('moon')};`,
`/* ── theme ──
   A theme is a mode (which drives every existing component style) paired with
   a palette (which recolours the core tokens). 'auto' follows the system.
   The swatch is the two colours the eye reads first: the ground, and the
   accent laid over it. */
const THEMES=[
  {id:'auto',     name:'Auto',      group:'light', mode:'auto',  palette:null,        bg:'#EFF3F8',ac:'#0284C7',bar:'#0A1628'},
  {id:'daylight', name:'Daylight',  group:'light', mode:'light', palette:null,        bg:'#EFF3F8',ac:'#0284C7',bar:'#0F1E3D'},
  {id:'slate',    name:'Slate',     group:'light', mode:'light', palette:'slate',     bg:'#EDF0F6',ac:'#6366F1',bar:'#0F1E3D'},
  {id:'parchment',name:'Parchment', group:'light', mode:'light', palette:'parchment', bg:'#F3ECDD',ac:'#0E7C86',bar:'#0F1E3D'},
  {id:'midnight', name:'Midnight',  group:'dark',  mode:'dark',  palette:null,        bg:'#0A1628',ac:'#0EA5E9',bar:'#0A1628'},
  {id:'nocturne', name:'Nocturne',  group:'dark',  mode:'dark',  palette:'nocturne',  bg:'#0E0B1A',ac:'#A78BFA',bar:'#0E0B1A'},
  {id:'cathlab',  name:'Cath Lab',  group:'dark',  mode:'dark',  palette:'cathlab',   bg:'#120C07',ac:'#F59E0B',bar:'#120C07'},
  {id:'monitor',  name:'Monitor',   group:'dark',  mode:'dark',  palette:'monitor',   bg:'#08110D',ac:'#2DD4BF',bar:'#08110D'},
];
const THEME_BY_ID=Object.fromEntries(THEMES.map(t=>[t.id,t]));
/* Old saved values (auto/light/dark) are still valid ids, except the bare
   'dark' which is now 'midnight' and 'light' which is now 'daylight'. */
function themeDef(){ return THEME_BY_ID[S.theme]||THEME_BY_ID[{dark:'midnight',light:'daylight'}[S.theme]]||THEME_BY_ID.auto; }
function themeIsDark(t){
  t=t||themeDef();
  if(t.mode==='dark')return true;
  if(t.mode==='light')return false;
  return !!(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);
}
function applyTheme(){
  const h=document.documentElement, t=themeDef();
  if(t.mode==='auto')h.removeAttribute('data-theme'); else h.setAttribute('data-theme',t.mode);
  if(t.palette)h.setAttribute('data-palette',t.palette); else h.removeAttribute('data-palette');
  const m=document.querySelector('meta[name="theme-color"]');
  if(m)m.setAttribute('content', themeIsDark(t)? t.bar : '#0F1E3D');
}
function notifyThemeRenderers(){
  const d=themeIsDark();
  if(typeof labHeart!=='undefined'&&labHeart) labHeart.setDark(d);
  if(typeof heroHeart3d!=='undefined'&&heroHeart3d) heroHeart3d.setDark(d);
  if(typeof twelve!=='undefined'&&twelve) twelve.setDark(d);
  if(typeof physio!=='undefined'&&physio) physio.setDark(d);
}
function setTheme(id){
  S.theme=id; applyTheme(); save();
  closeThemeMenu(); render(); notifyThemeRenderers();
}
/* Kept so anything still calling it (or a keyboard shortcut) advances sensibly
   through the presets rather than throwing. */
function cycleTheme(){
  const i=THEMES.findIndex(t=>t.id===themeDef().id);
  setTheme(THEMES[(i+1)%THEMES.length].id);
}
function themeOptHtml(t){
  const on=themeDef().id===t.id;
  return \`<button class="theme-opt\${on?' on':''}" role="menuitemradio" aria-checked="\${on}"
    onclick="setTheme('\${t.id}')">
    <span class="theme-sw" style="background:linear-gradient(135deg,\${t.bg} 0 55%,\${t.ac} 55% 100%)"></span>
    <span class="tk">\${e(t.name)}</span>
    <span class="tc">\${icon('check')}</span></button>\`;
}
let __themeMenuOpen=false, __themeMenuOff=null;
function toggleThemeMenu(ev){
  if(ev) ev.stopPropagation();
  __themeMenuOpen ? closeThemeMenu() : openThemeMenu();
}
function openThemeMenu(){
  const m=document.getElementById('themeMenu'); if(!m) return;
  m.classList.add('open'); __themeMenuOpen=true;
  /* one-shot: the next click anywhere outside dismisses it */
  __themeMenuOff=ev=>{ if(!m.contains(ev.target)&&ev.target.id!=='themeBtn') closeThemeMenu(); };
  setTimeout(()=>document.addEventListener('click',__themeMenuOff,{once:false}),0);
}
function closeThemeMenu(){
  const m=document.getElementById('themeMenu'); if(m) m.classList.remove('open');
  __themeMenuOpen=false;
  if(__themeMenuOff){ document.removeEventListener('click',__themeMenuOff); __themeMenuOff=null; }
}`);

/* ── 5. the pre-paint boot fallback learns the new ids ────────────────────── */
patch('boot: adopt the saved theme without a flash, presets and all',
`try{var _t=(JSON.parse(localStorage.getItem('accsap12.v2')||'{}')||{}).theme;
    if(_t&&_t!=='auto')document.documentElement.setAttribute('data-theme',_t);}catch(_e){}</script>`,
`try{var _t=(JSON.parse(localStorage.getItem('accsap12.v2')||'{}')||{}).theme||'auto';
  var _M={auto:['',''],light:['light',''],daylight:['light',''],slate:['light','slate'],
    parchment:['light','parchment'],dark:['dark',''],midnight:['dark',''],
    nocturne:['dark','nocturne'],cathlab:['dark','cathlab'],monitor:['dark','monitor']};
  var _p=_M[_t]||['',''], _h=document.documentElement;
  if(_p[0])_h.setAttribute('data-theme',_p[0]);
  if(_p[1])_h.setAttribute('data-palette',_p[1]);
}catch(_e){}</script>`);

fs.writeFileSync(OUT, html);
console.log(`Theme system applied — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
