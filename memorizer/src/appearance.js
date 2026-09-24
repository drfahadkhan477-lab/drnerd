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

   CONTRAST AND BRIGHTNESS are computed from each palette, not stored as
   48 more palettes. variant() moves the grounds (brightness) and the ink
   (contrast), then FITS every text colour to a floor: a colour below its
   floor on any ground it is drawn on is mixed toward the far end, a step at
   a time, until it clears. At Standard/Standard every ported colour already
   clears its floor, so Systole's values come through untouched but one:
   Parchment's accent is 4.2:1 on its own ground and is fitted to 4.6 there.
   The suite checks both. One token is new at every setting: --edge, the outline
   of a control (button, field, swatch). Systole's --border is a hairline,
   about 1.4:1 on a card, and a field drawn with it is hard to find; --edge
   is fitted to 3:1 (4.5:1 at High), WCAG's floor for a control's boundary.

   THE HERO is Systole's too: the dark band at the top of the home screen,
   its gradient and accent per palette from theme-patch.js.

   PURE except apply(), which touches only the document element it is given
   and one <style> element.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

/* Semantic colours: by mode only, never by palette (Systole's rule). The
   light set is a step darker than it was, so it holds 4.5:1 on Dim's
   greyed cards too (Parchment's Dim card took the old green to 4.36). */
var SEMANTIC = {
  light: { good: '#1A6B40', 'good-soft': '#E1F2E8', mid: '#7A5000', 'mid-soft': '#FBF0D6', bad: '#A3221B', 'bad-soft': '#F9E3E1' },
  dark:  { good: '#6FD39B', 'good-soft': '#17301F', mid: '#F0C060', 'mid-soft': '#33290F', bad: '#FF8A80', 'bad-soft': '#3A1B19' },
};
/* At High contrast the meaning colours are stronger — still by mode only. */
var SEMANTIC_HIGH = {
  light: { good: '#0F4D2C', 'good-soft': '#E1F2E8', mid: '#5C3B00', 'mid-soft': '#FBF0D6', bad: '#7A1812', 'bad-soft': '#F9E3E1' },
  dark:  { good: '#94EBBB', 'good-soft': '#17301F', mid: '#F7D98F', 'mid-soft': '#33290F', bad: '#FFB3AB', 'bad-soft': '#3A1B19' },
};

/* source: which Systole block the colours come from, for the drift test.
   hero: Systole's hero band — the palette's own block, or for Daylight and
   Midnight the defaults theme-patch.js sets for light and dark.
   Tokens: bg, surface (Systole --card), surface-2, ink (--text), muted,
   line (--border), accent (--teal), accent-soft (--teal4), accent-ink. */
