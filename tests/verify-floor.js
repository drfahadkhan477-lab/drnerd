#!/usr/bin/env node
'use strict';
/*
 * The app as a Safari older than its stylesheets would draw it, in the engine the other suites use.
 *
 *   node tests/verify-floor.js build/systole.html
 *
 * tests/verify-floor-css-pure.js holds the stylesheets to the table of what iPadOS 13.4 reads, from their text. This asks a browser. An engine does not
 * have to be old to forget a feature: the name of it is changed, in the page's style text, to one nothing knows (tests/_cssfloor.js unknownFeatures),
 * and the engine does what an older Safari does with an unknown name, which is its own error recovery: the declaration goes, a rule with an unknown
 * pseudo-class goes whole, a declaration with a var() in it comes to nothing when it is used. Nothing here is measured on a Safari, and the last
 * lines say so.
 *
 * THE FEATURES MADE UNKNOWN are the ones the table gives a "sim": those the stylesheets have a fallback for that a page can show (color-mix, aspect-ratio,
 * translate, and the keywords overflow-wrap: anywhere and align-content: start). Left alone on purpose: the selector lists that hold :focus-visible or
 * :has() (nothing a screen draws depends on them, and the pure guard reads them), whatever the table calls progressive or accepted (its absence is the
 * difference, and the row says what that is), and a gap on a flex box, which is the engine's and not the text's to forget.
 *
 * THREE PAGES, AND WHAT EACH IS FOR.
 *   N  the page as it ships.
 *   F  the page with those features unknown: what an older Safari draws, the way an engine can be made to draw it.
 *   C  the page with every @supports not (probe) block applied (tests/_cssfloor.js forceFallbacks) and the features known: the older spelling laid over the
 *      newer, declaration for declaration.
 * N against F says what is lost: nothing may move or change its size, nothing may lose a border, and nothing that has a ground, a border or a text colour may
 * lose it. F against C says whether the fallbacks are COMPLETE: if they are, an engine that has dropped the declarations and one that has overridden them
 * draw the same, and a fallback that sets the ground where the rule it stands in for set a ground and a border is the difference between the two.
 *
 * TWO PLACES TO LOOK, because one is not enough. The screens of the app, as built, are where a box can move (the diagram stages are 0 px tall without their
 * ratio): N against F, in step, at three window sizes. Not every rule is reached by a screen the synthetic bank can draw (a due card, a paused mock
 * block), so the other place is a page of the rules themselves: for each rule of an @supports not block, an element that matches its selector is built,
 * in the stylesheet as it ships, and the three pages are compared on it, in each palette, with the pointer on it where the rule is a :hover one. A rule that
 * no element could be built for is reported, and fails.
 *
 * WHAT IT FOUND, on its first run: in landscape the stage of the cardiac-cycle diagram was 910 px wide in F and 751 in N. A box with a ratio and a max-height
 * is made narrower by it, and the first version of the fallback had the stage's height and not its width.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch } = require('./_engine.js');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, onScreen, quiet } = require('./_render.js');
const { stylesheet } = require('./_appcut.js');
const C = require('./_cssfloor.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-floor.js <build.html>'); process.exit(1); }

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = 'start';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

const T = C.loadTable();
const simRows = Object.entries(T.above).filter(([, r]) => r.sim);
const SIMS = [...new Set(simRows.map(([, r]) => r.sim))];
const PROBES = [...new Set(Object.values(T.above).filter(r => r.probe).map(r => r.probe))];
const camel = n => n.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
/* the properties a feature that is made unknown IS: their computed value differs between F and C by definition (aspect-ratio is "auto" in the one) */
const SELF = new Set(simRows.filter(([k]) => /^(property|value) /.test(k)).map(([k]) => camel(k.replace(/^(property|value) /, '').split(':')[0])));

