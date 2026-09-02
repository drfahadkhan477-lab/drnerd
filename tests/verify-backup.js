#!/usr/bin/env node
/*
 * Behavioural checks for restoring an annotations backup.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-backup.js <patched.html|url>
 *
 * importMarkup() has its own inline warning about the bug class this suite
 * exists to catch: "Every other line here updates the live variable as well
 * as the store; this one only wrote, so a restored backup's conversations
 * did not appear until the app was next launched." That was a real, shipped
 * bug, fixed once by hand. Nothing kept it fixed — there was no test driving
 * a real restore and checking both places restored data has to land: the
 * live variable render() reads from right now, and the store a reload reads
 * from later. This suite drives the real importer with a real File, the way
 * verify-assets.js already does for the chapter importer, and checks both.
 *
 * Two things are intentionally not asserted as "live-updated": S.srs and the
 * rest of the accsap12.v2 statistics blob. Both are documented (see the
 * comment above fsrsSeed()) as restored to the store only, and re-read into
 * S on the next boot — not synchronously, because S is a snapshot taken once
 * at load() time, not a live view of the store. Asserting a live update
 * there would be testing for behaviour the app was never meant to have.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-backup.js <patched.html|url>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const boot = async page => {
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && typeof Store !== 'undefined' &&
    typeof importMarkup === 'function', { timeout: 120000 });
  await page.evaluate(() => Store.ready());
  await page.waitForTimeout(250);
};

/* Drives the real importer with a real File, exactly as verify-assets.js
   does for the chapter importer — importMarkup() creates its own <input>
   and never hands it back, so the only way to reach it without reimplementing
   the restore logic is to intercept document.createElement for the moment
   it runs. importMarkup()'s onchange is not async (it uses FileReader's
   callback style, not a Promise), so callers wait on the toast appearing
   rather than on the handler returning. */
const restore = `(text) => new Promise(resolve => {
  const file = new File([text], 'backup.json', { type: 'application/json' });
  const orig = document.createElement;
  let input = null;
  document.createElement = function (tag) {
    const el = orig.call(document, tag);
    if (tag === 'input') { input = el; el.click = () => {}; }
    return el;
  };
  importMarkup();
  document.createElement = orig;
  const dt = new DataTransfer();
  dt.items.add(file);
  Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
  const t = document.getElementById('toast');
  const before = t ? t.textContent : null;
  input.onchange();
  const t0 = Date.now();
  (function poll() {
    const now = document.getElementById('toast');
    if ((now && now.textContent !== before) || Date.now() - t0 > 5000) return resolve();
    setTimeout(poll, 25);
  })();
})`;

