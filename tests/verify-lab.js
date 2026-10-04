#!/usr/bin/env node
/*
 * The Lab, built and driven in a browser: heart sounds, pressure tracings, ECG strips and the
 * heart map, on pages that carry no licensed content.
 *
 *   node tests/verify-lab.js
 *
 * Takes no build argument: it builds lab/ itself, into a temporary directory, as
 * verify-memorizer does, and opens the result as a file. The pure suites hold what the Lab
 * knows (verify-lab-pure, verify-drills-pure); this holds that the page is wired to it:
 *
 *   · WHAT IS PLAYED IS THE ITEM THE ANSWER KEY NAMES. All twelve heart sounds are asked, the
 *     audio buffer handed to the browser is read back sample by sample, and where its energy
 *     sits (systole, diastole, both, neither) must be what the heart map says that lesion is.
 *     A page that played another lesion's sound would still draw and still score.
 *   · NOTHING NAMES THE ANSWER BEFORE IT IS GIVEN: not the description, not the S1/S2 marks,
 *     not the labelled waves; all of it appears after, and the canvas shows it by pixels.
 *   · THE PROGRESS IS REAL: stored, read back after a reload, tallied on the home screen, and
 *     gone after a reset. With storage refused the Lab opens, says so, and still works.
 *   · THE MAP IS DRAWN FROM THE MAP: for each of the 24 conditions the enlarged chambers, the
 *     thickened ones, the faulty valve and its kind, the abnormal flows and the place on the
 *     chest are what src/lab/heartmap.js says, read back off the DOM.
 *   · NOTHING LEAVES THE DEVICE, nothing throws, nothing scrolls sideways on a phone, and the
 *     page reads in the dark.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };
const errors = [], events = [];
const die = onDeath(() => ({ section, checks: passed + failed, errors, events }));

const ROOT = path.join(__dirname, '..');
const { build, ZIP_FILES, HEADERS } = require(path.join(ROOT, 'scripts', 'build-lab.js'));
const { zipOf } = require(path.join(ROOT, 'scripts', 'build-memorizer.js'));

/* The browser's audio output, watched and let through: every buffer made and every start. */
const spyOnAudio = () => {
  const log = { buffers: [], started: 0, stopped: 0, loops: [] };
  window.__audio = log;
  const Real = window.AudioContext || window.webkitAudioContext;
  if (!Real) return;
  class Spy extends Real {
    createBuffer(ch, len, rate) { const b = super.createBuffer(ch, len, rate); log.buffers.push({ ch, len, rate, b }); return b; }
    createBufferSource() {
      const s = super.createBufferSource(), start = s.start.bind(s), stop = s.stop.bind(s);
      s.start = (...a) => { log.started++; log.loops.push(s.loop); return start(...a); };
      s.stop = (...a) => { log.stopped++; return stop(...a); };
      return s;
    }
  }
  window.AudioContext = Spy; window.webkitAudioContext = Spy;
};

/* In the page: where the energy of the last buffer played sits (it holds `beats` beats), in the windows the pure suite uses. */
const energy = beats => {
  const last = window.__audio.buffers[window.__audio.buffers.length - 1];
  const d = last.b.getChannelData(0), per = d.length / beats;
  const rms = (a, b) => { let s = 0, n = 0; for (let k = 0; k < beats; k++) for (let i = Math.floor((k + a) * per); i < Math.floor((k + b) * per); i++) { s += d[i] * d[i]; n++; } return Math.sqrt(s / n); };
  let peak = 0; for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  return { rate: last.rate, len: d.length, sys: rms(0.22, 0.38), dia: rms(0.50, 0.80), peak };
};

