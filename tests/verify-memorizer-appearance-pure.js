#!/usr/bin/env node
/*
 * Memorizer's themes — the owner's Daylight and Clinical, and Systole's
 * Contrast — and every one of them is readable.
 *
 *   node tests/verify-memorizer-appearance-pure.js
 *
 * Pure Node. memorizer/src/appearance.js holds the palettes as data and
 * generates the stylesheet from them. Two things are proven about that data:
 *
 *   · CONTRAST IS PORTED, NOT INVENTED. Its colours are read out of
 *     scripts/highcontrast-patch.js and compared, value for value. The
 *     owner's two were drawn for Memorizer and have no source to drift from;
 *     until they replaced them, Systole's other eight were held here the
 *     same way.
 *   · READABLE. WCAG contrast ratios, computed, for every pairing the page
 *     actually draws: body and secondary text on the ground and on cards,
 *     accent-coloured text, text on accent buttons, and the right/wrong/partly
 *     colours on their own tints — in every theme, and both halves of Auto,
 *     on glass over the aurora as well as on solid cards. The floors are the
 *     ones the old themes were held to; none moved with the themes.
 *
 * Plus the plumbing: settings normalise to known values, the stylesheet has a
 * rule for every value a setting can take, and text size scales in rem.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const L = require(path.join(ROOT, 'memorizer', 'src', 'appearance.js'));

const lum = hex => {
  const c = hex.replace('#', '');
  const v = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) / 255).map(x => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const parseRgba = s => { const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(s); return m ? [+m[1], +m[2], +m[3], +m[4]] : [0, 0, 0, -1]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

head('the themes: the owner’s two, Memorizer’s Paper and Neuron, and Systole’s Contrast');
{
  const ids = L.THEMES.map(t => t.id);
  ok('Daylight and Clinical, Paper and Neuron, Contrast, and Auto pairing the first two', ids.join() === 'daylight,clinical,paper,neuron,contrast' && L.AUTO &&
     L.AUTO.light === 'daylight' && L.AUTO.dark === 'clinical' && L.byId('daylight').mode === 'light' && L.byId('clinical').mode === 'dark', ids.join(', '));
  /* Contrast is Systole's: its id, name and swatch are what Systole's
     picker shows, read from Systole's own source. */
  const tp = fs.readFileSync(path.join(ROOT, 'scripts', 'theme-patch.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'scripts', 'highcontrast-patch.js'), 'utf8');
  const systole = {};
  for (const m of tp.matchAll(/\{id:'([a-z]+)',\s*name:'([^']+)'/g)) systole[m[1]] = m[2];
  const ct = L.byId('contrast');
  ok('Contrast has Systole’s id, name and swatch', systole.contrast === ct.name &&
     new RegExp("id:'contrast'[^}]*bg:'" + ct.swatch[0] + "',ac:'" + ct.swatch[1] + "'", 'i').test(tp), `${systole.contrast} / ${ct.swatch}`);
  ok('each swatch is its theme’s own ground and accent', L.THEMES.every(t => t.swatch[0] === t.t.bg && (t.swatch[1] === t.t.accent || t.source)),
     L.THEMES.map(t => t.id + ' ' + t.swatch.join('/')).join(' '));
}

head('ported colour for colour');
{
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'theme-patch.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'scripts', 'highcontrast-patch.js'), 'utf8');
  /* Memorizer token ← Systole token. Contrast's cards sit on --navy2, not
     --border2, which it uses as a visible rule. */
  const MAP = { bg: 'bg', surface: 'card', 'surface-2': 'border2', ink: 'text', muted: 'muted', line: 'border', accent: 'teal', 'accent-soft': 'teal4' };
  const block = id => {
    const m = src.match(new RegExp('data-palette="' + id + '"\\]\\{([\\s\\S]*?)\\n\\}'));
    if (!m) return null;
    const t = {};
    for (const x of m[1].matchAll(/--([a-z0-9-]+):([^;]+);/g)) t[x[1]] = x[2].trim();
    if (/^var\(--accent\)$/.test(t.teal || '')) t.teal = t.accent;
    return t;
  };
  let compared = 0;
  const drift = [];
  L.THEMES.filter(t => t.source).forEach(t => {
    const s = block(t.source);
    if (!s) { drift.push(t.id + ': no Systole block'); return; }
    Object.keys(MAP).forEach(k => {
      const from = t.source === 'contrast' && k === 'surface-2' ? 'navy2' : MAP[k];
      compared++;
      if ((s[from] || '').toUpperCase() !== t.t[k].toUpperCase()) drift.push(`${t.id} ${k}: ${t.t[k]}, Systole --${from}: ${s[from]}`);
    });
  });
  ok('Contrast’s source block was found and read', compared === 8, `${compared} colours compared`);
  ok('every one of its colours is Systole’s, exactly', drift.length === 0, drift.join('; ') || 'no drift');
  ok('the four drawn for Memorizer name no Systole source', L.THEMES.filter(t => !t.source).map(t => t.id).join() === 'daylight,clinical,paper,neuron');
}

head('every theme is readable');
{
  const bad = [];
  const need = (id, what, fg, bg, min) => { const r = ratio(fg, bg); if (r < min) bad.push(`${id}: ${what} ${r.toFixed(2)} < ${min}`); };
  L.THEMES.forEach(th => {
    const t = th.t, s = L.SEMANTIC[th.mode];
    need(th.id, 'text on ground', t.ink, t.bg, 7);
    need(th.id, 'text on card', t.ink, t.surface, 7);
    need(th.id, 'secondary text on card', t.muted, t.surface, 4.5);
    need(th.id, 'secondary text on ground', t.muted, t.bg, 4.5);
    need(th.id, 'accent text on card', t.accent, t.surface, 4.5);
    need(th.id, 'button text on accent', t['accent-ink'], t.accent, 4.5);
    need(th.id, 'text on accent tint', t.ink, t['accent-soft'], 7);
    need(th.id, 'text on a filled chip', t.ink, t['surface-2'], 4.5);
    ['good', 'mid', 'bad'].forEach(k => {
      need(th.id, k + ' on card', s[k], t.surface, 4.5);
      need(th.id, 'text on ' + k + ' tint', t.ink, s[k + '-soft'], 4.5);
    });
  });
  ok('every theme clears AA for every text pairing the page draws (7:1 for body text)', bad.length === 0, bad.join('; ') || `${L.THEMES.length} themes × 14 pairings`);
  ok('no palette but Contrast uses pure black or white as a ground (Systole’s rule)',
     L.THEMES.filter(t => t.id !== 'contrast').every(t => !/^#(000000|FFFFFF)$/i.test(t.t.bg)));
  /* Read from the generated stylesheet, per theme: the meaning colours are
     what the page gets, not what a table says. */
  const css = L.css();
  const goodOf = id => (css.match(new RegExp(':root\\[data-look="' + id + '"\\]\\{[^}]*--good:(#[0-9A-F]{6})', 'i')) || [])[1];
  ok('the meaning colours are the same in every light theme, and in every dark one',
     L.THEMES.every(t => goodOf(t.id) === L.SEMANTIC[t.mode].good) && L.SEMANTIC.light.good !== L.SEMANTIC.dark.good,
     L.THEMES.map(t => t.id + ':' + goodOf(t.id)).join(' '));
}

head('contrast and brightness, computed, and readable at every setting');
{
  /* The floors, written here as numbers rather than read from FLOORS: a
     floor lowered in appearance.js must fail this suite, not move it. */
  const FLOOR = { standard: { text: 7, muted: 4.5, accent: 4.5, edge: 3, meaning: 4.5 }, high: { text: 10, muted: 7, accent: 7, edge: 4.5, meaning: 7 } };
  const bad = [];
  let n = 0;
  L.THEMES.forEach(th => ['standard', 'high'].forEach(c => ['dim', 'standard', 'bright'].forEach(b => {
    n++;
    const t = L.variant(th, c, b), s = L.semanticOf(th.mode, c), f = FLOOR[c], id = `${th.id}/${c}/${b}`;
    const need = (what, fg, bgs, min) => bgs.forEach(g => { const r = ratio(fg, t[g]); if (r < min) bad.push(`${id}: ${what} on ${g} ${r.toFixed(2)} < ${min}`); });
    need('text', t.ink, ['bg', 'surface', 'surface-2', 'accent-soft'], f.text);
    need('secondary text', t.muted, ['bg', 'surface', 'surface-2'], f.muted);
    need('accent text', t.accent, ['bg', 'surface'], f.accent);
    const bi = ratio(t['accent-ink'], t.accent); if (bi < f.accent) bad.push(`${id}: button text ${bi.toFixed(2)}`);
    need('control outline', t.edge, ['bg', 'surface'], f.edge);
    ['good', 'mid', 'bad'].forEach(k => {
      need(k, s[k], ['surface'], f.meaning);
      const r = ratio(t.ink, s[k + '-soft']); if (r < 4.5) bad.push(`${id}: text on ${k} tint ${r.toFixed(2)}`);
    });
  })));
  ok('every theme, at every contrast and brightness, clears its floors for every pairing', n === 30 && bad.length === 0, bad.slice(0, 6).join('; ') || `${n} variants`);

  /* No palette today needs its ink, secondary text or button text fitted —
     only accents are moved — so those fits are a net for a palette added
     later, and are proven on a made-up one that needs all four. */
  const weak = { id: 'weak', mode: 'light', t: { bg: '#F2F2F2', surface: '#FFFFFF', 'surface-2': '#E8E8E8', ink: '#777777', muted: '#AAAAAA',
    line: '#EEEEEE', accent: '#66AAFF', 'accent-soft': '#EEF4FF', 'accent-ink': '#BBDDFF' } };
  const wv = L.variant(weak, 'standard', 'standard');
  ok('a palette too faint to read is fitted up to every floor, not drawn as given',
     ['bg', 'surface', 'surface-2', 'accent-soft'].every(g => ratio(wv.ink, wv[g]) >= 7) && ['bg', 'surface', 'surface-2'].every(g => ratio(wv.muted, wv[g]) >= 4.5) &&
     ratio(wv.accent, wv.surface) >= 4.5 && ratio(wv['accent-ink'], wv.accent) >= 4.5 && ratio(wv.edge, wv.surface) >= 3,
     ['ink', 'muted', 'accent', 'accent-ink', 'edge'].map(k => k + ' ' + wv[k]).join(' '));
  /* Standard/Standard is each palette as drawn — with the one colour that
     did not clear its floor, named, and shown to need it. */
  const moved = [];
  L.THEMES.forEach(th => { const v = L.variant(th, 'standard', 'standard'); Object.keys(th.t).forEach(k => { if (v[k] !== th.t[k]) moved.push(th.id + ' ' + k); }); });
  ok('at Standard contrast and brightness every colour comes through as drawn but one', moved.join() === 'daylight muted', moved.join(', ') || 'none moved');
  {
    /* Daylight's secondary text clears 4.5:1 on its cards, but not on the
       second glass (a filled chip's) over the aurora's blue, where no sheen
       lifts it: 4.32:1 as drawn. */
    const th = L.byId('daylight'), v = L.variant(th, 'standard', 'standard'), g = L.glassOf(th, 'standard', v);
    const panes = [th.t.bg].concat(L.GLOW.daylight.aura.map(a => L.over(a, th.t.bg))).map(bk => L.over(g['glass-2'], bk));
    const worst = c => Math.min(...panes.map(x => ratio(c, x)));
    ok('and that one — Daylight’s secondary text — was under 4.5:1 on its glass as drawn, and clears it as fitted',
       ratio(th.t.muted, th.t.surface) >= 4.5 && worst(th.t.muted) < 4.5 && worst(v.muted) >= 4.5, `${worst(th.t.muted).toFixed(2)} → ${worst(v.muted).toFixed(2)}`);
  }
  /* Contrast is the exception: its rules are drawn at 3:1 already. */
  ok('a control’s outline is darker than Systole’s hairline, which is under 3:1 in every theme but Contrast',
     L.THEMES.every(th => (ratio(th.t.line, th.t.surface) < 3) === (th.id !== 'contrast') &&
       (th.id === 'contrast' || L.variant(th, 'standard', 'standard').edge !== th.t.line)), L.THEMES.map(th => th.id + ' ' + ratio(th.t.line, th.t.surface).toFixed(2)).join(' '));

  /* The settings do something, and the thing they say. */
  const lumOf = (th, b) => lum(L.variant(th, 'standard', b).bg);
  ok('Dim darkens the ground and Bright lightens it, in every theme',
     L.THEMES.every(th => lumOf(th, 'dim') < lumOf(th, 'standard') && lumOf(th, 'standard') < lumOf(th, 'bright')),
     L.THEMES.filter(th => !(lumOf(th, 'dim') < lumOf(th, 'standard') && lumOf(th, 'standard') < lumOf(th, 'bright'))).map(t => t.id).join(', ') || 'all');
  ok('brightness moves the grounds, not the text, at Standard contrast',
     L.THEMES.every(th => ['dim', 'bright'].every(b => L.variant(th, 'standard', b).ink === th.t.ink)));
  const gain = (th, k) => ratio(L.variant(th, 'high', 'standard')[k], th.t.bg) - ratio(L.variant(th, 'standard', 'standard')[k], th.t.bg);
  ok('High contrast raises the text and the secondary text against the ground, in every theme',
     L.THEMES.every(th => gain(th, 'ink') > 0.2 && gain(th, 'muted') > 0.5), L.THEMES.map(th => `${th.id} +${gain(th, 'ink').toFixed(1)}/+${gain(th, 'muted').toFixed(1)}`).join(' '));
  const hi = L.css({ contrast: 'high' }), dim = L.css({ bright: 'dim' });
  ok('and the stylesheet the page gets is the one for the setting', hi !== L.css() && dim !== L.css() &&
     hi.indexOf('--ink:' + L.variant(L.byId('daylight'), 'high', 'standard').ink) !== -1 && dim.indexOf('--bg:' + L.variant(L.byId('clinical'), 'standard', 'dim').bg) !== -1);
  ok('High contrast drops the soft shadows for outlines', /--shadow:none/.test(hi) && !/--shadow:none/.test(L.css()));
  ok('the meaning colours are by mode only at High contrast too',
     L.THEMES.every(th => (hi.match(new RegExp(':root\\[data-look="' + th.id + '"\\]\\{[^}]*--good:(#[0-9A-F]{6})', 'i')) || [])[1] === L.SEMANTIC_HIGH[th.mode].good));
}

head('the hero band: each theme’s own, readable across its gradient');
{
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'theme-patch.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'scripts', 'highcontrast-patch.js'), 'utf8');
  const blockOf = re => { const m = src.match(re); const t = {}; if (m) for (const x of m[1].matchAll(/--([a-z0-9-]+):([^;]+);/g)) t[x[1]] = x[2].trim(); return t; };
  const rootDefaults = blockOf(/\n:root\{([\s\S]*?)\n\}/);
  const drift = [];
  let compared = 0;
  L.THEMES.filter(th => th.source).forEach(th => {
    const want = Object.assign({}, rootDefaults, blockOf(new RegExp('data-palette="' + th.source + '"\\]\\{([\\s\\S]*?)\\n\\}')));
    L.HERO_KEYS.forEach(k => { compared++; if ((want[k] || '').toUpperCase() !== String(th.hero[k]).toUpperCase()) drift.push(`${th.id} ${k}: ${th.hero[k]} vs ${want[k]}`); });
  });
  ok('Contrast’s hero is Systole’s, colour for colour', compared === 5 && drift.length === 0, drift.join('; ') || `${compared} compared`);
  const weak = [];
  L.THEMES.forEach(th => ['hero-a', 'hero-b', 'hero-c'].forEach(g => {
    if (ratio(L.heroInk(th), th.hero[g]) < 7) weak.push(`${th.id} ink on ${g}`);
    if (ratio(th.hero['hero-accent'], th.hero[g]) < 4.5) weak.push(`${th.id} accent on ${g}`);
    if (ratio(L.heroMuted(th), th.hero[g]) < 4.5) weak.push(`${th.id} muted on ${g}`);
  }));
  ok('the hero’s text, accent and secondary text are readable across its whole gradient', weak.length === 0, weak.join('; ') || 'all clear');
  ok('a light theme’s hero is light, with the page’s dark ink; a dark theme’s is dark, with light ink',
     ['daylight', 'paper'].every(id => lum(L.byId(id).hero['hero-a']) > 0.8 && L.heroInk(L.byId(id)) === L.byId(id).t.ink) &&
     ['clinical', 'neuron', 'contrast'].every(id => lum(L.byId(id).hero['hero-a']) < 0.05 && lum(L.heroInk(L.byId(id))) > 0.8));
  /* The pills on the hero are tinted by the hero, not by a white that
     vanishes on a white band: dark on Daylight's, light on the others. */
  const css = L.css();
  const tok = (id, k) => (css.match(new RegExp(':root\\[data-look="' + id + '"\\]\\{[^}]*--' + k + ':(rgba\\([^)]*\\))')) || [])[1] || '';
  ok('the hero’s pills are a dark tint on a light hero and a light one on a dark hero',
     L.THEMES.every(th => (th.mode === 'light' ? /^rgba\((0,0,0|60,40,20),/ : /^rgba\(255,255,255,/).test(tok(th.id, 'hero-pill'))),
     L.THEMES.map(th => th.id + ' ' + tok(th.id, 'hero-pill')).join(' '));
  const appcss = fs.readFileSync(path.join(ROOT, 'memorizer', 'app.css'), 'utf8');
  const pill = (appcss.match(/\.home-hero \.pill\.stat \{[^}]*\}/) || [''])[0], track = (appcss.match(/\.home-hero \.stat-ring \.ring \.track \{[^}]*\}/) || [''])[0];
  ok('and app.css draws them, and the ring’s track, with those tokens', /background: var\(--hero-pill\)/.test(pill) && /var\(--hero-pill-edge\)/.test(track), pill.slice(0, 120));
}

head('glass and glow: the aurora and second accent, and text readable on glass over it');
{
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'theme-patch.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'scripts', 'highcontrast-patch.js'), 'utf8');
  const blockOf = re => { const m = src.match(re); const t = {}; if (m) for (const x of m[1].matchAll(/--([a-z0-9-]+):([^;]+);/g)) t[x[1]] = x[2].trim(); return t; };
  const rootDefaults = blockOf(/\n:root\{([\s\S]*?)\n\}/);
  const drift = [];
  let compared = 0;
  L.THEMES.filter(th => th.source).forEach(th => {
    const g = L.GLOW[th.id], s = blockOf(new RegExp('data-palette="' + th.source + '"\\]\\{([\\s\\S]*?)\\n\\}'));
    const want = Object.assign({}, rootDefaults, s);
    [1, 2, 3].forEach(i => { compared++; if ((want['aura-' + i] || '').replace(/\s/g, '') !== g.aura[i - 1].replace(/\s/g, '')) drift.push(`${th.id} aura-${i}: ${g.aura[i - 1]} vs ${want['aura-' + i]}`); });
    compared++;
    const t2 = s.teal2 === 'var(--accent-2)' ? s['accent-2'] : (s.teal2 || s['accent-2']);
    if ((t2 || '').toUpperCase() !== g.a2.toUpperCase()) drift.push(`${th.id} accent-2: ${g.a2} vs ${t2}`);
  });
  ok('Contrast’s aurora and second accent are Systole’s', compared === 4 && drift.length === 0, drift.join('; ') || `${compared} compared`);
  /* The owner's two: the aurora is kept, faint — a colour in the corner of
     the eye. Held to it, so a louder one is a decision, not a drift. */
  const loud = [];
  L.THEMES.filter(th => !th.source).forEach(th => L.GLOW[th.id].aura.forEach((a, i) => { if (!(parseRgba(a)[3] > 0 && parseRgba(a)[3] <= 0.16)) loud.push(th.id + ' aura-' + (i + 1) + ' ' + a); }));
  ok('the aurora of each theme drawn for Memorizer is there, and faint: every colour at 16% or less', L.THEMES.filter(th => !th.source).length === 4 && loud.length === 0, loud.join('; ') || 'all faint');

  /* Glass over the aurora. The backdrop behind a glass card is the ground
     with an aurora colour over it; the card is the surface at its alpha over
     that. Text on the card must clear the same floors as text on a card. */
  const FLOOR = { standard: { text: 7, muted: 4.5, accent: 4.5 }, high: { text: 10, muted: 7, accent: 7 } };
  const bad = [];
  let n = 0;
  L.THEMES.forEach(th => ['standard', 'high'].forEach(c => ['dim', 'standard', 'bright'].forEach(b => {
    const t = L.variant(th, c, b), g = L.glassOf(th, c, t), f = FLOOR[c];
    const backs = [t.bg].concat(L.GLOW[th.id].aura.map(a => L.over(a, t.bg)));
    backs.forEach((back, bi) => ['glass', 'glass-2'].forEach(k => {
      n++;
      const card = L.over(g[k], back);
      const need = (what, fg, min) => { const r = ratio(fg, card); if (r < min) bad.push(`${th.id}/${c}/${b} ${what} on ${k} over aura ${bi} ${r.toFixed(2)} < ${min}`); };
      need('text', t.ink, f.text); need('secondary text', t.muted, f.muted);
      if (k === 'glass') need('accent', t.accent, f.accent);
    }));
    const bt = ratio(t['accent-ink'], t['accent-2']);
    if (bt < f.accent) bad.push(`${th.id}/${c}/${b} button text on accent-2 ${bt.toFixed(2)}`);
  })));
  ok('text on glass over every aurora colour clears its floors, in every theme and setting, and so does button text on the second accent',
     n === 240 && bad.length === 0, bad.slice(0, 5).join('; ') || `${n} glass composites`);
  /* The same, under the glass's sheen and the finger's light at their
     brightest (both white over the card, where the text is): a white that
     lifts a light page only helps dark text, but one on a dark page costs
     light text its floor, so this is where a too-bright sheen shows. */
  {
    const dim = [];
    let m = 0;
    L.THEMES.forEach(th => ['standard', 'high'].forEach(c => ['dim', 'standard', 'bright'].forEach(b => {
      const t = L.variant(th, c, b), g = L.glassOf(th, c, t), f = FLOOR[c];
      [t.bg].concat(L.GLOW[th.id].aura.map(a => L.over(a, t.bg))).forEach((back, bi) => ['glass', 'glass-2'].forEach(k => {
        m++;
        const lit = L.over(g['glass-light'], L.over(g['glass-sheen'], L.over(g[k], back)));
        const need = (what, fg, min) => { const r = ratio(fg, lit); if (r < min) dim.push(`${th.id}/${c}/${b} ${what} on lit ${k} over aura ${bi} ${r.toFixed(2)} < ${min}`); };
        need('text', t.ink, f.text); need('secondary text', t.muted, f.muted);
        if (k === 'glass') need('accent', t.accent, f.accent);
      }));
    })));
    ok('and under the sheen and the finger’s light, at their brightest, every one still clears its floors', m === n && dim.length === 0, dim.slice(0, 5).join('; ') || `${m} lit composites`);
    ok('the sheen and the light are there on a light page, and opaque surfaces have neither',
       ['glass-sheen', 'glass-light', 'glass-rim'].every(k => parseRgba(L.glassOf(L.byId('daylight'), 'standard', L.variant(L.byId('daylight'), 'standard', 'standard'))[k])[3] > 0 &&
         parseRgba(L.glassOf(L.byId('daylight'), 'high', L.variant(L.byId('daylight'), 'high', 'standard'))[k])[3] === 0));
  }
  const hi = L.glassOf(L.byId('clinical'), 'high', L.variant(L.byId('clinical'), 'high', 'standard'));
  const ct = L.glassOf(L.byId('contrast'), 'standard', L.variant(L.byId('contrast'), 'standard', 'standard'));
  const st = L.glassOf(L.byId('daylight'), 'standard', L.variant(L.byId('daylight'), 'standard', 'standard'));
  ok('at High contrast and in the Contrast theme surfaces are opaque, with no blur', /,1\)$/.test(hi.glass) && hi['glass-blur'] === '0px' && /,1\)$/.test(ct.glass) && ct['glass-blur'] === '0px' &&
     /,0\.52\)$/.test(st.glass) && st['glass-blur'] !== '0px', JSON.stringify([hi.glass, ct.glass, st.glass]));
  /* app.css's fallbacks, for the moment before appearance.js runs, are
     Daylight's generated glass tokens — a second copy, so held equal. */
  {
    const appcss = fs.readFileSync(path.join(ROOT, 'memorizer', 'app.css'), 'utf8');
    const fb = (appcss.match(/:root \{ --accent-2:[^}]*\}/) || [''])[0];
    const gen = L.css({ theme: 'daylight', contrast: 'standard', bright: 'standard' });
    const norm = v => String(v).replace(/\s/g, '').replace(/0\./g, '.').toUpperCase();
    const keys = ['accent-2', 'glass', 'glass-strong', 'glass-2', 'glass-edge', 'glass-blur', 'glass-rim', 'glass-sheen', 'glass-light', 'aura-1', 'aura-2', 'aura-3'];
    const off = keys.filter(k => { const a = fb.match(new RegExp('--' + k + ':\\s*([^;]+);')), b = gen.match(new RegExp('--' + k + ':([^;]+);'));
      return !a || !b || norm(a[1]) !== norm(b[1]); });
    ok('app.css’s fallbacks before the script runs are Daylight’s glass tokens', fb && off.length === 0, off.join(', ') || keys.length + ' tokens');
  }
  ok('and the stylesheet carries the glass and aurora tokens for every theme', L.THEMES.every(th => new RegExp(':root\\[data-look="' + th.id + '"\\]\\{[^}]*--glass:rgba[^}]*--aura-1:rgba').test(L.css())));
}

