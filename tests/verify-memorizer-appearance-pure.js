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
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

head('the nine themes are Systole’s nine');
{
  const ids = L.THEMES.map(t => t.id);
  ok('eight palettes plus Auto', ids.length === 8 && L.AUTO && L.AUTO.light === 'daylight' && L.AUTO.dark === 'midnight', ids.join(', '));
  /* Systole's THEMES list, read from its own source. */
  const tp = fs.readFileSync(path.join(ROOT, 'scripts', 'theme-patch.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'scripts', 'highcontrast-patch.js'), 'utf8');
  const systole = [...tp.matchAll(/\{id:'([a-z]+)',\s*name:'([^']+)'/g)].map(m => m[1]);
  ok('the same ids, and names, as Systole’s theme picker', ['auto'].concat(ids).every(id => systole.indexOf(id) !== -1) &&
     L.THEMES.every(t => new RegExp("\\{id:'" + t.id + "',\\s*name:'" + t.name.replace(' ', ' ') + "'").test(tp)), systole.join(', '));
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
    const defined = Object.keys(L.THEMES[0].t).concat(Object.keys(L.SEMANTIC.light), ['measure', 'leading', 'font'],
      [...appcss.matchAll(/--([a-z0-9-]+):/g)].map(m => m[1]));
    return used.every(u => defined.indexOf(u) !== -1);
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
     attrs['data-hook'] === 'side', JSON.stringify(attrs));
  ok('isDark follows the theme, and the device under Auto', L.isDark({ theme: 'monitor' }) && !L.isDark({ theme: 'parchment' }) &&
     L.isDark({ theme: 'auto' }, true) && !L.isDark({ theme: 'auto' }, false));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
