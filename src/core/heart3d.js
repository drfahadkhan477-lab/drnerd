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
   centimetres, and the model is built to the textbook figures — 12 cm base to
   apex, 8–9 cm across, 6 cm front to back. Those three numbers matter more
   than any single curve: get the proportions wrong and no amount of shading
   rescues it, because the silhouette is what the eye reads first.

   The shape of a ventricle is the thing most easily got wrong. It is not a
   cone. A cone gives you straight sides and a point on the end; a real
   ventricle is convex, widest across its upper third, and finishes in a blunt
   rounded apex you could rest a fingertip on. So each ventricle here is an
   oriented ellipsoid — the wide convex body — intersected with a round cone
   that pulls the lower half in and caps it bluntly, then cut off flat at the
   atrioventricular plane. The ellipsoid alone is too fat at the tip. The cone
   alone is an ice-cream cone. The intersection is a ventricle.

   The right ventricle is not a smaller copy of the left. It sits anterior and
   to the right, wraps around the left in cross-section, stops well short of
   the tip — the apex belongs to the LV alone — and its bulge is what gives
   the heart its asymmetric anterior face. Where the two meet, the union uses a
   deliberately small blend radius so the interventricular grooves stay visible
   as creases; that is where the LAD and the PDA run.

   The atria are posterior and superior, smaller than instinct suggests, and
   they sit ON the atrioventricular plane rather than balancing on top of the
   ventricles. The auricles are forward-projecting flaps that lap the roots of
   the great vessels. Both details matter: atria modelled as spheres perched on
   a cone is precisely how a heart ends up looking like an ice cream.

   Wall thicknesses are a little generous versus life. This is a teaching model
   that has to read at thumbnail size, not a segmentation.                    */

/* An orthonormal frame around an axis, chosen so that u comes out transverse
   and v front-to-back — the two directions the radii below are quoted in. */
function axisFrame(axis) {
  const a = norm(axis);
  const ref = Math.abs(a[2]) > 0.9 ? v3(0, 1, 0) : v3(0, 0, 1);
  const u = norm(cross(ref, a));
  return { a, u, v: cross(a, u) };
}
function sdEllipsoidFrame(px, py, pz, c, F, ra, ru, rv) {
  const dx = px - c[0], dy = py - c[1], dz = pz - c[2];
  const a = (dx * F.a[0] + dy * F.a[1] + dz * F.a[2]) / ra;
  const u = (dx * F.u[0] + dy * F.u[1] + dz * F.u[2]) / ru;
  const v = (dx * F.v[0] + dy * F.v[1] + dz * F.v[2]) / rv;
  const k = Math.hypot(a, u, v);
  return (k - 1) * Math.min(ra, ru, rv);
}
/* positive above the plane, negative on the ventricular side of it */
function sdAbove(px, py, pz, p0, n) {
  return (px - p0[0]) * n[0] + (py - p0[1]) * n[1] + (pz - p0[2]) * n[2];
}

function ventricle(base, apex, bulgeT) {
  const axis = norm(sub(apex, base)), L = len(sub(apex, base));
  return { base, apex, axis, L, F: axisFrame(axis), bulge: mid(base, apex, bulgeT) };
}
const LV = ventricle(v3(0.10, 2.60, -0.55), v3(2.85, -5.10, 1.25), 0.40);
const RV = ventricle(v3(-2.20, 2.35, 0.75), v3(1.35, -3.60, 1.95), 0.40);

/* the atrioventricular plane: the annulus the whole base is slung from, and
   the surface the ventricles are cut off at so the atria have a floor */
const AV_P = v3(-0.35, 2.95, 0.15);
const AV_N = norm(v3(-0.28, 0.93, -0.24));

const A = {
  lv: { base: LV.base, apex: LV.apex },
  rv: { base: RV.base, apex: RV.apex },
  la: { c: v3(0.30, 4.25, -2.50), r: v3(2.05, 1.62, 1.88), w: 0.26 },
  ra: { c: v3(-2.60, 3.65, -0.55), r: v3(1.90, 1.92, 1.78), w: 0.26 },
};
/* the auricles — ear-shaped, lying forward over the great-vessel roots */
const LAA = [v3(1.85, 3.75, -0.85), v3(2.90, 3.05, 0.45), 0.44];
const RAA = [v3(-3.15, 4.05, 0.35), v3(-1.75, 3.95, 1.30), 0.50];

/* great vessels as chains of capsules. The pulmonary trunk leaves the RV
   anterior and to the left of the aorta and crosses in front of it — which is
   why, from the front, you see pulmonary artery over aortic root. */
const AORTA = [[v3(0.15, 3.05, -0.60), v3(0.05, 5.15, -0.80), 1.10],
               [v3(0.05, 5.15, -0.80), v3(-0.95, 6.55, -1.45), 0.98],
               [v3(-0.95, 6.55, -1.45), v3(-1.20, 5.05, -2.55), 0.88],
               [v3(-1.20, 5.05, -2.55), v3(-1.00, 2.40, -2.95), 0.80]];
const PA    = [[v3(-0.85, 3.45, 1.40), v3(-0.40, 5.55, 0.45), 0.98],
               [v3(-0.40, 5.55, 0.45), v3(1.25, 5.85, -1.05), 0.66],
               [v3(-0.40, 5.55, 0.45), v3(-2.05, 5.70, -1.20), 0.66]];
const CAVA  = [[v3(-2.85, 7.20, -1.05), v3(-2.78, 4.70, -0.75), 0.78],   // SVC
               [v3(-2.45, 0.90, -1.55), v3(-2.75, 3.10, -0.95), 0.82]];  // IVC
const PVEIN = [[v3(1.85, 5.15, -3.70), v3(1.20, 4.70, -2.90), 0.37],
               [v3(-1.15, 5.15, -3.70), v3(-0.50, 4.65, -2.95), 0.37],
               [v3(1.90, 3.60, -3.65), v3(1.25, 3.85, -2.95), 0.34],
               [v3(-1.25, 3.60, -3.60), v3(-0.55, 3.85, -2.95), 0.34]];

function chainDist(px, py, pz, chain, grow) {
  let d = 1e9;
  for (const [a, b, r] of chain) d = Math.min(d, sdCapsule(px, py, pz, a, b, r + (grow || 0)));
  return d;
}

