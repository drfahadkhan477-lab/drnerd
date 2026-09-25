/* ═══════════════════════════════════════════════════════════════════════════
   appearance.js — themes, text size and layout.

   THE THEMES ARE THE OWNER'S TWO, and Systole's Contrast. Memorizer first
   carried Systole's eight palettes. The owner found them, and the page's
   texture, not right for studying, and chose between three mock-ups drawn
   on the real screens: A, the iPad's own light look — a grey grouped ground,
   white cards, system blue — by day; B, a clinical dark — near-black,
   graphite cards, monitor green — at night; and asked to keep the aurora
   behind the page and the frosted glass over it. Auto pairs them. Contrast
   is Systole's still (scripts/highcontrast-patch.js), and the suite still
   holds it colour for colour to that source.

   The colours that MEAN something (green right, red wrong, amber partly) are
   not themed, so what they mean never shifts underneath you; they change
   only between light and dark. No ground is pure black or white outside
   Contrast: the clinical dark is #050608, which a phone shows as black
   without the halo pure black gives white text.

   SIZE is Systole's type ladder — a minor third (1.2) from a 16px body,
   tokens --t-* in app.css — with the body step itself scalable: Small 15,
   Standard 16, Large 18, Extra large 20. Everything is in rem, so the whole
   page scales together and the ladder's proportions hold.

   CONTRAST AND BRIGHTNESS are computed from each palette, not stored as
   48 more palettes. variant() moves the grounds (brightness) and the ink
   (contrast), then FITS every text colour to a floor: a colour below its
   floor on any ground it is drawn on is mixed toward the far end, a step at
   a time, until it clears. At Standard/Standard the palettes come through
   as drawn except where glass over the aurora takes a colour under its
   floor; the suite names each colour that moves, and shows it needed to. One token is new at every setting: --edge, the outline
   of a control (button, field, swatch). Systole's --border is a hairline,
   about 1.4:1 on a card, and a field drawn with it is hard to find; --edge
   is fitted to 3:1 (4.5:1 at High), WCAG's floor for a control's boundary.

   THE HERO, the band at the top of the home screen, is each theme's own:
   white with the ink of the page in Daylight, graphite in Clinical, and
   Systole's dark band in Contrast. Its text colours are the theme's, held
   to the same floors across its whole gradient.

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

/* source: the Systole block a ported palette's colours come from, for the
   drift test (Contrast's); null for the owner's two, drawn for Memorizer.
   hero: the band at the top of home — its gradient, accent and rim, and its
   own text colours and the tint of the pills on it, since it is light in
   one theme and dark in the others.
   Tokens: bg, surface (a card), surface-2, ink, muted, line, accent,
   accent-soft, accent-ink. */
