/* ═══════════ Heart3D + Apex — embedded, see src/core/heart3d.js and src/ui/apex.js ═══════════ */
/* ═══════════════════════════════════════════════════════════════════════════
   heart3d.js — an anatomical heart that beats, on a real cardiac cycle.

   No external library, no model file, no textures. The anatomy is defined as
   signed distance fields and meshed at load with surface nets; the beat is a
   vertex-shader deformation driven by the same cardiac clock the ECG engine
   uses, so the muscle and the trace are showing one event, not two.

   What it models, and why each part earns its place:
     · four chambers, contracting on their own schedule — the atria kick
       before the ventricles, which is the whole point of a P wave
     · ventricular contraction as it actually happens: the apex stays put,
       the base descends toward it, the walls thicken, and the LV twists
     · four valves, hinged, opening and closing at the right moments of the
       cycle — including the isovolumetric periods where everything is shut
     · the conduction system, with a depolarisation wave you can watch run
       SA → AV → His → bundles → Purkinje
     · coronaries in the grooves, because that is where they are

   Usage:
     const heart = Heart3D.create(canvas, { rhythm:'sinus', mode:'whole' });
     heart.setRhythm('afib');        // irregular filling, no atrial kick
     heart.setMode('cutaway');       // chambers and valves laid open
     heart.destroy();

   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

/* ── tiny vector / matrix helpers ─────────────────────────────────────────── */
function v3(x, y, z) { return [x, y, z]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function len(a) { return Math.hypot(a[0], a[1], a[2]); }
function norm(a) { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function mid(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function mat4Identity() { return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); }
function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0]);
}
function mat4LookAt(eye, center, up) {
  const z = norm(sub(eye, center));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]), 1]);
}
function mat4Mul(a, b) {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
    o[i * 4 + j] = s;
  }
  return o;
}

/* ── signed distance primitives ───────────────────────────────────────────── */
function sdEllipsoid(px, py, pz, cx, cy, cz, rx, ry, rz) {
  const x = (px - cx) / rx, y = (py - cy) / ry, z = (pz - cz) / rz;
  const k = Math.hypot(x, y, z);
  return (k - 1) * Math.min(rx, ry, rz);
}
/* exact rounded cone — the workhorse for ventricles and great vessels */
function sdRoundCone(px, py, pz, a, b, r1, r2) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const xx = pax * l2 - bax * y, xy = pay * l2 - bay * y, xz = paz * l2 - baz * y;
  const x2 = xx * xx + xy * xy + xz * xz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = (rr < 0 ? -1 : 1) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
function sdCapsule(px, py, pz, a, b, r) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const d = bax * bax + bay * bay + baz * baz;
  let h = (pax * bax + pay * bay + paz * baz) / (d || 1e-6);
  h = h < 0 ? 0 : h > 1 ? 1 : h;
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.hypot(dx, dy, dz) - r;
}
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function smax(a, b, k) { return -smin(-a, -b, k); }

/* ── the anatomy ──────────────────────────────────────────────────────────────
   Coordinates: +X patient's left, +Y superior, +Z anterior. Units are roughly
   centimetres, heart ≈ 13 cm base to apex. Wall thicknesses are a little
   generous versus life — this is a teaching model that has to read clearly at
   thumbnail size, not a segmentation.                                        */
const A = {
  lv: { base: v3(0.3, 2.8, -0.4), apex: v3(2.9, -5.0, 1.2), cav: [2.05, 0.50], myo: [3.05, 1.05] },
  rv: { base: v3(-2.2, 2.5, 0.9), apex: v3(1.5, -3.8, 1.9), cav: [2.20, 0.55], myo: [2.78, 0.95] },
  la: { c: v3(0.2, 4.6, -2.0), r: v3(2.00, 1.70, 1.80), w: 0.30 },
  ra: { c: v3(-2.8, 3.8, -0.3), r: v3(1.90, 1.90, 1.75), w: 0.30 },
};
/* great vessels as chains of capsules */
const AORTA = [[v3(0.2, 3.4, -0.3), v3(0.1, 5.6, -0.5), 1.15],
               [v3(0.1, 5.6, -0.5), v3(-0.9, 7.2, -1.2), 1.05],
               [v3(-0.9, 7.2, -1.2), v3(-1.1, 5.4, -2.5), 0.95],
               [v3(-1.1, 5.4, -2.5), v3(-0.9, 2.4, -2.9), 0.85]];
const PA    = [[v3(-0.9, 4.4, 1.4), v3(-0.5, 6.0, 0.5), 1.00],
               [v3(-0.5, 6.0, 0.5), v3(1.7, 6.5, -0.5), 0.72],
               [v3(-0.5, 6.0, 0.5), v3(-2.4, 6.2, -0.7), 0.72]];
const CAVA  = [[v3(-3.0, 8.0, -1.0), v3(-2.9, 4.6, -0.6), 0.78],   // SVC
               [v3(-2.5, 1.0, -1.5), v3(-2.8, 3.2, -0.8), 0.82]];  // IVC
const PVEIN = [[v3(1.9, 5.6, -3.6), v3(1.1, 5.0, -2.4), 0.45],
               [v3(-1.4, 5.6, -3.6), v3(-0.6, 5.0, -2.5), 0.45],
               [v3(2.0, 3.8, -3.4), v3(1.2, 4.1, -2.5), 0.42],
               [v3(-1.5, 3.8, -3.3), v3(-0.6, 4.1, -2.5), 0.42]];

function chainDist(px, py, pz, chain, grow) {
  let d = 1e9;
  for (const [a, b, r] of chain) d = Math.min(d, sdCapsule(px, py, pz, a, b, r + (grow || 0)));
  return d;
}

/* cavity of each chamber — used for weights, for the cutaway interior, and to
   hollow the muscle out */
function sdCavLV(x, y, z) { return sdRoundCone(x, y, z, A.lv.base, A.lv.apex, A.lv.cav[0], A.lv.cav[1]); }
function sdCavRV(x, y, z) {
  const rv = sdRoundCone(x, y, z, A.rv.base, A.rv.apex, A.rv.cav[0], A.rv.cav[1]);
  const lvWall = sdRoundCone(x, y, z, A.lv.base, A.lv.apex, A.lv.myo[0], A.lv.myo[1]);
  return smax(rv, -lvWall, 0.35);            // the septum belongs to the LV
}
function sdCavLA(x, y, z) { return sdEllipsoid(x, y, z, A.la.c[0], A.la.c[1], A.la.c[2], A.la.r[0], A.la.r[1], A.la.r[2]); }
function sdCavRA(x, y, z) { return sdEllipsoid(x, y, z, A.ra.c[0], A.ra.c[1], A.ra.c[2], A.ra.r[0], A.ra.r[1], A.ra.r[2]); }

