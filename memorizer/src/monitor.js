/* ═══════════════════════════════════════════════════════════════════════════
   monitor.js — Systole's live rhythm strip, on Memorizer's home.

   The owner asked for Memorizer to look like Systole, whose home carries a
   bedside monitor: a lead II strip sweeping left to right, a rhythm named in
   monitor type, the rhythm changing every few seconds. The beats are
   Systole's own (src/core/rhythms-extra.js, xBeat and extraRhythmMV); this
   file only chooses the rhythm and sweeps it across a canvas.

   The selection (PLAYLIST, next, sample) is pure, so the suite holds it
   without a browser. mount() draws: one canvas for the life of the page —
   render() redraws the whole screen on every tap, and a new canvas each
   time restarted the sweep, the flicker the owner reported — paused while
   the page is hidden, and drawn once, still, when reduced motion is asked
   for.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var R = root.RhythmsExtra || (typeof require === 'function' ? require('../../src/core/rhythms-extra.js').RhythmsExtra || root.RhythmsExtra : null);

/* Sinus is Systole's built-in; the rest are rhythms-extra's. Like Systole's
   hero, nothing alarming is ambient wallpaper: no VT, no asystole. */
var SINUS = { name: 'Sinus Rhythm', hr: 72 };
var PLAYLIST = ['sinus', 'sinus_arrhythmia', 'avb1', 'mobitz1', 'pac', 'wpw', 'lbbb', 'rbbb', 'pericarditis', 'hyperk', 'svt'];
var HOLD_MS = 11000;
var SWEEP_MS = 4000;   /* one screen width of strip, as a monitor at 25 mm/s shows about four seconds */

function info(kind) { return kind === 'sinus' ? SINUS : (R && R.EXTRA[kind]) || SINUS; }

/* The next rhythm: a step off the one showing, never the same twice — the
   rule Systole's hero keeps, for the same reason. */
function next(prev, rand) {
  var i = Math.floor((rand || Math.random)() * PLAYLIST.length) % PLAYLIST.length;
  if (PLAYLIST[i] === prev) i = (i + 1) % PLAYLIST.length;
  return PLAYLIST[i];
}

/* Millivolts at `tms` ms into the rhythm; `state` carries what a rhythm
   with memory (Wenckebach, bigeminy) needs from one call to the next. */
function sample(kind, tms, state) {
  if (!R) return 0;
  if (kind === 'sinus') return R.xBeat(tms % (60000 / SINUS.hr), {});
  var v = R.extraRhythmMV(kind, tms, state);
  return v == null ? 0 : v;
}

function label(kind) { var d = info(kind); return 'II · ' + d.name + ' · ' + d.hr + ' bpm'; }

/* ── drawing ───────────────────────────────────────────────────────────── */
var el = null;
function mount(doc, reduced) {
  if (el) { el.__still(reduced()); return el; }
  el = doc.createElement('div');
  el.className = 'hero-monitor';
  el.setAttribute('aria-hidden', 'true');
  var canvas = doc.createElement('canvas'), tag = doc.createElement('span');
  tag.className = 'hero-monitor-label';
  el.appendChild(canvas); el.appendChild(tag);
  var ctx = canvas.getContext && canvas.getContext('2d');
  var kind = next(null), state = {}, t0 = 0, since = 0, lastX = -1, lastY = 0, raf = 0, still = false;
  el.setAttribute('data-rhythm', kind); tag.textContent = label(kind);

  function size() {
    var r = canvas.getBoundingClientRect(), dpr = root.devicePixelRatio || 1;
    var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; lastX = -1; return true; }
    return false;
  }
  function y(mv) { return canvas.height * 0.7 - mv * canvas.height * 0.55; }
  function ink() { return root.getComputedStyle ? root.getComputedStyle(el).color : '#5EEAD4'; }
  function whole() {
    if (!ctx) return;
    size();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = ink(); ctx.lineWidth = Math.max(1.5, canvas.height / 36); ctx.lineJoin = 'round';
    ctx.beginPath();
    var s = {};
    for (var x = 0; x < canvas.width; x++) {
      var v = y(sample(kind, x / canvas.width * SWEEP_MS, s));
      if (x) ctx.lineTo(x, v); else ctx.moveTo(x, v);
    }
    ctx.stroke();
  }
  function frame(now) {
    raf = 0;
    if (still || !el.isConnected || (doc.hidden)) return;
    if (!t0) { t0 = now; since = now; }
    if (now - since > HOLD_MS) { kind = next(kind); state = {}; since = now; el.setAttribute('data-rhythm', kind); tag.textContent = label(kind); }
    if (size()) ctx.clearRect(0, 0, canvas.width, canvas.height);
    var tms = now - t0, x = Math.floor((tms % SWEEP_MS) / SWEEP_MS * canvas.width);
    var gap = Math.max(8, canvas.width / 40);
    /* the eraser runs ahead of the pen, as on a monitor */
    ctx.clearRect(x, 0, gap, canvas.height);
    if (x < lastX) { ctx.clearRect(0, 0, gap, canvas.height); lastX = -1; }
    var v = y(sample(kind, tms, state));
    ctx.strokeStyle = ink(); ctx.lineWidth = Math.max(1.5, canvas.height / 36); ctx.lineCap = 'round';
    ctx.beginPath();
    if (lastX >= 0) ctx.moveTo(lastX, lastY); else ctx.moveTo(x, v);
    ctx.lineTo(x, v); ctx.stroke();
    lastX = x; lastY = v;
    el.setAttribute('data-x', String(x));
    raf = root.requestAnimationFrame(frame);
  }
  function go() { if (!raf && !still && ctx) raf = root.requestAnimationFrame(frame); }
  el.__still = function (s) {
    still = !!s;
    el.setAttribute('data-still', still ? 'true' : 'false');
    if (still) { if (raf) root.cancelAnimationFrame(raf); raf = 0; root.requestAnimationFrame(whole); }
    else go();
  };
  if (doc.addEventListener) doc.addEventListener('visibilitychange', function () { if (!doc.hidden) go(); });
  el.__still(reduced());
  /* on the page next frame: size() needs a laid-out canvas */
  root.requestAnimationFrame(function () { if (still) whole(); else go(); });
  return el;
}

var MemMonitor = { PLAYLIST: PLAYLIST, HOLD_MS: HOLD_MS, SWEEP_MS: SWEEP_MS, next: next, sample: sample, label: label, info: info, mount: mount };
root.MemMonitor = MemMonitor;
if (typeof module !== 'undefined' && module.exports) module.exports = MemMonitor;
})(typeof window !== 'undefined' ? window : this);