/* ellipsoid body ∩ tapering cone — see the note at the top of this section */
function chamberSD(x, y, z, C, rAx, rU, rV, r1, r2, k) {
  return smax(sdEllipsoidFrame(x, y, z, C.bulge, C.F, rAx, rU, rV),
              sdRoundCone(x, y, z, C.base, C.apex, r1, r2), k);
}

/* epicardial (outer) surface of each ventricle */
function sdEpiLV(x, y, z) { return chamberSD(x, y, z, LV, LV.L * 0.72, 2.95, 2.60, 4.60, 1.10, 0.75); }
function sdEpiRV(x, y, z) { return chamberSD(x, y, z, RV, RV.L * 0.70, 2.85, 2.45, 4.20, 0.90, 0.70); }
function sdVentricles(x, y, z) {
  const both = smin(sdEpiLV(x, y, z), sdEpiRV(x, y, z), 0.55);   // small k: the IV grooves
  return smax(both, sdAbove(x, y, z, AV_P, AV_N), 0.60);
}

/* cavity of each chamber — used for weights, for the cutaway interior, and to
   hollow the muscle out. Cut a little ABOVE the annulus so the inflow stays
   open into the atrium rather than being pinched off at the valve. */
function sdCavLV(x, y, z) {
  return smax(chamberSD(x, y, z, LV, LV.L * 0.66, 1.90, 1.70, 3.10, 0.34, 0.50),
              sdAbove(x, y, z, AV_P, AV_N) - 0.45, 0.45);
}
function sdCavRV(x, y, z) {
  const raw = smax(chamberSD(x, y, z, RV, RV.L * 0.64, 2.30, 2.00, 3.00, 0.34, 0.50),
                   sdAbove(x, y, z, AV_P, AV_N) - 0.45, 0.45);
  /* the septum belongs to the left ventricle, so the right cavity is whatever
     is left once the LV wall is taken out of it — which is also exactly what
     makes it the crescent it is in cross-section */
  return smax(raw, -sdEpiLV(x, y, z), 0.35);
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
/* outer surface: muscle plus atria, auricles and vessels, fused */
function sdOuter(x, y, z) {
  let d = sdVentricles(x, y, z);
  /* a small blend radius here too, so the atrioventricular groove — the crown
     the coronaries run in — stays a visible waist instead of melting shut */
  d = smin(d, sdEllipsoid(x, y, z, A.la.c[0], A.la.c[1], A.la.c[2],
        A.la.r[0] + A.la.w, A.la.r[1] + A.la.w, A.la.r[2] + A.la.w), 0.42);
  d = smin(d, sdEllipsoid(x, y, z, A.ra.c[0], A.ra.c[1], A.ra.c[2],
        A.ra.r[0] + A.ra.w, A.ra.r[1] + A.ra.w, A.ra.r[2] + A.ra.w), 0.42);
  d = smin(d, sdCapsule(x, y, z, LAA[0], LAA[1], LAA[2]), 0.34);
  d = smin(d, sdCapsule(x, y, z, RAA[0], RAA[1], RAA[2]), 0.34);
  d = smin(d, chainDist(x, y, z, AORTA, 0.20), 0.50);
  d = smin(d, chainDist(x, y, z, PA, 0.18), 0.50);
  d = smin(d, chainDist(x, y, z, CAVA, 0.16), 0.42);
  d = smin(d, chainDist(x, y, z, PVEIN, 0.14), 0.38);
  return d;
}

/* which structure a point belongs to — drives colour, not geometry */
const REGION = { MYO: 0, ATRIUM: 1, AORTA: 2, PA: 3, VEIN: 4, APPENDAGE: 5 };
function regionDistances(x, y, z) {
  return [
    Math.min(sdEpiLV(x, y, z), sdEpiRV(x, y, z)),
    Math.min(sdEllipsoid(x, y, z, A.la.c[0], A.la.c[1], A.la.c[2], A.la.r[0] + A.la.w, A.la.r[1] + A.la.w, A.la.r[2] + A.la.w),
             sdEllipsoid(x, y, z, A.ra.c[0], A.ra.c[1], A.ra.c[2], A.ra.r[0] + A.ra.w, A.ra.r[1] + A.ra.w, A.ra.r[2] + A.ra.w)),
    chainDist(x, y, z, AORTA, 0.20),
    chainDist(x, y, z, PA, 0.14),
    Math.min(chainDist(x, y, z, CAVA, 0.16), chainDist(x, y, z, PVEIN, 0.14)),
    Math.min(sdCapsule(x, y, z, LAA[0], LAA[1], LAA[2]),
             sdCapsule(x, y, z, RAA[0], RAA[1], RAA[2])),
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
  if (Math.min(dLA, dRA) < 2.4) return 6 + Math.min(dLA, dRA) * 14;      // atria: 6-40ms
  const axis = norm(sub(LV.base, LV.apex));
  const rel = sub([x, y, z], LV.apex);
  const along = rel[0] * axis[0] + rel[1] * axis[1] + rel[2] * axis[2];
  const frac = Math.max(0, Math.min(1, along / LV.L));
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
  [REGION.PA]:        [0.659, 0.627, 0.663],
  [REGION.VEIN]:      [0.494, 0.478, 0.545],
  [REGION.APPENDAGE]: [0.604, 0.290, 0.251],
};
const FAT = [0.918, 0.812, 0.487];   // epicardial fat — genuinely this yellow in the grooves

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
    const f = groove * 0.60;
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
  { id: 0, name: 'mitral',    c: v3(0.55, 2.45, -1.15), n: norm(sub(A.lv.apex, A.lv.base)), r: 1.50, leaflets: 2, open: 1.15 },
  { id: 1, name: 'tricuspid', c: v3(-1.70, 2.25, 0.30), n: norm(sub(A.rv.apex, A.rv.base)), r: 1.60, leaflets: 3, open: 1.15 },
  { id: 2, name: 'aortic',    c: v3(0.15, 3.10, -0.60), n: v3(-0.05, 1, -0.1),              r: 1.02, leaflets: 3, open: -1.05 },
  { id: 3, name: 'pulmonic',  c: v3(-0.85, 3.50, 1.40), n: v3(0.2, 1, -0.4),                r: 0.92, leaflets: 3, open: -1.05 },
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

/* ── blood flow: particles tracing the two circuits ──────────────────────────
   Only meaningful where the chambers are actually exposed — cutaway and
   conduction mode both clip the near wall away, whole/coronary do not, so
   particles only draw in the first two. Each circuit is a short polyline
   through the real anatomy landmarks already defined above; a particle's
   position is u∈[0,1] along it, advanced each frame and gated to a crawl
   whenever the valve guarding its current segment is shut — the same
   valve-timing the leaflets themselves animate on, so a particle visibly
   queues at a closed mitral valve exactly when the leaflet is drawn closed.
   Each path bows out through its ventricle's own free wall rather than
   cutting straight to the apex — the free walls sit well apart from each
   other (the septum is what's between them), so bowing outward is what
   keeps the two circuits visually separate instead of both collapsing onto
   one thin line down the middle where the chambers happen to be closest. */
const BLOOD_RIGHT = [
  v3(-2.85, 6.20, -0.90),                             // venous return (SVC/IVC confluence)
  A.ra.c,                                             // right atrium
  VALVES[1].c,                                        // tricuspid
  v3(-1.60, 0.35, 1.70),                              // RV free wall, well clear of the septum
  v3(1.10, -3.05, 1.85),                              // near the RV apex
  VALVES[3].c,                                        // pulmonic
  v3(-0.35, 5.85, 0.55),                              // main pulmonary artery
];
const BLOOD_LEFT = [
  v3(1.45, 5.15, -3.35),                              // pulmonary venous return
  A.la.c,                                             // left atrium
  VALVES[0].c,                                        // mitral
  v3(2.30, -0.30, -0.85),                             // LV free wall, well clear of the septum
  v3(2.75, -4.55, 1.15),                              // near the LV apex
  VALVES[2].c,                                        // aortic
  v3(0.00, 5.40, -0.75),                              // aorta
];
/* which segment index (0-based, out of waypoints.length-1) a u falls in, and
   the local t within that segment — plain piecewise-linear, not arc-length
   corrected; the segments are short enough that the unevenness doesn't read. */
function polylinePoint(waypoints, u) {
  const n = waypoints.length - 1;
  const f = Math.max(0, Math.min(0.999999, u)) * n;
  const seg = Math.floor(f), t = f - seg;
  const a = waypoints[Math.min(seg, n - 1)], b = waypoints[Math.min(seg + 1, n)];
  return { pos: mid(a, b, t), seg: Math.min(seg, n - 1) };
}
/* Both paths are 7 points / 6 segments: the AV valve sits at waypoint index
   2 (u=2/6), the semilunar at index 5 (u=5/6). Below the AV valve's u,
   advancing is gated by it; between the two valves the particle is just
   swirling through the ventricle body, nothing to gate; approaching the
   semilunar, that valve gates it. Loop-back past u=1 is always free — venous
   return, nothing to gate it in this schematic. */
function bloodGate(u, valves, isLeft) {
  if (u < 2 / 6) return isLeft ? valves[0] : valves[1];     // mitral : tricuspid
  if (u < 5 / 6) return 1;                                   // free-swimming in the ventricle
  return isLeft ? valves[2] : valves[3];                     // aortic : pulmonic
}
const BLOOD_N_PER_CIRCUIT = 70;
function makeBloodParticles() {
  const out = [];
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < BLOOD_N_PER_CIRCUIT; i++) {
      out.push({ side, u: i / BLOOD_N_PER_CIRCUIT, speed: 0.16 + (i % 7) * 0.01 });
    }
  }
  return out;
}
function stepBloodParticles(particles, dtMs, cyc) {
  const dt = dtMs / 1000;
  for (const p of particles) {
    const gateOpen = bloodGate(p.u, cyc.valves, p.side === 1);
    const crawl = 0.06;                                     // still edges forward when "shut" — never fully static
    p.u += dt * p.speed * (crawl + (1 - crawl) * gateOpen);
    if (p.u >= 1) p.u -= 1;
  }
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
const VENOUS_RGB   = [0.180, 0.243, 0.408];   // cardiac veins and the coronary sinus
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
  /* LAD — down the anterior interventricular groove, the crease the LV/RV
     union leaves on the front, finishing just short of and around the apex */
  tubeAlong(bezier(v3(-0.30, 2.85, 1.55), v3(0.35, 0.80, 2.55), v3(1.35, -1.60, 2.55), v3(2.70, -4.60, 1.55), 24), 0.135, out, CORONARY_RGB, true);
  /* first diagonal, off the LAD onto the LV free wall — the branch that makes
     the anterior surface read as supplied rather than merely striped */
  tubeAlong(bezier(v3(0.35, 0.80, 2.45), v3(1.35, 0.30, 2.20), v3(2.20, -0.70, 1.40), v3(2.85, -1.90, 0.30), 14), 0.085, out, CORONARY_RGB, true);
  /* LCx — around the left atrioventricular groove, onto the obtuse margin */
  tubeAlong(bezier(v3(0.05, 2.95, 1.15), v3(1.85, 2.35, 0.55), v3(3.05, 1.20, -1.10), v3(2.55, -0.40, -2.35), 20), 0.115, out, CORONARY_RGB, true);
  /* RCA — right AV groove, down the acute margin and round to the inferior wall */
  tubeAlong(bezier(v3(-1.15, 3.10, 1.25), v3(-2.85, 2.30, 1.35), v3(-3.35, 0.30, 0.10), v3(-1.70, -2.10, -1.55), 22), 0.125, out, CORONARY_RGB, true);
  /* Great cardiac vein, alongside the LAD, and the coronary sinus it becomes
     in the posterior AV groove — the veins are half the picture in the grooves
     and the sinus is the landmark every posterior view is oriented by. */
  tubeAlong(bezier(v3(0.10, 2.70, 1.70), v3(0.70, 0.90, 2.45), v3(1.55, -1.30, 2.45), v3(2.55, -3.90, 1.65), 20), 0.100, out, VENOUS_RGB, true);
  tubeAlong(bezier(v3(2.35, 1.35, -2.05), v3(1.20, 2.15, -2.70), v3(-0.70, 2.35, -2.35), v3(-2.05, 2.30, -1.15), 18), 0.150, out, VENOUS_RGB, true);
  return out;
}
function buildConduction() {
  const out = emptyTube();
  const SA = v3(-3.05, 4.75, 0.30), AV = v3(-0.95, 2.35, -0.55), HIS = v3(-0.30, 1.65, 0.05);
  tubeAlong(bezier(SA, v3(-2.50, 4.00, 0.10), v3(-1.55, 3.00, -0.35), AV, 10), 0.10, out, CONDUCTION_RGB);
  tubeAlong([AV, HIS, v3(0.05, 0.95, 0.35)], 0.10, out, CONDUCTION_RGB);
  /* left and right bundle branches fanning into Purkinje */
  tubeAlong(bezier(v3(0.05, 0.95, 0.35), v3(0.90, -0.10, 0.15), v3(1.80, -2.00, 0.55), v3(2.65, -4.35, 1.05), 12), 0.075, out, CONDUCTION_RGB);
  tubeAlong(bezier(v3(0.05, 0.95, 0.35), v3(-0.25, -0.25, 1.15), v3(0.55, -2.10, 1.75), v3(1.35, -3.15, 1.80), 12), 0.075, out, CONDUCTION_RGB);
  tubeAlong(bezier(v3(0.05, 0.95, 0.35), v3(1.20, 0.15, -0.65), v3(2.25, -1.55, -0.85), v3(2.70, -3.55, -0.25), 12), 0.065, out, CONDUCTION_RGB);
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
  /* cyc is this instant as a fraction of one cardiac cycle, in the SAME
     convention physio.js uses — zero at atrial systole, 0.10 at mitral closure.
     It exists so the Wiggers diagram and the pressure-volume loop can be driven
     by this heart's own clock instead of running a second one beside it and
     slowly drifting out of agreement with the muscle the reader is watching. */
  const out = { a: 0, v: 0, valves: [0, 0, 0, 0], act: -1, beat: 0, quiver: 0, cyc: 0 };
  if (kind === 'asystole') { out.valves = [0.35, 0.35, 0, 0]; out.cyc = -1; return out; }
  if (kind === 'vfib') {
    out.quiver = 1;
    out.v = 0.14 + 0.10 * Math.sin(tms / 41) + 0.06 * Math.sin(tms / 17);
    out.a = 0.08 + 0.05 * Math.sin(tms / 23);
    out.valves = [0.25, 0.25, 0.06, 0.06];
    out.cyc = -1;                      // no organised cycle to point at
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

  /* Aligned on the start of ventricular contraction rather than on the P wave:
     that instant is mitral closure in both models, so the two cannot disagree
     about where systole begins even though one counts from the sinus node and
     the other from atrial systole. */
  out.cyc = (((vPhase - PR) / vRR + 0.10) % 1 + 1) % 1;

  /* depolarisation wave position, in ms since the sinus node fired */
  const actWindow = 320;
  out.act = (vPhase >= 0 && vPhase < actWindow) ? vPhase : -1;
  if (kind === 'afib') out.act = (vPhase < 120 && vPhase >= 0) ? 150 + vPhase : -1;
  return out;
}

/* ── shaders ──────────────────────────────────────────────────────────────── */
/* The beat deformation, shared verbatim by the procedural mesh and the scanned
   one. Duplicating it would mean a future fix landing in one and not the other,
   and the two would quietly stop beating alike. */
const BEAT_GLSL = `  vec3 p = aPos;
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

`;

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
${BEAT_GLSL}  vN = n; vWorld = p; vColor = aColor; vExtra = aExtra; vW = aW;
  gl_Position = uProj * uView * vec4(p, 1.0);
}`;

/* ── the scanned mesh ────────────────────────────────────────────────────────
   Same beat, different skin. The vertex stage is BEAT_GLSL verbatim, so a scan
   contracts on exactly the cardiac clock the procedural heart does — atria
   kicking first, base descending toward a stationary apex, LV twisting —
   because its per-vertex chamber weights were baked from the same signed
   distance fields (see scripts/prep-glb.js). */
const SCAN_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec4 aW;
layout(location=3) in vec2 aUv;
layout(location=4) in float aAct;

uniform mat4 uProj, uView;
uniform float uA, uV, uQuiver, uTime;
uniform vec3 uLvApex, uLvAxis, uRvApex, uRvAxis, uLaC, uRaC;

out vec3 vN, vWorld;
out vec2 vUv;
out vec4 vW;
out float vAct;

vec3 rotAxis(vec3 p, vec3 axis, float ang){
  float c = cos(ang), s = sin(ang);
  return p*c + cross(axis,p)*s + axis*dot(axis,p)*(1.0-c);
}

void main(){
${BEAT_GLSL}  vN = n; vWorld = p; vUv = aUv; vW = aW; vAct = aAct;
  gl_Position = uProj * uView * vec4(p, 1.0);
}`;