function sdCavities(x, y, z) {
  let d = smin(sdCavLV(x, y, z), sdCavRV(x, y, z), 0.5);
  d = smin(d, sdCavLA(x, y, z), 0.6);
  d = smin(d, sdCavRA(x, y, z), 0.6);
  d = smin(d, chainDist(x, y, z, AORTA, 0) - 0.02, 0.5);
  d = smin(d, chainDist(x, y, z, PA, 0), 0.5);
  return d;
}
/* outer surface: muscle plus vessels, fused */
function sdOuter(x, y, z) {
  const lv = sdRoundCone(x, y, z, A.lv.base, A.lv.apex, A.lv.myo[0], A.lv.myo[1]);
  const rv = sdRoundCone(x, y, z, A.rv.base, A.rv.apex, A.rv.myo[0], A.rv.myo[1]);
  let d = smin(lv, rv, 0.75);
  d = smin(d, sdEllipsoid(x, y, z, A.la.c[0], A.la.c[1], A.la.c[2],
        A.la.r[0] + A.la.w, A.la.r[1] + A.la.w, A.la.r[2] + A.la.w), 0.8);
  d = smin(d, sdEllipsoid(x, y, z, A.ra.c[0], A.ra.c[1], A.ra.c[2],
        A.ra.r[0] + A.ra.w, A.ra.r[1] + A.ra.w, A.ra.r[2] + A.ra.w), 0.8);
  /* left atrial appendage — small, hooked, and the reason half of cardiology
     cares about the left atrium at all */
  d = smin(d, sdCapsule(x, y, z, v3(1.9, 4.6, -0.9), v3(2.7, 3.6, -0.2), 0.52), 0.45);
  d = smin(d, sdCapsule(x, y, z, v3(-3.6, 4.6, 0.6), v3(-4.1, 3.6, 0.9), 0.55), 0.45);  // RAA
  d = smin(d, chainDist(x, y, z, AORTA, 0.20), 0.55);
  d = smin(d, chainDist(x, y, z, PA, 0.18), 0.55);
  d = smin(d, chainDist(x, y, z, CAVA, 0.16), 0.45);
  d = smin(d, chainDist(x, y, z, PVEIN, 0.14), 0.40);
  return d;
}

/* which structure a point belongs to — drives colour, not geometry */
const REGION = { MYO: 0, ATRIUM: 1, AORTA: 2, PA: 3, VEIN: 4, APPENDAGE: 5 };
function regionDistances(x, y, z) {
  return [
    Math.min(sdRoundCone(x, y, z, A.lv.base, A.lv.apex, A.lv.myo[0], A.lv.myo[1]),
             sdRoundCone(x, y, z, A.rv.base, A.rv.apex, A.rv.myo[0], A.rv.myo[1])),
    Math.min(sdEllipsoid(x, y, z, A.la.c[0], A.la.c[1], A.la.c[2], A.la.r[0] + A.la.w, A.la.r[1] + A.la.w, A.la.r[2] + A.la.w),
             sdEllipsoid(x, y, z, A.ra.c[0], A.ra.c[1], A.ra.c[2], A.ra.r[0] + A.ra.w, A.ra.r[1] + A.ra.w, A.ra.r[2] + A.ra.w)),
    chainDist(x, y, z, AORTA, 0.20),
    chainDist(x, y, z, PA, 0.14),
    Math.min(chainDist(x, y, z, CAVA, 0.16), chainDist(x, y, z, PVEIN, 0.14)),
    Math.min(sdCapsule(x, y, z, v3(1.9, 4.6, -0.9), v3(2.7, 3.6, -0.2), 0.52),
             sdCapsule(x, y, z, v3(-3.6, 4.6, 0.6), v3(-4.1, 3.6, 0.9), 0.55)),
  ];
}
function regionAt(x, y, z) {
  const d = regionDistances(x, y, z);
  let best = 0;
  for (let i = 1; i < d.length; i++) if (d[i] < d[best]) best = i;
  return best;
}

/* how strongly a point belongs to each chamber — this is what makes the atria
   able to contract while the ventricles are still filling */
function chamberWeights(x, y, z) {
  const d = [sdCavLV(x, y, z), sdCavRV(x, y, z), sdCavLA(x, y, z), sdCavRA(x, y, z)];
  const w = d.map(v => Math.exp(-Math.max(v, 0) * 1.15));
  const s = w[0] + w[1] + w[2] + w[3];
  return s > 1e-4 ? w.map(v => v / s) : [0, 0, 0, 0];
}

/* activation time in ms from the sinus node — drives the conduction wave, and
   is genuinely the sequence: septum first, apex before base, endo before epi */
function activationAt(x, y, z) {
  const dLA = len(sub([x, y, z], A.la.c)), dRA = len(sub([x, y, z], A.ra.c));
  if (Math.min(dLA, dRA) < 2.6) return 6 + Math.min(dLA, dRA) * 14;      // atria: 6-45ms
  const apex = A.lv.apex, base = A.lv.base;
  const axis = norm(sub(base, apex));
  const rel = sub([x, y, z], apex);
  const along = rel[0] * axis[0] + rel[1] * axis[1] + rel[2] * axis[2];
  const frac = Math.max(0, Math.min(1, along / 8.4));
  return 150 + frac * 55 + Math.abs(x - 1.0) * 3;                        // apex→base
}

/* ── surface nets ─────────────────────────────────────────────────────────────
   Chosen over marching cubes: no 256-entry lookup table, and it produces the
   smoother, more organic surface that muscle wants. One vertex per cell that
   straddles the surface, positioned at the average of its edge crossings.   */
