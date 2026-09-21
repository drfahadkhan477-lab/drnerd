#!/usr/bin/env node
/*
 * A ninth theme: Contrast. The existing eight presets are eye-comfort palettes
 * on purpose (theme-patch.js says so directly: "no palette uses pure black or
 * pure white; accent saturation is kept off the maximum"). That is the right
 * default, and the wrong floor for someone who needs the highest legible
 * separation the screen can give — low vision, bright sunlight on an iPad,
 * a borrowed device with the brightness turned down. Contrast is that floor:
 * near-black ground, near-white text, built on the exact palette mechanism
 * the other eight already use (a data-palette block, a THEMES entry, a
 * boot-script mapping) so it costs the app nothing new to maintain.
 *
 * WHERE THIS RUNS IN THE CHAIN, AND WHY NOT WHERE IT LOOKS LIKE IT SHOULD.
 * Straight after 'contrastfix' in CHAIN, which reads like a dependency and
 * is not one — checked directly rather than assumed, by building both a
 * pre- and a post-'semantictokens' fixture of the Monitor block and running
 * this patch's own anchor against each: it matches either way. The anchor is
 * the Monitor block's `--aura-*`/`--hero-accent` tail, and semantictokens
 * only ever rewrites the `--text`/`--teal*` line earlier in the same block —
 * a different line, so aliasing it first or after changes nothing this patch
 * reads. This patch's own new block writes the aliased `--teal:var(--accent)`
 * form directly (see below), so semantictokens has nothing to do to it
 * either way. So the CHAIN position here is arbitrary, same as an earlier
 * audit of this patch found — recorded so the next person does not have to
 * re-derive it, or worse, invent a dependency that is not there.
 *
 * THE ACCENT IS DELIBERATELY NOT THE BRIGHTEST ONE AVAILABLE, and that is a
 * measurement rather than a taste. What a high-contrast theme owes the reader
 * is text against ground — #FAFAFA on #060606 is about 19:1 — and the accent
 * contributes nothing to that. What the accent DOES do is sit underneath text
 * in composited places this suite already sweeps for AA: verify-pearl checks
 * pearl text over the PV-loop trace across every theme and every frame,
 * verify-home checks the first-run hint, verify-homeprog the legend. Every one
 * of those sweeps passes today with Monitor as the brightest dark accent in
 * the set (#2DD4BF, relative luminance .514; its accent-2 #5EEAD4, .660). An
 * accent brighter than that is a composite this suite has never had to clear.
 * So #38BDF8 (.440) and #7DD3FC (.580) sit strictly inside the envelope those
 * checks already hold, while still clearing 9.46:1 against this palette's own
 * ground. A first draft used #00E5FF (.633) purely because it looked like the
 * brightest thing available; it would have put every one of those sweeps into
 * territory nothing had measured, for a contrast the reader never sees.
 *
 * THE BORDER LADDER IS MEASURED TOO. The other palettes' three border weights
 * are tuned for a quiet edge; quiet is the one thing this palette is not for.
 * Against --card they measure 2.11 / 3.26 / 4.36:1 (--border2 / --border /
 * --border3), so the weight the app uses to bound an interactive component,
 * --border, clears the 3:1 WCAG asks of a non-text boundary, and --border3 —
 * which the progress track's calibration ticks draw in — clears it with room
 * to spare. The first draft had --border at 2.72:1 against --card, which
 * looked right and was, by a small margin, not.
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
patch('highcontrast: the Contrast palette, near-black ground and near-white text',
`  --aura-1:rgba(45,212,191,.22);--aura-2:rgba(94,234,212,.16);--aura-3:rgba(16,185,129,.14);
  --hero-accent:#5EEAD4;
}

.icon-btn{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);color:#fff;`,
`  --aura-1:rgba(45,212,191,.22);--aura-2:rgba(94,234,212,.16);--aura-3:rgba(16,185,129,.14);
  --hero-accent:#5EEAD4;
}

/* Contrast — near-black ground, near-white text. Not another mood; the
   accessibility floor. Semantic green/red/amber stay exactly as themed
   everywhere else (verify-theme.js already asserts they never move), so
   "correct" and "wrong" still mean what they mean elsewhere. The accent is
   held inside the luminance envelope Monitor already clears — see this
   patch's header for why that is a measurement and not a preference. */
html[data-theme="dark"][data-palette="contrast"]{
  --bg:#060606;--card:#121212;--white:#121212;
  --border:#666666;--border2:#4A4A4A;--border3:#7A7A7A;
  --text:#FAFAFA;--muted:#D6D6D6;--dim:#9E9E9E;--faint:#3A3A3A;
  --accent:#38BDF8;--accent-2:#7DD3FC;--teal:var(--accent);--teal2:var(--accent-2);
  --teal3:#0C4A6E;--teal4:#082F49;
  --navy:#141414;--navy2:#1E1E1E;--navy3:#282828;
  --shadow-glow:0 0 0 3px rgba(56,189,248,.32);
  --hero-a:#0A0A0A;--hero-b:#151515;--hero-c:#050505;
  --hero-edge:rgba(56,189,248,.32);
  --aura-1:rgba(56,189,248,.22);--aura-2:rgba(125,211,252,.16);--aura-3:rgba(255,255,255,.10);
  --hero-accent:#7DD3FC;
}

.icon-btn{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);color:#fff;`);

/* ── 2. the preset list, one more entry ────────────────────────────────────── */
patch('highcontrast: a THEMES entry so the picker and setTheme() both find it',
`  {id:'monitor',  name:'Monitor',   group:'dark',  mode:'dark',  palette:'monitor',   bg:'#08110D',ac:'#2DD4BF',bar:'#08110D'},
];`,
`  {id:'monitor',  name:'Monitor',   group:'dark',  mode:'dark',  palette:'monitor',   bg:'#08110D',ac:'#2DD4BF',bar:'#08110D'},
  {id:'contrast', name:'Contrast',  group:'dark',  mode:'dark',  palette:'contrast',  bg:'#060606',ac:'#38BDF8',bar:'#060606'},
];`);

/* ── 3. the pre-paint boot script, so Contrast survives a cold load too ────── */
patch('highcontrast: the boot script learns the ninth id',
`    nocturne:['dark','nocturne'],cathlab:['dark','cathlab'],monitor:['dark','monitor']};`,
`    nocturne:['dark','nocturne'],cathlab:['dark','cathlab'],monitor:['dark','monitor'],
    contrast:['dark','contrast']};`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('highcontrast-patch applied:');
edits.forEach(e => console.log('  ✓ ' + e));
