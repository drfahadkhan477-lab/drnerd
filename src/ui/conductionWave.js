/* ═══════════════════════════════════════════════════════════════════════════
   conductionWave.js — which points on the conduction pathway have fired,
   and which fires next, at a given moment in the cardiac cycle.

   Pure sequencing only — no DOM, no WebGL, no mesh. It does not decide WHEN
   any point on the heart activates. heart3d.js's activationAt already does
   that — real 3D distance math, already shipped, already the thing the
   heart itself is drawn from — and this module takes those numbers as DATA
   rather than recomputing them, so there is exactly one place in this app
   that decides cardiac conduction timing.

   WHY NOT A HAND-WRITTEN SA→AV→HIS→BUNDLES→PURKINJE SCHEDULE. That was the
   first draft, and probing activationAt instead of assuming its shape
   caught the reason not to: sampled at heart3d.js's own anatomy reference
   points, RV.base returns 32ms — inside the atrial range, not the
   150ms+ ventricular one — because that point sits within the function's
   own 2.4-unit atrial-adjacency threshold of the right atrium. That is not
   a bug; the ventricular base genuinely sits against the atria in real
   anatomy. But it means "the six named conduction structures, each with
   its own invented millisecond range" would have been six numbers I made
   up, one of which would already have been wrong. Treating activationAt as
   the single oracle and this module as pure sequencing over its output
   avoids inventing a second, competing account of cardiac conduction.

   Usage (once the DOM side exists): sample activationAt at a handful of
   points on the real mesh, feed the {label, ms} list here every frame with
   how far into the beat we are, and this says what has fired.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

/* Every point whose activation time has already passed, in the order they
   fired — not the order they were given in. */
function firedBy(points, tMs) {
  return points
    .filter(p => p.ms <= tMs)
    .sort((a, b) => a.ms - b.ms)
    .map(p => p.label);
}

/* The single point that fires next after tMs, or null once nothing in this
   beat still hasn't. Ties (two points at the same ms) resolve by whichever
   was listed first — stable, not arbitrary. */
function nextToFire(points, tMs) {
  let best = null;
  for (const p of points) {
    if (p.ms > tMs && (best === null || p.ms < best.ms)) best = p;
  }
  return best ? best.label : null;
}

/* Where in the beat "now" sits, wrapped into [0, beatMs) — a sweep that
   restarts every beat rather than a stopwatch that runs once. Negative
   elapsed time (a caller's clock skew, not a real state) still wraps into
   range rather than producing a negative position nothing downstream
   expects. */
function sweepPosition(elapsedMs, beatMs) {
  if (!(beatMs > 0)) return 0;
  const m = elapsedMs % beatMs;
  return m < 0 ? m + beatMs : m;
}

root.ConductionWave = { firedBy, nextToFire, sweepPosition };

})(typeof window !== 'undefined' ? window : this);
