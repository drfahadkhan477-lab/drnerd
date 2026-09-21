#!/usr/bin/env node
/*
 * Focus Mode: the quiz, without the chrome around it.
 *
 *   node scripts/focusmode-patch.js <in.html> <out.html>
 *
 * WHAT IT DOES, AND HOW LITTLE IT TAKES. #navbar is a single fixed header
 * outside the reading column, and ONE variable governs every consequence of
 * its height: .nav's own height, #shell's padding-top, and the Apex panel's
 * top/height all read --navh. So the whole feature is two declarations —
 * hide the bar, set --navh to 0 — and the shell and the tutor panel step up
 * on their own. --sat is deliberately NOT collapsed with it: on an installed
 * PWA that is the status bar's reserve, and content sliding under the clock
 * is not focus, it is a bug.
 *
 * WHY THE SCREEN TEST IS IN JS AND NOT IN CSS. #navbar is a SIBLING of #app,
 * not a descendant, so "hide the bar only on the quiz screen" cannot be
 * written against #app[data-screen="quiz"] with a descendant combinator. The
 * selector that would do it is :has(), which Safari gained in 15.4 — this app
 * supports 13.4 and tests/verify-ipad-pure.js enforces that floor. So
 * applyFocus() decides, sets data-focus on <html> when S.focusMode is on AND
 * the quiz is the screen, and removes it otherwise. No new selector
 * capability, and leaving the quiz turns it off by itself.
 *
 * TWO CONTROLS, EACH VISIBLE ONLY WHEN IT IS USABLE. The way in is an
 * icon-btn in the nav — which can only be reached while the nav is visible,
 * i.e. while focus is off. The way out therefore cannot live there, and it
 * cannot live in the quiz action row either: quiznav's row is
 * `reviewing ? '' : ...`, empty for a review question, which would strand a
 * fellow in a chrome-less screen with no way back. It is a fixed button in
 * the shell instead, shown only under [data-focus="1"], so it exists exactly
 * when it is needed and never otherwise.
 *
 * WHAT IT DOES NOT HIDE, ON PURPOSE. Not the progress bar — the point is to
 * keep knowing where you are. Not the confidence chips: those feed
 * calib.js's calibration record, so hiding them would quietly change what
 * gets measured, which is a behaviour change wearing a layout change's
 * clothes. Nothing here touches an option, a grade or a schedule.
 *
 * WHERE IT SITS IN THE CHAIN, AND WHY IT IS LAST. Its anchors come from
 * home(15), theme(14), fullbleed(34), quiznav(50), chapters(53) and
 * resume(79) — resume being the last patch to rewrite SCHEMA_KEYS. Anything
 * earlier than 80 would be reading text that a later step still rewrites, so
 * this goes at the end of CHAIN rather than beside the steps it resembles.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/focusmode-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 200)}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

/* ── 1. the state, seeded and persisted ───────────────────────────────────
   Both halves together, because tests/verify-schema.js asserts SCHEMA_KEYS
   is exactly what save() writes — a key in one and not the other fails it,
   which is the check doing its job. DATA_SCHEMA_VERSION is NOT bumped: the
   FOREIGN round-trip already carries an unknown key through an older build
   untouched, so adding a field costs no data, and the version only drives
   the "this copy is older than your data" toast. */
patch('focus: the preference is part of the saved state',
`  mode:'all',zoomed:-1,theme:boot.theme||'auto',homeLayout:boot.homeLayout||'signal'};`,
`  mode:'all',zoomed:-1,theme:boot.theme||'auto',homeLayout:boot.homeLayout||'signal',
  focusMode:!!boot.focusMode};`);

patch('focus: declared in the schema',
`const SCHEMA_KEYS=['schemaVersion','chStats','missed','theme','homeLayout',
  'sessionCorrect','sessionTotal','srs','reviewStreak','lastReviewDay','daily',
  'practice','sinceBackup','lastBackup','resume'];`,
`const SCHEMA_KEYS=['schemaVersion','chStats','missed','theme','homeLayout',
  'sessionCorrect','sessionTotal','srs','reviewStreak','lastReviewDay','daily',
  'practice','sinceBackup','lastBackup','resume','focusMode'];`);

patch('focus: written with the rest of it',
`  practice:S.practice,sinceBackup:S.sinceBackup,lastBackup:S.lastBackup,
  resume:S.resume})));}`,
`  practice:S.practice,sinceBackup:S.sinceBackup,lastBackup:S.lastBackup,
  resume:S.resume,focusMode:!!S.focusMode})));}`);

/* ── 2. the model ─────────────────────────────────────────────────────────
   Same shape as setTheme/setHomeLayout: assign, save, render. applyFocus is
   the applyTheme of this feature — it owns the attribute and nothing else
   sets it. */
patch('focus: applyFocus owns the attribute, toggleFocusMode owns the state',
`function applyTheme(){
  const h=document.documentElement, t=themeDef();
  if(t.mode==='auto')h.removeAttribute('data-theme'); else h.setAttribute('data-theme',t.mode);
  if(t.palette)h.setAttribute('data-palette',t.palette); else h.removeAttribute('data-palette');
  const m=document.querySelector('meta[name="theme-color"]');
  if(m)m.setAttribute('content', themeIsDark(t)? t.bar : '#0F1E3D');
}`,
`function applyTheme(){
  const h=document.documentElement, t=themeDef();
  if(t.mode==='auto')h.removeAttribute('data-theme'); else h.setAttribute('data-theme',t.mode);
  if(t.palette)h.setAttribute('data-palette',t.palette); else h.removeAttribute('data-palette');
  const m=document.querySelector('meta[name="theme-color"]');
  if(m)m.setAttribute('content', themeIsDark(t)? t.bar : '#0F1E3D');
}
/* ── focus mode ──
   The attribute goes on only while the preference is on AND the quiz is the
   screen, so walking away from the quiz restores the chrome without anything
   having to remember to. Called from renderNow()'s mount list, so every
   screen change re-decides it. */
function applyFocus(){
  const h=document.documentElement;
  if(S.focusMode && S.screen==='quiz') h.setAttribute('data-focus','1');
  else h.removeAttribute('data-focus');
}
function toggleFocusMode(){
  S.focusMode=!S.focusMode; save(); render();
}`);

