/* ═══════════════════════════════════════════════════════════════════════════
   heroRhythm.js — what the home screen's live strip cycles through.

   Pure selection logic only — no DOM, no timers, so the "never show the same
   rhythm twice in a row" and "keep the alarming ones out of ambient rotation"
   rules are each one small function you can call from a test without a
   browser. The app wires this to a canvas and a setInterval; this file
   doesn't know either exists.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

/* Deliberately excludes vfib and asystole — those are real teaching content
   inside Rhythm Lab where you went looking for them, not ambient wallpaper
   on the screen you land on every time you open a study app. Also excludes
   torsades and paced, which read as visual noise at hero scale (74x80px);
   they're a better fit for the full-size Lab monitor. */
const HERO_PLAYLIST = [
  'sinus', 'sinus_arrhythmia', 'brady', 'tachy', 'afib', 'flutter',
  'avb1', 'mobitz1', 'pac', 'bigeminy', 'svt', 'wpw', 'lbbb', 'rbbb',
  'pericarditis', 'hyperk', 'vt', 'chb', 'stemi',
];

/* Never repeats the immediately preceding rhythm — a "random" pick that can
   land on the same thing twice in a row reads as broken, not random.

   Done by stepping off a collision rather than by drawing again. A reroll loop
   (`do { pick } while (pick === prevKey)`) is unbounded by construction: with
   this playlist it terminates on the first retry ~95% of the time, but nothing
   in the code says the list cannot contain the same key twice, and a list that
   did would hang the hero animation for ever with no way to see why. One
   deterministic step is the same result with no loop to reason about. */
function nextInPlaylist(prevKey, playlist, rand) {
  const list = playlist || HERO_PLAYLIST;
  const r = rand || Math.random;
  if (!list.length) return undefined;
  if (list.length === 1) return list[0];
  const i = Math.min(list.length - 1, Math.max(0, Math.floor(r() * list.length)));
  return list[i] === prevKey ? list[(i + 1) % list.length] : list[i];
}

/* Look up a rhythm's {name,hr,desc} across both the base RHYTHMS table and
   RhythmsExtra.EXTRA, whichever has it — kept here so callers don't need to
   know which registry a given key lives in. */
function resolveRhythm(kind, baseRhythms, extra) {
  return (baseRhythms && baseRhythms[kind])
    || (extra && extra[kind])
    || (baseRhythms && baseRhythms.sinus)
    || null;
}

/* CSS animation-duration for a heartbeat visual at a given rate — one full
   systole-to-systole cycle, clamped so a 0 bpm rhythm (never reaches the
   hero, but defensively) or an implausibly fast one doesn't produce a
   broken or seizure-inducing duration. */
function beatDurationMs(hr) {
  const bpm = hr > 0 ? hr : 68;
  return Math.max(280, Math.min(1600, Math.round(60000 / bpm)));
}

root.HeroRhythm = { HERO_PLAYLIST, nextInPlaylist, resolveRhythm, beatDurationMs };

})(typeof window !== 'undefined' ? window : this);
