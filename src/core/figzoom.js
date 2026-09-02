/* ═══════════════════════════════════════════════════════════════════════════
   figzoom.js — the arithmetic of zooming and panning a figure.

   Fitted-or-natural is enough for a diagram, not for a 12-lead where the
   question is a 40 ms notch. Those need a magnification you choose, at a point
   you choose.

   ITS OWN FILE because zoom-about-a-point goes subtly wrong: a sign or
   ordering error makes the picture creep away from your fingers over
   successive pinches, which reads as "the zoom feels bad" and is nearly
   impossible to attribute by eye. verify-figzoom-pure.js checks it
   numerically instead, holding the anchor across twenty alternating gestures.

   transform is translate(tx,ty) scale(s), origin 0 0 — so content and
   viewport coords differ by exactly that. scale 1 is fitted, because the
   image is laid out at max-width:100% underneath.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

const MIN = 1;   /* fitted; smaller just floats a figure in backdrop */
const MAX = 8;   /* past this a WebP figure is only its own compression */

const clamp = (v, lo, hi) => v < lo ? lo : (v > hi ? hi : v);

function fit() { return { scale: MIN, tx: 0, ty: 0 }; }

/* Zoom about (px, py), which must not move. That invariant is the whole
   function: the point's content coords are (px - tx)/scale, and must still
   map to (px, py) afterwards. */
function zoomAbout(st, factor, px, py) {
  const s = clamp(st.scale * factor, MIN, MAX);
  if (s === st.scale) return { scale: st.scale, tx: st.tx, ty: st.ty };
  const cx = (px - st.tx) / st.scale;
  const cy = (py - st.ty) / st.scale;
  return { scale: s, tx: px - cx * s, ty: py - cy * s };
}

function panBy(st, dx, dy) {
  return { scale: st.scale, tx: st.tx + dx, ty: st.ty + dy };
}

/* Keep content in contact with the viewport. Larger in an axis: clamp so
   neither edge can be dragged inside it, or a figure can be flicked into the
   void. Smaller: centre it — pinned to a corner reads as a layout bug. */
function constrain(st, viewW, viewH, contentW, contentH) {
  const w = contentW * st.scale, h = contentH * st.scale;
  const axis = (t, view, size) =>
    size <= view ? (view - size) / 2 : clamp(t, view - size, 0);
  return { scale: st.scale, tx: axis(st.tx, viewW, w), ty: axis(st.ty, viewH, h) };
}

/* Fitted → `to`, about the point tapped, and back. Two states rather than a
   ladder: anyone who wants 3.4x is already pinching. */
function toggle(st, px, py, to) {
  if (st.scale > MIN + 1e-6) return fit();
  return zoomAbout(fit(), (to || 2.5), px, py);
}

const isFitted = st => st.scale <= MIN + 1e-6;

root.FigZoom = { fit, zoomAbout, panBy, constrain, toggle, isFitted, clamp, MIN, MAX };

})(typeof window !== 'undefined' ? window : this);
