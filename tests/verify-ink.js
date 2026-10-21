#!/usr/bin/env node
/*
 * Green, red and amber text that can be read on a dark theme.
 *
 *   node tests/verify-ink.js build/synthetic/systole.html
 *
 * --green, --red and --amber are one colour in every theme (verify-theme, verify-tokens) and fill the letter badges
 * under white type. On a dark ground the deep colours read at 3.0 to 4.9:1, under the 4.5:1 that text needs, so text
 * in them takes --green-ink, --red-ink or --amber-ink: the colour itself in a light theme, a lighter one in a dark one.
 * What is measured, rather than assumed:
 *   · no stylesheet rule writes text in a fill colour (the rules as written, comments blanked);
 *   · in each dark theme, and in Auto on a dark device, each ink clears 4.5:1 on the page, a card, the raised surface
 *     and its own tint; the green ink stays clear of Monitor's teal accent;
 *   · in each light theme, and in a light theme on a dark device, each ink is its fill colour, so light pages are as
 *     they were;
 *   · real text the shell colours itself clears 4.5:1 against what is under it in every dark theme: an option's
 *     peer figure, right and wrong, the Flag button on, and on a quiz's results the score, a chapter's figure and Retry
 *     Missed; and in Daylight the same text is the fill colour it always was. The mock report writes its score and
 *     chapter figures through the same semText, and is not opened here;
 *   · the correct option's letter badge is still white on the deep green;
 *   · nothing throws.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { launch, isEngineNoise } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, quiet } = require('./_render.js');
const { blankComments } = require('./_source.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-ink.js <build.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

/* [theme, the device's own scheme] */
const DARK = [['auto', 'dark'], ['midnight', 'light'], ['nocturne', 'light'], ['cathlab', 'light'], ['monitor', 'light'], ['contrast', 'light']];
const LIGHT = [['auto', 'light'], ['daylight', 'light'], ['slate', 'light'], ['parchment', 'light'], ['daylight', 'dark'], ['parchment', 'dark']];
const INKS = ['green', 'red', 'amber'];

/* In the page: colours as rgba arrays, alpha-composited grounds, WCAG contrast. Installed once per page. */
const TOOLS = () => {
  const parse = s => {
    let m = /^rgba?\(([^)]+)\)$/.exec(s);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    m = /^color\(srgb ([^)]+)\)$/.exec(s);
    if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]; }
    return null;
  };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map(i => top[i] * a + under[i] * (1 - a)).concat(1); };
  /* A token as the cascade resolves it on this page now. */
  const token = name => { const p = document.createElement('div'); p.style.color = 'var(' + name + ')'; document.body.appendChild(p);
    const c = parse(getComputedStyle(p).color); p.remove(); return c; };
  /* What lies under an element: its own background and its ancestors', composited until one is opaque. */
  const ground = el => { const layers = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } }
    let g = [255, 255, 255, 1]; for (let i = layers.length - 1; i >= 0; i--) g = over(layers[i], g); return g; };
  const hue = c => { const [r, g, b] = c.slice(0, 3).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return 0; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
  window.__ink = { parse, contrast, token, ground, hue, same: (a, b) => !!a && !!b && a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) < 0.6) };
};

