#!/usr/bin/env node
/*
 * Turn a scanned heart GLB into an asset this app can beat.
 *
 *   NODE_PATH=$(npm root -g) node scripts/prep-glb.js <model.glb> [outDir]
 *
 * The interesting part is not loading a GLB — it is that the scanned mesh is
 * baked into THIS app's anatomical coordinate frame, and then given per-vertex
 * chamber weights and activation times from the very same signed-distance
 * fields the procedural heart uses (Heart3D.chamberWeights / activationAt).
 *
 * That means the existing vertex shader animates it unchanged: the atria kick
 * before the ventricles, the base descends toward a stationary apex, the LV
 * wrings itself out with a twist, and the depolarisation wave sweeps apex to
 * base — on a scan, driven by the same cardiac clock as the ECG trace. A
 * photoreal mesh that merely scales up and down would have been much easier
 * and worth far less.
 *
 * It also slims the payload hard. A Sketchfab GLB is PNG-textured and, in the
 * case this was written for, 7.2 MB of that is texture. Re-encoded to WebP at
 * a sane resolution it drops by well over an order of magnitude, which is what
 * makes it affordable in a single-file build at all.
 *
 * LICENCE. glTF carries attribution in asset.extras, and Sketchfab populates
 * it. This script REFUSES to process a model that does not name a licence, and
 * writes whatever it finds into the manifest so the app can display it. CC-BY
 * requires attribution; that obligation is met by showing it, so the data has
 * to survive the conversion rather than being dropped on the floor here.
 */
'use strict';
const fs = require('fs');
const path = require('path');

global.window = global;
require(path.join(__dirname, '..', 'src', 'core', 'heart3d.js'));
const H3 = global.Heart3D;

const SRC = process.argv[2];
const OUT = process.argv[3] || path.join(__dirname, '..', 'assets', 'heart-scan');
if (!SRC) { console.error('usage: node scripts/prep-glb.js <model.glb> [outDir]'); process.exit(1); }

/* ── GLB ──────────────────────────────────────────────────────────────────── */
const buf = fs.readFileSync(SRC);
if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error('not a GLB');
let off = 12; const chunks = [];
while (off < buf.length) {
  const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
  chunks.push({ type, len, off: off + 8 });
  off += 8 + len;
}
const gltf = JSON.parse(buf.toString('utf8', chunks[0].off, chunks[0].off + chunks[0].len));
const BIN = chunks[1].off;

const extras = (gltf.asset && gltf.asset.extras) || {};
if (!extras.license) {
  console.error('This model carries no licence in asset.extras. Refusing to bake it in —\n' +
                'find the licence, and if it permits use, add it to the file first.');
  process.exit(1);
}
const CREDIT = {
  title: extras.title || path.basename(SRC),
  author: extras.author || 'unknown',
  license: extras.license,
  source: extras.source || '',
};

/* ── accessors ────────────────────────────────────────────────────────────── */
const COMPS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function readAccessor(i) {
  const a = gltf.accessors[i], bv = gltf.bufferViews[a.bufferView];
  const start = BIN + (bv.byteOffset || 0) + (a.byteOffset || 0);
  const n = a.count * COMPS[a.type];
  switch (a.componentType) {
    case 5126: { const o = new Float32Array(n); for (let k = 0; k < n; k++) o[k] = buf.readFloatLE(start + k * 4); return o; }
    case 5125: { const o = new Uint32Array(n);  for (let k = 0; k < n; k++) o[k] = buf.readUInt32LE(start + k * 4); return o; }
    case 5123: { const o = new Uint16Array(n);  for (let k = 0; k < n; k++) o[k] = buf.readUInt16LE(start + k * 2); return o; }
    default: throw new Error('componentType ' + a.componentType);
  }
}

/* ── node transforms, composed and baked ──────────────────────────────────── */
function ident() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
function mul(a, b) {
  const o = new Array(16);
  for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) {
    let s = 0; for (let m = 0; m < 4; m++) s += a[m * 4 + k] * b[i * 4 + m];
    o[i * 4 + k] = s;
  }
  return o;
}
function nodeMatrix(n) {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation || [0,0,0], r = n.rotation || [0,0,0,1], s = n.scale || [1,1,1];
  const [x, y, z, w] = r;
  return [ (1-2*(y*y+z*z))*s[0], (2*(x*y+z*w))*s[0], (2*(x*z-y*w))*s[0], 0,
           (2*(x*y-z*w))*s[1], (1-2*(x*x+z*z))*s[1], (2*(y*z+x*w))*s[1], 0,
           (2*(x*z+y*w))*s[2], (2*(y*z-x*w))*s[2], (1-2*(x*x+y*y))*s[2], 0,
           t[0], t[1], t[2], 1 ];
}
let world = null, meshIdx = null;
(function walk(list, parent) {
  for (const idx of list) {
    const n = gltf.nodes[idx], m = mul(parent, nodeMatrix(n));
    if (n.mesh !== undefined && world === null) { world = m; meshIdx = n.mesh; }
    if (n.children) walk(n.children, m);
  }
})(gltf.scenes[gltf.scene || 0].nodes, ident());
if (world === null) throw new Error('no mesh node found');

