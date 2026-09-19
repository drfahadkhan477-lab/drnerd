#!/usr/bin/env node
/*
 * The 12-lead's paper, in arithmetic.
 *
 *   node tests/verify-ecg12-pure.js
 *
 * No browser and no build. src/ui/ecg12.js draws onto a 2D canvas, and almost
 * everything that can be WRONG about it is geometry: how many pixels a
 * millimetre is, how many seconds a cell holds, how tall a 1 mV pulse comes
 * out, where a tap lands. None of that needs a GPU — it needs a context that
 * writes down what it was asked to draw.
 *
 * WHY THIS FILE EXISTS, stated accurately. It is not true that nothing tested
 * this module: verify-leads.js reaches ECG12 in three of its twenty-five
 * checks — that the panel mounts, that ECG12.LAYOUT is the standard
 * arrangement, and that tapping a lead selects it. The other twenty-two are
 * about src/core/leads12.js, which verify-leads-pure.js already covers with
 * forty-seven.
 *
 * What had nothing on it is the paper. A 12-lead is read by MEASURING on it —
 * "two big squares" is 0.08 s only because a big square is 5 mm and the paper
 * runs at 25 mm/s — and every one of those relationships was un-asserted. A
 * regression there does not look like a bug; it looks like a slightly
 * different picture, and it makes every interval a fellow measures wrong.
 *
 * And the three checks that did exist need a build and a browser, so they run
 * on one machine when someone remembers. These run on every push.
 *
 * WHAT IT DELIBERATELY DOES NOT DO is assert that anything is legible, or that
 * the trace looks like a heart. Morphology is leads12's job and is checked
 * there; appearance needs eyes and a screen. This is the ruler, not the
 * drawing.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { makeWeb, loadModule } = require('./_fakeweb.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/* ── a canvas that writes down what it was told ──────────────────────────────
   Not a renderer: every call is recorded with its arguments and nothing is
   rasterised. That is enough for every claim below, because each one is about
   a coordinate rather than a pixel. Kept in this suite rather than in
   tests/_fakeweb.js because it has exactly one consumer; the moment a second
   suite needs it, it moves there rather than being copied. */
function recorder() {
  const ops = [];
  const ctx = { lineWidth: 0, strokeStyle: '', fillStyle: '', font: '', lineJoin: '', lineCap: '', textBaseline: '' };
  for (const name of ['save', 'restore', 'beginPath', 'closePath', 'stroke', 'fill', 'clip',
                      'moveTo', 'lineTo', 'rect', 'fillRect', 'strokeRect', 'fillText', 'setTransform',
                      'arc', 'quadraticCurveTo', 'bezierCurveTo']) {
    ctx[name] = (...args) => { ops.push({ op: name, args, stroke: ctx.strokeStyle, fill: ctx.fillStyle }); };
  }
  ctx.measureText = t => ({ width: String(t).length * 6 });
  return { ctx, ops };
}

function mountAt(width, height, opts, dpr) {
  const { ctx, ops } = recorder();
  const canvas = {
    width: 0, height: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width, height, x: 0, y: 0, top: 0, left: 0 }),
  };
  const samples = [];
  const Leads12 = {
    /* Deterministic and bounded, so a coordinate below is arithmetic and not
       a rhythm. Recorded, because WHEN each lead is sampled is itself a claim. */
    sample(id, t, kind, hr) { samples.push({ id, t, kind, hr }); return 0.1; },
  };
  const root = loadModule(fs, path, 'src/ui/ecg12.js', makeWeb({}),
    { window: { devicePixelRatio: dpr || 1 } });
  root.Leads12 = Leads12;
  const api = root.ECG12.mount(canvas, opts || {});
  return { root, api, ops, samples, canvas, ctx, width, height };
}

const E = mountAt(1000, 700).root.ECG12;

