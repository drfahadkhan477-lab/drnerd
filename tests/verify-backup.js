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
 * Restored progress must survive an ordinary action before the next boot.
 * Reference figures must survive restoration in an independent storage context.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');
const { onDeath, watch } = require('./_deathnote.js');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-backup.js <patched.html|url>'); process.exit(1); }
const URL = /^https?:\/\//.test(target) ? target : 'file://' + path.resolve(target);

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
let section = '';
const head = t => { section = t; console.log('\n── ' + t + ' ──'); };

const boot = async page => {
  await page.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await page.waitForFunction(() => typeof S !== 'undefined' && typeof Store !== 'undefined' &&
    typeof importMarkup === 'function', null, { timeout: 120000 });
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
  /* The page errors were only ever asserted on, live. Kept — an error here is
     still a failure the moment it happens — but also collected, because a
     suite that dies never gets to print the assertion it was building towards.
     See tests/_deathnote.js. */
  const events = [], errors = [];
  onDeath(() => ({ section, checks: passed + failed, errors,
                   events: events.length ? events.join(', ') : 'none' }));
  const page = watch(await browser.newPage(), events);
  page.on('pageerror', e => { errors.push(e.message); ok('no uncaught page error', false, e.message); });
  await boot(page);

  head('a well-formed backup is restored — live view and store together');

  const BACKUP = {
    ink: { 'BKUP_1:0': [{ x: 1, y: 2 }] },
    notes: { BKUP_1: [{ id: 'n1', x: 5, y: 6, text: 'restored note', color: '#f00' }] },
    refs: [{ id: 'r1', title: 'Restored reference', tags: [], body: 'body text', ts: Date.now(), source: 'backup' }],
    log: [{ id: 'BKUP_1', ts: Date.now(), correct: true }],
    chat: { _general: [{ err: false, content: 'restored assistant reply' }] },
    stats: { chStats: { Arrhythmias: { seen: 3 } }, sessionCorrect:37,sessionTotal:41,
      missed:['BKUP_1'],srs:{BKUP_1:{reps:3,due:'2026-11-01',stability:4,difficulty:5}},
      futurePreference:{keep:true} },
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
  const progress = await page.evaluate(() => {
    const live={correct:S.sessionCorrect,total:S.sessionTotal,missed:S.missed.has('BKUP_1'),reps:S.srs.BKUP_1.reps};
    setTheme('midnight'); return {live,saved:JSON.parse(localStorage.getItem('accsap12.v2'))};
  });
  ok('restored statistics and missed cards are live before another action', progress.live.correct===37&&progress.live.total===41&&progress.live.missed&&progress.live.reps===3);
  ok('changing theme keeps restored progress and unknown schema fields', progress.saved.sessionCorrect===37&&progress.saved.srs.BKUP_1.reps===3&&progress.saved.futurePreference.keep);
  await page.reload();
  await page.waitForFunction(()=>typeof S!=='undefined'&&typeof Store!=='undefined');
  await page.evaluate(()=>Store.ready());
  ok('restored progress survives the action and reload', await page.evaluate(()=>S.sessionCorrect===37&&S.missed.has('BKUP_1')&&S.srs.BKUP_1.reps===3));

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

  await page.evaluate(async restoreFn=>{
    const restoreCall=new Function('return '+restoreFn)();
    await restoreCall(JSON.stringify({ink:{wouldReplace:true},stats:{missed:'invalid'}}));
  },restore);
  ok('invalid statistics are refused before any annotations change', await page.evaluate(()=>!INK.wouldReplace&&S.sessionCorrect===37));

  /* A record inside a statistics map is read field by field by the Progress
     screen and the scheduler (d.a in buildStats, S.srs[id].due in forecast7).
     A null one used to pass, be stored, and crash the Progress screen on this
     and every later launch. Each of these must be refused with the whole state
     as it was: the live statistics, the stored copy, and the annotations. */
  const statState = () => page.evaluate(() => JSON.stringify({
    S: { chStats: S.chStats, srs: S.srs, daily: S.daily, practice: S.practice, resume: S.resume },
    stored: localStorage.getItem('accsap12.v2'), ink: INK, notes: NOTES }));
  const nestedBefore = await statState();
  const badNested = {
    'a null day': { daily: { '2026-10-09': null } },
    'a day whose count is not a number': { daily: { '2026-10-09': { a: 'many', c: 0 } } },
    'a day with no counts': { daily: { '2026-10-09': {} } },
    'a null card': { srs: { BKUP_1: null } },
    'a card whose due date is not a date string': { srs: { BKUP_1: { due: 5 } } },
    'a null chapter': { chStats: { Arrhythmias: null } },
    'a chapter count that is negative': { chStats: { Arrhythmias: { correct: -1, total: 2 } } },
    'a null practice record': { practice: { BKUP_1: null } },
    'a null resume record': { resume: { all: null } },
    'a resume record whose ids are not a list': { resume: { all: { ids: 'BKUP_1', i: 1 } } },
  };
  for (const [what, stats] of Object.entries(badNested)) {
    const toast = await page.evaluate(async ({ fn, text }) => {
      const t = document.getElementById('toast'); if (t) t.textContent = '';
      await (new Function('return ' + fn))()(text);
      return (document.getElementById('toast') || {}).textContent || '';
    }, { fn: restore, text: JSON.stringify({ v: 5, ink: { wouldReplace: true }, stats }) });
    ok('a backup with ' + what + ' is refused', toast === 'That file could not be read.', JSON.stringify(toast));
    ok('and changes nothing', await statState() === nestedBefore);
    const built = await page.evaluate(() => { try { buildStats(); forecast7(); return true; } catch (e) { return e.message; } });
    ok('and the Progress screen still builds', built === true, String(built));
  }

  /* The valid round trip: a whole day record is restored and read. */
  const dayToast = await page.evaluate(async ({ fn, text }) => {
    const t = document.getElementById('toast'); if (t) t.textContent = '';
    await (new Function('return ' + fn))()(text);
    return (document.getElementById('toast') || {}).textContent || '';
  }, { fn: restore, text: JSON.stringify({ v: 5, stats: { daily: { '2026-10-09': { a: 7, c: 5, r: 2 } },
    srs: { BKUP_1: { reps: 3, due: '2026-11-01', stability: 4, difficulty: 5 } } } }) });
  ok('a backup with a well-formed day record is restored', dayToast === 'Annotations restored.', JSON.stringify(dayToast));
  ok('and the Progress screen reads it', await page.evaluate(() => {
    try { buildStats(); forecast7(); } catch (e) { return e.message; }
    return S.daily['2026-10-09'].a === 7 && JSON.parse(localStorage.getItem('accsap12.v2')).daily['2026-10-09'].c === 5;
  }) === true);

  head('reference images survive a backup on a different device');
  const exported=await page.evaluate(async()=>{
    const raw=atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXGQAAAAASUVORK5CYII=');
    const key=RefAssets.add(Uint8Array.from(raw,c=>c.charCodeAt(0)),'synthetic.png'); await RefAssets.flush();
    REF=[{id:'synthetic-image-note',title:'Synthetic reference',body:'![Synthetic](refimg://'+key+')',tags:[],ts:Date.now()}];
    saveJSON('accsap12.ref',REF);
    const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;let blob;
    URL.createObjectURL=b=>{blob=b;return 'blob:stub';};HTMLAnchorElement.prototype.click=()=>{};
    try{await exportMarkup();}finally{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click;}
    return {key,value:RefAssets.get(key),text:await blob.text()};
  });
  const envelope=JSON.parse(exported.text);
  ok('version 6 exports the cited imported image bytes',envelope.v===6&&envelope.assets[exported.key]===exported.value);
  const context=await browser.newContext(),other=await context.newPage(); await boot(other);
  await other.evaluate(async({fn,text})=>{await(new Function('return '+fn)())(text);},{fn:restore,text:exported.text});
  ok('a new storage context restores the image and its citation',await other.evaluate(({key,value})=>RefAssets.get(key)===value&&REF[0].body.includes(key),exported));
  await other.reload();
  await other.waitForFunction(()=>typeof RefAssets!=='undefined');
  await other.evaluate(()=>RefAssets.ready());
  ok('restored image bytes survive reload',await other.evaluate(({key,value})=>RefAssets.get(key)===value,exported));
  await context.close();

  /* A version 5 backup restored on a new device brings citations without their
     images. Export used to refuse from then on, ink and progress with it. */
  head('an image the notes cite but this device lacks does not stop the export');
  const partial=await page.evaluate(async()=>{
    const raw=atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXGQAAAAASUVORK5CYII=');
    const kept=RefAssets.add(Uint8Array.from(raw,c=>c.charCodeAt(0)),'synthetic.png'); await RefAssets.flush();
    const lost='u/'+RefAssets.hashBytes(new Uint8Array([1,2,3]))+'.png';
    REF=[{id:'synthetic-missing-image',title:'Synthetic reference',body:'![a](refimg://'+kept+') ![b](refimg://'+lost+')',tags:[],ts:Date.now()}];
    saveJSON('accsap12.ref',REF);
    INK={'synthetic-ink':{strokes:[]}};
    const t=document.getElementById('toast'); if(t) t.textContent='';
    const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;let blob=null;
    URL.createObjectURL=b=>{blob=b;return 'blob:stub';};HTMLAnchorElement.prototype.click=()=>{};
    let result;try{result=await exportMarkup();}finally{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click;}
    return {kept,lost,result,text:blob?await blob.text():null,toast:(document.getElementById('toast')||{}).textContent||''};
  });
  const partialEnv=partial.text?JSON.parse(partial.text):null;
  ok('the backup is still written',partial.result===true&&!!partialEnv,JSON.stringify(partial.toast));
  ok('with the ink and the image that is here, and without the one that is not',
     !!partialEnv&&!!partialEnv.ink['synthetic-ink']&&!!partialEnv.assets[partial.kept]&&!(partial.lost in partialEnv.assets));
  ok('and the user is told an image was left out',/without 1 image/.test(partial.toast),JSON.stringify(partial.toast));

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
