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
    await p.locator('nav.dock').getByRole('button', { name: 'Home' }).click();
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
  await p.locator(`.option[data-i="${card0.answer}"]`).click();
  await doubleTap(p, '#next');
  await settled(p);
  const card2 = await p.evaluate(id => MemStore.get('cards', id), card0.id);
  ok('rated again, tapped twice: counted once, and stored', await p.evaluate(() => Memorizer.ui.reviewDone) === 1 && !!card2.srs && card2.srs.reps === 1 &&
     await p.locator('#store-banner').count() === 0, JSON.stringify({ done: await p.evaluate(() => Memorizer.ui.reviewDone), srs: card2.srs }));

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
      try { localStorage.setItem('memorizer.ai.v1', JSON.stringify({ provider: 'anthropic', model: 'claude-opus-5', key: 'sk-ant-stub' })); } catch (_) {}
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
    ok('and section 2 shows its own lesson, with no spinner left over and no error', /THE AFTERLOAD LESSON/.test(await r.locator('#big-idea').innerText()) &&
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

  ok('nothing left the device but calls to the model, throughout', outside.length === 0, outside.join(', ') || 'none');
  ok('and nothing threw on the page throughout', errors.length === 0, errors.join(' | '));
  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(die);
