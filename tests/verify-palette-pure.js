#!/usr/bin/env node
/*
 * The contrast figures written into the palette patches are the figures those
 * palettes actually produce.
 *
 *   node tests/verify-palette-pure.js
 *
 * No browser, no build. CLAUDE.md's rule is blunt — "If you write a sentence
 * containing a number, guard it or do not write it" — and two patch headers
 * broke it the day they were written. highcontrast-patch.js quotes relative
 * luminances and contrast ratios to justify every colour it picks;
 * calibrationtrack-patch.js quotes a tick ratio for each of six palettes to
 * justify how faint they are. Nothing checked any of it. Retune one hex and
 * every one of those sentences quietly becomes a lie that reads as evidence.
 *
 * TWO KINDS OF CHECK, AND THE FIRST MATTERS MORE. The properties come first:
 * --border against --card must clear the 3:1 WCAG asks of a non-text
 * boundary, in the one palette that exists for contrast. That is not a
 * documentation concern — the first draft of Contrast measured 2.72:1 there
 * and was nearly shipped. Those assertions are floors and relationships, not
 * snapshots, so retuning a colour for good reasons does not fail them.
 *
 * Then the prose: the quoted numbers are pulled back out of the comments and
 * compared to what the hexes compute to, so a retune must either keep the
 * measurement true or update the sentence. Every one of those has a vacuity
 * guard in front of it, because a regex that stops matching would otherwise
 * find nothing to disagree with and pass — the failure this project has
 * produced more times than any other.
 *
 * WHY THE COLOUR MATH IS LOCAL. Three copies of it exist already, in
 * verify-home.js, verify-homeprog.js and verify-pearl.js — but all three live
 * inside page.evaluate() bodies, so they execute in the browser and cannot
 * require() anything. A shared tests/_colour.js would have exactly one
 * caller, which is an abstraction invented for a second consumer that does
 * not exist. If a second Node-side consumer ever turns up, lift it then.
 *
 * WHAT IT DOES NOT CHECK. Whether any of this looks right. The ticks are a
 * hairline by intent and no number here can say whether that reads as
 * calibration or as nothing; that needs an eye on a real screen.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const HC_RAW = read('scripts/highcontrast-patch.js');
const CT_RAW = read('scripts/calibrationtrack-patch.js');
const THEME_RAW = read('scripts/theme-patch.js');
/* Blanked for anything that hunts a PATTERN, raw only where the comments are
   deliberately the subject. Both halves of that are load-bearing: the sweep
   in verify-figfade-pure went red on its own documentation before it was
   blanked, and here the claims live in the comments, so blanking the text the
   claims are read from would leave nothing to read. */
const HC = blankComments(HC_RAW);
const THEME = blankComments(THEME_RAW);