head('the stylesheet covers every setting');
{
  const css = L.css();
  ok('a rule for every theme', L.THEMES.every(t => css.indexOf(':root[data-look="' + t.id + '"]{') !== -1));
  ok('Auto is Daylight, and Clinical when the device is dark', /:root\[data-look="auto"\]\{--bg:#F2F2F7/.test(css) && /@media \(prefers-color-scheme: dark\)\{:root\[data-look="auto"\]\{--bg:#050608/.test(css));
  ok('a rule for every text size, in px on the root so rem scales everything', L.OPTIONS.size.every(o => css.indexOf(':root[data-size="' + o[0] + '"]{font-size:' + o[2] + 'px}') !== -1));
  ok('and for every width, spacing and font', ['width', 'spacing'].every(k => L.OPTIONS[k].every(o => css.indexOf('data-' + k + '="' + o[0] + '"') !== -1)) &&
     L.OPTIONS.font.every(o => css.indexOf('data-font="' + o[0] + '"') !== -1));
  const appcss = fs.readFileSync(path.join(ROOT, 'memorizer', 'app.css'), 'utf8');
  const pxFonts = (appcss.match(/font(?:-size)?:[^;]*\b\d+px/g) || []);
  ok('app.css sets no font size in px, so text size reaches all of it', pxFonts.length === 0, pxFonts.join(' | ') || 'none');
  ok('app.css uses Systole’s type ladder tokens', /--t-body:\s*1rem/.test(appcss) && /--t-lead:\s*1\.1875rem/.test(appcss) && /--t-h4:\s*1\.4375rem/.test(appcss));
  ok('and every var() it uses for colour is one the themes define', (() => {
    const used = [...new Set([...appcss.matchAll(/var\(--([a-z0-9-]+)\)/g)].map(m => m[1]))];
    const defined = [...L.css().matchAll(/--([a-z0-9-]+):/g)].map(m => m[1]).concat([...appcss.matchAll(/--([a-z0-9-]+):/g)].map(m => m[1]));
    const missing = used.filter(u => defined.indexOf(u) === -1);
    return missing.length === 0 || (console.log('    undefined: ' + missing.join(', ')), false);
  })());
}

head('the brain’s colours: every theme’s, and a theme’s own where it names them');
{
  const css = L.css();
  const tokOf = (id, k) => (css.match(new RegExp(':root\\[data-look="' + id + '"\\]\\{[^}]*--brain-' + k + ':([^;]+);')) || [])[1];
  const keys = Object.keys(L.BRAIN_TONES.light);
  ok('every theme’s stylesheet carries every brain colour', L.THEMES.every(th => keys.every(k => tokOf(th.id, k))) && keys.length === 15,
     L.THEMES.map(th => th.id + ':' + keys.filter(k => !tokOf(th.id, k)).join('/')).join(' '));
  ok('a theme with no brain of its own takes its mode’s; one that names its own gets it', tokOf('daylight', 't1') === L.BRAIN_TONES.light.t1 &&
     tokOf('clinical', 't1') === L.BRAIN_TONES.dark.t1 && tokOf('neuron', 't1') === L.byId('neuron').brain.t1 && tokOf('paper', 'sulcus') === L.byId('paper').brain.sulcus,
     ['daylight', 'clinical', 'neuron', 'paper'].map(id => id + ' ' + tokOf(id, 't1')).join(' | '));
  /* A dormant neuron is drawn on the brain's tissue, not on a card: it has
     to be told from the tissue under it, and its outline (the dendrite
     colour) seen. Held at 1.2:1 fill and 1.5:1 outline against the tissue's
     middle tone over the ground — a shape, not text. */
  const flat = (c, bg) => /^rgba/.test(c) ? L.over(c, bg) : c;
  const weakN = L.THEMES.filter(th => {
    const b = L.brainOf(th), g = th.t.bg, tissue = flat(b.t2, g);
    return L.ratio(flat(b.dendrite, tissue), tissue) < 1.5;
  }).map(th => th.id);
  ok('a dormant neuron’s outline stands off the brain behind it, in every theme', weakN.length === 0, weakN.join(', ') || 'all');
}

head('settings come back as known values');
{
  const mem = v => ({ getItem: () => v, setItem: () => {} });
  ok('nothing saved: the defaults', JSON.stringify(L.load(mem(null))) === JSON.stringify(L.DEFAULT));
  const junk = L.load(mem(JSON.stringify({ theme: 'hotpink', size: 'huge', width: 'narrow', font: 42 })));
  ok('unknown values fall back, known ones are kept', junk.theme === 'auto' && junk.size === 'm' && junk.width === 'narrow' && junk.font === 'sans', JSON.stringify(junk));
  ok('a torn save is the defaults, not a throw', JSON.stringify(L.load(mem('{not json'))) === JSON.stringify(L.DEFAULT));
  const attrs = {};
  const el = { setAttribute: (k, v) => { attrs[k] = v; } };
  L.apply({ theme: 'clinical', size: 'xl' }, el, { getElementById: () => ({}) });
  ok('apply sets one attribute per setting, normalised', attrs['data-look'] === 'clinical' && attrs['data-size'] === 'xl' && attrs['data-width'] === 'standard' &&
     attrs['data-hook'] === 'side' && attrs['data-contrast'] === 'standard' && attrs['data-bright'] === 'standard', JSON.stringify(attrs));
  /* A style element that already exists is rewritten when the setting
     changes — the first version wrote it once and never again. */
  const style = { textContent: '' };
  const d = { getElementById: () => style };
  L.apply({ theme: 'daylight' }, el, d);
  const first = style.textContent;
  L.apply({ theme: 'daylight', contrast: 'high', bright: 'dim' }, el, d);
  ok('changing contrast or brightness rewrites the stylesheet in place', first === L.css({}) && style.textContent === L.css({ contrast: 'high', bright: 'dim' }) &&
     attrs['data-contrast'] === 'high' && attrs['data-bright'] === 'dim');
  ok('a theme saved before the owner’s two replaced it comes back as Auto', L.load(mem(JSON.stringify({ theme: 'nocturne', size: 'l' }))).theme === 'auto' &&
     L.load(mem(JSON.stringify({ theme: 'nocturne', size: 'l' }))).size === 'l');
  ok('isDark follows the theme, and the device under Auto', L.isDark({ theme: 'clinical' }) && !L.isDark({ theme: 'daylight' }) &&
     L.isDark({ theme: 'auto' }, true) && !L.isDark({ theme: 'auto' }, false));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