head('the module loads and draws something');
{
  const m = mountAt(1000, 700);
  ok('ECG12 is exported with a mount()', typeof E.mount === 'function');
  ok('mounting returns an api', m.api && typeof m.api.draw === 'function');
  /* Vacuity guard: every measurement below reads m.ops, and an empty ops array
     would let most of them pass by finding nothing to disagree with. */
  ok('and it actually drew', m.ops.length > 100, `${m.ops.length} canvas calls`);
  ok('and actually sampled the rhythm', m.samples.length > 100, `${m.samples.length} samples`);
}

head('the layout is the one printed on real paper');
{
  const flat = E.LAYOUT.flat();
  ok('three rows of four', E.LAYOUT.length === 3 && E.LAYOUT.every(r => r.length === 4));
  ok('twelve leads, no repeats', new Set(flat).size === 12, String(new Set(flat).size));
  ok('and they are the twelve',
     new Set(flat).size === 12 &&
     ['I','II','III','aVR','aVL','aVF','V1','V2','V3','V4','V5','V6'].every(l => flat.includes(l)),
     flat.join(','));
  ok('column one is the limb leads, in order', E.LAYOUT.map(r => r[0]).join(',') === 'I,II,III');
  ok('column two is the augmented leads, in order', E.LAYOUT.map(r => r[1]).join(',') === 'aVR,aVL,aVF');
  ok('columns three and four run V1 to V6 down and across',
     E.LAYOUT.map(r => r[2]).join(',') === 'V1,V2,V3' && E.LAYOUT.map(r => r[3]).join(',') === 'V4,V5,V6');
  ok('the rhythm strip is lead II — the one an axis makes tallest', E.STRIP_LEAD === 'II');
}

head('the paper units are the ones a measurement assumes');
{
  ok('25 mm per second', E.MM_PER_S === 25, String(E.MM_PER_S));
  ok('10 mm per millivolt', E.MM_PER_MV === 10, String(E.MM_PER_MV));
}

/* ── reading the drawing back ───────────────────────────────────────────────
   traceInto() always lays a lead down the same way: clip to the cell, then
   moveTo the baseline and five lineTo calls for the calibration pulse, then
   one lineTo per sample. So a clip marks the start of a lead, and the five
   calls after it are the pulse. Derived from the ops rather than from reading
   the source twice — a check that recomputes the implementation cannot
   disagree with it. */
function leads(m) {
  const out = [];
  for (let i = 0; i < m.ops.length; i++) {
    if (m.ops[i].op !== 'clip') continue;
    const path = [];
    for (let j = i + 1; j < m.ops.length && m.ops[j].op !== 'stroke'; j++) {
      if (m.ops[j].op === 'moveTo' || m.ops[j].op === 'lineTo') path.push(m.ops[j].args);
    }
    /* The label is drawn straight after the restore. */
    let id = null;
    for (let j = i + 1; j < m.ops.length; j++) {
      if (m.ops[j].op === 'fillText') { id = m.ops[j].args[0]; break; }
    }
    if (path.length >= 6) out.push({ id, path });
  }
  return out;
}
/* moveTo(x,baseline), lineTo(cx,baseline), lineTo(cx,top), lineTo(cx+5mm,top),
   lineTo(cx+5mm,baseline) */
function pulse(l) {
  const [p0, p1, p2, p3, p4] = l.path;
  return { baseline: p0[1], height: p1[1] - p2[1], width: p3[0] - p2[0],
           returns: near(p4[1], p0[1], 1e-9), flatTop: near(p2[1], p3[1], 1e-9) };
}

head('a millivolt is ten millimetres tall, and it is drawn that way');
{
  const m = mountAt(1000, 700);
  const ls = leads(m);
  ok('every cell plus the rhythm strip was drawn', ls.length === 13, `${ls.length} traces`);
  const mm = pulse(ls[0]).width / 5;           /* the pulse is 5 mm wide by definition */
  ok('the calibration pulse is 5 mm wide', mm > 0, `${mm} px per mm`);
  const bad = ls.filter(l => !near(pulse(l).height, mm * E.MM_PER_MV, 1e-9));
  ok('and exactly 1 mV — ten millimetres — tall, in every lead',
     bad.length === 0, bad.map(l => `${l.id}:${pulse(l).height}`).join(', ') || `${mm * 10}px in all 13`);
  ok('it has a flat top and returns to the baseline',
     ls.every(l => pulse(l).flatTop && pulse(l).returns));
}

