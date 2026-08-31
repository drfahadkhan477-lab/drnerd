/* ═══════════════════════════════════════════════════════════════════════════
   wiggers.js — draws what physio.js computes.

   Five views over one model, and one clock behind all of them:

     Wiggers   the classic stacked diagram — ECG, pressures, volume, phases
     PV loop   pressure against volume, with the ESPVR and EDPVR that explain it
     Flow      aortic and mitral flow, then coronary flow, which is the payoff
     Right     the right heart against the left, which is where S1 and S2 split
     Curves    Frank-Starling, and Guyton's two curves and their intersection

   Nothing here is drawn from memory of a textbook figure. Every point is
   Physio evaluated at a cycle fraction, so if the physiology is edited the
   picture changes with it, and the cursor on the diagram is the same instant
   as the beating heart beside it.

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
    t: 0,
    playing: opts.playing !== false,
    iv: 'base',
    scrub: false,
    raf: 0,
    last: 0,
    /* When set, this returns the cycle fraction and the diagram stops
       integrating its own. That is how the cursor becomes the same instant as
       the beating heart beside it rather than a second animation that agrees
       with it only until one of them drops a frame. */
    src: opts.timeSource || null,
    /* Called once a frame with the cycle fraction just drawn. The phase caption
       used to be repainted by whatever else was animating alongside the
       diagram; now that the diagram is the only thing on the panel, it has to
       announce its own time. */
    onFrame: typeof opts.onFrame === 'function' ? opts.onFrame : null,
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
  function phaseBands(B, p) {
    for (const ph of Ph.PHASES) {
      const i = Ph.PHASES.indexOf(ph);
      if (i % 2) continue;
      ctx.fillStyle = p.band;
      ctx.fillRect(xAt(B, ph.from), B.y, (ph.to - ph.from) * B.w, B.h);
    }
  }
  function eventLines(B, p, side) {
    ctx.save(); ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
    for (const ev of Ph.EVENTS) {
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
    const ms = (Ph.wrap(t - 0.075) * rr) + rOffset + rr * 8;
    return L.sample('II', ms, 'sinus', S.hr);
  }

  /* ════════════════════ view: the Wiggers diagram ════════════════════════ */
  function drawWiggers(p) {
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
    vaxis(Bp, 0, 130, 20, p, 'mmHg');
    trace(Bp, Ph.laPressure, 0, 130, p.la, 1.9);
    trace(Bp, Ph.aoPressure, 0, 130, p.ao, 2.4);
    trace(Bp, Ph.lvPressure, 0, 130, p.lv, 2.4);
    /* Shade the gradient that drives ejection: the only interval in the cycle
       when the ventricle is pushing blood into the aorta rather than at it. */
    ctx.save();
    ctx.beginPath();
    const n = 90;
    for (let i = 0; i <= n; i++) { const t = Ph.T.ao + (Ph.T.ac - Ph.T.ao) * i / n; ctx.lineTo(xAt(Bp, t), yAt(Bp, Ph.lvPressure(t), 0, 130)); }
    for (let i = n; i >= 0; i--) { const t = Ph.T.ao + (Ph.T.ac - Ph.T.ao) * i / n; ctx.lineTo(xAt(Bp, t), yAt(Bp, Ph.aoPressure(t), 0, 130)); }
    ctx.closePath(); ctx.fillStyle = p.lv; ctx.globalAlpha = .10; ctx.fill();
    ctx.restore();

    text('Aorta', xAt(Bp, .60), yAt(Bp, Ph.aoPressure(.60), 0, 130) - 11, p.ao, 10.5, 700);
    text('LV', xAt(Bp, .22), yAt(Bp, Ph.lvPressure(.22), 0, 130) - 11, p.lv, 10.5, 700);
    text('LA', xAt(Bp, .47), yAt(Bp, Ph.laPressure(.47), 0, 130) - 10, p.la, 10.5, 700);

    /* volume */
    vaxis(Bv, 40, 130, 30, p, 'mL');
    trace(Bv, Ph.lvVolume, 40, 130, p.vol, 2.4, { fill: .10 });
    text('LV volume', xAt(Bv, .70), yAt(Bv, Ph.lvVolume(.70), 40, 130) - 11, p.vol, 10.5, 700);
    /* Stroke volume, named on the axis it is measured from. */
    ctx.save();
    ctx.strokeStyle = p.vol; ctx.globalAlpha = .55; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    for (const v of [Ph.EDV, Ph.ESV]) {
      const yy = Math.round(yAt(Bv, v, 40, 130)) + .5;
      ctx.beginPath(); ctx.moveTo(Bv.x, yy); ctx.lineTo(Bv.r, yy); ctx.stroke();
    }
    ctx.restore();
    const yEdv = yAt(Bv, Ph.EDV, 40, 130), yEsv = yAt(Bv, Ph.ESV, 40, 130);
    ctx.save();
    ctx.strokeStyle = p.vol; ctx.lineWidth = 1.2;
    const ax = Bv.r - 26;
    ctx.beginPath(); ctx.moveTo(ax, yEdv); ctx.lineTo(ax, yEsv); ctx.stroke();
    ctx.restore();
    text('SV 70', Bv.r - 22, (yEdv + yEsv) / 2, p.vol, 9.5, 700, 'left', true);

    /* ECG */
    vaxis(Becg, -0.6, 1.6, 100, p, '');
    trace(Becg, ecgAt, -0.6, 1.6, p.ink, 1.7);
    text('ECG II', Becg.x + 4, Becg.y + 9, p.dim, 9.5, 700, 'left', true);

    /* heart sounds, on the events that make them */
    let lastSx = -99;
    for (const ev of Ph.EVENTS) {
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
    const cur = Ph.phaseAt(S.t);
    for (const ph of Ph.PHASES) {
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
    for (const ev of Ph.EVENTS) {
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
    const s = Ph.sample(S.t);
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
    const iv = Ph.INTERVENTIONS.find(i => i.id === S.iv) || Ph.INTERVENTIONS[0];
    const cur = Ph.loopWith(iv.args);
    const base = Ph.loopWith();
    const vLo = 0, vHi = 220, pLo = 0, pHi = 170;

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
      const q = Ph.espvr(v, cur.ees, cur.v0);
      if (q > pHi) break;
      started ? ctx.lineTo(X(v), Y(q)) : (ctx.moveTo(X(v), Y(q)), started = true);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = p.vol; ctx.globalAlpha = .8;
    ctx.beginPath();
    for (let v = 20; v <= vHi; v += 3) {
      const q = Ph.edpvr(v, cur.stiff, cur.shift);
      if (q > 72) break;
      ctx.lineTo(X(v), Y(q));
    }
    ctx.stroke();
    /* arterial elastance: the line from EDV whose slope IS the afterload */
    ctx.strokeStyle = p.muted; ctx.globalAlpha = .5; ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(X(cur.edv), Y(0)); ctx.lineTo(X(cur.esv), Y(cur.esp)); ctx.stroke();
    ctx.restore();
    let esX = vHi, esY = Ph.espvr(vHi, cur.ees, cur.v0);
    if (esY > pHi) { esY = pHi; esX = cur.v0 + pHi / cur.ees; }
    text('ESPVR', clamp(X(esX) - 6, B.x + 44, B.r - 6),
         clamp(Y(esY) + (esY >= pHi ? 11 : -11), B.y + 8, B.b - 8), p.ao, 9.5, 700, 'right', true);
    let edEnd = vHi;
    for (let v = 20; v <= vHi; v += 2) if (Ph.edpvr(v, cur.stiff, cur.shift) > 72) { edEnd = v; break; }
    text('EDPVR', clamp(X(edEnd) + 6, B.x, B.r - 44), Y(70) + 2, p.vol, 9.5, 700, 'left', true);
    text('Ea', (X(cur.edv) + X(cur.esv)) / 2 + 14, (Y(0) + Y(cur.esp)) / 2 + 8, p.muted, 9.5, 700, 'left', true);

    /* the resting loop as a ghost, whenever we have moved off it */
    if (S.iv !== 'base') {
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

    for (const B of [Bq, Bc]) { phaseBands(B, p); eventLines(B, p, 'L'); }

    vaxis(Bq, 0, 650, 200, p, 'mL/s');
    trace(Bq, t => Ph.aorticFlow(t, sec), 0, 650, p.ao, 2.2, { fill: .13 });
    trace(Bq, t => Ph.mitralFlow(t, sec), 0, 650, p.vol, 2.2, { fill: .13 });
    text('Aortic', xAt(Bq, .24), Bq.y + 12, p.ao, 10.5, 700);
    text('Mitral', xAt(Bq, .60), Bq.y + 12, p.vol, 10.5, 700);
    /* E and A, marked where the model puts them rather than where a figure
       would. The ratio is the number that gets used at the bedside. */
    let E = 0, Et = 0, A = 0, At = 0;
    for (let i = 0; i < 900; i++) {
      const t = i / 900, q = Ph.mitralFlow(t, sec);
      if (t >= Ph.T.mo && t < Ph.T.dias && q > E) { E = q; Et = t; }
      if (t < Ph.T.mc && q > A) { A = q; At = t; }
    }
    text('E', xAt(Bq, Et), yAt(Bq, E, 0, 650) - 10, p.vol, 11, 800, 'center', true);
    text('A', xAt(Bq, At), yAt(Bq, A, 0, 650) - 10, p.vol, 11, 800, 'center', true);
    text('E/A ' + (E / A).toFixed(1), Bq.r - 4, Bq.y + 12, p.muted, 10, 700, 'right', true);

    vaxis(Bc, 0, 1.4, 0.4, p, 'mL/s', 1);
    trace(Bc, t => Ph.coronaryFlow(t, 'left'), 0, 1.4, p.cor, 2.3, { fill: .16 });
    trace(Bc, t => Ph.coronaryFlow(t, 'right'), 0, 1.4, p.rv, 2.0, { dash: [5, 3] });
    text('Left coronary', xAt(Bc, .58), Bc.y + 12, p.cor, 10.5, 700);
    text('Right coronary', xAt(Bc, .16), Bc.y + 12, p.rv, 10.5, 700);

    /* Shade systole on the coronary panel: the point of the whole figure is
       that the left curve is almost flat inside the shading. */
    ctx.save();
    ctx.fillStyle = p.ink; ctx.globalAlpha = .05;
    ctx.fillRect(xAt(Bc, Ph.T.mc), Bc.y, (Ph.T.ac - Ph.T.mc) * Bc.w, Bc.h);
    ctx.restore();
    text('systole', xAt(Bc, (Ph.T.mc + Ph.T.ac) / 2), Bc.b - 10, p.dim, 9.5, 600, 'center');

    const d = Ph.derived(sec);
    text((d.leftDiastolicFraction * 100).toFixed(0) + '% of left coronary flow arrives in diastole',
         Bc.x, Bc.b + 16, p.muted, 10.5, 600);
    text('Peak aortic flow ' + Ph.extrema(t => Ph.aorticFlow(t, sec)).max.toFixed(0) + ' mL/s',
         Bc.r, Bc.b + 16, p.dim, 10, 500, 'right');
    for (const B of [Bq, Bc]) cursor(B, p);
  }

  /* ════════════════════ view: the right heart ════════════════════════════ */
  function drawRight(p) {
    const { L, R } = MARGINS.right, TOP = 28, BOT = 56, gap = 22;
    const w = W - L - R;
    const hh = (H - TOP - BOT - gap) / 2;
    const Br = box(L, TOP, w, hh);
    const Bl = box(L, TOP + hh + gap, w, hh);

    for (const B of [Br, Bl]) phaseBands(B, p);

    vaxis(Br, 0, 34, 10, p, 'mmHg');
    trace(Br, Ph.raPressure, 0, 34, p.ra, 1.9);
    trace(Br, Ph.paPressure, 0, 34, p.pa, 2.3);
    trace(Br, Ph.rvPressure, 0, 34, p.rv, 2.3);
    text('PA', xAt(Br, .60), yAt(Br, Ph.paPressure(.60), 0, 34) - 11, p.pa, 10.5, 700);
    text('RV', xAt(Br, .24), yAt(Br, Ph.rvPressure(.24), 0, 34) - 11, p.rv, 10.5, 700);
    text('RA / JVP', xAt(Br, .47), yAt(Br, Ph.raPressure(.47), 0, 34) - 10, p.ra, 10.5, 700);
    /* a, c and v named on the JVP — because this trace is what you are looking
       at in the neck, and naming the waves is how it becomes readable. */
    [['a', .058], ['c', .148], ['v', .448]].forEach(([lab, at]) =>
      text(lab, xAt(Br, at), yAt(Br, Ph.raPressure(at), 0, 34) - 10, p.ra, 10, 800, 'center', true));
    [['x', .205], ['y', .545]].forEach(([lab, at]) =>
      text(lab, xAt(Br, at), yAt(Br, Ph.raPressure(at), 0, 34) + 11, p.ra, 10, 800, 'center', true));

    vaxis(Bl, 0, 130, 40, p, 'mmHg');
    trace(Bl, Ph.aoPressure, 0, 130, p.ao, 2.1);
    trace(Bl, Ph.lvPressure, 0, 130, p.lv, 2.1);
    text('the left side, to scale', Bl.r - 4, Bl.y + 12, p.dim, 10, 600, 'right');

    /* The splits, measured off the crossings rather than annotated. */
    const d = Ph.derived(secs());
    const x = d.crossings;
    ctx.save();
    let lastX = -99;
    for (const ev of Ph.EVENTS) {
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
    text('S1 split  M1→T1  ' + d.s1Split.toFixed(0) + ' ms', L, Bl.b + 18, p.muted, 10.5, 600);
    text('S2 split  A2→P2  ' + d.s2Split.toFixed(0) + ' ms', L, Bl.b + 34, p.muted, 10.5, 600);
    text('RV ' + d.rvSys.toFixed(0) + '/' + d.rvEdp.toFixed(0)
       + '   PA ' + d.paSys.toFixed(0) + '/' + d.paDia.toFixed(0)
       + '   RA mean ' + d.raMean.toFixed(0), W - 14, Bl.b + 18, p.dim, 10, 500, 'right', true);
    text('The right ventricle opens earlier and shuts later, because it has 10 mmHg to beat, not 80.',
         W - 14, Bl.b + 34, p.dim, 10, 500, 'right');
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

  /* ── draw ─────────────────────────────────────────────────────────────── */
  function draw() {
    if (!fit()) return;
    const p = palette();
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = p.paper; ctx.fillRect(0, 0, W, H);
    S.zones = [];
    if (S.view === 'pv') drawPV(p);
    else if (S.view === 'flow') drawFlow(p);
    else if (S.view === 'right') drawRight(p);
    else if (S.view === 'curves') drawCurves(p);
    else drawWiggers(p);
  }

  function tick(now) {
    S.raf = root.requestAnimationFrame(tick);
    if (!S.last) S.last = now;
    const dt = Math.min(now - S.last, 100) / 1000;
    S.last = now;
    if (S.src && !S.scrub) {
      const t = S.src();
      if (t != null && t >= 0) S.t = Ph.wrap(t);
    } else if (S.playing && !S.scrub && S.view !== 'curves') {
      S.t = Ph.wrap(S.t + dt / secs());
    }
    draw();
    if (S.onFrame) S.onFrame(S.t);
  }

  const api = {
    draw,
    view: () => S.view,
    setView(v) { S.view = v; draw(); return api; },
    setDark(d) { S.dark = !!d; draw(); return api; },
    setRate(hr) { S.hr = hr || 75; rOffset = null; draw(); return api; },
    setTime(t) { S.t = Ph.wrap(t); draw(); return api; },
    time: () => S.t,
    setIntervention(id) { S.iv = id; draw(); return api; },
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
