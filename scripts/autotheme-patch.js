#!/usr/bin/env node
/*
 * "Auto" notices the system changing its mind.
 *
 *   node scripts/autotheme-patch.js <input.html> <output.html>
 *
 * Auto is the default theme, and until now it only followed the system at the
 * moment the page loaded. themeIsDark() reads the media query when something
 * asks it; nothing was listening for it to change. So when iPadOS flips to
 * dark at sunset with the app already open:
 *
 *   · The CSS follows, because auto leaves data-theme off the root and the
 *     stylesheet's own @media (prefers-color-scheme: dark) block takes over.
 *     That much always worked, which is exactly why the rest was easy to miss.
 *   · The three canvas renderers do NOT. The WebGL heart, the 12-lead and the
 *     cardiac cycle each hold their own palette and are told about a change
 *     through notifyThemeRenderers(), which is only ever called by setTheme().
 *     Nobody picked a theme, so nobody called it, so they stayed light on a
 *     dark page.
 *   · And <meta name="theme-color"> keeps whatever applyTheme() last set, so
 *     the status bar behind an installed app stays the wrong colour.
 *
 * The fix is one listener and no new state: on a change, do exactly what
 * setTheme() does minus the saving and the menu — applyTheme(), render(),
 * notifyThemeRenderers() — and only while the chosen theme actually defers to
 * the system. Picking Midnight explicitly means the sun going down is none of
 * the app's business.
 *
 * addEventListener on a MediaQueryList is the modern spelling; Safari only
 * gained it in 14. addListener is the deprecated one that works further back,
 * and it costs one line to try both rather than assume.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/autotheme-patch.js <input.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── 1. one place that knows whether the system is in charge ─────────────── */
patch('autotheme: a theme that defers to the system, and one that does not',
`function setTheme(id){`,
`/* True only while the chosen theme has no opinion of its own. Every other
   theme is a decision, and a decision is not revisited because the sun set. */
function themeFollowsSystem(){
  const t=themeDef();
  return !t || t.mode==='auto';
}
/* Everything setTheme does except the two things that would be wrong here:
   it does not save (nothing was chosen) and it does not close the menu
   (nothing was opened). */
function themeSystemChanged(){
  if(!themeFollowsSystem()) return;
  applyTheme();
  try{ render(); }catch(_){}
  notifyThemeRenderers();
}
function watchSystemTheme(){
  if(!window.matchMedia) return null;
  const mq=window.matchMedia('(prefers-color-scheme: dark)');
  if(!mq) return null;
  /* addEventListener on a MediaQueryList landed in Safari 14; addListener is
     the deprecated spelling that works before it. Trying both costs a line. */
  if(mq.addEventListener) mq.addEventListener('change',themeSystemChanged);
  else if(mq.addListener) mq.addListener(themeSystemChanged);
  return mq;
}
function setTheme(id){`);

/* ── 2. start listening once the app exists ──────────────────────────────── */
patch('autotheme: and start listening',
`applyTheme();
render();`,
`applyTheme();
/* After applyTheme so the first paint is already right, and before render so
   a flip during boot is not missed. */
watchSystemTheme();
render();`);

fs.writeFileSync(OUT, html);
console.log(`Auto follows the system — ${applied.length} edits applied`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
