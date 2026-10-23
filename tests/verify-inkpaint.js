#!/usr/bin/env node
/*
 * A move of the pen costs the stroke being written, never the strokes already on the canvas, and the picture is the one a full
 * repaint draws.
 *
 *   node tests/verify-inkpaint.js build/synthetic/systole.html
 *
 * Every pointer move on an ink canvas used to repaint the canvas: clear it, then stroke every segment of every stroke saved on it, then
 * the stroke being drawn. So a move cost more with each stroke already written. Measured, headless, on a card 907 by 139 points with
 * strokes of forty points: nothing on the card, 0 ms a move; a hundred strokes, 1 ms on Chromium and 3 ms on WebKit; three hundred, 2.5
 * and 8 (95th percentile 13) ms. A hand that writes by hand puts hundreds of strokes on an explanation, and an iPad reports a Pencil move
 * every 8 ms, so the line the Pencil had drawn arrived after the frame it belonged to.
 *
 * THE PEN is drawn with perfect-freehand (docs/vendor/perfect-freehand): a stroke is one outline, filled, where it was a chain of
 * round-capped segments. The outline's end moves with the pen, so a move cannot add to what is there; the stroke being written is on a
 * canvas of its own (.ink-live) that a move clears and fills once, and lifting the pen puts it with the others. So this holds:
 *   · a full repaint fills each pen stroke once, and strokes the highlighter's segments: counted in calls to the context's fill() and
 *     stroke(), which are the same on every machine, and not in milliseconds, which are not;
 *   · a move paints nothing on the canvas of saved strokes, and fills the live one once;
 *   · while the stroke is written the canvas below is as it was, and the stroke is on the live canvas; lifted, the live canvas is empty,
 *     the stroke is stored, and the canvas is what a full repaint draws;
 *   · and the line is as wide as it was: a straight stroke at one pressure is PencilFX.widthFor's width across, which is what each
 *     segment was drawn at before.
 *
 * THE HIGHLIGHTER is still laid segment by segment on the canvas, because it multiplies with what is under it. A move paints from the
 * first point it added, over what the canvas shows. That is a change of how the picture is made and not of the picture, so with the
 * stroke still being drawn the canvas is compared with the canvas after a full repaint of the same strokes, pixel for pixel.
 *
 * WHERE THE PICTURES ARE COMPARED. The strokes already on the canvas are in its lower half and the stroke drawn is in its upper half, and
 * only the upper half is compared. Compared whole, WebKit differs from itself by a few pixels: two full repaints of a hundred and fifty
 * overlapping strokes, one run from a pointer event and one from the page, disagree at about fifteen of 434,000 pixels, by up to 64 in a
 * channel, and they do so with the code as it was before the segment-by-segment change, in which every move was a full repaint. That is
 * the engine's rounding where many translucent edges cross, and it is not what is being held.
 *
 * AND HOW CLOSELY. Even there WebKit is not bit for bit the same from one page to the next: over ten fresh pages the highlighter's
 * comparison had one pixel in about forty-one thousand differ in three runs of the ten, always the same translucent pixel (alpha 102
 * against 118). So the picture is held to a thousandth of the pixels painted. The smallest defect injected differs by more than a
 * thousand in the highlighter's band, so the allowance is not what lets one by.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, onScreen, quiet, watchTransitions } = require('./_render.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-inkpaint.js <build.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

const SAVED = 150, POINTS = 30;          // strokes already on the canvas, and points in each
const MOVES = 40;                        // moves of the stroke being drawn that are counted
const NOISE = 0.001;                     // the share of the pixels painted that may differ: see the header

/* Before the page's own scripts: count the calls that lay paint, stroke() and fill(), on the ink canvas and on the live one. */
const INIT = () => {
  window.__paints = { canvas: { stroke: 0, fill: 0 }, live: { stroke: 0, fill: 0 } };
  for (const m of ['stroke', 'fill']) {
    const orig = CanvasRenderingContext2D.prototype[m];
    CanvasRenderingContext2D.prototype[m] = function () {
      const cls = this.canvas ? String(this.canvas.className) : '';
      const on = cls.indexOf('ink-canvas') >= 0 ? 'canvas' : cls.indexOf('ink-live') >= 0 ? 'live' : null;
      if (on) window.__paints[on][m]++;
      return orig.apply(this, arguments);
    };
  }
};