const CUBE_EDGES = [[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
function surfaceNets(fn, lo, hi, res) {
  const nx = res[0], ny = res[1], nz = res[2];
  const dx = (hi[0] - lo[0]) / nx, dy = (hi[1] - lo[1]) / ny, dz = (hi[2] - lo[2]) / nz;
  const sx = nx + 1, sy = ny + 1, sz = nz + 1;
  const field = new Float32Array(sx * sy * sz);
  for (let k = 0; k < sz; k++) {
    const z = lo[2] + k * dz;
    for (let j = 0; j < sy; j++) {
      const y = lo[1] + j * dy;
      let idx = (k * sy + j) * sx;
      for (let i = 0; i < sx; i++) field[idx + i] = fn(lo[0] + i * dx, y, z);
    }
  }
  const at = (i, j, k) => field[(k * sy + j) * sx + i];
  const cellVert = new Int32Array(nx * ny * nz).fill(-1);
  const positions = [];
  const corner = [[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const s = [];
    let neg = 0;
    for (let c = 0; c < 8; c++) {
      const v = at(i + corner[c][0], j + corner[c][1], k + corner[c][2]);
      s.push(v);
      if (v < 0) neg++;
    }
    if (neg === 0 || neg === 8) continue;
    let ax = 0, ay = 0, az = 0, n = 0;
    for (const [a, b] of CUBE_EDGES) {
      if ((s[a] < 0) === (s[b] < 0)) continue;
      const t = s[a] / (s[a] - s[b]);
      ax += corner[a][0] + (corner[b][0] - corner[a][0]) * t;
      ay += corner[a][1] + (corner[b][1] - corner[a][1]) * t;
      az += corner[a][2] + (corner[b][2] - corner[a][2]) * t;
      n++;
    }
    cellVert[(k * ny + j) * nx + i] = positions.length / 3;
    positions.push(lo[0] + (i + ax / n) * dx, lo[1] + (j + ay / n) * dy, lo[2] + (k + az / n) * dz);
  }
  /* quads across every sign-changing grid edge, wound consistently */
  const indices = [];
  const cv = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz)
    ? -1 : cellVert[(k * ny + j) * nx + i];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) indices.push(a, c, b, a, d, c);
    else indices.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < sz; k++) for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) {
    const v0 = at(i, j, k);
    if (i < nx) { const v1 = at(i + 1, j, k);
      if ((v0 < 0) !== (v1 < 0)) quad(cv(i, j - 1, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i, j - 1, k), v0 >= 0); }
    if (j < ny) { const v1 = at(i, j + 1, k);
      if ((v0 < 0) !== (v1 < 0)) quad(cv(i - 1, j, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i - 1, j, k), v0 < 0); }
    if (k < nz) { const v1 = at(i, j, k + 1);
      if ((v0 < 0) !== (v1 < 0)) quad(cv(i - 1, j - 1, k), cv(i, j - 1, k), cv(i, j, k), cv(i - 1, j, k), v0 >= 0); }
  }
  return { positions: new Float32Array(positions), indices };
}

/* normals straight from the field gradient — smoother than face averaging */
function gradientNormals(fn, positions) {
  const n = new Float32Array(positions.length);
  const h = 0.045;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    let gx = fn(x + h, y, z) - fn(x - h, y, z);
    let gy = fn(x, y + h, z) - fn(x, y - h, z);
    let gz = fn(x, y, z + h) - fn(x, y, z - h);
    const l = Math.hypot(gx, gy, gz) || 1;
    n[i] = gx / l; n[i + 1] = gy / l; n[i + 2] = gz / l;
  }
  return n;
}

/* Tissue colours, in the space you would pick them in. The shader converts to
   linear before lighting — shading in sRGB is what makes naive renders look
   like washed-out plastic. */
const COLORS = {
  [REGION.MYO]:       [0.557, 0.141, 0.125],
  [REGION.ATRIUM]:    [0.576, 0.255, 0.227],
  [REGION.AORTA]:     [0.788, 0.725, 0.659],
  [REGION.PA]:        [0.557, 0.608, 0.710],
  [REGION.VEIN]:      [0.435, 0.486, 0.600],
  [REGION.APPENDAGE]: [0.604, 0.290, 0.251],
};
const FAT = [0.851, 0.753, 0.478];

/* Ambient occlusion straight off the distance field: march a little way along
   the normal and see how much muscle is still in the way. This is most of what
   makes the grooves and the atrioventricular junction read as real. */
function aoAt(fn, x, y, z, nx, ny, nz) {
  let occ = 0, sca = 1;
  for (let i = 1; i <= 5; i++) {
    const h = 0.04 * i * i;
    occ += (h - fn(x + nx * h, y + ny * h, z + nz * h)) * sca;
    sca *= 0.82;
  }
  return Math.max(0, Math.min(1, 1 - occ * 1.6));
}

/* Per-vertex colour rather than a per-fragment region lookup: an interpolated
   region *index* is meaningless between two different tissues and staircases
   along every triangle edge. Interpolating the colour itself is smooth. */
function attributesFor(positions, normals, field) {
  const count = positions.length / 3;
  const weights = new Float32Array(count * 4);
  const color = new Float32Array(count * 3);
  const extra = new Float32Array(count * 3);     // ao, activation ms, groove
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const w = chamberWeights(x, y, z);
    weights.set(w, i * 4);

    /* Blend tissue colours by distance rather than picking a winner. Hard
       classification puts a visible staircase wherever two tissues meet,
       because neighbouring vertices flip between them; real tissue transitions
       are gradual anyway. */
    const rd = regionDistances(x, y, z);
    let nearest = 0;
    for (let r = 1; r < rd.length; r++) if (rd[r] < rd[nearest]) nearest = r;
    const c = [0, 0, 0];
    let wsum = 0;
    for (let r = 0; r < rd.length; r++) {
      const wr = Math.exp(-(rd[r] - rd[nearest]) / 0.42);
      const cr = COLORS[r];
      c[0] += cr[0] * wr; c[1] += cr[1] * wr; c[2] += cr[2] * wr;
      wsum += wr;
    }
    c[0] /= wsum; c[1] /= wsum; c[2] /= wsum;
    const region = nearest;
    /* epicardial fat gathers in the grooves — the interventricular groove where
       LV and RV meet, and the atrioventricular groove above them */
    const ventric = w[0] + w[1], atrial = w[2] + w[3];
    const ivGroove = (1 - Math.min(1, Math.abs(w[0] - w[1]) * 2.6)) * Math.min(1, ventric * 1.4);
    const avGroove = Math.min(1, 4.2 * ventric * atrial);
    const groove = Math.max(ivGroove, avGroove) * (region === REGION.MYO || region === REGION.ATRIUM ? 1 : 0);
    const f = groove * 0.42;
    color[i * 3]     = c[0] * (1 - f) + FAT[0] * f;
    color[i * 3 + 1] = c[1] * (1 - f) + FAT[1] * f;
    color[i * 3 + 2] = c[2] * (1 - f) + FAT[2] * f;

    extra[i * 3] = aoAt(field, x, y, z, normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
    extra[i * 3 + 1] = activationAt(x, y, z);
    extra[i * 3 + 2] = groove;
  }
  return { weights, color, extra };
}

/* ── valves ───────────────────────────────────────────────────────────────────
   Each leaflet is a curved sheet hinged on the annulus. The shader rotates it
   about its hinge, so "open" and "shut" are one number per valve and the
   geometry is built once.                                                    */
