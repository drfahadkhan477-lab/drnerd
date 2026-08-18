/* ═══════════════════════════════════════════════════════════════════════════
   apex.js — the tutor's identity and its living avatar.

   The name: the apex beat is the heart's most physical sign, the apical window
   is where you go to actually see it, and "apex" is where you are trying to
   get. It is also not a living cardiologist's name, which the previous one was.

   The avatar is a canvas, not an icon. It is always beating, and what it is
   doing tells you the state of the tutor without a spinner or a status string:

     idle      slow sinus rhythm, calm teal
     listening the trace leans toward you as you type
     thinking  faster, searching, amber, with a sweep ring
     tool      violet, stepping — it is doing something specific
     speaking  amplitude tracks the tokens actually arriving

   Usage:
     const apex = Apex.avatar(canvas);
     apex.setState('thinking');
     apex.pulse();                  // call per token as a reply streams in
     apex.destroy();
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

const IDENTITY = {
  name: 'Apex',
  role: 'Cardiology tutor',
  tagline: 'Mechanism first, then the evidence.',
  /* Alternatives, if the name does not sit right — each is a one-line change:
     Cor (Latin, the heart itself) · Ictus (the apex beat) · Sinus (the node
     that starts every beat) · Purkinje (the network that spreads it) */
};

const STATES = {
  idle:      { hue: [0.35, 0.83, 0.78], hr: 62,  amp: 0.55, sweep: 0.0, label: '' },
  listening: { hue: [0.36, 0.88, 0.85], hr: 74,  amp: 0.72, sweep: 0.0, label: 'listening' },
  thinking:  { hue: [0.98, 0.72, 0.30], hr: 104, amp: 0.85, sweep: 1.0, label: 'thinking' },
  tool:      { hue: [0.71, 0.55, 0.98], hr: 88,  amp: 0.70, sweep: 0.7, label: 'working' },
  speaking:  { hue: [0.38, 0.90, 0.82], hr: 82,  amp: 1.00, sweep: 0.0, label: '' },
};

/* one PQRST beat in millivolts — same shape language as the ECG engine, so the
   avatar and the strip in the app are recognisably the same waveform */
function beat(t) {
  const g = (c, w, a) => a * Math.exp(-0.5 * Math.pow((t - c) / w, 2));
  return g(45, 20, 0.13) + g(168, 5, -0.10) + g(186, 9, 1.05) +
         g(208, 10, -0.22) + g(390, 55, 0.28);
}