(async () => {
  head('no rule writes text in a fill colour');
  {
    const dir = path.join(__dirname, '..', 'app', 'css');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.css'));
    const hits = [];
    for (const f of files) {
      const src = blankComments(fs.readFileSync(path.join(dir, f), 'utf8'));
      for (const m of src.matchAll(/(?<![-\w])color\s*:\s*var\(--(green|red|amber|success|danger|warning|warn)(2|-2)?\)/g))
        hits.push(f + ':' + (src.slice(0, m.index).split('\n').length) + ' ' + m[0]);
    }
    ok('the stylesheets were read', files.length >= 10, files.length + ' files');
    ok('no stylesheet sets color: to --green, --red, --amber or their semantic names; text takes the -ink', hits.length === 0, hits.join('; ') || 'none');
    const shell = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8'));
    const inline = [...shell.matchAll(/(?<![-\w])color\s*:\s*var\(--(green|red|amber|success|danger|warning)\)/g)].map(m => shell.slice(0, m.index).split('\n').length);
    ok('nor does any inline style the shell writes', inline.length === 0, inline.length ? 'lines ' + inline.join(', ') : 'none');
  }

  const browser = await launch();
  const errors = [], events = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));
  const page = watch(await (await browser.newContext({ viewport: { width: 820, height: 1180 }, serviceWorkers: 'block' })).newPage(), events, '820px');
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !isEngineNoise(m.text())) errors.push(m.text()); });
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await booted(page);
  await page.evaluate(TOOLS);
  const theme = async (id, scheme) => { await page.emulateMedia({ colorScheme: scheme }); await page.evaluate(id => setTheme(id), id); };

  head('each ink on each dark ground');
  for (const [id, scheme] of DARK) {
    await theme(id, scheme);
    const m = await page.evaluate(inks => {
      const T = window.__ink, grounds = ['--bg', '--card', '--white'];
      return inks.map(k => { const c = T.token('--' + k + '-ink');
        const r = grounds.concat('--' + k + '-bg').map(g => [g, Math.round(T.contrast(c, T.token(g)) * 100) / 100]);
        return { k, ink: c && c.slice(0, 3).map(Math.round).join(','), min: Math.min(...r.map(x => x[1])), r }; });
    }, INKS);
    for (const x of m) ok(`${id}${id === 'auto' ? ' on a dark device' : ''}: ${x.k} text clears 4.5:1 on the page, a card, the raised surface and its own tint`,
      x.min >= 4.5, `ink ${x.ink}; ` + x.r.map(([g, v]) => g + ' ' + v).join(', '));
  }
  await theme('monitor', 'light');
  const apart = await page.evaluate(() => { const T = window.__ink; return Math.round(Math.abs(T.hue(T.token('--green-ink')) - T.hue(T.token('--teal')))); });
  ok('Monitor: the green ink is at least 20° of hue from the teal accent, so "correct" does not read as the accent', apart >= 20, apart + '°');

  head('in a light theme each ink is its fill, as the page always was');
  for (const [id, scheme] of LIGHT) {
    await theme(id, scheme);
    const m = await page.evaluate(inks => { const T = window.__ink;
      return inks.map(k => ({ k, same: T.same(T.token('--' + k + '-ink'), T.token('--' + k)), fill: T.token('--' + k) && T.token('--' + k).slice(0, 3).join(','), ink: T.token('--' + k + '-ink') && T.token('--' + k + '-ink').slice(0, 3).map(Math.round).join(',') })); }, INKS);
    ok(`${id}${scheme === 'dark' ? ' on a dark device' : ''}: green, red and amber text are the fill colours`, m.every(x => x.same), JSON.stringify(m));
  }

  /* Real text, coloured by the stylesheets and the shell's own inline styles. Each is measured against what is under it
     on the page, in every dark theme, with the page left where it is. */
  const measure = (probes) => page.evaluate(probes => { const T = window.__ink;
    return probes.map(([name, sel]) => { const el = document.querySelector(sel); if (!el) return { name, missing: sel };
      const c = T.parse(getComputedStyle(el).color), g = T.ground(el);
      return { name, ratio: Math.round(T.contrast(c, g) * 100) / 100, c: c.slice(0, 3).map(Math.round).join(',') }; }); }, probes);
  const sweep = async (probes, where) => {
    const per = {};
    for (const [id, scheme] of DARK) { await theme(id, scheme); for (const r of await measure(probes)) (per[r.name] = per[r.name] || []).push([id, r]); }
    for (const [name] of probes) {
      const rows = per[name], bad = rows.filter(([, r]) => r.missing || !(r.ratio >= 4.5));
      ok(`${where}: ${name} clears 4.5:1 in every dark theme`, bad.length === 0,
        rows.map(([id, r]) => id + ' ' + (r.missing ? 'missing' : r.ratio)).join(', '));
    }
    await theme('daylight', 'light');
    const day = await page.evaluate(probes => { const T = window.__ink;
      return probes.map(([name, sel, k]) => { const el = document.querySelector(sel); return { name, same: !!el && T.same(T.parse(getComputedStyle(el).color), T.token('--' + k)) }; }); }, probes);
    ok(`${where}: in Daylight the same text is the fill colour it always was`, day.every(x => x.same), JSON.stringify(day.filter(x => !x.same)));
  };

  head('real text on the quiz');
  await page.evaluate(() => { const q = POOL.find(x => !x.bad); startAdhocQuiz([q], null); });
  const up = await page.waitForFunction(() => S.screen === 'quiz' && !!document.querySelector('.opt'), null, { timeout: 8000 }).then(() => true, () => false);
  await quiet(page);
  await page.evaluate(() => { const q = S.questions[S.qIdx]; selectOpt((q.ci + 1) % q.o.length); toggleFlag(); });
  await page.waitForFunction(() => S.answered === true && !!document.querySelector('.opt.wrong .opt-pct'), null, { timeout: 6000 }).catch(() => {});
  await quiet(page);
  ok('the quiz is up, answered wrong, and flagged (precondition)', up && await page.evaluate(() => S.answered === true && !!document.querySelector('.btn-flag.on')));
  await sweep([['the wrong option\'s peer figure', '.opt.wrong .opt-pct', 'red'], ['the right option\'s peer figure', '.opt.correct .opt-pct', 'green'],
    ['the Flag button, on', '.btn-flag.on', 'amber']], 'quiz');
  await theme('midnight', 'light');
  const badge = await page.evaluate(() => { const T = window.__ink, el = document.querySelector('.opt.correct .opt-letter'); if (!el) return null;
    const cs = getComputedStyle(el); return { bg: T.same(T.parse(cs.backgroundColor), T.token('--success')), white: T.same(T.parse(cs.color), [255, 255, 255]) }; });
  ok('the right option\'s letter badge is still white on the deep green', !!badge && badge.bg && badge.white, JSON.stringify(badge));

  head('real text on the results');
  await page.evaluate(() => nextQ());
  const res = await page.waitForFunction(() => S.screen === 'results' && !!document.querySelector('.score-pct'), null, { timeout: 8000 }).then(() => true, () => false);
  await quiet(page);
  ok('the results are up (precondition)', res);
  await sweep([['the score', '.score-pct', 'red'], ['a chapter\'s figure', '.chp-pct', 'red'], ['Retry Missed', 'button[onclick*="\'missed\'"]', 'red']], 'results');

  head('hygiene');
  ok('the page threw nothing', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