const VALVES = [
  { id: 0, name: 'mitral',    c: v3(0.75, 2.55, -0.75), n: norm(sub(A.lv.apex, A.lv.base)), r: 1.55, leaflets: 2, open: 1.15 },
  { id: 1, name: 'tricuspid', c: v3(-1.85, 2.35, 0.35), n: norm(sub(A.rv.apex, A.rv.base)), r: 1.65, leaflets: 3, open: 1.15 },
  { id: 2, name: 'aortic',    c: v3(0.2, 3.45, -0.35),  n: v3(-0.05, 1, -0.1),              r: 1.05, leaflets: 3, open: -1.05 },
  { id: 3, name: 'pulmonic',  c: v3(-0.95, 3.85, 1.4),  n: v3(0.2, 1, -0.4),                r: 0.95, leaflets: 3, open: -1.05 },
];
function basisFor(n) {
  const nn = norm(n);
  const ref = Math.abs(nn[1]) > 0.9 ? v3(1, 0, 0) : v3(0, 1, 0);
  const u = norm(cross(ref, nn));
  return [u, cross(nn, u), nn];
}
function buildValves() {
  const pos = [], nrm = [], hingeP = [], hingeA = [], vid = [], wts = [], idx = [];
  const NU = 5, NV = 7;
  for (const V of VALVES) {
    const [u, v, n] = basisFor(V.n);
    for (let L = 0; L < V.leaflets; L++) {
      const a0 = (L / V.leaflets) * Math.PI * 2, a1 = ((L + 1) / V.leaflets) * Math.PI * 2;
      const gap = 0.10;
      const base = pos.length / 3;
      /* hinge runs along the chord of this leaflet's arc */
      const p0 = [V.c[0] + (u[0] * Math.cos(a0 + gap) + v[0] * Math.sin(a0 + gap)) * V.r,
                  V.c[1] + (u[1] * Math.cos(a0 + gap) + v[1] * Math.sin(a0 + gap)) * V.r,
                  V.c[2] + (u[2] * Math.cos(a0 + gap) + v[2] * Math.sin(a0 + gap)) * V.r];
      const p1 = [V.c[0] + (u[0] * Math.cos(a1 - gap) + v[0] * Math.sin(a1 - gap)) * V.r,
                  V.c[1] + (u[1] * Math.cos(a1 - gap) + v[1] * Math.sin(a1 - gap)) * V.r,
                  V.c[2] + (u[2] * Math.cos(a1 - gap) + v[2] * Math.sin(a1 - gap)) * V.r];
      const axis = norm(sub(p1, p0));
      for (let iu = 0; iu <= NU; iu++) {
        const tu = iu / NU;                          // 0 at hinge, 1 at free edge
        for (let iv = 0; iv <= NV; iv++) {
          const tv = iv / NV;
          const ang = (a0 + gap) + (a1 - a0 - 2 * gap) * tv;
          const rr = V.r * (1 - tu * 0.94);
          const belly = Math.sin(tv * Math.PI) * 0.16 * tu;   // leaflets are not flat
          const px = V.c[0] + (u[0] * Math.cos(ang) + v[0] * Math.sin(ang)) * rr + n[0] * (belly + tu * 0.05);
          const py = V.c[1] + (u[1] * Math.cos(ang) + v[1] * Math.sin(ang)) * rr + n[1] * (belly + tu * 0.05);
          const pz = V.c[2] + (u[2] * Math.cos(ang) + v[2] * Math.sin(ang)) * rr + n[2] * (belly + tu * 0.05);
          pos.push(px, py, pz);
          nrm.push(n[0], n[1], n[2]);
          hingeP.push(p0[0], p0[1], p0[2]);
          hingeA.push(axis[0], axis[1], axis[2]);
          vid.push(V.id);
          wts.push(...chamberWeights(V.c[0], V.c[1], V.c[2]));
        }
      }
      for (let iu = 0; iu < NU; iu++) for (let iv = 0; iv < NV; iv++) {
        const a = base + iu * (NV + 1) + iv, b = a + 1, c = a + (NV + 1), d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
    }
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nrm),
           hingeP: new Float32Array(hingeP), hingeA: new Float32Array(hingeA),
           vid: new Float32Array(vid), weights: new Float32Array(wts), indices: idx };
}

/* ── tubes: coronaries and the conduction system ──────────────────────────── */
function tubeAlong(points, radius, out, rgb, onSurface) {
  if (onSurface) points = projectToSurface(points, radius * 0.55);
  const RING = 7;
  const base = out.positions.length / 3;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const t = norm(sub(points[Math.min(i + 1, points.length - 1)], points[Math.max(i - 1, 0)]));
    const [u, v] = basisFor(t);
    const w = chamberWeights(p[0], p[1], p[2]);
    const act = activationAt(p[0], p[1], p[2]);
    for (let r = 0; r < RING; r++) {
      const a = (r / RING) * Math.PI * 2;
      const nx = u[0] * Math.cos(a) + v[0] * Math.sin(a);
      const ny = u[1] * Math.cos(a) + v[1] * Math.sin(a);
      const nz = u[2] * Math.cos(a) + v[2] * Math.sin(a);
      out.positions.push(p[0] + nx * radius, p[1] + ny * radius, p[2] + nz * radius);
      out.normals.push(nx, ny, nz);
      out.weights.push(w[0], w[1], w[2], w[3]);
      out.color.push(rgb[0], rgb[1], rgb[2]);
      out.extra.push(0.88, act, 0);
    }
  }
  for (let i = 0; i < points.length - 1; i++) for (let r = 0; r < RING; r++) {
    const a = base + i * RING + r, b = base + i * RING + (r + 1) % RING;
    const c = a + RING, d = b + RING;
    out.indices.push(a, b, d, a, d, c);
  }
}
function bezier(p0, p1, p2, p3, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, mt = 1 - t;
    out.push([
      mt*mt*mt*p0[0] + 3*mt*mt*t*p1[0] + 3*mt*t*t*p2[0] + t*t*t*p3[0],
      mt*mt*mt*p0[1] + 3*mt*mt*t*p1[1] + 3*mt*t*t*p2[1] + t*t*t*p3[1],
      mt*mt*mt*p0[2] + 3*mt*mt*t*p1[2] + 3*mt*t*t*p2[2] + t*t*t*p3[2]]);
  }
  return out;
}
const CORONARY_RGB = [0.408, 0.153, 0.129];
const CONDUCTION_RGB = [0.961, 0.843, 0.431];
function emptyTube() { return { positions: [], normals: [], weights: [], color: [], extra: [], indices: [] }; }
/* Hand-placed control points never land exactly on a surface defined by a
   distance field. Walk each point onto the epicardium, then lift it by its own
   radius so the vessel sits proud of the muscle the way a coronary does. */
