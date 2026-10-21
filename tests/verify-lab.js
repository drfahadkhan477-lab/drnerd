#!/usr/bin/env node
/*
 * The Practice Lab, inside Systole, driven in a browser: heart sounds, pressure tracings, ECG strips and the heart map.
 *
 *   node tests/verify-lab.js build/synthetic/systole.html
 *
 * The Lab is a screen of Systole (src/lab/ui.js, app/css/practice.css), opened from its door on the home screen. It was
 * a separate app with its own build until it moved in; this suite drove that app, and now drives the screen. The pure
 * suites hold what the Lab knows (verify-lab-pure, verify-drills-pure); this holds that the screen is wired to it:
 *
 *   · IT IS PART OF SYSTOLE: its door on the home screen opens it, its modules are in Systole's page, its classes are
 *     its own and Systole's are not on it, its colours are the theme's, leaving it stops a heart sound, a redraw of it
 *     (the theme changed) keeps the question and the sound, and the quiz's keys and the Lab's never reach each other.
 *   · WHAT IS PLAYED IS THE ITEM THE ANSWER KEY NAMES. All twelve heart sounds are asked, the
 *     audio buffer handed to the browser is read back sample by sample, and where its energy
 *     sits (systole, diastole, both, neither) must be what the heart map says that lesion is.
 *     A page that played another lesion's sound would still draw and still score.
 *   · NOTHING NAMES THE ANSWER BEFORE IT IS GIVEN: not the description, not the S1/S2 marks,
 *     not the labelled waves; all of it appears after, and the canvas shows it by pixels.
 *   · THE PROGRESS IS REAL: stored, read back after a reload, tallied on the Lab's home, and
 *     gone after a reset. With storage refused the Lab opens, says so, and still works.
 *   · THE MAP IS DRAWN FROM THE MAP: for each of the 24 conditions the enlarged chambers, the
 *     thickened ones, the faulty valve and its kind, the abnormal flows and the place on the
 *     chest are what src/lab/heartmap.js says, read back off the DOM.
 *   · NOTHING LEAVES THE DEVICE, nothing throws, nothing scrolls sideways on a phone, and the
 *     screen reads in the dark.
 */
'use strict';
const path = require('path');
const { launch, engineName, isEngineNoise } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');
const { booted, quiet } = require('./_render.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-lab.js <build.html>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };
/* A CLAIM ABOUT WHAT IS HEARD NEEDS A BROWSER THAT PLAYS. Playwright's Windows
   WebKit (26.6) has no AudioContext at all: the Lab says so on screen and never
   makes a buffer, and the first wait for one timed out the suite (the owner's
   release check, and rc's Windows job). There those checks are counted not
   measurable; failing them would blame the Lab for the browser, and passing
   them would report sound nobody heard. Everything else in the same sections
   still runs. */
let hasAudio = true, unmeasured = 0;
const heard = (label, cond, detail = '') => {
  if (hasAudio) return ok(label, cond, detail);
  unmeasured++;
  console.log('  ----  ' + label + '  → not measurable here: this browser has no Web Audio');
};
const errors = [], events = [];
const die = onDeath(() => ({ section, checks: passed + failed, errors, events }));


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
  const c = document.querySelector('canvas.plab-view'), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data;
  let ink = 0, accent = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 200) continue;
    if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 100) ink++;
    else if (d[i + 2] > 180 && d[i] < 120 && d[i + 1] < 150) accent++;
  }
  return { ink, accent, w: c.width, h: c.height };
};

