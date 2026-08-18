/* ═══════════════════════════════════════════════════════════════════════════
   ecg12.js — draw a 12-lead the way one is actually printed.

   Standard layout, because a fellow reading this should be reading the same
   arrangement they will meet on a real tracing:

       I    aVR   V1   V4
       II   aVL   V2   V5          + a lead II rhythm strip along the bottom
       III  aVF   V3   V6

   Real paper units throughout: 25 mm/s and 10 mm/mV, on 1 mm squares with
   every fifth line bold. That matters for more than looks — it is what makes
   "two big squares" or "0.12 seconds" mean anything when you measure on it.

   Static, not swept. A 12-lead is a snapshot you read, not a monitor you
   watch; the sweeping trace is what the single-lead monitor above it is for.

   Usage:
     const ecg = ECG12.mount(canvas, { kind:'sinus', hr:68, dark:false });
     ecg.setRhythm('rbbb', 70);
     ecg.leadAt(x, y)      // which lead is under a tap, or null
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

/* The printed order, column by column. */
const LAYOUT = [
  ['I',   'aVR', 'V1', 'V4'],
  ['II',  'aVL', 'V2', 'V5'],
  ['III', 'aVF', 'V3', 'V6'],
];
const STRIP_LEAD = 'II';

const MM_PER_S = 25;      // paper speed
const MM_PER_MV = 10;     // gain
const CELL_S = 2.5;       // seconds shown per lead cell
const STRIP_S = 10;       // seconds of rhythm strip

