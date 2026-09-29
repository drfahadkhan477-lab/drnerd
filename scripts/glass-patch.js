#!/usr/bin/env node
/*
 * Glass: the buttons and cards become frosted, lit panes, and a light moves
 * across them — without any of them losing what their colour means.
 *
 *   node scripts/glass-patch.js <in.html> <out.html>
 *
 * DESIGNED FROM A CENSUS, NOT A GUESS. The base stylesheet comes from the
 * licensed export and is not read. tools/button-census.js was run on the
 * owner's build in three themes (default light, cathlab dark, contrast) and
 * this is built on what it found:
 *
 *   · NEUTRAL controls paint background:var(--card) — .btn, .btn-home,
 *     .sb-back, .chip, .miss-chip, .cf-chip, .echo-tab, .hello-x, .ch-tile,
 *     .feed-card, .opt. Their colour is the surface and nothing more.
 *   · PRIMARIES are filled: .btn-next, .ai-fab (a gradient), .echo-tab.on.
 *   · MEANING lives in some colours: .opt.correct and .opt.wrong are the
 *     answer, a red .btn on the results screen is a destructive action,
 *     .chip.hot is a selection. None of them paints var(--card).
 *   · .door and .study-back are already glass (translucent, blurred).
 *   · ::before is taken on .opt and .ch-tile; ::after is free on every one.
 *   · The notes screen carries 2,152 chips at once.
 *
 * WHAT THIS DOES WITH THAT
 *
 *   1. TRANSLUCENT BY REDEFINING --card ON THE CONTROL ITSELF. Each neutral
 *      control gets --card: var(--card-glass), a see-through copy of the
 *      theme's own card colour. Anything painted with --card turns to glass;
 *      anything painted with another colour — every answer state, the danger
 *      button, a selected chip — is untouched by construction, because no
 *      rule here names its background at all. --card-glass is derived at
 *      runtime from whatever --card the current theme sets (glassSync below),
 *      so all nine themes, and any added later, get it without a list of
 *      colours here to fall out of date. Until that runs it equals --card.
 *   2. FROSTED where it is affordable: backdrop-filter on the neutral
 *      controls, but NOT on .chip — two thousand backdrop blurs on one screen
 *      would stall an iPad for a look nobody could see at that size.
 *   3. LIT. A pane drawn in ::after, under the label and over the control's
 *      own colour: a soft highlight from the top, a bright rim along the top
 *      edge and a faint one around it. Over green it is glossy green; over
 *      red, glossy red. Primaries and the Apex button get it too.
 *   4. A LIGHT THAT MOVES. A band of light glides across a pane when the
 *      pointer arrives, or when a finger presses it on the iPad; the doors,
 *      chapter tiles, feed cards and the Next button catch it once as they
 *      appear. Buttons whose own transitions already cover transform sink a
 *      little under a press.
 *
 * WHAT IT NEVER DOES
 *   · Touch High contrast: every rule is scoped to
 *     html:not([data-palette="contrast"]). That theme stays solid and flat.
 *   · Move under reduced motion: no glide, no glance, no press.
 *   · Name a background colour on a control, set an element's own animation
 *     (some already have one), or give .ai-fab or .icon-btn a new position
 *     (the first is fixed, the second anchors the nav badge elsewhere).
 *   · Use syntax Safari 13.4 lacks: no :is(), no inset, no color-mix(). The
 *     blur carries its -webkit- twin, as every other blur in this chain does.
 *
 * tests/verify-glass.js runs this patch's own output against a page built
 * with the app's class and token names and checks each of the above in a
 * real browser. tools/button-census.js re-run on a build shows the result.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/glass-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

const G = 'html:not([data-palette="contrast"])';
const sel = (list, suffix = '') => list.map(s => `${G} ${s}${suffix}`).join(',\n');

/* The census's neutral controls: painted with --card, so they turn to glass. */
const TRANSLUCENT = ['.btn:not(.btn-next)', '.chip', '.miss-chip', '.cf-chip', '.echo-tab', '.hello-x', '.ch-tile', '.feed-card', '.opt'];
/* Frosted: the same, less the chips (see 2 above). */
const FROSTED = TRANSLUCENT.filter(s => s !== '.chip');
/* Lit: every glass surface, the primaries, and what is already glass. */
const LIT = TRANSLUCENT.concat(['.btn-next', '.ai-fab', '.door', '.study-back']);
/* ::after is placed against its control, so a static control becomes a
   positioned one. .opt, .ch-tile and .feed-card are already relative, and
   .ai-fab is fixed and must stay so. */
const REPOSITION = LIT.filter(s => !['.opt', '.ch-tile', '.feed-card', '.ai-fab'].includes(s));
/* Catch the light once as they appear. */
const GLANCE = ['.door', '.ch-tile', '.feed-card', '.btn-next'];
/* Sink under a press — only those whose own transition already covers
   transform (the census: .btn and .echo-tab transition all, .chip and
   .hello-x list transform), so the press eases rather than snaps and no
   transition list here replaces theirs. */