/* What is compared of an element. The first is geometry; the second is what a rule that came to nothing would change. */
const LAYOUT = ['display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
  'zIndex', 'overflowX', 'overflowY', 'flexDirection', 'flexWrap', 'flexGrow', 'flexShrink', 'alignItems', 'alignContent', 'justifyContent', 'gridTemplateColumns', 'gridTemplateRows', 'float', 'whiteSpace',
  'overflowWrap', 'aspectRatio', 'visibility', 'opacity', 'transform', 'translate'];
const PAINT = ['color', 'backgroundColor', 'backgroundImage', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'boxShadow', 'filter', 'backdropFilter', 'webkitBackdropFilter',
  'outlineStyle', 'outlineWidth', 'outlineColor', 'fill', 'stroke', 'textDecorationColor'];

/* What the screens are asked for: the borders, whether each is there, and the colours that say whether a thing has a ground or a text. The rectangle comes with every element. */
const SEEN = ['backgroundColor', 'color'].concat(['Top', 'Right', 'Bottom', 'Left'].flatMap(s => ['border' + s + 'Width', 'border' + s + 'Style', 'border' + s + 'Color']));

/* ── in the page ───────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
/* Every element's rectangle and the given properties of its style, keyed by its path through the document. */
const SNAPSHOT = ({ props }) => {
  const keyOf = el => {
    const parts = [];
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const p = e.parentElement; let n = 0;
      if (p) for (const s of p.children) { if (s === e) break; if (s.tagName === e.tagName) n++; }
      const cls = (typeof e.className === 'string' ? e.className : (e.className && e.className.baseVal) || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      parts.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (cls ? '.' + cls : '') + (n ? '~' + n : ''));
    }
    return parts.reverse().join('>');
  };
  const out = {};
  for (const el of document.body.querySelectorAll('*')) {
    if (/^(SCRIPT|STYLE|LINK|META|TITLE)$/.test(el.tagName)) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    const rec = { r: [r.left, r.top, r.width, r.height], s: {} };
    for (const p of props) rec.s[p] = cs[p];
    let k = keyOf(el);
    while (out[k]) k += '+';
    out[k] = rec;
  }
  return out;
};
/* The same for given elements and their pseudo-elements, one record each, for the page of the rules; and whether each custom property that its rule of the older spelling
   names has a value on it, since one that has none makes the declaration come to nothing, which a comparison with the page that has the same rule cannot see. */
const MEASURE = ({ ids, layout, paint, vars }) => ids.map(id => {
  const el = id === 'body' ? document.body : document.querySelector('[data-fx="' + id + '"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const rec = { s: {}, pseudo: {}, size: [r.width, r.height], unset: [] };
  const cs = getComputedStyle(el);
  for (const v of vars[id] || []) if (cs.getPropertyValue(v).trim() === '') rec.unset.push(v);
  for (const p of layout.concat(paint)) rec.s[p] = cs[p];
  for (const ps of ['::before', '::after']) {
    const pc = getComputedStyle(el, ps);
    if (pc.content && pc.content !== 'none' && pc.content !== 'normal') { rec.pseudo[ps] = {}; for (const p of layout.concat(paint)) rec.pseudo[ps][p] = pc[p]; }
  }
  return rec;
});
const FREEZE = '*,*::before,*::after{animation-duration:1ms!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}';
const SEED = () => { let a = 123456789; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
/* every image loaded, or failed, and decoded: a figure that arrived late in one page is a difference of timing, not of CSS */
const IMAGES = () => {
  const imgs = [...document.images];
  for (const i of imgs) if (i.loading === 'lazy') i.loading = 'eager';
  const waits = imgs.filter(i => !i.complete).map(i => new Promise(r => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); setTimeout(r, 4000); }));
  const decoded = Promise.all(waits).then(() => Promise.all(imgs.filter(i => i.complete && i.naturalWidth > 0).map(i => (i.decode ? i.decode().catch(() => {}) : null))));
  return Promise.race([decoded, new Promise(r => setTimeout(r, 6000))]);
};

