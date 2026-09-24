/* ═══════════════════════════════════════════════════════════════════════════
   appearance.js — themes, text size and layout, from Systole.

   THE THEMES ARE SYSTOLE'S. The eight presets of scripts/theme-patch.js and
   the ninth of scripts/highcontrast-patch.js, with their palette colours
   carried over value for value — tests/verify-memorizer-appearance-pure.js
   reads both patch scripts and fails if a ported colour drifts from its
   source. Systole's rules come with them: no pure black or white outside
   Contrast, and the colours that MEAN something (green right, red wrong,
   amber partly) are not themed, so what they mean never shifts underneath
   you; they change only between light and dark.

   TWO ADAPTATIONS, both measured, both said here rather than hidden:
     · Daylight and Midnight are Systole's own default look, and their full
       palettes live in the licensed export's stylesheet, which this project
       does not read. They are rebuilt from what theme-patch.js does publish
       for them — the swatch ground and accent (#EFF3F8/#0284C7,
       #0A1628/#0EA5E9) — with the rest chosen to the same rules.
     · Daylight's accent is used as text here (section labels, links), and
       #0284C7 on white is 4.1:1, under the 4.5:1 text needs. It is darkened
       to #0369A1 (5.9:1). The swatch keeps Systole's colour.

   SIZE is Systole's type ladder — a minor third (1.2) from a 16px body,
   tokens --t-* in app.css — with the body step itself scalable: Small 15,
   Standard 16, Large 18, Extra large 20. Everything is in rem, so the whole
   page scales together and the ladder's proportions hold.

   PURE except apply(), which touches only the document element it is given
   and one <style> element.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

/* Semantic colours: by mode only, never by palette (Systole's rule). */
var SEMANTIC = {
  light: { good: '#1F7A4A', 'good-soft': '#E1F2E8', mid: '#8A5A00', 'mid-soft': '#FBF0D6', bad: '#B3261E', 'bad-soft': '#F9E3E1' },
  dark:  { good: '#6FD39B', 'good-soft': '#17301F', mid: '#F0C060', 'mid-soft': '#33290F', bad: '#FF8A80', 'bad-soft': '#3A1B19' },
};

/* source: which Systole block the colours come from, for the drift test.
   Tokens: bg, surface (Systole --card), surface-2, ink (--text), muted,
   line (--border), accent (--teal), accent-soft (--teal4), accent-ink. */
var THEMES = [
  { id: 'daylight', name: 'Daylight', mode: 'light', swatch: ['#EFF3F8', '#0284C7'], source: null,
    t: { bg: '#EFF3F8', surface: '#FFFFFF', 'surface-2': '#E6ECF3', ink: '#0F1E33', muted: '#4A5A70', line: '#D3DCE7',
         accent: '#0369A1', 'accent-soft': '#E3F0FA', 'accent-ink': '#FFFFFF' } },
  { id: 'slate', name: 'Slate', mode: 'light', swatch: ['#EDF0F6', '#6366F1'], source: 'slate',
    t: { bg: '#EDF0F6', surface: '#FFFFFF', 'surface-2': '#E7EBF3', ink: '#1E2536', muted: '#4B5568', line: '#D3D9E6',
         accent: '#4F5BD5', 'accent-soft': '#EDEFFD', 'accent-ink': '#FFFFFF' } },
  { id: 'parchment', name: 'Parchment', mode: 'light', swatch: ['#F3ECDD', '#0E7C86'], source: 'parchment',
    t: { bg: '#F3ECDD', surface: '#FBF6EC', 'surface-2': '#EFE7D6', ink: '#372E20', muted: '#6A5B45', line: '#E2D7C2',
         accent: '#0E7C86', 'accent-soft': '#E6F2EF', 'accent-ink': '#FFFFFF' } },
  { id: 'midnight', name: 'Midnight', mode: 'dark', swatch: ['#0A1628', '#0EA5E9'], source: null,
    t: { bg: '#0A1628', surface: '#11213A', 'surface-2': '#172A47', ink: '#E6EDF7', muted: '#9FB0C8', line: '#22385A',
         accent: '#0EA5E9', 'accent-soft': '#0E2A45', 'accent-ink': '#06121F' } },
  { id: 'nocturne', name: 'Nocturne', mode: 'dark', swatch: ['#0E0B1A', '#A78BFA'], source: 'nocturne',
    t: { bg: '#0E0B1A', surface: '#17132B', 'surface-2': '#231D3E', ink: '#EDE9F7', muted: '#A79FC4', line: '#2A2348',
         accent: '#A78BFA', 'accent-soft': '#221B40', 'accent-ink': '#0E0B1A' } },
  { id: 'cathlab', name: 'Cath Lab', mode: 'dark', swatch: ['#120C07', '#F59E0B'], source: 'cathlab',
    t: { bg: '#120C07', surface: '#1D140B', 'surface-2': '#2C1F12', ink: '#F5EDE1', muted: '#C6AF93', line: '#3A2A18',
         accent: '#F59E0B', 'accent-soft': '#2A1E08', 'accent-ink': '#120C07' } },
  { id: 'monitor', name: 'Monitor', mode: 'dark', swatch: ['#08110D', '#2DD4BF'], source: 'monitor',
    t: { bg: '#08110D', surface: '#0F1A15', 'surface-2': '#16271E', ink: '#E6F4EC', muted: '#93B7A4', line: '#1E3328',
         accent: '#2DD4BF', 'accent-soft': '#082820', 'accent-ink': '#08110D' } },
  { id: 'contrast', name: 'Contrast', mode: 'dark', swatch: ['#060606', '#38BDF8'], source: 'contrast',
    t: { bg: '#060606', surface: '#121212', 'surface-2': '#1E1E1E', ink: '#FAFAFA', muted: '#D6D6D6', line: '#666666',
         accent: '#38BDF8', 'accent-soft': '#082F49', 'accent-ink': '#060606' } },
];
/* Auto follows the device: Daylight by day, Midnight at night. */
var AUTO = { id: 'auto', name: 'Auto', light: 'daylight', dark: 'midnight' };

