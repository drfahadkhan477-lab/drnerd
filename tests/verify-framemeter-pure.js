#!/usr/bin/env node
'use strict';
/*
 * The frame meter counts frames, per canvas, and what was drawn unseen.
 *
 *   node tests/verify-framemeter-pure.js
 *
 * src/core/framemeter.js is what the #frames line on the iPad reads (roadmap E5) and what tests/verify-frames.js holds the
 * app to, so a meter that counts draw calls as frames, merges two canvases or calls a hidden frame seen would make both
 * say the wrong thing. Held here in Node: the counting with a clock that is set by hand, and install() on a window made
 * of plain objects, so every count below is worked out by hand rather than read back from the module.
 */
const path = require('path');
require(path.join(__dirname, '..', 'src', 'core', 'framemeter.js'));
const FM = globalThis.FrameMeter;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

/* A meter on a hand-set clock, page state and off-screen set. */
function rig() {
  const s = { t: 0, hidden: false, off: new Set() };
  const m = FM.create({ now: () => s.t, hidden: () => s.hidden, offscreen: c => s.off.has(c) });
  const row = c => m.snapshot().find(r => r.canvas === c) || null;
  return { s, m, row };
}

head('a frame is counted once per canvas, however many draws it takes');
{
  const { s, m, row } = rig(), a = { id: 'a' };
  for (let f = 0; f < 60; f++) {
    s.t = f * 1000 / 60;
    /* The seven draws take 12 ms of the frame, so they cross 8 ms slots: only the frame's timestamp keeps them one. */
    const start = s.t;
    m.inFrame(start, () => { for (let d = 0; d < 7; d++) { s.t = start + 2 * d; m.mark(a); } });
  }
  s.t = 999;
  ok('sixty frames of seven draws each in a second are sixty frames', row(a).fps === 60 && row(a).total === 60, JSON.stringify({ fps: row(a).fps, total: row(a).total }));
  s.t = 2500;
  ok('and a second and a half later none are being drawn, while the total stays', row(a).fps === 0 && row(a).total === 60, JSON.stringify({ fps: row(a).fps, total: row(a).total }));
}

head('two canvases are two counts');
{
  const { s, m, row } = rig(), a = {}, b = {};
  for (let f = 0; f < 30; f++) { s.t = f * 33; m.inFrame(s.t, () => { m.mark(a); if (f % 3 === 0) m.mark(b); }); }
  ok('a canvas drawn every frame and one drawn every third frame', row(a).total === 30 && row(b).total === 10, `${row(a).total} and ${row(b).total}`);
}

head('a draw outside any animation frame counts in its own 8 ms slot');
{
  const { s, m, row } = rig(), a = {};
  s.t = 100; m.mark(a); s.t = 103; m.mark(a); s.t = 107.9; m.mark(a);   // one slot: 96 to 104 and 104 to 112 split at 104
  const one = row(a).total;
  s.t = 140; m.mark(a); s.t = 180; m.mark(a);
  ok('draws in the same slot are one frame, in different slots several', one === 2 && row(a).total === 4, `${one} then ${row(a).total}`);
  s.t = 200;
  m.inFrame(150, () => m.mark(a)); m.inFrame(150, () => m.mark(a));
  ok('two callbacks of the same animation frame are that one frame', row(a).total === 5, String(row(a).total));
}

head('what was drawn unseen');
{
  const { s, m, row } = rig(), a = {};
  s.t = 10; m.inFrame(10, () => m.mark(a));
  s.hidden = true;
  s.t = 30; m.inFrame(30, () => m.mark(a));            // the browser would not have run this; counted hidden, inside a frame
  s.t = 60; m.mark(a); s.t = 90; m.mark(a);            // a timer drawing for a hidden page
  ok('a frame drawn while the page is hidden is counted hidden', row(a).hidden === 3, String(row(a).hidden));
  ok('and only those outside an animation frame as drawn where the browser could not stop them', row(a).hiddenOutsideFrame === 2, String(row(a).hiddenOutsideFrame));
  s.hidden = false; s.off.add(a);
  s.t = 120; m.inFrame(120, () => m.mark(a)); s.t = 140; m.inFrame(140, () => m.mark(a));
  s.off.delete(a); s.t = 160; m.inFrame(160, () => m.mark(a));
  ok('a frame drawn off screen is counted off screen, and one on screen is not', row(a).offscreen === 2, String(row(a).offscreen));
}