/* ── comparing ─────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const PX = /-?\d*\.?\d+px/g;
/* equal, but for a length that differs by what the engine's layout grid rounds (a ratio box's width is 783.984 px where the other's is 784) */
function close(a, b) {
  if (a === b) return true;
  const sa = String(a), sb = String(b);
  if (sa.replace(PX, '#') !== sb.replace(PX, '#')) return false;
  const na = sa.match(PX) || [], nb = sb.match(PX) || [];
  return na.length === nb.length && na.every((x, i) => Math.abs(parseFloat(x) - parseFloat(nb[i])) <= 0.51);
}
const alpha = c => { const m = /^rgba?\(([^)]*)\)$/.exec(c || ''); if (!m) return c && c !== 'transparent' ? 1 : 0; const p = m[1].split(/[,/]\s*|\s+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; };
const SIDES = ['Top', 'Right', 'Bottom', 'Left'];
/* what an element visibly has, as presence and not as value: a ground, a border on a side, a text colour */
function present(s) {
  const has = new Set();
  if (alpha(s.backgroundColor) > 0) has.add('a background colour');
  if (alpha(s.color) > 0) has.add('a text colour');
  for (const side of SIDES) if (s['border' + side + 'Style'] !== 'none' && parseFloat(s['border' + side + 'Width']) > 0 && alpha(s['border' + side + 'Color']) > 0) has.add('a ' + side.toLowerCase() + ' border');
  return has;
}