var OPTIONS = {
  size:    [['s', 'Small', 15], ['m', 'Standard', 16], ['l', 'Large', 18], ['xl', 'Extra large', 20]],
  width:   [['narrow', 'Narrow', 40], ['standard', 'Standard', 48], ['wide', 'Wide', 72]],
  spacing: [['compact', 'Compact', 1.4], ['standard', 'Standard', 1.6], ['relaxed', 'Relaxed', 1.8]],
  font:    [['sans', 'Sans'], ['serif', 'Serif'], ['readable', 'Readable']],
  hook:    [['side', 'Beside the points'], ['below', 'Below the points']],
};
var FONTS = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: '"Iowan Old Style", "Charter", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif',
  readable: 'Verdana, "Atkinson Hyperlegible", Tahoma, "Trebuchet MS", sans-serif',
};
var DEFAULT = { theme: 'auto', size: 'm', width: 'standard', spacing: 'standard', font: 'sans', hook: 'side' };
var KEY = 'memorizer.look.v1';

function byId(id) { for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i]; return null; }
function optValue(kind, id) {
  var o = OPTIONS[kind].filter(function (x) { return x[0] === id; })[0];
  return o ? o[2] : null;
}

/* Whatever is saved, only known values come back: an unknown theme or size
   is the default, never an attribute the CSS has no rule for. */
function normalise(look) {
  var out = {};
  Object.keys(DEFAULT).forEach(function (k) {
    var v = look && look[k];
    var ok = k === 'theme' ? (v === 'auto' || !!byId(v)) : OPTIONS[k].some(function (o) { return o[0] === v; });
    out[k] = ok ? v : DEFAULT[k];
  });
  return out;
}
function load(storage) {
  var st = storage || (root.localStorage || null);
  try { return normalise(JSON.parse(st.getItem(KEY) || 'null')); } catch (_) { return normalise(null); }
}
function save(look, storage) {
  var st = storage || root.localStorage;
  try { st.setItem(KEY, JSON.stringify(normalise(look))); return true; } catch (_) { return false; }
}

function block(sel, theme) {
  var t = theme.t, sem = SEMANTIC[theme.mode];
  var decl = Object.keys(t).map(function (k) { return '--' + k + ':' + t[k]; })
    .concat(Object.keys(sem).map(function (k) { return '--' + k + ':' + sem[k]; }))
    .concat(['color-scheme:' + theme.mode]);
  return sel + '{' + decl.join(';') + '}';
}
/* The stylesheet every theme needs, generated from the table above so the
   colours exist in exactly one place. */
function css() {
  var out = [];
  out.push(block(':root', byId(AUTO.light)));
  THEMES.forEach(function (th) { out.push(block(':root[data-look="' + th.id + '"]', th)); });
  out.push(block(':root[data-look="auto"]', byId(AUTO.light)));
  out.push('@media (prefers-color-scheme: dark){' + block(':root[data-look="auto"]', byId(AUTO.dark)) + '}');
  OPTIONS.size.forEach(function (o) { out.push(':root[data-size="' + o[0] + '"]{font-size:' + o[2] + 'px}'); });
  OPTIONS.width.forEach(function (o) { out.push(':root[data-width="' + o[0] + '"]{--measure:' + o[2] + 'rem}'); });
  OPTIONS.spacing.forEach(function (o) { out.push(':root[data-spacing="' + o[0] + '"]{--leading:' + o[2] + '}'); });
  Object.keys(FONTS).forEach(function (k) { out.push(':root[data-font="' + k + '"]{--font:' + FONTS[k] + '}'); });
  return out.join('\n');
}

function isDark(look, prefersDark) {
  if (look.theme === 'auto') return !!prefersDark;
  var t = byId(look.theme);
  return !!t && t.mode === 'dark';
}

function apply(look, docEl, doc) {
  var el = docEl || (root.document && root.document.documentElement);
  var d = doc || root.document;
  if (!el) return;
  look = normalise(look);
  el.setAttribute('data-look', look.theme);
  el.setAttribute('data-size', look.size);
  el.setAttribute('data-width', look.width);
  el.setAttribute('data-spacing', look.spacing);
  el.setAttribute('data-font', look.font);
  el.setAttribute('data-hook', look.hook);
  if (d && d.getElementById && !d.getElementById('look-css')) {
    var s = d.createElement('style');
    s.id = 'look-css';
    s.textContent = css();
    (d.head || el).appendChild(s);
  }
}

var MemLook = {
  THEMES: THEMES, AUTO: AUTO, SEMANTIC: SEMANTIC, OPTIONS: OPTIONS, FONTS: FONTS, DEFAULT: DEFAULT, KEY: KEY,
  byId: byId, optValue: optValue, normalise: normalise, load: load, save: save, css: css, isDark: isDark, apply: apply,
};
root.MemLook = MemLook;
if (typeof module !== 'undefined' && module.exports) module.exports = MemLook;
/* Applied the moment this script runs — it sits in <head> — so the page is
   never painted in the wrong theme first. */
if (typeof document !== 'undefined') { try { apply(load()); } catch (_) {} }
})(typeof window !== 'undefined' ? window : this);
