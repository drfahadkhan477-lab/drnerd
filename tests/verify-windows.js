#!/usr/bin/env node
/*
 * Two windows of one origin, and the one record they share.
 *
 *   node tests/verify-windows.js build/synthetic/systole.html
 *
 * The progress record (accsap12.v2) and the reference notes (accsap12.ref) are one record each per origin. A window holds its own copy and
 * writes the whole of it at every answer or edit, so two windows of one origin (two tabs; two Safari windows in Split View) decided between them by
 * who wrote last: an answer given in one was lost when the other, which had loaded before it, answered next, and a window left open for days
 * wiped the days in between at its first answer. The page now takes a record another window wrote when the browser says so (a storage event),
 * and when it is next seen if it was suspended and missed that. This holds, with two pages in one context served from one origin:
 *
 *   · an answer in one window is in the other, without a reload, and the other does not write it back;
 *   · the second window's first answer is added to the first's, not written over it, also when it was never told (the stale tab);
 *   · coming back from the page cache is caught up the same way;
 *   · the question being worked in the receiving window is left alone: the screen, the answer chosen, whether a deck was resumed, and no
 *     redraw of the quiz; and the screens that show the record are drawn again;
 *   · a record that is not one, or that a restore would refuse (also when only one row of it is refused), is not taken, and nothing throws;
 *   · the reference notes are shared the same way, drawn where they show (and not over a note being typed), and a note being edited in one
 *     window when the other deletes it is kept, as a note of its own.
 *
 * What it does not hold, because it is not done: the ink, the sticky notes, the chats and the review log live in the database and are still
 * decided by who wrote last.
 */
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { launch } = require('./_engine');
const { booted } = require('./_render.js');
const { onDeath, watch } = require('./_deathnote.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-windows.js <build.html>'); process.exit(1); }
const HTML = fs.readFileSync(path.resolve(target));