const PRESS = ['.btn', '.chip', '.echo-tab', '.hello-x'];

const DARK_TOKENS = '--gl-shine:rgba(255,255,255,.10);--gl-rim:rgba(255,255,255,.16);--gl-edge:rgba(255,255,255,.06);' +
  '--gl-sweep:rgba(255,255,255,.16);--gl-lift:0 6px 18px rgba(0,0,0,.42)';

const CSS = `/* ── glass — see scripts/glass-patch.js ── */
:root{--card-glass:var(--card);--gl-shine:rgba(255,255,255,.62);--gl-rim:rgba(255,255,255,.85);
  --gl-edge:rgba(15,23,42,.07);--gl-sweep:rgba(255,255,255,.55);--gl-lift:0 6px 18px rgba(8,15,30,.18);
  --gl-blur:blur(14px) saturate(1.6);--gl-ease:cubic-bezier(.2,.8,.2,1)}
html[data-theme="dark"]{${DARK_TOKENS}}
@media (prefers-color-scheme:dark){html:not([data-theme]){${DARK_TOKENS}}}
${sel(TRANSLUCENT)}{--card:var(--card-glass)}
${sel(FROSTED)}{-webkit-backdrop-filter:var(--gl-blur);backdrop-filter:var(--gl-blur)}
${sel(REPOSITION)}{position:relative}
${sel(LIT)}{isolation:isolate}
${sel(LIT, '::after')}{content:"";position:absolute;top:0;right:0;bottom:0;left:0;
  border-radius:inherit;pointer-events:none;z-index:-1;
  background-image:linear-gradient(105deg,rgba(255,255,255,0) 38%,var(--gl-sweep) 50%,rgba(255,255,255,0) 62%),
    linear-gradient(180deg,var(--gl-shine),rgba(255,255,255,0) 55%);
  background-size:260% 100%,100% 100%;background-position:130% 0,0 0;background-repeat:no-repeat;
  box-shadow:inset 0 1px 0 var(--gl-rim),inset 0 0 0 1px var(--gl-edge);
  transition:background-position .8s var(--gl-ease)}
@media (hover:hover){${sel(LIT, ':hover::after')}{background-position:-30% 0,0 0}}
${sel(LIT, ':active::after')}{background-position:-30% 0,0 0;transition-duration:.45s}
${sel(LIT, ':focus-visible::after')}{background-position:-30% 0,0 0}
@keyframes glGlance{from{background-position:130% 0,0 0}to{background-position:-30% 0,0 0}}
${sel(GLANCE, '::after')}{animation:glGlance 1.1s var(--gl-ease) .15s 1}
${sel(['.btn-next'])}{box-shadow:var(--gl-lift)}
${sel(PRESS, ':active')}{transform:scale(.97)}
@media (prefers-reduced-motion:reduce){
${sel(LIT, '::after')}{transition:none;animation:none}
${sel(PRESS, ':active')}{transform:none}
}
`;

patch('glass: css — frosted, lit, and a light that moves',
`.nav{color:#fff;height:var(--navh);display:flex;align-items:center;`,
CSS + `.nav{color:#fff;height:var(--navh);display:flex;align-items:center;`);

patch('glass: --card-glass follows the theme',
`/* ══════════════ Durable memory — see src/core/memory.js ══════════════ */`,
`/* ══════════════ Glass — see scripts/glass-patch.js ══════════════ */
/* --card-glass is the theme's own --card, see-through. Derived here rather
   than listed per theme, so a theme added later is glass without anyone
   remembering to add it. Recomputed whenever the theme changes: setTheme()
   sets data-theme/data-palette on <html>, and "auto" follows the system. */
var GLASS_ALPHA = 0.62;
function glassSync(){
  var h = document.documentElement;
  var c = getComputedStyle(h).getPropertyValue('--card').trim(), r, g, b, m;
  if((m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c))){
    var x = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    r = parseInt(x.slice(0, 2), 16); g = parseInt(x.slice(2, 4), 16); b = parseInt(x.slice(4, 6), 16);
  } else if((m = /^rgba?\\(\\s*(\\d+)[\\s,]+(\\d+)[\\s,]+(\\d+)/i.exec(c))){
    r = +m[1]; g = +m[2]; b = +m[3];
  }
  if(r === undefined){ h.style.removeProperty('--card-glass'); return; }
  h.style.setProperty('--card-glass', 'rgba(' + r + ',' + g + ',' + b + ',' + GLASS_ALPHA + ')');
}
(function(){
  try{
    glassSync();
    if(typeof MutationObserver === 'function')
      new MutationObserver(glassSync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette'] });
    var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if(mq){ if(mq.addEventListener) mq.addEventListener('change', glassSync); else if(mq.addListener) mq.addListener(glassSync); }
  }catch(_){ /* no glass is a flat app, never a broken one */ }
})();
/* ══════════════ Durable memory — see src/core/memory.js ══════════════ */`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('glass-patch applied:');
edits.forEach(e => console.log('  ✓ ' + e));
