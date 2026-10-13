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
const { resolved } = require('./_render.js');

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
   it runs. The input's onchange does not return the asynchronous FileReader
   handler. Await that real handler instead of a toast change or a timer: both
   could finish the fixture before its image transaction had committed. */
const restore = `(text) => new Promise((resolve, reject) => {
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
  const read = FileReader.prototype.readAsText;
  FileReader.prototype.readAsText = function () {
    const loaded = this.onload;
    this.onload = function () {
      const reader = this, args = arguments;
      Promise.resolve().then(() => loaded.apply(reader, args)).then(resolve, reject);
    };
    const errored = this.onerror;
    this.onerror = function (event) {
      if (errored) errored.call(this, event);
      reject(this.error || new Error('The backup fixture could not be read.'));
    };
    return read.apply(this, arguments);
  };
  try { input.onchange(); }
  finally { FileReader.prototype.readAsText = read; }
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
    stats: { chStats: { Arrhythmias: { correct: 2, total: 3 } }, sessionCorrect:37,sessionTotal:41,
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
    'an impossible day': { daily: { '2026-02-30': { a: 1, c: 1 } } },
    'an impossible card due date': { srs: { BKUP_1: { due: '2026-99-99' } } },
    'an out-of-range resume index': { resume: { all: { ids: ['BKUP_1'], i: 4 } } },
    'resume answers that are not a map': { resume: { all: { ids: ['BKUP_1'], i: 0, answers: [] } } },
    'a null day': { daily: { '2026-10-09': null } },
    'a day whose count is not a number': { daily: { '2026-10-09': { a: 'many', c: 0 } } },
    'a day with no counts': { daily: { '2026-10-09': {} } },
    /* One case per required count, here and for chapters and practice below:
       an empty record is refused by whichever count is still required, so it
       cannot show that each one is. */
    'a day with answers but no correct count': { daily: { '2026-10-09': { a: 2 } } },
    'a day with a correct count but no answers': { daily: { '2026-10-09': { c: 1 } } },
    /* A correct answer is counted only as one of the answers, here and for
       chapters and practice: more correct than answered is a record the app
       never wrote (9 of 2 drew a Results row at 450%). */
    'a day with more correct answers than answers': { daily: { '2026-10-09': { a: 1, c: 2 } } },
    'a null card': { srs: { BKUP_1: null } },
    'a card whose due date is not a date string': { srs: { BKUP_1: { due: 5 } } },
    'a card whose last review is not a date string': { srs: { BKUP_1: { due: '2026-11-01', last: 12345 } } },
    'a null chapter': { chStats: { Arrhythmias: null } },
    /* A list has no entries for the entry rules to refuse: only the check
       that each map is an object stops it. */
    'a chapter map that is a list': { chStats: [] },
    'a chapter count that is negative': { chStats: { Arrhythmias: { correct: -1, total: 2 } } },
    /* Answering a question does st.total++ and st.correct++ on the stored
       record (selectOpt), and a practice drill does pr.n++ and pr.c++: a
       missing count turns into NaN, saved as null. A chapter with no total
       then drops off the Results screen's chapter list, and one with no
       correct count shows a wrong percentage there. Both counts are required,
       as a day's a and c are. */
    'a chapter with no counts': { chStats: { Arrhythmias: {} } },
    'a chapter with a total but no correct count': { chStats: { Arrhythmias: { total: 2 } } },
    'a chapter with a correct count but no total': { chStats: { Arrhythmias: { correct: 2 } } },
    'a chapter with more correct answers than answers': { chStats: { Arrhythmias: { correct: 3, total: 2 } } },
    'a null practice record': { practice: { BKUP_1: null } },
    'a practice record with no counts': { practice: { BKUP_1: { t: 1 } } },
    'a practice record with no attempt count': { practice: { BKUP_1: { c: 1, t: 1 } } },
    'a practice record with no correct count': { practice: { BKUP_1: { n: 2, t: 1 } } },
    'a practice record with more correct answers than attempts': { practice: { BKUP_1: { n: 1, c: 2, t: 1 } } },
    'a null resume record': { resume: { all: null } },
    'a resume record whose ids are not a list': { resume: { all: { ids: 'BKUP_1', i: 1 } } },
  };
  /* Restores a file through the real importer and returns the toast it left,
     cleared first so a repeat of the same message is still seen. */
  const importToast = text => page.evaluate(async ({ fn, text }) => {
    const t = document.getElementById('toast'); if (t) t.textContent = '';
    await (new Function('return ' + fn))()(text);
    return (document.getElementById('toast') || {}).textContent || '';
  }, { fn: restore, text });
  for (const [what, stats] of Object.entries(badNested)) {
    const toast = await importToast(JSON.stringify({ v: 5, ink: { wouldReplace: true }, stats }));
    ok('a backup with ' + what + ' is refused', toast === 'That file could not be read.', JSON.stringify(toast));
    ok('and changes nothing', await statState() === nestedBefore);
    const built = await page.evaluate(() => { try { buildStats(); forecast7(); return true; } catch (e) { return e.message; } });
    ok('and the Progress screen still builds', built === true, String(built));
  }

  /* The valid round trip: a whole day record is restored and read. It carries
     a perfect day, chapter and drill as well (correct equal to answered), the
     edge the more-correct-than-answered cases above must not refuse. */
  const dayToast = await importToast(JSON.stringify({ v: 5, stats: { daily: { '2026-10-09': { a: 7, c: 5, r: 2 },
      '2026-10-08': { a: 3, c: 3, r: 0 } },
    srs: { BKUP_1: { reps: 3, due: '2026-11-01', last: '2026-10-01', stability: 4, difficulty: 5 } },
    chStats: { Arrhythmias: { correct: 4, total: 5 }, 'Valvular Disease': { correct: 3, total: 3 } },
    practice: { BKUP_1: { n: 2, c: 1, t: 1 }, BKUP_2: { n: 2, c: 2, t: 1 } } } }));
  ok('a backup with a well-formed day record is restored', dayToast === 'Annotations restored.', JSON.stringify(dayToast));
  /* 4/5, not the 2/3 the first restore left: a refused import must not pass this. */
  ok('and a whole chapter and practice record are restored with it', await page.evaluate(() =>
    S.chStats.Arrhythmias.total === 5 && S.chStats.Arrhythmias.correct === 4 && (S.practice.BKUP_1 || {}).n === 2 && S.practice.BKUP_1.c === 1));
  ok('and so are a perfect day, chapter and practice record', await page.evaluate(() =>
    (S.daily['2026-10-08'] || {}).c === 3 && (S.chStats['Valvular Disease'] || {}).correct === 3 && (S.practice.BKUP_2 || {}).c === 2));
  ok('and the Progress screen reads it', await page.evaluate(() => {
    try { buildStats(); forecast7(); } catch (e) { return e.message; }
    /* Guarded, so a refused round trip fails here rather than killing the
       suite before the sections below it run. */
    const stored = (JSON.parse(localStorage.getItem('accsap12.v2')) || {}).daily || {};
    return (S.daily['2026-10-09'] || {}).a === 7 && (stored['2026-10-09'] || {}).c === 5;
  }) === true);

  /* A device that took a partial record from a backup before the import
     checked for one still holds it, and its export carried it, so its own
     backup was refused whole, ink and notes with it. Seeded where such a
     device keeps it, in the stored blob a launch reads: a chapter with a total
     but no correct count, a drill with no counts, a day with no correct count,
     and the {correct:7,total:1} that a chapter with no total turns into. */
  head('a backup from a device holding records its import refuses still restores');
  const DEVICE = {
    chStats: { Arrhythmias: { correct: 6, total: 9 }, 'Valvular Disease': { total: 3 },
               'Vascular Disease': { correct: 7, total: 1 } },
    practice: { BKUP_1: { n: 3, c: 2, t: 1 }, BKUP_2: { t: 1 } },
    daily: { '2026-10-01': { a: 4, c: 3, r: 0 }, '2026-10-02': { a: 1 } },
    sessionCorrect: 11, sessionTotal: 13,
  };
  await page.evaluate(d => localStorage.setItem('accsap12.v2', JSON.stringify(d)), DEVICE);
  await boot(page);
  const dev = await page.evaluate(async () => {
    let refused = false;
    try { progressFromBackup(JSON.parse(localStorage.getItem('accsap12.v2'))); } catch (_) { refused = true; }
    const create = URL.createObjectURL, click = HTMLAnchorElement.prototype.click; let blob = null;
    URL.createObjectURL = b => { blob = b; return 'blob:stub'; }; HTMLAnchorElement.prototype.click = () => {};
    try { await exportMarkup(); } finally { URL.createObjectURL = create; HTMLAnchorElement.prototype.click = click; }
    return { refused, text: blob ? await blob.text() : null };
  });
  /* A precondition, not the claim: with no record the import refuses in the
     seed, everything below passes whether or not the export leaves any out. */
  ok('the device holds statistics its own import refuses', dev.refused);
  const devStats = dev.text ? JSON.parse(dev.text).stats || {} : {};
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok('the export leaves out exactly the records the import refuses',
     same(devStats.chStats, { Arrhythmias: DEVICE.chStats.Arrhythmias }) &&
     same(devStats.practice, { BKUP_1: DEVICE.practice.BKUP_1 }) &&
     same(devStats.daily, { '2026-10-01': DEVICE.daily['2026-10-01'] }) && devStats.sessionCorrect === 11,
     JSON.stringify(devStats.chStats));
  /* Emptied, so a restore that did not happen cannot pass the ink check. */
  await page.evaluate(() => { INK = {}; });
  const devToast = await importToast(dev.text || '');
  ok('and that backup restores', devToast === 'Annotations restored.', JSON.stringify(devToast));
  /* left is for the report only. This failed once in a loaded run, not
     explained, and its line did not say which part. */
  const devLeft = await page.evaluate(() => ({ ok:
    (S.chStats.Arrhythmias || {}).total === 9 && !('Valvular Disease' in S.chStats) && !('Vascular Disease' in S.chStats) &&
    (S.practice.BKUP_1 || {}).n === 3 && !('BKUP_2' in S.practice) &&
    (S.daily['2026-10-01'] || {}).a === 4 && !('2026-10-02' in S.daily) && !!INK['BKUP_1:0'],
    left: JSON.stringify({ chStats: S.chStats, practice: S.practice, daily: S.daily, ink: Object.keys(INK) }) }));
  ok('with its usable statistics and its annotations', devLeft.ok === true, devLeft.left);

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
  /* A restore can take longer than the helper's former five-second poll.
     Delay the real asset restore, then prove its bytes survive a reload.
     This holds completion, not the bytes or the persistence assertions. */
  await other.evaluate(()=>{
    const restore=RefAssets.restoreBackup;
    RefAssets.restoreBackup=async assets=>{
      await new Promise(resolve=>setTimeout(resolve,6000));
      return restore(assets);
    };
  });
  await other.evaluate(async({fn,text})=>{await(new Function('return '+fn)())(text);},{fn:restore,text:exported.text});
  ok('a new storage context restores the image and its citation',await other.evaluate(({key,value})=>RefAssets.get(key)===value&&REF[0].body.includes(key),exported));
  /* For the report only: how the image store's open ended on each page, and
     what the restore said, so a failure here says whether the images were
     ever stored. */
  const atRestore=await other.evaluate(()=>({open:RefAssets.openInfo(),toast:(document.getElementById('toast')||{}).textContent||''}));
  await other.reload();
  await other.waitForFunction(()=>typeof RefAssets!=='undefined');
  await other.evaluate(()=>RefAssets.ready());
  const afterReload=await other.evaluate(()=>RefAssets.openInfo());
  ok('restored image bytes survive reload',await other.evaluate(({key,value})=>RefAssets.get(key)===value,exported),
     JSON.stringify({atRestore,afterReload}));
  await context.close();

  /* AN OPEN THAT IS SLOW, NOT HUNG. The image store once gave its database
     4 s; on a loaded machine an open that was fine took longer, so the
     restored images were kept in memory only and were gone after a reload.
     Here every open of that database answers 5 s late. */
  head('an image store whose database answers 5 s late still keeps a restored image');
  {
    const slowContext=await browser.newContext(),slow=watch(await slowContext.newPage(),events,'idb-open-slow');
    /* The connection opens as usual; the image store hears of it 5 s later.
       __held records how long the answer was held once it was handed over. */
    await slow.addInitScript(()=>{
      const real=IDBFactory.prototype.open;
      IDBFactory.prototype.open=function(name){
        const req=real.apply(this,arguments);
        if(name!=='accsap12.assets') return req;
        let handler=null;
        Object.defineProperty(req,'onsuccess',{configurable:true,get(){return handler;},set(fn){handler=fn;}});
        req.addEventListener('success',ev=>{const at=Date.now();setTimeout(()=>{
          window.__held=Date.now()-at; if(handler)handler.call(req,ev);},5000);});
        return req;
      };
    });
    await boot(slow);
    await slow.evaluate(async({fn,text})=>{await(new Function('return '+fn)())(text);},{fn:restore,text:exported.text});
    const toast=await slow.evaluate(()=>(document.getElementById('toast')||{}).textContent||'');
    /* Waited for, because a store that gave up has finished the restore
       before the answer is handed over. */
    const held=await resolved(slow,()=>window.__held,null,{timeout:20000}).catch(()=>null);
    ok('(the database\'s answer really was held for 5 s)',typeof held==='number'&&held>=5000,String(held));
    const opened=await slow.evaluate(()=>RefAssets.openInfo());
    ok('the image store waited for that answer instead of giving up',opened.state==='open'&&opened.ms>=5000,JSON.stringify(opened));
    ok('and the restore says the images were saved',toast==='Annotations restored.',JSON.stringify(toast));
    await slow.reload();
    await slow.waitForFunction(()=>typeof RefAssets!=='undefined');
    await slow.evaluate(()=>RefAssets.ready());
    ok('the restored image survives a reload',await slow.evaluate(({key,value})=>RefAssets.get(key)===value,exported),
       JSON.stringify(await slow.evaluate(()=>RefAssets.openInfo())));
    await slowContext.close();
  }

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

  /* Export and Import both await Store.ready(). An indexedDB.open() that
     fires none of success, error or blocked used to keep that promise pending
     for ever: the buttons did nothing, and said nothing. Each case gets its own
     context, because the stub has to be in place before the modules first open. */
  /* hung: how long counts as for ever. 8 s unless a case says otherwise. */
  const STUB_EXPORT = `async (hung = 8000) => {
    const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;let blob=null;
    URL.createObjectURL=b=>{blob=b;return 'blob:stub';};HTMLAnchorElement.prototype.click=()=>{};
    const t=document.getElementById('toast'); if(t) t.textContent='';
    let result;
    try{ result=await Promise.race([exportMarkup(),new Promise(r=>setTimeout(()=>r('HUNG'),hung))]); }
    finally{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click;}
    return {result,text:blob?await blob.text():null,toast:(document.getElementById('toast')||{}).textContent||''};
  }`;

  head('a database whose open never answers: the app falls back, and Export still works');
  {
    const context = await browser.newContext();
    const p = watch(await context.newPage(), events, 'idb-open-hangs');
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(() => {
      const real = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (name) {
        if (name === 'accsap12.store' || name === 'accsap12.assets') return new EventTarget();  // never fires
        return real.apply(this, arguments);
      };
    });
    await p.goto(URL, { waitUntil: 'load', timeout: 200000 });
    await p.waitForFunction(() => typeof S !== 'undefined' && typeof Store !== 'undefined' &&
      typeof exportMarkup === 'function', null, { timeout: 120000 });
    const ready = await p.evaluate(() =>
      Promise.race([Store.ready(), new Promise(r => setTimeout(() => r('HUNG'), 15000))]));
    ok('Store.ready() settles, without a database', !!ready && ready.available === false, JSON.stringify(ready));
    await p.evaluate(() => { INK = { 'HANG:0': [{ p: [1] }] }; saveJSON(INK_KEY, INK); });
    ok('a write lands in localStorage', /HANG:0/.test(await p.evaluate(() => localStorage.getItem('accsap12.ink')) || ''));
    /* Export waits out the image store's own open timeout here, so for ever
       is that timeout plus the 4 s the old 8 s bound had over the old 4 s one. */
    const hung = await p.evaluate(() => RefAssets.OPEN_TIMEOUT_MS + 4000);
    const ex = await p.evaluate(async ({ fn, hung }) => (new Function('return ' + fn)())(hung), { fn: STUB_EXPORT, hung });
    ok('Export completes rather than waiting for ever', ex.result === true, JSON.stringify(ex.result) + ' within ' + hung + ' ms ' + ex.toast);
    ok('with the ink this session wrote', !!ex.text && !!JSON.parse(ex.text).ink['HANG:0']);
    ok('no page error', errs.length === 0, errs.slice(0, 2).join(' | '));
    await context.close();
  }

  head('a database that opens and then stops answering: Export and Import say so');
  {
    const context = await browser.newContext();
    const p = watch(await context.newPage(), events, 'idb-hydration-hangs');
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(() => {
      const real = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function (name) {
        if (name !== 'accsap12.store') return real.apply(this, arguments);
        const never = () => ({});                    // a request whose handlers never fire
        const db = { objectStoreNames: { contains: () => true }, createObjectStore() {}, close() {},
          transaction: () => ({ objectStore: () => ({ get: never, put: never, delete: never, openCursor: never }) }) };
        const req = { result: db };
        setTimeout(() => req.onsuccess && req.onsuccess(), 0);
        return req;
      };
      /* The wait Export and Import allow is long; run any timer of 10 s or
         more in 50 ms while a test holds it, and record what was asked for. */
      const st = window.setTimeout;
      window.__longWaits = null;
      window.setTimeout = function (fn, ms, ...a) {
        if (window.__longWaits && ms >= 10000) { window.__longWaits.push(ms); ms = 50; }
        return st.call(this, fn, ms, ...a);
      };
    });
    await p.goto(URL, { waitUntil: 'load', timeout: 200000 });
    await p.waitForFunction(() => typeof S !== 'undefined' && typeof Store !== 'undefined' &&
      typeof exportMarkup === 'function', null, { timeout: 120000 });
    ok('the stub holds hydration: Store.ready() has not settled after 5 s',
       await p.evaluate(() => Promise.race([Store.ready().then(() => 'settled'),
         new Promise(r => setTimeout(() => r('pending'), 5000))])) === 'pending');
    const ex = await p.evaluate(async fn => { window.__longWaits = [];
      try { return Object.assign(await (new Function('return ' + fn)())(), { waits: window.__longWaits }); }
      finally { window.__longWaits = null; } }, STUB_EXPORT);
    ok('Export gives up rather than waiting for ever', ex.result === false, JSON.stringify(ex.result));
    ok('writes no file', ex.text === null);
    ok('and says why', /not responding/i.test(ex.toast), JSON.stringify(ex.toast));
    ok('after a wait longer than the store\'s own open timeout, and under a minute',
       ex.waits.some(ms => ms > 4000 && ms <= 60000), ex.waits.join(', ') || 'no long wait was set');
    const im = await p.evaluate(async ({ fn, text }) => {
      INK = { 'BEFORE:0': [{ p: [2] }] };
      const t = document.getElementById('toast'); if (t) t.textContent = '';
      window.__longWaits = [];
      try { await (new Function('return ' + fn)())(text); } finally { window.__longWaits = null; }
      return { ink: Object.keys(INK), toast: (document.getElementById('toast') || {}).textContent || '' };
    }, { fn: restore, text: JSON.stringify({ v: 5, ink: { 'AFTER:0': [{ p: [3] }] } }) });
    ok('Import says why it restored nothing', /not responding/i.test(im.toast), JSON.stringify(im.toast));
    ok('and leaves the live ink as it was', im.ink.join() === 'BEFORE:0', im.ink.join());
    ok('no page error', errs.length === 0, errs.slice(0, 2).join(' | '));
    await context.close();
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