function projectToSurface(points, lift) {
  return points.map(p => {
    let q = [p[0], p[1], p[2]];
    for (let it = 0; it < 6; it++) {
      const d = sdOuter(q[0], q[1], q[2]);
      const h = 0.05;
      const g = norm([sdOuter(q[0] + h, q[1], q[2]) - sdOuter(q[0] - h, q[1], q[2]),
                      sdOuter(q[0], q[1] + h, q[2]) - sdOuter(q[0], q[1] - h, q[2]),
                      sdOuter(q[0], q[1], q[2] + h) - sdOuter(q[0], q[1], q[2] - h)]);
      q = [q[0] - g[0] * d, q[1] - g[1] * d, q[2] - g[2] * d];
    }
    const h = 0.05;
    const g = norm([sdOuter(q[0] + h, q[1], q[2]) - sdOuter(q[0] - h, q[1], q[2]),
                    sdOuter(q[0], q[1] + h, q[2]) - sdOuter(q[0], q[1] - h, q[2]),
                    sdOuter(q[0], q[1], q[2] + h) - sdOuter(q[0], q[1], q[2] - h)]);
    return [q[0] + g[0] * lift, q[1] + g[1] * lift, q[2] + g[2] * lift];
  });
}

function buildCoronaries() {
  const out = emptyTube();
  /* LAD — down the anterior interventricular groove, where the RV meets the LV */
  tubeAlong(bezier(v3(0.1, 3.2, 0.9), v3(0.6, 1.4, 2.3), v3(1.6, -1.0, 2.6), v3(2.7, -4.2, 1.7), 22), 0.135, out, CORONARY_RGB, true);
  /* LCx — around the left atrioventricular groove */
  tubeAlong(bezier(v3(0.2, 3.2, 0.7), v3(1.9, 3.0, 0.4), v3(3.0, 1.8, -0.9), v3(2.4, 0.2, -2.1), 18), 0.115, out, CORONARY_RGB, true);
  /* RCA — right AV groove, round to the inferior wall */
  tubeAlong(bezier(v3(-0.9, 3.2, 0.9), v3(-2.6, 2.6, 1.4), v3(-3.4, 0.6, 0.2), v3(-1.6, -1.8, -1.6), 20), 0.125, out, CORONARY_RGB, true);
  return out;
}
function buildConduction() {
  const out = emptyTube();
  const SA = v3(-3.2, 4.9, 0.3), AV = v3(-1.0, 2.6, -0.5), HIS = v3(-0.3, 1.9, 0.1);
  tubeAlong(bezier(SA, v3(-2.6, 4.2, 0.1), v3(-1.6, 3.2, -0.3), AV, 10), 0.10, out, CONDUCTION_RGB);
  tubeAlong([AV, HIS, v3(0.1, 1.2, 0.4)], 0.10, out, CONDUCTION_RGB);
  /* left and right bundle branches fanning into Purkinje */
  tubeAlong(bezier(v3(0.1, 1.2, 0.4), v3(0.9, 0.2, 0.2), v3(1.8, -1.6, 0.6), v3(2.6, -3.9, 1.1), 12), 0.075, out, CONDUCTION_RGB);
  tubeAlong(bezier(v3(0.1, 1.2, 0.4), v3(-0.2, 0.0, 1.2), v3(0.6, -1.8, 1.8), v3(1.5, -3.4, 1.8), 12), 0.075, out, CONDUCTION_RGB);
  tubeAlong(bezier(v3(0.1, 1.2, 0.4), v3(1.2, 0.4, -0.6), v3(2.2, -1.2, -0.8), v3(2.6, -3.2, -0.2), 12), 0.065, out, CONDUCTION_RGB);
  return out;
}

/* ── the cardiac cycle ────────────────────────────────────────────────────────
   One clock for the whole model. Returns, for a moment in time: how hard each
   chamber is squeezing, how open each valve is, and where the depolarisation
   wave has reached. Rhythms mirror the ECG engine so the two agree.         */
const RHYTHM_HR = { sinus: 68, brady: 44, tachy: 130, afib: 110, flutter: 150, vt: 180,
                    vfib: 0, chb: 38, torsades: 230, stemi: 88, paced: 70, asystole: 0 };

function cycle(tms, kind, state) {
  const st = state || {};
  const out = { a: 0, v: 0, valves: [0, 0, 0, 0], act: -1, beat: 0, quiver: 0 };
  if (kind === 'asystole') { out.valves = [0.35, 0.35, 0, 0]; return out; }
  if (kind === 'vfib') {
    out.quiver = 1;
    out.v = 0.14 + 0.10 * Math.sin(tms / 41) + 0.06 * Math.sin(tms / 17);
    out.a = 0.08 + 0.05 * Math.sin(tms / 23);
    out.valves = [0.25, 0.25, 0.06, 0.06];
    return out;
  }
  const hr = RHYTHM_HR[kind] || 68;
  const RR = 60000 / hr;

  /* atria and ventricles keep separate time only in complete heart block */
  let aPhase, vPhase, vRR = RR;
  if (kind === 'chb') {
    aPhase = tms % (60000 / 78);
    vPhase = tms % (60000 / 38);
    vRR = 60000 / 38;
  } else if (kind === 'afib') {
    /* same deterministic irregularity the ECG trace uses, so they stay in step */
    if (st.next === undefined) { st.next = 0; st.rr = 600; st.n = 0; }
    while (tms >= st.next + st.rr) {
      st.next += st.rr; st.n++;
      st.rr = 380 + (Math.abs(Math.sin(st.n * 12.9898) * 43758.5453) % 1) * 620;
    }
    vPhase = tms - st.next; vRR = st.rr; aPhase = null;
  } else {
    aPhase = tms % RR; vPhase = aPhase;
  }

  /* atrial systole — the kick that tops the ventricle up before it contracts */
  if (kind === 'afib') out.a = 0.05 + 0.04 * Math.sin(tms / 19);     // fibrillating, no kick
  else if (kind === 'flutter') out.a = 0.30 + 0.30 * Math.sin(tms / (60000 / 300) * Math.PI * 2);
  else {
    const ap = aPhase;
    out.a = ap < 90 ? Math.sin(ap / 90 * Math.PI) * 0.85
          : ap < 200 ? Math.max(0, 1 - (ap - 90) / 110) * 0.25 : 0;
  }

  const PR = (kind === 'chb' || kind === 'afib' || kind === 'vt' || kind === 'paced') ? 0 : 160;
  const sysDur = Math.min(vRR * 0.46, 300 + vRR * 0.09);
  const t = vPhase - PR;

  if (t >= 0 && t < sysDur * 1.5) {
    const rise = sysDur * 0.38;
    out.v = t < rise ? Math.sin((t / rise) * Math.PI / 2)
          : Math.max(0, 1 - (t - rise) / (sysDur * 0.72));
    out.v = Math.max(0, Math.min(1, out.v));
  }
  if (kind === 'vt' || kind === 'torsades') out.v *= 0.55;    // poor filling, poor output
  out.beat = out.v;

  /* valves. AV shut the moment the ventricle starts to squeeze; semilunars wait
     out isovolumetric contraction, then open; everything shuts again in
     isovolumetric relaxation. */
  const avOpen = (t < 0 || t > sysDur * 1.16) ? 1 : 0;
  const semi = (t > sysDur * 0.10 && t < sysDur * 1.0) ? 1 : 0;
  const ease = (cur, want, k) => cur + (want - cur) * k;
  st.mv = ease(st.mv === undefined ? 1 : st.mv, avOpen, 0.35);
  st.sv = ease(st.sv === undefined ? 0 : st.sv, semi, 0.40);
  out.valves = [st.mv, st.mv, st.sv, st.sv];
  if (kind === 'asystole') out.valves = [0.4, 0.4, 0, 0];

  /* depolarisation wave position, in ms since the sinus node fired */
  const actWindow = 320;
  out.act = (vPhase >= 0 && vPhase < actWindow) ? vPhase : -1;
  if (kind === 'afib') out.act = (vPhase < 120 && vPhase >= 0) ? 150 + vPhase : -1;
  return out;
}

