#!/usr/bin/env node
/*
 * The ink canvas is made when there is something to show on it or a hand to draw with, and not before.
 *
 *   node tests/verify-lazyink.js build/synthetic/systole.html
 *
 * Every draw of a question used to attach a canvas to each of its hosts (the card, the explanation, each figure), sized to the
 * host at the screen's density: at iPad size about 5 MB for the card and 11 for the explanation, made again and thrown away for
 * every question, for ink that was never there; and 10 to 30 ms of the draw that follows an answer. A host with no strokes and the
 * pen off has nothing to show and nothing under a pen. So it has no canvas until the pen is picked up, or strokes are put back.
 * This holds both halves of that:
 *   · a question looked at, answered and left, with the pen off and nothing written, makes no canvas, sizes none and writes
 *     nothing into the ink store;
 *   · and wherever ink is wanted it is there: with the pen picked up every host has a canvas that takes a stroke; a stroke
 *     written is shown when the question is drawn again with the pen down, on the card and on the explanation alike; strokes put
 *     back while the question is up are painted; and a canvas follows its host when the window is resized.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, onScreen, quiet, resized, watchTransitions } = require('./_render.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-lazyink.js <build.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

/* In the page: how many pixels of a canvas have been painted on. */
const PAINTED = `(cv => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })`;
/* A stroke in the shape the app writes it. */
const STROKE = `{ t: 'pen', c: '#EF4444', sz: 'M', p: [[0.1, 0.1, 0.5, 0], [0.3, 0.2, 0.5, 0], [0.5, 0.4, 0.5, 0], [0.7, 0.3, 0.5, 0]] }`;

