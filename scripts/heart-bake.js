'use strict';
/*
 * The heart's mesh, baked at build time.
 *
 * Meshing the muscle and the chambers was 78% of the app's launch — see
 * "a copy baked at build time" in src/core/heart3d.js. scripts/apex-patch.js
 * calls bake() while it embeds heart3d.js, so the build carries the meshed
 * surfaces and create() loads them instead of meshing again.
 *
 * bake() runs heart3d.js's OWN buildSurfaces() and packSurfaces(), in Node, on
 * the grid the hero heart asks create() for (HERO_RES, below). Nothing here
 * reimplements the geometry, so there is
 * no second copy to drift.
 *
 * The key is a digest of the text of heart3d.js that was baked. The build
 * embeds the same key beside the code, and create() refuses a copy whose key
 * differs — a mesh from other code is never drawn.
 *
 * A module of its own, not inline in apex-patch, so the bake can be tested
 * without the licensed export apex-patch needs (tests/verify-heartbake-pure.js).
 */
const crypto = require('crypto');

/* THE GRID IS THE HERO'S. create() takes a copy only if it was meshed on the
   grid it is asked for, and the heart that costs the launch is the hero,
   which scripts/heroart-patch.js mounts at this grid, not heart3d.js's
   default. The first bake used the default: every check here passed, and the
   built app meshed at every launch anyway, because the hero asked for a grid
   the copy was not. heroart-patch reads its resolution from here, so the two
   cannot drift apart again. The lab and ambient hearts keep the default grid
   and mesh themselves when opened, which was never on the launch path. */
const HERO_RES = [58, 76, 48];

function keyOf(heart3dSrc) {
  return crypto.createHash('sha256').update(heart3dSrc).digest('hex').slice(0, 16);
}

function bake(heart3dSrc, res = HERO_RES) {
  const box = {};
  new Function('window', heart3dSrc)(box);
  const M = box.Heart3D && box.Heart3D.mesh;
  if (!M) throw new Error('heart-bake: this heart3d.js has no Heart3D.mesh to bake');
  const key = keyOf(heart3dSrc);
  const buf = M.pack(M.build(res, M.LO, M.HI), key, res, M.LO, M.HI);
  return { key, res: res.slice(), b64: Buffer.from(buf).toString('base64'), bytes: buf.byteLength };
}

module.exports = { bake, keyOf, HERO_RES };
