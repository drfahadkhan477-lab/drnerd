#!/usr/bin/env node
/*
 * Echo Studio — a reference you can browse and a calculator you can drive.
 *
 *   node scripts/echo-patch.js <in.html> <out.html>
 *
 * The thinking is already done and already held: src/core/echo.js has the
 * views, measurements, severity tables and arithmetic, and src/ui/echo.js
 * turns them into markup. Both are pure, both are tested without a browser
 * (verify-echo-pure, verify-echoui-pure). This step only carries them into
 * the build and gives them a way in.
 *
 * ── FOUR ANCHORS, AND WHY SO FEW ─────────────────────────────────────────
 *
 * patch() throwing unless its find matches exactly once is the whole safety
 * model, and every anchor is a place this step can die 80-odd steps into a
 * build somebody waited half an hour for. focusmode (86) died exactly that
 * way: its anchor was three lines copied out of fullbleed(34), and
 * disclaimer(64) had rewritten one of them thirty steps before focusmode
 * ever read it.
 *
 * So this step is built to need as few anchors as possible, and each one was
 * replayed through the chain before it was written down — see
 * tests/verify-echoanchor-pure.js, which does that replay as a check rather
 * than as a thing I did once and remembered.
 *
 * Three anchors were avoided rather than validated:
 *
 *   NO STATE ON S.    Echo's tab, selected diagnosis and entered numbers
 *                     live in a closure here, not in the app's state object.
 *                     That drops the state-object anchor AND the save-tail
 *                     anchor AND any concern about SCHEMA_KEYS, because
 *                     nothing is persisted. The cost is that the tab resets
 *                     on reload, which for a calculator you drive once per
 *                     study is not a cost at all.
 *   NO MOUNT.         Interaction is delegated from `document` once, at
 *                     load, so there is nothing to re-attach after a render
 *                     and no anchor into the mount list.
 *   NO INLINE NAMES
 *   IN THE UI MODULE. Delegation also keeps src/ui/echo.js free of this
 *                     app's function names — it emits data- attributes and
 *                     knows nothing about goEcho() or render().
 *
 * ── WHERE IT SITS IN THE CHAIN ───────────────────────────────────────────
 *
 * Last. Its anchors come from assets(27), homeflow(30) and focusmode(86),
 * and focusmode is the last step to rewrite the nav's button row — so
 * anything earlier than 87 would be reading text a later step still
 * rewrites. Same reasoning focusmode itself gives for being at the end.
 *
 * WHAT IS STILL UNHELD HERE, said plainly. The replay proves each anchor
 * SURVIVES to this position. It cannot prove each is UNIQUE in the whole
 * document, because the rest of the document is the licensed export and is
 * not on this machine. patch() checks uniqueness at build time and throws if
 * it is wrong, so that failure is loud and immediate rather than silent —
 * but it is a failure that first appears on a machine with the export.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/echo-patch.js <in.html> <out.html>'); process.exit(1); }

const ROOT = path.join(__dirname, '..');
const echoCore = fs.readFileSync(path.join(ROOT, 'src', 'core', 'echo.js'), 'utf8');
const echoUi = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'echo.js'), 'utf8');

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 200)}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

/* ── 1. the modules, and the glue that owns Echo's state ──────────────────
   Anchored on the banner assets(27) emits, the same insertion point that
   step uses for refassets and zipread.

   The glue is small on purpose. It holds three things — which tab, which
   diagnosis, which numbers — and nothing else, because everything that
   decides what those mean lives in the two modules above it.

   THE RESULTS PANEL IS REPAINTED ALONE while typing. Re-rendering the whole
   screen on every keystroke would rebuild the input the caret is sitting in,
   and the caret would jump to the end of it after every digit. So an input
   event repaints .echo-out and leaves the fields where they are; a tab or
   diagnosis click, which replaces the panel anyway, goes through render(). */
patch('echo: the modules and their glue',
`/* ══════════════ Durable memory — see src/core/memory.js ══════════════ */`,
`/* ═════════ Echo Studio — see src/core/echo.js, src/ui/echo.js ═════════ */
${echoCore}
${echoUi}

var ECHO = { tab: 'reference', disease: null, fields: {} };

function buildEchoScreen(){ return EchoUI.screenHtml(ECHO); }

function goEcho(){ S.screen = 'echo'; render(); }

function echoRepaintResults(){
  var out = document.querySelector('.echo-out');
  if (out) out.innerHTML = EchoUI.resultsHtml(ECHO.fields);
}

/* Delegated once, from the document, so a render that replaces the panel
   cannot leave a dead listener behind or need a live one re-attached. */
document.addEventListener('click', function(e){
  var el = e.target && e.target.closest ? e.target.closest('[data-echo-tab],[data-echo-disease]') : null;
  if (!el) return;
  if (el.hasAttribute('data-echo-tab')) ECHO.tab = EchoUI.tabId(el.getAttribute('data-echo-tab'));
  else ECHO.disease = el.getAttribute('data-echo-disease');
  render();
});

document.addEventListener('input', function(e){
  var el = e.target;
  if (!el || !el.getAttribute || !el.hasAttribute('data-echo-field')) return;
  var id = el.getAttribute('data-echo-field');
  var n = parseFloat(el.value);
  /* Absent, not zero. An empty field means "not measured", and the module
     below reports that as missing rather than computing from a nought. */
  if (typeof n === 'number' && isFinite(n)) ECHO.fields[id] = n;
  else delete ECHO.fields[id];
  echoRepaintResults();
});

/* ══════════════ Durable memory — see src/core/memory.js ══════════════ */`);