var THEMES = [
  { id: 'daylight', name: 'Daylight', mode: 'light', swatch: ['#EFF3F8', '#0284C7'], source: null,
    t: { bg: '#EFF3F8', surface: '#FFFFFF', 'surface-2': '#E6ECF3', ink: '#0F1E33', muted: '#4A5A70', line: '#D3DCE7',
         accent: '#0369A1', 'accent-soft': '#E3F0FA', 'accent-ink': '#FFFFFF' },
    hero: { 'hero-a': '#12243F', 'hero-b': '#173A5E', 'hero-c': '#0F1E3D', 'hero-accent': '#5EEAD4', 'hero-edge': 'rgba(94,234,212,.16)' } },
  { id: 'slate', name: 'Slate', mode: 'light', swatch: ['#EDF0F6', '#6366F1'], source: 'slate',
    t: { bg: '#EDF0F6', surface: '#FFFFFF', 'surface-2': '#E7EBF3', ink: '#1E2536', muted: '#4B5568', line: '#D3D9E6',
         accent: '#4F5BD5', 'accent-soft': '#EDEFFD', 'accent-ink': '#FFFFFF' },
    hero: { 'hero-a': '#232056', 'hero-b': '#312E81', 'hero-c': '#1B1840', 'hero-accent': '#A5B4FC', 'hero-edge': 'rgba(129,140,248,.22)' } },
  { id: 'parchment', name: 'Parchment', mode: 'light', swatch: ['#F3ECDD', '#0E7C86'], source: 'parchment',
    t: { bg: '#F3ECDD', surface: '#FBF6EC', 'surface-2': '#EFE7D6', ink: '#372E20', muted: '#6A5B45', line: '#E2D7C2',
         accent: '#0E7C86', 'accent-soft': '#E6F2EF', 'accent-ink': '#FFFFFF' },
    hero: { 'hero-a': '#2B2419', 'hero-b': '#3A3121', 'hero-c': '#241E14', 'hero-accent': '#63D6C8', 'hero-edge': 'rgba(18,145,155,.22)' } },
  { id: 'midnight', name: 'Midnight', mode: 'dark', swatch: ['#0A1628', '#0EA5E9'], source: null,
    t: { bg: '#0A1628', surface: '#11213A', 'surface-2': '#172A47', ink: '#E6EDF7', muted: '#9FB0C8', line: '#22385A',
         accent: '#0EA5E9', 'accent-soft': '#0E2A45', 'accent-ink': '#06121F' },
    hero: { 'hero-a': '#0B1B33', 'hero-b': '#0E2947', 'hero-c': '#0A1628', 'hero-accent': '#5EEAD4', 'hero-edge': 'rgba(94,234,212,.16)' } },
  { id: 'nocturne', name: 'Nocturne', mode: 'dark', swatch: ['#0E0B1A', '#A78BFA'], source: 'nocturne',
    t: { bg: '#0E0B1A', surface: '#17132B', 'surface-2': '#231D3E', ink: '#EDE9F7', muted: '#A79FC4', line: '#2A2348',
         accent: '#A78BFA', 'accent-soft': '#221B40', 'accent-ink': '#0E0B1A' },
    hero: { 'hero-a': '#1A1533', 'hero-b': '#2A2160', 'hero-c': '#130E28', 'hero-accent': '#C4B5FD', 'hero-edge': 'rgba(167,139,250,.22)' } },
  { id: 'cathlab', name: 'Cath Lab', mode: 'dark', swatch: ['#120C07', '#F59E0B'], source: 'cathlab',
    t: { bg: '#120C07', surface: '#1D140B', 'surface-2': '#2C1F12', ink: '#F5EDE1', muted: '#C6AF93', line: '#3A2A18',
         accent: '#F59E0B', 'accent-soft': '#2A1E08', 'accent-ink': '#120C07' },
    hero: { 'hero-a': '#241708', 'hero-b': '#3A2610', 'hero-c': '#190F05', 'hero-accent': '#FBBF24', 'hero-edge': 'rgba(245,158,11,.22)' } },
  { id: 'monitor', name: 'Monitor', mode: 'dark', swatch: ['#08110D', '#2DD4BF'], source: 'monitor',
    t: { bg: '#08110D', surface: '#0F1A15', 'surface-2': '#16271E', ink: '#E6F4EC', muted: '#93B7A4', line: '#1E3328',
         accent: '#2DD4BF', 'accent-soft': '#082820', 'accent-ink': '#08110D' },
    hero: { 'hero-a': '#0A1F16', 'hero-b': '#103828', 'hero-c': '#07160F', 'hero-accent': '#5EEAD4', 'hero-edge': 'rgba(45,212,191,.22)' } },
  { id: 'contrast', name: 'Contrast', mode: 'dark', swatch: ['#060606', '#38BDF8'], source: 'contrast',
    t: { bg: '#060606', surface: '#121212', 'surface-2': '#1E1E1E', ink: '#FAFAFA', muted: '#D6D6D6', line: '#666666',
         accent: '#38BDF8', 'accent-soft': '#082F49', 'accent-ink': '#060606' },
    hero: { 'hero-a': '#0A0A0A', 'hero-b': '#151515', 'hero-c': '#050505', 'hero-accent': '#7DD3FC', 'hero-edge': 'rgba(56,189,248,.32)' } },
];
/* GLOW: the second accent a gradient runs to, and the aurora behind the
   page — Systole's --teal2 and --aura-1..3, palette by palette, read out of
   scripts/theme-patch.js and highcontrast-patch.js by the appearance suite.
   Daylight and Midnight have no palette block there: their aurora is the
   :root default Systole sets for both. Daylight's second accent is
   Systole's root --teal2 (semantictokens-patch.js); Midnight has no Systole
   value to read, so its second accent is chosen — the next step lighter
   than its own accent (#0EA5E9), which is also the aurora's sky colour. */
