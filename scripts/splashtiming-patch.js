#!/usr/bin/env node
/*
 * The rhythm trace waits for the heart to settle, instead of sweeping in
 * parallel with it.
 *
 *   node scripts/splashtiming-patch.js <in.html> <out.html>
 *
 * .sp-heart-mount (the Lottie heart) and .sp-trace (the ECG sweep) both
 * start at animation-delay 0 today — they fire on the same frame, which
 * reads as two things happening at once rather than one physiological
 * event: the heart arrives, THEN the rhythm begins. .sp-word/.sp-sub
 * already sequence correctly (.10s/.24s delays); this gives .sp-trace the
 * same treatment, timed to start as the heart's own 1s settle finishes.
 *
 * NOT ADDING a minimum-visible-time guard on the splash's dismissal, which
 * a design review also proposed. dismissSplash() (see splash-patch.js)
 * deliberately never waits on anything but the app's real first render —
 * that is the whole point of the splash, and a fixed hold would be the
 * first instance in this codebase of holding a ready app hostage to a
 * decorative animation. Measured directly against the current build: the
 * full entrance choreography (heart 0-1000ms, trace now 850-3250ms+,
 * word/sub finishing by 940ms) completes in under a second, and even the
 * fastest measured boot (verify-splash.js, unthrottled) is a good deal
 * longer than that — there is no realistic path where dismissal cuts the
 * entrance short on this build. Not solving a problem that doesn't occur.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/splashtiming-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

patch('splashtiming: the rhythm trace waits for the heart to settle',
`  animation:spSweep 2.4s cubic-bezier(.4,0,.5,1) infinite}`,
`  animation:spSweep 2.4s .85s cubic-bezier(.4,0,.5,1) infinite}`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('splashtiming-patch applied:');
edits.forEach(e => console.log('  ✓ ' + e));
