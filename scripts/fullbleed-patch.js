#!/usr/bin/env node
/*
 * On an iPad it should look like an app, not like a page in a window.
 *
 *   node scripts/fullbleed-patch.js <input.html> <output.html>
 *
 * Added to the Home Screen, iPadOS gives a web app the entire display and
 * draws the status bar over it. Systole did not take it. The navigation bar
 * lived inside #app, which is a reading measure — 960px at most, centred — so
 * on a 1366px iPad in landscape the navy bar was a floating strip with 203px
 * of page background showing on either side. On a phone it reached both edges
 * and looked right; on the device this was built for, it looked like a browser
 * with the chrome hidden.
 *
 * THE MEASURE IS NOT THE BUG. A question stem set 1366px wide is unreadable,
 * and every native iPad app that shows prose keeps a column: Books, Notes and
 * Mail all do. What they also do is take the chrome to the edges. So the bar's
 * COLOUR now spans the viewport while its CONTENTS keep the measure, and the
 * wordmark still lines up with the content beneath it.
 *
 * Which means lifting it out of #app. renderNow() wrote buildNav() into the
 * same element as the screen, so the bar could never be wider than the column.
 * It now paints into a fixed header of its own — fixed rather than sticky
 * because a fixed element spans the viewport without 100vw, and 100vw includes
 * the scrollbar, which would have added a horizontal scroll on a desktop.
 *
 * AND THE STRIP THE CLOCK SITS IN. The status bar is drawn OVER the page, and
 * nothing had reserved room for it: viewport-fit=cover and a translucent
 * status bar were already asked for, but no rule anywhere mentioned
 * safe-area-inset-top, so the bar's contents ran under the clock and the
 * battery. The insets are named as variables rather than written as env() at
 * each site, so a test can set a real inset and watch the chrome move — env()
 * itself cannot be simulated.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/fullbleed-patch.js <input.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── 1. a header of its own ──────────────────────────────────────────────── */
patch('chrome: the bar gets an element outside the reading column',
`<div id="shell">
  <div id="app"></div>`,
`<header id="navbar"></header>
<div id="shell">
  <div id="app"></div>`);

patch('chrome: and is rendered into it',
`  app.innerHTML=buildNav()+buildScreen();`,
`  /* The bar is painted into its own fixed header rather than into the screen:
     inside #app it could never be wider than the reading column. */
  const bar=document.getElementById('navbar');
  if(bar) bar.innerHTML=buildNav(); 
  app.innerHTML=buildScreen();`);

/* ── 2. the insets, named ────────────────────────────────────────────────── */
patch('chrome: name the safe areas so they can be reasoned about and tested',
`*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlig`,
`/* The display's own edges, named once. iPadOS draws the status bar OVER a
   standalone web app — that is what makes it full screen — so the page has to
   reserve the strip it sits in. Written as variables rather than env() at each
   site because env() cannot be given a value in a test, and a variable can. */
:root{
  --sat:env(safe-area-inset-top,0px);
  --sab:env(safe-area-inset-bottom,0px);
  --sal:env(safe-area-inset-left,0px);
  --sar:env(safe-area-inset-right,0px);
  /* The reading measure, in one place. #app and the bar's contents both use
     it, which is what keeps the wordmark above the column it belongs to. */
  --measure:780px;
  /* And the bar's own height, which the panes below have to step around. It
     grows at the tablet breakpoint, so it cannot be a literal in three rules. */
  --navh:58px;
}
@media(min-width:768px){:root{--measure:900px;--navh:62px}}
@media(min-width:1024px){:root{--measure:960px}}
/* AND env() CANNOT TELL US ABOUT AN IPAD. iPadOS reports
   safe-area-inset-top: 0 even for an installed web app, because on a device
   with no notch there is no geometrically unsafe area — yet the status bar is
   still DRAWN OVER the page, so the clock lands on the wordmark. The inset is
   honest and useless.

   Being installed is the fact that matters, and it is knowable: Home Screen
   apps get .installed on <html>. Then reserve the 24pt the status bar
   occupies, keeping whatever env() reports when that is larger — an iPhone
   notch is 47-59pt and must win. Gated on height because iPhone landscape
   hides the status bar entirely, and reserving room for a bar that is not
   there is the same bug in the other direction. */
@media (min-height:600px){
  html.installed{--sat:max(env(safe-area-inset-top,0px),24px)}
}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlig`);

