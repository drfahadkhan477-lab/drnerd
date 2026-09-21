#!/usr/bin/env node
/*
 * A ninth theme: Contrast. The existing eight presets are eye-comfort palettes
 * on purpose (theme-patch.js says so directly: "no palette uses pure black or
 * pure white; accent saturation is kept off the maximum"). That is the right
 * default, and the wrong floor for someone who needs the highest legible
 * separation the screen can give — low vision, bright sunlight on an iPad,
 * a borrowed device with the brightness turned down. Contrast is that floor:
 * near-black ground, near-white text, one fully saturated accent, built on
 * the exact palette mechanism the other eight already use (a data-palette
 * block, a THEMES entry, a boot-script mapping) so it costs the app nothing
 * new to maintain.
 *
 * SCOPE, ON PURPOSE. This patch does NOT also add a blanket
 * `@media(prefers-contrast:more)` rule that reaches into the other eight
 * themes' border/text tokens. Doing that correctly requires knowing whether
 * such a rule's specificity actually wins against each palette's own
 * html[data-palette=...] block and against the base [data-theme="dark"]
 * defaults — and those base defaults live in the licensed export this patch
 * cannot see from here. Shipping a rule that looks plausible but silently
 * loses the cascade is exactly the "check that passes without measuring
 * anything" failure this project has hit before; a self-contained, fully
 * explicit ninth preset has no such ambiguity, so that is what this ships.
 * A prefers-contrast auto-boost is a good candidate for whoever next works
 * on this with the real base file in view.
 *
 *   node scripts/highcontrast-patch.js <in.html> <out.html>
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/highcontrast-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 200)}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

/* ── 1. the palette block, appended after Monitor, the last of the five ───── */
patch('highcontrast: the Contrast palette, maximum legible separation',
`  --aura-1:rgba(45,212,191,.22);--aura-2:rgba(94,234,212,.16);--aura-3:rgba(16,185,129,.14);
  --hero-accent:#5EEAD4;
}

.icon-btn{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);color:#fff;`,
`  --aura-1:rgba(45,212,191,.22);--aura-2:rgba(94,234,212,.16);--aura-3:rgba(16,185,129,.14);
  --hero-accent:#5EEAD4;
}

/* Contrast — near-black ground, near-white text, one fully saturated accent.
   Not another mood; the accessibility floor. Semantic green/red/amber stay
   exactly as themed everywhere else (verify-theme.js already asserts they
   never move), so "correct" and "wrong" still mean what they mean elsewhere. */
html[data-theme="dark"][data-palette="contrast"]{
  --bg:#060606;--card:#121212;--white:#121212;
  --border:#5A5A5A;--border2:#2C2C2C;--border3:#7A7A7A;
  --text:#FAFAFA;--muted:#D6D6D6;--dim:#9E9E9E;--faint:#3A3A3A;
  --accent:#00E5FF;--accent-2:#67E8F9;--teal:var(--accent);--teal2:var(--accent-2);
  --teal3:#0A4A52;--teal4:#052024;
  --navy:#141414;--navy2:#1E1E1E;--navy3:#282828;
  --shadow-glow:0 0 0 3px rgba(0,229,255,.32);
  --hero-a:#0A0A0A;--hero-b:#151515;--hero-c:#050505;
  --hero-edge:rgba(0,229,255,.32);
  --aura-1:rgba(0,229,255,.22);--aura-2:rgba(103,232,249,.16);--aura-3:rgba(255,255,255,.10);
  --hero-accent:#67E8F9;
}

.icon-btn{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);color:#fff;`);

/* ── 2. the preset list, one more entry ────────────────────────────────────── */
patch('highcontrast: a THEMES entry so the picker and setTheme() both find it',
`  {id:'monitor',  name:'Monitor',   group:'dark',  mode:'dark',  palette:'monitor',   bg:'#08110D',ac:'#2DD4BF',bar:'#08110D'},
];`,
`  {id:'monitor',  name:'Monitor',   group:'dark',  mode:'dark',  palette:'monitor',   bg:'#08110D',ac:'#2DD4BF',bar:'#08110D'},
  {id:'contrast', name:'Contrast',  group:'dark',  mode:'dark',  palette:'contrast',  bg:'#060606',ac:'#00E5FF',bar:'#060606'},
];`);

/* ── 3. the pre-paint boot script, so Contrast survives a cold load too ────── */
patch('highcontrast: the boot script learns the ninth id',
`    nocturne:['dark','nocturne'],cathlab:['dark','cathlab'],monitor:['dark','monitor']};`,
`    nocturne:['dark','nocturne'],cathlab:['dark','cathlab'],monitor:['dark','monitor'],
    contrast:['dark','contrast']};`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('highcontrast-patch applied:');
edits.forEach(e => console.log('  ✓ ' + e));