var GLOW = {
  daylight:  { a2: '#0EA5E9', aura: ['rgba(94,234,212,.20)', 'rgba(56,189,248,.18)', 'rgba(129,140,248,.15)'] },
  slate:     { a2: '#6366F1', aura: ['rgba(129,140,248,.22)', 'rgba(99,102,241,.18)', 'rgba(56,189,248,.12)'] },
  parchment: { a2: '#12919B', aura: ['rgba(18,145,155,.20)', 'rgba(217,155,60,.16)', 'rgba(120,90,50,.14)'] },
  midnight:  { a2: '#38BDF8', aura: ['rgba(94,234,212,.20)', 'rgba(56,189,248,.18)', 'rgba(129,140,248,.15)'] },
  nocturne:  { a2: '#C4B5FD', aura: ['rgba(167,139,250,.22)', 'rgba(139,92,246,.18)', 'rgba(99,102,241,.14)'] },
  cathlab:   { a2: '#FBBF24', aura: ['rgba(245,158,11,.22)', 'rgba(251,191,36,.16)', 'rgba(180,83,9,.16)'] },
  monitor:   { a2: '#5EEAD4', aura: ['rgba(45,212,191,.22)', 'rgba(94,234,212,.16)', 'rgba(16,185,129,.14)'] },
  contrast:  { a2: '#7DD3FC', aura: ['rgba(56,189,248,.22)', 'rgba(125,211,252,.16)', 'rgba(255,255,255,.10)'] },
};
/* GLASS: how much of the card colour a frosted surface keeps over the
   aurora. The suite composites it over every aurora colour, at every
   setting, and holds text on it to the same floors as text on a card.
   At High contrast, and in the Contrast theme, surfaces are opaque. */
/* Clearer than it was (0.72 / 0.64), at the owner's request that it look
   like an iPad's glass: more of the page shows through, under a stronger
   blur, with a bright hairline RIM, a SHEEN falling from the top-left, and
   a soft LIGHT that follows the finger (ui.js sets where). The sheen and
   the light lie under the text, so they are composited into what the text
   is fitted against, below. On a dark page any white under the text costs
   the accent its floor, so there the glass keeps its rim and nothing else. */
var GLASS = { light: { card: 0.52, strong: 0.74, edge: 'rgba(255,255,255,.75)', rim: 'rgba(255,255,255,.55)', sheen: 'rgba(255,255,255,.30)', light: 'rgba(255,255,255,.38)', blur: '28px' },
              dark:  { card: 0.48, strong: 0.70, edge: 'rgba(255,255,255,.10)', rim: 'rgba(255,255,255,.12)', sheen: 'rgba(255,255,255,0)', light: 'rgba(255,255,255,0)', blur: '28px' } };

/* Auto follows the device: Daylight by day, Midnight at night. */
var AUTO = { id: 'auto', name: 'Auto', light: 'daylight', dark: 'midnight' };

var OPTIONS = {
  size:    [['s', 'Small', 15], ['m', 'Standard', 16], ['l', 'Large', 18], ['xl', 'Extra large', 20]],
  width:   [['narrow', 'Narrow', 40], ['standard', 'Standard', 48], ['wide', 'Wide', 72]],
  spacing: [['compact', 'Compact', 1.4], ['standard', 'Standard', 1.6], ['relaxed', 'Relaxed', 1.8]],
  font:    [['sans', 'Sans'], ['serif', 'Serif'], ['readable', 'Readable']],
  hook:    [['side', 'Beside the points'], ['below', 'Below the points']],
  contrast: [['standard', 'Standard'], ['high', 'High']],
  bright:  [['dim', 'Dim'], ['standard', 'Standard'], ['bright', 'Bright']],
};
/* The floors every text colour is fitted to, per contrast setting. */
var FLOORS = {
  standard: { text: 7, muted: 4.5, accent: 4.5, edge: 3 },
  high:     { text: 10, muted: 7, accent: 7, edge: 4.5 },
};
var FONTS = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: '"Iowan Old Style", "Charter", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif',
  readable: 'Verdana, "Atkinson Hyperlegible", Tahoma, "Trebuchet MS", sans-serif',
};
var DEFAULT = { theme: 'auto', size: 'm', width: 'standard', spacing: 'standard', font: 'sans', hook: 'side', contrast: 'standard', bright: 'standard' };
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
/* Reading root.localStorage itself throws where storage is refused — a page
   opened as a data: URL (the iPad's Files app hands an .html to Safari that
   way), some private modes — so it is read inside the try, not before it. */
function load(storage) {
  try { var st = storage || root.localStorage; return normalise(JSON.parse(st.getItem(KEY) || 'null')); } catch (_) { return normalise(null); }
}
function save(look, storage) {
  try { var st = storage || root.localStorage; st.setItem(KEY, JSON.stringify(normalise(look))); return true; } catch (_) { return false; }
}