patch('focus: re-decided on every render, beside the other mounts',
`  if(typeof mountHomeProgress==='function') mountHomeProgress();
  if(typeof mountChapterBars==='function') mountChapterBars();`,
`  if(typeof mountHomeProgress==='function') mountHomeProgress();
  if(typeof mountChapterBars==='function') mountChapterBars();
  if(typeof applyFocus==='function') applyFocus();`);

/* ── 3. the way in ────────────────────────────────────────────────────────
   Beside the theme picker, in the same icon-btn idiom, reusing the expand
   glyph apexpage-patch.js already added rather than inventing a second one.
   aria-pressed reports the state, and buildNav() re-runs on every render, so
   it cannot drift from S.

   ON THE QUIZ SCREEN ONLY, and that is not tidiness. applyFocus() applies
   the mode only while the quiz is the screen, so a button offered on Home
   would flip aria-pressed, save, re-render — and visibly do nothing at all,
   because there is no chrome to hide there yet. A control whose whole
   feedback is deferred to some later screen reads as broken. The
   `${flag ? html : ''}` form is resume-patch.js's, for .q-restart. */
patch('focus: a way in, on the screen it acts on',
`      <div class="theme-wrap">
        <button class="icon-btn" onclick="toggleThemeMenu(event)" title="Theme" aria-label="Choose a theme"
          aria-haspopup="menu" id="themeBtn">\${icon('palette')}</button>`,
`      \${S.screen==='quiz'?\`<button class="icon-btn" onclick="toggleFocusMode()" title="Focus mode"
        aria-label="Focus mode — hide the top bar while answering"
        aria-pressed="\${S.focusMode?'true':'false'}">\${icon('expand')}</button>\`:''}
      <div class="theme-wrap">
        <button class="icon-btn" onclick="toggleThemeMenu(event)" title="Theme" aria-label="Choose a theme"
          aria-haspopup="menu" id="themeBtn">\${icon('palette')}</button>`);

/* ── 4. the way out ───────────────────────────────────────────────────────
   Static markup in the shell, so it is outside everything render() replaces
   and cannot be lost to a screen change. The glyph is inlined rather than
   built with icon(): this is plain document markup, not a template literal,
   so ${} would not be interpolated here. The path is i-collapse's, copied
   from apexpage-patch.js. */
patch('focus: a way out that cannot be rendered away',
`<header id="navbar"></header>
<div id="shell">
  <div id="app"></div>`,
`<header id="navbar"></header>
<button id="focusExit" type="button" onclick="toggleFocusMode()" aria-label="Leave focus mode" title="Leave focus mode"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 9H9V4.5M19.5 9H15V4.5M4.5 15H9v4.5M19.5 15H15v4.5"/></svg></button>
<div id="shell">
  <div id="app"></div>`);

/* ── 5. the two declarations that are the whole feature ───────────────────
   html[data-focus="1"] is (0,1,1) against :root's (0,1,0), so --navh:0px
   wins over both the base declaration and the >=768px one without needing
   !important or source-order luck — the same way html[data-palette=...]
   already overrides :root throughout the theme system.

   44px for the exit, not the 40px the figure viewer's buttons use: this is
   the only control on the screen whose absence traps you, and it is being
   hit one-handed on a tablet. */
patch('focus: css — the bar goes, the space it held comes back',
`.nav{color:#fff;height:var(--navh);display:flex;align-items:center;
  justify-content:space-between;
  max-width:var(--measure);margin:0 auto;
  padding-left:max(20px,var(--sal));padding-right:max(20px,var(--sar))}`,
`.nav{color:#fff;height:var(--navh);display:flex;align-items:center;
  justify-content:space-between;
  max-width:var(--measure);margin:0 auto;
  padding-left:max(20px,var(--sal));padding-right:max(20px,var(--sar))}
/* Focus mode. #shell's padding-top and #ai's top/height are both calc()s over
   --navh, so zeroing it is all it takes for them to reclaim the space. --sat
   stays: that is the status bar, not the app's chrome. */
html[data-focus="1"]{--navh:0px}
html[data-focus="1"] #navbar{display:none}
#focusExit{display:none}
html[data-focus="1"] #focusExit{display:flex;align-items:center;justify-content:center;
  position:fixed;z-index:101;top:calc(var(--sat) + 10px);right:max(14px,var(--sar));
  width:44px;height:44px;border-radius:999px;cursor:pointer;
  border:1.5px solid var(--border);background:var(--card);color:var(--muted);
  box-shadow:var(--e1);transition:transform .13s var(--ease)}
html[data-focus="1"] #focusExit:active{transform:scale(.94)}
html[data-focus="1"] #focusExit svg{width:19px;height:19px;
  fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('focusmode-patch applied:');
edits.forEach(e => console.log('  ✓ ' + e));