(async () => {
  const browser = await launch();
  const errors = [], events = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));
  const ctx = await browser.newContext({ viewport: { width: 834, height: 1194 }, deviceScaleFactor: 2 });
  const page = watch(await ctx.newPage(), events, 'main');
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(INIT);
  await watchTransitions(page);   /* before goto: see _render.js */
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await booted(page);
  await quiet(page);

  const settle = async () => { await page.evaluate(() => (window.__vtLive && window.__vtLive.finished ? window.__vtLive.finished.catch(() => {}) : null)); await quiet(page); };
  /* The paint calls since the last count, by canvas: { canvas: {stroke, fill}, live: {stroke, fill} }. */
  const count = () => page.evaluate(() => { const n = window.__paints;
    window.__paints = { canvas: { stroke: 0, fill: 0 }, live: { stroke: 0, fill: 0 } }; return n; });
  const calls = n => n.stroke + n.fill;
  /* Pixels with paint on them in a canvas, by selector, in its upper half. */
  const paintedIn = sel => page.evaluate(sel => {
    const c = document.querySelector(sel); if (!c || !c.width) return 0;
    const d = c.getContext('2d').getImageData(0, 0, c.width, Math.floor(c.height / 2)).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n;
  }, sel);
  /* The upper half of the canvas, kept in the page; and how many of its pixels differ from what was kept, after a full repaint. */
  const keep = () => page.evaluate(() => {
    const c = document.querySelector('.q-card .ink-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, Math.floor(c.height / 2)).data;
    let painted = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) painted++;
    window.__kept = d; return painted;
  });
  const differ = () => page.evaluate(() => {
    document.querySelector('.q-card').__redraw();
    const c = document.querySelector('.q-card .ink-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, Math.floor(c.height / 2)).data, k = window.__kept;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] !== k[i] || d[i + 1] !== k[i + 1] || d[i + 2] !== k[i + 2] || d[i + 3] !== k[i + 3]) n++;
    return n;
  });

  head('a canvas holding strokes');
  await page.evaluate(() => { startAdhocQuiz(POOL.filter(q => q.o.length >= 4 && !q.imgopt).slice(0, 4), null); });
  await onScreen(page, 'quiz', { marker: '.q-card' });
  await settle();
  await page.evaluate(() => railAction('pen'));
  await settle();
  let box;
  {
    /* Strokes in the shape the app writes them, a random walk from a fixed seed so that the run is the same every time, in the lower half. */
    await page.evaluate(({ saved, points }) => {
      let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
      const strokes = [];
      for (let i = 0; i < saved; i++) {
        let x = 0.05 + rnd() * 0.9, y = 0.55 + rnd() * 0.43; const p = [];
        for (let j = 0; j < points; j++) {
          x = Math.min(0.98, Math.max(0.02, x + (rnd() - 0.5) * 0.03)); y = Math.min(0.98, Math.max(0.55, y + (rnd() - 0.5) * 0.03));
          p.push([Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4, 0.5, 0]);
        }
        strokes.push({ t: i % 5 === 0 ? 'hl' : 'pen', c: '#0F172A', sz: 'M', p });
      }
      INK[currentQ().id + ':q'] = strokes;
      repaintAll();
    }, { saved: SAVED, points: POINTS });
    await settle();
    await count();
    await page.evaluate(() => { document.querySelector('.q-card').__redraw(); });
    const full = (await count()).canvas;
    const HL = Math.ceil(SAVED / 5), PEN = SAVED - HL;
    /* The instrument has to count what it claims to, or "a move paints little" is true of a counter that never counted. */
    ok(`a full repaint of the ${SAVED} strokes fills each of the ${PEN} pen strokes once, as one outline`, full.fill === PEN, `${full.fill} calls to fill()`);
    ok(`and strokes every segment of the ${HL} highlighter strokes`, full.stroke === HL * (POINTS - 1), `${full.stroke} calls to stroke() for ${HL * (POINTS - 1)} segments`);
    const cv = page.locator('.q-card .ink-canvas');
    await cv.scrollIntoViewIfNeeded();
    await settle();
    box = await cv.boundingBox();
  }

  /* The stroke begins at 10% of the canvas's width and goes right. The first move turns the dot into a segment, the second is the first
     one painted over what is there. */
  const begin = async yFrac => {
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * yFrac);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * (yFrac + 0.02));
    await page.mouse.move(box.x + box.width * 0.14, box.y + box.height * (yFrac + 0.03));
  };
  const along = async (yFrac, wave) => {
    for (let i = 0; i < MOVES; i++) await page.mouse.move(box.x + box.width * (0.14 + i * 0.015), box.y + box.height * (yFrac + 0.03 + Math.sin(i / wave) * 0.05));
  };

  head('the pen');
  {
    await begin(0.3);
    await count();
    const before = await keep();
    await along(0.3, 5);
    const n = await count();
    ok(`${MOVES} moves of the pen on a canvas holding ${SAVED} strokes paint nothing on it`, calls(n.canvas) === 0, JSON.stringify(n.canvas));
    ok('and fill the stroke being written on its own canvas, once a move', n.live.fill > 0 && n.live.fill <= MOVES && n.live.stroke === 0, JSON.stringify(n.live));
    /* The live canvas is the stroke drawn once: a move that filled it without clearing it first would lay the outline over the
       last one, and the antialiased edge, painted again, darkens. Compared with the same stroke drawn fresh by a repaint. */
    const relive = await page.evaluate(() => {
      const c = document.querySelector('.q-card .ink-live'); if (!c) return null;
      const g = c.getContext('2d'), a = g.getImageData(0, 0, c.width, c.height).data;
      document.querySelector('.q-card').__redraw();
      const b = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0, painted = 0; for (let i = 0; i < a.length; i += 4) { if (b[i + 3]) painted++;
        if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) n++; }
      return { n, painted };
    });
    ok('the live canvas holds the stroke drawn once, as a fresh draw of it does', !!relive && relive.painted > 100 && relive.n === 0, JSON.stringify(relive));
    const below = await paintedIn('.q-card .ink-canvas'), live = await paintedIn('.q-card .ink-live');
    ok('while it is written the canvas below is as it was, and the stroke is on the live canvas', below === before && live > 100,
       `${before} → ${below} pixels painted below in the upper half; ${live} on the live canvas`);
    await page.mouse.up();
    await page.waitForTimeout(100);
    const kept = await page.evaluate(() => (INK[currentQ().id + ':q'] || []).length);
    const after = await paintedIn('.q-card .ink-canvas'), liveAfter = await paintedIn('.q-card .ink-live');
    ok('lifting the pen stores the stroke with the others, puts it on the canvas below, and empties the live one',
       kept === SAVED + 1 && after > before && liveAfter === 0, `${kept} strokes stored; ${after} pixels below; ${liveAfter} left on the live canvas`);
    const painted = await keep();
    const late = await differ();
    ok('and the canvas is what a full repaint of the same strokes draws', late <= Math.floor(painted * NOISE), `${late} of ${painted} pixels differ (${Math.floor(painted * NOISE)} allowed)`);
  }

  head('the pen\'s line is as wide as it was');
  {
    /* A straight stroke at one pressure, put on the canvas as the app stores one, and measured down a column through its middle: the
       run of pixels at least half covered is its width in device pixels. The old segments were PencilFX.widthFor wide; the outline is
       meant to be the same. Antialiasing makes an edge pixel half covered or not depending on where the edge falls, so the run is
       allowed one device pixel either way of the width. */
    const w = await page.evaluate(() => {
      const host = document.querySelector('.q-card'), c = host.querySelector('.ink-canvas');
      const key = currentQ().id + ':q';
      const keep = INK[key];
      const p = []; for (let i = 0; i <= 20; i++) p.push([0.2 + i * 0.03, 0.25, 0.5, 0]);
      INK[key] = [{ t: 'pen', c: '#0F172A', sz: 'M', p }];
      host.__redraw();
      const x = Math.round(c.width * 0.5), d = c.getContext('2d').getImageData(x, 0, 1, Math.floor(c.height / 2)).data;
      let run = 0; for (let i = 3; i < d.length; i += 4) if (d[i] >= 128) run++;
      INK[key] = keep; host.__redraw();
      const dpr = c.width / host.clientWidth;
      return { run, want: PencilFX.widthFor(INK_TOOLS.pen.w, 0.5, 0, 'M') * dpr };
    });
    ok('a straight stroke at one pressure is PencilFX.widthFor wide, to a device pixel', Math.abs(w.run - w.want) <= 1, `${w.run} device pixels across, ${w.want.toFixed(2)} wanted`);
  }

  head('the highlighter');
  {
    await page.evaluate(() => railAction('hl'));
    await settle();
    const tool = await page.evaluate(() => ({ tool: T.tool, active: T.active }));
    await count();
    await begin(0.1);
    await count();
    await along(0.1, 4);
    const n = await count(), hlCalls = n.canvas.stroke;
    ok(`with the highlighter picked up, ${MOVES} moves stroke only the segments they added, on the canvas itself`,
       tool.tool === 'hl' && tool.active && hlCalls > 0 && hlCalls <= MOVES * 2 && n.canvas.fill === 0 && calls(n.live) === 0,
       `${JSON.stringify(tool)}; ${hlCalls} calls to stroke(), ${(hlCalls / MOVES).toFixed(2)} a move; ${JSON.stringify(n)}`);
    const painted = await keep();
    const late = await differ();
    ok('and the canvas is what a full repaint draws, where overlapping segments multiply and blend', painted > 200 && late <= Math.floor(painted * NOISE), `${painted} pixels painted in the upper half, ${late} differ from a full repaint (${Math.floor(painted * NOISE)} allowed)`);
    await page.mouse.up();
  }

  head('nothing throws');
  ok('no page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
