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
 * the grid create() uses. Nothing here reimplements the geometry, so there is
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

function keyOf(heart3dSrc) {
  return crypto.createHash('sha256').update(heart3dSrc).digest('hex').slice(0, 16);
}

function bake(heart3dSrc) {
  const box = {};
  new Function('window', heart3dSrc)(box);
  const M = box.Heart3D && box.Heart3D.mesh;
  if (!M) throw new Error('heart-bake: this heart3d.js has no Heart3D.mesh to bake');
  const key = keyOf(heart3dSrc);
  const buf = M.pack(M.build(M.RES, M.LO, M.HI), key, M.RES, M.LO, M.HI);
  return { key, b64: Buffer.from(buf).toString('base64'), bytes: buf.byteLength };
}

module.exports = { bake, keyOf };