head('a big square is 0.2 s, which is what makes an interval readable');
{
  const m = mountAt(1000, 700);
  const ls = leads(m);
  const mm = pulse(ls[0]).width / 5;
  /* px per ms, read off two consecutive samples of the same lead rather than
     recomputed: the xs come from the drawing, the ts from what was asked of
     Leads12. */
  const first = ls[0];
  const xs = first.path.slice(5).map(p => p[0]);
  const ts = m.samples.filter(s => s.id === first.id).map(s => s.t);
  const pxPerMs = (xs[1] - xs[0]) / (ts[1] - ts[0]);
  ok('the trace advances at the paper speed',
     near(pxPerMs, (mm * E.MM_PER_S) / 1000, 1e-9), `${pxPerMs} px/ms`);
  ok('one small square is 0.04 s', near(mm / pxPerMs, 40, 1e-6), `${mm / pxPerMs} ms`);
  ok('one big square is 0.20 s', near((mm * 5) / pxPerMs, 200, 1e-6), `${(mm * 5) / pxPerMs} ms`);
  ok('so a 0.12 s QRS is three small squares wide',
     near(120 * pxPerMs / mm, 3, 1e-6), `${120 * pxPerMs / mm} mm`);
}

head('the millimetre follows the width, so a cell always holds 2.5 s');
{
  /* The one thing fit() computes, and the reason it computes it: the grid is
     not a fixed size, it is whatever makes a column hold two and a half
     seconds at 25 mm/s. If this drifts the paper silently stops being paper. */
  for (const [w, h] of [[1000, 700], [640, 480], [1400, 900], [900, 1200]]) {
    const m = mountAt(w, h);
    const ls = leads(m);
    const mm = pulse(ls[0]).width / 5;
    const cellW = w / 4;
    ok(`at ${w}×${h}, a column holds 2.5 s`,
       near(cellW / (mm * E.MM_PER_S), 2.5, 1e-9), `${(cellW / (mm * E.MM_PER_S)).toFixed(4)} s`);
  }
}

head('the columns are recorded in sequence, as a real machine does');
{
  const m = mountAt(1000, 700);
  const firstT = id => m.samples.find(s => s.id === id).t;
  for (let col = 0; col < 4; col++) {
    const ids = E.LAYOUT.map(r => r[col]);
    const want = col * 2.5 * 1000;
    const wrong = ids.filter(id => !near(firstT(id), want, 1e-9));
    ok(`column ${col + 1} (${ids.join(', ')}) starts at ${want / 1000} s`,
       wrong.length === 0, wrong.map(id => `${id}@${firstT(id)}`).join(', ') || 'all three');
  }
  /* The strip is the exception: it is the whole record from the top. */
  const stripTs = m.samples.filter(s => s.id === E.STRIP_LEAD).map(s => s.t);
  ok('and the rhythm strip starts at zero', Math.min(...stripTs) === 0, String(Math.min(...stripTs)));
  /* Against what a CELL actually spans, not against 4 × CELL_S. The first
     version compared 9740 ms to 4 × 2500 = 10000 and went red on arithmetic of
     mine, not on anything the module did. */
  const cellSpan = (() => {
    const ts = m.samples.filter(s => s.id === 'I').map(s => s.t);
    return Math.max(...ts) - Math.min(...ts);
  })();
  ok('and runs four times longer than a cell does',
     Math.max(...stripTs) > 4 * cellSpan,
     `${Math.max(...stripTs)} ms against a cell's ${cellSpan} ms`);
}