(async () => {
  const browser = await launch();
  const errors = [], events = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));
  const ctx = await browser.newContext({ viewport: { width: 834, height: 1194 }, deviceScaleFactor: 2 });
  const page = watch(await ctx.newPage(), events, 'main');
  page.on('pageerror', e => errors.push(e.message));
  await watchTransitions(page);   /* before goto: see _render.js */
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await booted(page);
  await quiet(page);

  const quiz = n => page.evaluate(n => { startAdhocQuiz(POOL.filter(q => q.o.length >= 4 && !q.imgopt).slice(0, n), null); }, n);
  const settle = async () => { await page.evaluate(() => (window.__vtLive && window.__vtLive.finished ? window.__vtLive.finished.catch(() => {}) : null)); await quiet(page); };
  const count = () => page.evaluate(() => ({ canvases: document.querySelectorAll('.ink-canvas').length, hosts: document.querySelectorAll('.ink-host').length, keys: Object.keys(INK).length }));
  const wrong = () => page.evaluate(() => { const q = S.questions[S.qIdx]; selectOpt((q.ci + 1) % q.o.length); });

  head('a question looked at');
  await quiz(8);
  await onScreen(page, 'quiz', { marker: '.q-card' });
  await settle();
  {
    const c = await count();
    ok('the card is an ink host and has no canvas: the pen is off and nothing is written on it', c.hosts >= 1 && c.canvases === 0, JSON.stringify(c));
    ok('and looking at it wrote nothing into the ink store: a question looked at is not a question marked', c.keys === 0, `${c.keys} entries`);
  }

  head('answered, and the next question, with the pen off');
  {
    await page.evaluate(() => {
      window.__sizes = 0;
      const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
      Object.defineProperty(HTMLCanvasElement.prototype, 'width', { configurable: true, get() { return d.get.call(this); }, set(v) { if (String(this.className).indexOf('ink-canvas') >= 0) window.__sizes++; d.set.call(this, v); } });
    });
    for (let i = 0; i < 4; i++) { await wrong(); await settle(); await page.evaluate(() => nextQ()); await settle(); }
    await wrong(); await settle();
    const r = await page.evaluate(() => ({ sizes: window.__sizes, canvases: document.querySelectorAll('.ink-canvas').length, hosts: document.querySelectorAll('.ink-host').length, keys: Object.keys(INK).length }));
    ok('five answers and four questions after them make no ink canvas and size none', r.sizes === 0 && r.canvases === 0 && r.hosts >= 2, JSON.stringify(r));
    ok('the explanation is a host too, and has none either; and still nothing is in the ink store', r.keys === 0, `${r.hosts} hosts, ${r.keys} entries`);
  }

  head('the pen picked up');
  let box;
  {
    await page.evaluate(() => railAction('pen'));
    await settle();
    const on = await page.evaluate(() => ({ hosts: document.querySelectorAll('.ink-host').length, canvases: document.querySelectorAll('.ink-host > .ink-canvas').length,
      sized: [...document.querySelectorAll('.ink-canvas')].every(c => c.width > 0 && c.height > 0), inkOn: [...document.querySelectorAll('.ink-host')].every(h => h.classList.contains('ink-on')), active: T.active }));
    ok('picking up the pen gives every host on the screen a canvas, sized, and puts them in ink mode', on.active && on.hosts >= 2 && on.canvases === on.hosts && on.sized && on.inkOn, JSON.stringify(on));
    const cv = page.locator('.q-card .ink-canvas');
    await cv.scrollIntoViewIfNeeded();
    await settle();
    box = await cv.boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4, { steps: 6 });
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.3, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const w = await page.evaluate(`(() => { const q = currentQ(), cv = document.querySelector('.q-card .ink-canvas'); return { strokes: (INK[q.id + ':q'] || []).length, pixels: (${PAINTED})(cv), id: q.id }; })()`);
    ok('a stroke drawn with the pen is stored and painted on the card', w.strokes === 1 && w.pixels > 50, JSON.stringify(w));
  }

  head('ink that is there is shown');
  {
    await page.evaluate(() => railAction('pen'));   // put the pen down
    const down = await page.evaluate(() => T.active);
    await page.evaluate(() => render());
    await settle();
    const shown = await page.evaluate(`(() => { const cv = document.querySelector('.q-card .ink-canvas'); return { canvas: !!cv, pixels: cv ? (${PAINTED})(cv) : 0, inkOn: document.querySelector('.q-card').classList.contains('ink-on') }; })()`);
    ok('with the pen down, the stroke written is on the card when the question is drawn again', down === false && shown.canvas && shown.pixels > 50 && shown.inkOn === false, JSON.stringify(shown));

    /* A stroke on the explanation alone: the card of the next question has none, and the explanation is shown once it is answered. */
    await page.evaluate(() => nextQ());
    await settle();
    await page.evaluate(`(() => { const q = currentQ(); INK[q.id + ':e'] = [${STROKE}]; saveJSON(INK_KEY, INK); })()`);
    await wrong();
    await settle();
    const e = await page.evaluate(`(() => { const rb = document.querySelector('.reveal-body .ink-canvas'); return { onExplanation: !!rb, pixels: rb ? (${PAINTED})(rb) : 0, onCard: !!document.querySelector('.q-card .ink-canvas') }; })()`);
    ok('a stroke written on the explanation is shown there once the question is answered, and the card still has no canvas', e.onExplanation && e.pixels > 50 && e.onCard === false, JSON.stringify(e));
  }

  head('strokes put back while the question is up');
  {
    await page.evaluate(() => nextQ());
    await settle();
    const before = await count();
    const r = await page.evaluate(`(() => {
      const q = currentQ(); INK[q.id + ':q'] = [${STROKE}];
      repaintAll();
      const cv = document.querySelector('.q-card .ink-canvas');
      return { canvas: !!cv, pixels: cv ? (${PAINTED})(cv) : 0 };
    })()`);
    ok('strokes restored from a backup while the question is on screen get a canvas and are painted', before.canvases === 0 && r.canvas && r.pixels > 50, JSON.stringify([before.canvases, r]));
  }

  head('a canvas follows its host');
  {
    await page.evaluate(() => railAction('pen'));   // pen up: every host has one
    await settle();
    await resized(page, 600, 1000);
    await settle();
    await page.waitForFunction(() => { const h = document.querySelector('.q-card'), c = h && h.querySelector('.ink-canvas'); return !!c && Math.abs(c.width - Math.round(h.clientWidth * devicePixelRatio)) <= 1; }, null, { timeout: 5000 }).catch(() => {});
    const f = await page.evaluate(() => [...document.querySelectorAll('.ink-host')].map(h => { const c = h.querySelector('.ink-canvas'); return c ? [c.width, Math.round(h.clientWidth * devicePixelRatio), c.height, Math.round(h.clientHeight * devicePixelRatio)] : null; }));
    ok('after the window is made narrower every canvas is the size of the host it sits in', f.length >= 1 && f.every(x => x && Math.abs(x[0] - x[1]) <= 1 && Math.abs(x[2] - x[3]) <= 1), JSON.stringify(f));
  }

  head('nothing throws');
  ok('no page errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