/* ── 3. how the bar sits now ─────────────────────────────────────────────── */
patch('chrome: full-bleed colour, measured contents, and room for the clock',
`.nav{background:var(--navy);color:#fff;padding:0 20px;height:58px;display:flex;align-items:center;
  justify-content:space-between;position:sticky;top:0;z-index:100;margin:0 -16px;
  box-shadow:0 2px 16px rgba(0,0,0,.25);
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  border-bottom:1px solid rgba(255,255,255,.06)}`,
`/* The colour spans the viewport; the contents keep the measure. Fixed, not
   sticky: a fixed element reaches both edges without 100vw, and 100vw counts
   the scrollbar, which on a desktop would have added a horizontal scroll. */
#navbar{position:fixed;top:0;left:0;right:0;z-index:100;
  background:var(--navy);color:#fff;
  padding-top:var(--sat);
  box-shadow:0 2px 16px rgba(0,0,0,.25);
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  border-bottom:1px solid rgba(255,255,255,.06)}
.nav{color:#fff;height:var(--navh);display:flex;align-items:center;
  justify-content:space-between;
  max-width:var(--measure);margin:0 auto;
  padding-left:max(20px,var(--sal));padding-right:max(20px,var(--sar))}`);

patch('chrome: the screen begins below the bar',
`#shell{display:flex;align-items:stretch;min-height:100dvh}`,
`/* The bar is out of the flow now, so the panes have to step around it. */
#shell{display:flex;align-items:stretch;min-height:100dvh;
  padding-top:calc(var(--navh) + var(--sat))}`);

patch('chrome: and so does the tutor beside it',
`#ai{width:0;flex:0 0 0;overflow:hidden;transition:flex-basis .28s var(--ease);
  border-left:1px solid var(--border);background:var(--white);
  display:flex;flex-direction:column;position:sticky;top:0;height:100dvh}`,
`#ai{width:0;flex:0 0 0;overflow:hidden;transition:flex-basis .28s var(--ease);
  border-left:1px solid var(--border);background:var(--white);
  display:flex;flex-direction:column;position:sticky;
  top:calc(var(--navh) + var(--sat));height:calc(100dvh - var(--navh) - var(--sat))}`);

/* The bottom sheet below 1024px needs nothing: it already sets
   `inset:auto 0 0 0`, which puts top back to auto, so it is measured from the
   bottom of the viewport and never meets the bar. */

/* ── 4. the old inset rules, folded into the named ones ──────────────────── */
/* Both of these still carried the negative margins that used to bleed the bar
   past the reading column's padding. With the bar outside that column they do
   not bleed it, they shift it: at 768px and up the bar was pulled 24px left of
   centre. The heights and paddings they set are still wanted. */
patch('chrome: the bar no longer bleeds, so it no longer needs to',
`.nav{margin:0 -24px;height:62px;padding:0 28px}`,
`.nav{padding-left:max(28px,var(--sal));padding-right:max(28px,var(--sar))}`);

patch('chrome: nor at the narrow end',
`.nav{margin:0 -12px;padding:0 14px}`,
`.nav{padding-left:max(14px,var(--sal));padding-right:max(14px,var(--sar))}`);

patch('chrome: one vocabulary for the edges',
`/* Safe area insets for iPad notch/home bar */
@supports(padding:max(0px)){
  .nav{padding-left:max(20px,env(safe-area-inset-left));padding-right:max(20px,env(safe-area-inset-right))}`,
`/* Safe area insets for iPad notch/home bar. The bar handles its own — see
   #navbar and .nav above, which use the named --sa* variables. */
@supports(padding:max(0px)){`);

/* Set before anything paints, so the bar is the right height on the first
   frame rather than jumping once the app script runs. */
patch('chrome: know whether we are running from the Home Screen',
`</head>`,
`<script>
/* Home Screen apps only. navigator.standalone is the iOS spelling and
   display-mode:standalone is everyone else's; either one means the browser
   chrome is gone and the status bar is ours to work around. */
(function(){try{
  var s=window.navigator.standalone===true||
        (window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches);
  if(s)document.documentElement.classList.add('installed');
}catch(e){}})();
</script>
</head>`);

fs.writeFileSync(OUT, html);
console.log(`Full screen, like an app — ${applied.length} edits applied`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