/* In the page: how many pixels of the first canvas are the trace's ink, and how many the accent's. */
const pixels = () => {
  const c = document.querySelector('canvas.view'), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data;
  let ink = 0, accent = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 100) ink++;
    else if (d[i + 2] > 180 && d[i] < 120 && d[i + 1] < 150) accent++;
  }
  return { ink, accent, w: c.width, h: c.height };
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-'));
  const built = build(dir);
  const URL = 'file://' + path.join(dir, 'index.html');
  const T = { timeout: 30000 };

  head('the build is one page and the files that make it installable');
  {
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    ok('every script and stylesheet is inlined: no tag still points at a file, and none is left marked', !/<script[^>]*\ssrc=/.test(html) && !/<link[^>]*rel="stylesheet"/.test(html) && !/<(script|link)\b[^>]*data-inline/.test(html) && built.inlined.length === 12, built.inlined.length + ' files inlined');
    ok('all of the Lab\'s modules are in it, and none of the others', ['HeartSounds', 'Tracings', 'Strips', 'HeartMap', 'Drill', 'LabProgress', 'LabItems', 'Physio', 'RhythmsExtra', 'FSRS'].every(n => html.includes('root.' + n + ' =')) && !/ACCSAP|MemStore|Memorizer/.test(html));
    ok('the page asks the browser for nothing from anywhere else: its policy has connect-src \'self\' and no host', /connect-src 'self'/.test(html) && !/https?:\/\/[^"'\s]*cdn|jsdelivr|googleapis/.test(html) && /default-src 'none'/.test(html));
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.webmanifest'), 'utf8'));
    ok('it has a manifest a phone can install, with a name and an icon', manifest.name === 'Systole Lab' && manifest.display === 'standalone' && manifest.icons.length === 1 && fs.existsSync(path.join(dir, manifest.icons[0].src)));
    ok('the headers refuse framing and every device permission, the microphone too: the Lab only plays sound', /frame-ancestors 'none'/.test(HEADERS) && /microphone=\(\)/.test(HEADERS) && /camera=\(\)/.test(HEADERS) && fs.readFileSync(path.join(dir, '_headers'), 'utf8') === HEADERS);
    const zip = zipOf(dir, ZIP_FILES), names = [];
    for (let at = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])), seen = 0; at >= 0 && seen < 99; seen++) {
      const n = zip.readUInt16LE(at + 28); names.push(zip.toString('utf8', at + 46, at + 46 + n)); const prev = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), at - 1); if (prev < 0 || prev === at) break; at = prev;
    }
    /* the five files Cloudflare Pages needs, written out here and not read from the builder, which would agree with itself */
    const FIVE = ['_headers', 'icon.svg', 'index.html', 'manifest.webmanifest', 'sw.js'];
    ok('the Cloudflare zip holds exactly the five files Pages needs, by bare name with forward slashes, at its root', names.sort().join() === FIVE.join() && names.every(n => !/[\\/]/.test(n)) && ZIP_FILES.slice().sort().join() === FIVE.join(), names.join(', '));
    ok('and the service worker caches the page it was built with and no other', /lab-shell-[a-f0-9]{12}/.test(fs.readFileSync(path.join(dir, 'sw.js'), 'utf8')) && fs.readFileSync(path.join(dir, 'sw.js'), 'utf8').includes(built.stamp) && html.includes('data-build="' + built.stamp + '"'));
  }

  const browser = await launch();
  const outside = [];
  const open = async (tag, opts, init) => {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 900, height: 900 }, serviceWorkers: 'block' }, opts || {}));
    const p = watch(await ctx.newPage(), events, tag, errors);
    p.on('console', m => { if (m.type() === 'error') errors.push(tag + ': console ' + m.text()); });
    p.on('request', r => { if (!/^(file|data|blob):/.test(r.url())) outside.push(tag + ' ' + r.url()); });
    p.on('dialog', d => d.accept());
    await p.addInitScript(spyOnAudio);
    if (init) await p.addInitScript(init);
    await p.goto(URL);
    await p.locator('.tiles').waitFor(T);
    return p;
  };
  const state = p => p.evaluate(() => window.__lab.state());
  const text = (p, sel) => p.locator(sel).innerText();

  /* ── home ──────────────────────────────────────────────────────────── */
  const p = await open('main');
  head('home: three drills and the heart map, each with its true count');
  {
    ok('the page is the Lab', (await p.title()) === 'Systole Lab');
    const counts = await p.evaluate(() => ({ items: Object.fromEntries(Object.entries(window.LabItems.ITEMS).map(([k, v]) => [k, v.length])), tiles: Array.from(document.querySelectorAll('.tile')).map(t => t.innerText) }));
    ok('there are three drill tiles and the heart map', counts.tiles.length === 4, counts.tiles.map(t => t.split('\n')[0]).join(' | '));
    ok('each drill tile says how many items it has, and the number is the number there are', ['sounds', 'tracings', 'strips'].every((k, i) => counts.tiles[i].includes('0 of ' + counts.items[k] + ' seen')) && counts.items.sounds === 12 && counts.items.strips === 15, JSON.stringify(counts.items));
    ok('and the heart map tile counts its conditions', /24 conditions/.test(counts.tiles[3]));
    ok('a new user has no streak, nothing answered, nothing due', /0\s*day streak/.test(await text(p, '.stats')) && /–\s*right, all time/.test(await text(p, '.stats')));
    ok('the page says plainly that the teaching points are the app\'s own and unreviewed', /not been reviewed by a clinician/.test(await text(p, 'footer')));
  }

  /* ── heart sounds: what is played is what is asked ─────────────────── */
  head('heart sounds: what is played is the item the answer key names');
  {
    await p.click('[data-kind="sounds"]');
    const asked = [], wrong = [];
    for (let i = 0; i < 12; i++) {
      const st = await state(p);
      const names = await p.locator('.option span:last-child').allInnerTexts();
      const before = await p.evaluate(pixels);
      const body = await p.evaluate(() => document.querySelector('#app').innerHTML);   // the page, not the scripts it carries
      const info = await p.evaluate(k => { const it = window.LabItems.byId(k); return { key: it.key, name: it.name, blurb: it.blurb, phase: window.HeartMap.phaseOf(it.key) }; }, st.item);
      await p.click('[data-act="play"]');
      await p.waitForFunction(n => window.__audio.buffers.length > n, i, T);
      const e = await p.evaluate(energy, 4);
      const loud = 0.02;
      const fits = info.phase === 'systolic' ? e.sys >= loud && e.sys >= 2 * e.dia
        : info.phase === 'diastolic' ? e.dia >= loud && e.dia >= 2 * e.sys
        : info.phase === 'continuous' ? e.sys >= loud && e.dia >= loud
        : e.sys < loud;
      asked.push({ st, info, e, fits, names, leaked: body.includes(info.blurb), pre: before.accent });
      if (!fits) wrong.push(info.key + ' ' + info.phase + ' sys ' + e.sys.toFixed(3) + ' dia ' + e.dia.toFixed(3));
      await p.click(`.option[data-id="${st.item}"]`);
      if (i < 11) await p.click('#next');
    }
    ok('twelve questions were twelve different heart sounds, as new ones come first', new Set(asked.map(a => a.st.item)).size === 12, asked.map(a => a.info.key).join(' '));
    ok('the audio handed to the browser is the lesion asked about: loud in systole, or diastole, or both, or in neither, as the heart map says, for all twelve', wrong.length === 0, wrong.join(' | ') || asked.map(a => a.info.key + ':' + a.info.phase).join(' '));
    ok('it is 8 kHz mono, a few seconds long, and well above silence', asked.every(a => a.e.rate === 8000 && a.e.len > 8000 * 2 && a.e.len < 8000 * 6 && a.e.peak > 0.5), asked[0].e.len + ' samples');
    ok('each question offers four different answers, one of them the answer key\'s', asked.every(a => a.names.length === 4 && new Set(a.names).size === 4 && a.names.includes(a.info.name)));
    ok('and nothing names the answer before it is given: its description is not in the page', asked.every(a => !a.leaked));
    ok('nor are its S1 and S2 marks on the waveform, which appear only afterwards', asked.every(a => a.pre === 0));
    const log = await p.evaluate(() => ({ loops: window.__audio.loops, started: window.__audio.started }));
    ok('Play loops, so a murmur can be listened to for as long as it takes', log.started === 12 && log.loops.every(l => l === true), JSON.stringify(log));
    const sum = await p.evaluate(() => window.__lab.progress());
    ok('all twelve answered correctly are twelve cards, and a tally of twelve right', Object.keys(sum.cards).length === 12 && Object.values(sum.days).every(d => d.n === 12 && d.c === 12), JSON.stringify(Object.values(sum.days)));
  }

  head('heart sounds: play, stop, and the answer revealed on the waveform');
  {
    await p.click('[data-act="home"]');
    await p.click('[data-kind="sounds"]');
    const btn = p.locator('[data-act="play"]');
    ok('the player starts stopped', (await btn.getAttribute('aria-pressed')) === 'false');
    const before = await p.evaluate(() => window.__audio.started);
    await btn.click();
    ok('Play starts it, and the button says Stop and is pressed', (await p.evaluate(() => window.__audio.started)) === before + 1 && (await btn.getAttribute('aria-pressed')) === 'true' && /Stop/.test(await btn.innerText()));
    const cur = await p.evaluate(() => new Promise(r => setTimeout(() => r(document.querySelector('.cursor').className + '|' + document.querySelector('.cursor').style.left), 250)));
    ok('and a cursor follows it across the waveform', /on/.test(cur) && /%/.test(cur), cur);
    const stoppedBefore = await p.evaluate(() => window.__audio.stopped);
    await btn.click();
    ok('Stop stops it', (await p.evaluate(() => window.__audio.stopped)) === stoppedBefore + 1 && (await btn.getAttribute('aria-pressed')) === 'false');
    await btn.click();
    const st = await state(p);
    const right = st.options.find(id => id === st.item);
    await p.click(`.option[data-id="${right}"]`);
    const after = await p.evaluate(pixels);
    ok('answering draws the S1 and S2 marks on the waveform, in the accent colour', after.accent > 40, after.accent + ' accent pixels');
    ok('and the waveform itself is on the canvas throughout', after.ink > 200, after.ink + ' ink pixels');
    ok('a sound that was playing keeps playing while the answer is shown', (await btn.getAttribute('aria-pressed')) === 'true');
    await p.click('#next');
    ok('and the next question starts silent', (await p.locator('[data-act="play"]').getAttribute('aria-pressed')) === 'false');
  }

  /* ── tracings ──────────────────────────────────────────────────────── */
  head('pressure tracings: drawn, and labelled only after the answer');
  {
    await p.click('[data-act="home"]');
    await p.click('[data-kind="tracings"]');
    const st = await state(p);
    const q = await p.evaluate(pixels);
    ok('the tracing is on the canvas, and none of its waves are labelled yet', q.ink > 300 && q.accent === 0, `${q.ink} ink, ${q.accent} accent`);
    const wrongId = st.options.find(id => id !== st.item);
    await p.click(`.option[data-id="${wrongId}"]`);
    const a = await p.evaluate(pixels);
    ok('a wrong answer labels the waves and says what it was', a.accent > 20 && /Not quite\./.test(await text(p, '.verdict')), `${a.accent} accent pixels`);
    ok('the right option is marked right and the chosen one wrong, and none can be pressed again', (await p.locator('.option.right').count()) === 1 && (await p.locator('.option.wrong').count()) === 1 && (await p.locator('.option:not([disabled])').count()) === 0);
    ok('and it says what the wrong choice was, so the difference can be learnt', /You chose/.test(await text(p, '#feedback')));
    const prog = await p.evaluate(() => window.__lab.progress());
    const key = st.item;
    const rightCard = await p.evaluate(() => window.Drill.grade({ card: null, correct: true, today: window.FSRS.todayISO() }));
    ok('the miss is stored as a card with a lapse, due sooner than a right first answer would have made it', prog.cards[key] && prog.cards[key].lapses === 1 && prog.cards[key].due < rightCard.due, JSON.stringify([prog.cards[key] && prog.cards[key].due, rightCard.due]));
    const sameAgain = await p.evaluate(k => { const it = window.LabItems.byId(k); return Array.from(document.querySelectorAll('.chip')).map(c => c.innerText).filter(t => it.confusableWith.map(id => window.LabItems.byId(id).name).includes(t)).length; }, key);
    ok('it lists the look-alikes it is mistaken for', sameAgain >= 1, String(sameAgain));
  }

  /* ── strips ────────────────────────────────────────────────────────── */
  head('ECG strips: all fifteen, each with its rate');
  {
    await p.click('[data-act="home"]');
    await p.click('[data-kind="strips"]');
    const seen = [];
    for (let i = 0; i < 15; i++) {
      const st = await state(p);
      const q = await p.evaluate(pixels);
      await p.click(`.option[data-id="${st.item}"]`);
      const said = await text(p, '#feedback');
      const rate = +(/about (\d+) a minute/.exec(said) || [0, 0])[1];
      const ref = await p.evaluate(k => ({ hr: window.RhythmsExtra.EXTRA[k.slice(4)].hr }), st.item);
      seen.push({ id: st.item, ink: q.ink, rate, hr: ref.hr });
      if (i < 14) await p.click('#next');
    }
    ok('all fifteen rhythms came up, once each', new Set(seen.map(s => s.id)).size === 15);
    ok('every strip is drawn: its trace is on the canvas', seen.every(s => s.ink > 300), seen.map(s => s.ink).join(','));
    const declared = ['sinus_arrhythmia', 'avb1', 'svt', 'junctional', 'idioventricular', 'wpw', 'lbbb', 'rbbb', 'hyperk', 'longqt', 'pericarditis'];
    const off = seen.filter(s => declared.includes(s.id.slice(4)) && Math.abs(s.rate - s.hr) / s.hr > 0.08);
    ok('the rate the page reports is the rhythm\'s own, on the eleven where that is the ventricular rate', off.length === 0, off.map(s => s.id + ' ' + s.rate + ' vs ' + s.hr).join(', ') || '11 within 8%');
    ok('and every strip has a rate', seen.every(s => s.rate > 20 && s.rate < 250));
  }

  /* ── progress ──────────────────────────────────────────────────────── */
  head('progress is stored, comes back after a reload, and is gone after a reset');
  {
    await p.click('[data-act="home"]');
    const tiles = await p.locator('.tile').allInnerTexts();
    ok('the home tiles count what was seen: all twelve sounds and fifteen strips', /12 of 12 seen/.test(tiles[0]) && /15 of 15 seen/.test(tiles[2]), tiles.map(t => t.split('\n').pop()).join(' | '));
    ok('and the stats say a streak of one day', /1\s*day streak/.test(await text(p, '.stats')));
    const before = await p.evaluate(() => JSON.stringify(window.__lab.progress()));
    await p.reload(); await p.locator('.tiles').waitFor(T);
    ok('after a reload the record is the same one', (await p.evaluate(() => JSON.stringify(window.__lab.progress()))) === before);
    ok('and the home screen shows it', /12 of 12 seen/.test((await p.locator('.tile').allInnerTexts())[0]));
    await p.click('[data-act="reset"]');
    const after = await p.evaluate(() => window.__lab.progress());
    ok('Reset forgets it: no cards, no days', Object.keys(after.cards).length === 0 && Object.keys(after.days).length === 0 && /0 of 12 seen/.test((await p.locator('.tile').allInnerTexts())[0]));
    await p.reload(); await p.locator('.tiles').waitFor(T);
    ok('and stays forgotten after a reload', /0 of 12 seen/.test((await p.locator('.tile').allInnerTexts())[0]));
  }

  /* ── the keyboard ──────────────────────────────────────────────────── */
  head('the keyboard: a number answers, Enter goes on, Escape goes home');
  {
    await p.click('[data-kind="tracings"]');
    const q1 = await state(p);
    await p.keyboard.press('2');
    const a1 = await state(p);
    ok('pressing 2 chooses the second option', a1.picked === q1.options[1], a1.picked + ' of ' + q1.options.join(','));
    await p.keyboard.press('3');
    ok('and a second number does not change the answer', (await state(p)).picked === q1.options[1]);
    await p.keyboard.press('Enter');
    const q2 = await state(p);
    ok('Enter asks the next question, a different one, not yet answered', q2.picked === null && q2.item !== q1.item);
    await p.keyboard.press('1');
    await p.evaluate(() => document.activeElement.blur());
    ok('with nothing focused, n asks the next question too: the page\'s own handler, not a focused button\'s', (await state(p)).picked !== null && (await p.evaluate(() => document.activeElement === document.body)));
    await p.keyboard.press('n');
    const q3 = await state(p);
    ok('and it does', q3.picked === null && q3.item !== q2.item);
    await p.keyboard.press('Escape');
    ok('Escape goes home', (await state(p)).screen === 'home');
    ok('and the session\'s count was kept to what was answered', a1.session.n === 1 && q3.session.n === 2, JSON.stringify(q3.session));
  }

  /* ── show on the heart ─────────────────────────────────────────────── */
  head('show on the heart: drawn from the map, for every condition');
  {
    await p.click('[data-act="explore"]');
    const mismatches = await p.evaluate(() => {
      const HM = window.HeartMap, LI = window.LabItems, bad = [];
      const idOf = name => Object.keys(HM.CHAMBERS).find(k => HM.CHAMBERS[k].name === name);
      const ids = LI.ITEMS.sounds.concat(LI.ITEMS.tracings).map(i => i.id);
      for (const id of ids) {
        const sel = document.querySelector('#ex-pick'); sel.value = id; sel.dispatchEvent(new Event('change', { bubbles: true }));
        const it = LI.byId(id), svg = document.querySelector('svg.heart');
        const chambers = Array.from(svg.querySelectorAll('rect.ch'));
        const names = cls => chambers.filter(r => r.classList.contains(cls)).map(r => idOf(r.querySelector('title').textContent)).sort().join();
        const flows = svg.querySelectorAll('path.flow-a').length;
        const valves = Array.from(svg.querySelectorAll('g')).filter(g => g.querySelector('rect.valve.stenosis, rect.valve.regurgitation, rect.valve.prolapse'));
        const exp = it.kind === 'sounds' ? HM.forLesion(it.key) : (() => { const m = HM.TRACING_MAP[it.key]; return { valve: m.valve || null, state: m.state || null, enlarged: [], hypertrophied: m.hypertrophied || [], flows: m.valve && m.state ? [1] : [], site: m.site, pericardium: !!m.pericardium }; })();
        const tag = it.id + ': ';
        if (chambers.length !== 8) bad.push(tag + chambers.length + ' chambers');
        if (names('big') !== exp.enlarged.slice().sort().join()) bad.push(tag + 'enlarged ' + names('big') + ' vs ' + exp.enlarged);
        if (names('thick') !== exp.hypertrophied.slice().sort().join()) bad.push(tag + 'thick ' + names('thick') + ' vs ' + exp.hypertrophied);
        if (flows !== exp.flows.length) bad.push(tag + flows + ' abnormal flows vs ' + exp.flows.length);
        const wantValve = exp.valve && exp.state ? 1 : 0;
        if (valves.length !== wantValve) bad.push(tag + valves.length + ' faulty valves vs ' + wantValve);
        if (wantValve && !(valves[0] && valves[0].querySelector('title').textContent.includes(HM.VALVES[exp.valve].name) && valves[0].querySelector('rect.valve.' + exp.state))) bad.push(tag + 'wrong valve or fault');
        if (it.kind === 'sounds') {
          const on = document.querySelectorAll('svg.chest circle.area.on');
          if (on.length !== 1 || on[0].querySelector('title').textContent !== HM.AREAS[exp.area].name) bad.push(tag + 'listening area');
          if (!document.querySelector('.kv').innerText.includes({ systolic: 'systole', diastolic: 'diastole', continuous: 'the whole cycle', none: 'no murmur' }[exp.phase])) bad.push(tag + 'when it is heard');
        } else {
          const site = chambers.filter(r => r.classList.contains('site')).map(r => idOf(r.querySelector('title').textContent));
          if (site.join() !== exp.site) bad.push(tag + 'site ' + site + ' vs ' + exp.site);
          if (!!svg.querySelector('ellipse') !== exp.pericardium) bad.push(tag + 'pericardium');
        }
      }
      return { bad, n: ids.length };
    });
    ok('for all 24 conditions the enlarged and thickened chambers, the faulty valve and its kind, the abnormal flows, the place measured or listened at, and when it is heard are what the heart map says', mismatches.n === 24 && mismatches.bad.length === 0, mismatches.bad.slice(0, 4).join(' | ') || '24 conditions');
    await p.selectOption('#ex-pick', 'snd:ms');
    ok('and the picker keeps focus and the page says which condition it is showing', /Mitral stenosis/.test(await text(p, '#ex-title')) && (await p.evaluate(() => document.activeElement.id)) === 'ex-pick');
    const before = await p.evaluate(() => window.__audio.started);
    await p.click('[data-act="play"]');
    const e = await p.evaluate(energy, 3);   // the heart map plays three beats, the drill four
    ok('Play here plays that condition\'s own sound: a diastolic rumble for mitral stenosis', (await p.evaluate(() => window.__audio.started)) === before + 1 && e.dia > 2 * e.sys, `sys ${e.sys.toFixed(3)} dia ${e.dia.toFixed(3)}`);
    await p.selectOption('#ex-pick', 'trc:ra-constriction');
    ok('a tracing shows the pericardium and its waves labelled, where a sound would not', (await p.locator('svg.heart ellipse').count()) === 1 && (await p.evaluate(pixels)).accent > 20);
    ok('and switching away stops the sound', (await p.evaluate(() => window.__audio.stopped)) >= 1);
    await p.click('[data-act="home"]');
    await p.click('[data-kind="sounds"]');
    const st = await state(p);
    await p.click(`.option[data-id="${st.item}"]`);
    await p.click('[data-act="explore"]');
    ok('"Show on the heart" after an answer opens that very item', (await p.evaluate(() => document.querySelector('#ex-pick').value)) === st.item, st.item);
  }

  /* ── a phone, and the dark ─────────────────────────────────────────── */
  head('a phone, and the dark');
  {
    const ph = await open('phone', { viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
    /* Mobile emulation widens the viewport to fit what overflows it, so the viewport proves nothing:
       the right-hand edge of every element, against the 390 px the phone has, does. */
    const wide = async () => ph.evaluate(() => Math.max(...Array.from(document.querySelectorAll('#app *')).filter(e => !e.closest('.sr')).map(e => e.getBoundingClientRect().right)) - 390);
    const over = [];
    if (await wide() > 1) over.push('home');
    await ph.click('[data-kind="sounds"]'); if (await wide() > 1) over.push('sound question');
    await ph.locator('.option').first().tap(); if (await wide() > 1) over.push('sound answer');
    await ph.click('[data-act="home"]'); await ph.click('[data-kind="strips"]'); if (await wide() > 1) over.push('strip');
    await ph.click('[data-act="home"]'); await ph.click('[data-act="explore"]'); if (await wide() > 1) over.push('explore');
    ok('nothing scrolls sideways at 390 px: home, a question, an answer, a strip, the heart map', over.length === 0, over.join(', ') || '5 screens');
    const small = await ph.evaluate(() => Array.from(document.querySelectorAll('button, select')).filter(b => b.getBoundingClientRect().height < 40 && b.offsetParent).map(b => b.innerText || b.id));
    ok('every button and the picker is at least 40 px tall, for a thumb', small.length === 0, small.join(', ') || 'all');
    await ph.context().close();

    const dk = await open('dark', { colorScheme: 'dark' });
    const bg = await dk.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const lum = c => { const m = c.match(/\d+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
    const fg = await dk.evaluate(() => getComputedStyle(document.body).color);
    ok('in a dark colour scheme the page is dark with light text', lum(bg) < 0.15 && lum(fg) > 0.7, bg + ' / ' + fg);
    await dk.click('[data-kind="strips"]');
    const px = await dk.evaluate(() => { const c = document.querySelector('canvas.view'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let light = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] > 190 && d[i + 1] > 190 && d[i + 2] > 190) light++; return light; });
    ok('and the strip\'s trace is drawn light on it, not dark on dark', px > 300, px + ' light pixels');
    await dk.context().close();
  }

  /* ── storage refused ───────────────────────────────────────────────── */
  head('with storage refused the Lab opens, says so, and still works');
  {
    const b = await open('blocked', null, () => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } }); });
    ok('a banner says progress cannot be saved', /cannot be saved/.test(await text(b, '.banner')));
    await b.click('[data-kind="sounds"]');
    const st = await state(b);
    await b.click(`.option[data-id="${st.item}"]`);
    ok('questions are asked and answered all the same, and the page does not throw', /Correct\./.test(await text(b, '.verdict')) && st.saveFailed === true);
    await b.click('#next');
    ok('and goes on to the next', (await state(b)).picked === null);
    await b.context().close();
  }

  /* ── and throughout ────────────────────────────────────────────────── */
  ok('nothing left the device throughout', outside.length === 0, outside.join(', ') || 'none');
  ok('and nothing threw or logged an error on any page throughout', errors.length === 0, errors.join(' | '));
  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(die);