/* ── colour arithmetic (sRGB hex; no color-mix, which iPadOS 13 lacks) ── */
function rgb(hex) { var c = hex.replace('#', ''); return [0, 2, 4].map(function (i) { return parseInt(c.slice(i, i + 2), 16); }); }
function hexOf(v) { return '#' + v.map(function (x) { var s = Math.round(Math.max(0, Math.min(255, x))).toString(16); return s.length < 2 ? '0' + s : s; }).join('').toUpperCase(); }
/* a moved toward b by t (0 = a, 1 = b). */
function mix(a, b, t) { var x = rgb(a), y = rgb(b); return hexOf(x.map(function (v, i) { return v + (y[i] - v) * t; })); }
function luminance(hex) {
  var v = rgb(hex).map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function ratio(a, b) { var x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
/* fg, moved toward `toward` in small steps until it clears min on every
   ground — or unchanged, if it already does. */
function fit(fg, grounds, min, toward) {
  for (var i = 0; i <= 50; i++) {
    var c = i ? mix(fg, toward, i / 50) : fg;
    if (grounds.every(function (g) { return ratio(c, g) >= min; })) return c;
  }
  return toward;
}

/* The tokens a theme gets at a contrast and brightness setting. */
function variant(theme, contrast, bright) {
  var t = {}, k;
  for (k in theme.t) t[k] = theme.t[k];
  var dark = theme.mode === 'dark';
  var far = dark ? '#FFFFFF' : '#000000', near = dark ? '#000000' : '#FFFFFF';
  var grounds = ['bg', 'surface', 'surface-2', 'accent-soft'];
  /* Brightness moves the grounds, never the text: Dim takes the glare off a
     light page and sinks a dark one toward black; Bright lifts a dark page
     off black and whitens a light one. */
  if (bright === 'dim') grounds.forEach(function (g) { t[g] = dark ? mix(t[g], '#000000', 0.45) : mix(t[g], t.ink, 0.07); });
  if (bright === 'bright') grounds.forEach(function (g) { t[g] = dark ? mix(t[g], t.ink, 0.07) : mix(t[g], '#FFFFFF', 0.6); });
  if (contrast === 'high') {
    t.ink = mix(t.ink, far, 0.6);
    t.muted = mix(t.muted, t.ink, 0.45);
    t.line = mix(t.line, t.muted, 0.35);
  }
  var f = FLOORS[contrast] || FLOORS.standard;
  var on = [t.bg, t.surface, t['surface-2'], t['accent-soft']];
  t.ink = fit(t.ink, on, f.text, far);
  t.muted = fit(t.muted, [t.bg, t.surface, t['surface-2']], f.muted, far);
  t.accent = fit(t.accent, [t.bg, t.surface], f.accent, far);
  t['accent-ink'] = fit(t['accent-ink'], [t.accent], f.accent, near);
  t.edge = fit(t.line, [t.bg, t.surface], f.edge, t.ink);
  /* The second accent carries button text too (a gradient runs to it), so
     it is fitted against the button text, as the accent is. */
  var g = GLOW[theme.id];
  if (g) {
    t['accent-2'] = fit(g.a2, [t['accent-ink']], f.accent, far);
    /* Text sits on glass over the aurora as well as on cards: what the
       page shows there is fitted too — the ground under each aurora
       colour, with the frosted surface over it. */
    var gl = glassOf(theme, contrast, t);
    var backs = [t.bg].concat(g.aura.map(function (a) { return over(a, t.bg); }));
    /* each glass over each ground — bare, and under the sheen and the
       finger's light at their brightest. The accent is fitted on the
       cards alone, as before. */
    var onCard = [], onGlass = [];
    backs.forEach(function (bk) {
      [gl.glass, gl['glass-2']].forEach(function (g2, i) {
        var base = over(g2, bk), lit = over(gl['glass-light'], over(gl['glass-sheen'], base));
        onGlass.push(base, lit);
        if (!i) onCard.push(base, lit);
      });
    });
    t.ink = fit(t.ink, onGlass, f.text, far);
    t.muted = fit(t.muted, onGlass, f.muted, far);
    t.accent = fit(t.accent, onCard, f.accent, far);
    t['accent-ink'] = fit(t['accent-ink'], [t.accent], f.accent, near);
    t['accent-2'] = fit(t['accent-2'], [t['accent-ink']], f.accent, far);
  }
  return t;
}
/* rgba() from a hex and an alpha; composite(fg rgba, bg hex) → hex. */
function rgba(hex, a) { var v = rgb(hex); return 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + a + ')'; }
function parseRgba(s) { var m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(s); return m ? [+m[1], +m[2], +m[3], +m[4]] : null; }
function over(fg, bgHex) { var f = parseRgba(fg), b = rgb(bgHex); return hexOf([0, 1, 2].map(function (i) { return f[i] * f[3] + b[i] * (1 - f[3]); })); }
/* The glass tokens for a theme at a setting. */
function glassOf(theme, contrast, t) {
  var opaque = contrast === 'high' || theme.id === 'contrast', G = GLASS[theme.mode];
  return { glass: rgba(t.surface, opaque ? 1 : G.card), 'glass-strong': rgba(t.surface, opaque ? 1 : G.strong),
           'glass-2': rgba(t['surface-2'], opaque ? 1 : G.card), 'glass-edge': opaque ? 'rgba(255,255,255,0)' : G.edge,
           'glass-blur': opaque ? '0px' : G.blur,
           'glass-rim': opaque ? 'rgba(255,255,255,0)' : G.rim, 'glass-sheen': opaque ? 'rgba(255,255,255,0)' : G.sheen,
           'glass-light': opaque ? 'rgba(255,255,255,0)' : G.light };
}
function semanticOf(mode, contrast) { return (contrast === 'high' ? SEMANTIC_HIGH : SEMANTIC)[mode]; }

var SHADOW = {
  light: '0 1px 2px rgba(15,30,51,.07), 0 4px 16px rgba(15,30,51,.08)',
  dark: '0 1px 2px rgba(0,0,0,.45), 0 6px 20px rgba(0,0,0,.35)',
};

function block(sel, theme, look) {
  var contrast = (look && look.contrast) || 'standard', bright = (look && look.bright) || 'standard';
  var t = variant(theme, contrast, bright), sem = semanticOf(theme.mode, contrast), hero = theme.hero || {};
  var decl = Object.keys(t).map(function (k) { return '--' + k + ':' + t[k]; })
    .concat(Object.keys(sem).map(function (k) { return '--' + k + ':' + sem[k]; }))
    .concat(Object.keys(hero).map(function (k) { return '--' + k + ':' + hero[k]; }))
    .concat(['--hero-ink:' + HERO_INK, '--hero-muted:' + heroMuted(theme)])
    .concat((function () { var g = glassOf(theme, contrast, t); return Object.keys(g).map(function (k) { return '--' + k + ':' + g[k]; }); })())
    .concat(GLOW[theme.id] ? GLOW[theme.id].aura.map(function (a, i) { return '--aura-' + (i + 1) + ':' + a; }) : [])
    .concat(['--shadow:' + (contrast === 'high' ? 'none' : SHADOW[theme.mode]), 'color-scheme:' + theme.mode]);
  return sel + '{' + decl.join(';') + '}';
}
/* The hero band is dark in every theme (Systole's), so its text is light. */
var HERO_INK = '#F4F7FB';
function heroMuted(theme) { return theme.hero ? mix(HERO_INK, theme.hero['hero-b'], 0.25) : HERO_INK; }

/* The stylesheet every theme needs, generated from the table above so the
   colours exist in exactly one place — at the contrast and brightness the
   look asks for (apply() rewrites it when they change). */
function css(look) {
  look = normalise(look);
  var out = [];
  out.push(block(':root', byId(AUTO.light), look));
  THEMES.forEach(function (th) { out.push(block(':root[data-look="' + th.id + '"]', th, look)); });
  out.push(block(':root[data-look="auto"]', byId(AUTO.light), look));
  out.push('@media (prefers-color-scheme: dark){' + block(':root[data-look="auto"]', byId(AUTO.dark), look) + '}');
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
  el.setAttribute('data-contrast', look.contrast);
  el.setAttribute('data-bright', look.bright);
  if (d && d.getElementById) {
    var s = d.getElementById('look-css');
    if (!s) { s = d.createElement('style'); s.id = 'look-css'; (d.head || el).appendChild(s); }
    var text = css(look);
    if (s.textContent !== text) s.textContent = text;
  }
}

var MemLook = {
  THEMES: THEMES, AUTO: AUTO, SEMANTIC: SEMANTIC, SEMANTIC_HIGH: SEMANTIC_HIGH, OPTIONS: OPTIONS, FONTS: FONTS, DEFAULT: DEFAULT, KEY: KEY,
  FLOORS: FLOORS, HERO_INK: HERO_INK,
  byId: byId, optValue: optValue, normalise: normalise, load: load, save: save, css: css, isDark: isDark, apply: apply,
  GLOW: GLOW, GLASS: GLASS, glassOf: glassOf, over: over, parseRgba: parseRgba,
  variant: variant, semanticOf: semanticOf, heroMuted: heroMuted, mix: mix, ratio: ratio, fit: fit,
};
root.MemLook = MemLook;
if (typeof module !== 'undefined' && module.exports) module.exports = MemLook;
/* Applied the moment this script runs — it sits in <head> — so the page is
   never painted in the wrong theme first. */
if (typeof document !== 'undefined') { try { apply(load()); } catch (_) {} }
})(typeof window !== 'undefined' ? window : this);
