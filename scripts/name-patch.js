#!/usr/bin/env node
/*
 * The app gets a name of its own.
 *
 *   node scripts/name-patch.js <physio-output.html> <output.html>
 *
 * It has been called "ACCSAP 12" throughout, which is the name of the ACC's
 * question bank — not of this app. The questions genuinely are ACCSAP 12, so
 * everywhere the app states their provenance (the Apex prompt, the "verified
 * against the ACCSAP 12 source export" note) that name stays: renaming the
 * content would be a lie about where it came from.
 *
 * The app around it is Systole — the beat's contraction, the working phase of
 * the cycle, and a natural companion to Apex, the tutor. This renames only the
 * shell: the wordmark, the page title, the home hero, the splash, and the
 * installed-app name. The content keeps its real name.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/name-patch.js <physio-output.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 200)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

patch('meta: installed-app title',
`<meta name="apple-mobile-web-app-title" content="ACCSAP 12">`,
`<meta name="apple-mobile-web-app-title" content="Systole">`);

patch('meta: description leads with the app, credits the bank',
`<meta name="description" content="ACCSAP 12 cardiology board review — 638 questions, 408 high-resolution figures, full ACC commentary.">`,
`<meta name="description" content="Systole — cardiology board review on the ACCSAP 12 bank. A WebGL rhythm lab, a computed cardiac cycle, spaced repetition, and Apex, a grounded AI tutor.">`);

patch('title',
`<title>ACCSAP 12 · Board Review</title>`,
`<title>Systole · Cardiology Board Review</title>`);

patch('splash: loading label',
`<div id="splash" role="status" aria-label="Loading ACCSAP 12">`,
`<div id="splash" role="status" aria-label="Loading Systole">`);

patch('splash: the wordmark',
`    <div class="sp-word">ACCSAP 12</div>`,
`    <div class="sp-word">Systole</div>`);

patch('nav: the wordmark',
`        <div class="nav-title">ACCSAP 12</div>`,
`        <div class="nav-title">Systole</div>`);

patch('home: the hero heading',
`        <div class="hero-h1">ACCSAP 12</div>`,
`        <div class="hero-h1">Systole</div>`);

patch('code comment: name the app logic for what it now is',
`ACCSAP 12 · Board Review — application logic (v2) ══════════════ */`,
`Systole · Cardiology Board Review — application logic (v2) ══════════════ */`);

fs.writeFileSync(OUT, html);
console.log(`Renamed to Systole — ${applied.length} edits`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
