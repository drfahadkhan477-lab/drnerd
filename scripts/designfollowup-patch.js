#!/usr/bin/env node
/*
 * Two small fixes flagged, and deliberately left unfixed, during the last
 * design pass (see semantictokens-patch.js's and splashtiming-patch.js's
 * own header comments for where each was first found).
 *
 *   node scripts/designfollowup-patch.js <in.html> <out.html>
 *
 * 1. --warn/--warn-bg/--warn-b were their own independent literal values
 *    that happened to equal --amber/--amber-bg/--amber-b exactly — not an
 *    alias, a coincidence, and not just once: --warn-bg/--warn-b are
 *    independently restated in FOUR places (the base :root, plus
 *    [data-theme="dark"], [data-theme="light"] and the parchment palette),
 *    each matching that block's own --amber-bg/--amber-b by hand. If
 *    --warning's colour or any theme's amber background ever changes,
 *    .notice (the only reader of --warn*) would silently stop matching.
 *    This found a real, live consequence of the duplication while fixing
 *    it: the dark-mode MEDIA QUERY (@media(prefers-color-scheme:dark), for
 *    the 'auto' theme under a dark system) sets --amber-bg correctly but
 *    was never taught to also set --warn-bg — so today, an 'auto' user
 *    whose system is dark sees .notice's background still using the LIGHT
 *    literal (#FFFBEB) from :root's bare declaration, because nothing
 *    overrides --warn-bg for that case. Turning --warn/--warn-bg/--warn-b
 *    into real aliases at all four sites fixes the coincidence AND this
 *    auto+dark case for free — the media query only ever needs to keep
 *    --amber-bg correct, and --warn-bg now follows automatically.
 *
 * 2. Two same-named @keyframes spRise rules existed — one (with a scale
 *    transform) intended for .sp-heart-mount, one (translateY only,
 *    appearing LATER in the file) intended for .sp-word/.sp-sub. CSS gives
 *    the whole rule to whichever same-named @keyframes appears last, so
 *    .sp-heart-mount has been silently animating with the plain
 *    translateY-only body since whichever step made them collide — it
 *    still fades and rises, it just lost its intended scale(.94)→scale(1)
 *    settle. Renaming the heart's own keyframes to spRiseHeart (and
 *    pointing .sp-heart-mount at the new name) restores it without
 *    touching .sp-word/.sp-sub, which keep using plain spRise exactly as
 *    they already do.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/designfollowup-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

patch('designfollowup: --warn/--warn-bg/--warn-b become real aliases, base :root',
`:root{--warn:#B45309;--warn-bg:#FFFBEB;--warn-b:#FDE68A}`,
`:root{--warn:var(--warning);--warn-bg:var(--amber-bg);--warn-b:var(--amber-b)}`);

patch('designfollowup: --warn-bg/--warn-b alias, [data-theme="dark"] — also the fix for auto+dark systems',
`  --amber-bg:#271B04;--amber-b:#78350F;--warn-bg:#271B04;--warn-b:#78350F;`,
`  --amber-bg:#271B04;--amber-b:#78350F;--warn-bg:var(--amber-bg);--warn-b:var(--amber-b);`);

patch('designfollowup: --warn-bg/--warn-b alias, [data-theme="light"]',
`  --amber-bg:#FFFBEB;--amber-b:#FDE68A;--warn-bg:#FFFBEB;--warn-b:#FDE68A;`,
`  --amber-bg:#FFFBEB;--amber-b:#FDE68A;--warn-bg:var(--amber-bg);--warn-b:var(--amber-b);`);

patch('designfollowup: --warn-bg/--warn-b alias, parchment palette',
`  --amber-bg:#F6EEDC;--amber-b:#E0CDA0;--warn-bg:#F6EEDC;--warn-b:#E0CDA0;`,
`  --amber-bg:#F6EEDC;--amber-b:#E0CDA0;--warn-bg:var(--amber-bg);--warn-b:var(--amber-b);`);

patch('designfollowup: give the heart its own keyframes back, so it stops losing to spWord/spSub\'s later-declared spRise',
`@keyframes spRise{from{opacity:0;transform:translateY(16px) scale(.94)}to{opacity:1;transform:none}}`,
`@keyframes spRiseHeart{from{opacity:0;transform:translateY(16px) scale(.94)}to{opacity:1;transform:none}}`);

patch('designfollowup: point .sp-heart-mount at its own keyframes',
`  animation:spRise 1s both cubic-bezier(.2,.7,.3,1)}`,
`  animation:spRiseHeart 1s both cubic-bezier(.2,.7,.3,1)}`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('designfollowup-patch applied:');
edits.forEach(e => console.log('  ✓ ' + e));