const prim = gltf.meshes[meshIdx].primitives[0];
const POS = readAccessor(prim.attributes.POSITION);
const NRM = readAccessor(prim.attributes.NORMAL);
const UV  = readAccessor(prim.attributes.TEXCOORD_0);
const IDX = readAccessor(prim.indices);
const vertexCount = POS.length / 3;

function xfP(m, x, y, z) {
  return [m[0]*x + m[4]*y + m[8]*z + m[12], m[1]*x + m[5]*y + m[9]*z + m[13], m[2]*x + m[6]*y + m[10]*z + m[14]];
}
function xfN(m, x, y, z) {   // no non-uniform scale in these files; rotate only
  return [m[0]*x + m[4]*y + m[8]*z, m[1]*x + m[5]*y + m[9]*z, m[2]*x + m[6]*y + m[10]*z];
}

/* ── fit into the app's anatomical frame ──────────────────────────────────────
   The procedural heart runs apex y ≈ -5.1 to the top of the atria y ≈ +6, with
   the apex swung to the patient's left and forward. The scan is fitted to the
   same span so one camera, one clip plane and one set of chamber fields serve
   both models. YAW corrects the facing, and is the one value that has to be
   found by looking at a render rather than computed. */
const YAW = Number(process.env.SCAN_YAW || 0);        // radians about +Y
const TARGET_TOP = 6.1, TARGET_BOTTOM = -5.2;
const cy = Math.cos(YAW), sy = Math.sin(YAW);