var THEMES = [
  { id: 'daylight', name: 'Daylight', mode: 'light', swatch: ['#F2F2F7', '#0064D2'], source: null,
    t: { bg: '#F2F2F7', surface: '#FFFFFF', 'surface-2': '#F2F2F7', ink: '#1C1C1E', muted: '#6C6C70', line: '#E5E5EA',
         accent: '#0064D2', 'accent-soft': '#E6F0FC', 'accent-ink': '#FFFFFF' },
    hero: { 'hero-a': '#FFFFFF', 'hero-b': '#F7F9FC', 'hero-c': '#FFFFFF', 'hero-accent': '#0064D2', 'hero-edge': 'rgba(0,100,210,.10)',
            'hero-ink': '#1C1C1E', 'hero-muted': '#6C6C70', 'hero-pill': 'rgba(0,0,0,.04)', 'hero-pill-edge': 'rgba(0,0,0,.06)' } },
  { id: 'clinical', name: 'Clinical', mode: 'dark', swatch: ['#050608', '#34D399'], source: null,
    t: { bg: '#050608', surface: '#16181B', 'surface-2': '#22252A', ink: '#F2F4F5', muted: '#9EA4AB', line: '#2C3035',
         accent: '#34D399', 'accent-soft': '#10251C', 'accent-ink': '#04130C' },
    hero: { 'hero-a': '#16181B', 'hero-b': '#1B1F23', 'hero-c': '#111315', 'hero-accent': '#34D399', 'hero-edge': 'rgba(52,211,153,.14)',
            'hero-ink': '#F2F4F5', 'hero-muted': '#9EA4AB', 'hero-pill': 'rgba(255,255,255,.06)', 'hero-pill-edge': 'rgba(255,255,255,.10)' } },
  /* Two more of Memorizer's own, after the owner found the themes "still
     not up to mark": Paper, a warm page for long reading, in the light; and
     Neuron, a deep indigo with an electric cyan, in the dark — the brain on
     the home screen at its most vivid. */
  { id: 'paper', name: 'Paper', mode: 'light', swatch: ['#F3EEE4', '#8A3324'], source: null,
    t: { bg: '#F3EEE4', surface: '#FFFCF5', 'surface-2': '#EEE6D8', ink: '#221C15', muted: '#655A4C', line: '#E2D8C6',
         accent: '#8A3324', 'accent-soft': '#F6E4DC', 'accent-ink': '#FFFFFF' },
    hero: { 'hero-a': '#FFFCF5', 'hero-b': '#F8F1E4', 'hero-c': '#FFFAF0', 'hero-accent': '#8A3324', 'hero-edge': 'rgba(138,51,36,.12)',
            'hero-ink': '#221C15', 'hero-muted': '#5E5345', 'hero-pill': 'rgba(60,40,20,.05)', 'hero-pill-edge': 'rgba(60,40,20,.10)' },
    brain: { t1: '#F7E3DA', t2: '#EBCFC4', t3: '#D8B6AA', sulcus: 'rgba(120,60,50,.30)', rim: 'rgba(255,250,240,.95)', sheen: 'rgba(255,255,255,.55)',
             axon: 'rgba(120,80,60,.22)', dendrite: 'rgba(110,70,55,.55)', dormant: '#F4E9E2', spark: '#FFFFFF',
             stage: 'radial-gradient(90% 90% at 30% 20%, rgba(214,150,110,.16), transparent 70%)' } },
  { id: 'neuron', name: 'Neuron', mode: 'dark', swatch: ['#070B1C', '#5CC8FF'], source: null,
    t: { bg: '#070B1C', surface: '#10162E', 'surface-2': '#19213F', ink: '#EEF1FF', muted: '#A7AFD3', line: '#262F58',
         accent: '#5CC8FF', 'accent-soft': '#0D2442', 'accent-ink': '#04101F' },
    hero: { 'hero-a': '#121A3A', 'hero-b': '#161E46', 'hero-c': '#0B1128', 'hero-accent': '#5CC8FF', 'hero-edge': 'rgba(92,200,255,.18)',
            'hero-ink': '#EEF1FF', 'hero-muted': '#A7AFD3', 'hero-pill': 'rgba(255,255,255,.06)', 'hero-pill-edge': 'rgba(255,255,255,.12)' },
    brain: { t1: 'rgba(139,123,255,.34)', t2: 'rgba(92,120,255,.16)', t3: 'rgba(40,46,120,.34)', sulcus: 'rgba(180,190,255,.24)', rim: 'rgba(160,180,255,.45)',
             sheen: 'rgba(200,210,255,.14)', axon: 'rgba(150,165,255,.20)', dendrite: 'rgba(170,185,255,.45)', dormant: '#1A2250', spark: '#E6F7FF',
             stage: 'radial-gradient(80% 90% at 35% 30%, rgba(92,120,255,.20), transparent 70%), radial-gradient(60% 70% at 80% 80%, rgba(255,92,190,.10), transparent 70%)' } },
  { id: 'contrast', name: 'Contrast', mode: 'dark', swatch: ['#060606', '#38BDF8'], source: 'contrast',
    t: { bg: '#060606', surface: '#121212', 'surface-2': '#1E1E1E', ink: '#FAFAFA', muted: '#D6D6D6', line: '#666666',
         accent: '#38BDF8', 'accent-soft': '#082F49', 'accent-ink': '#060606' },
    hero: { 'hero-a': '#0A0A0A', 'hero-b': '#151515', 'hero-c': '#050505', 'hero-accent': '#7DD3FC', 'hero-edge': 'rgba(56,189,248,.32)' } },
];
/* GLOW: the second accent a gradient runs to, and the aurora behind the
   page. Contrast's are Systole's (--teal2, --aura-1..3 in
   highcontrast-patch.js), read out by the suite. The owner's two are drawn
   from their own accents, faint — the aurora is a colour in the corner of
   the eye, not a picture: Daylight's the iPad's blue, cyan and violet;
   Clinical's monitor green, with a cold blue. */
var GLOW = {
  daylight: { a2: '#0051A8', aura: ['rgba(0,122,255,.14)', 'rgba(90,200,250,.16)', 'rgba(175,82,222,.10)'] },
  clinical: { a2: '#10B981', aura: ['rgba(52,211,153,.14)', 'rgba(56,189,248,.10)', 'rgba(16,185,129,.10)'] },
  contrast: { a2: '#7DD3FC', aura: ['rgba(56,189,248,.22)', 'rgba(125,211,252,.16)', 'rgba(255,255,255,.10)'] },
  paper: { a2: '#6B2519', aura: ['rgba(214,150,90,.14)', 'rgba(190,110,90,.10)', 'rgba(120,150,110,.10)'] },
  neuron: { a2: '#8B7BFF', aura: ['rgba(92,200,255,.14)', 'rgba(139,123,255,.16)', 'rgba(255,92,190,.10)'] },
};
/* THE BRAIN's tissue and wiring (ui.js masteryCard), by mode, and a
   theme's own where it names one. A neuron's colour keeps the meaning
   colours' hues — green solid, amber fading, red weak — but lit: the
   meaning colours are drawn dark enough to be read as text on a light
   page, and a lit neuron drawn in them looked burnt out, not lit (n-*). */
