#!/usr/bin/env node
/*
 * Memorizer, when things go wrong: a second tap, a full disk, a browser
 * that will not store anything, a reply that arrives after the reader has
 * moved on, and a keyboard user opening a figure.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-memorizer-hardening.js
 *
 * Takes no build argument: it builds memorizer/ itself, into a temporary
 * directory, as verify-memorizer does. Pasted notes only — no PDF, so no
 * pdf.js and NO NETWORK: every request the page makes is either to the
 * stubbed model or is itself a failure this suite reports.
 *
 * Each block is a defect that was real in the code before it, and each was
 * seen to fail against that code (see the commit that added this suite):
 *
 *   · A DOUBLE TAP LANDS ONCE. "I knew it" tapped twice skipped a memorise
 *     card; Next tapped twice filed an answer with no choice and threw; a
 *     review rated twice counted twice.
 *   · A STEP NOT STORED IS SAID, AND THE SESSION AND ITS CARDS AGREE. The
 *     session and the cards it made were two writes: a failure between them
 *     stored a session with a miss in it and no card for the miss, and the
 *     rejection stopped the screen from redrawing, with nothing said. Here
 *     the cards store refuses one write (a quota error): the session must
 *     not have moved either, a banner must say so, and "Try saving again"
 *     must store both. A review whose write fails is not counted.
 *   · STORAGE REFUSED IS SAID ON EVERY SCREEN, not only on Home.
 *   · A LATE REPLY IS DROPPED. Section 1's lesson, still on its way from the
 *     model when the reader went back and opened section 2, was filed as
 *     section 2's lesson.
 *   · A DIALOG HOLDS FOCUS: into it on open, kept inside by Tab and
 *     Shift+Tab, the page behind it inert, and back to its button on close.
 *   · THE SAME NOTES ADDED TWICE open the unit already there.
 *   · NOTHING IS FETCHED TO DRAW THE PAGE (the Google Fonts request is gone),
 *     and Continue on Home goes straight back in.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
/* Node's URL class, under its own name: `URL` below is the page's address. */
const { URL: WebURL } = require('url');
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
const { build } = require(path.join(ROOT, 'scripts', 'build-memorizer.js'));

const body = t => Array.from({ length: 12 }, (_, i) => `${t} note ${i} says that ${t.toLowerCase()} changes the work of the heart by ${i + 2} percent.`).join('\n');
const NOTES = `Preload\n\n${body('Preload')}\n\nAfterload\n\n${body('Afterload')}`;

/* A lesson the model might send, told apart by its big idea. */
const lesson = overview => ({
  overview,
  points: [{ text: 'Preload is the end-diastolic stretch', page: 1 }, { text: 'Afterload is the load in ejection', page: 1 }],
  numbers: [], mnemonics: [], analogies: [], flowchart: '' });
