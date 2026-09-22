/* ═══════════════════════════════════════════════════════════════════════════
   livingDiagram.js — when to let the heart, the 12-lead and the PV loop
   breathe together, and which one is on screen while they do.

   Pure timing and sequencing only — no DOM, no timers, same shape as
   heroRhythm.js and pencil.js and for the same reason: the rules that decide
   WHEN ambient mode may run and WHICH view it shows next are worth holding in
   a test that needs no browser, even though what it eventually draws needs
   one badly. The app wires this to a visibilitychange listener, an idle
   timer and a canvas; this file doesn't know any of those exist.

   WHY THE HOME SCREEN ONLY. Focus Mode's own rule is `S.focusMode &&
   S.screen==='quiz'` — screen-gated on principle, not convenience. This
   mirrors that: ambient mode is eligible only where nothing it would dim or
   interrupt is at stake. Quiz, chat, chapters, a figure mid-zoom — anything
   with state a fellow could be mid-thought in — is out, because the cost of
   guessing wrong there is real and the value of guessing right is a screen
   saver. The home screen has neither problem.

   WHY REDUCED MOTION MEANS NEVER, NOT SLOWER. This is a feature whose whole
   point is continuous motion, sustained for as long as nobody touches the
   screen — the exact shape prefers-reduced-motion exists to suppress. Same
   call this project already made for figloadfade: the honest default state,
   not a compromise animation.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

/* Two minutes of no interaction before ambient mode may start — long enough
   that nobody glancing at a chapter list or reading a pearl trips it. */
const IDLE_MS = 120000;

/* How long each view holds before the next one takes over. */
const DWELL_MS = 9000;

/* The three already-computed, already-tested views this composes — nothing
   here draws anything of its own. */
const VIEWS = ['heart', 'ecg', 'pvloop'];

/* Ambient mode is allowed only on the home screen, with no overlay panel
   open, Focus Mode off (the two are siblings, not one inside the other),
   and motion not reduced. */
function eligible(screen, opts) {
  opts = opts || {};
  if (screen !== 'home') return false;
  if (opts.aiOpen) return false;
  if (opts.focusMode) return false;
  if (opts.reducedMotion) return false;
  return true;
}

/* Whether ambient mode should be active right now, given how long it has
   been since the last interaction. */
function shouldEnter(msSinceActivity, screen, opts) {
  return eligible(screen, opts) && msSinceActivity >= IDLE_MS;
}

/* Deterministic view-cycling — the exact step-off heroRhythm.js's
   nextInPlaylist uses, reused rather than re-invented: never the view
   already showing, landing spot chosen by an injectable random source so
   the no-repeat guarantee is exhaustively testable rather than sampled. */
function nextView(prevView, views, rand) {
  const list = views || VIEWS;
  const r = rand || Math.random;
  if (!list.length) return undefined;
  if (list.length === 1) return list[0];
  const i = Math.min(list.length - 1, Math.max(0, Math.floor(r() * list.length)));
  return list[i] === prevView ? list[(i + 1) % list.length] : list[i];
}

root.LivingDiagram = { IDLE_MS, DWELL_MS, VIEWS, eligible, shouldEnter, nextView };

})(typeof window !== 'undefined' ? window : this);
