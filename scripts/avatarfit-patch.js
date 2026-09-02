#!/usr/bin/env node
/*
 * The Apex avatar stops throwing when its canvas is briefly too small to draw.
 *
 *   node scripts/avatarfit-patch.js <in.html> <out.html>
 *
 * FOUND BY verify-layout, which resizes the viewport and opens and closes the
 * Apex panel at five frames in a row — and caught an uncaught page error doing
 * it, which is precisely the kind of thing a suite that never resized could
 * not see.
 *
 * The avatar's draw() derives its geometry as
 *
 *     const R = Math.min(w, h) / 2 - 2;
 *
 * so any canvas under 4px in its smaller dimension makes R negative, and
 * createRadialGradient(..., R * 0.1, ..., R) throws IndexSizeError because r0
 * may not be less than zero. That throw happens inside a requestAnimationFrame
 * loop, so it does not merely skip a frame: the loop stops, and the avatar is
 * dead for the rest of the session.
 *
 * fit() was supposed to be the guard and half-was: it tested `!r.width` and
 * never looked at the height at all, so a canvas with width and no height —
 * exactly what a collapsing panel produces mid-animation, and what rotating an
 * iPad produces for a frame or two — sailed through. Reproduced by forcing the
 * canvas to 3px, which throws on the pre-step build and does not after.
 *
 * The threshold is 4px rather than 1px because 4 is what the geometry needs:
 * at exactly 4, R is 0, which draws nothing and is legal. Below it, nothing is
 * drawable anyway, so returning false and waiting for a real size loses no
 * frame anyone could have seen.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/avatarfit-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

patch('avatarfit: a canvas too small to draw is skipped, not drawn into',
`  function fit() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (!r.width) return false;`,
`  function fit() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    /* BOTH dimensions, and enough of each to draw. draw() takes
       R = Math.min(w,h)/2 - 2, so under 4px R goes negative and
       createRadialGradient throws IndexSizeError — inside the rAF loop, which
       stops the animation for the rest of the session rather than skipping a
       frame. This tested only !r.width, so a canvas with width and no height
       went straight through: exactly what a collapsing panel produces
       mid-animation, and what rotating an iPad produces for a frame or two. */
    if (!(r.width >= 4) || !(r.height >= 4)) return false;`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('avatarfit-patch applied:');
edits.forEach(e => console.log('  ✓ ' + e));
