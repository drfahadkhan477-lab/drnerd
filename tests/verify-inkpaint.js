#!/usr/bin/env node
/*
 * A move of the pen paints the segments it added, and the picture is the one a full repaint draws.
 *
 *   node tests/verify-inkpaint.js build/synthetic/systole.html
 *
 * Every pointer move on an ink canvas used to repaint the canvas: clear it, then stroke every segment of every stroke saved on it, then
 * the stroke being drawn. So a move cost more with each stroke already written. Measured, headless, on a card 907 by 139 points with
 * strokes of forty points: nothing on the card, 0 ms a move; a hundred strokes, 1 ms on Chromium and 3 ms on WebKit; three hundred, 2.5
 * and 8 (95th percentile 13) ms. A hand that writes by hand puts hundreds of strokes on an explanation, and an iPad reports a Pencil move
 * every 8 ms, so the line the Pencil had drawn arrived after the frame it belonged to.
 *
 * A move now paints from the first point it added, over what the canvas shows. That is a change of how the picture is made and not of the
 * picture, so this holds both halves:
 *   · the cost: while a stroke is drawn on a canvas holding a hundred and fifty strokes, a move strokes the segments it brought and no
 *     others. Counted in calls to the context's stroke(), which is the same on every machine, and not in milliseconds, which are not;
 *   · the picture: with the stroke still being drawn, the canvas is compared with the canvas after a full repaint of the same strokes,
 *     pixel for pixel, for the pen and for the highlighter (whose multiply and alpha are the ways overlapping segments could differ), at
 *     the third point of the stroke, where the dot a stroke begins as has to have gone, and again further along.
 *
 * WHERE THE PICTURES ARE COMPARED. The strokes already on the canvas are in its lower half and the stroke drawn is in its upper half, and
 * only the upper half is compared. Compared whole, WebKit differs from itself by a few pixels: two full repaints of a hundred and fifty
 * overlapping strokes, one run from a pointer event and one from the page, disagree at about fifteen of 434,000 pixels, by up to 64 in a
 * channel, and they do so with the code as it was before this change, in which every move was a full repaint. That is the engine's
 * rounding where many translucent edges cross, and it is not what is being held. The stroke is what a change to how a move paints could
 * get wrong, and it is compared where nothing else is.
 *
 * AND HOW CLOSELY. Even there WebKit is not bit for bit the same from one page to the next: over ten fresh pages the pen comparisons
 * were always exact, and the highlighter's had one pixel in about forty-one thousand differ in three runs of the ten, always the same
 * translucent pixel (alpha 102 against 118). So the picture is held to a thousandth of the pixels painted: none for the pen's two
 * segments, six for its forty moves, forty-one for the highlighter's band. The smallest defect injected differs by tens of pixels where
 * none are allowed (a dot left behind) and by more than a thousand in the highlighter's band, so the allowance is not what lets one by.
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

/* Before the page's own scripts: count the calls that stroke a segment on an ink canvas. */
const INIT = () => {
  window.__strokes = 0;
  const stroke = CanvasRenderingContext2D.prototype.stroke;
  CanvasRenderingContext2D.prototype.stroke = function () {
    if (this.canvas && String(this.canvas.className).indexOf('ink-canvas') >= 0) window.__strokes++;
    return stroke.apply(this, arguments);
  };
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
  const count = () => page.evaluate(() => { const n = window.__strokes; window.__strokes = 0; return n; });
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
    const full = await count();
    /* The instrument has to count what it claims to, or "a move strokes few segments" is true of a counter that never counted. */
    ok(`a full repaint of the ${SAVED} strokes strokes every segment of them: the count is not zero`, full >= SAVED * (POINTS - 1), `${full} calls to stroke() for ${SAVED * (POINTS - 1)} segments`);
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
    const painted = await keep();
    const early = await differ();
    ok('with the stroke two segments long, the canvas is what a full repaint of the same strokes draws: the dot a stroke begins as is gone', painted > 20 && early <= Math.floor(painted * NOISE), `${painted} pixels painted in the upper half, ${early} differ from a full repaint (${Math.floor(painted * NOISE)} allowed)`);
    await count();
    await along(0.3, 5);
    const calls = await count();
    ok(`${MOVES} moves of the pen on a canvas holding ${SAVED} strokes stroke only the segments they added`, calls > 0 && calls <= MOVES * 2, `${calls} calls to stroke(), ${(calls / MOVES).toFixed(2)} a move; a repaint of what was there is ${SAVED * (POINTS - 1)} a move`);
    const painted2 = await keep();
    const late = await differ();
    ok('and after them the canvas is what a full repaint of the same strokes draws', painted2 > painted && late <= Math.floor(painted2 * NOISE), `${painted2} pixels painted in the upper half, ${late} differ from a full repaint (${Math.floor(painted2 * NOISE)} allowed)`);
    await page.mouse.up();
    await page.waitForTimeout(100);
    const kept = await page.evaluate(() => (INK[currentQ().id + ':q'] || []).length);
    ok('lifting the pen stores the stroke with the others', kept === SAVED + 1, `${kept} strokes stored`);
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
    const calls = await count();
    ok(`with the highlighter picked up, ${MOVES} moves stroke only the segments they added`, tool.tool === 'hl' && tool.active && calls > 0 && calls <= MOVES * 2, `${JSON.stringify(tool)}; ${calls} calls to stroke(), ${(calls / MOVES).toFixed(2)} a move`);
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