head('the calibration pulse is drawn inside the box, and it costs time');
{
  /* FOUND BY A CHECK THAT FAILED, and kept as what it measured rather than as
     what I first assumed. The strip asks for STRIP_S = 10 s and draws 9.74;
     a cell asks for CELL_S = 2.5 s and draws 2.24. Neither is a bug in the
     sense of something behaving unpredictably — traceInto() lays the 1 mV
     pulse down first, inside the same clipped box, and then walks the trace
     until it runs off the right edge:

         let cx = x + S.mm * 1.5;      lead-in before the pulse
         …                             the pulse itself, 5 mm wide
         if (px > x + w) break;        and the trace stops at the edge

     So the pulse's 6.5 mm is spent out of the window the trace had, and the
     seconds actually shown are (width − 6.5 mm) ÷ paper speed. On a cell that
     is 10% of the record; the last 0.26 s of the "ten-second" rhythm strip is
     not drawn at all.

     Asserted exactly rather than approximately, so that if the lead-in ever
     grows this says by how much instead of going quietly red. */
  const m = mountAt(1000, 700);
  const ls = leads(m);
  const mm = pulse(ls[0]).width / 5;
  const pxPerMs = (mm * E.MM_PER_S) / 1000;
  const leadIn = mm * 6.5;                       /* 1.5 mm before + 5 mm pulse */
  /* MEASURED FROM THE PATH, not restated. The first version of this line read
     `near(leadIn, mm * 6.5)` with leadIn defined two lines above as mm * 6.5 —
     a check that compares a value to itself and can never fail, which is the
     one shape this repository hunts for by name. */
  const p0 = ls[0].path[0], p1 = ls[0].path[1], p3 = ls[0].path[3];
  ok('the pulse starts 1.5 mm in', near(p1[0] - p0[0], mm * 1.5, 1e-9), `${p1[0] - p0[0]}px`);
  ok('and 6.5 mm of the box is gone by the time the trace starts',
     near(p3[0] - p0[0], leadIn, 1e-9), `${p3[0] - p0[0]}px of ${leadIn}px expected`);

  const spanOf = id => {
    const ts = m.samples.filter(s => s.id === id).map(s => s.t);
    return Math.max(...ts) - Math.min(...ts);
  };
  const cellW = 1000 / 4;
  ok('a cell shows the width it has left, not the 2.5 s it asks for',
     near(spanOf('I'), Math.floor((cellW - leadIn) / pxPerMs / 10) * 10, 10),
     `${spanOf('I')} ms of 2500`);
  ok('which is 2.24 s — a tenth of every lead is the pulse',
     spanOf('I') > 2200 && spanOf('I') < 2260, `${spanOf('I')} ms`);
  ok('and the strip shows 9.74 s of its ten',
     spanOf(E.STRIP_LEAD) > 9700 && spanOf(E.STRIP_LEAD) < 9800, `${spanOf(E.STRIP_LEAD)} ms`);
  ok('the shortfall is the same 6.5 mm in both, so it is the pulse and not a cap',
     near((cellW - leadIn) / pxPerMs - spanOf('I'), (1000 - leadIn) / pxPerMs - spanOf(E.STRIP_LEAD), 12),
     `${((cellW - leadIn) / pxPerMs - spanOf('I')).toFixed(1)} vs ` +
     `${((1000 - leadIn) / pxPerMs - spanOf(E.STRIP_LEAD)).toFixed(1)} ms of rounding`);
}