const SCAN_FRAG = `#version 300 es
precision highp float;
in vec3 vN, vWorld;
in vec2 vUv;
in vec4 vW;
in float vAct;
out vec4 outColor;

uniform sampler2D uBase, uNrm, uMr;
uniform vec3 uEye;
uniform float uDark, uV, uAct, uClipX;
uniform int uMode;

/* No tangents were baked, so the frame is rebuilt per pixel from screen-space
   derivatives — the standard cotangent trick. Costs a few instructions and
   saves 16 bytes a vertex plus a whole attribute. */
mat3 cotangentFrame(vec3 N, vec3 p, vec2 uv){
  vec3 dp1 = dFdx(p), dp2 = dFdy(p);
  vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float invmax = inversesqrt(max(dot(T,T), dot(B,B)));
  return mat3(T * invmax, B * invmax, N);
}
vec3 toLinear(vec3 c){ return pow(c, vec3(2.2)); }

void main(){
  if ((uMode == 1 || uMode == 2) && vWorld.z > uClipX) discard;

  vec3 N = normalize(vN);
  vec3 V = normalize(uEye - vWorld);
  if (dot(N, V) < 0.0) N = -N;

  vec3 nTex = texture(uNrm, vUv).rgb * 2.0 - 1.0;
  N = normalize(cotangentFrame(N, -V, vUv) * nTex);

  vec3 base = toLinear(texture(uBase, vUv).rgb);
  vec2 mr = texture(uMr, vUv).gb;          // glTF packs roughness in G, metal in B
  float rough = clamp(mr.x, 0.12, 1.0);

  vec3 L1 = normalize(vec3(-0.62, 0.66, 0.42));
  vec3 L2 = normalize(vec3(0.55, -0.30, 0.30));
  vec3 L3 = normalize(vec3(0.35, 0.25, -0.90));
  float d1 = max(dot(N, L1), 0.0), d2 = max(dot(N, L2), 0.0), d3 = max(dot(N, L3), 0.0);

  float wrap = max((dot(N, L1) + 0.55) / 1.55, 0.0);
  vec3 sss = toLinear(vec3(0.86, 0.16, 0.11)) * pow(wrap, 2.4) * 0.30;

  vec3 H = normalize(L1 + V);
  float shin = mix(90.0, 10.0, rough);
  float spec = pow(max(dot(N, H), 0.0), shin) * (0.55 + (1.0 - rough) * 0.5)
             + pow(max(dot(N, H), 0.0), 4.5) * 0.14;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);

  vec3 col = base * (0.10 + d1 * 1.02) + base * d2 * 0.24 + sss;
  col += vec3(1.0, 0.95, 0.92) * spec;
  col += toLinear(vec3(1.0, 0.55, 0.48)) * d3 * 0.26;
  col += toLinear(vec3(0.95, 0.48, 0.44)) * fres * 0.16;
  col *= 1.0 + uV * 0.10 * (vW.x + vW.y);

  if (uMode == 2 && uAct >= 0.0) {
    float d = abs(vAct - uAct);
    col = mix(col, toLinear(vec3(0.35,0.92,1.0)) * 1.4, clamp(exp(-d*d/1100.0), 0.0, 1.0) * 0.75);
  }
  col *= mix(1.0, 0.88, uDark);
  outColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(0.4545)), 1.0);
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
uniform float uStyle;        // 0 anatomic, 1 engraved ink, 2 crystal

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

// ── engraving ────────────────────────────────────────────────────────────────
// One layer of parallel hatching, in SCREEN space, so the strokes stay a
// constant weight however close you zoom — which is what makes a drawing read
// as drawn rather than as a texture wrapped round a model. Each layer only
// applies where the surface is darker than its threshold, and fades in over a
// short band so the tones step the way an engraver adds a second and third
// pass rather than banding hard.
float hatchLayer(vec2 sc, float ang, float freq, float thresh, float tone){
  float w = clamp((thresh - tone) * 3.4, 0.0, 1.0);
  if (w <= 0.001) return 1.0;
  float v = sc.x * cos(ang) + sc.y * sin(ang);
  float t = abs(fract(v * freq) - 0.5) * 2.0;      // triangle wave across the stroke
  return mix(1.0, smoothstep(0.0, 0.40, t), w);    // 0 on the stroke, 1 on the paper
}

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
    // Slow, large-scale variation in how perfused the muscle looks. Uniform
    // red over a whole organ is the single biggest tell that a surface is
    // shaded plastic — real myocardium is never one colour twice over.
    float perfuse = noise(vWorld*0.80);
    base *= mix(vec3(0.93, 0.89, 0.91), vec3(1.10, 1.03, 0.98), perfuse);
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
  float ndh = max(dot(N, H), 0.0);
  float rough = uKind == 0 ? 22.0 : 46.0;
  // Two lobes. The epicardium is a wet membrane stretched over muscle: one
  // narrow highlight on its own reads as polished plastic, and it is the
  // broad second lobe that makes a surface look damp rather than shined.
  float spec = pow(ndh, rough) * (uKind == 0 ? 0.55 : 0.70)
             + pow(ndh, 4.5)   * (uKind == 0 ? 0.17 : 0.10);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.2);
  // A floor under the occlusion term. Without one, a deep pocket — the inflow
  // behind a valve especially — integrates to zero and reads as a hole punched
  // through the muscle rather than tissue in shadow. In a cutaway that is worse
  // than merely dark, because a hole is the one thing a cutaway is meant to
  // show deliberately.
  float aoStrong = max(pow(ao, 1.8), 0.12);

  // an interior surface gets a soft omnidirectional fill so cavities read
  float fill = back ? 0.50 : 0.045;
  vec3 col = base * (fill + d1*(back ? 0.55 : 1.02)) * aoStrong
           + base * d2 * (back ? 0.34 : 0.22) * ao
           + sss * ao;
  col += vec3(1.0, 0.94, 0.90) * spec * ao;
  col += toLinear(vec3(1.0,0.52,0.44)) * d3 * 0.26 * ao;      // rim
  col += toLinear(vec3(0.95,0.42,0.38)) * fres * 0.14 * ao;

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

  // ── engraved style ──
  // Tone stops being colour and becomes stroke density: the same lighting that
  // drove the shading above now decides how many passes of hatching a patch
  // gets. The silhouette is inked separately, because an outline is what makes
  // a technical drawing legible where a purely tonal render goes mushy.
  if (uStyle > 0.5 && uStyle < 1.5) {
    vec3 ink   = toLinear(mix(vec3(0.129,0.176,0.294), vec3(0.792,0.847,0.949), uDark));
    vec3 paper = toLinear(mix(vec3(0.976,0.965,0.941), vec3(0.055,0.090,0.145), uDark));

    if (uKind == 2) {
      // the conduction system is the subject of this drawing, not scenery
      col = toLinear(vec3(0.847, 0.706, 0.286)) * 1.35;
    } else {
      // Deliberately bright: an engraving is mostly untouched paper, and the
      // drawing is what the engraver chose to darken. Tone that sits too low
      // fires every layer everywhere and you get a halftone screen instead.
      float lum = clamp(d1 * 1.20 + d2 * 0.42 + 0.30, 0.0, 1.0) * mix(0.78, 1.0, aoStrong);
      // Cut surfaces are the subject in cutaway and conduction, so they get a
      // lighter hand than the outside — occlusion that reads as depth in the
      // colour render just fills the chamber with ink here.
      if (back) lum = mix(lum, 1.0, 0.22);
      if (uKind == 3) lum = mix(max(lum, 0.55), 1.0, 0.35);   // leaflets stay pale and outlined
      if (uKind == 1) lum *= 0.40;                    // coronaries read as drawn vessels

      vec2 sc = gl_FragCoord.xy;
      float h = 1.0;
      h *= hatchLayer(sc,  0.62, 0.085, 0.86, lum);
      h *= hatchLayer(sc, -0.72, 0.085, 0.56, lum);
      h *= hatchLayer(sc,  1.90, 0.095, 0.33, lum);
      h *= hatchLayer(sc,  0.10, 0.115, 0.16, lum);

      // A contour, not a shaded rim: tight band right at the silhouette, which
      // is what stops the form going mushy where two surfaces overlap.
      float edge = pow(1.0 - max(dot(N, V), 0.0), 2.6);
      h *= 1.0 - smoothstep(0.30, 0.66, edge);

      col = mix(paper, ink, clamp(1.0 - h, 0.0, 1.0));
      if (uMode == 2 && uAct >= 0.0) {
        float dd = abs(vExtra.y - uAct);
        col = mix(col, toLinear(vec3(0.847,0.706,0.286))*1.3, clamp(exp(-dd*dd/1100.0),0.0,1.0)*0.55);
      }
    }
  }

  // ── crystal ──
  // Glass is mostly its edges. A transparent shell lit conventionally reads as
  // a faint smudge; what makes it look like cast glass is that alpha AND
  // brightness both track the Fresnel term, so the silhouette and the steeply
  // turned surfaces go bright and nearly opaque while the parts facing you all
  // but vanish. The vessels stay solid — that is what gives the eye something
  // to look THROUGH the glass at.
  float alpha = 1.0;
  if (uStyle > 1.5) {
    float fr = pow(1.0 - max(dot(N, V), 0.0), 2.1);
    if (uKind == 1) {
      col = toLinear(vec3(0.72, 0.13, 0.13)) * (0.55 + d1 * 0.95)
          + vec3(1.0, 0.9, 0.9) * pow(max(dot(N, H), 0.0), 40.0) * 0.5;
    } else if (uKind == 2) {
      col = toLinear(vec3(0.90, 0.74, 0.30)) * 1.5;
    } else {
      vec3 glass = toLinear(mix(vec3(0.95, 0.88, 0.88), vec3(0.62, 0.70, 0.82), uDark));
      float tight = pow(max(dot(N, H), 0.0), 110.0) * 1.7;
      float broad = pow(max(dot(N, H), 0.0), 12.0) * 0.28;
      col = glass * (0.20 + d1 * 0.42 + d2 * 0.14)
          + vec3(1.0) * (tight + broad)
          + toLinear(vec3(1.0, 0.74, 0.74)) * fr * 0.80;
      if (uKind == 3) col += toLinear(vec3(0.96, 0.93, 0.90)) * 0.22;
      /* A floor of 0.06 keeps the far wall faintly present rather than absent,
         which is what stops the whole thing reading as an empty outline. */
      alpha = clamp(0.06 + fr * 0.86 + tight * 0.7, 0.0, 1.0);
    }
  }

  col *= mix(1.0, 0.88, uDark);
  col = pow(clamp(col, 0.0, 1.0), vec3(0.4545));       // back to sRGB
  outColor = vec4(col, alpha);
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
  /* Tight enough that the grid is not spent on empty space, loose enough that
     nothing touches a face — surface nets leaves an open edge where it does. */
  const LO = [-5.4, -6.9, -5.3], HI = [5.1, 9.7, 4.5];

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
  const UNIFORMS = ['proj','view','eye','a','v','quiver','time','act','mode','kind','clipX','dark','style',
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

  /* ── scanned model ────────────────────────────────────────────────────────
     Loaded on demand: the geometry is one interleaved-by-section binary and
     three WebP maps, produced by scripts/prep-glb.js. Everything here is built
     lazily so a build that never shows a scan pays nothing for the option. */
  let scan = null, scanProg = null, uScan = null;
  function texFrom(img, srgb) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8,
                  gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  async function loadScan(src) {
    const man = typeof src.manifest === 'string' ? JSON.parse(src.manifest) : src.manifest;
    const bin = await (await fetch(src.bin)).arrayBuffer();
    const L = man.layout;
    const pos = new Float32Array(bin, L.pos.byteOffset, L.pos.byteLength / 4);
    const nrm = new Int8Array(bin, L.nrm.byteOffset, L.nrm.byteLength);
    const uv  = new Uint16Array(bin, L.uv.byteOffset, L.uv.byteLength / 2);
    const w   = new Uint8Array(bin, L.w.byteOffset, L.w.byteLength);
    const act = new Uint16Array(bin, L.act.byteOffset, L.act.byteLength / 2);
    const idx = man.indexBits === 16
      ? new Uint16Array(bin, L.idx.byteOffset, L.idx.byteLength / 2)
      : new Uint32Array(bin, L.idx.byteOffset, L.idx.byteLength / 4);

    const imgs = await Promise.all(['base', 'normal', 'mr'].map(async k => {
      const blob = await (await fetch(src[k])).blob();
      /* No flip. glTF puts UV (0,0) at the image's top-left, and an unflipped
         upload puts the top row at t=0 — they already agree. Flipping mirrors
         the atlas vertically, which sends the mesh to sample the unused padding
         regions and covers it in coloured shards. */
      return createImageBitmap(blob);
    }));

    scanProg = program(gl, SCAN_VERT, SCAN_FRAG);
    uScan = {};
    for (const n of ['proj','view','eye','a','v','quiver','time','act','mode','clipX','dark',
                     'lvApex','lvAxis','rvApex','rvAxis','laC','raC','base','nrm','mr'])
      uScan[n] = gl.getUniformLocation(scanProg, 'u' + n[0].toUpperCase() + n.slice(1));

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const put = (data, loc, size, type, norm, stride) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, type, norm, stride || 0, 0);
    };
    put(pos, 0, 3, gl.FLOAT, false);
    /* Normals are stored 4 bytes per vertex for alignment but only 3 are read,
       so the stride must be stated. With stride 0 the GPU packs them at 3 and
       every vertex after the first reads a window shifted by one byte — which
       looks exactly like a finely crumpled surface, not like broken data. */
    put(nrm, 1, 3, gl.BYTE, true, 4);
    put(w,   2, 4, gl.UNSIGNED_BYTE, true);   // chamber weights, 0..1
    put(uv,  3, 2, gl.UNSIGNED_SHORT, true);
    put(act, 4, 1, gl.UNSIGNED_SHORT, false); // activation, milliseconds
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    scan = { vao, count: idx.length,
             type: man.indexBits === 16 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT,
             tex: { base: texFrom(imgs[0], true), nrm: texFrom(imgs[1], false), mr: texFrom(imgs[2], false) },
             credit: man.credit };
    if (reduced) draw(16);
    return scan.credit;
  }
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

  /* ── blood flow particles: a tiny dedicated point-sprite program, drawn
     additively over everything else, only where cutaway/conduction mode has
     actually opened the chambers up ── */
  const BLOOD_VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aColor;
layout(location=2) in float aSize;
uniform mat4 uBProj, uBView;
out vec3 vColor;
void main(){
  vColor = aColor;
  gl_Position = uBProj * uBView * vec4(aPos, 1.0);
  gl_PointSize = clamp(520.0 * aSize / gl_Position.w, 3.0, 24.0);
}`;
  const BLOOD_FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main(){
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  // a small hot core (reads as a highlight, not just a flat blob) plus a
  // wider soft glow — tuned so the colour still reads as red/blue instead
  // of bleaching toward white once it's additively blended over lit muscle
  float core = smoothstep(0.55, 0.0, r);
  float glow = pow(1.0 - r, 1.8);
  vec3 col = vColor * (0.55 + glow * 1.3) + vec3(1.0) * core * 0.5;
  outColor = vec4(col, glow);
}`;
  const bloodProg = program(gl, BLOOD_VERT, BLOOD_FRAG);
  const bU = { proj: gl.getUniformLocation(bloodProg, 'uBProj'), view: gl.getUniformLocation(bloodProg, 'uBView') };
  const bloodState = makeBloodParticles();
  const BLOOD_STRIDE = 7;   // x,y,z, r,g,b, size
  const bloodBuf = new Float32Array(bloodState.length * BLOOD_STRIDE);
  const bloodVao = gl.createVertexArray();
  gl.bindVertexArray(bloodVao);
  const bloodVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bloodVbo);
  gl.bufferData(gl.ARRAY_BUFFER, bloodBuf.byteLength, gl.DYNAMIC_DRAW);
  const stride = BLOOD_STRIDE * 4;
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 24);
  gl.bindVertexArray(null);
  const BLOOD_LEFT_RGB = [1.0, 0.20, 0.16], BLOOD_RIGHT_RGB = [0.20, 0.45, 1.0];
  function updateBloodBuffer(clipZ, hideBehindClip) {
    for (let i = 0; i < bloodState.length; i++) {
      const p = bloodState[i];
      const wp = polylinePoint(p.side === 0 ? BLOOD_RIGHT : BLOOD_LEFT, p.u);
      const rgb = p.side === 0 ? BLOOD_RIGHT_RGB : BLOOD_LEFT_RGB;
      const hidden = hideBehindClip && wp.pos[2] > clipZ;
      const o = i * BLOOD_STRIDE;
      bloodBuf[o] = hidden ? 0 : wp.pos[0];
      bloodBuf[o + 1] = hidden ? 0 : wp.pos[1];
      bloodBuf[o + 2] = hidden ? -9999 : wp.pos[2];   // pushed behind the camera — frustum-culled, never rasterized
      bloodBuf[o + 3] = rgb[0]; bloodBuf[o + 4] = rgb[1]; bloodBuf[o + 5] = rgb[2];
      bloodBuf[o + 6] = 0.7 + (i % 5) * 0.09;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, bloodVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, bloodBuf);
  }

  /* ── state ── */
  const STYLES = { anatomic: 0, ink: 1, crystal: 2 };
  const S = {
    rhythm: opts.rhythm || 'sinus',
    mode: opts.mode || 'whole',
    yaw: opts.yaw !== undefined ? opts.yaw : 0.42,
    pitch: opts.pitch !== undefined ? opts.pitch : 0.12,
    dist: opts.distance || 27,
    target: opts.target || [0.3, 0.6, 0],
    autoRotate: opts.autoRotate !== false,
    dark: opts.dark ? 1 : 0,
    clip: opts.clip !== undefined ? opts.clip : 0.4,
    style: STYLES[opts.style] || 0,
    model: opts.model === 'scan' ? 'scan' : 'procedural',
    t: 0, raf: null, last: null, dead: false, cyc: {},
    onCycle: opts.onCycle || null,
  };
  const MODES = { whole: 0, cutaway: 1, conduction: 2, coronary: 3 };

  function fit() {
    const r = canvas.getBoundingClientRect();
    /* The heart is the one 3D surface here, so its device pixels cost fragment
       shading, not just fill. A pointer:fine device (a desktop with a real GPU
       and mains power) gets 2.5 for a crisper silhouette; a touch device stays
       at 2, which is already retina, rather than tripling the shading budget on
       a phone. */
    const finePtr = window.matchMedia && window.matchMedia('(pointer:fine)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, finePtr ? 2.5 : 2);
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

    const eye = [S.target[0] + Math.sin(S.yaw) * Math.cos(S.pitch) * S.dist,
                 S.target[1] + Math.sin(S.pitch) * S.dist + 1.2,
                 S.target[2] + Math.cos(S.yaw) * Math.cos(S.pitch) * S.dist];
    const proj = mat4Perspective(0.62, canvas.width / canvas.height, 0.5, 120);
    const view = mat4LookAt(eye, S.target, [0, 1, 0]);

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
      gl.uniform1f(loc.style, S.style);
      gl.uniform3fv(loc.lvApex, new Float32Array(A.lv.apex));
      gl.uniform3fv(loc.lvAxis, new Float32Array(lvAxis));
      gl.uniform3fv(loc.rvApex, new Float32Array(A.rv.apex));
      gl.uniform3fv(loc.rvAxis, new Float32Array(rvAxis));
      gl.uniform3fv(loc.laC, new Float32Array(A.la.c));
      gl.uniform3fv(loc.raC, new Float32Array(A.ra.c));
    };
    gl.useProgram(prog);
    common(u);

    /* A loaded scan replaces the procedural surfaces entirely — the valves,
       coronaries and conduction still draw over it, because the scan is a
       single skin with none of those as separate geometry. */
    if (S.model === 'scan' && scan) {
      gl.useProgram(scanProg);
      gl.uniformMatrix4fv(uScan.proj, false, proj);
      gl.uniformMatrix4fv(uScan.view, false, view);
      gl.uniform3fv(uScan.eye, new Float32Array(eye));
      gl.uniform1f(uScan.a, c.a); gl.uniform1f(uScan.v, c.v);
      gl.uniform1f(uScan.quiver, c.quiver); gl.uniform1f(uScan.time, S.t);
      gl.uniform1f(uScan.act, c.act); gl.uniform1i(uScan.mode, mode);
      gl.uniform1f(uScan.clipX, S.clip); gl.uniform1f(uScan.dark, S.dark);
      gl.uniform3fv(uScan.lvApex, new Float32Array(A.lv.apex));
      gl.uniform3fv(uScan.lvAxis, new Float32Array(lvAxis));
      gl.uniform3fv(uScan.rvApex, new Float32Array(A.rv.apex));
      gl.uniform3fv(uScan.rvAxis, new Float32Array(rvAxis));
      gl.uniform3fv(uScan.laC, new Float32Array(A.la.c));
      gl.uniform3fv(uScan.raC, new Float32Array(A.ra.c));
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, scan.tex.base); gl.uniform1i(uScan.base, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, scan.tex.nrm);  gl.uniform1i(uScan.nrm, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, scan.tex.mr);   gl.uniform1i(uScan.mr, 2);
      gl.bindVertexArray(scan.vao);
      gl.drawElements(gl.TRIANGLES, scan.count, scan.type, 0);
      gl.useProgram(prog);
      common(u);
    }

    const drawMesh = (m, kind) => {
      gl.uniform1i(u.kind, kind);
      gl.bindVertexArray(m.vao);
      gl.drawElements(gl.TRIANGLES, m.count, m.type, 0);
    };
    const showProcedural = !(S.model === 'scan' && scan);
    if (!showProcedural) {
      /* The scan carries its own coronaries and great vessels, sculpted and
         textured — drawing the procedural ones over it lays a second, differently
         shaped arterial tree across the surface. Only the conduction system is
         added, because no scan of the outside can show it. */
      if (mode === 2) drawMesh(mCond, 2);
    } else if (S.style === 2) {
      /* Glass, so draw order stops being arbitrary. Solids first with depth
         writes ON so they occlude properly and the shell cannot paint over a
         vessel standing proud of it. Then the shells with depth writes OFF —
         writing depth from a transparent surface is exactly what makes the far
         wall disappear behind the near one. Two passes per shell (cull front,
         then cull back) puts each shell's inside behind its own outside, which
         is the whole trick for a closed transparent mesh. */
      gl.depthMask(true);
      drawMesh(mCoron, 1);
      if (mode === 2) drawMesh(mCond, 2);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.FRONT); drawMesh(mCav, 0);
      gl.cullFace(gl.BACK);  drawMesh(mCav, 0);
      gl.cullFace(gl.FRONT); drawMesh(mOuter, 0);
      gl.cullFace(gl.BACK);  drawMesh(mOuter, 0);
      gl.disable(gl.CULL_FACE);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    } else {
      drawMesh(mOuter, 0);
      if (mode === 1) drawMesh(mCav, 0);
      drawMesh(mCoron, 1);
      if (mode === 2) drawMesh(mCond, 2);
    }

    // valves — visible in cutaway and conduction, buried in muscle otherwise.
    // In crystal they show through the shell, which is half the point of it.
    if (mode === 1 || mode === 2 || S.style === 2) {
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

    // blood flow — the simulation keeps running even when hidden, so nothing
    // jumps when you switch back into a mode where the chambers are exposed
    stepBloodParticles(bloodState, dt, c);
    /* Glowing additive particles are a colour-render idea; in the engraved
       style they read as smudges on the paper, so the drawing leaves them out. */
    if ((mode === 1 || mode === 2) && S.style === 0) {
      updateBloodBuffer(S.clip, true);   // both cutaway and conduction clip on the same uClipX plane
      gl.useProgram(bloodProg);
      gl.uniformMatrix4fv(bU.proj, false, proj);
      gl.uniformMatrix4fv(bU.view, false, view);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.depthMask(false);
      gl.bindVertexArray(bloodVao);
      gl.drawArrays(gl.POINTS, 0, bloodState.length);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
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
    setStyle(s) { S.style = STYLES[s] || 0; if (reduced) draw(0); return api; },
    setModel(m) { S.model = m === 'scan' ? 'scan' : 'procedural'; if (reduced) draw(0); return api; },
    model() { return S.model; },
    hasScan() { return !!scan; },
    scanCredit() { return scan ? scan.credit : null; },
    /* Resolves with the model's credit line, which the caller is expected to
       display — these assets are CC-BY and attribution is the licence term. */
    loadScan(src) { return loadScan(src); },
    setAutoRotate(on) { S.autoRotate = !!on; return api; },
    resetView() { S.yaw = 0.42; S.pitch = 0.12; S.dist = 27; return api; },
    phase() { return cycle(S.t, S.rhythm, S.cyc); },
    stats: {
      buildMs: Math.round(buildMs),
      triangles: Math.round((outer.indices.length + cav.indices.length +
                  coron.indices.length + cond.indices.length + valves.indices.length) / 3),
      vertices: (outer.positions.length + cav.positions.length) / 3,
    },
    get lost() { return !!S.lost; },
    start() { if (!S.raf && !S.dead && !S.lost) { if (reduced) { fit(); draw(0); } else S.raf = requestAnimationFrame(loop); } return api; },
    stop() { if (S.raf) cancelAnimationFrame(S.raf); S.raf = null; S.last = null; return api; },
    destroy() { api.stop(); S.dead = true; },
  };

  /* CONTEXT LOSS IS NORMAL ON iPadOS, not an error case. Safari drops WebGL
     contexts under memory pressure and after a long spell in the background,
     and until this existed the loss was silent and terminal: the render loop
     kept calling into a dead context every frame, every call a no-op, and the
     canvas stayed blank until the app was reloaded.

     preventDefault() on the lost event is not optional — without it the
     browser will not even attempt to restore the context, so omitting it
     makes the loss permanent by definition.

     WHAT THIS DELIBERATELY DOES NOT DO is rebuild the GPU objects in place.
     Every buffer, program and VAO here is created inside create(), after a
     surfaceNets pass that is the expensive part; splitting the GPU half out
     to re-run it alone would be a refactor of the largest module in the
     project for a path that cannot be exercised without the licensed build.
     Instead the loss is reported, and the caller re-creates — which is one
     line at the mount site, and mountHeroHeart3d already falls back to the
     static SVG heart when WebGL is unavailable, so there is a correct thing
     on screen in the meantime. */
  canvas.addEventListener('webglcontextlost', function (ev) {
    ev.preventDefault();
    S.lost = true;
    api.stop();
    if (typeof opts.onLost === 'function') { try { opts.onLost(); } catch (_) {} }
  });
  canvas.addEventListener('webglcontextrestored', function () {
    S.lost = false;
    if (typeof opts.onRestored === 'function') { try { opts.onRestored(); } catch (_) {} }
  });

  api.start();
  return api;
}

/* chamberWeights and activationAt are exported so that OTHER geometry can be
   made to beat on this same anatomy: a scanned mesh baked into this coordinate
   frame takes its per-vertex weights from the very same fields the procedural
   heart uses, and the existing vertex shader then animates it unchanged. */
root.Heart3D = { create, cycle, RHYTHM_HR, VALVES, anatomy: A,
                 chamberWeights, activationAt, sdOuter };

})(typeof window !== 'undefined' ? window : this);
