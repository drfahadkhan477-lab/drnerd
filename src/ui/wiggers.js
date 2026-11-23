/* ═══════════════════════════════════════════════════════════════════════════
   wiggers.js — draws what physio.js computes.

   Six views over one model, and one clock behind all of them:

     Wiggers     the classic stacked diagram — ECG, pressures, volume, phases
     PV loop     pressure against volume, with the ESPVR and EDPVR that explain it
     Flow        aortic and mitral flow, then coronary flow, which is the payoff
     Right       the right heart against the left, which is where S1 and S2 split
     Curves      Frank-Starling, and Guyton's two curves and their intersection
     Conduction  which of the heart's own real activation points have fired

   Nothing here is drawn from memory of a textbook figure. Every point is
   Physio evaluated at a cycle fraction, so if the physiology is edited the
   picture changes with it, and the cursor on the diagram is the same instant
   as the beating heart beside it. Conduction is the one exception to
   "Physio evaluated" specifically — it reads real numbers, but from
   Heart3D.activationAt, not Physio; see drawConduction's own comment for why
   that is a real distinction and not a loophole.

   Colours come from the page's CSS custom properties where they are structural
   — paper, ink, grid, muted — so the diagram follows whatever theme is active.
   Trace colours do not: an aorta drawn in anything but red teaches the reader
   to distrust the figure.

   Usage:
     const w = Wiggers.mount(canvas, { view:'wiggers', dark:false, hr:75 });
     w.setView('pv'); w.setIntervention('after'); w.setTime(0.3);
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

const VIEWS = [
  { id:'wiggers', label:'Wiggers',  hint:'Pressures, volume and the ECG across one cycle' },
  { id:'pv',      label:'PV loop',  hint:'Pressure against volume, and the relations that set it' },
  { id:'flow',    label:'Flow',     hint:'Valve flow, and why the left ventricle is perfused in diastole' },
  { id:'right',   label:'Right heart', hint:'The right side against the left — where S1 and S2 split' },
  { id:'curves',  label:'Curves',   hint:'Frank-Starling, and Guyton at the point they cross' },
  { id:'conduction', label:'Conduction', hint:'Which of the heart’s real activation points have fired, in order' },
  { id:'coronary', label:'Coronary', hint:'Why the left ventricle is perfused in diastole — it squeezes its own arteries shut' },
];

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

function mount(canvas, opts) {
  opts = opts || {};
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof root.Physio === 'undefined') return null;
  const Ph = root.Physio;

  const S = {
    view: opts.view || 'wiggers',
    dark: !!opts.dark,
    hr: opts.hr || 75,
    /* How much slower than real time the animation runs. NOT a change to the
       heart rate: the rate is a fact about the patient and the slowdown is a
       fact about the playback, and a diagram that expressed one as the other
       would be labelling a slow-motion replay as a bradycardia. */
    slow: opts.slow || 1,
    t: 0,
    playing: opts.playing !== false,
    iv: 'base',
    /* The beat drawn (a Circulation.cycle(), or null for physio.js's), and the normal heart it is measured against:
       the engine's own normal beat where the caller hands one, else physio.js's. */
    cycle: null,
    ref: null,
    scrub: false,
    raf: 0,
    last: 0,
    /* When set, this returns the cycle fraction and the diagram stops
       integrating its own. That is how the cursor becomes the same instant as
       the beating heart beside it rather than a second animation that agrees
       with it only until one of them drops a frame. */
    src: opts.timeSource || null,
    /* Called once a frame with the cycle fraction just drawn, on each frame the
       loop drew (see tick: a diagram that is not moving draws none). The phase
       caption used to be repainted by whatever else was animating alongside
       the diagram; now that the diagram is the only thing on the panel, it has
       to announce its own time. */
    onFrame: typeof opts.onFrame === 'function' ? opts.onFrame : null,
    /* The beat the Wiggers view draws: null for physio.js's drawn cycle, or a Circulation.cycle() (a lesion
       made in src/core/circulation.js, docs/ROADMAP.md S8). The other views draw physio.js until each is
       wired to it in turn. */
    cycle: opts.cycle || null,
    zones: [],            // hit regions, in CSS px
    hoverT: null,
  };
  const secs = () => 60 / S.hr;

  /* One set of margins per view, read by that view's own draw function AND by
     scrubAt below — so a drag on the canvas can never disagree with where the
     trace it is dragging over actually is. Kept once here after they drifted
     apart once already: scrubAt carried its own copy (40, 14) that matched
     drawRight by coincidence, was 2px off drawWiggers's real right margin,
     and 4px off drawFlow's real left margin — a small but real, reproducible
     mismatch between where a drag lands and the time it reports. pv and
     curves are absent on purpose: scrubAt refuses those views before ever
     reading a margin. */
  const MARGINS = {
    wiggers: { L: 40, R: 12 },
    flow:    { L: 44, R: 14 },
    right:   { L: 40, R: 14 },
    coronary: { L: 44, R: 14 },
  };

  /* ── palette ──────────────────────────────────────────────────────────────
     Structure from the theme, meaning from the physiology. */
  function cssv(name, fb) {
    try { const v = getComputedStyle(canvas).getPropertyValue(name).trim(); return v || fb; }
    catch (_) { return fb; }
  }
  function palette() {
    const d = S.dark;
    return {
      paper: cssv('--card', d ? '#0E1622' : '#FFFFFF'),
      ink:   cssv('--text', d ? '#E7EDF5' : '#0F172A'),
      muted: cssv('--muted', d ? '#9AA9BC' : '#475569'),
      dim:   cssv('--dim',  d ? '#6B7C93' : '#94A3B8'),
      grid:  d ? 'rgba(148,163,184,.13)' : 'rgba(15,23,42,.075)',
      gridB: d ? 'rgba(148,163,184,.24)' : 'rgba(15,23,42,.15)',
      band:  d ? 'rgba(148,163,184,.055)' : 'rgba(15,23,42,.032)',
      cursor: cssv('--teal', d ? '#2DD4BF' : '#0D9488'),
      ao:  d ? '#FF6B74' : '#E03B46',
      lv:  d ? '#4FB8EC' : '#0E7FBF',
      la:  d ? '#B79CF5' : '#7C5CD6',
      vol: d ? '#34C48C' : '#0E9463',
      pa:  d ? '#F5A85C' : '#D97A17',
      rv:  d ? '#5BD0E2' : '#0E97AE',
      ra:  d ? '#D3ABF0' : '#9757C9',
      cor: d ? '#F2C14E' : '#C68A05',
      ghost: d ? 'rgba(148,163,184,.34)' : 'rgba(71,85,105,.30)',
    };
  }

  /* ── canvas fit ───────────────────────────────────────────────────────────
     Three device pixels per CSS pixel where the display offers them. A hairline
     axis and 10px superscript labels are exactly what a 2x buffer smears. */
  let W = 0, H = 0;
  function fit() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const dpr = Math.min(root.devicePixelRatio || 1, 3);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = r.width; H = r.height;
    return true;
  }

  /* ── primitives ─────────────────────────────────────────────────────────── */
  const box = (x, y, w, h) => ({ x, y, w, h, r: x + w, b: y + h });
  const xAt = (B, t) => B.x + t * B.w;
  const yAt = (B, v, lo, hi) => B.b - ((v - lo) / (hi - lo)) * B.h;

  function font(px, weight, mono) {
    ctx.font = `${weight || 500} ${px}px ${mono
      ? 'ui-monospace,SFMono-Regular,Menlo,monospace'
      : 'system-ui,-apple-system,"Segoe UI",sans-serif'}`;
  }
  function text(str, x, y, col, px, weight, align, mono) {
    font(px || 11, weight, mono);
    ctx.fillStyle = col; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
    ctx.textAlign = 'left';
  }
  function hline(B, y, col, lw, dash) {
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = lw || 1;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(B.x, Math.round(y) + .5); ctx.lineTo(B.r, Math.round(y) + .5);
    ctx.stroke(); ctx.restore();
  }
  /* A trace across one cycle. Sampled at a little over one point per device
     pixel: fewer and the dicrotic notch flattens, more is wasted. */
  function trace(B, fn, lo, hi, col, lw, o) {
    o = o || {};
    const n = o.n || Math.max(160, Math.round(B.w * 1.6));
    ctx.save();
    ctx.beginPath(); ctx.rect(B.x - 1, B.y - 1, B.w + 2, B.h + 2); ctx.clip();
    ctx.strokeStyle = col; ctx.lineWidth = lw || 2;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (o.dash) ctx.setLineDash(o.dash);
    ctx.beginPath();
    const from = o.from == null ? 0 : o.from, to = o.to == null ? 1 : o.to;
    for (let i = 0; i <= n; i++) {
      const t = from + (to - from) * (i / n);
      const px = xAt(B, t), py = yAt(B, clamp(fn(t), lo, hi), lo, hi);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();
    if (o.fill) {
      ctx.lineTo(xAt(B, to), B.b); ctx.lineTo(xAt(B, from), B.b); ctx.closePath();
      ctx.globalAlpha = o.fill; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
  /* Value axis with its own ticks, drawn inside the plot so stacked panels
     stay aligned on the shared time axis. */
  function vaxis(B, lo, hi, step, p, unit, dec) {
    ctx.save();
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
      const y = yAt(B, v, lo, hi);
      hline(B, y, v === lo ? p.gridB : p.grid, 1);
      text(dec ? v.toFixed(dec) : String(Math.round(v)), B.x - 6, y, p.dim, 9.5, 500, 'right', true);
    }
    if (unit) text(unit, B.x - 6, B.y + 4, p.dim, 9, 600, 'right', true);
    ctx.restore();
  }
  /* What the Wiggers view reads: the lesion's beat when one is set, else physio.js. */
  const D = () => ((S.view === 'wiggers' || S.view === 'pv' || S.view === 'flow' || S.view === 'right' || S.view === 'coronary') && S.cycle) ? S.cycle : Ph;
  /* The loop the PV view draws: the lesion's beat's, or physio.js's with the intervention chosen. */
  function loopNow() {
    if (S.view === 'pv' && S.cycle) return S.cycle.loop;
    const iv = Ph.INTERVENTIONS.find(i => i.id === S.iv) || Ph.INTERVENTIONS[0];
    const l = Ph.loopWith(iv.args);
    l.espvrAt = v => Ph.espvr(v, l.ees, l.v0);
    l.edpvrAt = v => Ph.edpvr(v, l.stiff, l.shift);
    return l;
  }
  function phaseBands(B, p) {
    const PH = D().PHASES;
    for (const ph of PH) {
      const i = PH.indexOf(ph);
      if (i % 2) continue;
      ctx.fillStyle = p.band;
      ctx.fillRect(xAt(B, ph.from), B.y, (ph.to - ph.from) * B.w, B.h);
    }
  }
  function eventLines(B, p, side) {
    ctx.save(); ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
    for (const ev of D().EVENTS) {
      if (side && ev.side !== side) continue;
      ctx.strokeStyle = p.gridB;
      const x = Math.round(xAt(B, ev.at)) + .5;
      ctx.beginPath(); ctx.moveTo(x, B.y); ctx.lineTo(x, B.b); ctx.stroke();
    }
    ctx.restore();
  }
  function cursor(B, p) {
    const x = Math.round(xAt(B, S.t)) + .5;
    ctx.save();
    ctx.strokeStyle = p.cursor; ctx.lineWidth = 1.5; ctx.globalAlpha = .85;
    ctx.beginPath(); ctx.moveTo(x, B.y); ctx.lineTo(x, B.b); ctx.stroke();
    ctx.restore();
  }
  function dot(x, y, col, r, p) {
    ctx.save();
    ctx.fillStyle = p.paper; ctx.beginPath(); ctx.arc(x, y, (r || 4) + 2, 0, TAU); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r || 4, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function chip(str, x, y, col, p, align) {
    font(10, 700);
    const w = ctx.measureText(str).width + 10;
    const bx = align === 'right' ? x - w : x;
    ctx.save();
    ctx.fillStyle = col; ctx.globalAlpha = .14;
    ctx.beginPath(); ctx.roundRect(bx, y - 8, w, 16, 4); ctx.fill();
    ctx.globalAlpha = 1;
    text(str, bx + 5, y, col, 10, 700);
    ctx.restore();
    return w;
  }

  /* ── the ECG strip ────────────────────────────────────────────────────────
     Borrowed from the 12-lead model rather than drawn, so the QRS on the
     diagram is the same QRS the rhythm strip shows. Aligned by finding the R
     peak once and offsetting it onto the cycle, which keeps the alignment
     correct if either model's timing is ever changed. */
  let rOffset = null;
  function ecgAt(t) {
    const L = root.Leads12;
    if (!L) {
      /* A small stand-in, so the panel is never empty if the 12-lead is absent. */
      const g = (c, w, a) => a * Math.exp(-Math.pow((Ph.wrap(t - c + .5) - .5) / w, 2));
      return g(0.00, .030, .16) + g(0.075, .009, 1.25) - g(0.058, .008, .22)
           - g(0.095, .012, .30) + g(0.235, .045, .34);
    }
    const rr = secs() * 1000;
    if (rOffset == null) {
      let best = -1e9;
      for (let ms = 0; ms < rr; ms += 1) { const v = L.sample('II', ms, 'sinus', S.hr); if (v > best) { best = v; rOffset = ms; } }
    }
    /* R belongs just after atrial systole begins — the QRS starts the moment
       the ventricle does, which is what puts it at the foot of IVC. */
    /* A lesion's beat carries its own excitation time; its R peak is 40 ms after. */
    const rPeak = (S.view === 'wiggers' && S.cycle) ? S.cycle.rAt + 0.04 / secs() : 0.075;
    const ms = (Ph.wrap(t - rPeak) * rr) + rOffset + rr * 8;
    return L.sample('II', ms, 'sinus', S.hr);
  }

  /* ════════════════════ view: the Wiggers diagram ════════════════════════ */
  function drawWiggers(p) {
    const Q = D();
    /* Axes that hold the beat: physio.js's fixed 0-130 mmHg and 40-130 mL, or as far as a lesion reaches. */
    const pHi = Q === Ph ? 130 : Math.max(130, Math.ceil(Q.max.p / 20) * 20), pStep = pHi > 160 ? 40 : 20;
    const vLo = Q === Ph ? 40 : Math.max(0, Math.floor((Q.min.v - 10) / 10) * 10);
    const vHi = Q === Ph ? 130 : Math.ceil((Q.max.v + 10) / 10) * 10, vStep = Math.max(10, Math.round((vHi - vLo) / 3 / 10) * 10);
    const { L, R } = MARGINS.wiggers, TOP = 18, BOT = 64;
    const w = W - L - R;
    const gap = 10;
    const hEcg = 50, hPhase = 28;
    const hRest = H - TOP - BOT - hEcg - hPhase - gap * 3;
    const hP = hRest * 0.64, hV = hRest * 0.36;

    let y = TOP;
    const Becg = box(L, y, w, hEcg);  y += hEcg + gap;
    const Bp   = box(L, y, w, hP);    y += hP + gap;
    const Bv   = box(L, y, w, hV);    y += hV + gap;
    const Bph  = box(L, y, w, hPhase);

    for (const B of [Becg, Bp, Bv]) { phaseBands(B, p); eventLines(B, p); }

    /* pressures */
    vaxis(Bp, 0, pHi, pStep, p, 'mmHg');
    trace(Bp, Q.laPressure, 0, pHi, p.la, 1.9);
    trace(Bp, Q.aoPressure, 0, pHi, p.ao, 2.4);
    trace(Bp, Q.lvPressure, 0, pHi, p.lv, 2.4);
    /* Shade the gradient that drives ejection: the only interval in the cycle
       when the ventricle is pushing blood into the aorta rather than at it. */
    ctx.save();
    ctx.beginPath();
    const n = 90;
    for (let i = 0; i <= n; i++) { const t = Q.T.ao + (Q.T.ac - Q.T.ao) * i / n; ctx.lineTo(xAt(Bp, t), yAt(Bp, Q.lvPressure(t), 0, pHi)); }
    for (let i = n; i >= 0; i--) { const t = Q.T.ao + (Q.T.ac - Q.T.ao) * i / n; ctx.lineTo(xAt(Bp, t), yAt(Bp, Q.aoPressure(t), 0, pHi)); }
    ctx.closePath(); ctx.fillStyle = p.lv; ctx.globalAlpha = .10; ctx.fill();
    ctx.restore();

    text('Aorta', xAt(Bp, .60), yAt(Bp, Q.aoPressure(.60), 0, pHi) - 11, p.ao, 10.5, 700);
    text('LV', xAt(Bp, .22), yAt(Bp, Q.lvPressure(.22), 0, pHi) - 11, p.lv, 10.5, 700);
    text('LA', xAt(Bp, .47), yAt(Bp, Q.laPressure(.47), 0, pHi) - 10, p.la, 10.5, 700);

    /* volume */
    vaxis(Bv, vLo, vHi, vStep, p, 'mL');
    trace(Bv, Q.lvVolume, vLo, vHi, p.vol, 2.4, { fill: .10 });
    text('LV volume', xAt(Bv, .70), yAt(Bv, Q.lvVolume(.70), vLo, vHi) - 11, p.vol, 10.5, 700);
    /* Stroke volume, named on the axis it is measured from. */
    ctx.save();
    ctx.strokeStyle = p.vol; ctx.globalAlpha = .55; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    for (const v of [Q.EDV, Q.ESV]) {
      const yy = Math.round(yAt(Bv, v, vLo, vHi)) + .5;
      ctx.beginPath(); ctx.moveTo(Bv.x, yy); ctx.lineTo(Bv.r, yy); ctx.stroke();
    }
    ctx.restore();
    const yEdv = yAt(Bv, Q.EDV, vLo, vHi), yEsv = yAt(Bv, Q.ESV, vLo, vHi);
    ctx.save();
    ctx.strokeStyle = p.vol; ctx.lineWidth = 1.2;
    const ax = Bv.r - 26;
    ctx.beginPath(); ctx.moveTo(ax, yEdv); ctx.lineTo(ax, yEsv); ctx.stroke();
    ctx.restore();
    text('SV ' + Math.round(Q.EDV - Q.ESV), Bv.r - 22, (yEdv + yEsv) / 2, p.vol, 9.5, 700, 'left', true);

    /* ECG */
    vaxis(Becg, -0.6, 1.6, 100, p, '');
    trace(Becg, ecgAt, -0.6, 1.6, p.ink, 1.7);
    text('ECG II', Becg.x + 4, Becg.y + 9, p.dim, 9.5, 700, 'left', true);

    /* heart sounds, on the events that make them */
    let lastSx = -99;
    for (const ev of Q.EVENTS) {
      if (!ev.sound) continue;
      const x = xAt(Becg, ev.at);
      const stack = x - lastSx < 16;
      lastSx = x;
      ctx.save();
      ctx.strokeStyle = p.muted; ctx.lineWidth = 1.4; ctx.globalAlpha = .8;
      ctx.beginPath(); ctx.moveTo(x, Becg.b - 4); ctx.lineTo(x, Becg.b + (stack ? 12 : 3)); ctx.stroke();
      ctx.restore();
      text(ev.note || ev.sound, x, Becg.b + (stack ? 18 : 9), p.muted, 9, 700, 'center', true);
    }

    /* phases */
    S.zones = [];
    const cur = Q.phaseAt(S.t);
    for (const ph of Q.PHASES) {
      const x = xAt(Bph, ph.from), pw = (ph.to - ph.from) * Bph.w;
      const on = ph.id === cur.id;
      ctx.save();
      ctx.fillStyle = on ? p.cursor : p.dim;
      ctx.globalAlpha = on ? .20 : .085;
      ctx.beginPath(); ctx.roundRect(x + 1, Bph.y, Math.max(2, pw - 2), Bph.h, 3); ctx.fill();
      ctx.restore();
      S.zones.push({ x, y: Bph.y, w: pw, h: Bph.h, phase: ph.id });
      if (pw > 26) {
        const short = ph.name.replace('Isovolumetric contraction', 'IVC').replace('Isovolumetric relaxation', 'IVR')
          .replace('Reduced filling (diastasis)', 'Diastasis')
          .replace('Rapid ejection', 'Rapid ej.').replace('Reduced ejection', 'Reduced ej.')
          .replace('Rapid filling', 'Rapid fill').replace('Atrial systole', 'Atrial');
        text(short, x + pw / 2, Bph.y + Bph.h / 2, on ? p.cursor : p.muted,
             Math.min(10, Math.max(8, pw / 7)), on ? 800 : 600, 'center');
      }
    }
    /* valve events along the bottom */
    for (const ev of Q.EVENTS) {
      if (ev.side !== 'L') continue;
      const x = xAt(Bph, ev.at);
      text(ev.id.toUpperCase(), x, Bph.b + 11, p.dim, 8.5, 700, 'center', true);
      ctx.save(); ctx.strokeStyle = p.gridB; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, Bph.b); ctx.lineTo(Math.round(x) + .5, Bph.b + 4);
      ctx.stroke(); ctx.restore();
    }
    text('0', Bph.x, Bph.b + 11, p.dim, 9, 500, 'center', true);
    text(secs().toFixed(2) + ' s', Bph.r, Bph.b + 11, p.dim, 9, 500, 'center', true);

    for (const B of [Becg, Bp, Bv]) cursor(B, p);

    /* the live readout — the reason this is a model and not a picture */
    const s = Q.sample(S.t);
    const cw = (W - L - R) / 4;
    const ry = Bph.b + 36;
    const rd = [
      ['LV', s.lvP.toFixed(0), 'mmHg', p.lv],
      ['Ao', s.aoP.toFixed(0), 'mmHg', p.ao],
      ['LA', s.laP.toFixed(1), 'mmHg', p.la],
      ['Vol', s.lvV.toFixed(0), 'mL', p.vol],
    ];
    rd.forEach((r, i) => {
      const x = L + cw * i + cw / 2;
      text(r[0], x - 2, ry, p.dim, 9, 600, 'right', true);
      text(r[1], x + 2, ry, r[3], 12.5, 800, 'left', true);
    });
  }

  /* ════════════════════ view: the pressure-volume loop ═══════════════════ */
  function drawPV(p) {
    const L = 44, R = 14, TOP = 14, BOT = 80;
    const B = box(L, TOP, W - L - R, H - TOP - BOT);
    const cur = loopNow();
    /* The resting loop the ghost draws: the reference beat's, or physio.js's. */
    const base = S.ref ? S.ref.loop : Ph.loopWith();
    const lesion = cur !== null && S.cycle && cur === S.cycle.loop;
    /* physio.js's fixed axes, or as far as a lesion's loop reaches, in steps of 40. */
    const vLo = 0, vHi = lesion ? Math.max(220, Math.ceil((S.cycle.max.v + 20) / 40) * 40) : 220;
    const pLo = 0, pHi = lesion ? Math.max(170, Math.ceil((S.cycle.max.p + 10) / 40) * 40) : 170;

    const X = v => B.x + (v - vLo) / (vHi - vLo) * B.w;
    const Y = q => B.b - (q - pLo) / (pHi - pLo) * B.h;

    /* grid */
    ctx.save();
    ctx.strokeStyle = p.grid; ctx.lineWidth = 1;
    for (let v = 0; v <= vHi; v += 40) { const x = Math.round(X(v)) + .5; ctx.beginPath(); ctx.moveTo(x, B.y); ctx.lineTo(x, B.b); ctx.stroke(); }
    for (let q = 0; q <= pHi; q += 40) { const y = Math.round(Y(q)) + .5; ctx.beginPath(); ctx.moveTo(B.x, y); ctx.lineTo(B.r, y); ctx.stroke(); }
    ctx.restore();
    for (let v = 0; v <= vHi; v += 40) text(String(v), X(v), B.b + 12, p.dim, 9.5, 500, 'center', true);
    for (let q = 0; q <= pHi; q += 40) text(String(q), B.x - 6, Y(q), p.dim, 9.5, 500, 'right', true);
    text('LV volume  mL', (B.x + B.r) / 2, B.b + 26, p.muted, 10, 600, 'center');
    ctx.save(); ctx.translate(12, (B.y + B.b) / 2); ctx.rotate(-Math.PI / 2);
    text('LV pressure  mmHg', 0, 0, p.muted, 10, 600, 'center'); ctx.restore();

    /* the relations */
    ctx.save();
    ctx.strokeStyle = p.ao; ctx.lineWidth = 1.6; ctx.setLineDash([5, 4]); ctx.globalAlpha = .75;
    ctx.beginPath();
    let started = false;
    for (let v = cur.v0; v <= vHi; v += 4) {
      const q = cur.espvrAt(v);
      if (q > pHi) break;
      started ? ctx.lineTo(X(v), Y(q)) : (ctx.moveTo(X(v), Y(q)), started = true);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = p.vol; ctx.globalAlpha = .8;
    ctx.beginPath();
    for (let v = 20; v <= vHi; v += 3) {
      const q = cur.edpvrAt(v);
      if (q > 72) break;
      ctx.lineTo(X(v), Y(q));
    }
    ctx.stroke();
    /* arterial elastance: the line from EDV whose slope IS the afterload */
    ctx.strokeStyle = p.muted; ctx.globalAlpha = .5; ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(X(cur.edv), Y(0)); ctx.lineTo(X(cur.esv), Y(cur.esp)); ctx.stroke();
    ctx.restore();
    let esX = vHi, esY = cur.espvrAt(vHi);
    if (esY > pHi) { esY = pHi; esX = cur.v0 + (pHi - cur.espvrAt(cur.v0)) / cur.ees; }
    text('ESPVR', clamp(X(esX) - 6, B.x + 44, B.r - 6),
         clamp(Y(esY) + (esY >= pHi ? 11 : -11), B.y + 8, B.b - 8), p.ao, 9.5, 700, 'right', true);
    let edEnd = vHi;
    for (let v = 20; v <= vHi; v += 2) if (cur.edpvrAt(v) > 72) { edEnd = v; break; }
    text('EDPVR', clamp(X(edEnd) + 6, B.x, B.r - 44), Y(70) + 2, p.vol, 9.5, 700, 'left', true);
    text('Ea', (X(cur.edv) + X(cur.esv)) / 2 + 14, (Y(0) + Y(cur.esp)) / 2 + 8, p.muted, 9.5, 700, 'left', true);

    /* the resting loop as a ghost, whenever we have moved off it: an intervention, or a lesion */
    if (S.cycle ? S.cycle !== S.ref : S.iv !== 'base') {
      ctx.save(); ctx.strokeStyle = p.ghost; ctx.lineWidth = 1.6; ctx.setLineDash([4, 4]);
      ctx.beginPath(); base.points.forEach((q, i) => i ? ctx.lineTo(X(q.v), Y(q.p)) : ctx.moveTo(X(q.v), Y(q.p)));
      ctx.closePath(); ctx.stroke(); ctx.restore();
    }

    /* the loop itself, filled — the fill IS the stroke work */
    ctx.save();
    ctx.beginPath();
    cur.points.forEach((q, i) => i ? ctx.lineTo(X(q.v), Y(q.p)) : ctx.moveTo(X(q.v), Y(q.p)));
    ctx.closePath();
    ctx.fillStyle = p.lv; ctx.globalAlpha = .10; ctx.fill();
    ctx.globalAlpha = 1; ctx.strokeStyle = p.lv; ctx.lineWidth = 2.4;
    ctx.lineJoin = 'round'; ctx.stroke();
    ctx.restore();

    /* corners */
    dot(X(cur.edv), Y(cur.edp), p.vol, 3.5, p);
    dot(X(cur.esv), Y(cur.esp), p.ao, 3.5, p);
    text('EDV ' + cur.edv.toFixed(0), X(cur.edv) + 8, Y(cur.edp) + 9, p.vol, 9.5, 700, 'left', true);
    text('ESV ' + cur.esv.toFixed(0), X(cur.esv) - 8, Y(cur.esp) - 9, p.ao, 9.5, 700, 'right', true);

    /* direction: which way round the loop runs, because it is not obvious and
       it is the difference between filling and ejecting */
    const aT = 0.62, ap = { v: cur.vAt(aT), p: cur.pAt(aT) };
    const bT = 0.64, bp = { v: cur.vAt(bT), p: cur.pAt(bT) };
    arrow(X(ap.v), Y(ap.p), X(bp.v), Y(bp.p), p.lv);

    /* live dot on the loop, at the same instant as everything else */
    dot(X(cur.vAt(S.t)), Y(cur.pAt(S.t)), p.cursor, 5, p);

    /* the numbers, which are the answer */
    const yy = B.b + 58;
    const cells = [
      ['EF', (cur.ef * 100).toFixed(0) + '%', cur.ef < base.ef - .01 ? p.ao : cur.ef > base.ef + .01 ? p.vol : p.ink],
      ['SV', cur.sv.toFixed(0) + ' mL', cur.sv < base.sv - .5 ? p.ao : cur.sv > base.sv + .5 ? p.vol : p.ink],
      ['ESP', cur.esp.toFixed(0), p.ink],
      ['EDP', cur.edp.toFixed(0), cur.edp > 15 ? p.ao : p.ink],
      ['Work', (cur.strokeWork / 1000).toFixed(1) + 'k', p.ink],
    ];
    const cw = (W - 28) / cells.length;
    cells.forEach((c, i) => {
      const x = 14 + cw * i + cw / 2;
      text(c[0], x, yy - 9, p.dim, 9, 600, 'center', true);
      text(c[1], x, yy + 6, c[2], 14, 800, 'center', true);
    });
  }
  function arrow(x0, y0, x1, y1, col) {
    const a = Math.atan2(y1 - y0, x1 - x0);
    ctx.save(); ctx.fillStyle = col; ctx.translate(x1, y1); ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, 4); ctx.lineTo(-4, -4); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /* ════════════════════ view: flow, and coronary flow ════════════════════ */
  function drawFlow(p) {
    const { L, R } = MARGINS.flow, TOP = 16, BOT = 44, gap = 22;
    const w = W - L - R;
    const hh = (H - TOP - BOT - gap) / 2;
    const Bq = box(L, TOP, w, hh);
    const Bc = box(L, TOP + hh + gap, w, hh);
    const sec = secs();
    /* physio.js's flows are per cycle and scaled by its length; a lesion's beat gives mL/s as it ran. */
    const Q = D(), drawn = Q === Ph;
    const aoF = drawn ? t => Ph.aorticFlow(t, sec) : Q.aorticFlow;
    const mvF = drawn ? t => Ph.mitralFlow(t, sec) : Q.mitralFlow;
    const corF = drawn ? Ph.coronaryFlow : Q.coronaryFlow;

    for (const B of [Bq, Bc]) { phaseBands(B, p); eventLines(B, p, 'L'); }

    /* The flow axis: physio.js's fixed 0 to 650, or as far as a lesion's flows reach, below zero where a valve
       leaks, since a regurgitant jet IS flow the wrong way. */
    let fMin = 0, fMax = 650;
    if (!drawn) {
      let lo = 0, hi = 0;
      for (let i = 0; i < 400; i++) { const t = i / 400; lo = Math.min(lo, aoF(t), mvF(t)); hi = Math.max(hi, aoF(t), mvF(t)); }
      fMin = lo < -20 ? Math.floor(lo / 200) * 200 : 0; fMax = Math.max(650, Math.ceil(hi / 200) * 200);
    }
    vaxis(Bq, fMin, fMax, 200, p, 'mL/s');
    if (fMin < 0) hline(Bq, yAt(Bq, 0, fMin, fMax), p.gridB, 1);
    trace(Bq, aoF, fMin, fMax, p.ao, 2.2, { fill: .13 });
    trace(Bq, mvF, fMin, fMax, p.vol, 2.2, { fill: .13 });
    text('Aortic', xAt(Bq, .24), Bq.y + 12, p.ao, 10.5, 700);
    text('Mitral', xAt(Bq, .60), Bq.y + 12, p.vol, 10.5, 700);
    if (fMin < 0) text('regurgitant', Bq.x + 4, Bq.b - 8, p.dim, 9.5, 600);
    /* E and A, marked where the model puts them rather than where a figure
       would. The ratio is the number that gets used at the bedside. */
    let E = 0, Et = 0, A = 0, At = 0;
    for (let i = 0; i < 900; i++) {
      const t = i / 900, q = mvF(t);
      if (t >= Q.T.mo && t < Math.max(Q.T.dias, Q.T.mo + 0.001) && q > E) { E = q; Et = t; }
      if (t < Q.T.mc && q > A) { A = q; At = t; }
    }
    if (E > 0) text('E', xAt(Bq, Et), yAt(Bq, E, fMin, fMax) - 10, p.vol, 11, 800, 'center', true);
    if (A > 0) text('A', xAt(Bq, At), yAt(Bq, A, fMin, fMax) - 10, p.vol, 11, 800, 'center', true);
    if (E > 0 && A > 0) text('E/A ' + (E / A).toFixed(1), Bq.r - 4, Bq.y + 12, p.muted, 10, 700, 'right', true);

    vaxis(Bc, 0, 1.4, 0.4, p, 'mL/s', 1);
    trace(Bc, t => corF(t, 'left'), 0, 1.4, p.cor, 2.3, { fill: .16 });
    trace(Bc, t => corF(t, 'right'), 0, 1.4, p.rv, 2.0, { dash: [5, 3] });
    text('Left coronary', xAt(Bc, .58), Bc.y + 12, p.cor, 10.5, 700);
    text('Right coronary', xAt(Bc, .16), Bc.y + 12, p.rv, 10.5, 700);

    /* Shade systole on the coronary panel: the point of the whole figure is
       that the left curve is almost flat inside the shading. */
    ctx.save();
    ctx.fillStyle = p.ink; ctx.globalAlpha = .05;
    ctx.fillRect(xAt(Bc, Q.T.mc), Bc.y, (Q.T.ac - Q.T.mc) * Bc.w, Bc.h);
    ctx.restore();
    text('systole', xAt(Bc, (Q.T.mc + Q.T.ac) / 2), Bc.b - 10, p.dim, 9.5, 600, 'center');

    const f = flowNow();
    text((f.leftDiastolicFraction * 100).toFixed(0) + '% of left coronary flow arrives in diastole',
         Bc.x, Bc.b + 16, p.muted, 10.5, 600);
    text('Peak aortic flow ' + f.peakAortic.toFixed(0) + ' mL/s',
         Bc.r, Bc.b + 16, p.dim, 10, 500, 'right');
    for (const B of [Bq, Bc]) cursor(B, p);
  }
  /* What the Flow view says in numbers, from the beat it draws: the share of left coronary flow outside systole
     (mitral closure to aortic closure), and the peak aortic flow. physio.js's own figures for its cycle. */
  function flowNow() {
    const Q = (S.cycle && S.view === 'flow') ? S.cycle : Ph;
    if (Q === Ph) { const d = Ph.derived(secs()); return { source: 'physio', leftDiastolicFraction: d.leftDiastolicFraction, peakAortic: Ph.extrema(t => Ph.aorticFlow(t, secs())).max }; }
    let all = 0, dia = 0, peak = 0;
    for (let i = 0; i < 800; i++) {
      const t = i / 800, c = Q.coronaryFlow(t, 'left');
      all += c; if (t < Q.T.mc || t >= Q.T.ac) dia += c;
      peak = Math.max(peak, Q.aorticFlow(t));
    }
    return { source: Q.preset, leftDiastolicFraction: all ? dia / all : 0, peakAortic: peak };
  }

  /* ════════════════════ view: the right heart ════════════════════════════ */
  function drawRight(p) {
    const { L, R } = MARGINS.right, TOP = 28, BOT = 56, gap = 22;
    const w = W - L - R;
    const hh = (H - TOP - BOT - gap) / 2;
    const Br = box(L, TOP, w, hh);
    const Bl = box(L, TOP + hh + gap, w, hh);
    const Q = D(), drawn = Q === Ph, r = rightNow();
    /* physio.js's fixed axes, or as far as a lesion's pressures reach. */
    const rHi = drawn ? 34 : Math.max(34, Math.ceil((r.max + 4) / 10) * 10), rStep = rHi > 60 ? 20 : 10;
    const lHi = drawn ? 130 : Math.max(130, Math.ceil(Q.max.p / 40) * 40);

    for (const B of [Br, Bl]) phaseBands(B, p);

    vaxis(Br, 0, rHi, rStep, p, 'mmHg');
    trace(Br, Q.raPressure, 0, rHi, p.ra, 1.9);
    trace(Br, Q.paPressure, 0, rHi, p.pa, 2.3);
    trace(Br, Q.rvPressure, 0, rHi, p.rv, 2.3);
    text('PA', xAt(Br, .60), yAt(Br, Q.paPressure(.60), 0, rHi) - 11, p.pa, 10.5, 700);
    text('RV', xAt(Br, .24), yAt(Br, Q.rvPressure(.24), 0, rHi) - 11, p.rv, 10.5, 700);
    text('RA / JVP', xAt(Br, .47), yAt(Br, Q.raPressure(.47), 0, rHi) - 10, p.ra, 10.5, 700);
    /* a, c and v named on the JVP — because this trace is what you are looking
       at in the neck, and naming the waves is how it becomes readable. A lesion's
       are found on its own trace (rightNow). */
    r.waves.filter(([, , up]) => up).forEach(([lab, at]) =>
      text(lab, xAt(Br, at), yAt(Br, Q.raPressure(at), 0, rHi) - 10, p.ra, 10, 800, 'center', true));
    r.waves.filter(([, , up]) => !up).forEach(([lab, at]) =>
      text(lab, xAt(Br, at), yAt(Br, Q.raPressure(at), 0, rHi) + 11, p.ra, 10, 800, 'center', true));

    vaxis(Bl, 0, lHi, 40, p, 'mmHg');
    trace(Bl, Q.aoPressure, 0, lHi, p.ao, 2.1);
    trace(Bl, Q.lvPressure, 0, lHi, p.lv, 2.1);
    text('the left side, to scale', Bl.r - 4, Bl.y + 12, p.dim, 10, 600, 'right');

    /* The splits, measured off the crossings rather than annotated. */
    ctx.save();
    let lastX = -99;
    for (const ev of Q.EVENTS) {
      if (!ev.sound) continue;
      const xx = xAt(Br, ev.at);
      const stack = xx - lastX < 18;
      lastX = xx;
      const col = ev.side === 'R' ? p.rv : p.lv;
      ctx.strokeStyle = col; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(xx, Br.y - (stack ? 12 : 4)); ctx.lineTo(xx, Br.y + 5); ctx.stroke();
      text(ev.note, xx, Br.y - (stack ? 18 : 10), col, 9.5, 800, 'center', true);
    }
    ctx.restore();

    for (const B of [Br, Bl]) cursor(B, p);
    /* S1's split is said for physio.js's cycle alone. In a lesion's beat the mitral valve shuts at a pressure
       crossing with no inertia to hold it open, so in a stiff ventricle it shuts at the end of the atrial kick
       (HFpEF: M1 129 ms before T1), which no stethoscope hears. S2's split is robust and is said for both. */
    if (drawn) text('S1 split  M1→T1  ' + r.s1Split.toFixed(0) + ' ms', L, Bl.b + 18, p.muted, 10.5, 600);
    text('S2 split  A2→P2  ' + r.s2Split.toFixed(0) + ' ms' + (r.s2Split < 0 ? '  (reversed: P2 first)' : ''), L, Bl.b + 34, p.muted, 10.5, 600);
    text('RV ' + r.rvSys.toFixed(0) + '/' + r.rvEdp.toFixed(0)
       + '   PA ' + r.paSys.toFixed(0) + '/' + r.paDia.toFixed(0)
       + '   RA mean ' + r.raMean.toFixed(0), W - 14, Bl.b + 18, p.dim, 10, 500, 'right', true);
    if (drawn) text('The right ventricle opens earlier and shuts later, because it has 10 mmHg to beat, not 80.',
         W - 14, Bl.b + 34, p.dim, 10, 500, 'right');
  }
  /* What the right-heart view says in numbers, from the beat it draws: the S1 and S2 splits in ms off the measured
     crossings (A2 to P2 negative where P2 comes first), RV and PA pressures, RA mean, and where the JVP's waves are.
     physio.js's own for its cycle; for a lesion, the a wave is the RA's highest point before the tricuspid shuts,
     the v its highest from pulmonic closure to tricuspid opening, the x descent its lowest between the two, the y
     its lowest after the tricuspid opens. */
  function rightNow() {
    const Q = (S.cycle && S.view === 'right') ? S.cycle : Ph;
    if (Q === Ph) {
      const d = Ph.derived(secs());
      return { source: 'physio', s1Split: d.s1Split, s2Split: d.s2Split, rvSys: d.rvSys, rvEdp: d.rvEdp, paSys: d.paSys, paDia: d.paDia, raMean: d.raMean, max: 34,
               waves: [['a', .058, true], ['c', .148, true], ['v', .448, true], ['x', .205, false], ['y', .545, false]] };
    }
    const ms = 1000 * Q.beat, N = 600, ts = [];
    for (let i = 0; i < N; i++) ts.push(i / N);
    const ext = (fn, lo, hi, big) => { let best = null; for (const t of ts) if (t >= lo && t < hi && (best === null || (big ? fn(t) > fn(best) : fn(t) < fn(best)))) best = t; return best; };
    const T = Q.T;
    let rvSys = -Infinity, paSys = -Infinity, paDia = Infinity, ra = 0, max = 0;
    for (const t of ts) {
      rvSys = Math.max(rvSys, Q.rvPressure(t)); paSys = Math.max(paSys, Q.paPressure(t)); paDia = Math.min(paDia, Q.paPressure(t));
      ra += Q.raPressure(t) / N; max = Math.max(max, Q.rvPressure(t), Q.paPressure(t), Q.raPressure(t));
    }
    const waves = [['a', ext(Q.raPressure, 0, T.tc, true), true], ['v', ext(Q.raPressure, T.pc, T.to, true), true],
                   ['x', ext(Q.raPressure, T.tc, T.pc, false), false], ['y', ext(Q.raPressure, T.to, 1, false), false]].filter(w => w[1] !== null);
    return { source: Q.preset, s1Split: (T.tc - T.mc) * ms, s2Split: (T.pc - T.ac) * ms, rvSys, rvEdp: Q.rvPressure(Q.rAt), paSys, paDia, raMean: ra, max, waves };
  }

  /* ════════════════════ view: Starling and Guyton ════════════════════════ */
  function drawCurves(p) {
    const L = 46, R = 16, TOP = 20, BOT = 52, gap = 46;
    const w = (W - L - R - gap) / 2;
    const hh = H - TOP - BOT;
    const A = box(L, TOP, w, hh);
    const Bx = box(L + w + gap, TOP, w, hh);

    /* Frank-Starling */
    const sHi = 150, eHi = 30;
    const SX = v => A.x + v / eHi * A.w, SY = v => A.b - v / sHi * A.h;
    grid(A, 5, 6, p, eHi, sHi, 6, 25);
    [['hyper', p.vol, 'Contractility ↑'], [null, p.lv, 'Normal'], ['failing', p.ao, 'Failing']].forEach(([st, col, lab]) => {
      ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let e = 0; e <= eHi; e += .4) { const v = Ph.starling(e, st); e ? ctx.lineTo(SX(e), SY(v)) : ctx.moveTo(SX(e), SY(v)); }
      ctx.stroke(); ctx.restore();
      const at = eHi * .82;
      text(lab, SX(at), SY(Ph.starling(at, st)) - 9, col, 10, 700, 'center');
    });
    text('Frank–Starling', A.x, A.y - 5, p.ink, 11.5, 800);
    text('LV end-diastolic pressure  mmHg', A.x + A.w / 2, A.b + 24, p.muted, 9.5, 600, 'center');
    ctx.save(); ctx.translate(A.x - 30, A.y + A.h / 2); ctx.rotate(-Math.PI / 2);
    text('Stroke volume  %', 0, 0, p.muted, 9.5, 600, 'center'); ctx.restore();

    /* Guyton */
    const raLo = -4, raHi = 16, coHi = 8;
    const GX = v => Bx.x + (v - raLo) / (raHi - raLo) * Bx.w, GY = v => Bx.b - v / coHi * Bx.h;
    grid(Bx, 4, 2, p, null, null, null, null, raLo, raHi, coHi);
    /* Venous return depends on the circulation, not on the heart — so there is
       one curve per filling state, however many hearts are drawn against it. */
    [[7, 'venous return'], [14, '+ volume']].forEach(([msfp, lab]) => {
      ctx.save(); ctx.strokeStyle = p.muted; ctx.lineWidth = 1.8;
      ctx.setLineDash([5, 4]); ctx.globalAlpha = .75;
      ctx.beginPath();
      for (let r = raLo; r <= raHi; r += .3) { const v = Ph.venousReturn(r, msfp); r === raLo ? ctx.moveTo(GX(r), GY(v)) : ctx.lineTo(GX(r), GY(v)); }
      ctx.stroke(); ctx.restore();
      text(lab, GX(msfp) - 4, GY(0) - 12, p.muted, 9, 700, 'right');
    });
    const pairs = [
      [null,      7,  p.lv, 'normal'],
      ['failing', 7,  p.ao, 'failure'],
      ['failing', 14, p.pa, '+ volume'],
    ];
    pairs.forEach(([st, msfp, col, lab]) => {
      if (st !== 'failing' || msfp === 7) {
        ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 2.2;
        ctx.beginPath();
        for (let r = raLo; r <= raHi; r += .3) { const v = Ph.cardiacFunction(r, st); r === raLo ? ctx.moveTo(GX(r), GY(v)) : ctx.lineTo(GX(r), GY(v)); }
        ctx.stroke(); ctx.restore();
      }
      /* Where they cross is the operating point, and the only honest way to
         mark it is to solve for it. */
      let lo = raLo, hi = raHi;
      for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; (Ph.cardiacFunction(m, st) - Ph.venousReturn(m, msfp) < 0) ? lo = m : hi = m; }
      const ra = (lo + hi) / 2, co = Ph.venousReturn(ra, msfp);
      dot(GX(ra), GY(co), col, 4.5, p);
      text(lab + '  ' + co.toFixed(1), GX(ra) + 9, GY(co) - 9, col, 9.5, 700, 'left');
    });
    text('Guyton', Bx.x, Bx.y - 5, p.ink, 11.5, 800);
    text('Right atrial pressure  mmHg', Bx.x + Bx.w / 2, Bx.b + 24, p.muted, 9.5, 600, 'center');
    ctx.save(); ctx.translate(Bx.x - 30, Bx.y + Bx.h / 2); ctx.rotate(-Math.PI / 2);
    text('L/min', 0, 0, p.muted, 9.5, 600, 'center'); ctx.restore();
    text('Solid: what the heart can pump.  Dashed: what the circulation returns.  Output is where they cross — so the heart alone never sets it.',
         L, H - 14, p.dim, 10, 500);
  }
  function grid(B, nx, ny, p, xHi, yHi, xStep, yStep, xLo, xHi2, yHi2) {
    ctx.save(); ctx.strokeStyle = p.grid; ctx.lineWidth = 1;
    for (let i = 0; i <= nx; i++) { const x = Math.round(B.x + B.w * i / nx) + .5; ctx.beginPath(); ctx.moveTo(x, B.y); ctx.lineTo(x, B.b); ctx.stroke(); }
    for (let i = 0; i <= ny; i++) { const y = Math.round(B.y + B.h * i / ny) + .5; ctx.beginPath(); ctx.moveTo(B.x, y); ctx.lineTo(B.r, y); ctx.stroke(); }
    ctx.restore();
    if (xHi != null) {
      for (let v = 0; v <= xHi; v += xStep) text(String(v), B.x + v / xHi * B.w, B.b + 12, p.dim, 9, 500, 'center', true);
      for (let v = 0; v <= yHi; v += yStep) text(String(v), B.x - 6, B.b - v / yHi * B.h, p.dim, 9, 500, 'right', true);
    } else if (xLo != null) {
      for (let v = xLo; v <= xHi2; v += 4) text(String(v), B.x + (v - xLo) / (xHi2 - xLo) * B.w, B.b + 12, p.dim, 9, 500, 'center', true);
      for (let v = 0; v <= yHi2; v += 2) text(String(v), B.x - 6, B.b - v / yHi2 * B.h, p.dim, 9, 500, 'right', true);
    }
  }

  /* ════════════════════ view: conduction ═══════════════════════════════════
     A schematic, not the 3D heart's own mesh: heart3d.js already draws the
     real depolarisation front over real anatomy (chain step heroart's
     conduction mode). This is not that a second time. It is a flat diagram
     of the same real firing sequence, for a panel where Wiggers already
     lives and a WebGL context does not need to.

     "REAL NUMBERS, NOT PHYSIO'S" — the file header flags this as the one
     exception, and here is why it still holds the module's own rule.
     Heart3D.activationAt(x,y,z) is real 3D distance math already shipped in
     src/core/heart3d.js — genuinely what the heart itself is drawn from —
     and these four points are Heart3D.activationAt sampled at its own
     anatomy reference coordinates (Heart3D.anatomy.la.c, .ra.c, .lv.apex,
     .lv.base), captured once rather than called live: wiggers.js does not
     import heart3d.js, and a live cross-module call would mean this panel's
     correctness now depends on Heart3D's WebGL machinery even when nothing
     here needs a GPU. The same four numbers are what
     tests/verify-conductionwave-pure.js already holds ConductionWave.js to.

     WHY ONLY FOUR POINTS, NOT SIX. LA/RA share one value (6ms — the model
     does not distinguish which atrium at that resolution), and RV base
     (32.34ms) and RV apex (162.36ms) are left out rather than invented a
     label for. RV base sits inside activationAt's atrial-adjacency
     threshold, and a schematic that plotted it beside "Atria" WOULD be a
     mistake: that is a model artefact, not anatomy. The atrioventricular
     junction is electrically insulated, the AV node is the only path, and
     the ventricular base depolarises last — ventricular muscle firing with
     the atria is pre-excitation. (An earlier version of this comment called
     it "the real anatomy it is"; conductionWave.js's header now says why
     that was backwards.) Leaving it out is right, for that reason.

     What this diagram also does not show, and a board question would ask
     about: the AV node, His bundle, bundle branches and Purkinje network —
     the ~150ms between "Atria" and "LV apex" below is the AV nodal delay
     plus His-Purkinje conduction, i.e. most of the PR interval — and the
     left mid-septum, which is the FIRST ventricular muscle to depolarise
     (hence septal q waves), ahead of the apex. So "the real firing order"
     here is the order of these four points, not of conduction as a whole. */
  const CONDUCTION_POINTS = [
    { label: 'SA node',    ms: 0 },
    { label: 'Atria',      ms: 6 },
    { label: 'LV apex',    ms: 155.55 },
    { label: 'LV base',    ms: 207.7 },
  ];
  function drawConduction(p) {
    /* Looked up here, not captured once at mount() time the way Ph is: every
       other view needs Physio or nothing draws, but conductionWave.js is
       used by exactly this one view, so the other five must not go dark for
       want of a module that has nothing to do with them. */
    const CW = root.ConductionWave;
    if (!CW) {
      text('Conduction view needs conductionWave.js loaded first.', 16, H / 2, p.dim, 11, 500);
      return;
    }
    const L = 54, R = 54, TOP = 28, BOT = 34;
    const B = box(L, TOP, W - L - R, H - TOP - BOT);
    const elapsedMs = S.t * secs() * 1000;
    const fired = new Set(CW.firedBy(CONDUCTION_POINTS, elapsedMs));
    const next = CW.nextToFire(CONDUCTION_POINTS, elapsedMs);

    text('Conduction', B.x, TOP - 12, p.ink, 11.5, 800);
    text('the real firing order, not a drawing of one', B.r, TOP - 12, p.dim, 9.5, 500, 'right');

    const n = CONDUCTION_POINTS.length;
    const stepY = B.h / (n - 1);
    const xOf = i => B.x + B.w / 2 + (i % 2 === 0 ? -1 : 1) * B.w * 0.22;
    const yOf = i => B.y + i * stepY;

    /* The connecting line between two points is only ever lit once BOTH
       ends have fired — a half-lit line would claim the wave is somewhere
       it has not measurably reached yet. */
    for (let i = 1; i < n; i++) {
      const a = CONDUCTION_POINTS[i - 1], b = CONDUCTION_POINTS[i];
      const lit = fired.has(a.label) && fired.has(b.label);
      ctx.save();
      ctx.strokeStyle = lit ? p.cursor : p.grid;
      ctx.lineWidth = lit ? 2.4 : 1.4;
      ctx.beginPath();
      ctx.moveTo(xOf(i - 1), yOf(i - 1));
      ctx.lineTo(xOf(i), yOf(i));
      ctx.stroke();
      ctx.restore();
    }

    CONDUCTION_POINTS.forEach((pt, i) => {
      const x = xOf(i), y = yOf(i);
      const isFired = fired.has(pt.label);
      const isNext = pt.label === next;
      if (isNext) {
        /* A ring around what fires next — not animated (nothing here
           depends on a timer beyond the shared cycle clock every other
           view already reads S.t from), just a fixed visual difference
           between "about to" and "already has". */
        ctx.save();
        ctx.strokeStyle = p.cursor; ctx.globalAlpha = .5; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.stroke();
        ctx.restore();
      }
      dot(x, y, isFired ? p.cursor : p.dim, isFired ? 5.5 : 4, p);
      text(pt.label + '  ' + pt.ms + 'ms', x + (i % 2 === 0 ? -14 : 14), y,
           isFired ? p.ink : p.muted, 10.5, isFired ? 700 : 500, i % 2 === 0 ? 'right' : 'left');
    });

    text('SA → atria is the P wave. Atria → LV apex is the AV node and His–Purkinje system — the pause that makes the PR interval a pause and not a delay you can see happening.',
         B.x, H - 14, p.dim, 10, 500);
  }

  /* ════════════════════ view: coronary ══════════════════════════════════════
     Two vessel trees that glow with the flow Physio.coronaryFlow gives for this
     instant, over the same two flow traces the Flow view draws. The point is
     one board fact made visible: the left ventricle compresses its own
     arteries in systole, so left coronary flow arrives in diastole — and the
     right, perfusing a thin low-pressure ventricle, keeps flowing through it.

     BOTH TREES SHARE ONE SCALE. Normalising each side to its own range would
     make the right coronary's small swing look as dramatic as the left's
     collapse, which teaches the opposite of the physiology. So brightness is
     flow over the larger of the two peaks, and the right tree's steadiness is
     what the eye sees.

     The branching is coronaryTree.js's, and its own header says it is not
     anatomy: a vessel-like structure for the pulse to travel across. It is
     looked up here, not captured at mount(), for the reason drawConduction
     gives — six other views must not go dark for want of it. */
  /* The normal heart's coronary peak: the reference beat's, or physio.js's; worked out once for each. */
  const corPeaks = new Map();
  function coronaryPeak() {
    const key = S.ref || Ph;
    if (corPeaks.has(key)) return corPeaks.get(key);
    const f = S.ref ? S.ref.coronaryFlow : Ph.coronaryFlow;
    let m = 0;
    for (let i = 0; i < 400; i++) {
      const t = i / 400;
      m = Math.max(m, f(t, 'left'), f(t, 'right'));
    }
    corPeaks.set(key, m);
    return m;
  }
  /* What the Coronary view says in numbers, from the beat it draws: the share of left coronary flow in diastole,
     the mean left coronary flow, and the peak of either; physio.js's own share for its cycle. */
  function coronaryNow() {
    const Q = (S.cycle && S.view === 'coronary') ? S.cycle : Ph;
    const cor = Q === Ph ? Ph.coronaryFlow : Q.coronaryFlow;
    let all = 0, dia = 0, peak = 0;
    for (let i = 0; i < 800; i++) {
      const t = i / 800, l = cor(t, 'left');
      all += l; if (t < Q.T.mc || t >= Q.T.ac) dia += l;
      peak = Math.max(peak, l, cor(t, 'right'));
    }
    return { source: Q === Ph ? 'physio' : Q.preset, leftDiastolicFraction: Q === Ph ? Ph.derived(secs()).leftDiastolicFraction : (all ? dia / all : 0), leftMean: all / 800, peak };
  }
  function drawCoronary(p) {
    const CT = root.CoronaryTree;
    if (!CT) {
      text('Coronary view needs coronaryTree.js loaded first.', 16, H / 2, p.dim, 11, 500);
      return;
    }
    const { L, R } = MARGINS.coronary;
    const TOP = 28, stripH = Math.max(70, Math.min(120, H * 0.26)), BOT = 34;
    const Bs = box(L, H - BOT - stripH, W - L - R, stripH);
    const Bt = box(L, TOP + 8, W - L - R, Bs.y - TOP - 30);
    /* A lesion's coronaries, on a scale that holds the normal heart's peak too, so a starved bed reads dimmer. */
    const Q = D(), cor = Q === Ph ? Ph.coronaryFlow : Q.coronaryFlow, c = coronaryNow();
    const peak = Q === Ph ? coronaryPeak() : Math.max(coronaryPeak(), c.peak);

    text('Coronary flow', L, TOP - 12, p.ink, 11.5, 800);
    text('brightness is the flow at this instant, on one scale for both', W - R, TOP - 12, p.dim, 9.5, 500, 'right');

    const sides = [
      { side: 'left',  label: 'Left coronary',  col: p.cor, cx: Bt.x + Bt.w * 0.27 },
      { side: 'right', label: 'Right coronary', col: p.rv,  cx: Bt.x + Bt.w * 0.73 },
    ];
    for (const sd of sides) {
      const I = CT.intensity(cor(S.t, sd.side), 0, peak);
      const segs = CT.tree({ x: sd.cx, y: Bt.b - 18, angle: -Math.PI / 2,
                             length: Bt.h * 0.26, maxDepth: 5, spread: 0.42 });
      ctx.save();
      ctx.beginPath(); ctx.rect(Bt.x, Bt.y, Bt.w, Bt.h); ctx.clip();
      ctx.lineCap = 'round'; ctx.strokeStyle = sd.col;
      ctx.shadowColor = sd.col; ctx.shadowBlur = 14 * I;
      for (const g of segs) {
        ctx.globalAlpha = 0.16 + 0.84 * I;
        ctx.lineWidth = Math.max(0.9, 4.4 - g.depth * 0.7);
        ctx.beginPath(); ctx.moveTo(g.x1, g.y1); ctx.lineTo(g.x2, g.y2); ctx.stroke();
      }
      ctx.restore();
      text(sd.label, sd.cx, Bt.b - 4, sd.col, 10.5, 700, 'center');
      text(Math.round(I * 100) + '% of peak', sd.cx, Bt.b + 10, p.muted, 9.5, 600, 'center', true);
    }

    /* The same traces the Flow view draws, on the same scale as the glow. */
    ctx.save();
    ctx.fillStyle = p.ink; ctx.globalAlpha = .05;
    ctx.fillRect(xAt(Bs, Q.T.mc), Bs.y, (Q.T.ac - Q.T.mc) * Bs.w, Bs.h);
    ctx.restore();
    text('systole', xAt(Bs, (Q.T.mc + Q.T.ac) / 2), Bs.b - 9, p.dim, 9.5, 600, 'center');
    trace(Bs, t => cor(t, 'left'), 0, peak, p.cor, 2.2, { fill: .14 });
    trace(Bs, t => cor(t, 'right'), 0, peak, p.rv, 1.9, { dash: [5, 3] });
    cursor(Bs, p);

    text((c.leftDiastolicFraction * 100).toFixed(0) + '% of left coronary flow arrives in diastole. ' +
         'A faster rate shortens diastole, and with it the left ventricle\'s perfusion time.',
         L, H - 14, p.dim, 10, 500);
  }

  /* ── draw ─────────────────────────────────────────────────────────────── */
  let painted = false;
  function draw() {
    if (!fit()) return;
    painted = true;
    const p = palette();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = p.paper; ctx.fillRect(0, 0, W, H);
    S.zones = [];
    if (S.view === 'pv') drawPV(p);
    else if (S.view === 'flow') drawFlow(p);
    else if (S.view === 'right') drawRight(p);
    else if (S.view === 'curves') drawCurves(p);
    else if (S.view === 'conduction') drawConduction(p);
    else if (S.view === 'coronary') drawCoronary(p);
    else drawWiggers(p);
  }

  /* A DIAGRAM THAT IS NOT MOVING IS NOT REDRAWN. This drew on every frame whatever the state, and a Wiggers view costs about three milliseconds
     a draw (Chromium, headless; WebKit about the same): paused, or on the Curves view, which has no time in it, that was a sixth of a core
     spent putting the same picture on the canvas sixty times a second. What can change the picture between two frames is the model's time and
     the size of the canvas. Everything else (a view, a theme, a rate, an intervention, a scrub) draws where it is set, as it did before, so
     the loop only has to notice these two. A canvas that has not been drawn yet, because it had no size when this mounted, counts as resized. */
  function resized() {
    if (!painted) return true;
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const dpr = Math.min(root.devicePixelRatio || 1, 3);
    return canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr);
  }

  /* NOT DRAWN WHERE IT CANNOT BE SEEN (roadmap E5). On the Lab at iPad size the diagram sits below the fold, and it drew every frame
     there, a Wiggers view at about three milliseconds a draw, sixty times a second, for a canvas nobody had scrolled to
     (tests/verify-frames.js, counted by src/core/framemeter.js). Out of view, the loop keeps its clock, so the beat is where it
     should be when the canvas comes back, and draws nothing, nor calls onFrame, whose caption is out of view with it. A browser
     without IntersectionObserver keeps drawing, as before. */
  let inView = true, seen = null;
  if (typeof root.IntersectionObserver === 'function') {
    seen = new root.IntersectionObserver(es => { for (const e of es) inView = e.isIntersecting; });
    seen.observe(canvas);
  }

  function tick(now) {
    S.raf = root.requestAnimationFrame(tick);
    if (!S.last) S.last = now;
    const dt = Math.min(now - S.last, 100) / 1000;
    S.last = now;
    let moved = false;
    if (S.src && !S.scrub) {
      const t = S.src();
      if (t != null && t >= 0) { S.t = Ph.wrap(t); moved = true; }
    } else if (S.playing && !S.scrub && S.view !== 'curves') {
      S.t = Ph.wrap(S.t + dt / (secs() * (S.slow || 1)));
      moved = true;
    }
    if (!inView) return;
    if (!moved && !resized()) return;
    draw();
    if (S.onFrame) S.onFrame(S.t);
  }

  const api = {
    draw,
    view: () => S.view,
    setView(v) { S.view = v; draw(); return api; },
    setDark(d) { S.dark = !!d; draw(); return api; },
    setRate(hr) { S.hr = hr || 75; rOffset = null; draw(); return api; },
    setSlow(n) { S.slow = n > 0 ? n : 1; return api; },
    slow: () => S.slow,
    setTime(t) { S.t = Ph.wrap(t); draw(); return api; },
    time: () => S.t,
    setIntervention(id) { S.iv = id; draw(); return api; },
    /* The beat the views draw (a Circulation.cycle(), or null for physio.js), the normal beat it is measured
       against (the engine's, or null for physio.js's), and the phase the drawn beat is in now. */
    setCycle(c, ref) { S.cycle = c || null; S.ref = ref || null; rOffset = null; draw(); return api; },
    cycle: () => S.cycle,
    reference: () => S.ref,
    phaseNow: () => D().phaseAt(S.t),
    loopNow,
    flowNow,
    rightNow,
    coronaryNow,
    intervention: () => S.iv,
    play() { S.playing = true; S.last = 0; return api; },
    pause() { S.playing = false; return api; },
    playing: () => S.playing,
    /* Scrub the diagram by dragging on it. The cursor is the model's time, so
       dragging it moves the heart too if the caller has wired them together. */
    scrubAt(x, y) {
      if (S.view === 'curves' || S.view === 'pv') return null;
      const { L, R } = MARGINS[S.view] || MARGINS.wiggers;
      const t = clamp((x - L) / Math.max(1, W - L - R), 0, 0.9999);
      S.t = t; draw();
      return t;
    },
    phaseAt(x, y) {
      for (const z of S.zones) if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return z.phase;
      return null;
    },
    setScrub(on) { S.scrub = !!on; if (!on) S.last = 0; return api; },
    setTimeSource(fn) { S.src = fn || null; S.last = 0; return api; },
    hasTimeSource: () => !!S.src,
    start() { if (!S.raf) { S.last = 0; S.raf = root.requestAnimationFrame(tick); } return api; },
    stop() { if (S.raf) { root.cancelAnimationFrame(S.raf); S.raf = 0; } return api; },
    /* Stop, and let go of everything that would keep the canvas alive. The
       diagram is now the only animation on the panel, so a loop left running
       against a detached canvas is a whole frame budget spent drawing into
       nothing — and it never stops on its own, because requestAnimationFrame
       does not care whether its target is still in the document. */
    destroy() {
      if (S.raf) { root.cancelAnimationFrame(S.raf); S.raf = 0; }
      if (seen) { seen.disconnect(); seen = null; }
      S.onFrame = null; S.src = null;
      canvas.onpointerdown = canvas.onpointermove = canvas.onpointerup = canvas.onpointercancel = null;
      return null;
    },
    VIEWS,
  };
  draw();
  api.start();
  return api;
}

root.Wiggers = { mount, VIEWS };

})(typeof window !== 'undefined' ? window : this);