/* ── shaders ──────────────────────────────────────────────────────────────── */
const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec4 aW;        // LV RV LA RA
layout(location=3) in vec3 aColor;    // tissue colour, interpolated smoothly
layout(location=4) in vec3 aExtra;    // ao, activation ms, groove

uniform mat4 uProj, uView;
uniform float uA, uV;                 // atrial / ventricular contraction 0-1
uniform float uQuiver, uTime;
uniform vec3 uLvApex, uLvAxis, uRvApex, uRvAxis, uLaC, uRaC;

out vec3 vN, vWorld, vColor, vExtra;
out vec4 vW;

vec3 rotAxis(vec3 p, vec3 axis, float ang){
  float c = cos(ang), s = sin(ang);
  return p*c + cross(axis,p)*s + axis*dot(axis,p)*(1.0-c);
}

void main(){
  vec3 p = aPos;
  vec3 n = aNrm;

  // ── ventricles: the apex stays, the base descends toward it, walls thicken,
  //    and the left ventricle wrings itself out with a twist.
  float wv = aW.x + aW.y;
  if (wv > 0.001) {
    // left
    vec3 rel = p - uLvApex;
    float along = dot(rel, uLvAxis);
    vec3 radial = rel - uLvAxis*along;
    float k = uV * aW.x;
    p -= uLvAxis * along * (0.17*k);
    p -= radial * (0.20*k);
    p += n * (0.30*k*aW.x);
    p = uLvApex + rotAxis(p - uLvApex, uLvAxis, (along*0.018 - 0.05) * uV * aW.x);
    // right
    vec3 rel2 = p - uRvApex;
    float along2 = dot(rel2, uRvAxis);
    vec3 radial2 = rel2 - uRvAxis*along2;
    float k2 = uV * aW.y;
    p -= uRvAxis * along2 * (0.13*k2);
    p -= radial2 * (0.22*k2);
    p += n * (0.16*k2*aW.y);
  }
  // ── atria: a simple squeeze toward their own centre
  p += (uLaC - p) * (0.20 * uA * aW.z);
  p += (uRaC - p) * (0.20 * uA * aW.w);

  // ── fibrillation: no organised contraction, just a shimmer
  if (uQuiver > 0.0) {
    float q = sin(p.x*7.0 + uTime*0.021) * sin(p.y*6.0 - uTime*0.017) * sin(p.z*8.0 + uTime*0.013);
    p += n * q * 0.10 * uQuiver;
  }

  vN = n; vWorld = p; vColor = aColor; vExtra = aExtra; vW = aW;
  gl_Position = uProj * uView * vec4(p, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vN, vWorld, vColor, vExtra;
in vec4 vW;
out vec4 outColor;

uniform vec3 uEye;
uniform float uAct;          // depolarisation front, ms; <0 when quiet
uniform int  uMode;          // 0 whole, 1 cutaway, 2 conduction, 3 coronary
uniform int  uKind;          // 0 muscle, 1 coronary, 2 conduction, 3 valve
uniform float uClipX;
uniform float uV;
uniform float uDark;         // 1 when the page is in dark mode

// A sin-based hash loses precision once coordinates get large, and degrades
// into per-pixel white noise — which, fed into the normal, flattens all the
// lighting. This one is integer-ish and stable at any scale we use.
float hash(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float n = mix(mix(mix(hash(i+vec3(0,0,0)), hash(i+vec3(1,0,0)), f.x),
                    mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
                    mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
  return n;
}

vec3 toLinear(vec3 c){ return pow(c, vec3(2.2)); }

void main(){
  // cutaway: slice the near half away so the chambers are open to view
  if ((uMode == 1 || uMode == 2) && vWorld.z > uClipX) discard;

  vec3 N = normalize(vN);
  vec3 V = normalize(uEye - vWorld);
  // The field gradient always points out of the tissue, so this is a more
  // reliable "am I seeing the inside of this?" test than triangle winding.
  bool back = dot(N, V) < 0.0;
  if (back) N = -N;

  float ao = vExtra.x;
  vec3 base = toLinear(vColor);

  // muscle fibre striation — subtle, and it is what makes the surface read as
  // tissue rather than a shaded balloon
  if (uKind == 0) {
    float fib = noise(vWorld*2.8)*0.6 + noise(vWorld*7.0)*0.26;
    base *= 0.86 + fib*0.30;
    N = normalize(N + vec3(noise(vWorld*9.0)-0.5, noise(vWorld*9.0+7.0)-0.5,
                           noise(vWorld*9.0+3.0)-0.5) * 0.09);
  }
  // The inside of a chamber is darker and trabeculated, but it still has to be
  // readable — it is the thing a cutaway exists to show.
  if (back) {
    base *= 0.66;
    base *= 0.78 + noise(vWorld*6.5)*0.42;
    ao = 0.55 + ao*0.35;
  }

  // A key light close to the camera axis flattens everything, like a flash
  // photograph. Put it up and to the left, and let a cool rim come from behind.
  vec3 L1 = normalize(vec3(-0.62, 0.66, 0.42));    // key
  vec3 L2 = normalize(vec3(0.55, -0.30, 0.30));    // bounce, from below right
  vec3 L3 = normalize(vec3(0.35, 0.25, -0.90));    // rim, behind
  float d1 = max(dot(N, L1), 0.0);
  float d2 = max(dot(N, L2), 0.0);
  float d3 = max(dot(N, L3), 0.0);

  // wrap term stands in for light bleeding through wet muscle
  float wrap = max((dot(N, L1) + 0.55) / 1.55, 0.0);
  vec3 sss = toLinear(vec3(0.86, 0.16, 0.11)) * pow(wrap, 2.4) * (uKind == 0 ? 0.34 : 0.12);

  vec3 H = normalize(L1 + V);
  float rough = uKind == 0 ? 22.0 : 46.0;
  float spec = pow(max(dot(N, H), 0.0), rough) * (uKind == 0 ? 0.55 : 0.70);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.2);
  float aoStrong = pow(ao, 1.8);

  // an interior surface gets a soft omnidirectional fill so cavities read
  float fill = back ? 0.42 : 0.035;
  vec3 col = base * (fill + d1*(back ? 0.55 : 1.02)) * aoStrong
           + base * d2 * (back ? 0.34 : 0.22) * ao
           + sss * ao;
  col += vec3(1.0, 0.94, 0.90) * spec * ao;
  col += toLinear(vec3(1.0,0.52,0.44)) * d3 * 0.34 * ao;      // rim
  col += toLinear(vec3(0.95,0.42,0.38)) * fres * 0.22 * ao;

  // squeezing muscle catches a little more light
  col *= 1.0 + uV * 0.12 * (vW.x + vW.y);

  // the depolarisation wave, in conduction mode
  if (uMode == 2 && uAct >= 0.0) {
    float d = abs(vExtra.y - uAct);
    float glow = exp(-d*d/1100.0);
    col = mix(col, toLinear(vec3(0.35,0.92,1.0))*1.4, clamp(glow,0.0,1.0)*0.8);
  }
  if (uKind == 3) col = col*0.55 + toLinear(vec3(0.94,0.90,0.86)) * (0.30 + 0.34*max(dot(N,V),0.0));
  if (uKind == 2) col += toLinear(CONDUCTION_TINT) * 0.5;
  if (uMode == 3 && uKind != 1) col = mix(col, vec3(0.045,0.030,0.034), 0.62);
  if (uMode == 3 && uKind == 1) col *= 2.1;

  col *= mix(1.0, 0.88, uDark);
  col = pow(clamp(col, 0.0, 1.0), vec3(0.4545));       // back to sRGB
  outColor = vec4(col, 1.0);
}`.replace('CONDUCTION_TINT', 'vec3(0.96,0.84,0.43)');

/* ── renderer ─────────────────────────────────────────────────────────────── */
function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(s));
  }
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  return p;
}

function create(canvas, opts) {
  opts = opts || {};
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false });
  if (!gl) return null;

  const RES = opts.resolution || [72, 92, 58];
  const LO = [-6.4, -6.6, -4.6], HI = [5.4, 9.6, 3.8];

  const t0 = performance.now();
  const outer = surfaceNets(sdOuter, LO, HI, RES);
  const outerN = gradientNormals(sdOuter, outer.positions);
  const outerA = attributesFor(outer.positions, outerN, sdOuter);
  const cav = surfaceNets(sdCavities, LO, HI, RES);
  const cavN = gradientNormals(sdCavities, cav.positions);
  const cavA = attributesFor(cav.positions, cavN, sdCavities);
  const buildMs = performance.now() - t0;

  const valves = buildValves();
  const coron = buildCoronaries();
  const cond = buildConduction();

  const prog = program(gl, VERT, FRAG);
  const U = n => gl.getUniformLocation(prog, n);
  const UNIFORMS = ['proj','view','eye','a','v','quiver','time','act','mode','kind','clipX','dark',
                    'lvApex','lvAxis','rvApex','rvAxis','laC','raC'];
  const u = {};
  for (const n of UNIFORMS) u[n] = U('u' + n[0].toUpperCase() + n.slice(1));

  function makeMesh(positions, normals, weights, color, extra, indices) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = (data, loc, size) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data instanceof Float32Array ? data : new Float32Array(data), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    buf(positions, 0, 3); buf(normals, 1, 3); buf(weights, 2, 4); buf(color, 3, 3); buf(extra, 4, 3);
    const ib = gl.createBuffer();
    const arr = (positions.length / 3) > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: indices.length, type: arr instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
  }

  const mOuter = makeMesh(outer.positions, outerN, outerA.weights, outerA.color, outerA.extra, outer.indices);
  const mCav = makeMesh(cav.positions, cavN, cavA.weights, cavA.color, cavA.extra, cav.indices);
  const mCoron = makeMesh(coron.positions, coron.normals, coron.weights, coron.color, coron.extra, coron.indices);
  const mCond = makeMesh(cond.positions, cond.normals, cond.weights, cond.color, cond.extra, cond.indices);

  /* valves ride a second program: identical shading, plus a hinge rotation */
  const VALVE_VERT = VERT
    .replace('layout(location=4) in vec3 aExtra;    // ao, activation ms, groove',
             'layout(location=4) in vec3 aExtra;\nlayout(location=5) in vec3 aHingeP;\n' +
             'layout(location=6) in vec3 aHingeA;\nlayout(location=7) in float aVid;\nuniform vec4 uValve;')
    .replace('  vec3 p = aPos;',
             '  float ang = aVid < 0.5 ? uValve.x : aVid < 1.5 ? uValve.y : aVid < 2.5 ? uValve.z : uValve.w;\n' +
             '  vec3 p = aHingeP + rotAxis(aPos - aHingeP, aHingeA, ang);')
    .replace('  vec3 n = aNrm;',
             '  vec3 n = rotAxis(aNrm, aHingeA, ang);');
  const progValve = program(gl, VALVE_VERT, FRAG);
  const uv = {};
  for (const n of UNIFORMS) uv[n] = gl.getUniformLocation(progValve, 'u' + n[0].toUpperCase() + n.slice(1));
  uv.valve = gl.getUniformLocation(progValve, 'uValve');

  const valveVao = gl.createVertexArray();
  gl.bindVertexArray(valveVao);
  const vcount = valves.positions.length / 3;
  const vColor = new Float32Array(vcount * 3);
  const vExtra = new Float32Array(vcount * 3);
  for (let i = 0; i < vcount; i++) {
    vColor[i * 3] = 0.878; vColor[i * 3 + 1] = 0.824; vColor[i * 3 + 2] = 0.784;  // leaflet tissue
    vExtra[i * 3] = 0.92; vExtra[i * 3 + 1] = 165; vExtra[i * 3 + 2] = 0;
  }
  const vbuf = (data, loc, size) => {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  };
  vbuf(valves.positions, 0, 3); vbuf(valves.normals, 1, 3); vbuf(valves.weights, 2, 4);
  vbuf(vColor, 3, 3); vbuf(vExtra, 4, 3);
  vbuf(valves.hingeP, 5, 3); vbuf(valves.hingeA, 6, 3); vbuf(valves.vid, 7, 1);
  const vib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, vib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(valves.indices), gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  /* ── state ── */
  const S = {
    rhythm: opts.rhythm || 'sinus',
    mode: opts.mode || 'whole',
    yaw: opts.yaw !== undefined ? opts.yaw : 0.42,
    pitch: opts.pitch !== undefined ? opts.pitch : 0.12,
    dist: opts.distance || 27,
    autoRotate: opts.autoRotate !== false,
    dark: opts.dark ? 1 : 0,
    clip: opts.clip !== undefined ? opts.clip : 0.4,
    t: 0, raf: null, last: null, dead: false, cyc: {},
    onCycle: opts.onCycle || null,
  };
  const MODES = { whole: 0, cutaway: 1, conduction: 2, coronary: 3 };

  function fit() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!r.width || !r.height) return false;
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    return true;
  }

  const lvAxis = norm(sub(A.lv.base, A.lv.apex));
  const rvAxis = norm(sub(A.rv.base, A.rv.apex));

  function draw(dt) {
    if (!fit()) return;
    if (S.autoRotate) S.yaw += dt * 0.00016;
    const c = cycle(S.t, S.rhythm, S.cyc);
    if (S.onCycle) S.onCycle(c);

    const eye = [Math.sin(S.yaw) * Math.cos(S.pitch) * S.dist,
                 Math.sin(S.pitch) * S.dist + 1.2,
                 Math.cos(S.yaw) * Math.cos(S.pitch) * S.dist];
    const proj = mat4Perspective(0.62, canvas.width / canvas.height, 0.5, 120);
    const view = mat4LookAt(eye, [0.3, 0.6, 0], [0, 1, 0]);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);      // chambers are seen from inside in cutaway

    const mode = MODES[S.mode] || 0;
    const common = (loc) => {
      gl.uniformMatrix4fv(loc.proj, false, proj);
      gl.uniformMatrix4fv(loc.view, false, view);
      gl.uniform3fv(loc.eye, new Float32Array(eye));
      gl.uniform1f(loc.a, c.a); gl.uniform1f(loc.v, c.v);
      gl.uniform1f(loc.quiver, c.quiver); gl.uniform1f(loc.time, S.t);
      gl.uniform1f(loc.act, c.act); gl.uniform1i(loc.mode, mode);
      gl.uniform1f(loc.clipX, S.clip); gl.uniform1f(loc.dark, S.dark);
      gl.uniform3fv(loc.lvApex, new Float32Array(A.lv.apex));
      gl.uniform3fv(loc.lvAxis, new Float32Array(lvAxis));
      gl.uniform3fv(loc.rvApex, new Float32Array(A.rv.apex));
      gl.uniform3fv(loc.rvAxis, new Float32Array(rvAxis));
      gl.uniform3fv(loc.laC, new Float32Array(A.la.c));
      gl.uniform3fv(loc.raC, new Float32Array(A.ra.c));
    };
    gl.useProgram(prog);
    common(u);

    const drawMesh = (m, kind) => {
      gl.uniform1i(u.kind, kind);
      gl.bindVertexArray(m.vao);
      gl.drawElements(gl.TRIANGLES, m.count, m.type, 0);
    };
    drawMesh(mOuter, 0);
    if (mode === 1) drawMesh(mCav, 0);
    drawMesh(mCoron, 1);
    if (mode === 2) drawMesh(mCond, 2);

    // valves — visible in cutaway and conduction, buried in muscle otherwise
    if (mode === 1 || mode === 2) {
      gl.useProgram(progValve);
      common(uv);
      gl.uniform1i(uv.kind, 3);
      gl.uniform1f(uv.act, -1);
      gl.uniform1f(uv.quiver, 0);
      gl.uniform4f(uv.valve,
        VALVES[0].open * c.valves[0], VALVES[1].open * c.valves[1],
        VALVES[2].open * c.valves[2], VALVES[3].open * c.valves[3]);
      gl.bindVertexArray(valveVao);
      gl.drawElements(gl.TRIANGLES, valves.indices.length, gl.UNSIGNED_SHORT, 0);
    }
    gl.bindVertexArray(null);
  }

  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function loop(now) {
    if (S.dead) return;
    if (S.last === null) S.last = now;
    let dt = now - S.last; S.last = now;
    if (dt > 80) dt = 80;
    S.t += dt;
    draw(dt);
    S.raf = requestAnimationFrame(loop);
  }

  /* ── interaction: drag to turn it over, wheel or pinch to come closer ── */
  let drag = null, pinch = null;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY };
    S.autoRotate = false;
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    S.yaw -= (e.clientX - drag.x) * 0.008;
    S.pitch = Math.max(-1.2, Math.min(1.2, S.pitch + (e.clientY - drag.y) * 0.006));
    drag.x = e.clientX; drag.y = e.clientY;
    if (reduced) draw(0);
  });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    S.dist = Math.max(13, Math.min(48, S.dist + e.deltaY * 0.03));
    if (reduced) draw(0);
  }, { passive: false });

  const api = {
    setRhythm(k) { S.rhythm = k; S.cyc = {}; if (reduced) draw(0); return api; },
    setMode(m) { S.mode = m; if (reduced) draw(0); return api; },
    setDark(on) { S.dark = on ? 1 : 0; if (reduced) draw(0); return api; },
    setClip(z) { S.clip = z; if (reduced) draw(0); return api; },
    setAutoRotate(on) { S.autoRotate = !!on; return api; },
    resetView() { S.yaw = 0.42; S.pitch = 0.12; S.dist = 27; return api; },
    phase() { return cycle(S.t, S.rhythm, S.cyc); },
    stats: {
      buildMs: Math.round(buildMs),
      triangles: Math.round((outer.indices.length + cav.indices.length +
                  coron.indices.length + cond.indices.length + valves.indices.length) / 3),
      vertices: (outer.positions.length + cav.positions.length) / 3,
    },
    start() { if (!S.raf && !S.dead) { if (reduced) { fit(); draw(0); } else S.raf = requestAnimationFrame(loop); } return api; },
    stop() { if (S.raf) cancelAnimationFrame(S.raf); S.raf = null; S.last = null; return api; },
    destroy() { api.stop(); S.dead = true; },
  };
  api.start();
  return api;
}

root.Heart3D = { create, cycle, RHYTHM_HR, VALVES, anatomy: A };

})(typeof window !== 'undefined' ? window : this);