var BRAIN_TONES = {
  light: { t1: '#EEE6F7', t2: '#E0D5EE', t3: '#CDBFE0', sulcus: 'rgba(90,70,130,.26)', rim: 'rgba(255,255,255,.95)', sheen: 'rgba(255,255,255,.6)',
           axon: 'rgba(80,70,120,.20)', dendrite: 'rgba(80,70,130,.45)', dormant: '#F3EFF8', spark: '#FFFFFF',
           'n-solid': '#1FBF75', 'n-fading': '#F0A12E', 'n-weak': '#EE4B5A',
           stage: 'radial-gradient(90% 90% at 30% 20%, rgba(120,110,255,.10), transparent 70%)' },
  dark:  { t1: 'rgba(120,200,170,.22)', t2: 'rgba(80,120,140,.14)', t3: 'rgba(30,50,60,.40)', sulcus: 'rgba(180,230,210,.18)', rim: 'rgba(170,230,210,.35)',
           sheen: 'rgba(255,255,255,.08)', axon: 'rgba(170,220,210,.16)', dendrite: 'rgba(170,220,210,.38)', dormant: '#1B2226', spark: '#F2FFF9',
           'n-solid': '#5EF2B0', 'n-fading': '#FFC857', 'n-weak': '#FF6B7A',
           stage: 'radial-gradient(80% 90% at 35% 30%, rgba(52,211,153,.10), transparent 70%)' },
};
function brainOf(theme) { var b = {}, d = BRAIN_TONES[theme.mode], o = theme.brain || {}, k; for (k in d) b[k] = o[k] || d[k]; return b; }
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

/* Auto follows the device: Daylight by day, Clinical at night. */
var AUTO = { id: 'auto', name: 'Auto', light: 'daylight', dark: 'clinical' };

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

/* the hero's gradient, accent and rim; its text and pills are set below */
var HERO_KEYS = ['hero-a', 'hero-b', 'hero-c', 'hero-accent', 'hero-edge'];
var SHADOW = {
  light: '0 1px 2px rgba(15,30,51,.07), 0 4px 16px rgba(15,30,51,.08)',
  dark: '0 1px 2px rgba(0,0,0,.45), 0 6px 20px rgba(0,0,0,.35)',
};

function block(sel, theme, look) {
  var contrast = (look && look.contrast) || 'standard', bright = (look && look.bright) || 'standard';
  var t = variant(theme, contrast, bright), sem = semanticOf(theme.mode, contrast), hero = theme.hero || {};
  var decl = Object.keys(t).map(function (k) { return '--' + k + ':' + t[k]; })
    .concat(Object.keys(sem).map(function (k) { return '--' + k + ':' + sem[k]; }))
    .concat(HERO_KEYS.map(function (k) { return '--' + k + ':' + hero[k]; }).filter(function (d) { return !/undefined$/.test(d); }))
    .concat(['--hero-ink:' + heroInk(theme), '--hero-muted:' + heroMuted(theme), '--hero-pill:' + (hero['hero-pill'] || 'rgba(255,255,255,.08)'),
             '--hero-pill-edge:' + (hero['hero-pill-edge'] || 'rgba(255,255,255,.14)')])
    .concat((function () { var g = glassOf(theme, contrast, t); return Object.keys(g).map(function (k) { return '--' + k + ':' + g[k]; }); })())
    .concat(GLOW[theme.id] ? GLOW[theme.id].aura.map(function (a, i) { return '--aura-' + (i + 1) + ':' + a; }) : [])
    .concat((function () { var b = brainOf(theme); return Object.keys(b).map(function (k) { return '--brain-' + k + ':' + b[k]; }); })())
    .concat(['--shadow:' + (contrast === 'high' ? 'none' : SHADOW[theme.mode]), 'color-scheme:' + theme.mode]);
  return sel + '{' + decl.join(';') + '}';
}
/* A hero that names no text colours of its own is a dark band (Systole's,
   in Contrast), so its text is light. */
var HERO_INK = '#F4F7FB';
function heroInk(theme) { return theme.hero && theme.hero['hero-ink'] || HERO_INK; }
function heroMuted(theme) { return theme.hero && theme.hero['hero-muted'] || (theme.hero ? mix(HERO_INK, theme.hero['hero-b'], 0.25) : HERO_INK); }

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
  FLOORS: FLOORS, HERO_INK: HERO_INK, HERO_KEYS: HERO_KEYS, heroInk: heroInk,
  byId: byId, optValue: optValue, normalise: normalise, load: load, save: save, css: css, isDark: isDark, apply: apply,
  GLOW: GLOW, GLASS: GLASS, BRAIN_TONES: BRAIN_TONES, brainOf: brainOf, glassOf: glassOf, over: over, parseRgba: parseRgba,
  variant: variant, semanticOf: semanticOf, heroMuted: heroMuted, mix: mix, ratio: ratio, fit: fit,
};
root.MemLook = MemLook;
if (typeof module !== 'undefined' && module.exports) module.exports = MemLook;
/* Applied the moment this script runs — it sits in <head> — so the page is
   never painted in the wrong theme first. */
if (typeof document !== 'undefined') { try { apply(load()); } catch (_) {} }
})(typeof window !== 'undefined' ? window : this);
