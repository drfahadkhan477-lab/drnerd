#!/usr/bin/env node
'use strict';
/*
 * Glass: every promise the glass rules make, in a real browser.
 *
 *   node tests/verify-glass.js
 *
 * No build is needed, on purpose: the rules and the script are cut out of
 * app/css/systole.css and app/systole.html and put into a page that carries
 * the same class names, which is opened in the engine the other suites use.
 * The page is built from what tools/button-census.js found in the owner's
 * build: the same class names, the same --card token, a ::before already on
 * .opt, a fixed .ai-fab, answer states painted with colours other than --card.
 *
 * So what this proves is that the rules behave as designed ON THOSE NAMES:
 * neutral controls turn to see-through copies of the theme's card, colours
 * that mean something are left alone, High contrast stays solid, the light
 * moves and stops moving under reduced motion. Whether the real screens look
 * right is a matter for the owner's eyes and for the census re-run on a build.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch } = require('./_engine.js');
const { onDeath, watch } = require('./_deathnote.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = 'start';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--card:#FFFFFF;--bg:#EDF0F6;--navh:56px;--green-bg:#ECFDF5;--red-bg:#FFF1F1}
html[data-theme="dark"][data-palette="cathlab"]{--card:#1D140B;--bg:#120C07}
html[data-theme="dark"][data-palette="contrast"]{--card:#121212;--bg:#000000}
body{background:var(--bg);font:16px sans-serif;padding:20px}
.btn{background:var(--card);border:1px solid #ccc;border-radius:12px;padding:10px 16px;transition:all .2s}
.btn-next{background:#0F1E3D;color:#fff;border:0}
.btn.danger{background:var(--red-bg);color:#DC2626}
.opt{display:block;position:relative;overflow:hidden;background:var(--card);border-radius:16px;margin:6px 0;padding:14px;
  transition:transform .2s,box-shadow .2s,border-color .2s,background .2s}
.opt::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:#0284C7}
.opt.correct{background:var(--green-bg)} .opt.wrong{background:var(--red-bg)}
.chip{background:var(--card);border-radius:99px;padding:4px 10px;transition:transform .2s,border-color .2s}
.chip.hot{color:#0284C7;border:1px solid #0284C7}
.ch-tile,.feed-card{position:relative;overflow:hidden;background:var(--card);border-radius:16px;padding:20px}
.door{background:rgba(255,255,255,.74);border-radius:16px;padding:16px}
.ai-fab{position:fixed;right:16px;bottom:16px;width:50px;height:50px;border-radius:25px;border:0;
  background-image:linear-gradient(135deg,#2C4A82,#0284C7)}
.icon-btn{background:rgba(255,255,255,.12);border-radius:10px}
.nav{color:#fff;height:var(--navh);display:flex;align-items:center;
  justify-content:space-between;background:#0F1E3D}
</style></head><body>
<nav class="nav"><span>Systole</span><button class="icon-btn" id="icon">i</button></nav>
<button class="btn" id="btn">Plain</button>
<button class="btn btn-next" id="next">Next</button>
<button class="btn danger" id="danger">Reset</button>
<button class="opt" id="opt">A</button><button class="opt correct" id="ok">B</button><button class="opt wrong" id="bad">C</button>
<button class="chip" id="chip">chip</button><button class="chip hot" id="hot">hot</button>
<button class="ch-tile" id="tile">tile</button><button class="door" id="door">door</button>
<button class="ai-fab" id="fab"></button>
<script>
/* ══════════════ Durable memory — see src/core/memory.js ══════════════ */
var S = {};
</script></body></html>`;

(async () => {
  head('the glass is read from the app that ships');
  /* Until the patch chain was retired this ran glass-patch.js over the
     fixture. The glass now lives in app/css/systole.css (the rules) and
     app/systole.html (the script that derives --card-glass), so both are cut
     out of those files, each between anchors that must occur once, and put
     into the fixture where the patch used to put them. */
  const once = (src, a, where) => {
    const n = src.split(a).length - 1;
    if (n !== 1) throw new Error(`${where}: expected the anchor once, found ${n}: ${a.slice(0, 50)}`);
    return src.indexOf(a);
  };
  const APP_CSS = fs.readFileSync(path.join(__dirname, '..', 'app', 'css', 'systole.css'), 'utf8');
  const APP_HTML = fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8');
  const NAV = '.nav{color:#fff;height:var(--navh);display:flex;align-items:center;';
  const MEMORY = '/* ══════════════ Durable memory — see src/core/memory.js ══════════════ */';
  const BANNER = '/* ── glass — see scripts/glass-patch.js ── */';
  const cssFrom = once(APP_CSS, BANNER, 'app/css/systole.css') + BANNER.length;
  const css = APP_CSS.slice(cssFrom, once(APP_CSS, NAV, 'app/css/systole.css'));
  const jsFrom = once(APP_HTML, '/* ══════════════ Glass — see scripts/glass-patch.js', 'app/systole.html');
  const js = APP_HTML.slice(jsFrom, APP_HTML.indexOf(MEMORY, jsFrom));
  ok('the rules and the script were both found, and are whole', css.length > 2000 && /backdrop-filter/.test(css) &&
     js.length > 500 && /--card-glass/.test(js) && /\}\)\(\);\s*$/.test(js), `css ${css.length}, script ${js.length} characters`);
  /* Functions, not strings, as the replacement: a "$'" in the css would
     otherwise be read as a replacement pattern. */
  const out = FIXTURE.replace(NAV, () => css + NAV).replace(MEMORY, () => js + MEMORY);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glass-'));
  const OUT = path.join(dir, 'out.html');
  fs.writeFileSync(OUT, out);
  ok('and the fixture took them where the app has them', out !== FIXTURE && out.includes(css) && out.includes(js));

  head('nothing the iPad\'s Safari 13.4 cannot parse, and nothing outside High contrast\'s reach');
  ok('no :is(), no inset shorthand, no color-mix()', !!css && !/:is\(|[;{\s]inset:|color-mix\(/.test(css));
  const blurs = (css.match(/(^|[^-])backdrop-filter:/g) || []).length, wk = (css.match(/-webkit-backdrop-filter:/g) || []).length;
  ok('every backdrop blur carries its -webkit- twin', blurs > 0 && blurs === wk, `${blurs} blur, ${wk} -webkit-`);
  const selectors = css.replace(/@keyframes[^{]*\{[^{}]*\{[^}]*\}[^{}]*\{[^}]*\}\s*\}/g, '')
    .replace(/@media[^{]*\{/g, '').split('}').map(r => r.split('{')[0]).join(',').split(',')
    .map(s => s.trim()).filter(s => s && !/^(:root|html\[data-theme="dark"\]|html:not\(\[data-theme\]\))$/.test(s));
  const loose = selectors.filter(s => !s.startsWith('html:not([data-palette="contrast"]) '));
  ok('every control rule is scoped out of High contrast', selectors.length > 20 && loose.length === 0, loose.slice(0, 3).join(' | ') || `${selectors.length} selectors`);

  const browser = await launch();
  const errors = [], events = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));
  const page = watch(await (await browser.newContext({ viewport: { width: 900, height: 900 } })).newPage(), events, 'main');
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + OUT);
  const style = (id, pseudo, props) => page.evaluate(([id, pseudo, props]) => {
    const cs = getComputedStyle(document.getElementById(id), pseudo || null);
    return Object.fromEntries(props.map(p => [p, cs.getPropertyValue(p)]));
  }, [id, pseudo, props]);
  /* The controls transition their background (the app's .btn transitions
     all), so a theme change FADES the glass in. Reading a colour before the
     fade has finished reads a colour on its way; so every reading waits for
     the page's finite animations and transitions to finish first. */
  const settle = () => page.evaluate(() => Promise.all(document.getAnimations()
    .filter(a => a.effect && a.effect.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
  const bg = async id => { await settle(); return (await style(id, null, ['background-color']))['background-color']; };
  const theme = (t, p) => page.evaluate(([t, p]) => {
    const h = document.documentElement;
    if (t) h.setAttribute('data-theme', t); else h.removeAttribute('data-theme');
    if (p) h.setAttribute('data-palette', p); else h.removeAttribute('data-palette');
  }, [t, p]).then(settle);

  head('neutral controls turn to glass; colours that mean something do not');
  ok('a plain button is the theme\'s own card, see-through', await bg('btn') === 'rgba(255, 255, 255, 0.62)', await bg('btn'));
  ok('so is an unanswered option', await bg('opt') === 'rgba(255, 255, 255, 0.62)', await bg('opt'));
  ok('the right answer keeps its green, exactly', await bg('ok') === 'rgb(236, 253, 245)', await bg('ok'));
  ok('the wrong answer keeps its red, exactly', await bg('bad') === 'rgb(255, 241, 241)', await bg('bad'));
  ok('a destructive button keeps its red, exactly', await bg('danger') === 'rgb(255, 241, 241)', await bg('danger'));
  ok('the primary stays filled', await bg('next') === 'rgb(15, 30, 61)', await bg('next'));
  const blurOf = async id => { await settle(); const s = await style(id, null, ['backdrop-filter', '-webkit-backdrop-filter']); return s['backdrop-filter'] || s['-webkit-backdrop-filter']; };
  ok('buttons and options are frosted', /blur\(14px\)/.test(await blurOf('btn')) && /blur\(14px\)/.test(await blurOf('opt')), await blurOf('btn'));
  ok('chips are glass without a blur — two thousand of them share the notes screen', await bg('chip') === 'rgba(255, 255, 255, 0.62)' && (await blurOf('chip')) === 'none',
     `${await bg('chip')}, blur ${await blurOf('chip')}`);

  head('lit from within, under the label');
  const pane = await style('btn', '::after', ['content', 'position', 'z-index', 'pointer-events']);
  const host = await style('btn', null, ['position', 'isolation']);
  ok('a pane is drawn in ::after, beneath the label and above the colour', pane.content === '""' && pane.position === 'absolute' && pane['z-index'] === '-1' &&
     pane['pointer-events'] === 'none' && host.isolation === 'isolate' && host.position === 'relative', JSON.stringify({ ...pane, ...host }));
  const optBefore = await style('opt', '::before', ['content', 'width']), optAfter = await style('opt', '::after', ['content']);
  ok('on an option it takes ::after and leaves the ::before already there', optBefore.content === '""' && optBefore.width === '4px' && optAfter.content === '""');
  ok('the right answer is lit too — glossy green, not glass', (await style('ok', '::after', ['content'])).content === '""');
  ok('the primary is lit, and lifted', (await style('next', '::after', ['content'])).content === '""' && /18px/.test((await style('next', null, ['box-shadow']))['box-shadow']));
  const fab = await style('fab', null, ['position']), icon = await style('icon', null, ['position']), iconAfter = await style('icon', '::after', ['content']);
  ok('the Apex button stays fixed; the nav icons keep their place and get no pane', fab.position === 'fixed' && icon.position === 'static' && iconAfter.content === 'none',
     `fab ${fab.position}, icon ${icon.position}, icon::after ${iconAfter.content}`);

  head('the theme is followed, whatever it is');
  await theme('dark', 'cathlab');
  ok('cathlab: the glass is cathlab\'s card, see-through', await bg('btn') === 'rgba(29, 20, 11, 0.62)', await bg('btn'));
  ok('and the light is dimmed for a dark ground', /rgba\(255, 255, 255, 0\.16\)/.test((await style('btn', '::after', ['box-shadow']))['box-shadow']));
  await theme('dark', 'contrast');
  ok('High contrast: solid, as it was', await bg('btn') === 'rgb(18, 18, 18)', await bg('btn'));
  ok('with no pane and no blur', (await style('btn', '::after', ['content'])).content === 'none' && (await blurOf('btn')) === 'none');
  await theme(null, null);
  ok('and back to the default, glass again', await bg('btn') === 'rgba(255, 255, 255, 0.62)', await bg('btn'));
  await page.emulateMedia({ colorScheme: 'dark' });
  ok('"auto" on a dark system gets the dim light too', /rgba\(255, 255, 255, 0\.16\)/.test((await style('btn', '::after', ['box-shadow']))['box-shadow']));
  await page.emulateMedia({ colorScheme: 'light' });

  head('a light that moves');
  const sweepTo = async (id, act) => {
    const done = page.evaluate(id => new Promise(res => {
      const el = document.getElementById(id);
      const t = setTimeout(() => res('no transition ended'), 3000);
      el.addEventListener('transitionend', e => { if (e.pseudoElement === '::after' && /^background-position/.test(e.propertyName)) { clearTimeout(t); res('ended'); } });
    }), id);
    await act();
    const how = await done;
    return { how, at: (await style(id, '::after', ['background-position']))['background-position'] };
  };
  await page.mouse.move(890, 890);
  const hover = await sweepTo('btn', () => page.hover('#btn'));
  ok('the pointer arriving sends a band of light across', hover.how === 'ended' && /^-30%/.test(hover.at), JSON.stringify(hover));
  await page.mouse.move(890, 890);
  ok('the glance: doors, tiles and Next catch the light once as they appear; a plain button does not',
     (await style('next', '::after', ['animation-name']))['animation-name'] === 'glGlance' && (await style('door', '::after', ['animation-name']))['animation-name'] === 'glGlance' &&
     (await style('btn', '::after', ['animation-name']))['animation-name'] === 'none');
  const box = await page.locator('#chip').boundingBox();
  const pressed = page.evaluate(() => new Promise(res => {
    const el = document.getElementById('chip'), t = setTimeout(() => res('none'), 3000);
    el.addEventListener('transitionend', e => { if (e.propertyName === 'transform' && !e.pseudoElement) { clearTimeout(t); res(getComputedStyle(el).transform); } });
  }));
  await page.mouse.move(box.x + 5, box.y + 5); await page.mouse.down();
  const t = await pressed; await page.mouse.up();
  ok('a press sinks a chip a little', /^matrix\(0\.97, 0, 0, 0\.97/.test(t), t);

  head('reduced motion: nothing moves');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const still = await style('btn', '::after', ['transition-duration']);
  ok('no glide', /^0s/.test(still['transition-duration']), still['transition-duration']);
  ok('no glance', (await style('next', '::after', ['animation-name']))['animation-name'] === 'none');
  const b2 = await page.locator('#btn').boundingBox();
  await page.mouse.move(b2.x + 5, b2.y + 5); await page.mouse.down();
  const t2 = (await style('btn', null, ['transform'])).transform; await page.mouse.up();
  ok('no press', t2 === 'none', t2);
  ok('and the page threw nothing throughout', errors.length === 0, errors.join('; ') || 'none');

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