const kindOf = user => /TASK:\nTEACH /.test(user) ? 'lesson' : /TASK:\nDRILL\./.test(user) ? 'quiz' : /TASK:\nFINAL EXAM\./.test(user) ? 'exam' : 'unknown';

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memorizer-hard-'));
  build(dir);
  const URL = 'file://' + path.join(dir, 'index.html');
  const T = { timeout: 60000 };
  const browser = await launch();
  const outside = [];
  const context = async (tag, init) => {
    /* Each case has its own storage. Finished animated pages must not keep
       consuming WebKit processes and memory throughout the remaining cases. */
    for (const previous of browser.contexts()) await previous.close();
    const ctx = await browser.newContext({ viewport: { width: 820, height: 1100 }, serviceWorkers: 'block' });
    const p = watch(await ctx.newPage(), events, tag, errors);
    /* The model's host is compared whole, after parsing: a pattern matched
       anywhere in the URL would excuse https://elsewhere/?api.anthropic.com
       (CodeQL, on this PR). */
    const model = u => { try { const x = new WebURL(u); return x.protocol === 'https:' && x.hostname === 'api.anthropic.com'; } catch (_) { return false; } };
    p.on('request', r => { if (!/^(file|data|blob):/.test(r.url()) && !model(r.url())) outside.push(tag + ' ' + r.url()); });
    if (init) await p.addInitScript(init);
    return p;
  };
  const paste = async (p, name) => {
    /* the box to add material is on the Chapters page */
    await p.locator('nav.dock').getByRole('button', { name: 'Chapters' }).click();
    await p.locator('#chip-paste').click();
    await p.fill('#paste-name', name);
    await p.fill('#paste-text', NOTES);
    await p.locator('#paste-go').click();
  };
  const settled = p => p.waitForFunction(() => !Memorizer.ui.moving && !Memorizer.ui.rating, null, T);
  const stored = p => p.evaluate(() => Promise.all([MemStore.get('sessions', Memorizer.ui.docId), MemStore.all('cards')])
    .then(([s, c]) => ({ answers: s ? s.state.per[s.state.section].answers.length : -1, pos: s && s.state.per[0].memo ? s.state.per[0].memo.pos : -1, cards: c.length })));
  /* Double click in one task: both land on the same button before anything
     can redraw it, which is what a quick second tap on a phone does. */
  const doubleTap = (p, sel) => p.evaluate(s => { const b = document.querySelector(s); b.click(); b.click(); }, sel);

  /* ── the built-in coach: nothing sent anywhere ─────────────────────────── */
  const p = await context('builtin');
  await p.goto(URL);
  await p.locator('#door-add').waitFor(T);

  head('nothing is fetched to draw the page');
  ok('no request leaves the device on launch — the handwriting face is the device’s own', outside.length === 0, outside.join(', ') || 'none');

  head('a double tap lands once');
  await paste(p, 'My notes');
  await p.locator('#learn-unit').waitFor(T);
  await p.locator('#learn-unit').click();
  await p.locator('#to-drill').waitFor(T);
  await p.locator('#to-drill').click();
  await p.locator('#recall').waitFor(T);
  const nCards = await p.evaluate(() => Memorizer.ui.state.per[0].memo.order.length);
  ok('(there are enough memorise cards for a skip to show)', nCards >= 3, String(nCards));
  await p.locator('#recall-show').click();
  await p.locator('#recall-knew').waitFor(T);
  await doubleTap(p, '#recall-knew');
  await settled(p);
  ok('"I knew it" tapped twice moves on by one card, not two', await p.evaluate(() => Memorizer.ui.state.per[0].memo.pos) === 1 && (await stored(p)).pos === 1,
     JSON.stringify({ pos: await p.evaluate(() => Memorizer.ui.state.per[0].memo.pos), stored: (await stored(p)).pos }));
  ok('and the screen shows card 2', /^Card 2 of/.test(await p.locator('#recall .mcq-meta').innerText()), await p.locator('#recall .mcq-meta').innerText());
  while (await p.evaluate(() => Memorizer.ui.state.phase === 'memorize')) {
    const at = await p.evaluate(() => Memorizer.ui.state.per[0].memo.pos);
    await p.locator('#recall-show').click();
    await p.locator('#recall-knew').click();
    await p.waitForFunction(k => Memorizer.ui.state.phase !== 'memorize' || Memorizer.ui.state.per[0].memo.pos === k + 1, at, T);
    await settled(p);
  }
  await p.locator('#mcq').waitFor(T);
  const right = await p.evaluate(() => { const c = Memorizer.ui.state.per[0]; return c.quiz.questions[c.order[c.pos]].answer; });
  const errsBefore = errors.length;
  await p.locator(`.option[data-i="${right}"]`).click();
  await doubleTap(p, '#next');
  await settled(p);
  ok('Next tapped twice files one answer', await p.evaluate(() => Memorizer.ui.state.per[0].answers.length) === 1 && (await stored(p)).answers === 1,
     JSON.stringify(await stored(p)));
  ok('and nothing throws on the page', errors.length === errsBefore, errors.slice(errsBefore).join(' | '));

  head('a step that is not stored says so, and the session and its cards agree');
  ok('(the drill has a second question to miss)', await p.locator('#mcq').count() === 1 && await p.evaluate(() => Memorizer.ui.state.phase === 'drill'));
  const before = await stored(p);
  const wrong = await p.evaluate(() => { const c = Memorizer.ui.state.per[0], q = c.quiz.questions[c.order[c.pos]]; return (q.answer + 1) % q.options.length; });
  /* The cards store refuses its next write, as a full disk would. */
  await p.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    window.__realPut = put; window.__refuse = 1;
    IDBObjectStore.prototype.put = function () {
      if (this.name === 'cards' && window.__refuse > 0) { window.__refuse--; throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); }
      return put.apply(this, arguments);
    };
  });
  await p.locator(`.option[data-i="${wrong}"]`).click();
  await p.locator('#next').click();
  await settled(p);
  const failedSave = await stored(p);
  ok('(the refusal happened)', await p.evaluate(() => window.__refuse) === 0);
  ok('the session did not move without its card: neither was stored', failedSave.answers === before.answers && failedSave.cards === before.cards,
     JSON.stringify({ before, after: failedSave }));
  const banner = await p.locator('#store-banner').count() ? await p.locator('#store-banner').innerText() : '';
  ok('a banner says the step was not saved, and why', /not saved/.test(banner) && /out of space/.test(banner), banner.replace(/\s+/g, ' ').slice(0, 120));
  ok('the step stays on screen: the answer was taken', await p.evaluate(() => Memorizer.ui.state.per[0].answers.length) === before.answers + 1);
  await p.evaluate(() => { IDBObjectStore.prototype.put = window.__realPut; });
  if (await p.locator('#store-retry').count()) {
    await p.locator('#store-retry').click();
    await p.locator('#store-banner').waitFor({ state: 'detached', timeout: 60000 });
  }
  const retried = await stored(p);
  ok('"Try saving again" stores the session and its card together', retried.answers === before.answers + 1 && retried.cards === before.cards + 1,
     JSON.stringify(retried));

  head('a save that never finishes does not freeze the app');
  /* go() ignores taps until the step's save settles. A save that never
     settles (an IndexedDB transaction or open that hangs) must not leave the
     app ignoring every tap with nothing on screen: here the save is held,
     not refused, until the test lets it go. */
  ok('(the drill has another question to answer)', await p.locator('#mcq .option').count() > 0 && await p.evaluate(() => Memorizer.ui.state.phase === 'drill'));
  const held = await p.evaluate(() => Memorizer.ui.state.per[0].answers.length);
  /* every held save is kept, in order, and released in order */
  await p.evaluate(() => {
    window.__realSaveStep = MemStore.saveStep; window.__held = 0; window.__releases = [];
    MemStore.saveStep = function (st, cs) { window.__held++; return new Promise(res => { window.__releases.push(() => window.__realSaveStep.call(MemStore, st, cs).then(res)); }); };
    window.__releaseSaves = () => window.__releases.splice(0).reduce((q, f) => q.then(f), Promise.resolve());
  });
  await p.locator('#mcq .option').first().click();
  await settled(p);
  await p.evaluate(() => { document.querySelector('#mcq').__old = true; });
  await p.locator('#next').click();
  /* a precondition, not the claim: the slow-save bound has had its chance */
  await p.waitForFunction(() => Memorizer.ui.slowSaves > 0, null, { timeout: 20000 }).catch(() => {});
  const during = await p.evaluate(() => { const m = document.querySelector('#mcq'), n = document.getElementById('store-saving');
    return { held: window.__held, moving: Memorizer.ui.moving, slow: Memorizer.ui.slowSaves, answers: Memorizer.ui.state.per[0].answers.length,
             redrawn: !m || !m.__old, note: n ? n.textContent : '' }; });
  ok('(the save was really held)', during.held === 1, JSON.stringify(during));
  ok('the step is drawn, though its save has not finished', !during.moving && during.redrawn && during.answers === held + 1, JSON.stringify(during));
  ok('and a note says the save is still going', during.slow === 1 && /Still saving your last step/.test(during.note), during.note || '(no note)');
  /* The next step, with the first save still held: its own save queues
     behind the first (IndexedDB runs them in order), so waiting out the
     bound again would freeze every step for SAVE_WAIT_MS. It is drawn at
     once. The redraw is the precondition; the time it took is the check. */
  ok('(the drill has a next question while the save is held)', await p.locator('#mcq .option').count() > 0 && await p.evaluate(() => Memorizer.ui.state.phase === 'drill'));
  await p.locator('#mcq .option').first().click();
  await p.evaluate(() => { document.querySelector('#mcq').__old = true; window.__tapAt = performance.now(); });
  await p.locator('#next').click();
  await p.waitForFunction(() => { const m = document.querySelector('#mcq'); return !Memorizer.ui.moving && (!m || !m.__old); }, null, T);
  const second = await p.evaluate(() => ({ ms: Math.round(performance.now() - window.__tapAt), held: window.__held, slow: Memorizer.ui.slowSaves, answers: Memorizer.ui.state.per[0].answers.length }));
  ok('a tap works again, and the next step is drawn at once: it does not wait out the bound a second time',
     second.held === 2 && second.answers === held + 2 && second.slow === 2 && second.ms < 2000, JSON.stringify(second));
  await p.evaluate(() => { MemStore.saveStep = window.__realSaveStep; return window.__releaseSaves(); });
  await p.waitForFunction(() => Memorizer.ui.slowSaves === 0, null, T).catch(() => {});
  await settled(p);
  const heldStored = await stored(p), gone = await p.locator('#store-saving').count() === 0;
  ok('when they finish the note goes, and both steps are stored', gone && heldStored.answers === held + 2, JSON.stringify({ gone, stored: heldStored }));

  head('a review is counted only once, and only when stored');
  await p.locator('nav.dock').getByRole('button', { name: /Review/ }).click();
  await p.locator('#mcq').waitFor(T);
  const card0 = await p.evaluate(() => MemStore.all('cards').then(c => c[0]));
  await p.evaluate(() => { const put = window.__realPut; window.__refuse = 1;
    IDBObjectStore.prototype.put = function () {
      if (this.name === 'cards' && window.__refuse > 0) { window.__refuse--; throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); }
      return put.apply(this, arguments);
    }; });
  await p.locator(`.option[data-i="${card0.answer}"]`).click();
  await p.locator('#next').click();
  await settled(p);
  const card1 = await p.evaluate(id => MemStore.get('cards', id), card0.id);
  ok('a rating whose write fails leaves the card as it was, still due, and says so',
     JSON.stringify(card1.srs || null) === JSON.stringify(card0.srs || null) && await p.evaluate(() => Memorizer.ui.reviewDone) === 0 &&
     await p.locator('#mcq').count() === 1 && /not saved/.test(await p.locator('#store-banner').innerText()));
  await p.evaluate(() => { IDBObjectStore.prototype.put = window.__realPut; });
  /* The rating's write held, not refused: Review waited on it before
     moving on, and a write that never settled left every later rating
     ignored. Past the bound it moves on, the card rated in memory so it is
     not asked again, and it is counted only when the write lands. */
  await p.evaluate(() => { window.__realStorePut = MemStore.put; window.__putHeld = 0; window.__putReleases = [];
    MemStore.put = function (store) { if (store !== 'cards') return window.__realStorePut.apply(MemStore, arguments);
      window.__putHeld++; const a = arguments; return new Promise(res => { window.__putReleases.push(() => window.__realStorePut.apply(MemStore, a).then(res)); }); }; });
  await p.locator(`.option[data-i="${card0.answer}"]`).click();
  await p.evaluate(() => { document.querySelector('#mcq').__old = true; });
  await doubleTap(p, '#next');
  /* a precondition, not the claim: the bound has had its chance */
  await p.waitForFunction(() => Memorizer.ui.slowSaves > 0, null, { timeout: 20000 }).catch(() => {});
  const heldRating = await p.evaluate(id => { const m = document.querySelector('#mcq'), c = Memorizer.ui.cards.find(x => x.id === id);
    return { held: window.__putHeld, rating: Memorizer.ui.rating, slow: Memorizer.ui.slowSaves, redrawn: !m || !m.__old, reps: c && c.srs ? c.srs.reps : 0, done: Memorizer.ui.reviewDone }; }, card0.id);
  ok('(the rating\'s write was really held)', heldRating.held === 1, JSON.stringify(heldRating));
  ok('a rating whose write is held moves on: taps work, the card is rated in memory, not counted until stored',
     !heldRating.rating && heldRating.slow === 1 && heldRating.redrawn && heldRating.reps === 1 && heldRating.done === 0, JSON.stringify(heldRating));
  await p.evaluate(() => { MemStore.put = window.__realStorePut; return window.__putReleases.splice(0).reduce((q, f) => q.then(f), Promise.resolve()); });
  await p.waitForFunction(() => Memorizer.ui.slowSaves === 0, null, T).catch(() => {});
  await settled(p);
  const card2 = await p.evaluate(id => MemStore.get('cards', id), card0.id);
  ok('rated again, tapped twice: counted once, and stored', await p.evaluate(() => Memorizer.ui.reviewDone) === 1 && !!card2.srs && card2.srs.reps === 1 &&
     await p.locator('#store-banner').count() === 0, JSON.stringify({ done: await p.evaluate(() => Memorizer.ui.reviewDone), srs: card2.srs }));

  head('a unit whose save is held still opens');
  /* openDoc stores the opened session before drawing it: a save that never
     settled left the tap on Continue doing nothing at all. */
  await p.locator('nav.dock').getByRole('button', { name: 'Home' }).click();
  await p.locator('#continue').waitFor(T);
  await p.evaluate(() => { window.__heldOpen = 0; window.__openReleases = [];
    MemStore.saveStep = function (st, cs) { window.__heldOpen++; return new Promise(res => { window.__openReleases.push(() => window.__realSaveStep.call(MemStore, st, cs).then(res)); }); }; });
  await p.locator('#continue').click();
  /* a precondition, not the claim: the bound has had its chance */
  await p.waitForFunction(() => Memorizer.ui.slowSaves > 0, null, { timeout: 20000 }).catch(() => {});
  const opened = await p.evaluate(() => ({ held: window.__heldOpen, view: Memorizer.ui.view, sections: !!document.querySelector('#sections'), slow: Memorizer.ui.slowSaves }));
  ok('(the save was really held)', opened.held === 1, JSON.stringify(opened));
  ok('the unit opens, and a note says the save is still going', opened.view === 'session' && opened.sections && opened.slow === 1, JSON.stringify(opened));
  await p.evaluate(() => { MemStore.saveStep = window.__realSaveStep; return window.__openReleases.splice(0).reduce((q, f) => q.then(f), Promise.resolve()); });
  await p.waitForFunction(() => Memorizer.ui.slowSaves === 0, null, T).catch(() => {});

  head('a dialog holds focus, and gives it back');
  await p.locator('nav.dock').getByRole('button', { name: 'Home' }).click();
  await p.locator('#continue').waitFor(T);
  ok('Home offers one Continue, naming the unit', /^\W*Continue: My notes$/.test((await p.locator('#continue').innerText()).trim()), await p.locator('#continue').innerText());
  await p.locator('#continue').click();
  await p.locator('#sections').waitFor(T);
  ok('and it opens that unit', await p.evaluate(() => Memorizer.ui.view === 'session' && Memorizer.ui.docRec.name === 'My notes'));
  /* Section 2 taught too, so the two can be compared as a figure. */
  await p.locator('#sections .section-card').nth(1).click();
  await p.locator('#to-drill').waitFor(T);
  await p.getByRole('button', { name: 'Back', exact: true }).click();
  await p.locator('#make-compare').waitFor(T);
  await p.locator('#make-compare').focus();
  await p.keyboard.press('Enter');
  await p.locator('.figure-view').waitFor(T);
  const inside = () => p.evaluate(() => !!document.activeElement && !!document.activeElement.closest('.figure-view'));
  ok('opened from the keyboard, focus moves into the dialog, to Close', await p.evaluate(() => document.activeElement && document.activeElement.id) === 'fig-close',
     await p.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName)));
  ok('and the page behind it is inert', await p.evaluate(() => document.getElementById('app').inert === true));
  let kept = true;
  for (const k of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) { await p.keyboard.press(k); kept = kept && await inside(); }
  ok('Tab and Shift+Tab stay inside it', kept);
  await p.keyboard.press('Escape');
  ok('Escape closes it', await p.locator('.figure-view').count() === 0);
  ok('and focus is back on the button that opened it, the page live again', await p.evaluate(() => document.activeElement && document.activeElement.id) === 'make-compare' &&
     await p.evaluate(() => !document.getElementById('app').inert));

  head('the same notes added twice open the unit already here');
  const nDocs = await p.evaluate(() => MemStore.all('docs').then(d => d.length));
  await paste(p, 'My notes again');
  /* Either way a unit is opened; that is the precondition, not the notice. */
  await p.waitForFunction(() => Memorizer.ui.view === 'session' && !Memorizer.ui.importing && document.querySelector('#sections'), null, T);
  ok('no second copy is made', await p.evaluate(() => MemStore.all('docs').then(d => d.length)) === nDocs);
  ok('the one already here is opened, and the notice says so', await p.evaluate(() => Memorizer.ui.docRec.name) === 'My notes' &&
     await p.locator('#notice').count() === 1 && /already added this as “My notes”/.test(await p.locator('#notice').innerText()));
  const src = (await p.locator('#source-card').textContent()).replace(/\s+/g, ' ');
  ok('its source card says what it is and prints its fingerprint', /Typed or pasted text/.test(src) && /SHA-256 [0-9a-f]{12}/.test(src) && /not a check against current guidelines/.test(src), src.slice(0, 160));

  head('storage refused is said on every screen');
  {
    const q = await context('nostore', () => {
      Object.defineProperty(IDBFactory.prototype, 'open', { value() { throw new Error('refused'); } });
    });
    await q.goto(URL);
    await q.locator('#door-add').waitFor(T);
    const says = async () => (await q.locator('#store-banner').count()) ? (await q.locator('#store-banner').innerText()).replace(/\s+/g, ' ') : '';
    ok('(the store really could not open)', await q.evaluate(() => MemStore.persistent === false));
    ok('Home says study data is kept only for this visit, and what to do', /kept only for this visit/.test(await says()) && /normal window/.test(await says()), await says());
    await paste(q, 'Unsaved notes');
    await q.locator('#sections').waitFor(T);
    ok('so does the unit', /kept only for this visit/.test(await says()));
    await q.locator('#learn-unit').click();
    await q.locator('#to-drill').waitFor(T);
    ok('and the lesson', /kept only for this visit/.test(await says()));
    await q.locator('nav.dock').getByRole('button', { name: 'Settings' }).click();
    await q.locator('#save-settings').waitFor(T);
    ok('and Settings', /kept only for this visit/.test(await says()));
  }

  head('a lesson that arrives late is not filed under another section');
  {
    const held = [];
    const r = await context('late', () => {
      try { localStorage.setItem('memorizer.ai.v1', JSON.stringify({ provider: 'anthropic', model: 'claude-opus-5-5', key: 'sk-ant-stub' })); } catch (_) {}
      /* Counts model replies once read, so a wait can know the app has had
         one; the app's own handling runs in the microtasks straight after. */
      const text = Response.prototype.text;
      Response.prototype.text = function () { const u = this.url; return text.call(this).then(v => { if ((() => { try { return new URL(u).hostname === 'api.anthropic.com'; } catch (_) { return false; } })()) window.__replies = (window.__replies || 0) + 1; return v; }); };
    });
    await r.route('https://api.anthropic.com/**', route => {
      const b = JSON.parse(route.request().postData() || '{}');
      const user = (b.messages && b.messages[0] && b.messages[0].content) || '';
      held.push({ route, user, kind: kindOf(user) });
    });
    /* Waits in Node, on the route's own record: a precondition bounded so a
       request that never comes is reported by the check after it. */
    const requests = n => new Promise(res => { const t0 = Date.now(); const look = () => held.length >= n || Date.now() - t0 > 20000 ? res() : setTimeout(look, 25); look(); });
    const reply = (i, v) => held[i].route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(v) }] }) });
    await r.goto(URL);
    await r.locator('#door-add').waitFor(T);
    await paste(r, 'Late notes');
    await r.locator('#learn-unit').waitFor(T);
    await r.locator('#learn-unit').click();
    await requests(1);
    await r.getByRole('button', { name: 'Back', exact: true }).click();
    await r.locator('#sections .section-card').nth(1).click();
    ok('(section 1’s lesson was asked for, with section 1’s text)', held.length >= 1 && held[0].kind === 'lesson' && /Preload note 0/.test(held[0].user) && !/Afterload note 0/.test(held[0].user));
    await reply(0, lesson('LATE LESSON FOR PRELOAD'));
    await r.waitForFunction(() => window.__replies >= 1, null, T);
    const st = await r.evaluate(() => ({ s: Memorizer.ui.state.section, l1: Memorizer.ui.state.per[1].lesson && Memorizer.ui.state.per[1].lesson.overview, l0: !!Memorizer.ui.state.per[0].lesson }));
    ok('the late reply is not filed as section 2’s lesson, nor as anything', st.s === 1 && st.l1 !== 'LATE LESSON FOR PRELOAD' && !st.l0, JSON.stringify(st));
    await requests(2);
    ok('section 2 is asked for in its own right, with its own text', held.length === 2 && held[1].kind === 'lesson' && /Afterload note 0/.test(held[1].user),
       held.map(h => h.kind).join(', '));
    if (held[1]) await reply(1, lesson('THE AFTERLOAD LESSON'));
    await r.locator('#big-idea').waitFor(T);
    ok('and section 2 shows its own lesson, with no spinner left over and no error', /Afterload/.test(await r.locator('#big-idea').innerText()) &&
       await r.locator('.card.busy').count() === 0 && await r.locator('.card.error').count() === 0 && await r.evaluate(() => Memorizer.ui.busy === ''));

    head('a key can be cleared, and the risk of keeping it is said');
    await r.locator('nav.dock').getByRole('button', { name: 'Settings' }).click();
    await r.locator('#key').waitFor(T);
    ok('the key is masked, and the warning names what can read it', await r.locator('#key').getAttribute('type') === 'password' &&
       /browser extension/.test(await r.locator('#key-warn').innerText()));
    await r.locator('#clear-key').click();
    ok('Clear key removes it from this device', await r.evaluate(() => MemProvider.loadConfig().key === '' && Object.keys(localStorage).every(k => localStorage.getItem(k).indexOf('sk-ant-stub') === -1)) &&
       /removed/.test(await r.locator('#settings-status').innerText()));
  }

  head('redraw preserves a note draft and its caret');
  {
    const r = await context('draft');
    await r.goto(URL); await r.locator('#door-add').waitFor(T); await paste(r, 'Draft'); await r.locator('#learn-unit').waitFor(T);
    await r.locator('#learn-unit').click(); await r.locator('#note-text').waitFor(T);
    await r.fill('#note-text', 'A draft still being typed');
    await r.evaluate(() => { const el = document.querySelector('#note-text'); el.focus(); el.setSelectionRange(4, 9); Memorizer.render(); });
    const got = await r.locator('#note-text').evaluate(el => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd, focused: document.activeElement === el }));
    ok('draft, selection and focus survive background redraw', got.value === 'A draft still being typed' && got.start === 4 && got.end === 9 && got.focused, JSON.stringify(got));
  }

  head('a slow unit-open cannot replace the newer selection');
  {
    const r = await context('navigation');
    await r.goto(URL); await r.locator('#door-add').waitFor(T); await paste(r, 'Navigation'); await r.locator('#learn-unit').waitFor(T);
    const got = await r.evaluate(async () => {
      const a = Memorizer.ui.docId, b = a + '-other', other = JSON.parse(JSON.stringify(Memorizer.ui.docRec)); other.id = b;
      await MemStore.put('docs', other);
      const get = MemStore.get; let release;
      MemStore.get = function (store, id) { if (store === 'docs' && id === a) return new Promise(resolve => { release = () => get(store, id).then(resolve); }); return get(store, id); };
      const slow = Memorizer.openDoc(a); await Memorizer.openDoc(b); const newer = Memorizer.ui.docId;
      release(); await slow; MemStore.get = get;
      return { newer, final: Memorizer.ui.docId, b };
    });
    ok('the latest selection stays active', got.newer === got.b && got.final === got.b, JSON.stringify(got));
  }

  head('source corrections retire stale learning records');
  {
    const r = await context('correction');
    await r.goto(URL); await r.locator('#door-add').waitFor(T); await paste(r, 'Correction');
    await r.locator('#learn-unit').waitFor(T); await r.locator('#learn-unit').click(); await r.locator('#note-text').waitFor(T);
    const old = await r.evaluate(async () => {
      const u = Memorizer.ui, d = u.docRec; d.source = 'photo'; u.fixOpen = true;
      u.state.per[0].quiz = { questions: [{ question: 'Old question', options: ['old', 'other', 'third', 'fourth'], answer: 0 }] }; u.state.per[0].memorized = true;
      const card = { id: d.id + ':old', docId: d.id, cluster: 0, front: 'Old card', srs: null }; u.cards.push(card);
      await MemStore.batch([{ store: 'docs', value: d }, { store: 'vectors', value: { id: d.id, vecs: [[1]] } }, { store: 'cards', value: card }]);
      Memorizer.render(); return d.clusters[0].segments.find(s => !s.heading && !s.table).text;
    });
    await r.locator('#fix-text textarea').first().fill(old.replace('2 percent', '20 percent'));
    await r.locator('#fix-text [data-fix]').first().click();
    await r.waitForFunction(() => Memorizer.ui.docRec.revision === 1, null, T);
    const got = await r.evaluate(async () => ({ quiz: Memorizer.ui.state.per[0].quiz, memorized: Memorizer.ui.state.per[0].memorized,
      vec: await MemStore.get('vectors', Memorizer.ui.docId), old: (await MemStore.all('cards')).some(c => c.id.endsWith(':old')) }));
    ok('old quiz, memorization, vector and review card are gone', !got.quiz && !got.memorized && !got.vec && !got.old, JSON.stringify(got));
  }

  head('failed notes survive refresh and retry the exact write');
  {
    const r = await context('note-retry');
    await r.goto(URL); await r.locator('#door-add').waitFor(T); await paste(r, 'Retry notes');
    await r.locator('#learn-unit').waitFor(T); await r.locator('#learn-unit').click(); await r.locator('#note-text').waitFor(T);
    await r.evaluate(() => {
      window.__put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (v) {
        if (this.name === 'meta' && v.id === 'notes') throw new Error('synthetic notes failure');
        return window.__put.apply(this, arguments);
      };
    });
    await r.fill('#note-text', 'Keep this note'); await r.locator('#note-save').click(); await r.locator('#store-banner').waitFor(T);
    await r.evaluate(() => Memorizer.openDoc(Memorizer.ui.docId, 0));
    ok('a session save leaves the failed note warning visible', await r.locator('#store-banner').count() === 1);
    await r.evaluate(() => { IDBObjectStore.prototype.put = window.__put; });
    await r.locator('#store-retry').click();
    await r.waitForFunction(() => !Memorizer.ui.saveError, null, T);
    await r.reload(); await r.waitForFunction(() => Memorizer.ui.docs.length === 1, null, T);
    ok('retry persisted the note across reload', await r.evaluate(() => Object.values(Memorizer.ui.notes).some(n => n.text === 'Keep this note')));
  }

  head('section deletion commits its associated records together');
  {
    const r = await context('deletion');
    await r.goto(URL); await r.locator('#door-add').waitFor(T); await paste(r, 'Deletion');
    await r.locator('#learn-unit').waitFor(T);
    await r.evaluate(async () => {
      const u = Memorizer.ui, id = u.docId;
      u.notes = { [id + ':0']: { text: 'Alpha' }, [id + ':1']: { text: 'Beta' } };
      u.checks = { [id + ':1']: { start: '2026-01-01', done: [] } };
      await MemStore.batch([{ store: 'meta', value: { id: 'notes', recs: u.notes } }, { store: 'meta', value: { id: 'checks', recs: u.checks } }]);
    });
    r.on('dialog', dialog => dialog.accept());
    await r.locator('#sections .section-del').first().click();
    await r.waitForFunction(() => Memorizer.ui.docRec.clusters.length === 1, null, T);
    const got = await r.evaluate(async () => {
      const id = Memorizer.ui.docId, d = await MemStore.get('docs', id), n = await MemStore.get('meta', 'notes'), c = await MemStore.get('meta', 'checks'), ss = await MemStore.get('sessions', id);
      return { index: d.clusters[0].index, identity: d.clusters[0].identity, note: n.recs[id + ':0'].text, checks: !!c.recs[id + ':0'], titles: ss.state.titles.length };
    });
    ok('surviving section, note, checks and session agree', got.index === 0 && got.identity === 1 && got.note === 'Beta' && got.checks && got.titles === 1, JSON.stringify(got));
    await r.reload(); await r.waitForFunction(() => Memorizer.ui.docs.length === 1, null, T);
    ok('the remapped note survives reload', await r.evaluate(() => Object.values(Memorizer.ui.notes).some(n => n.text === 'Beta')));
  }

  head('failed recuts keep the original chapter manifest in memory');
  {
    const r = await context('recut-failure'); await r.goto(URL); await r.locator('#door-add').waitFor(T); await paste(r, 'Recut'); await r.locator('#learn-unit').waitFor(T);
    await r.evaluate(async () => {
      const id = Memorizer.ui.docId, b = { id: 'synthetic-book', name: 'Synthetic book', pages: 1, method: 'numbered', scanned: [], outline: [],
        parts: [{ fileId: 'synthetic-part', first: 1, last: 1 }], chapters: [{ title: 'One', pageStart: 1, pageEnd: 1, docId: id }], found: {} };
      await MemStore.batch([{ store: 'books', value: b }, { store: 'bookpages', value: { id: b.id + ':0', pages: [{ page: 1, lines: [{ text: 'A synthetic paragraph with enough readable words to retain this source during chapter cutting.', size: 10, y: 10 }] }] } }]);
      window.__recutBatch = MemStore.batch;
      MemStore.batch = ops => ops.some(o => o.store === 'books') ? Promise.reject(new Error('synthetic recut failure')) : window.__recutBatch(ops);
      Memorizer.openBook(b.id);
    });
    await r.locator('#methods').waitFor(T); r.on('dialog', dl => dl.accept()); await r.locator('#methods [data-method=pages]').click();
    await r.waitForFunction(() => Memorizer.ui.error === 'synthetic recut failure', null, T);
    ok('the original method remains selected and stored after rejection', await r.locator('#methods [data-method=numbered]').getAttribute('aria-checked') === 'true' && await r.evaluate(async () => (await MemStore.get('books', 'synthetic-book')).method === 'numbered'));
    await r.evaluate(() => { MemStore.batch = window.__recutBatch; });
  }

  head('a first practice miss survives reload without an SRS review');
  {
    const r = await context('practice-miss'); await r.goto(URL); await r.locator('#door-add').waitFor(T); await paste(r, 'Practice'); await r.locator('#learn-unit').waitFor(T);
    await r.evaluate(async () => {
      const u = Memorizer.ui, q = MemCoach.quiz(u.docRec.clusters[0], MemCoach.lesson(u.docRec.clusters[0]), u.docRec.clusters).questions[0];
      u.state.per[0].quiz = { questions: [q] }; u.state.per[0].score = 0.5;
      await MemStore.saveStep({ id: u.docId, state: u.state, at: Date.now() }, []); u.sessions[u.docId] = u.state;
      Memorizer.startPractice(1);
    });
    await r.locator('#mcq .option').first().waitFor(T);
    const answer = await r.evaluate(() => Memorizer.ui.practice.qs[0].q.answer);
    await r.locator('.option[data-i="' + (answer + 1) % 4 + '"]').click(); await r.locator('#next').click();
    await r.waitForFunction(() => Memorizer.ui.cards.length === 1, null, T);
    await r.reload(); await r.waitForFunction(() => Memorizer.ui.cards.length === 1, null, T);
    const got = await r.evaluate(() => { const card = Memorizer.ui.cards[0], st = Memorizer.ui.sessions[card.docId]; return { srs: card.srs, pending: MemSession.pending(st).length, due: MemSession.dueCards([card], FSRS.todayISO()).length }; });
    ok('one weak card remains due, with no extra scheduler review', got.srs === null && got.pending === 1 && got.due === 1, JSON.stringify(got));
  }

  head('search indexing runs off the UI thread');
  {
    const r = await context('index-worker'); await r.goto(URL); await r.locator('#door-add').waitFor(T);
    const got = await r.evaluate(async () => {
      const docs = Array.from({ length: 120 }, (_, i) => ({ id: 'index-' + i, name: 'Synthetic ' + i,
        clusters: [{ title: 'Preload', text: 'Preload changes ventricular filling.', segments: [{ page: 1, text: Array.from({ length: 20 }, (_, j) => 'Preload changes ventricular filling by ' + (j + 1) + ' percent.').join(' ') }] }] }));
      const expected = JSON.stringify(MemAsk.build(docs));
      const original = MemAsk.build; let ticks = 0;
      MemAsk.build = () => { throw new Error('must use the worker'); };
      const timer = setInterval(() => { ticks++; }, 1), start = performance.now();
      try { const idx = await MemIndexer.build(docs); return { equal: JSON.stringify(idx) === expected, ticks, ms: Math.round(performance.now() - start), sentences: idx.sents.length }; }
      finally { clearInterval(timer); MemAsk.build = original; }
    });
    ok('worker output matches the existing index and the page can process events', got.equal && got.ticks > 0 && got.sentences === 2400, JSON.stringify(got));
  }

  head('multipart order is reviewable before importing');
  {
    const r = await context('part-preview'); await r.goto(URL); await r.locator('#door-add').waitFor(T);
    await r.locator('#book-input').setInputFiles([
      { name: 'Book12_1001-1500.pdf', mimeType: 'application/pdf', buffer: Buffer.from('third') },
      { name: 'Book12_1-500.pdf', mimeType: 'application/pdf', buffer: Buffer.from('first') },
      { name: 'Book12_501-1000.pdf', mimeType: 'application/pdf', buffer: Buffer.from('second') }
    ]);
    await r.locator('#import-order').waitFor(T);
    ok('the preview sorts by page ranges and has not stored any PDF', /1-500/.test(await r.locator('#import-order li').first().innerText()) && await r.evaluate(async () => (await MemStore.all('files')).length === 0));
    await r.getByRole('button', { name: 'Move Book12_501-1000.pdf up', exact: true }).click();
    ok('manual reordering changes the proposed order and warns about the overlap', /501-1000/.test(await r.locator('#import-order li').first().innerText()) && /out of order/.test(await r.locator('#import-order-warning').innerText()));
    await r.locator('#import-order-cancel').click();
    ok('cancelling the preview makes no import records', await r.evaluate(async () => (await MemStore.all('meta')).every(v => v.kind !== 'pending-import')));
  }

  head('cancelled imports never publish partial data');
  {
    const r = await context('cancel-import'); await r.goto(URL); await r.locator('#door-add').waitFor(T);
    await r.evaluate(() => {
      MemPdf.read = () => new Promise(resolve => { window.__finishCancelled = () => resolve({ pages: [], wordCounts: [], numPages: 1, figures: [], ocr: [], outline: [] }); });
      Memorizer.importBook([new File(['synthetic'], 'Book12_1-500.pdf'), new File(['second'], 'Book12_501-1000.pdf')]);
    });
    await r.waitForFunction(() => typeof window.__finishCancelled === 'function', null, T);
    await r.locator('#import-cancel').click();
    await r.evaluate(() => { Memorizer.importText('Do not overlap', 'Synthetic source.'); window.__finishCancelled(); });
    await r.waitForFunction(() => !Memorizer.ui.importJob && /staged files removed/.test(Memorizer.ui.notice), null, T);
    const got = await r.evaluate(async () => ({ docs: (await MemStore.all('docs')).length, books: (await MemStore.all('books')).length, files: (await MemStore.all('files')).length, stages: (await MemStore.all('meta')).filter(v => v.kind === 'pending-import').length }));
    ok('cancellation cleans staged PDF records and no overlapping import starts', Object.values(got).every(v => v === 0), JSON.stringify(got));
    ok('the app remains usable for a new import', await r.locator('#door-add').isVisible());
  }

  head('radio controls and speech privacy');
  {
    const r = await context('keyboard', () => { window.SpeechRecognition = function () {}; });
    await r.goto(URL); await r.locator('#door-add').waitFor(T);
    await r.locator('nav.dock').getByRole('button', { name: 'Settings' }).click();
    ok('each radio group has exactly one tab stop', await r.evaluate(() => [...document.querySelectorAll('[role=radiogroup]')].every(g => g.querySelectorAll('[role=radio][tabindex="0"]').length === 1)));
    const theme = r.locator('[role=radiogroup]').first();
    await theme.locator('[tabindex="0"]').focus(); await r.keyboard.press('End');
    ok('End selects the last theme and keeps keyboard focus', await r.evaluate(() => {
      const g = document.querySelector('[role=radiogroup]'), radios = [...g.querySelectorAll('[role=radio]')];
      return document.activeElement === radios[radios.length - 1] && document.activeElement.getAttribute('aria-checked') === 'true';
    }));
    await r.keyboard.press('ArrowRight');
    ok('arrows wrap to the first theme', await theme.locator('[role=radio]').first().getAttribute('aria-checked') === 'true');
    await r.locator('nav.dock').getByRole('button', { name: 'Coach' }).click(); await r.locator('#ask-mic').waitFor(T);
    ok('the microphone names possible off-device audio processing at the action', await r.locator('#ask-mic-privacy').isVisible() && /send audio/.test(await r.locator('#ask-mic-privacy').innerText()) && await r.locator('#ask-mic').getAttribute('aria-describedby') === 'ask-mic-privacy');
  }

  head('failed atomic edits cannot be acknowledged by a session save');
  {
    const r = await context('atomic-failure');
    await r.goto(URL); await r.locator('#door-add').waitFor(T); await paste(r, 'Atomic failure'); await r.locator('#learn-unit').waitFor(T);
    r.on('dialog', dl => dl.accept());
    await r.evaluate(() => {
      window.__atomicPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (v) { if (this.name === 'docs') throw new Error('synthetic edit failure'); return window.__atomicPut.apply(this, arguments); };
    });
    await r.locator('#sections .section-del').first().click(); await r.locator('#store-banner').waitFor(T);
    ok('failed deletion keeps both sections and offers repeat-action advice', await r.evaluate(() => Memorizer.ui.docRec.clusters.length === 2) && /Repeat the original action/.test(await r.locator('#store-banner').innerText()) && await r.locator('#store-retry').count() === 0);
    await r.evaluate(() => { IDBObjectStore.prototype.put = window.__atomicPut; return Memorizer.openDoc(Memorizer.ui.docId); });
    ok('an unrelated successful save retains the atomic edit warning', await r.locator('#store-banner').count() === 1);
    await r.locator('#store-dismiss').click();
    await r.locator('#sections .section-del').first().click(); await r.waitForFunction(() => Memorizer.ui.docRec.clusters.length === 1, null, T);
    ok('repeating the action applies the deletion once', await r.evaluate(async () => (await MemStore.get('docs', Memorizer.ui.docId)).clusters.length === 1));
  }

  head('backup rescue and transactional restore');
  {
    const r = await context('backup');
    await r.goto(URL); await r.locator('#door-add').waitFor(T); await paste(r, 'Backup');
    await r.locator('#learn-unit').waitFor(T); await r.locator('#learn-unit').click(); await r.locator('#note-text').waitFor(T);
    await r.evaluate(async () => {
      const bytes = new Uint8Array(8 * 1024 * 1024);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + (i >>> 16)) & 255;
      await MemStore.put('files', { id: 'synthetic-large-binary', bytes: bytes.buffer });
    });
    await r.evaluate(() => {
      window.__backupPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (v) {
        if (this.name === 'meta' && v.id === 'notes') throw new Error('synthetic backup note failure');
        return window.__backupPut.apply(this, arguments);
      };
    });
    await r.fill('#note-text', 'Rescue this pending note'); await r.locator('#note-save').click(); await r.locator('#store-banner').waitFor(T);
    const backup = await r.evaluate(() => MemBackup.exportText());
    const rescued = await r.evaluate(text => MemBackup.inspect(text).then(v => Object.values(v.stores.meta.find(m => m.id === 'notes').recs).some(n => n.text === 'Rescue this pending note')), backup);
    ok('export includes the exact failed note payload', rescued);
    await r.evaluate(async text => {
      IDBObjectStore.prototype.put = window.__backupPut;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (v) { if (this.name === 'docs') throw new Error('synthetic restore failure'); return put.apply(this, arguments); };
      try { await MemBackup.restore(text); } catch (_) {} finally { IDBObjectStore.prototype.put = put; }
    }, backup);
    ok('a failed restore rolls back every clear and retains pending writes', await r.evaluate(async () => (await MemStore.all('docs')).length === 1 && !!MemStore.failureMessage()));
    await r.locator('nav.dock').getByRole('button', { name: 'Settings' }).click();
    await r.locator('#backup-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backup) });
    await r.locator('#backup-restore').waitFor(T);
    ok('restore previews the units and replacement before writing', /1 units/.test(await r.locator('[role=dialog]').innerText()) && /replaces all study data/.test(await r.locator('[role=dialog]').innerText()));
    await r.locator('#backup-restore').click();
    await r.waitForFunction(() => Memorizer.ui.notice === 'Backup restored.', null, T);
    await r.reload(); await r.waitForFunction(() => Memorizer.ui.docs.length === 1, null, T);
    ok('restored pending note survives reload and the warning clears', await r.evaluate(() => !MemStore.failureMessage() && Object.values(Memorizer.ui.notes).some(n => n.text === 'Rescue this pending note')));
    ok('an 8 MiB binary payload survives the browser backup/restore flow byte for byte', await r.evaluate(async () => {
      const saved = await MemStore.get('files', 'synthetic-large-binary'), bytes = new Uint8Array(saved.bytes);
      return bytes.length === 8 * 1024 * 1024 && bytes.every((v, i) => v === ((i * 31 + (i >>> 16)) & 255));
    }));
    // Writes queued and not awaited before a restore belong to the replaced
    // data. Before restore joined the write queue they ran after its
    // transaction and left their records on top of the restored database.
    const raced = await r.evaluate(async text => {
      const pending = [];
      for (let i = 0; i < 100; i++) pending.push(MemStore.put('meta', { id: 'stale-' + i, at: i }));
      pending.push(MemStore.put('meta', { id: 'notes', recs: { 'stale:0': { text: 'STALE' } } }));
      await MemBackup.restore(text);
      await Promise.allSettled(pending);
      const meta = await MemStore.all('meta'), want = (await MemBackup.inspect(text)).stores.meta.map(m => m.id).sort();
      const notes = meta.find(m => m.id === 'notes');
      return { ids: meta.map(m => m.id).sort().join(','), want: want.join(','), stale: !!(notes && JSON.stringify(notes).includes('STALE')) };
    }, backup);
    ok('writes queued before a restore cannot land on the restored IndexedDB database', raced.ids === raced.want && !raced.stale, JSON.stringify(raced).slice(0, 200));
  }

  ok('nothing left the device but calls to the model, throughout', outside.length === 0, outside.join(', ') || 'none');
  ok('and nothing threw on the page throughout', errors.length === 0, errors.join(' | '));
  head('deletion cancels failed writes without losing other units’ pending notes');
  for (const wholeBook of [false,true]) {
    const r=await context('delete pending writes');await r.goto(URL);await r.locator('#home-hero').waitFor(T);
    const result=await r.evaluate(async wholeBook=>{
      const id='delete-unit',keep='keep-unit',cluster={index:0,title:'Synthetic',text:'Synthetic source.',segments:[]};
      const session={id,state:{docId:id,titles:['Synthetic'],per:{}}};
      const ops=[{store:'docs',value:{id,clusters:[cluster]}},{store:'docs',value:{id:keep,clusters:[cluster]}},
        {store:'sessions',value:session},{store:'meta',value:{id:'notes',recs:{[id+':0']:{text:'Old'},[keep+':0']:{text:'Keep'}}}}];
      if(wholeBook)ops.push({store:'books',value:{id:'delete-book',parts:[],chapters:[{docId:id}]}});
      await MemStore.batch(ops);
      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(v){if(this.name==='sessions'||(this.name==='meta'&&(v.id==='notes'||v.id==='unrelated')))
        throw new DOMException('Synthetic full storage','QuotaExceededError');return put.apply(this,arguments);};
      try{
        await MemStore.saveStep(session,[{id:'delete-card',docId:id,cluster:0}]).catch(()=>{});
        await MemStore.put('meta',{id:'notes',recs:{[id+':0']:{text:'Delete pending'},[keep+':0']:{text:'Rescue pending'}}}).catch(()=>{});
        await MemStore.put('meta',{id:'unrelated',text:'Preserve this failed write'}).catch(()=>{});
      }finally{IDBObjectStore.prototype.put=put;}
      const del=IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete=function(){if(this.name==='docs')throw new Error('Synthetic deletion failure');return del.apply(this,arguments);};
      let deletionFailed=false;
      try{await(wholeBook?MemStore.deleteBook('delete-book'):MemStore.deleteDoc(id)).catch(()=>{deletionFailed=true;});}
      finally{IDBObjectStore.prototype.delete=del;}
      const failedSnapshot=await MemStore.snapshot(),retained=deletionFailed&&!!(await MemStore.get('docs',id))&&failedSnapshot.cards.some(c=>c.id==='delete-card');
      const getAll=IDBObjectStore.prototype.getAll,reads=[];
      IDBObjectStore.prototype.getAll=function(){reads.push(this.name);return getAll.apply(this,arguments);};
      try{if(wholeBook)await MemStore.deleteBook('delete-book');else await MemStore.deleteDoc(id);}
      finally{IDBObjectStore.prototype.getAll=getAll;}
      const boundedReads=reads.includes('cards')&&reads.includes('meta')&&reads.every(s=>s==='cards'||s==='meta');
      const preview=await MemBackup.inspect(await MemBackup.exportText());
      const pendingOther=!!MemStore.failureMessage();await MemStore.retryFailures();
      const after={docs:(await MemStore.all('docs')).length,sessions:(await MemStore.all('sessions')).length,cards:(await MemStore.all('cards')).length};
      const notes=await MemStore.get('meta','notes');
      const race='race-unit';await MemStore.batch([{store:'docs',value:{id:race,clusters:[cluster]}}]);
      const raceSession={id:race,state:{docId:race,titles:['Synthetic'],per:{}}};
      const saving=MemStore.saveStep(raceSession,[]),deleting=MemStore.deleteDoc(race);
      await Promise.all([saving,deleting]);
      await MemStore.batch([{store:'docs',value:{id:race,clusters:[cluster]}}]);
      const deletingAgain=MemStore.deleteDoc(race),late=MemStore.saveStep(raceSession,[]).then(()=>null,e=>e.name);
      await deletingAgain;const lateError=await late;
      await MemStore.batch([{store:'docs',value:{id,clusters:[cluster]}}]);
      await MemStore.saveStep(session,[{id:'delete-card',docId:id,cluster:0}]);
      const revived=!!(await MemStore.get('cards','delete-card'));
      return {previewDocs:preview.docs,previewCards:preview.cards,after,pendingOther,retained,revived,boundedReads,
        rescued:notes.recs[keep+':0'].text,deletedNote:!!notes.recs[id+':0'],
        unrelated:(await MemStore.get('meta','unrelated')).text,lateError,
        raceGone:!(await MemStore.get('docs',race))&&!(await MemStore.get('sessions',race)),pendingAfter:!!MemStore.failureMessage()};
    },wholeBook);
    ok(`failed save → ${wholeBook?'book':'unit'} deletion exports a restorable backup`,result.previewDocs===1&&result.previewCards===0);
    ok('a failed deletion preserves the document and its pending rescue payload',result.retained);
    ok('deletion reads cleanup records without loading library PDF bytes',result.boundedReads);
    ok('retry does not recreate the deleted session or cards',result.after.docs===1&&result.after.sessions===0&&result.after.cards===0);
    ok('the deletion saves surviving pending notes and removes deleted-unit notes',result.rescued==='Rescue pending'&&!result.deletedNote);
    ok('unrelated failed writes survive deletion and can be retried',result.pendingOther&&result.unrelated==='Preserve this failed write');
    ok('an in-flight save is cleaned and a late save is refused without a retry payload',result.raceGone&&result.lateError==='DeletedDocumentError'&&!result.pendingAfter);
    ok('deliberately restoring the document allows its previous card IDs to be saved again',result.revived);
    await r.context().close();
  }

  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(die);
