/* How many frames each canvas draws, for roadmap E5: measure battery on the
   iPad, then set a frame budget. The container cannot measure battery; the iPad
   can, and what it needs beside the battery reading is what the page was drawing.

   NOTHING RUNS UNTIL install() IS CALLED. The page calls it only for #frames
   (the line in the shell), and tests/verify-frames.js calls it to hold the app
   to its rules. Installed, it wraps the draw calls of the 2D and WebGL contexts
   (on their prototypes, so a context made before install is counted too) and
   requestAnimationFrame.

   A FRAME IS COUNTED ONCE PER CANVAS. Many draw calls make one frame: those made
   inside one requestAnimationFrame callback share its timestamp; one made outside
   any (a timer, an event) counts in an 8 ms slot. For each frame the meter notes
   whether the page was hidden and whether the canvas was off screen (not in the
   document, no size, or outside the viewport). Browsers stop requestAnimationFrame
   for a hidden page, so a hidden frame drawn OUTSIDE it is one the browser could
   not stop: a timer drawing what nobody sees. That is kept apart.

   tests/verify-framemeter-pure.js holds the counting in Node; tests/verify-frames.js
   uses it in the app. */
(function(root){
'use strict';

const WINDOW_MS = 1000;
const SLOT_MS = 8;
const TWO_D = ['clearRect', 'fillRect', 'strokeRect', 'fill', 'stroke', 'drawImage', 'putImageData', 'fillText', 'strokeText'];
const GL = ['clear', 'drawArrays', 'drawElements'];

/* The counting, with the clock and the page's state handed in, so Node can hold it. */
function create({ now, hidden, offscreen }) {
  const recs = new Map();
  let frameTs = null;
  function mark(canvas) {
    if (!canvas) return;
    const t = now();
    const key = frameTs !== null ? 'r' + frameTs : 't' + Math.floor(t / SLOT_MS);
    let r = recs.get(canvas);
    if (!r) { r = { key: null, times: [], total: 0, hidden: 0, hiddenOutsideFrame: 0, offscreen: 0 }; recs.set(canvas, r); }
    if (r.key === key) return;
    r.key = key;
    r.total++;
    r.times.push(t);
    while (r.times.length && t - r.times[0] >= WINDOW_MS) r.times.shift();
    if (hidden()) { r.hidden++; if (frameTs === null) r.hiddenOutsideFrame++; }
    if (offscreen(canvas)) r.offscreen++;
  }
  /* Runs fn as an animation frame with timestamp ts: its draws share one frame. */
  function inFrame(ts, fn) {
    const prev = frameTs;
    frameTs = ts;
    try { return fn(); } finally { frameTs = prev; }
  }
  function snapshot(label) {
    const t = now(), out = [];
    for (const [canvas, r] of recs) {
      while (r.times.length && t - r.times[0] >= WINDOW_MS) r.times.shift();
      out.push({ canvas, name: label ? label(canvas) : '', fps: r.times.length, total: r.total,
        hidden: r.hidden, hiddenOutsideFrame: r.hiddenOutsideFrame, offscreen: r.offscreen });
    }
    return out;
  }
  function reset() { recs.clear(); }
  return { mark, inFrame, snapshot, reset };
}

/* What a person reading the line can tell apart: the canvas's id or class, and
   where it is; duplicates are numbered rather than merged. */
function labelOf(canvas) {
  const own = canvas.id ? '#' + canvas.id : (canvas.classList && canvas.classList[0] ? '.' + canvas.classList[0] : 'canvas');
  const host = canvas.parentElement && canvas.parentElement.closest ? canvas.parentElement.closest('[id]') : null;
  return host && host.id && ('#' + host.id) !== own ? own + ' in #' + host.id : own;
}

function names(rows) {
  const seen = new Map();
  return rows.map(r => {
    const n = (seen.get(r.name) || 0) + 1;
    seen.set(r.name, n);
    return n > 1 ? Object.assign({}, r, { name: r.name + ' (' + n + ')' }) : r;
  });
}

/* One line: the canvases drawing now, busiest first, then what was drawn unseen. */
function line(rows) {
  const live = names(rows).filter(r => r.fps > 0).sort((a, b) => b.fps - a.fps || (a.name < b.name ? -1 : 1));
  const off = rows.reduce((s, r) => s + r.offscreen, 0), hid = rows.reduce((s, r) => s + r.hiddenOutsideFrame, 0);
  const total = live.reduce((s, r) => s + r.fps, 0);
  return 'frames/s ' + total + (live.length ? ': ' + live.map(r => r.name + ' ' + r.fps).join(', ') : ', nothing drawing') +
    ' · unseen: ' + off + ' off screen, ' + hid + ' hidden';
}

function offscreenIn(win) {
  return canvas => {
    if (!canvas || !canvas.isConnected || typeof canvas.getBoundingClientRect !== 'function') return true;
    const b = canvas.getBoundingClientRect();
    return !(b.width > 0 && b.height > 0) || b.bottom <= 0 || b.right <= 0 ||
      b.top >= win.innerHeight || b.left >= win.innerWidth;
  };
}

let installed = null;
function install(win) {
  if (installed) return installed;
  const meter = create({ now: () => win.performance.now(), hidden: () => !!win.document.hidden, offscreen: offscreenIn(win) });
  const wrap = (Ctx, methods) => {
    if (!Ctx || !Ctx.prototype) return;
    for (const m of methods) {
      const orig = Ctx.prototype[m];
      if (typeof orig !== 'function') continue;
      Ctx.prototype[m] = function() { meter.mark(this.canvas); return orig.apply(this, arguments); };
    }
  };
  wrap(win.CanvasRenderingContext2D, TWO_D);
  wrap(win.WebGLRenderingContext, GL);
  wrap(win.WebGL2RenderingContext, GL);
  const raf = win.requestAnimationFrame;
  if (typeof raf === 'function') {
    win.requestAnimationFrame = function(cb) {
      return raf.call(win, ts => meter.inFrame(ts, () => cb(ts)));
    };
  }
  installed = {
    snapshot: () => meter.snapshot(labelOf).map(r => { const o = Object.assign({}, r); delete o.canvas; return o; }),
    line: () => line(meter.snapshot(labelOf)),
    reset: meter.reset,
  };
  return installed;
}

root.FrameMeter = { create, install, line, labelOf, WINDOW_MS, SLOT_MS };
})(typeof window !== 'undefined' ? window : globalThis);
