#!/usr/bin/env node
/*
 * Green, red and amber text that can be read, in every theme.
 *
 *   node tests/verify-ink.js build/synthetic/systole.html
 *
 * --green, --red and --amber are one colour in every theme (verify-theme, verify-tokens) and fill the letter badges
 * under white type. As text they read at 3.2 to 5.0:1 on the light grounds and 3.0 to 4.9:1 on the dark ones, under the
 * 4.5:1 that text needs, so text in them takes --green-ink, --red-ink or --amber-ink: a step darker in a light theme, a
 * step lighter in a dark one. What is measured, rather than assumed:
 *   · no stylesheet rule writes text in a fill colour (the rules as written, comments blanked);
 *   · in each of the nine themes, and in Auto and a light theme on a device of the other scheme, each ink clears 4.5:1
 *     on the page, a card, the raised surface and its own tint; the dark green ink stays clear of Monitor's teal accent;
 *   · real text the shell colours itself clears 4.5:1 against what is under it in every one of those, and is written in
 *     its ink: an option's peer figure, right and wrong, the Flag button on, and on a quiz's results the score, a
 *     chapter's figure and Retry Missed. The mock report writes its score and chapter figures through the same semText,
 *     and is not opened here;
 *   · the correct option's letter badge is still white on the deep green;
 *   · the accent as text takes --teal-ink, the same way: no rule or inline style is written color:var(--teal),
 *     var(--teal2) or var(--accent) (the scan reads that form; the chapter icons' color:var(--accent,var(--teal)) is a
 *     graphic's colour, held to 3:1, and is not read), and in each of those twelve states the ink clears 4.5:1 on the page, a card, the raised surface, the
 *     accent's tint (--teal4) and the green tint some of it sits on;
 *   · real accent and chapter text, in every state: a chapter's badge on the quiz and its label in search results, a
 *     figure's zoom hint, a note's tags, the source picked in Apex's settings, the rhythm lab's phase chip, a chapter
 *     tile's percentage (in its own chapter's ink, not the accent's), and the Echo screen's selected tab (text on the ink
 *     rather than in it, with no glass sheen under it); a chapter with no colour of its own takes the accent ink;
 *   · every <select> on those screens has a name a screen reader can say (two had none);
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

/* [theme, the device's own scheme, how a check names it] */
const STATES = [['auto', 'dark', 'Auto on a dark device'], ['midnight', 'light', 'Midnight'], ['nocturne', 'light', 'Nocturne'],
  ['cathlab', 'light', 'Cath Lab'], ['monitor', 'light', 'Monitor'], ['contrast', 'light', 'Contrast'],
  ['auto', 'light', 'Auto on a light device'], ['daylight', 'light', 'Daylight'], ['slate', 'light', 'Slate'], ['parchment', 'light', 'Parchment'],
  ['daylight', 'dark', 'Daylight on a dark device'], ['parchment', 'dark', 'Parchment on a dark device']];
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
  const colour = expr => { const p = document.createElement('div'); p.style.color = expr; document.body.appendChild(p);
    const c = parse(getComputedStyle(p).color); p.remove(); return c; };
  const token = name => colour('var(' + name + ')');
  /* What lies under an element: its own background and its ancestors', composited until one is opaque. */
  const ground = el => { const layers = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } }
    let g = [255, 255, 255, 1]; for (let i = layers.length - 1; i >= 0; i--) g = over(layers[i], g); return g; };
  const hue = c => { const [r, g, b] = c.slice(0, 3).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return 0; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
  window.__ink = { parse, contrast, colour, token, ground, hue, same: (a, b) => !!a && !!b && a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) < 0.6) };
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
    /* The accent the same way: as text it read at 3.6-4.1:1 in Daylight and 3.7-4.4:1 in Midnight. */
    const accent = [];
    for (const f of files) {
      const src = blankComments(fs.readFileSync(path.join(dir, f), 'utf8'));
      for (const m of src.matchAll(/(?<![-\w])color\s*:\s*var\(--(teal|teal2|accent|accent-2)\)/g)) accent.push(f + ':' + (src.slice(0, m.index).split('\n').length) + ' ' + m[0]);
    }
    const accentInline = [...shell.matchAll(/(?<![-\w])color\s*:\s*var\(--(teal|teal2|accent|accent-2)\)/g)].map(m => shell.slice(0, m.index).split('\n').length);
    ok('no stylesheet or inline style is written color:var(--teal), var(--teal2) or var(--accent); accent text takes --teal-ink', accent.length === 0 && accentInline.length === 0,
      accent.concat(accentInline.map(l => 'systole.html:' + l)).slice(0, 6).join('; ') || 'none');
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

  head('each ink on each ground of each theme');
  for (const [id, scheme, name] of STATES) {
    await theme(id, scheme);
    const m = await page.evaluate(inks => {
      const T = window.__ink;
      return inks.map(k => { const c = T.token('--' + k + '-ink');
        const grounds = [['page', T.token('--bg')], ['card', T.token('--card')], ['raised', T.token('--white')], ['tint', T.token('--' + k + '-bg')]];
        const r = grounds.map(([g, v]) => [g, c && v ? Math.round(T.contrast(c, v) * 100) / 100 : 0]);
        return { k, ink: c && c.slice(0, 3).map(Math.round).join(','), min: Math.min(...r.map(x => x[1])), r }; });
    }, INKS);
    for (const x of m) ok(`${name}: ${x.k} text clears 4.5:1 on the page, a card, the raised surface and its own tint`,
      x.min >= 4.5, `ink ${x.ink}; ` + x.r.map(([g, v]) => g + ' ' + v).join(', '));
  }
  head('the accent ink on each ground of each theme');
  for (const [id, scheme, name] of STATES) {
    await theme(id, scheme);
    /* Read only if the theme defines it: an undefined token falls back to the body's text, which reads, and would pass. */
    const t = await page.evaluate(() => { const T = window.__ink, c = getComputedStyle(document.documentElement).getPropertyValue('--teal-ink').trim() ? T.token('--teal-ink') : null;
      const r = [['page', '--bg'], ['card', '--card'], ['raised', '--white'], ['tint', '--teal4'], ['green tint', '--green-bg']].map(([g, v]) => [g, c ? Math.round(T.contrast(c, T.token(v)) * 100) / 100 : 0]);
      return { ink: c && c.slice(0, 3).map(Math.round).join(','), min: Math.min(...r.map(x => x[1])), r }; });
    ok(`${name}: accent text clears 4.5:1 on the page, a card, the raised surface, its tint and the green tint`, t.min >= 4.5, `ink ${t.ink}; ` + t.r.map(([g, v]) => g + ' ' + v).join(', '));
  }
  await theme('monitor', 'light');
  const apart = await page.evaluate(() => { const T = window.__ink; return Math.round(Math.abs(T.hue(T.token('--green-ink')) - T.hue(T.token('--teal')))); });
  ok('Monitor: the green ink is at least 20° of hue from the teal accent, so "correct" does not read as the accent', apart >= 20, apart + '°');

  /* Real text, coloured by the stylesheets and the shell's own inline styles. Each is measured against what is under it
     on the page, in every theme, with the page left where it is; and it has to be its ink, so text that reads only because
     it lost its colour (written in --text, say) is caught as well. */
  const measure = probes => page.evaluate(probes => { const T = window.__ink;
    return probes.map(([name, sel, k]) => { const el = document.querySelector(sel); if (!el) return { name, missing: sel };
      const c = T.parse(getComputedStyle(el).color), g = T.ground(el);
      return { name, ratio: Math.round(T.contrast(c, g) * 100) / 100, inked: T.same(c, T.token('--' + k + '-ink')) }; }); }, probes);
  const sweep = async (probes, where) => {
    const per = {};
    for (const [id, scheme, label] of STATES) { await theme(id, scheme); for (const r of await measure(probes)) (per[r.name] = per[r.name] || []).push([label, r]); }
    for (const [name] of probes) {
      const rows = per[name], bad = rows.filter(([, r]) => r.missing || !(r.ratio >= 4.5));
      ok(`${where}: ${name} clears 4.5:1 in every theme`, bad.length === 0,
        bad.length ? bad.map(([id, r]) => id + ' ' + (r.missing ? 'missing' : r.ratio)).join(', ') : 'lowest ' + Math.min(...rows.map(([, r]) => r.ratio)));
    }
    const off = Object.values(per).flat().filter(([, r]) => !r.inked).map(([id, r]) => r.name + ' in ' + id);
    ok(`${where}: and in every theme that text is written in its ink`, off.length === 0, off.slice(0, 4).join('; ') || 'all');
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

  head('real accent and chapter text');
  {
    /* Each screen is drawn again for each state: the chapter colour is mixed for the theme when the screen is drawn. */
    /* A screen fades in, so it is read at rest: each entrance and transition that has an end is put at it (what the app's
       settleEntrances does for a redraw); one that goes on for ever is left. Read mid-fade, the text was at 1-3:1. */
    const rest = () => page.evaluate(() => { for (let k = 0; k < 4; k++) { const a = document.getAnimations().filter(x => x.playState === 'running' && x.effect && x.effect.getComputedTiming().iterations !== Infinity); if (!a.length) break; a.forEach(x => { try { x.finish(); } catch (_) {} }); } });
    const at = async (go, then) => { await page.evaluate(`(${go})()`); await quiet(page); if (then) { await page.evaluate(`(${then})()`); await quiet(page); } await rest(); };
    const read = probes => page.evaluate(probes => { const T = window.__ink;
      /* The text as painted: its colour's alpha times the opacity of it and every ancestor, over what is under it. The
         zoom hint was faint by opacity, not by colour. */
      return probes.map(([name, sel]) => { const el = document.querySelector(sel); if (!el) return { name, missing: sel };
        let a = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) a *= parseFloat(getComputedStyle(n).opacity);
        const c = T.parse(getComputedStyle(el).color), g = T.ground(el), seen = [0, 1, 2].map(i => c[i] * c[3] * a + g[i] * (1 - c[3] * a));
        return { name, ratio: Math.round(T.contrast(seen, g) * 100) / 100 }; }); }, probes);
    const screens = [
      ['the quiz, a question with a figure', () => { startAdhocQuiz([POOL.find(x => !x.bad && x.img)], null); }, null,
        [['a chapter\'s badge', '.ch-badge'], ['a figure\'s zoom hint', '.fig-zoom-hint']]],
      ['the search screen', () => { openSearch(); }, () => {
        /* A word the bank's own questions hold, so there are results on any bank. */
        let w = null;
        for (const q of POOL) { for (const x of (q.s + ' ' + q.ex).split(/[^A-Za-z]+/)) if (x.length >= 7 && search(x, { limit: 5 }).some(h => h.meta.kind === 'q')) { w = x; break; } if (w) break; }
        searchGo(w || ''); }, [['a result\'s chapter label', '.hit-ch']]],
      ['the notes', () => { goRefs(); }, null, [['a note\'s tag', '.ref-tags span:not(.ref-more)']]],
      ['Apex\'s settings', () => { startAdhocQuiz([POOL.find(x => !x.bad)], null); }, () => { if (!document.getElementById('shell').classList.contains('ai-open')) toggleAI(); },
        [['the source picked', '.prov-pick.on .pp-name']]],
      ['the rhythm lab', () => { goLab(); }, null, [['the phase chip', '#physioPhase']]],
      ['the Echo screen', () => { goEcho(); }, null, [['the selected tab', '.echo-tab.on']]],
      ['Study', () => { goStudy(); }, null, [['a chapter tile\'s percentage', '.ch-tile .ct-foot b']]],
    ];
    const per = {}, names = [];
    for (const [id, scheme, label] of STATES) {
      await theme(id, scheme);
      for (const [where, go, then, probes] of screens) {
        await page.evaluate(() => { if (document.getElementById('shell').classList.contains('ai-open')) toggleAI(); });
        await at(go, then);
        for (const r of await read(probes)) { const k = where + ': ' + r.name; if (!per[k]) { per[k] = []; names.push(k); } per[k].push([label, r]); }
      }
    }
    for (const k of names) {
      const bad = per[k].filter(([, r]) => r.missing || !(r.ratio >= 4.5));
      ok(`${k} clears 4.5:1 in every theme`, bad.length === 0,
        bad.length ? bad.slice(0, 4).map(([l, r]) => l + ' ' + (r.missing ? 'missing' : r.ratio)).join(', ') : 'lowest ' + Math.min(...per[k].map(([, r]) => r.ratio)));
    }
    await theme('daylight', 'light');
    await at(() => { goStudy(); });
    const tile = await page.evaluate(() => { const T = window.__ink, b = document.querySelector('.ch-tile .ct-foot b'); if (!b) return null;
      const t = b.closest('.ch-tile'), ink = T.colour(getComputedStyle(t).getPropertyValue('--ch-ink').trim() || 'transparent'), c = T.parse(getComputedStyle(b).color);
      return { own: T.same(c, ink), accent: T.same(c, T.token('--teal-ink')), ink: getComputedStyle(t).getPropertyValue('--ch-ink').trim() }; });
    ok('a chapter tile\'s percentage is in its own chapter\'s ink, not the accent\'s', !!tile && tile.own && !tile.accent, JSON.stringify(tile));
    ok('a chapter with no colour of its own (a bank\'s own chapters) takes the accent ink', await page.evaluate(() => chInk('var(--teal)') === 'var(--teal-ink)' && /^#[0-9a-f]{6}$/.test(chInk('#6366F1'))));
    await at(() => { goEcho(); });
    const sheen = await page.evaluate(() => { const on = document.querySelector('.echo-tab.on'), off = document.querySelector('.echo-tab:not(.on)');
      return { on: on ? getComputedStyle(on, '::after').backgroundImage : null, off: off ? getComputedStyle(off, '::after').backgroundImage : null }; });
    ok('the selected Echo tab has no glass sheen under its text, where the others have one', !!sheen.on && sheen.on === 'none' && !!sheen.off && /gradient/.test(sheen.off),
      JSON.stringify({ on: sheen.on && sheen.on.slice(0, 40), off: sheen.off && sheen.off.slice(0, 40) }));
    await at(() => { openSearch(); }, () => { if (!document.getElementById('shell').classList.contains('ai-open')) toggleAI(); });
    const unnamed = await page.evaluate(() => { const s = [...document.querySelectorAll('select')];
      return { n: s.length, bare: s.filter(x => !x.labels.length && !(x.getAttribute('aria-label') || '').trim() && !x.getAttribute('aria-labelledby')).map(x => '#' + x.id) }; });
    ok('every <select> on the search screen and in Apex\'s settings has a name', unnamed.n >= 2 && unnamed.bare.length === 0, `${unnamed.n} selects; unnamed: ${unnamed.bare.join(' ') || 'none'}`);
  }

  head('hygiene');
  ok('the page threw nothing', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