(async () => {
  const T = { timeout: 30000 };

  const browser = await launch();
  const outside = [];
  const open = async (tag, opts, init) => {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 900, height: 900 }, serviceWorkers: 'block' }, opts || {}));
    const p = watch(await ctx.newPage(), events, tag, errors);
    p.on('console', m => { if (m.type() === 'error' && !isEngineNoise(m.text())) errors.push(tag + ': console ' + m.text()); });
    p.on('request', r => { if (!/^(data|blob|file):/.test(r.url())) outside.push(tag + ' ' + r.url()); });
    p.on('dialog', d => d.accept());
    await p.addInitScript(spyOnAudio);
    if (init) await p.addInitScript(init);
    await p.goto(URL, { waitUntil: 'load', timeout: 200000 });
    await booted(p);
    p.__opened = await toLab(p);
    return p;
  };
  /* Into the Lab the way a fellow goes: the door on Systole's home screen. */
  const toLab = async p => {
    await p.evaluate(() => { if (S.screen !== 'home') goHome(); });
    await quiet(p);
    const opened = await p.locator('button.door', { hasText: 'Practice Lab' }).click({ timeout: 8000 })
      .then(() => p.locator('#plabRoot .plab-tiles').waitFor({ timeout: 8000 })).then(() => true, () => false);
    await quiet(p);
    return opened;
  };
  const state = p => p.evaluate(() => window.__lab.state());
  const text = (p, sel) => p.locator(sel).innerText();

  /* ── home ──────────────────────────────────────────────────────────── */
  const p = await open('main');
  head('it is part of Systole');
  {
    const st0 = await state(p);
    ok('the Practice Lab door on Systole\'s home screen opens it: Systole\'s practice screen, with the Lab drawn in it, on its home', p.__opened && (await p.evaluate(() => S.screen)) === 'practice' && st0.mounted && st0.screen === 'home' && /Practice Lab/.test(await p.evaluate(() => (document.querySelector('#plabRoot h1') || {}).textContent || '')), JSON.stringify(st0));
    ok('its modules are in Systole\'s page, beside the ones they read', await p.evaluate(() => ['HeartSounds', 'Tracings', 'Strips', 'HeartMap', 'Drill', 'LabProgress', 'LabItems', 'LabUI', 'Physio', 'RhythmsExtra', 'FSRS'].every(n => !!window[n]) && typeof buildPractice === 'function'));
    const cls = await p.evaluate(() => { const all = Array.from(document.querySelectorAll('#plabRoot [class]')).flatMap(el => Array.from(el.classList)); return { n: all.length, foreign: all.filter(c => !/^plab-/.test(c)) }; });
    ok('every class in it is its own, plab-: none of Systole\'s (.btn, .chip, .card) is on it', cls.n >= 20 && cls.foreign.length === 0, cls.foreign.slice(0, 6).join(', ') || cls.n + ' classes, all plab-');
    const looks = [];
    for (const th of ['daylight', 'midnight', 'cathlab']) {
      await p.evaluate(t => setTheme(t), th); await quiet(p);
      looks.push(await p.evaluate(th => { const pr = document.createElement('div'); pr.style.background = 'var(--card)'; document.body.appendChild(pr); const want = getComputedStyle(pr).backgroundColor; pr.remove();
        return { th, card: getComputedStyle(document.querySelector('#plabRoot .plab-card')).backgroundColor, want }; }, th));
    }
    await p.evaluate(() => setTheme('auto')); await quiet(p);
    ok('its cards are the theme\'s cards, in a light theme and two dark ones', looks.every(l => l.card === l.want) && new Set(looks.map(l => l.card)).size === 3, JSON.stringify(looks));
  }

  head('home: three drills and the heart map, each with its true count');
  {
    const counts = await p.evaluate(() => ({ items: Object.fromEntries(Object.entries(window.LabItems.ITEMS).map(([k, v]) => [k, v.length])), tiles: Array.from(document.querySelectorAll('.plab-tile')).map(t => t.innerText) }));
    ok('there are three drill tiles and the heart map', counts.tiles.length === 4, counts.tiles.map(t => t.split('\n')[0]).join(' | '));
    ok('each drill tile says how many items it has, and the number is the number there are', ['sounds', 'tracings', 'strips'].every((k, i) => counts.tiles[i].includes('0 of ' + counts.items[k] + ' seen')) && counts.items.sounds === 12 && counts.items.strips === 15, JSON.stringify(counts.items));
    ok('and the heart map tile counts its conditions', /24 conditions/.test(counts.tiles[3]));
    ok('a new user has no streak, nothing answered, nothing due', /0\s*day streak/.test(await text(p, '.plab-stats')) && /–\s*right, all time/.test(await text(p, '.plab-stats')));
    ok('the page says plainly that the teaching points are the app\'s own and unreviewed', /not been reviewed by a clinician/.test(await text(p, '.plab-foot')));
  }

  /* ── heart sounds: what is played is what is asked ─────────────────── */
  head('heart sounds: what is played is the item the answer key names');
  {
    hasAudio = await p.evaluate(() => !!(window.AudioContext || window.webkitAudioContext));
    await p.click('[data-kind="sounds"]');
    const asked = [], wrong = [];
    for (let i = 0; i < 12; i++) {
      const st = await state(p);
      const names = await p.locator('.plab-option span:last-child').allInnerTexts();
      const before = await p.evaluate(pixels);
      const body = await p.evaluate(() => document.querySelector('#plabRoot').innerHTML);   // the screen, not the scripts the page carries
      const info = await p.evaluate(k => { const it = window.LabItems.byId(k); return { key: it.key, name: it.name, blurb: it.blurb, phase: window.HeartMap.phaseOf(it.key) }; }, st.item);
      await p.click('[data-act="play"]');
      if (hasAudio) await p.waitForFunction(n => window.__audio.buffers.length > n, i, T);
      const e = hasAudio ? await p.evaluate(energy, 4) : { sys: 0, dia: 0, rate: 0, len: 0, peak: 0 };
      const loud = 0.02;
      const fits = !hasAudio ? true : info.phase === 'systolic' ? e.sys >= loud && e.sys >= 2 * e.dia
        : info.phase === 'diastolic' ? e.dia >= loud && e.dia >= 2 * e.sys
        : info.phase === 'continuous' ? e.sys >= loud && e.dia >= loud
        : e.sys < loud;
      asked.push({ st, info, e, fits, names, leaked: body.includes(info.blurb), pre: before.accent });
      if (!fits) wrong.push(info.key + ' ' + info.phase + ' sys ' + e.sys.toFixed(3) + ' dia ' + e.dia.toFixed(3));
      await p.click(`.plab-option[data-id="${st.item}"]`);
      if (i < 11) await p.click('#plab-next');
    }
    ok('twelve questions were twelve different heart sounds, as new ones come first', new Set(asked.map(a => a.st.item)).size === 12, asked.map(a => a.info.key).join(' '));
    heard('the audio handed to the browser is the lesion asked about: loud in systole, or diastole, or both, or in neither, as the heart map says, for all twelve', wrong.length === 0, wrong.join(' | ') || asked.map(a => a.info.key + ':' + a.info.phase).join(' '));
    heard('it is 8 kHz mono, a few seconds long, and well above silence', asked.every(a => a.e.rate === 8000 && a.e.len > 8000 * 2 && a.e.len < 8000 * 6 && a.e.peak > 0.5), asked[0].e.len + ' samples');
    ok('each question offers four different answers, one of them the answer key\'s', asked.every(a => a.names.length === 4 && new Set(a.names).size === 4 && a.names.includes(a.info.name)));
    ok('and nothing names the answer before it is given: its description is not in the page', asked.every(a => !a.leaked));
    ok('nor are its S1 and S2 marks on the waveform, which appear only afterwards', asked.every(a => a.pre === 0));
    const log = await p.evaluate(() => ({ loops: window.__audio.loops, started: window.__audio.started }));
    heard('Play loops, so a murmur can be listened to for as long as it takes', log.started === 12 && log.loops.every(l => l === true), JSON.stringify(log));
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
    heard('Play starts it, and the button says Stop and is pressed', (await p.evaluate(() => window.__audio.started)) === before + 1 && (await btn.getAttribute('aria-pressed')) === 'true' && /Stop/.test(await btn.innerText()));
    const cur = await p.evaluate(() => new Promise(r => setTimeout(() => r(document.querySelector('.plab-cursor').className + '|' + document.querySelector('.plab-cursor').style.left), 250)));
    heard('and a cursor follows it across the waveform', /plab-on/.test(cur) && /%/.test(cur), cur);
    const stoppedBefore = await p.evaluate(() => window.__audio.stopped);
    await btn.click();
    heard('Stop stops it', (await p.evaluate(() => window.__audio.stopped)) === stoppedBefore + 1 && (await btn.getAttribute('aria-pressed')) === 'false');
    await btn.click();
    const st = await state(p);
    const right = st.options.find(id => id === st.item);
    await p.click(`.plab-option[data-id="${right}"]`);
    const after = await p.evaluate(pixels);
    ok('answering draws the S1 and S2 marks on the waveform, in the accent colour', after.accent > 40, after.accent + ' accent pixels');
    ok('and the waveform itself is on the canvas throughout', after.ink > 200, after.ink + ' ink pixels');
    heard('a sound that was playing keeps playing while the answer is shown', (await btn.getAttribute('aria-pressed')) === 'true');
    await p.click('#plab-next');
    heard('and the next question starts silent', (await p.locator('[data-act="play"]').getAttribute('aria-pressed')) === 'false');
  }

  /* ── Systole around it ─────────────────────────────────────────────── */
  head('Systole around it: a redraw keeps the Lab, leaving stops it, and each screen keeps its own keys');
  {
    await p.click('[data-act="home"]');
    await p.click('[data-kind="sounds"]');
    const q = await state(p);
    await p.click('[data-act="play"]');
    const stopped0 = await p.evaluate(() => window.__audio.stopped);
    await p.evaluate(() => setTheme('midnight')); await quiet(p);
    const r = await state(p);
    ok('a redraw of the screen (the theme changed) keeps the Lab where it was: the same question, still unanswered', r.mounted && r.screen === 'drill' && r.item === q.item && r.picked === null && (await p.locator('#plabRoot .plab-option').count()) === 4, JSON.stringify([q.item, r.item, r.screen]));
    heard('and the heart sound it was playing goes on', (await p.evaluate(() => window.__audio.stopped)) === stopped0 && (await p.locator('[data-act="play"]').getAttribute('aria-pressed')) === 'true');
    await p.evaluate(() => setTheme('auto')); await quiet(p);
    await p.evaluate(() => goHome()); await quiet(p);
    const gone = await state(p);
    ok('leaving for another screen lets the Lab go', !gone.mounted && (await p.evaluate(() => S.screen)) === 'home', JSON.stringify(gone));
    heard('and stops the heart sound', (await p.evaluate(() => window.__audio.stopped)) > stopped0);
    /* A quiz, then the Lab with a fresh quiz left open behind it: a key meant for one screen must not answer the other. */
    const startQuiz1 = async () => { await p.evaluate(() => { goHome(); startAdhocQuiz([POOL.find(x => !x.bad)], null); }); await p.waitForFunction(() => S.screen === 'quiz' && !!document.querySelector('.opt') && !S.answered, null, T).catch(() => {}); await quiet(p); };
    await toLab(p); await p.click('[data-kind="tracings"]');
    const n0 = (await state(p)).session.n;
    await startQuiz1();
    await p.keyboard.press('2');
    const quiz2 = await p.evaluate(() => S.answered);
    await p.keyboard.press('a');
    const quizA = await p.evaluate(() => S.answered);
    ok('on a quiz a Lab key (2) answers nothing, while the quiz\'s own (a) still answers it', quiz2 === false && quizA === true && (await state(p)).session.n === n0, JSON.stringify([quiz2, quizA]));
    await startQuiz1();
    await toLab(p); await p.click('[data-kind="tracings"]');
    await p.keyboard.press('a');
    const behind = await p.evaluate(() => ({ answered: S.answered, held: S.questions.length }));
    ok('and on the Lab a quiz key (a) answers nothing: not the drill, and not the quiz left open behind it', (await state(p)).picked === null && behind.held === 1 && behind.answered === false && (await p.evaluate(() => S.screen)) === 'practice', JSON.stringify(behind));
    await toLab(p);
    await p.click('[data-kind="sounds"]');   // the sections below start from inside a drill
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
    await p.click(`.plab-option[data-id="${wrongId}"]`);
    const a = await p.evaluate(pixels);
    ok('a wrong answer labels the waves and says what it was', a.accent > 20 && /Not quite\./.test(await text(p, '.plab-verdict')), `${a.accent} accent pixels`);
    ok('the right option is marked right and the chosen one wrong, and none can be pressed again', (await p.locator('.plab-option.plab-right').count()) === 1 && (await p.locator('.plab-option.plab-wrong').count()) === 1 && (await p.locator('.plab-option:not([disabled])').count()) === 0);
    ok('and it says what the wrong choice was, so the difference can be learnt', /You chose/.test(await text(p, '#plab-feedback')));
    const prog = await p.evaluate(() => window.__lab.progress());
    const key = st.item;
    const rightCard = await p.evaluate(() => window.Drill.grade({ card: null, correct: true, today: window.FSRS.todayISO() }));
    ok('the miss is stored as a card with a lapse, due sooner than a right first answer would have made it', prog.cards[key] && prog.cards[key].lapses === 1 && prog.cards[key].due < rightCard.due, JSON.stringify([prog.cards[key] && prog.cards[key].due, rightCard.due]));
    const sameAgain = await p.evaluate(k => { const it = window.LabItems.byId(k); return Array.from(document.querySelectorAll('.plab-chip')).map(c => c.innerText).filter(t => it.confusableWith.map(id => window.LabItems.byId(id).name).includes(t)).length; }, key);
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
      await p.click(`.plab-option[data-id="${st.item}"]`);
      const said = await text(p, '#plab-feedback');
      const rate = +(/about (\d+) a minute/.exec(said) || [0, 0])[1];
      const ref = await p.evaluate(k => ({ hr: window.RhythmsExtra.EXTRA[k.slice(4)].hr }), st.item);
      seen.push({ id: st.item, ink: q.ink, rate, hr: ref.hr });
      if (i < 14) await p.click('#plab-next');
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
    const tiles = await p.locator('.plab-tile').allInnerTexts();
    ok('the home tiles count what was seen: all twelve sounds and fifteen strips', /12 of 12 seen/.test(tiles[0]) && /15 of 15 seen/.test(tiles[2]), tiles.map(t => t.split('\n').pop()).join(' | '));
    ok('and the stats say a streak of one day', /1\s*day streak/.test(await text(p, '.plab-stats')));
    const before = await p.evaluate(() => JSON.stringify(window.__lab.progress()));
    await p.reload(); await booted(p); await toLab(p);
    ok('after a reload the record is the same one', (await p.evaluate(() => JSON.stringify(window.__lab.progress()))) === before);
    ok('and the home screen shows it', /12 of 12 seen/.test((await p.locator('.plab-tile').allInnerTexts())[0]));
    await p.click('[data-act="reset"]');
    const after = await p.evaluate(() => window.__lab.progress());
    ok('Reset forgets it: no cards, no days', Object.keys(after.cards).length === 0 && Object.keys(after.days).length === 0 && /0 of 12 seen/.test((await p.locator('.plab-tile').allInnerTexts())[0]));
    await p.reload(); await booted(p); await toLab(p);
    ok('and stays forgotten after a reload', /0 of 12 seen/.test((await p.locator('.plab-tile').allInnerTexts())[0]));
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
        const sel = document.querySelector('#plab-pick'); sel.value = id; sel.dispatchEvent(new Event('change', { bubbles: true }));
        const it = LI.byId(id), svg = document.querySelector('svg.plab-heart');
        const chambers = Array.from(svg.querySelectorAll('rect.plab-ch'));
        const names = cls => chambers.filter(r => r.classList.contains('plab-' + cls)).map(r => idOf(r.querySelector('title').textContent)).sort().join();
        const flows = svg.querySelectorAll('path.plab-flow-a').length;
        const valves = Array.from(svg.querySelectorAll('g')).filter(g => g.querySelector('rect.plab-valve.plab-stenosis, rect.plab-valve.plab-regurgitation, rect.plab-valve.plab-prolapse'));
        const exp = it.kind === 'sounds' ? HM.forLesion(it.key) : (() => { const m = HM.TRACING_MAP[it.key]; return { valve: m.valve || null, state: m.state || null, enlarged: [], hypertrophied: m.hypertrophied || [], flows: m.valve && m.state ? [1] : [], site: m.site, pericardium: !!m.pericardium }; })();
        const tag = it.id + ': ';
        if (chambers.length !== 8) bad.push(tag + chambers.length + ' chambers');
        if (names('big') !== exp.enlarged.slice().sort().join()) bad.push(tag + 'enlarged ' + names('big') + ' vs ' + exp.enlarged);
        if (names('thick') !== exp.hypertrophied.slice().sort().join()) bad.push(tag + 'thick ' + names('thick') + ' vs ' + exp.hypertrophied);
        if (flows !== exp.flows.length) bad.push(tag + flows + ' abnormal flows vs ' + exp.flows.length);
        const wantValve = exp.valve && exp.state ? 1 : 0;
        if (valves.length !== wantValve) bad.push(tag + valves.length + ' faulty valves vs ' + wantValve);
        if (wantValve && !(valves[0] && valves[0].querySelector('title').textContent.includes(HM.VALVES[exp.valve].name) && valves[0].querySelector('rect.plab-valve.plab-' + exp.state))) bad.push(tag + 'wrong valve or fault');
        if (it.kind === 'sounds') {
          const on = document.querySelectorAll('svg.plab-chest circle.plab-area.plab-on');
          if (on.length !== 1 || on[0].querySelector('title').textContent !== HM.AREAS[exp.area].name) bad.push(tag + 'listening area');
          if (!document.querySelector('.plab-kv').innerText.includes({ systolic: 'systole', diastolic: 'diastole', continuous: 'the whole cycle', none: 'no murmur' }[exp.phase])) bad.push(tag + 'when it is heard');
        } else {
          const site = chambers.filter(r => r.classList.contains('plab-site')).map(r => idOf(r.querySelector('title').textContent));
          if (site.join() !== exp.site) bad.push(tag + 'site ' + site + ' vs ' + exp.site);
          if (!!svg.querySelector('ellipse') !== exp.pericardium) bad.push(tag + 'pericardium');
        }
      }
      return { bad, n: ids.length };
    });
    ok('for all 24 conditions the enlarged and thickened chambers, the faulty valve and its kind, the abnormal flows, the place measured or listened at, and when it is heard are what the heart map says', mismatches.n === 24 && mismatches.bad.length === 0, mismatches.bad.slice(0, 4).join(' | ') || '24 conditions');
    await p.selectOption('#plab-pick', 'snd:ms');
    ok('and the picker keeps focus and the page says which condition it is showing', /Mitral stenosis/.test(await text(p, '#plab-ex-title')) && (await p.evaluate(() => document.activeElement.id)) === 'plab-pick');
    const before = await p.evaluate(() => window.__audio.started);
    await p.click('[data-act="play"]');
    const e = hasAudio ? await p.evaluate(energy, 3) : { sys: 0, dia: 0 };   // the heart map plays three beats, the drill four
    heard('Play here plays that condition\'s own sound: a diastolic rumble for mitral stenosis', (await p.evaluate(() => window.__audio.started)) === before + 1 && e.dia > 2 * e.sys, `sys ${e.sys.toFixed(3)} dia ${e.dia.toFixed(3)}`);
    await p.selectOption('#plab-pick', 'trc:ra-constriction');
    ok('a tracing shows the pericardium and its waves labelled, where a sound would not', (await p.locator('svg.plab-heart ellipse').count()) === 1 && (await p.evaluate(pixels)).accent > 20);
    heard('and switching away stops the sound', (await p.evaluate(() => window.__audio.stopped)) >= 1);
    await p.click('[data-act="home"]');
    await p.click('[data-kind="sounds"]');
    const st = await state(p);
    await p.click(`.plab-option[data-id="${st.item}"]`);
    await p.click('[data-act="explore"]');
    ok('"Show on the heart" after an answer opens that very item', (await p.evaluate(() => document.querySelector('#plab-pick').value)) === st.item, st.item);
  }

  /* ── a phone, and the dark ─────────────────────────────────────────── */
  head('a phone, and the dark');
  {
    /* Firefox supports the viewport and touch but Playwright cannot emulate
       its mobile browser. Keep the same geometry and tap assertions there. */
    const ph = await open('phone', { viewport: { width: 390, height: 800 }, isMobile: engineName() !== 'firefox', hasTouch: true });
    /* Mobile emulation widens the viewport to fit what overflows it, so the viewport proves nothing:
       the right-hand edge of every element, against the 390 px the phone has, does. */
    const wide = async () => ph.evaluate(() => Math.max(...Array.from(document.querySelectorAll('#plabRoot *')).filter(e => !e.closest('.plab-sr')).map(e => e.getBoundingClientRect().right)) - 390);
    const over = [];
    if (await wide() > 1) over.push('home');
    await ph.click('[data-kind="sounds"]'); if (await wide() > 1) over.push('sound question');
    await ph.locator('.plab-option').first().tap(); if (await wide() > 1) over.push('sound answer');
    await ph.click('[data-act="home"]'); await ph.click('[data-kind="strips"]'); if (await wide() > 1) over.push('strip');
    await ph.click('[data-act="home"]'); await ph.click('[data-act="explore"]'); if (await wide() > 1) over.push('explore');
    ok('nothing scrolls sideways at 390 px: home, a question, an answer, a strip, the heart map', ph.__opened && over.length === 0, over.join(', ') || '5 screens');
    const small = await ph.evaluate(() => { const all = Array.from(document.querySelectorAll('#plabRoot button, #plabRoot select')).filter(b => b.offsetParent); return { n: all.length, small: all.filter(b => b.getBoundingClientRect().height < 40).map(b => b.innerText || b.id) }; });
    ok('every button and the picker is at least 40 px tall, for a thumb', small.n >= 3 && small.small.length === 0, small.small.join(', ') || small.n + ' controls');
    await ph.context().close();

    const dk = await open('dark', { colorScheme: 'dark' });
    const bg = await dk.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const lum = c => { const m = c.match(/\d+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
    const fg = await dk.evaluate(() => getComputedStyle(document.body).color);
    ok('in a dark colour scheme the page is dark with light text', lum(bg) < 0.15 && lum(fg) > 0.7, bg + ' / ' + fg);
    await dk.click('[data-kind="strips"]');
    const px = await dk.evaluate(() => { const c = document.querySelector('canvas.plab-view'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let light = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] > 190 && d[i + 1] > 190 && d[i + 2] > 190) light++; return light; });
    ok('and the strip\'s trace is drawn light on it, not dark on dark', px > 300, px + ' light pixels');
    await dk.context().close();
  }

  /* ── storage refused ───────────────────────────────────────────────── */
  head('with storage refused the Lab opens, says so, and still works');
  {
    const b = await open('blocked', null, () => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } }); });
    ok('a banner says progress cannot be saved', /cannot be saved/.test(await text(b, '.plab-banner')));
    await b.click('[data-kind="sounds"]');
    const st = await state(b);
    await b.click(`.plab-option[data-id="${st.item}"]`);
    ok('questions are asked and answered all the same, and the page does not throw', /Correct\./.test(await text(b, '.plab-verdict')) && st.saveFailed === true);
    await b.click('#plab-next');
    ok('and goes on to the next', (await state(b)).picked === null);
    await b.context().close();
  }

  /* ── and throughout ────────────────────────────────────────────────── */
  ok('nothing left the device throughout', outside.length === 0, outside.join(', ') || 'none');
  ok('and nothing threw or logged an error on any page throughout', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed` + (unmeasured ? `, ${unmeasured} not measurable on ${engineName()}` : ''));
  process.exit(failed ? 1 : 0);
})().catch(die);
