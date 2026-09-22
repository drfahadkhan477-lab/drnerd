/* ═══════════════════════════════════════════════════════════════════════════
   coronaryTree.js — a branching vessel geometry, and how bright a real
   coronary flow reading should make it glow.

   Pure geometry and a pure normaliser — no DOM, no canvas, no physiology of
   its own. The flow itself comes from Physio.coronaryFlow(t, side), already
   shipped and already correct (the left coronary genuinely collapses to a
   fraction of its diastolic flow during systole — measured, not decorated —
   because the contracting myocardium squeezes its own vessels shut). This
   file does not know what a real coronary flow number looks like; it only
   turns whatever number it is handed into a 0..1 brightness.

   THE BRANCHING ITSELF IS NOT ANATOMY. Real coronary anatomy is not a clean
   binary fractal — it is asymmetric, and the left main splits into two
   genuinely different vessels (LAD, circumflex), not two scaled copies of
   each other. This generates a plausible branching VESSEL-LIKE structure
   for the flow-pulse to travel across, the same honest relationship a
   Wiggers-diagram trace has to the pressure curve it draws: the pulse is
   the physiology, the branches are where it goes.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

const DEFAULTS = {
  x: 0, y: 0,           // trunk origin
  angle: -Math.PI / 2,  // pointing "up" in screen space (canvas y grows down)
  length: 100,
  maxDepth: 6,
  decay: 0.72,          // each generation's length, relative to its parent
  spread: 0.5,           // radians each child diverges from the parent's heading
  minLength: 2,          // stop recursing once a branch would be shorter than this
};

/* One generation of the recursive split. Appends every segment it draws
   (itself, then its two children, depth-first) to `out` rather than
   returning a tree structure — a flat list is what a renderer draws from
   directly, and it is also what makes an exhaustive count-and-bounds check
   over the whole structure straightforward. */
function grow(x, y, angle, length, depth, opts, out) {
  if (depth > opts.maxDepth || length < opts.minLength) return;
  const x2 = x + Math.cos(angle) * length;
  const y2 = y + Math.sin(angle) * length;
  out.push({ x1: x, y1: y, x2, y2, depth });
  if (depth === opts.maxDepth) return;
  const next = length * opts.decay;
  grow(x2, y2, angle - opts.spread, next, depth + 1, opts, out);
  grow(x2, y2, angle + opts.spread, next, depth + 1, opts, out);
}

/* The whole tree as a flat list of segments, depth-first from the trunk.
   Deterministic — same opts, same tree, every time, so the shape a viewer
   sees does not shuffle between renders for no reason. */
function tree(opts) {
  const o = Object.assign({}, DEFAULTS, opts || {});
  const out = [];
  grow(o.x, o.y, o.angle, o.length, 0, o, out);
  return out;
}

/* A raw coronaryFlow() reading, folded into a 0..1 brightness. min/max are
   the caller's own observed bounds (sampled across a real cycle, not
   hardcoded here) — this function only knows how to place a value inside a
   range it is given, the same separation of concerns pencil.js's widthFor
   keeps between "what a pressure/tilt reading is" and "how wide that
   makes a line". */
function intensity(flow, min, max) {
  if (!(max > min)) return 0;
  return Math.max(0, Math.min(1, (flow - min) / (max - min)));
}

root.CoronaryTree = { DEFAULTS, tree, intensity };

})(typeof window !== 'undefined' ? window : this);