let lo = [1e9,1e9,1e9], hi = [-1e9,-1e9,-1e9];
const baked = new Float32Array(vertexCount * 3);
for (let i = 0; i < vertexCount; i++) {
  const p = xfP(world, POS[i*3], POS[i*3+1], POS[i*3+2]);
  const x = p[0]*cy + p[2]*sy, z = -p[0]*sy + p[2]*cy;
  baked[i*3] = x; baked[i*3+1] = p[1]; baked[i*3+2] = z;
  for (let k = 0; k < 3; k++) { const v = [x, p[1], z][k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
}
const scale = (TARGET_TOP - TARGET_BOTTOM) / (hi[1] - lo[1]);
const cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2;
/* The app's heart is not centred on x=0 — its apex swings left — so the scan is
   centred on the same offset rather than on the origin. */
const OFF_X = 0.35, OFF_Z = -0.30;

const outPos = new Float32Array(vertexCount * 3);
const outNrm = new Int8Array(vertexCount * 4);
const outUv  = new Uint16Array(vertexCount * 2);
const outW   = new Uint8Array(vertexCount * 4);
const outAct = new Uint16Array(vertexCount);

let wsum = [0,0,0,0];
for (let i = 0; i < vertexCount; i++) {
  const X = (baked[i*3]   - cx) * scale + OFF_X;
  const Y = (baked[i*3+1] - lo[1]) * scale + TARGET_BOTTOM;
  const Z = (baked[i*3+2] - cz) * scale + OFF_Z;
  outPos[i*3] = X; outPos[i*3+1] = Y; outPos[i*3+2] = Z;

  const n = xfN(world, NRM[i*3], NRM[i*3+1], NRM[i*3+2]);
  const nx = n[0]*cy + n[2]*sy, nz = -n[0]*sy + n[2]*cy;
  const nl = Math.hypot(nx, n[1], nz) || 1;
  outNrm[i*4]   = Math.max(-127, Math.min(127, Math.round(nx / nl * 127)));
  outNrm[i*4+1] = Math.max(-127, Math.min(127, Math.round(n[1] / nl * 127)));
  outNrm[i*4+2] = Math.max(-127, Math.min(127, Math.round(nz / nl * 127)));

  outUv[i*2]   = Math.max(0, Math.min(65535, Math.round(UV[i*2]   * 65535)));
  outUv[i*2+1] = Math.max(0, Math.min(65535, Math.round(UV[i*2+1] * 65535)));

  /* the whole point: this scan's vertices, this app's anatomy */
  const w = H3.chamberWeights(X, Y, Z);
  for (let k = 0; k < 4; k++) { outW[i*4+k] = Math.round(Math.max(0, Math.min(1, w[k])) * 255); wsum[k] += w[k]; }
  outAct[i] = Math.max(0, Math.min(65535, Math.round(H3.activationAt(X, Y, Z))));
}

/* ── indices ──────────────────────────────────────────────────────────────── */
const use16 = vertexCount <= 65535;
const outIdx = use16 ? new Uint16Array(IDX.length) : new Uint32Array(IDX.length);
for (let i = 0; i < IDX.length; i++) outIdx[i] = IDX[i];

/* ── write ────────────────────────────────────────────────────────────────── */
fs.mkdirSync(OUT, { recursive: true });
const parts = [
  Buffer.from(outPos.buffer), Buffer.from(outNrm.buffer), Buffer.from(outUv.buffer),
  Buffer.from(outW.buffer), Buffer.from(outAct.buffer), Buffer.from(outIdx.buffer),
];
const binPath = path.join(OUT, 'heart-scan.bin');
fs.writeFileSync(binPath, Buffer.concat(parts));

const manifest = {
  credit: CREDIT,
  vertexCount, indexCount: outIdx.length, indexBits: use16 ? 16 : 32,
  /* byte offsets into heart-scan.bin, in the order written above */
  layout: (() => {
    let o = 0; const L = {};
    for (const [k, b] of [['pos', parts[0]], ['nrm', parts[1]], ['uv', parts[2]],
                          ['w', parts[3]], ['act', parts[4]], ['idx', parts[5]]]) {
      L[k] = { byteOffset: o, byteLength: b.length }; o += b.length;
    }
    return L;
  })(),
  fit: { scale: +scale.toFixed(5), yaw: YAW, offX: OFF_X, offZ: OFF_Z },
  textures: { base: 'base.webp', normal: 'normal.webp', mr: 'mr.webp' },
};
fs.writeFileSync(path.join(OUT, 'heart-scan.json'), JSON.stringify(manifest, null, 1));

/* ── textures, re-encoded ─────────────────────────────────────────────────── */
const texJobs = [];
const mat = gltf.materials[prim.material] || {};
const pick = (t, name, size) => {
  if (!t) return;
  const img = gltf.images[gltf.textures[t.index].source];
  const bv = gltf.bufferViews[img.bufferView];
  const start = BIN + (bv.byteOffset || 0);
  texJobs.push({ name, size, mime: img.mimeType, data: buf.slice(start, start + bv.byteLength) });
};
pick(mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorTexture, 'base', 1024);
pick(mat.normalTexture, 'normal', 1024);
pick(mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.metallicRoughnessTexture, 'mr', 512);

(async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let before = 0, after = 0;
  for (const job of texJobs) {
    before += job.data.length;
    const dataUrl = `data:${job.mime};base64,` + job.data.toString('base64');
    const out = await page.evaluate(async ({ url, size, quality }) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const s = Math.min(size, Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * s / Math.max(img.width, img.height));
      cv.height = Math.round(img.height * s / Math.max(img.width, img.height));
      const g = cv.getContext('2d');
      g.drawImage(img, 0, 0, cv.width, cv.height);
      return { url: cv.toDataURL('image/webp', quality), w: cv.width, h: cv.height };
    }, { url: dataUrl, size: job.size, quality: job.name === 'normal' ? 0.92 : 0.86 });
    const bytes = Buffer.from(out.url.split(',')[1], 'base64');
    fs.writeFileSync(path.join(OUT, job.name + '.webp'), bytes);
    after += bytes.length;
    console.log(`  ${job.name.padEnd(7)} ${out.w}×${out.h}  ${(job.data.length/1024).toFixed(0)} KB PNG → ${(bytes.length/1024).toFixed(0)} KB WebP`);
  }
  await browser.close();

  const kb = b => (b / 1024).toFixed(0) + ' KB';
  console.log(`\n  ${CREDIT.title} — ${CREDIT.author}`);
  console.log(`  ${CREDIT.license}`);
  console.log('');
  console.log(`  vertices   ${vertexCount}   triangles ${outIdx.length / 3}`);
  console.log(`  mean chamber weight  LV ${(wsum[0]/vertexCount).toFixed(2)}  RV ${(wsum[1]/vertexCount).toFixed(2)}  LA ${(wsum[2]/vertexCount).toFixed(2)}  RA ${(wsum[3]/vertexCount).toFixed(2)}`);
  console.log(`  geometry   ${kb(fs.statSync(binPath).size)}`);
  console.log(`  textures   ${kb(before)} → ${kb(after)}`);
  console.log(`  total      ${kb(fs.statSync(SRC).size)} → ${kb(fs.statSync(binPath).size + after)}`);
  console.log(`\n  written to ${OUT}`);
})();