/* ── the rules of an @supports not block, as elements ────────────────────────────────────────────────────────────────────────── */
function parseCompound(s) {
  const m = /^([a-zA-Z][\w-]*|\*)?((?:[.#][\w-]+|\[[^\]]+\]|::?[\w-]+(?:\([^)]*\))?)*)$/.exec(s);
  if (!m) return null;
  const c = { tag: m[1] && m[1] !== '*' ? m[1] : '', classes: [], id: '', attrs: [], pseudos: [] };
  for (const t of m[2].match(/[.#][\w-]+|\[[^\]]+\]|::?[\w-]+(?:\([^)]*\))?/g) || []) {
    if (t[0] === '.') c.classes.push(t.slice(1)); else if (t[0] === '#') c.id = t.slice(1);
    else if (t[0] === '[') { const a = /^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(t); if (!a) return null; c.attrs.push([a[1], a[2] || '']); }
    else c.pseudos.push(t);
  }
  return c;
}
/* An element that the selector matches, and the things that cannot be built into markup left for the page to be asked: hover, and the pseudo-element. */
function synthesize(selector, n) {
  const pseudoEl = (/::(before|after)\s*$/.exec(selector) || [])[1];
  const bare = selector.replace(/::(before|after)\s*$/, '').replace(/::-webkit-[\w-]+/g, '');
  const hover = /:hover\b/.test(bare);
  const matchSel = bare.replace(/:(hover|active|focus|focus-visible)\b/g, '');
  if (/^(body|html)$/.test(matchSel.trim())) return { id: 'body', matchSel, hover, pseudoEl, html: '' };
  const parts = matchSel.trim().split(/\s*([>+~])\s*|\s+/).filter(x => x !== undefined && x !== '');
  const compounds = [], combs = [];
  for (const p of parts) { if (/^[>+~]$/.test(p)) combs[compounds.length - 1] = p; else { compounds.push(p); if (combs.length < compounds.length) combs.push(' '); } }
  combs.length = compounds.length - 1;
  const cs = compounds.map(parseCompound);
  if (cs.some(c => !c || c.pseudos.some(p => !/^:(disabled|last-child|first-child)$/.test(p)))) return null;
  const open = (c, last) => {
    const tag = c.tag || (c.pseudos.includes(':disabled') ? 'button' : 'div');
    const attrs = [c.classes.length ? 'class="' + c.classes.join(' ') + '"' : '', c.id ? 'id="' + c.id + '"' : '', ...c.attrs.map(([k, v]) => k + '="' + v + '"'), c.pseudos.includes(':disabled') ? 'disabled' : '', last ? 'data-fx="' + n + '"' : ''].filter(Boolean);
    return ['<' + tag + (attrs.length ? ' ' + attrs.join(' ') : '') + '>', '</' + tag + '>'];
  };
  const build = i => {
    const [o, c] = open(cs[i], i === cs.length - 1);
    if (i === cs.length - 1) return o + c;
    return combs[i] === ' ' || combs[i] === '>' ? o + build(i + 1) + c : o + c + build(i + 1);
  };
  return { id: String(n), matchSel, hover, pseudoEl, html: build(0) };
}

/* the rules of the @supports not blocks of a stylesheet that are for a probe the table names, one entry for each selector, and the custom properties each names without a fallback */
function companions(css) {
  const out = [];
  const { root } = C.parseCss(css);
  for (const b of C.blocks(root)) {
    const m = /^@supports\s+not\s*\((.*)\)\s*$/i.exec(b.prelude);
    if (!m || !PROBES.some(p => p.replace(/\s+/g, '') === m[1].replace(/\s+/g, ''))) continue;
    for (const r of b.children) if (r.t === 'rule') for (const sel of C.splitList(r.prelude)) out.push({ sel, line: r.line, vars: [...new Set(r.decls.flatMap(d => [...d.value.matchAll(/var\(\s*(--[\w-]+)\s*[,)]/g)].filter(m => !/^var\(\s*--[\w-]+\s*,/.test(d.value.slice(m.index))).map(m => m[1])))] });
  }
  return out;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'floor-'));
const palettes = css => {
  const out = [{ name: 'light', theme: 'light', palette: '' }, { name: 'dark', theme: 'dark', palette: '' }];
  for (const m of css.matchAll(/html(?:\[data-theme="(\w+)"\])?\[data-palette="(\w+)"\]\s*\{/g)) if (!out.some(o => o.palette === m[2])) out.push({ name: m[2], theme: m[1] || 'light', palette: m[2] });
  return out;
};

(async () => {
  const browser = await launch();
  const errors = [], events = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));

  /* ── the pages ───────────────────────────────────────────────────────────────────────────────────────────────────────────── */
  head('the features are made unknown, and the fallbacks are put on top');
  const html = fs.readFileSync(path.resolve(target), 'utf8');
  const sim = C.unknownFeatures(html, SIMS);
  const forced = C.forceFallbacks(html, PROBES);
  ok('every feature the table gives a sim is found in the page\'s style, so the engine has something to forget', SIMS.every(n => sim.counts[n] > 0), SIMS.map(n => `${n} ×${sim.counts[n] || 0}`).join(', '));
  ok('and every probe the table names is in the page as an @supports not block, so there is something to put on top', PROBES.every(p => forced.counts[p] > 0), PROBES.map(p => `${p.slice(0, 22)} ×${forced.counts[p]}`).join(', '));
  const FILE_F = path.join(dir, 'f.html');
  fs.writeFileSync(FILE_F, sim.html);
  const apart = h => h.split(/<style[^>]*>[\s\S]*?<\/style>/);                   // what lies between the style elements, which the simulation must leave as it was
  const [apartSim, apartHtml] = [apart(sim.html), apart(html)];
  ok('the pages differ, and only in their style', sim.html !== html && apartSim.length === apartHtml.length && apartSim.every((t, i) => t === apartHtml[i]));

  /* ── the screens ─────────────────────────────────────────────────────────────────────────────────────────────────────────── */
  head('the screens of the app, as an older Safari would draw them');
  const VPS = { portrait: [834, 1194], landscape: [1194, 834], narrow: [507, 1000] };
  const STATES = [
    { name: 'home', key: 'home', go: () => goHome(), marker: '.hero-h1', vps: ['portrait', 'landscape'] },
    { name: 'study', key: 'study', go: () => goStudy(), marker: '#planCard', vps: ['portrait'] },
    { name: 'stats', key: 'stats', go: () => goStats(), vps: ['portrait', 'narrow'] },
    { name: 'quiz', key: 'quiz', go: () => { startAdhocQuiz(POOL.filter(q => q.o.length >= 4 && !q.imgopt).slice(0, 4), null); }, marker: '.q-card', vps: ['portrait'] },
    { name: 'answered', key: 'quiz', go: () => { const q = currentQ(); selectOpt((q.ci + 1) % q.o.length); }, marker: '.q-card', vps: ['portrait'],
      settle: () => new Promise(r => { const t0 = Date.now(); (function w() { if (!document.querySelector('.blip-canvas') || Date.now() - t0 > 6000) r(); else setTimeout(w, 50); })(); }) },
    { name: 'lab', key: 'lab', go: () => goLab(), marker: '#labCanvas', vps: ['portrait', 'landscape', 'narrow'],
      settle: () => { try { physio.pause(); physio.setTime(0.3); __physioNotePhase = ''; paintPhysioNote(); } catch (e) {} } },
  ];
  const open = async (file, w, h) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = watch(await ctx.newPage(), events, path.basename(file));
    page.on('pageerror', e => errors.push(path.basename(file) + ': ' + e.message));
    await page.addInitScript(SEED);
    await page.goto('file://' + path.resolve(file), { waitUntil: 'load', timeout: 200000 });
    await booted(page);
    await page.addStyleTag({ content: FREEZE });
    await quiet(page);
    return { ctx, page };
  };
  const diffs = { rect: [], border: [], gone: [], keys: [] };
  let elements = 0, visits = 0;
  for (const vpn of Object.keys(VPS)) {
    const [w, h] = VPS[vpn];
    const A = await open(target, w, h), B = await open(FILE_F, w, h);
    for (const st of STATES.filter(s => s.vps.includes(vpn))) {
      for (const X of [A, B]) {
        await X.page.evaluate(st.go);
        await onScreen(X.page, st.key, st.marker ? { marker: st.marker } : {});
        await quiet(X.page);
        await X.page.waitForTimeout(250);
        if (st.settle) await X.page.evaluate(st.settle);
        /* what scrolls into view is revealed by a slide that translate makes, and without translate it is shown at once: the one difference the table says there is, taken out of the way */
        await X.page.evaluate(() => document.querySelectorAll('.scroll-reveal').forEach(e => e.classList.add('is-visible')));
        await X.page.evaluate(IMAGES);
        await quiet(X.page);
      }
      const [n, f] = [await A.page.evaluate(SNAPSHOT, { props: SEEN }), await B.page.evaluate(SNAPSHOT, { props: SEEN })];
      visits++; elements += Object.keys(n).length;
      const tag = `${vpn} ${st.name}`;
      for (const k of Object.keys(n)) {
        const x = n[k], y = f[k];
        if (!y) { diffs.keys.push(`${tag}: ${k.slice(-60)} is not in F`); continue; }
        if (x.r.some((v, i) => Math.abs(v - y.r[i]) >= 1)) diffs.rect.push(`${tag}: ${k.slice(-60)} ${x.r.map(Math.round)} → ${y.r.map(Math.round)}`);
        for (const side of SIDES) for (const p of ['Width', 'Style']) if (x.s['border' + side + p] !== y.s['border' + side + p] && !close(x.s['border' + side + p], y.s['border' + side + p])) diffs.border.push(`${tag}: ${k.slice(-60)} border${side}${p} ${x.s['border' + side + p]} → ${y.s['border' + side + p]}`);
        const lost = [...present(x.s)].filter(p => !present(y.s).has(p));
        if (lost.length) diffs.gone.push(`${tag}: ${k.slice(-60)} lost ${lost.join(', ')}`);
      }
      for (const k of Object.keys(f)) if (!n[k]) diffs.keys.push(`${tag}: ${k.slice(-60)} is only in F`);
    }
    await A.ctx.close(); await B.ctx.close();
  }
  const list = (a, n = 3) => a.slice(0, n).join(' | ') + (a.length > n ? ` … ${a.length - n} more` : '');
  ok('the screens were drawn, in both, and there is something in them to compare', visits >= 10 && elements > 3000, `${visits} screens, ${elements} elements`);
  ok('every element is in both, and in the same place and of the same size, to a pixel (a diagram stage, a heat-map cell, the chapter icons)', diffs.rect.length === 0 && diffs.keys.length === 0, list(diffs.rect.concat(diffs.keys)) || 'none');
  ok('and none has lost a border, nor changed its width or its style', diffs.border.length === 0, list(diffs.border) || 'none');
  ok('and none that has a background colour, a text colour or a border on a side has lost it', diffs.gone.length === 0, list(diffs.gone) || 'none');

  /* ── the rules ───────────────────────────────────────────────────────────────────────────────────────────────────────────── */
  head('every rule of the older spelling, on an element the rule matches');
  /* The app's stylesheet only. The Memorizer's and the Lab page's are held by the pure guard, which runs whatever changes; this suite is run by the jobs that
     take the built app, and a change to lab/ or memorizer/ alone does not start them (tests/verify-cichanges-pure.js holds the suites of those jobs
     to that, so one that read those two directories would be skipped on exactly the change it was for). The Lab page has the one companion of the two,
     and it is not drawn. */
  const css = stylesheet();
  /* the tokens a component sets for itself, or that a script sets in a style attribute, which an element built from a selector alone would not have */
  const TOKENS = '--ch:#2A9D8F;--rc:#C0392B;--acc:#8E44AD;--accent:#2980B9';
  const ctx = await browser.newContext({ viewport: { width: 834, height: 1194 } });
  let sawSim = false;
  {
    const comps = companions(css);
    ok('the stylesheet has @supports not rules to build elements for', comps.length > 0, `${comps.length} selectors`);
    const items = comps.map((c, i) => Object.assign({ c }, synthesize(c.sel, i + 1)));
    const unbuilt = items.filter(x => !x.html && x.id !== 'body').map(x => x.c.sel + ' (line ' + x.c.line + ')');
    const useful = items.filter(x => x.html || x.id === 'body');
    const body = `<div id="fx" style="${TOKENS}">${useful.map(x => x.html).join('')}</div>`;
    const doc = sheet => `<!doctype html><html><head><meta charset="utf-8"><style>${sheet}</style><style>${FREEZE}</style></head><body>${body}</body></html>`;
    const pages = {};
    const simmed = C.unknownFeatures(doc(css), SIMS);
    for (const [k, text] of [['N', doc(css)], ['F', simmed.html], ['C', C.forceFallbacks(doc(css), PROBES).html]]) {
      const page = watch(await ctx.newPage(), events, `rules ${k}`);
      page.on('pageerror', e => errors.push(`rules ${k}: ${e.message}`));
      await page.setContent(text, { waitUntil: 'load' });
      pages[k] = page;
    }
    const matched = await pages.N.evaluate(list => list.map(x => x.id === 'body' ? true : !!document.querySelector('[data-fx="' + x.id + '"]') && document.querySelector('[data-fx="' + x.id + '"]').matches(x.matchSel)), useful.map(x => ({ id: x.id, matchSel: x.matchSel })));
    const nomatch = useful.filter((x, i) => !matched[i]).map(x => x.c.sel + ' (line ' + x.c.line + ')');
    ok(`an element is built for each of the ${items.length} selectors of its @supports not rules, and the selector matches it`, !unbuilt.length && !nomatch.length, list(unbuilt.concat(nomatch)) || `${matched.filter(Boolean).length} of ${items.length}`);
    const pal = palettes(css);
    const problems = { gap: [], gone: [], hovered: 0, size: [], vars: [] };
    const setPalette = (page, p) => page.evaluate(({ theme, palette }) => {
      const h = document.documentElement;
      if (theme) h.setAttribute('data-theme', theme); else h.removeAttribute('data-theme');
      if (palette) h.setAttribute('data-palette', palette); else h.removeAttribute('data-palette');
    }, p);
    const res = {};                                     // res[palette][page][id]
    for (const p of pal) res[p.name] = { N: {}, F: {}, C: {} };
    const still = useful.filter(x => !x.hover).map(x => x.id), hovered = useful.filter(x => x.hover).map(x => x.id);
    const vars = Object.fromEntries(useful.map(x => [x.id, x.c.vars]));
    for (const p of pal) for (const k of ['N', 'F', 'C']) {
      await setPalette(pages[k], p);
      if (still.length) (await pages[k].evaluate(MEASURE, { ids: still, layout: LAYOUT, paint: PAINT, vars })).forEach((r, i) => { res[p.name][k][still[i]] = r; });
    }
    for (const id of hovered) for (const k of ['N', 'F', 'C']) {
      let on = true;
      try { await pages[k].hover('[data-fx="' + id + '"]', { timeout: 5000 }); } catch (e) { on = false; }
      for (const p of pal) {
        await setPalette(pages[k], p);
        res[p.name][k][id] = on ? (await pages[k].evaluate(MEASURE, { ids: [id], layout: LAYOUT, paint: PAINT, vars }))[0] : null;
      }
      await pages[k].mouse.move(0, 0);
      problems.hovered++;
    }
    for (const p of pal) {
      for (const x of useful) {
        const n = res[p.name].N[x.id], f = res[p.name].F[x.id], c = res[p.name].C[x.id];
        if (!n || !f || !c) { problems.gap.push(`${p.name} ${x.c.sel}: not measured${x.hover ? ' (the pointer could not be put on it)' : ''}`); continue; }
        if (f.unset.length) problems.vars.push(`${p.name} ${x.c.sel}: ${f.unset.join(', ')} has no value there`);
        if (n.size.some((v, i) => Math.abs(v - f.size[i]) >= 1)) problems.size.push(`${p.name} ${x.c.sel}: ${n.size.map(Math.round)} → ${f.size.map(Math.round)}`);
        const sides = [[x.c.sel, f.s, c.s, n.s]];
        if (x.pseudoEl && f.pseudo[x.pseudoEl] && c.pseudo[x.pseudoEl]) sides.push([x.c.sel + ' (' + x.pseudoEl + ')', f.pseudo[x.pseudoEl], c.pseudo[x.pseudoEl], null]);
        for (const [what, fs_, cs_, ns_] of sides) {
          const unequal = Object.keys(cs_).filter(prop => !SELF.has(prop) && !close(fs_[prop], cs_[prop]));
          if (unequal.length) problems.gap.push(`${p.name} ${what}: F and C differ in ${unequal.slice(0, 3).map(u => `${u} (${String(fs_[u]).slice(0, 30)} / ${String(cs_[u]).slice(0, 30)})`).join(', ')}`);
          if (ns_) { const lost = [...present(ns_)].filter(q => !present(fs_).has(q)); if (lost.length) problems.gone.push(`${p.name} ${what}: lost ${lost.join(', ')}`); }
          if (ns_ && Object.keys(ns_).some(prop => !close(ns_[prop], fs_[prop]))) sawSim = true;
        }
      }
    }
    ok(`with the features unknown, each element is drawn as it is when the older spelling is laid over the newer, in ${pal.length} palettes (${pal.map(p => p.name).join(', ')})`, problems.gap.length === 0, list(problems.gap) || `${useful.length} elements, hover measured on ${problems.hovered}`);
    ok('and none that has a background colour, a text colour or a border has lost it', problems.gone.length === 0, list(problems.gone) || 'none');
    ok('and none is a different size, hovered or not, and every custom property a rule of the older spelling names has a value on its element, in each palette', problems.size.length === 0 && problems.vars.length === 0, list(problems.size.concat(problems.vars)) || 'none');
    for (const k of Object.keys(pages)) await pages[k].close();
    ok('the engine did forget what it was told to: the sim found each of its features in the stylesheet', SIMS.every(n => simmed.counts[n] > 0), Object.entries(simmed.counts).map(([k, v]) => `${k} ×${v}`).join(', '));
  }
  ok('and making the features unknown does change an element or more, so that comparing the two is not comparing a page with itself', sawSim);
  await ctx.close();

  head('and the page threw nothing');
  ok('no script error in any of the pages', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
  console.log('\n  NOT MEASURED: a Safari. The engine is this machine\'s, with the names of the features changed. A gap on a flex box cannot be made unknown, and what the table\n  calls progressive or accepted is not compared: its absence is the difference.');

  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