head('the line says what is drawing, busiest first, and what was drawn unseen');
{
  const rows = [
    { name: '#heart', fps: 30, offscreen: 0, hiddenOutsideFrame: 0 },
    { name: '#ecg', fps: 60, offscreen: 4, hiddenOutsideFrame: 1 },
    { name: '#heart', fps: 0, offscreen: 2, hiddenOutsideFrame: 0 },
    { name: '.dial in #lab', fps: 0, offscreen: 0, hiddenOutsideFrame: 0 },
  ];
  const l = FM.line(rows);
  ok('the canvases drawing now, busiest first, with the total', l.startsWith('frames/s 90: #ecg 60, #heart 30 · '), l);
  ok('the unseen frames of every canvas, including ones not drawing now', /unseen: 6 off screen, 1 hidden$/.test(l), l);
  ok('two canvases with one name are told apart', FM.line([{ name: '#h', fps: 2, offscreen: 0, hiddenOutsideFrame: 0 }, { name: '#h', fps: 1, offscreen: 0, hiddenOutsideFrame: 0 }]).includes('#h 2, #h (2) 1'));
  ok('and nothing drawing says so', FM.line([]) === 'frames/s 0, nothing drawing · unseen: 0 off screen, 0 hidden', FM.line([]));
}

head('a canvas is named by its id or class, and where it is');
{
  const host = { id: 'labRoot' };
  const parent = { closest: () => host };
  ok('its own id', FM.labelOf({ id: 'heroHeart', classList: [], parentElement: parent }) === '#heroHeart in #labRoot');
  ok('or its first class', FM.labelOf({ id: '', classList: ['ecg-strip', 'x'], parentElement: parent }) === '.ecg-strip in #labRoot');
  ok('or plain canvas, and no host when there is none', FM.labelOf({ id: '', classList: [], parentElement: null }) === 'canvas');
}

head('install() counts every context, before or after it, and changes nothing they draw');
{
  /* A window of plain objects: two context types, a rAF that runs its callback at once with a given timestamp. */
  let ts = 0, t = 0;
  const calls = [];
  function C2D(canvas) { this.canvas = canvas; }
  C2D.prototype.fillRect = function(x) { calls.push(['fillRect', this.canvas.id, x]); return 'drawn ' + x; };
  C2D.prototype.clearRect = function() { calls.push(['clearRect', this.canvas.id]); };
  function GL(canvas) { this.canvas = canvas; }
  GL.prototype.drawArrays = function() { calls.push(['drawArrays', this.canvas.id]); };
  const visible = { isConnected: true, getBoundingClientRect: () => ({ width: 100, height: 100, top: 0, left: 0, bottom: 100, right: 100 }) };
  const below = { isConnected: true, getBoundingClientRect: () => ({ width: 100, height: 100, top: 900, left: 0, bottom: 1000, right: 100 }) };
  const win = {
    performance: { now: () => t }, document: { hidden: false }, innerWidth: 800, innerHeight: 600,
    CanvasRenderingContext2D: C2D, WebGLRenderingContext: GL,
    requestAnimationFrame: cb => { cb(ts); return 1; },
  };
  const before = new C2D(Object.assign({ id: 'early', classList: [], parentElement: null }, visible));
  const meter = FM.install(win);
  const glc = new GL(Object.assign({ id: 'heart', classList: [], parentElement: null }, below));
  const back = before.fillRect(3);
  ok('a draw call still draws, with its arguments, and returns what it returned', back === 'drawn 3' && calls.length === 1 && calls[0][2] === 3, JSON.stringify(calls));
  for (let f = 1; f <= 5; f++) { ts = f * 16; t = ts; win.requestAnimationFrame(() => { before.clearRect(); t += 10; before.fillRect(1); glc.drawArrays(); }); }
  const rows = meter.snapshot(), early = rows.find(r => r.name === '#early'), heart = rows.find(r => r.name === '#heart');
  ok('a context made before install is counted, frame by frame', !!early && early.total === 6, JSON.stringify(early));
  ok('and so is a WebGL one, and its frames off screen are counted as such', !!heart && heart.total === 5 && heart.offscreen === 5 && early.offscreen === 0, JSON.stringify(heart));
  const wrapped = C2D.prototype.fillRect, rafWrapped = win.requestAnimationFrame;
  ok('installing again changes nothing: the same meter, no second wrapper', FM.install(win) === meter &&
     C2D.prototype.fillRect === wrapped && win.requestAnimationFrame === rafWrapped);
  ok('the line reads the installed meter', /^frames\/s \d+/.test(meter.line()) && /unseen: 5 off screen/.test(meter.line()), meter.line());
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