(async () => {
  const browser = await launch();
  const page = await browser.newPage();
  page.on('pageerror', e => ok('no uncaught page error', false, e.message));
  await boot(page);

  head('a well-formed backup is restored — live view and store together');

  const BACKUP = {
    ink: { 'BKUP_1:0': [{ x: 1, y: 2 }] },
    notes: { BKUP_1: [{ id: 'n1', x: 5, y: 6, text: 'restored note', color: '#f00' }] },
    refs: [{ id: 'r1', title: 'Restored reference', tags: [], body: 'body text', ts: Date.now(), source: 'backup' }],
    log: [{ id: 'BKUP_1', ts: Date.now(), correct: true }],
    chat: { _general: [{ err: false, content: 'restored assistant reply' }] },
    stats: { chStats: { Arrhythmias: { seen: 3 } }, srs: {} },
    mem: [{ id: 'm1', text: 'the fellow prefers terse explanations', kind: 'fact', created: Date.now(), seq: 1 }],
  };

  const r1 = await page.evaluate(
    async ({ restoreFn, backup }) => {
      const restoreCall = new Function('return ' + restoreFn)();
      await restoreCall(JSON.stringify(backup));
      return {
        toast: (document.getElementById('toast') || {}).textContent || '',
        liveInk: JSON.parse(JSON.stringify(INK)),
        liveNotes: JSON.parse(JSON.stringify(NOTES)),
        liveRef: (typeof REF !== 'undefined') ? JSON.parse(JSON.stringify(REF)) : null,
        liveLog: JSON.parse(JSON.stringify(LOG)),
        liveChats: JSON.parse(JSON.stringify(CHATS)),
        liveMem: (typeof Memory !== 'undefined') ? Memory.all() : null,
        storeInk: await Store.get('accsap12.ink', null),
        storeNotes: await Store.get('accsap12.notes', null),
        storeRef: await Store.get('accsap12.ref', null),
        storeLog: await Store.get('accsap12.log', null),
        storeChat: await Store.get('accsap12.chat', null),
        storeStats: await Store.get('accsap12.v2', null),
        storeMem: await Store.get('accsap12.mem', null),
      };
    },
    { restoreFn: restore, backup: BACKUP }
  );

  ok('the success toast is shown', r1.toast === 'Annotations restored.', JSON.stringify(r1.toast));

  ok('ink is live-updated', JSON.stringify(r1.liveInk) === JSON.stringify(BACKUP.ink), JSON.stringify(r1.liveInk));
  ok('and ink is persisted to the store', JSON.stringify(r1.storeInk) === JSON.stringify(BACKUP.ink));

  ok('notes are live-updated', JSON.stringify(r1.liveNotes) === JSON.stringify(BACKUP.notes));
  ok('and notes are persisted to the store', JSON.stringify(r1.storeNotes) === JSON.stringify(BACKUP.notes));

  if (r1.liveRef !== null) {
    ok('references are live-updated', JSON.stringify(r1.liveRef) === JSON.stringify(BACKUP.refs));
    ok('and references are persisted to the store', JSON.stringify(r1.storeRef) === JSON.stringify(BACKUP.refs));
  } else {
    console.log('  (REF not defined on this build — skipping the two reference checks)');
  }

  ok('the review log is live-updated', JSON.stringify(r1.liveLog) === JSON.stringify(BACKUP.log));
  ok('and the review log is persisted to the store', JSON.stringify(r1.storeLog) === JSON.stringify(BACKUP.log));

  ok('chat threads are live-updated — the bug the importer\'s own comment warns about',
     JSON.stringify(r1.liveChats) === JSON.stringify(BACKUP.chat), JSON.stringify(r1.liveChats));
  ok('and chat threads are persisted to the store', JSON.stringify(r1.storeChat) === JSON.stringify(BACKUP.chat));

  ok('statistics are persisted to the store', JSON.stringify(r1.storeStats) === JSON.stringify(BACKUP.stats));

  if (r1.liveMem !== null) {
    ok('memory is live-updated via Memory.replaceAll, not store-only',
       r1.liveMem.length === 1 && r1.liveMem[0].text === BACKUP.mem[0].text, JSON.stringify(r1.liveMem));
    ok('and memory is persisted to the store', JSON.stringify(r1.storeMem) === JSON.stringify(BACKUP.mem));
  } else {
    console.log('  (Memory not defined on this build — skipping the two memory checks)');
  }

  head('a malformed file is refused, cleanly, and mutates nothing');

  const before = await page.evaluate(() => ({
    ink: JSON.parse(JSON.stringify(INK)),
    notes: JSON.parse(JSON.stringify(NOTES)),
    log: JSON.parse(JSON.stringify(LOG)),
    chats: JSON.parse(JSON.stringify(CHATS)),
  }));

  const r2 = await page.evaluate(
    async ({ restoreFn }) => {
      const restoreCall = new Function('return ' + restoreFn)();
      await restoreCall('{not valid json');
      return {
        toast: (document.getElementById('toast') || {}).textContent || '',
        ink: JSON.parse(JSON.stringify(INK)),
        notes: JSON.parse(JSON.stringify(NOTES)),
        log: JSON.parse(JSON.stringify(LOG)),
        chats: JSON.parse(JSON.stringify(CHATS)),
      };
    },
    { restoreFn: restore }
  );

  ok('the failure toast is shown for a file that will not parse',
     r2.toast === 'That file could not be read.', JSON.stringify(r2.toast));
  ok('ink is untouched by a failed restore', JSON.stringify(r2.ink) === JSON.stringify(before.ink));
  ok('notes are untouched by a failed restore', JSON.stringify(r2.notes) === JSON.stringify(before.notes));
  ok('the log is untouched by a failed restore', JSON.stringify(r2.log) === JSON.stringify(before.log));
  ok('chats are untouched by a failed restore', JSON.stringify(r2.chats) === JSON.stringify(before.chats));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