head('a tap finds the lead under it');
{
  const m = mountAt(1000, 700);
  const stripH = 700 * 0.22, gridH = 700 - stripH, cellW = 250, cellH = gridH / 3;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const id = E.LAYOUT[row][col];
      const got = m.api.leadAt(col * cellW + cellW / 2, row * cellH + cellH / 2);
      ok(`the middle of ${id}'s box is ${id}`, got === id, String(got));
    }
  }
  ok('a tap low down finds the rhythm strip, not a grid cell',
     m.api.leadAt(500, gridH + stripH / 2) === E.STRIP_LEAD,
     String(m.api.leadAt(500, gridH + stripH / 2)));
  ok('the strip spans the full width — the far left is still the strip',
     m.api.leadAt(2, gridH + stripH / 2) === E.STRIP_LEAD);
  ok('and the far right too', m.api.leadAt(998, gridH + stripH / 2) === E.STRIP_LEAD);
  ok('outside the canvas is nothing, not the nearest lead',
     m.api.leadAt(-5, -5) === null && m.api.leadAt(2000, 2000) === null,
     `${m.api.leadAt(-5, -5)} / ${m.api.leadAt(2000, 2000)}`);
  /* A shared edge belongs to the cell listed first, which is deterministic
     rather than correct-or-incorrect — written down so a change to the
     iteration order is a decision somebody makes rather than a surprise. */
  ok('a shared edge resolves to the earlier cell, deterministically',
     m.api.leadAt(cellW, cellH / 2) === 'I', String(m.api.leadAt(cellW, cellH / 2)));
}

head('selection is state, and it is reported');
{
  const m = mountAt(1000, 700);
  ok('nothing is selected to begin with', m.api.selected() === null, String(m.api.selected()));
  m.api.select('V3');
  ok('selecting reports back', m.api.selected() === 'V3');
  m.api.select(null);
  ok('and it can be cleared', m.api.selected() === null);
}

head('the grid thins out rather than turning into a wash');
{
  /* Below about 2 px per mm the 1 mm lines would merge into a solid block, so
     they are dropped and only the 5 mm lines are drawn — which is what a
     shrunken printout looks like. The two passes use different colours, so
     counting the distinct colours among the grid's lines says which ran. */
  const gridColours = m => {
    const upto = m.ops.findIndex(o => o.op === 'clip');
    return new Set(m.ops.slice(0, upto < 0 ? m.ops.length : upto)
      .filter(o => o.op === 'moveTo').map(o => o.stroke));
  };
  const wide = mountAt(1000, 700), narrow = mountAt(400, 300);
  const mmWide = pulse(leads(wide)[0]).width / 5;
  const mmNarrow = pulse(leads(narrow)[0]).width / 5;
  ok('the wide canvas is above the threshold', mmWide >= 2, `${mmWide} px/mm`);
  ok('and the narrow one below it', mmNarrow < 2, `${mmNarrow} px/mm`);
  ok('wide draws both the 1 mm and the 5 mm grid', gridColours(wide).size === 2,
     `${gridColours(wide).size} line colours`);
  ok('narrow draws only the 5 mm grid', gridColours(narrow).size === 1,
     `${gridColours(narrow).size} line colours`);
}

head('dark is a different paper, not the same one dimmed');
{
  const light = mountAt(1000, 700, { dark: false });
  const dark = mountAt(1000, 700, { dark: true });
  const paper = m => m.ops.find(o => o.op === 'fillRect').fill;
  ok('the light paper is drawn', !!paper(light), paper(light));
  ok('the dark paper is a different colour', paper(dark) !== paper(light),
     `${paper(light)} vs ${paper(dark)}`);
  const traceColour = m => leads(m)[0].path.length && m.ops.find(o => o.op === 'lineTo').stroke;
  ok('and so is the trace', traceColour(dark) !== traceColour(light),
     `${traceColour(light)} vs ${traceColour(dark)}`);
}

head('it refuses rather than half-draws');
{
  const { ctx } = recorder();
  const zero = {
    width: 0, height: 0, getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
  };
  const root = loadModule(fs, path, 'src/ui/ecg12.js', makeWeb({}), { window: { devicePixelRatio: 1 } });
  root.Leads12 = { sample: () => 0 };
  ok('a canvas with no size mounts without throwing', !!root.ECG12.mount(zero, {}));
  const noLeads = loadModule(fs, path, 'src/ui/ecg12.js', makeWeb({}), { window: { devicePixelRatio: 1 } });
  ok('and without Leads12 it returns null rather than drawing nothing quietly',
     noLeads.ECG12.mount({ getContext: () => ctx, getBoundingClientRect: () => ({ width: 100, height: 100 }) }, {}) === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