function avatar(canvas, opts) {
  opts = opts || {};
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const S = {
    state: opts.state || 'idle',
    t: 0, last: null, raf: null, dead: false,
    cur: STATES.idle.hue.slice(),
    curAmp: STATES.idle.amp, curHr: STATES.idle.hr, curSweep: 0,
    energy: 0,          // decays continuously; each arriving token nudges it up
    ring: 0,
    trail: [],
  };
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function fit() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!r.width) return false;
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    S.w = r.width; S.h = r.height;
    return true;
  }

  function rgb(c, a) {
    return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
  }

  function draw(dt) {
    if (!fit()) return;
    const target = STATES[S.state] || STATES.idle;
    const k = 1 - Math.pow(0.001, dt / 1000);        // frame-rate independent ease
    for (let i = 0; i < 3; i++) S.cur[i] += (target.hue[i] - S.cur[i]) * k;
    S.curAmp += (target.amp - S.curAmp) * k;
    S.curHr += (target.hr - S.curHr) * k;
    S.curSweep += (target.sweep - S.curSweep) * k;
    S.energy *= Math.pow(0.9, dt / 16.7);

    const w = S.w, h = S.h, cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) / 2 - 2;
    ctx.clearRect(0, 0, w, h);

    // ── the disc it lives on
    const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.4, R * 0.1, cx, cy, R);
    g.addColorStop(0, rgb(S.cur, 0.30));
    g.addColorStop(0.55, rgb(S.cur, 0.13));
    g.addColorStop(1, rgb(S.cur, 0.05));
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fillStyle = g; ctx.fill();

    // ── the beat ring: it expands on every systole, so the thing is alive even
    //    when nothing is happening
    const RR = 60000 / S.curHr;
    const phase = (S.t % RR) / RR;
    const sys = Math.max(0, Math.sin(Math.min(phase / 0.34, 1) * Math.PI));
    const pulse = sys * (0.55 + S.energy * 0.5);
    ctx.beginPath();
    ctx.arc(cx, cy, R * (0.80 + pulse * 0.16), 0, 6.2832);
    ctx.strokeStyle = rgb(S.cur, 0.15 + pulse * 0.55);
    ctx.lineWidth = 1.2 + pulse * 1.6;
    ctx.stroke();

    // ── monitor sweep, while it is working
    if (S.curSweep > 0.01) {
      const a = (S.t / 900) % 6.2832;
      const sg = ctx.createConicGradient
        ? ctx.createConicGradient(a, cx, cy) : null;
      if (sg) {
        sg.addColorStop(0, rgb(S.cur, 0.34 * S.curSweep));
        sg.addColorStop(0.14, rgb(S.cur, 0));
        sg.addColorStop(1, rgb(S.cur, 0));
        ctx.beginPath(); ctx.arc(cx, cy, R * 0.96, 0, 6.2832);
        ctx.fillStyle = sg; ctx.fill();
      }
    }

    // ── the trace itself, scrolling right to left inside the disc
    const span = R * 1.5;
    const msPerPx = 3.1;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.93, 0, 6.2832); ctx.clip();
    ctx.beginPath();
    for (let i = 0; i <= span; i++) {
      const tt = S.t - (span - i) * msPerPx;
      const v = beat(((tt % RR) + RR) % RR) * S.curAmp * (1 + S.energy * 0.55);
      const x = cx - span / 2 + i;
      const y = cy - v * R * 0.44;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = rgb(S.cur, 0.95);
    ctx.lineWidth = 1.9; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.shadowColor = rgb(S.cur, 0.9); ctx.shadowBlur = 7;
    ctx.stroke();
    ctx.shadowBlur = 0;
    // leading dot, where the trace is being written
    const vNow = beat(S.t % RR) * S.curAmp;
    ctx.beginPath();
    ctx.arc(cx + span / 2, cy - vNow * R * 0.44, 2.1, 0, 6.2832);
    ctx.fillStyle = rgb(S.cur, 1); ctx.fill();
    ctx.restore();

    // ── rim
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832);
    ctx.strokeStyle = rgb(S.cur, 0.42); ctx.lineWidth = 1;
    ctx.stroke();
  }

  function loop(now) {
    if (S.dead) return;
    if (S.last === null) S.last = now;
    let dt = now - S.last; S.last = now;
    if (dt > 80) dt = 80;
    S.t += dt;
    draw(dt);
    S.raf = requestAnimationFrame(loop);
  }

  const api = {
    setState(s) { if (STATES[s]) S.state = s; if (reduced) draw(16); return api; },
    state() { return S.state; },
    /* call this as each chunk of a reply arrives — the trace grows with the
       actual token rate, so a fast answer looks fast */
    pulse(n) { S.energy = Math.min(1.6, S.energy + (n || 1) * 0.22); return api; },
    label() { return (STATES[S.state] || STATES.idle).label; },
    start() {
      if (S.raf || S.dead) return api;
      if (reduced) { fit(); draw(16); return api; }
      S.raf = requestAnimationFrame(loop);
      return api;
    },
    stop() { if (S.raf) cancelAnimationFrame(S.raf); S.raf = null; S.last = null; return api; },
    destroy() { api.stop(); S.dead = true; },
  };
  api.start();
  return api;
}

root.Apex = { avatar, IDENTITY, STATES };

})(typeof window !== 'undefined' ? window : this);