/* ── 2. a screen to route to ──────────────────────────────────────────────
   The router is a ternary chain that every screen-adding step has extended
   in turn; homeflow(30) wrote the pair of lines below and nothing between
   there and here touches them. */
patch('echo: the router learns one more screen',
`    :S.screen==='memory'?buildMemory():S.screen==='study'?buildStudy()`,
`    :S.screen==='echo'?buildEchoScreen()
    :S.screen==='memory'?buildMemory():S.screen==='study'?buildStudy()`);

/* ── 3. the way in ────────────────────────────────────────────────────────
   Beside the theme picker, in the icon-btn idiom the nav already uses, and
   inserted immediately before the theme wrap the way focusmode inserts its
   own button. The glyph is `zap` because it exists; it is the one cosmetic
   guess in this file and it is a one-word change. */
patch('echo: a way in, beside the theme picker',
`      <div class="theme-wrap">`,
`      <button class="icon-btn" onclick="goEcho()" title="Echo Studio"
        aria-label="Echo Studio — views, findings and calculations">\${icon('zap')}</button>
      <div class="theme-wrap">`);

/* ── 4. css ───────────────────────────────────────────────────────────────
   Appended after the .nav rule, which focusmode(86) leaves intact. Every
   colour is a token the theme system already defines, so the screen follows
   all nine palettes rather than needing a tenth set of its own — including
   Contrast, where a hardcoded grey would have failed the ratio checks
   verify-palette-pure holds. */
patch('echo: css — two tabs, a list, a table of results',
`.nav{color:#fff;height:var(--navh);display:flex;align-items:center;`,
`.echo-studio{padding:0 max(20px,var(--sal)) 40px max(20px,var(--sar));max-width:var(--measure);margin:0 auto}
.echo-tabs{display:flex;gap:8px;margin:12px 0 20px}
.echo-tab{font:inherit;padding:8px 18px;border-radius:999px;cursor:pointer;
  background:var(--card);color:var(--muted);border:1px solid var(--border)}
.echo-tab.on{background:var(--accent);color:var(--ground);border-color:var(--accent)}
.echo-ref-tab{display:grid;grid-template-columns:minmax(180px,1fr) 3fr;gap:24px;align-items:start}
@media (max-width:760px){.echo-ref-tab{grid-template-columns:1fr}}
.echo-list{display:flex;flex-direction:column;gap:4px}
.echo-pick{font:inherit;text-align:left;padding:8px 12px;border-radius:8px;cursor:pointer;
  background:transparent;color:var(--text);border:1px solid transparent}
.echo-pick.on{background:var(--card);border-color:var(--border)}
.echo-views{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.echo-view{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px 14px}
.echo-view h4{margin:0 0 8px}
.echo-view dl{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:0;font-size:.9em}
.echo-view dt{color:var(--muted)}
.echo-view dd{margin:0}
.echo-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:24px}
.echo-field{display:grid;grid-template-columns:1fr auto;gap:2px 8px;align-items:baseline;
  background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px 10px}
.echo-field input{font:inherit;width:100%;background:transparent;color:var(--text);
  border:0;border-bottom:1px solid var(--border3)}
.echo-label{font-size:.85em}
.echo-units,.echo-where{color:var(--muted);font-size:.78em}
.echo-where{grid-column:1/-1}
.echo-results,.echo-measures{width:100%;border-collapse:collapse;font-size:.92em}
.echo-results th,.echo-results td,.echo-measures th,.echo-measures td{
  text-align:left;padding:6px 8px;border-bottom:1px solid var(--border)}
.echo-value{font-variant-numeric:tabular-nums}
.echo-ref{color:var(--muted);font-size:.85em}
.echo-note{color:var(--muted);font-size:.82em;margin-top:2px}
.echo-sex{color:var(--muted);font-size:.8em}
.echo-grade{text-transform:capitalize}
.echo-grade[data-grade="severe"],.echo-grade[data-grade="very severe"]{color:var(--accent);font-weight:600}
.echo-empty,.echo-missing{color:var(--muted)}
.echo-missing{margin-top:16px;font-size:.9em}
.nav{color:#fff;height:var(--navh);display:flex;align-items:center;`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('echo-patch applied:');
for (const e of edits) console.log('  ✓ ' + e);