/* ── WCAG relative luminance, sRGB ───────────────────────────────────────── */
const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
function lum(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a six-digit hex: ${hex}`);
  const n = parseInt(m[1], 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
const ratio = (a, b) => {
  const x = lum(a), y = lum(b), hi = Math.max(x, y), lo = Math.min(x, y);
  return (hi + 0.05) / (lo + 0.05);
};
const r2 = n => Math.round(n * 100) / 100;
const l3 = n => Math.round(n * 1000) / 1000;

/* A claim is a sentence, and a sentence wraps. The first draft of the tick
   check read the source line by line and found four of the six figures —
   "1.34" and "on Parchment" sit either side of a line break, and so do "2.06"
   and "on Contrast". It was the vacuity guard that said so rather than the
   comparison, which would otherwise have reported that every claim it could
   find agreed while silently not looking at two of them. So: strip the
   comment furniture and collapse the whitespace before matching anything,
   which also means reflowing a paragraph cannot break these checks. */
const flat = src => src.replace(/^[ \t]*\*[ \t]?/gm, ' ').replace(/\s+/g, ' ');
const HC_FLAT = flat(HC_RAW);
const CT_FLAT = flat(CT_RAW);

/* ── reading a palette block out of a patch script ───────────────────────── */
function palette(src, id, where) {
  const re = new RegExp('html\\[[^{]*data-palette="' + id + '"\\]\\s*\\{([^}]*)\\}', 'g');
  const hits = [...src.matchAll(re)];
  if (hits.length !== 1) throw new Error(`${where}: expected exactly one "${id}" block, found ${hits.length}`);
  const out = {};
  for (const m of hits[0][1].matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}

const CONTRAST = palette(HC, 'contrast', 'highcontrast-patch.js');
const NAMED = ['slate', 'parchment', 'nocturne', 'cathlab', 'monitor']
  .reduce((a, id) => (a[id] = palette(THEME, id, 'theme-patch.js'), a), {});

head('the palettes were actually read');
{
  /* VACUITY GUARD for everything below: a parser that quietly returned an
     empty object would make every ratio check throw or pass on undefined. */
  const need = ['--bg', '--card', '--border', '--border2', '--border3', '--text', '--accent', '--accent-2'];
  const missing = need.filter(k => !CONTRAST[k]);
  ok('the Contrast palette parsed, with every token this suite reads',
     missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : Object.keys(CONTRAST).length + ' tokens');
  const thin = Object.entries(NAMED).filter(([, p]) => !p['--border2'] || !p['--border3']).map(([id]) => id);
  ok('and all five named palettes parsed their border weights',
     thin.length === 0, thin.length ? `thin: ${thin.join(', ')}` : Object.keys(NAMED).join(', '));
}

head('the properties Contrast exists for — floors, not snapshots');
{
  const card = CONTRAST['--card'], bg = CONTRAST['--bg'];
  /* THE ONE THAT WAS NEARLY SHIPPED WRONG. WCAG 1.4.11 asks 3:1 of anything
     that bounds a control, and --border is the weight this app bounds them
     with. The first draft measured 2.72:1 here. */
  ok('--border clears 3:1 against --card, the WCAG non-text boundary',
     ratio(CONTRAST['--border'], card) >= 3, `${r2(ratio(CONTRAST['--border'], card))}:1`);
  ok('--border3, which the calibration ticks are drawn in, clears it too',
     ratio(CONTRAST['--border3'], card) >= 3, `${r2(ratio(CONTRAST['--border3'], card))}:1`);
  ok('the ladder is still a ladder — border2 < border < border3',
     ratio(CONTRAST['--border2'], card) < ratio(CONTRAST['--border'], card) &&
     ratio(CONTRAST['--border'], card) < ratio(CONTRAST['--border3'], card),
     [CONTRAST['--border2'], CONTRAST['--border'], CONTRAST['--border3']]
       .map(c => r2(ratio(c, card)) + ':1').join(' < '));

  ok('body text against the ground is far past AA — this is the whole point',
     ratio(CONTRAST['--text'], bg) >= 15, `${r2(ratio(CONTRAST['--text'], bg))}:1`);
  ok('--muted, which carries real text, clears AA against --card',
     ratio(CONTRAST['--muted'], card) >= 4.5, `${r2(ratio(CONTRAST['--muted'], card))}:1`);
  ok('the accent clears AA against the ground as well',
     ratio(CONTRAST['--accent'], bg) >= 4.5, `${r2(ratio(CONTRAST['--accent'], bg))}:1`);

  /* THE ENVELOPE CLAIM, AS A RELATIONSHIP RATHER THAN A NUMBER. The accent
     sits under text in composites verify-pearl and verify-home already sweep
     for AA, and every one of those sweeps passes today with Monitor as the
     brightest dark accent in the set. An accent brighter than Monitor's is a
     composite nothing has measured — so this asserts the ordering, which
     survives either palette being retuned, rather than a fixed figure. */
  ok('the Contrast accent is no brighter than Monitor’s, the brightest already swept',
     lum(CONTRAST['--accent']) <= lum(NAMED.monitor['--teal'] || '#2DD4BF'),
     `${l3(lum(CONTRAST['--accent']))} vs ${l3(lum(NAMED.monitor['--teal'] || '#2DD4BF'))}`);
  ok('and neither is its accent-2',
     lum(CONTRAST['--accent-2']) <= lum(NAMED.monitor['--teal2'] || '#5EEAD4'),
     `${l3(lum(CONTRAST['--accent-2']))} vs ${l3(lum(NAMED.monitor['--teal2'] || '#5EEAD4'))}`);
}

head('and the figures quoted in highcontrast-patch.js are those figures');
{
  /* Read from the RAW source: these live in the comments, which is exactly
     what is being checked. */
  const ladder = /Against --card they measure ([\d.]+) \/ ([\d.]+) \/ ([\d.]+):1/.exec(HC_FLAT);
  ok('the border-ladder sentence is still there to check', !!ladder,
     ladder ? ladder[0] : 'the sentence has been reworded — update this regex or drop the claim');
  if (ladder) {
    const want = [ladder[1], ladder[2], ladder[3]].map(Number);
    const got = ['--border2', '--border', '--border3'].map(k => r2(ratio(CONTRAST[k], CONTRAST['--card'])));
    ok('and it matches what the hexes compute to',
       want.every((w, i) => Math.abs(w - got[i]) < 0.011), `says ${want.join(' / ')}, measures ${got.join(' / ')}`);
  }

  /* Each "#HEX (.NNN)" and "#HEX, relative luminance .NNN" / "#HEX, .NNN" in
     the header is a claim about that colour, including the rejected first
     draft — a wrong number is misleading whether or not the colour shipped. */
  const quoted = [...HC_FLAT.matchAll(/(#[0-9A-Fa-f]{6})(?:,(?: relative luminance)?| \()\s*(\.\d{3})\)?/g)]
    .map(m => ({ hex: m[1], claim: Number(m[2]) }));
  ok('the luminance claims are still in the header', quoted.length >= 5, `${quoted.length} found`);
  const wrong = quoted.filter(q => Math.abs(l3(lum(q.hex)) - q.claim) > 0.0011);
  ok('every quoted luminance is what that hex actually measures',
     wrong.length === 0,
     wrong.length ? wrong.map(q => `${q.hex} says ${q.claim}, measures ${l3(lum(q.hex))}`).join(' | ')
                  : quoted.map(q => q.hex + ' ' + q.claim).join(', '));

  const ground = /clearing ([\d.]+):1 against this palette’s own|clearing ([\d.]+):1 against this palette's own/.exec(HC_FLAT);
  ok('the accent-on-ground figure is still quoted', !!ground, ground ? ground[0] : 'sentence reworded');
  if (ground) {
    const want = Number(ground[1] || ground[2]);
    const got = r2(ratio(CONTRAST['--accent'], CONTRAST['--bg']));
    ok('and it matches', Math.abs(want - got) < 0.011, `says ${want}:1, measures ${got}:1`);
  }
}

head('and the tick figures quoted in calibrationtrack-patch.js are too');
{
  const NAME = { Slate: 'slate', Parchment: 'parchment', Nocturne: 'nocturne',
                 'Cath Lab': 'cathlab', Monitor: 'monitor', Contrast: 'contrast' };
  const claims = [...CT_FLAT.matchAll(/([\d.]+)(?::1)? on (Slate|Parchment|Nocturne|Cath Lab|Monitor|Contrast)/g)]
    .map(m => ({ palette: NAME[m[2]], label: m[2], claim: Number(m[1]) }));
  ok('the per-palette tick sentence is still there to check', claims.length === 6,
     claims.length ? claims.map(c => `${c.label} ${c.claim}`).join(', ')
                   : 'reworded — update this regex or drop the claim');

  const wrong = claims.filter(c => {
    const p = c.palette === 'contrast' ? CONTRAST : NAMED[c.palette];
    return Math.abs(r2(ratio(p['--border3'], p['--border2'])) - c.claim) > 0.011;
  });
  ok('every quoted tick ratio is what that palette actually measures',
     wrong.length === 0,
     wrong.length ? wrong.map(c => {
       const p = c.palette === 'contrast' ? CONTRAST : NAMED[c.palette];
       return `${c.label} says ${c.claim}, measures ${r2(ratio(p['--border3'], p['--border2']))}`;
     }).join(' | ') : 'all six agree');

  /* The ticks are decoration beside an aria-valuenow, a legend and a
     percentage, so they are deliberately NOT held to a contrast minimum —
     but they do have to differ from the track at all, or the patch is a
     no-op dressed as a feature. */
  const flat = Object.entries({ ...NAMED, contrast: CONTRAST })
    .filter(([, p]) => p['--border3'].toLowerCase() === p['--border2'].toLowerCase())
    .map(([id]) => id);
  ok('no palette draws the ticks in the same colour as the track they sit on',
     flat.length === 0, flat.length ? flat.join(', ') : 'all six differ');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
