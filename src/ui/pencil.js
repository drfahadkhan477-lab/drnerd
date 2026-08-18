/* ═══════════════════════════════════════════════════════════════════════════
   pencil.js — pure helpers behind the ink rail's Apple-Pencil feel.

   Kept separate from the DOM wiring (which lives inline in the patched app,
   same as roundPt/simplifyStroke from Stage 0) so the width curve — the part
   with actual room to get subtly wrong — can be unit-tested without a canvas
   or a real Pencil in the room.

   What "like the official Markup pencil" means, concretely, and why each
   piece is here:

     · WIDTH = pressure AND tilt, not pressure alone. Markup's Pencil tool
       reads as graphite laid on its side — press harder OR lay the Pencil
       flatter and the stroke broadens. A mouse or a finger has no tilt, so
       tiltFactor is a no-op for them (see widthFor).
     · SIZES are named presets (S/M/L), not a raw multiplier a caller has to
       invent — small human choice, kept in one place so the rail and any
       future settings screen agree on what "Medium" means.
     · Auto-minimize is a plain countdown, not app state — armAutoMinimize
       returns a timer id and takes a callback; it doesn't know about T.min,
       localStorage, or the rail. The app wires it to those; this file
       doesn't need to.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

/* Named size presets, as a multiplier on a tool's base width. Chosen so
   Medium reproduces the original fixed width exactly (no visual jump for
   existing users), and Small/Large are a clearly different stroke rather
   than a barely-perceptible nudge. */
const SIZES = { S: 0.6, M: 1.0, L: 1.7 };
const SIZE_ORDER = ['S', 'M', 'L'];

/* Effective line width for one segment. `pressure` and `tilt` are both
   0-1 (tilt: 0 = Pencil upright, 1 = laid flat — see tiltFactor). `base` is
   the tool's INK_TOOLS width, `sizeKey` one of SIZES' keys. */
function widthFor(base, pressure, tilt, sizeKey) {
  const sz = SIZES[sizeKey] === undefined ? 1 : SIZES[sizeKey];
  const p = pressure === undefined ? 0.5 : Math.max(0, Math.min(1, pressure));
  const t = tilt === undefined ? 0 : Math.max(0, Math.min(1, tilt));
  // pressure does most of the work; tilt adds up to another 70% on top,
  // matching how laying a Pencil flatter broadens a real graphite line
  // without pressure alone being able to reach that width.
  const pressureTerm = 0.45 + p * 1.25;
  const tiltTerm = 1 + t * 0.7;
  return base * sz * pressureTerm * tiltTerm;
}

/* PointerEvent gives Apple Pencil altitude as tiltX/tiltY in degrees from
   the surface plane (0 = flat on the glass, 90 = upright) on iPadOS Safari.
   Folded to 0 (upright, no broadening) .. 1 (flat, maximum broadening). */
function tiltFactor(tiltX, tiltY) {
  if (!tiltX && !tiltY) return 0;
  const altitudeDeg = 90 - Math.min(90, Math.hypot(tiltX || 0, tiltY || 0));
  return Math.max(0, Math.min(1, (90 - altitudeDeg) / 65));   // ~25°+ from vertical reads as "flat"
}

/* A plain countdown: call arm() after activity, it fires `fn` if nothing
   cancels it first. Returns the timer id so the caller can clear it on the
   next pointerdown. No knowledge of the app's own state. */
function armAutoMinimize(ms, fn) { return setTimeout(fn, ms); }

root.PencilFX = { SIZES, SIZE_ORDER, widthFor, tiltFactor, armAutoMinimize };

})(typeof window !== 'undefined' ? window : this);