function mount(canvas, opts) {
  opts = opts || {};
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof root.Leads12 === 'undefined') return null;
  const L12 = root.Leads12;

  const S = {
    kind: opts.kind || 'sinus',
    hr: opts.hr || 68,
    dark: !!opts.dark,
    selected: null,
    cells: [],          // {id, x, y, w, h} in CSS px, for hit testing
    mm: 6,              // px per mm, recomputed on fit
  };

  function palette() {
    return S.dark
      ? { paper:'#0E1622', fine:'rgba(239,124,124,.16)', bold:'rgba(239,124,124,.30)',
          trace:'#F1F5F9', label:'#94A3B8', sel:'rgba(45,212,191,.16)', selEdge:'#2DD4BF' }
      : { paper:'#FFF8F7', fine:'rgba(224,122,122,.30)', bold:'rgba(214,96,96,.52)',
          trace:'#111827', label:'#6B7280', sel:'rgba(2,132,199,.09)', selEdge:'#0284C7' };
  }

  function fit() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    /* 3× on a 12-lead: the grid and the traces are hairlines, and a printed
       ECG is read by measuring on those lines, so crispness is legibility. */
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    /* One cell must hold CELL_S seconds at 25 mm/s, so the mm size follows
       from the width available to a column rather than being chosen. */
    S.mm = (r.width / 4) / (CELL_S * MM_PER_S);
    return true;
  }

  function grid(w, h, p) {
    ctx.fillStyle = p.paper;
    ctx.fillRect(0, 0, w, h);
    const mm = S.mm;
    /* Below about 2px per mm the fine grid turns into a solid wash — drop it
       and keep only the 5 mm lines, which is what a shrunken printout does. */
    const fine = mm >= 2.0;
    ctx.lineWidth = 1;
    if (fine) {
      ctx.strokeStyle = p.fine;
      ctx.beginPath();
      for (let x = 0; x <= w; x += mm) { ctx.moveTo(Math.round(x) + .5, 0); ctx.lineTo(Math.round(x) + .5, h); }
      for (let y = 0; y <= h; y += mm) { ctx.moveTo(0, Math.round(y) + .5); ctx.lineTo(w, Math.round(y) + .5); }
      ctx.stroke();
    }
    ctx.strokeStyle = p.bold;
    ctx.beginPath();
    for (let x = 0; x <= w; x += mm * 5) { ctx.moveTo(Math.round(x) + .5, 0); ctx.lineTo(Math.round(x) + .5, h); }
    for (let y = 0; y <= h; y += mm * 5) { ctx.moveTo(0, Math.round(y) + .5); ctx.lineTo(w, Math.round(y) + .5); }
    ctx.stroke();
  }

  /* One lead into a box. tOffset lets each column start later in the record,
     the way a real machine records the columns sequentially. */
  function traceInto(id, x, y, w, h, seconds, tOffset, p) {
    const baseline = y + h * 0.58;
    const pxPerMs = (S.mm * MM_PER_S) / 1000;
    const pxPerMv = S.mm * MM_PER_MV;

    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();

    /* the 1 mV calibration pulse every real tracing opens with */
    ctx.strokeStyle = p.trace; ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    let cx = x + S.mm * 1.5;
    ctx.moveTo(x, baseline);
    ctx.lineTo(cx, baseline);
    ctx.lineTo(cx, baseline - pxPerMv);
    ctx.lineTo(cx + S.mm * 5, baseline - pxPerMv);
    ctx.lineTo(cx + S.mm * 5, baseline);
    cx += S.mm * 5;
    const startMs = tOffset;
    const spanMs = seconds * 1000;
    const step = Math.max(1, Math.round(1 / pxPerMs));
    for (let ms = 0; ms <= spanMs; ms += step) {
      const px = cx + ms * pxPerMs;
      if (px > x + w) break;
      const mv = L12.sample(id, startMs + ms, S.kind, S.hr);
      ctx.lineTo(px, baseline - mv * pxPerMv);
    }
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = p.label;
    ctx.font = `600 ${Math.max(10, Math.round(S.mm * 3.1))}px ui-monospace,SFMono-Regular,Menlo,monospace`;
    ctx.textBaseline = 'top';
    ctx.fillText(id, x + 4, y + 3);
  }

  function draw() {
    if (!fit()) return;
    const r = canvas.getBoundingClientRect();
    const w = r.width, h = r.height;
    const p = palette();
    grid(w, h, p);

    const stripH = h * 0.22;
    const gridH = h - stripH;
    const cellW = w / 4, cellH = gridH / 3;
    S.cells = [];

    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        const id = LAYOUT[row][col];
        const x = col * cellW, y = row * cellH;
        S.cells.push({ id, x, y, w: cellW, h: cellH });
        if (S.selected === id) {
          ctx.fillStyle = p.sel; ctx.fillRect(x, y, cellW, cellH);
          ctx.strokeStyle = p.selEdge; ctx.lineWidth = 1.5;
          ctx.strokeRect(x + .75, y + .75, cellW - 1.5, cellH - 1.5);
        }
        /* Columns are recorded in sequence on a real machine, so each starts
           2.5 s later than the one to its left. */
        traceInto(id, x, y, cellW, cellH, CELL_S, col * CELL_S * 1000, p);
        if (col > 0) {
          ctx.strokeStyle = p.bold; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x + .5, y + cellH * 0.12);
          ctx.lineTo(x + .5, y + cellH * 0.88); ctx.stroke();
        }
      }
    }

    const sy = gridH;
    S.cells.push({ id: STRIP_LEAD, x: 0, y: sy, w: w, h: stripH, strip: true });
    if (S.selected === STRIP_LEAD) { ctx.fillStyle = p.sel; ctx.fillRect(0, sy, w, stripH); }
    traceInto(STRIP_LEAD, 0, sy, w, stripH, STRIP_S, 0, p);
    ctx.strokeStyle = p.bold; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, sy + .5); ctx.lineTo(w, sy + .5); ctx.stroke();
  }

  const api = {
    draw,
    setRhythm(kind, hr) { S.kind = kind; if (hr) S.hr = hr; draw(); return api; },
    setDark(d) { S.dark = !!d; draw(); return api; },
    select(id) { S.selected = id; draw(); return api; },
    selected() { return S.selected; },
    /* Hit test in CSS pixels relative to the canvas. The rhythm strip is last
       in the list and spans the full width, so a tap low down finds it. */
    leadAt(x, y) {
      for (const c of S.cells) {
        if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return c.id;
      }
      return null;
    },
    layout: LAYOUT,
  };
  draw();
  return api;
}

root.ECG12 = { mount, LAYOUT, STRIP_LEAD, MM_PER_S, MM_PER_MV };

})(typeof window !== 'undefined' ? window : this);
