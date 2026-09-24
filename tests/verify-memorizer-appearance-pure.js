#!/usr/bin/env node
/*
 * Memorizer's themes are Systole's themes, and every one of them is readable.
 *
 *   node tests/verify-memorizer-appearance-pure.js
 *
 * Pure Node. memorizer/src/appearance.js holds the palettes as data and
 * generates the stylesheet from them. Two things are proven about that data:
 *
 *   · PORTED, NOT INVENTED. For every theme with a Systole source block, each
 *     colour is read out of scripts/theme-patch.js or
 *     scripts/highcontrast-patch.js and compared, value for value. A palette
 *     edited in either app without the other fails here.
 *   · READABLE. WCAG contrast ratios, computed, for every pairing the page
 *     actually draws: body and secondary text on the ground and on cards,
 *     accent-coloured text, text on accent buttons, and the right/wrong/partly
 *     colours on their own tints — in all nine themes, and both halves of Auto.
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

head('the nine themes are Systole’s nine');
{
  const ids = L.THEMES.map(t => t.id);
  ok('eight palettes plus Auto', ids.length === 8 && L.AUTO && L.AUTO.light === 'daylight' && L.AUTO.dark === 'midnight', ids.join(', '));
  /* Systole's THEMES list, read from its own source. */
  const tp = fs.readFileSync(path.join(ROOT, 'scripts', 'theme-patch.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'scripts', 'highcontrast-patch.js'), 'utf8');
  /* id → name, read as pairs and compared as strings. The first version
     built a regex from each name with a no-op replace(' ', ' ') where an
     escape belonged — CodeQL flagged it (alert 18). */
  const systole = {};
  for (const m of tp.matchAll(/\{id:'([a-z]+)',\s*name:'([^']+)'/g)) systole[m[1]] = m[2];
  const mismatch = L.THEMES.filter(t => systole[t.id] !== t.name).map(t => `${t.id}: "${t.name}" vs Systole "${systole[t.id]}"`);
  ok('the same ids, and names, as Systole’s theme picker', 'auto' in systole && mismatch.length === 0,
     mismatch.join('; ') || Object.keys(systole).join(', '));
  ok('each swatch is the one Systole’s picker shows', L.THEMES.every(t => new RegExp("id:'" + t.id + "'[^}]*bg:'" + t.swatch[0] + "',ac:'" + t.swatch[1] + "'", 'i').test(tp)),
     L.THEMES.filter(t => !new RegExp("id:'" + t.id + "'[^}]*bg:'" + t.swatch[0] + "',ac:'" + t.swatch[1] + "'", 'i').test(tp)).map(t => t.id).join(', ') || 'all match');
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
  ok('the source blocks were found and read', compared >= 48, `${compared} colours compared`);
  ok('every ported colour is Systole’s, exactly', drift.length === 0, drift.join('; ') || 'no drift');
  ok('Daylight and Midnight, which have no Systole block to read, say so', L.THEMES.filter(t => !t.source).map(t => t.id).join() === 'daylight,midnight');
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
  ok('all nine themes clear AA for every text pairing the page draws (7:1 for body text)', bad.length === 0, bad.join('; ') || `${L.THEMES.length} themes × 14 pairings`);
  ok('Daylight’s accent was darkened from Systole’s for text, and needed to be',
     ratio('#0284C7', '#FFFFFF') < 4.5 && ratio(L.byId('daylight').t.accent, '#FFFFFF') >= 4.5, `${ratio('#0284C7', '#FFFFFF').toFixed(2)} → ${ratio(L.byId('daylight').t.accent, '#FFFFFF').toFixed(2)}`);
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
  ok('every theme, at every contrast and brightness, clears its floors for every pairing', n === 48 && bad.length === 0, bad.slice(0, 6).join('; ') || `${n} variants`);

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
  /* Standard/Standard is Systole, untouched — with the one colour that did
     not clear its floor, named, and shown to need it. */
  const moved = [];
  L.THEMES.forEach(th => { const v = L.variant(th, 'standard', 'standard'); Object.keys(th.t).forEach(k => { if (v[k] !== th.t[k]) moved.push(th.id + ' ' + k); }); });
  ok('at Standard contrast and brightness every ported colour comes through unchanged but one', moved.join() === 'parchment accent', moved.join(', ') || 'none moved');
  const pa = L.byId('parchment').t;
  ok('and that one — Parchment’s accent on its own ground — was under 4.5:1 as Systole has it',
     ratio(pa.accent, pa.bg) < 4.5 && ratio(L.variant(L.byId('parchment'), 'standard', 'standard').accent, pa.bg) >= 4.5,
     `${ratio(pa.accent, pa.bg).toFixed(2)} → ${ratio(L.variant(L.byId('parchment'), 'standard', 'standard').accent, pa.bg).toFixed(2)}`);
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
     hi.indexOf('--ink:' + L.variant(L.byId('slate'), 'high', 'standard').ink) !== -1 && dim.indexOf('--bg:' + L.variant(L.byId('monitor'), 'standard', 'dim').bg) !== -1);
  ok('High contrast drops the soft shadows for outlines', /--shadow:none/.test(hi) && !/--shadow:none/.test(L.css()));
  ok('the meaning colours are by mode only at High contrast too',
     L.THEMES.every(th => (hi.match(new RegExp(':root\\[data-look="' + th.id + '"\\]\\{[^}]*--good:(#[0-9A-F]{6})', 'i')) || [])[1] === L.SEMANTIC_HIGH[th.mode].good));
}

head('the hero band is Systole’s');
{
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'theme-patch.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'scripts', 'highcontrast-patch.js'), 'utf8');
  const blockOf = re => { const m = src.match(re); const t = {}; if (m) for (const x of m[1].matchAll(/--([a-z0-9-]+):([^;]+);/g)) t[x[1]] = x[2].trim(); return t; };
  const rootDefaults = blockOf(/\n:root\{([\s\S]*?)\n\}/);
  const lightDefaults = Object.assign({}, rootDefaults, blockOf(/\nhtml\[data-theme="light"\]\{([\s\S]*?)\n\}/));
  const KEYS = ['hero-a', 'hero-b', 'hero-c', 'hero-accent', 'hero-edge'];
  const drift = [];
  let compared = 0;
  L.THEMES.forEach(th => {
    const s = th.source ? blockOf(new RegExp('data-palette="' + th.source + '"\\]\\{([\\s\\S]*?)\\n\\}')) : {};
    const want = Object.assign({}, th.mode === 'light' ? lightDefaults : rootDefaults, s);
    KEYS.forEach(k => { compared++; if (!th.hero || (want[k] || '').toUpperCase() !== String(th.hero[k]).toUpperCase()) drift.push(`${th.id} ${k}: ${th.hero && th.hero[k]} vs ${want[k]}`); });
  });
  ok('every hero colour is Systole’s, palette by palette (Daylight and Midnight from its light and dark defaults)', compared === 40 && drift.length === 0, drift.join('; ') || `${compared} compared`);
  const weak = [];
  L.THEMES.forEach(th => ['hero-a', 'hero-b', 'hero-c'].forEach(g => {
    if (ratio(L.HERO_INK, th.hero[g]) < 7) weak.push(`${th.id} ink on ${g}`);
    if (ratio(th.hero['hero-accent'], th.hero[g]) < 4.5) weak.push(`${th.id} accent on ${g}`);
    if (ratio(L.heroMuted(th), th.hero[g]) < 4.5) weak.push(`${th.id} muted on ${g}`);
  }));
  ok('the hero’s text, accent and secondary text are readable across its whole gradient', weak.length === 0, weak.join('; ') || 'all clear');
}

head('glass and glow: Systole’s aurora and second accent, and text readable on glass over it');
{
  const semantic = fs.readFileSync(path.join(ROOT, 'scripts', 'semantictokens-patch.js'), 'utf8');
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'theme-patch.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'scripts', 'highcontrast-patch.js'), 'utf8');
  const blockOf = re => { const m = src.match(re); const t = {}; if (m) for (const x of m[1].matchAll(/--([a-z0-9-]+):([^;]+);/g)) t[x[1]] = x[2].trim(); return t; };
  const rootDefaults = blockOf(/\n:root\{([\s\S]*?)\n\}/);
  const drift = [];
  let compared = 0;
  L.THEMES.forEach(th => {
    const g = L.GLOW[th.id];
    if (!g) { drift.push(th.id + ': no glow'); return; }
    const s = th.source ? blockOf(new RegExp('data-palette="' + th.source + '"\\]\\{([\\s\\S]*?)\\n\\}')) : {};
    const want = Object.assign({}, rootDefaults, s);
    [1, 2, 3].forEach(i => { compared++; if ((want['aura-' + i] || '').replace(/\s/g, '') !== g.aura[i - 1].replace(/\s/g, '')) drift.push(`${th.id} aura-${i}: ${g.aura[i - 1]} vs ${want['aura-' + i]}`); });
    /* Daylight is Systole's root palette: its second accent is the root
       --teal2 there. Midnight has none to read, and its chosen one is held
       to what the comment says it is: aura-2's colour, lighter than its
       own accent. */
    if (th.id === 'daylight') { compared++; const r = (semantic.match(/--teal:#0284C7;--teal2:(#[0-9A-F]{6});/) || [])[1]; if (!r || r !== g.a2.toUpperCase()) drift.push(`daylight accent-2: ${g.a2} vs ${r}`); }
    if (th.id === 'midnight') { compared++; const hex = '#' + g.aura[1].match(/\d+/g).slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('').toUpperCase();
      if (g.a2.toUpperCase() !== hex || lum(g.a2) <= lum(th.swatch[1])) drift.push(`midnight accent-2: ${g.a2} vs aura-2 ${hex}`); }
    if (th.source) {
      compared++;
      const t2 = s.teal2 === 'var(--accent-2)' ? s['accent-2'] : (s.teal2 || s['accent-2']);
      if ((t2 || '').toUpperCase() !== g.a2.toUpperCase()) drift.push(`${th.id} accent-2: ${g.a2} vs ${t2}`);
    }
  });
  ok('every aurora colour and second accent is Systole’s, palette by palette (Midnight’s, which Systole lacks, is aura-2’s colour)', compared === 32 && drift.length === 0, drift.join('; ') || `${compared} compared`);

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
     n === 384 && bad.length === 0, bad.slice(0, 5).join('; ') || `${n} glass composites`);
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
         parseRgba(L.glassOf(L.byId('slate'), 'high', L.variant(L.byId('slate'), 'high', 'standard'))[k])[3] === 0));
  }
  ok('Systole’s second accent was too light for white button text in three light themes, and is fitted there',
     ['daylight', 'slate', 'parchment'].every(id => ratio('#FFFFFF', L.GLOW[id].a2) < 4.5 && L.variant(L.byId(id), 'standard', 'standard')['accent-2'] !== L.GLOW[id].a2) &&
     ['midnight', 'nocturne', 'cathlab', 'monitor', 'contrast'].every(id => L.variant(L.byId(id), 'standard', 'standard')['accent-2'] === L.GLOW[id].a2));
  const hi = L.glassOf(L.byId('slate'), 'high', L.variant(L.byId('slate'), 'high', 'standard'));
  const ct = L.glassOf(L.byId('contrast'), 'standard', L.variant(L.byId('contrast'), 'standard', 'standard'));
  const st = L.glassOf(L.byId('slate'), 'standard', L.variant(L.byId('slate'), 'standard', 'standard'));
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
  ok('Auto is Daylight, and Midnight when the device is dark', /:root\[data-look="auto"\]\{--bg:#EFF3F8/.test(css) && /@media \(prefers-color-scheme: dark\)\{:root\[data-look="auto"\]\{--bg:#0A1628/.test(css));
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

head('settings come back as known values');
{
  const mem = v => ({ getItem: () => v, setItem: () => {} });
  ok('nothing saved: the defaults', JSON.stringify(L.load(mem(null))) === JSON.stringify(L.DEFAULT));
  const junk = L.load(mem(JSON.stringify({ theme: 'hotpink', size: 'huge', width: 'narrow', font: 42 })));
  ok('unknown values fall back, known ones are kept', junk.theme === 'auto' && junk.size === 'm' && junk.width === 'narrow' && junk.font === 'sans', JSON.stringify(junk));
  ok('a torn save is the defaults, not a throw', JSON.stringify(L.load(mem('{not json'))) === JSON.stringify(L.DEFAULT));
  const attrs = {};
  const el = { setAttribute: (k, v) => { attrs[k] = v; } };
  L.apply({ theme: 'cathlab', size: 'xl' }, el, { getElementById: () => ({}) });
  ok('apply sets one attribute per setting, normalised', attrs['data-look'] === 'cathlab' && attrs['data-size'] === 'xl' && attrs['data-width'] === 'standard' &&
     attrs['data-hook'] === 'side' && attrs['data-contrast'] === 'standard' && attrs['data-bright'] === 'standard', JSON.stringify(attrs));
  /* A style element that already exists is rewritten when the setting
     changes — the first version wrote it once and never again. */
  const style = { textContent: '' };
  const d = { getElementById: () => style };
  L.apply({ theme: 'slate' }, el, d);
  const first = style.textContent;
  L.apply({ theme: 'slate', contrast: 'high', bright: 'dim' }, el, d);
  ok('changing contrast or brightness rewrites the stylesheet in place', first === L.css({}) && style.textContent === L.css({ contrast: 'high', bright: 'dim' }) &&
     attrs['data-contrast'] === 'high' && attrs['data-bright'] === 'dim');
  ok('isDark follows the theme, and the device under Auto', L.isDark({ theme: 'monitor' }) && !L.isDark({ theme: 'parchment' }) &&
     L.isDark({ theme: 'auto' }, true) && !L.isDark({ theme: 'auto' }, false));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