let passed = 0, failed = 0, unmeasured = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const unmeasurable = (label, why) => { unmeasured++; console.log('  ----  ' + label + '  → not measurable here: ' + why); };
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url.startsWith('/?')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(HTML); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/';

  const errors = [], events = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 } });
  /* One page is booted before the next is opened: the later page is the one in front, and a page behind it is not given animation frames, which
     the boot wait polls on. */
  const A = watch(await ctx.newPage(), events, 'A', errors);
  await A.goto(base, { waitUntil: 'load', timeout: 200000 });
  await booted(A, { timeout: 150000 });
  const B = watch(await ctx.newPage(), events, 'B', errors);
  await B.goto(base, { waitUntil: 'load', timeout: 200000 });
  await booted(B, { timeout: 150000 });

  /* A wait is a precondition, never the claim. polling is a number: the default polls on animation frames, which a window behind the front one
     is not given. */
  const until = (pg, fn, arg, ms = 8000) => pg.waitForFunction(fn, arg === undefined ? null : arg, { timeout: ms, polling: 40 }).then(() => true, () => false);
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const answer = async (pg, n) => {
    const id = await pg.evaluate(n => { const q = POOL.filter(q => q.o.length >= 4 && !q.imgopt)[n]; startAdhocQuiz([q], null); return q.id; }, n);
    await until(pg, id => S.screen === 'quiz' && !!document.querySelector('.q-card') && S.questions[S.qIdx].id === id, id);
    await pg.evaluate(() => selectOpt(0));
    return id;
  };
  const stored = pg => pg.evaluate(() => JSON.parse(localStorage.getItem('accsap12.v2')));
  const mine = pg => pg.evaluate(() => ({ total: S.sessionTotal, practice: Object.keys(S.practice).sort(), screen: S.screen, qIdx: S.qIdx, answered: S.answered,
                                           selected: S.selected, resumed: S.resumed, missedIsSet: S.missed instanceof Set, chapters: Object.keys(S.chStats).sort().join() }));

  head('two windows, one origin');
  {
    const [oa, ob] = await Promise.all([A.evaluate(() => location.origin), B.evaluate(() => location.origin)]);
    /* WebKit hands a write to the other page's process after a moment: a read of it straight afterwards came back empty in two of fifteen runs. */
    await A.evaluate(() => localStorage.setItem('zz.probe', 'seen'));
    const shared = await until(B, () => localStorage.getItem('zz.probe') === 'seen', undefined, 3000);
    await A.evaluate(() => localStorage.removeItem('zz.probe'));
    ok('the two pages share an origin and its storage, which is what makes them two windows of one app', oa === ob && shared, `${oa} · ${shared ? 'seen' : 'not seen by the other page'}`);
    const [a, b] = await Promise.all([mine(A), mine(B)]);
    ok('and both begin with nothing answered', a.total === 0 && b.total === 0, `${a.total} · ${b.total}`);
  }

  head('an answer in one window is in the other');
  let id0, id1;
  {
    /* Two counts in the second window, installed before anything is given: the writes of the record, and the times a record is taken. */
    await B.evaluate(() => {
      window.__writes = 0; window.__taken = 0;
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k === 'accsap12.v2') window.__writes++; return set.call(this, k, v); };
      const real = adoptProgress;
      adoptProgress = function () { window.__taken++; return real.apply(this, arguments); };
    });
    const seen = () => B.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pageshow')); });
    id0 = await answer(A, 0);
    const came = await until(B, id => S.sessionTotal === 1 && !!S.practice[id], id0);
    const b = await mine(B);
    ok('the second window has the answer the first gave, without a reload', came && b.total === 1 && b.practice.join() === id0, `${b.total} answered, ${b.practice.join()}`);
    ok('and holds it as a restore would (the missed list a set)', b.missedIsSet, `the missed list a ${b.missedIsSet ? 'set' : 'not a set'}`);
    await pause(400);
    const writes = await B.evaluate(() => window.__writes);
    ok('and does not write the record back', writes === 0, `${writes} writes of the record by the window that took it`);
    await seen();
    await pause(200);
    const once = await B.evaluate(() => window.__taken);
    ok('and a record the browser announced is taken once, not again when the window is seen', once === 1, `${once} times`);
    id1 = await answer(B, 1);
    const own = await B.evaluate(() => window.__writes);
    ok('(the count of writes is not blind: the window\'s own answer is one)', own >= 1, `${own} writes after its own answer`);
    const cameBack = await until(A, () => S.sessionTotal === 2);
    const s = await stored(A), a = await mine(A);
    ok('and its own answer is added to the first window\'s, not written over it',
       s.sessionTotal === 2 && Object.keys(s.practice).sort().join() === [id0, id1].sort().join() && cameBack && a.total === 2,
       `stored ${s.sessionTotal} answered, ${Object.keys(s.practice).join()}; first window ${a.total}`);
    await seen();
    await pause(200);
    const ownNews = await B.evaluate(() => window.__taken);
    ok('and a window does not take its own write as news when it is seen', ownNews === 1, `${ownNews} times in all`);
  }

  head('a window that missed the news is caught up when it is next seen');
  let id2;
  {
    await B.evaluate(() => window.removeEventListener('storage', onProgressStorage));
    id2 = await answer(A, 2);
    await pause(500);
    const before = await mine(B);
    ok('a window that is not told does not know (the stale tab, before it is looked at)', before.total === 2, `${before.total} answered`);
    await B.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const caught = await until(B, id => S.sessionTotal === 3 && !!S.practice[id], id2, 3000);
    const after = await mine(B);
    ok('seen again, it takes the record', caught && after.total === 3, `${after.total} answered`);
    await answer(B, 3);
    const s = await stored(B);
    ok('and its first answer is added to the record, not written over the days it did not see',
       s.sessionTotal === 4 && Object.keys(s.practice).length === 4, `stored ${s.sessionTotal} answered, ${Object.keys(s.practice).length} questions`);
    await until(A, () => S.sessionTotal === 4);

    /* Coming back from the page cache fires pageshow, not visibilitychange. */
    await B.evaluate(() => window.removeEventListener('storage', onProgressStorage));
    await answer(A, 4);
    await pause(300);
    const stale = await mine(B);
    await B.evaluate(() => window.dispatchEvent(new Event('pageshow')));
    const back = await until(B, () => S.sessionTotal === 5, undefined, 3000);
    ok('and so is a window brought back from the page cache', stale.total === 4 && back, `${stale.total} before, ${(await mine(B)).total} after`);
    await B.evaluate(() => window.addEventListener('storage', onProgressStorage));

    await answer(A, 5);
    await until(B, () => S.sessionTotal === 6);
  }

  head('the question on screen is left alone');
  {
    const visible = await B.evaluate(() => document.visibilityState);
    await answer(B, 6);
    await B.evaluate(() => { S.resumed = true; window.__renders = 0; const real = render; render = function () { window.__renders++; return real.apply(this, arguments); }; });
    const view = await mine(B);
    await answer(A, 7);
    await until(B, () => S.sessionTotal === 8);
    await pause(200);
    const after = await mine(B), renders = await B.evaluate(() => window.__renders);
    ok('a window in the middle of a question keeps the screen, the question, the answer chosen and whether it resumed a deck',
       after.screen === 'quiz' && after.qIdx === view.qIdx && after.answered === view.answered && after.selected === view.selected && after.resumed === true && view.answered === true,
       JSON.stringify({ view: [view.screen, view.qIdx, view.answered, view.selected], after: [after.screen, after.qIdx, after.answered, after.selected, after.resumed] }));
    ok('and does not redraw it', renders === 0, `${renders} redraws`);
    ok('while the record under it is the new one', after.total === 8, `${after.total} answered`);

    /* The flag of the question on screen follows the other window, painted in place: a flag that looks off and is on would be taken off by the
       press that was meant to put it on. The question itself is still not drawn again. */
    const flagState = () => B.evaluate(() => { const b = document.getElementById('qFlag'), g = document.getElementById('qFlagBadge'); return { on: b.classList.contains('on'), pressed: b.getAttribute('aria-pressed'), badge: !g.hidden, renders: window.__renders }; });
    const qidB = await B.evaluate(() => S.questions[S.qIdx].id);
    await A.evaluate(id => { S.flagged.delete(id); save(); }, qidB);
    await until(B, id => !S.flagged.has(id), qidB);
    const flagBefore = await flagState();
    await A.evaluate(id => { S.flagged.add(id); save(); }, qidB);
    const flagOn = await until(B, () => document.getElementById('qFlag').classList.contains('on'));
    const flagAfter = await flagState();
    await A.evaluate(id => { S.flagged.delete(id); save(); }, qidB);
    const flagOff = await until(B, () => !document.getElementById('qFlag').classList.contains('on'));
    const flagGone = await flagState();
    ok('the flag of the question on screen follows the other window, in place: on, then off, and the question is not drawn again',
       !flagBefore.on && flagBefore.pressed === 'false' && !flagBefore.badge && flagOn && flagAfter.on && flagAfter.pressed === 'true' && flagAfter.badge && flagOff && !flagGone.on &&
       flagGone.pressed === 'false' && !flagGone.badge && flagGone.renders === 0,
       `before ${JSON.stringify(flagBefore)}, flagged ${JSON.stringify(flagAfter)}, unflagged ${JSON.stringify(flagGone)}`);

    await B.evaluate(() => { goHome(); });
    await until(B, () => S.screen === 'home' && !!document.querySelector('.hero-h1'));
    await B.evaluate(() => { window.__renders = 0; });
    await answer(A, 8);
    await until(B, () => S.sessionTotal === 9);
    await pause(200);
    const drawn = await B.evaluate(() => window.__renders);
    if (visible !== 'visible') unmeasurable('a screen that shows the record is drawn again', `the window reports itself ${visible}`);
    else ok('a screen that shows the record is drawn again', drawn >= 1, `${drawn} redraws`);

    /* A window that is hidden takes the record and draws nothing; it draws what it took when it is seen. */
    await B.evaluate(() => { window.__renders = 0; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); });
    await answer(A, 9);
    await until(B, () => S.sessionTotal === 10);
    await pause(200);
    const hiddenDraws = await B.evaluate(() => window.__renders);
    await B.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
    await pause(300);
    const seenDraws = await B.evaluate(() => window.__renders);
    ok('a window that is hidden takes the record and draws nothing, and draws it when it is seen', hiddenDraws === 0 && seenDraws >= 1, `${hiddenDraws} redraws while hidden, ${seenDraws} once seen`);
  }

  head('the lists of questions show the marks of the record taken');
  {
    /* A list of questions on screen carries the flagged and missed marks of the record: the annotated questions, and the results of a search. The
       results are put on the screen as the search puts them (SQ.hits), as the index is not what is asked about. The question starts without either
       mark in both windows, whatever was answered before: with a mark already there the list shows it whether or not it is drawn again, and a
       check that cannot tell the two apart passes on a window that is never drawn. So each list is read before the other window writes, and has
       to be without the mark then. */
    const mark = (pg, sel) => pg.evaluate(sel => document.querySelectorAll(sel).length, sel);
    // where the window is when it is asked, for a failure to say: a window the browser has hidden for a moment draws when it is seen, not before
    const where = pg => pg.evaluate(() => `on ${S.screen}, ${document.visibilityState}`);
    const qid = await B.evaluate(() => POOL.filter(q => q.o.length >= 4 && !q.imgopt)[0].id);
    await A.evaluate(id => { S.flagged.delete(id); S.missed.delete(id); save(); }, qid);
    await until(B, id => !S.flagged.has(id) && !S.missed.has(id), qid);
    await B.evaluate(id => { NOTES = {}; NOTES[id] = [{ id: 'n1', x: .1, y: .1, text: 'A note on this question', color: '#F59E0B' }]; goAnnotations(); }, qid);
    await until(B, () => S.screen === 'annotations' && document.querySelectorAll('#annoList .hit').length === 1);
    const before = await mark(B, '#annoList .hit-flag.flagged');
    await A.evaluate(id => { S.flagged.add(id); save(); }, qid);
    const flagged = await until(B, () => document.querySelectorAll('#annoList .hit-flag.flagged').length === 1);
    ok('the annotated questions on screen show a question the other window flagged', before === 0 && flagged, `${before} flagged marks before, ${await mark(B, '#annoList .hit-flag.flagged')} after, ${await where(B)}`);

    await B.evaluate(() => { document.getElementById('annoQ').focus(); window.__renders = 0; });
    await A.evaluate(id => { S.flagged.delete(id); save(); }, qid);
    const unflagged = await until(B, id => !S.flagged.has(id), qid);
    await pause(300);
    const typing = await B.evaluate(() => ({ renders: window.__renders, focus: document.activeElement && document.activeElement.id, marks: document.querySelectorAll('#annoList .hit-flag.flagged').length }));
    await B.evaluate(() => { document.activeElement.blur(); render(); });
    const marksAfter = await until(B, () => document.querySelectorAll('#annoList .hit-flag.flagged').length === 0);
    ok('but not under a field being typed in: nothing is drawn and the field keeps its focus, and the mark is gone the next time the list is',
       unflagged && typing.renders === 0 && typing.focus === 'annoQ' && typing.marks === 1 && marksAfter,
       `${typing.renders} redraws, focus in ${typing.focus}, ${typing.marks} mark while typing, gone after: ${marksAfter}`);

    await B.evaluate(id => { SQ.q = 'zq'; SQ.ran = true; SQ.hits = [{ q: ALL_Q.find(q => q.id === id), score: 1 }]; S.screen = 'search'; render(); }, qid);
    await until(B, () => S.screen === 'search' && document.querySelectorAll('.hits .hit').length === 1);
    const unmarked = await mark(B, '.hits .hit-flag');
    await A.evaluate(id => { S.missed.add(id); save(); }, qid);
    const missed = await until(B, () => document.querySelectorAll('.hits .hit-flag').length === 1);
    ok('the results of a search on screen show a question the other window missed', unmarked === 0 && missed, `${unmarked} marks before, ${await mark(B, '.hits .hit-flag')} after, ${await where(B)}`);
    await B.evaluate(() => { SQ.hits = []; SQ.q = ''; goHome(); });
    await until(B, () => S.screen === 'home' && !!document.querySelector('.hero-h1'));
  }

  head('a record from a newer copy of the app');
  {
    /* load() says, of a record a newer copy wrote, that this copy is older and that nothing is lost. A window that takes one from a newer copy says
       so too, once; what the newer copy added is kept, as a save of this window would write it back. */
    await B.evaluate(() => { window.__toasts = 0; const real = toast; toast = function (m) { if (/older than the data/.test(m)) window.__toasts++; return real.apply(this, arguments); }; });
    const n = await B.evaluate(() => window.__taken);
    await A.evaluate(v => {
      const rec = JSON.parse(localStorage.getItem('accsap12.v2'));
      Storage.prototype.setItem.call(localStorage, 'accsap12.v2', JSON.stringify(Object.assign(rec, { schemaVersion: v + 1, zqFuture: { kept: true } })));
    }, await A.evaluate(() => DATA_SCHEMA_VERSION));
    const told = await until(B, n => window.__taken > n, n, 3000);
    await A.evaluate(() => {
      const rec = JSON.parse(localStorage.getItem('accsap12.v2'));
      Storage.prototype.setItem.call(localStorage, 'accsap12.v2', JSON.stringify(Object.assign(rec, { zqFuture: { kept: true, again: true } })));
    });
    const toldAgain = await until(B, n => window.__taken > n + 1, n, 3000);
    const seen = await B.evaluate(() => ({ toasts: window.__toasts, foreign: typeof FOREIGN === 'object' && !!FOREIGN.zqFuture && FOREIGN.zqFuture.again === true }));
    ok('a record a newer copy wrote is taken with the warning load() gives, once, and what the newer copy added is kept', told && toldAgain && seen.toasts === 1 && seen.foreign,
       `${seen.toasts} warnings in two records, the newer copy's field ${seen.foreign ? 'kept' : 'not kept'}`);
  }

  head('a record that is not one is not taken');
  {
    const before = await mine(B);
    /* Each is written as another window's save would write it. The check waits until the window has been told (a refusal is only one if the
       window looked) and then holds it to what it had: the answers, the chapters, the missed list a set. A list and a string are JSON that parses
       and is not a record; a restore would take either as an empty one, and wipe what the window holds. */
    for (const [what, text] of [['text that is not JSON', '{not json'], ['JSON that is a list', '[]'], ['JSON that is a string', '"text"'],
                                ['a record a restore would refuse (a missed list that is not a list)', '{"missed":"oops"}'],
                                ['a record with one row a restore would refuse (more correct answers than answers), which is refused whole and not trimmed to the rest',
                                 JSON.stringify({ sessionTotal: 99, practice: { zq: { n: 1, c: 2, t: 0 } } })]]) {
      const n = await B.evaluate(() => window.__taken);
      await A.evaluate(t => Storage.prototype.setItem.call(localStorage, 'accsap12.v2', t), text);
      const told = await until(B, n => window.__taken > n, n, 3000);
      const now = await mine(B);
      ok(what + ' is not taken', told && now.total === before.total && now.practice.join() === before.practice.join() && now.chapters === before.chapters && now.missedIsSet,
         told ? `${now.total} answered (it had ${before.total}), the missed list a ${now.missedIsSet ? 'set' : 'not a set'}` : 'the window was not told');
    }
    await answer(A, 10);
    const mended = await until(B, n => S.sessionTotal === n + 1, before.total, 3000);
    ok('and the next good record is', mended, `${(await mine(B)).total} answered`);
  }

  head('the reference notes are shared the same way');
  {
    await A.evaluate(() => { refAdd('Zq first note', 'Body of the first note, about nothing in particular.', 'zq', ''); });
    const gotFirst = await until(B, () => REF.some(r => r.title === 'Zq first note'));
    await B.evaluate(() => { refAdd('Zq second note', 'Body of the second note, likewise.', 'zq', ''); });
    const gotBoth = await until(A, () => REF.some(r => r.title === 'Zq first note') && REF.some(r => r.title === 'Zq second note'));
    const list = await A.evaluate(() => JSON.parse(localStorage.getItem('accsap12.ref')).map(r => r.title).filter(t => /^Zq /.test(t)).sort());
    ok('a note added in one window is in the other, and the second window\'s is added to it, not written over it',
       gotFirst && gotBoth && list.join() === 'Zq first note,Zq second note', list.join(' | '));
  }

  head('the screens that show the notes are drawn from the notes taken');
  {
    /* The library with nothing typed in it, then with a draft in it, then in a window that is hidden. */
    const titles = pg => pg.evaluate(() => [...document.querySelectorAll('.ref-title')].map(e => e.textContent));
    await B.evaluate(() => { goRefs(); });
    await until(B, () => S.screen === 'refs' && !!document.getElementById('refT'));
    const idShown = await A.evaluate(() => refAdd('Zq drawn note', 'Body of a note added while the library is open in the other window.', 'zq', '').id);
    const drawn = await until(B, () => [...document.querySelectorAll('.ref-title')].some(e => e.textContent === 'Zq drawn note'));
    await A.evaluate(id => { refDelete(id); }, idShown);
    const gone = await until(B, () => ![...document.querySelectorAll('.ref-title')].some(e => e.textContent === 'Zq drawn note'));
    ok('a library on screen shows the note the other window added, and not the one it deleted', drawn && gone, `added: ${drawn}, deleted: ${gone}`);

    await B.evaluate(() => { document.getElementById('refB').value = 'A note being typed here'; window.__renders = 0; });
    await A.evaluate(() => { refAdd('Zq unseen note', 'Body of a note added while one is being typed in the other window.', 'zq', ''); });
    const took = await until(B, () => REF.some(r => r.title === 'Zq unseen note'));
    await pause(300);
    const kept = await B.evaluate(() => ({ typed: document.getElementById('refB').value, renders: window.__renders }));
    const listedWhileTyping = (await titles(B)).includes('Zq unseen note');
    await B.evaluate(() => { document.getElementById('refB').value = ''; render(); });
    const listedAfter = await until(B, () => [...document.querySelectorAll('.ref-title')].some(e => e.textContent === 'Zq unseen note'));
    ok('but not over a note being typed: the draft stays, nothing is drawn, and the note is in the library the next time it is',
       took && kept.typed === 'A note being typed here' && kept.renders === 0 && !listedWhileTyping && listedAfter,
       `typed "${kept.typed.slice(0, 12)}", ${kept.renders} redraws, listed while typing: ${listedWhileTyping}, after: ${listedAfter}`);

    await B.evaluate(() => { window.__renders = 0; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); });
    await A.evaluate(() => { refAdd('Zq later note', 'Body of a note added while the other window is hidden.', 'zq', ''); });
    const tookHidden = await until(B, () => REF.some(r => r.title === 'Zq later note'));
    await pause(200);
    const whileHidden = await B.evaluate(() => window.__renders);
    await B.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
    const shown = await until(B, () => [...document.querySelectorAll('.ref-title')].some(e => e.textContent === 'Zq later note'));
    ok('a window that is hidden takes the note and draws nothing, and shows it when it is seen', tookHidden && whileHidden === 0 && shown,
       `${whileHidden} redraws while hidden, shown once seen: ${shown}`);
    await B.evaluate(() => { goHome(); });
    await until(B, () => S.screen === 'home' && !!document.querySelector('.hero-h1'));
  }

  head('a note being edited is not lost when the other window deletes it');
  {
    /* The editor holds the note's id. The record the window takes has no such note any more, and saving would find nothing to update. */
    const id = await A.evaluate(() => refAdd('Zq doomed note', 'Body of a note that is about to be deleted.', 'zq', '').id);
    await until(B, id => REF.some(r => r.id === id), id);
    await B.evaluate(() => { goRefs(); });
    await until(B, () => S.screen === 'refs' && !!document.getElementById('refT'));
    await B.evaluate(id => { refEdit(id); }, id);
    const editing = await until(B, id => refEditing === id && document.getElementById('refT').value === 'Zq doomed note', id);
    await A.evaluate(id => { refDelete(id); }, id);
    const gone = await until(B, id => !REF.some(r => r.id === id), id);
    await B.evaluate(() => {
      document.getElementById('refT').value = 'Zq doomed note, edited';
      document.getElementById('refB').value = 'Body typed after the other window deleted the note.';
      refSave();
    });
    const after = await B.evaluate(id => ({ kept: REF.filter(r => r.title === 'Zq doomed note, edited' && r.body === 'Body typed after the other window deleted the note.').length,
                                            back: REF.some(r => r.id === id), editing: refEditing,
                                            stored: JSON.parse(localStorage.getItem('accsap12.ref')).filter(r => r.title === 'Zq doomed note, edited').length }), id);
    const inA = await until(A, () => REF.some(r => r.title === 'Zq doomed note, edited'));
    ok('a note edited here that the other window deleted is kept as a note of its own, and the deleted one does not come back',
       editing && gone && after.kept === 1 && after.stored === 1 && !after.back && after.editing === null && inA,
       editing && gone ? `${after.kept} kept, ${after.stored} stored, the deleted note ${after.back ? 'back' : 'not back'}, in the other window: ${inA}` : `arranged: editing ${editing}, deleted in the other ${gone}`);
  }

  head('a write made while a window starts is taken, not marked as seen');
  {
    /* A window reads the records to build its state, and starts listening further down its script. A write by another window in between is in
       neither the state nor the listener: noting what had been seen by reading the storage a second time would call it seen, and the window would
       keep its older state until the next write. The write is made here in the page itself, straight after the read that built the state (whose
       it is does not matter to the page, and a storage event is not sent to the page that wrote). The page that starts is a third one. */
    const rec = await stored(A);
    const newerTotal = rec.sessionTotal + 5;
    const newerProgress = JSON.stringify(Object.assign({}, rec, { sessionTotal: newerTotal }));
    const newerNotes = await A.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('accsap12.ref')).concat([{ id: 'zq-launch', title: 'Zq written while the other window started', tags: 'zq', body: 'A note.', ts: Date.now(), source: 'user' }])));
    const C = watch(await ctx.newPage(), events, 'C', errors);
    /* The record is read first by the few lines that adopt the saved theme before anything paints, and the notes are read once. The write is made
       after the read that builds the state: load() for the record, and the loader of the notes. */
    await C.addInitScript(([progressKey, notesKey, progress, notes]) => {
      const read = Storage.prototype.getItem, write = Storage.prototype.setItem;
      const after = { [progressKey]: { text: progress, by: /(^|[^\w$])load([^\w$]|$)/ }, [notesKey]: { text: notes, by: /loadSeen|lsGet/ } };
      window.__first = {};
      Storage.prototype.getItem = function (k) {
        const v = read.call(this, k);
        if (this === window.localStorage && Object.prototype.hasOwnProperty.call(after, k) && !(k in window.__first)) {
          const stack = (new Error().stack || '');
          if (after[k].by.test(stack)) { window.__first[k] = stack.split('\n').slice(1, 4).join(' | ').slice(0, 240); write.call(this, k, after[k].text); }
        }
        return v;
      };
    }, ['accsap12.v2', 'accsap12.ref', newerProgress, newerNotes]);
    await C.goto(base, { waitUntil: 'load', timeout: 200000 });
    await booted(C, { timeout: 150000 });
    const first = await C.evaluate(() => window.__first);
    const took = await until(C, ([total, id]) => S.sessionTotal === total && REF.some(r => r.id === id), [newerTotal, 'zq-launch'], 6000);
    const now = await C.evaluate(() => ({ total: S.sessionTotal, note: REF.some(r => r.id === 'zq-launch') }));
    ok('a record written right after the window read it to start is taken when it has started, and so are the notes',
       !!first['accsap12.v2'] && !!first['accsap12.ref'] && took && now.total === newerTotal && now.note,
       `${now.total} answered (written: ${newerTotal}), the note ${now.note ? 'there' : 'missing'}; first reads: ${JSON.stringify(first)}`);
    await C.close();
  }

  head('nothing throws');
  ok('no page errors in either window', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  if (server.closeAllConnections) server.closeAllConnections();
  server.close();
  console.log(`\n${passed} passed, ${failed} failed` + (unmeasured ? `, ${unmeasured} not measurable` : ''));
  process.exit(failed ? 1 : 0);
})();
