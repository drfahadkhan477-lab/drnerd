#!/usr/bin/env node
'use strict';
/*
 * The code-only deploy, in a real browser: build-pwa.js --no-content's own
 * loader, run on a page, importing a package through the actual file picker
 * into the actual IndexedDB, then launching on what it stored.
 *
 *   node tests/verify-bankstore.js [ignored]
 *
 * Needs a browser, not a build: the loader is lifted out of
 * scripts/build-pwa.js as text — the same bytes the build writes into
 * index.html — with its placeholders filled the way the build fills them, and
 * served from a routed origin next to a stand-in app.js. The package is made
 * by tools/pack-content.js from invented questions. Nothing licensed.
 *
 * WHAT IT HOLDS THE DEPLOY TO:
 *   · with nothing imported, the import screen shows and content/ is never
 *     requested — the whole point is that the host has none;
 *   · a package the checker refuses changes nothing, and says so in counts;
 *   · a good package is stored, and the next launch runs the app on it, its
 *     figures as blob: URLs that fetch back byte for byte;
 *   · an import interrupted mid-transaction leaves the previous bank active;
 *     a new import replaces the old one whole, old figures included;
 *   · and a NORMAL build's loader is untouched: it fetches content/ as ever,
 *     and a missing bank is still the "could not load" splash, not an import.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch } = require('./_engine.js');
const { onDeath, watch } = require('./_deathnote.js');
const { pack } = require('../tools/pack-content.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* The loader, exactly as build-pwa.js holds it. It is a template literal with
   no interpolations, so evaluating it as one yields the bytes the build uses. */
function loaderText() {
  const src = read('scripts/build-pwa.js');
  const a = src.indexOf('const LOADER = `'), b = src.indexOf('</script>`;', a);
  if (a < 0 || b < 0) throw new Error('could not find const LOADER in build-pwa.js');
  const body = src.slice(a + 'const LOADER = `'.length, b + '</script>'.length);
  if (body.includes('${')) throw new Error('the loader grew an interpolation; lift it differently');
  return new Function('return `' + body + '`;')();
}
function page(noContent) {
  const mods = noContent ? '<script>\n' + ['zipread.js', 'bankpack.js', 'bankstore.js'].map(f => read('src/core/' + f)).join('\n') + '\n</script>\n' : '';
  return '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="splash"><span class="sp-word"></span><span class="sp-sub"></span></div>' + mods +
    loaderText().replace('__BUILD_ID__', 'B1').replace('__COMMIT__', 'c1').replace('__HEART_MESH__', '').replace('__NO_CONTENT__', noContent ? 'true' : 'false') +
    '</body></html>';
}
const APP = "var APP_BUILD_ID='B1'; window.__appRan = { q: ALL_Q.length, ids: ALL_Q.map(function(q){return q.id;}), imgs: IMGS, split: window.SPLIT_BUILD, bank: window.SYSTOLE_BANK || null };";

const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([20, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(8, 1)]);
const JPG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(8, 3)]);
function makePackage(tmp, name, questions, figs) {
  const c = path.join(tmp, name);
  fs.mkdirSync(path.join(c, 'figures'), { recursive: true });
  fs.writeFileSync(path.join(c, 'questions.json'), JSON.stringify(questions));
  fs.writeFileSync(path.join(c, 'manifest.json'), JSON.stringify({ sourceDigest: 'zz', questions: questions.length, figures: Object.keys(figs).length }));
  for (const [f, b] of Object.entries(figs)) fs.writeFileSync(path.join(c, 'figures', f), b);
  const out = path.join(tmp, name + '.zip');
  pack(c, out);
  return fs.readFileSync(out);
}

/* A wait is a precondition, never the claim: if what it waits for never
   comes, the checks after it report what is actually there. A timeout that
   killed the suite said only "did not report", never which claim broke. */
const settle = (pg, fn, arg) => pg.waitForFunction(fn, arg === undefined ? null : arg, { timeout: 15000 }).catch(() => null);

(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bankstore-'));
  const GOOD = makePackage(TMP, 'good', [
    { id: 'ZQ_1', ch: 'C', o: ['Zqa', 'Zqb'], ci: 1, img: 1, figs: ['ZQ_1_1.webp'] },
    { id: 'OAB_2', ch: 'Older ACC bank', o: [{ l: 'A', t: 'Zqx' }, { l: 'B', t: 'Zqy' }], ci: 0, img: 1, figs: ['OAB_2_1.jpg'] },
  ], { 'ZQ_1_1.webp': WEBP, 'OAB_2_1.jpg': JPG });
  const ONE = makePackage(TMP, 'one', [{ id: 'ZQ_9', ch: 'C', o: ['Zqa', 'Zqb'], ci: 0, img: 1, figs: ['ZQ_9_1.webp'] }], { 'ZQ_9_1.webp': WEBP });
  /* A package the packer refuses cannot be made WITH it, so the bad one is
     zipped by the same writer directly: the good files, one figure's bytes
     wrong for its name. */
  const BAD = (() => {
    const c = path.join(TMP, 'good');
    fs.writeFileSync(path.join(c, 'figures', 'OAB_2_1.jpg'), WEBP);
    const manifest = JSON.parse(fs.readFileSync(path.join(c, 'manifest.json'), 'utf8'));
    manifest.schemaVersion = 1;
    fs.writeFileSync(path.join(c, 'manifest.json'), JSON.stringify(manifest));
    return require('../scripts/build-memorizer.js').zipOf(c, ['manifest.json', 'questions.json', 'figures/OAB_2_1.jpg', 'figures/ZQ_1_1.webp']);
  })();

  let section = 'setup';
  const events = [], errors = [];
  onDeath(() => ({ section, checks: passed + failed, errors, events: events.length ? events.join(', ') : 'none' }));
  const browser = await launch();
  const contentHits = [];
  async function open(noContent, content) {
    const ctx = await browser.newContext();
    const pg = watch(await ctx.newPage(), events, noContent ? 'no-content' : 'normal', errors);
    await pg.route('http://bank.test/**', r => {
      const u = new URL(r.request().url());
      if (u.pathname.startsWith('/content/')) {
        contentHits.push(u.pathname);
        if (content && u.pathname === '/content/questions.json') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(content) });
        return r.fulfill({ status: 404, body: 'not here' });
      }
      if (u.pathname === '/app.js') return r.fulfill({ status: 200, contentType: 'text/javascript', body: APP });
      if (u.pathname === '/sw.js') return r.fulfill({ status: 404, body: '' });
      return r.fulfill({ status: 200, contentType: 'text/html', body: page(noContent) });
    });
    await pg.goto('http://bank.test/');
    return { ctx, pg };
  }

  section = 'nothing imported';
  head('nothing imported: the import screen, and content/ never asked for');
  const { ctx, pg } = await open(true);
  await settle(pg, () => document.getElementById('bankImport') || window.__appRan || /Could not/.test(document.querySelector('.sp-word').textContent));
  const first = await pg.evaluate(() => ({ dialog: !!document.getElementById('bankImport'), ran: !!window.__appRan,
    splashHidden: document.getElementById('splash').style.display === 'none' }));
  ok('the import screen is shown, over a hidden splash', first.dialog && first.splashHidden, JSON.stringify(first));
  ok('and the app is not started on nothing', !first.ran);
  ok('no request went to content/ at all', contentHits.length === 0, contentHits.join(','));

  section = 'refused package';
  head('a package the checker refuses changes nothing');
  const hasPicker = await pg.$('#bankFile');
  if (hasPicker) await pg.setInputFiles('#bankFile', { name: 'systole-content-v1.zip', mimeType: 'application/zip', buffer: BAD });
  await settle(pg, () => { const s = document.getElementById('bankStatus'); return s && /Not imported|Imported/.test(s.textContent); });
  const bad = await pg.evaluate(async () => { const s = document.getElementById('bankStatus');
    return { status: s ? s.textContent : '(no import screen)', stored: typeof BankStore === 'undefined' ? 'no store' : await BankStore.load() }; });
  ok('it says it was not imported, and why, in counts and names', /^Not imported: 1 problem\(s\)\. figures\/OAB_2_1\.jpg is not a jpg file/.test(bad.status), bad.status);
  ok('and nothing was stored', bad.stored === null);

  section = 'good package';
  head('a good package: stored, and the next launch runs on it');
  const nav = pg.waitForNavigation({ timeout: 15000 }).catch(() => null);
  if (hasPicker) await pg.setInputFiles('#bankFile', { name: 'systole-content-v1.zip', mimeType: 'application/zip', buffer: GOOD });
  const said = await pg.waitForFunction(() => { const s = document.getElementById('bankStatus'); return s && /Imported/.test(s.textContent) && s.textContent; }, null, { timeout: 15000 }).then(h => h.jsonValue()).catch(() => '');
  ok('it reports what it stored, in counts', /^Imported 2 questions and 2 figures/.test(said), said);
  await nav;
  await settle(pg, () => window.__appRan);
  const ran = await pg.evaluate(async () => {
    const r = window.__appRan || { q: 0, ids: [], imgs: {}, split: null, bank: null };
    const url = r.imgs.OAB_2 && r.imgs.OAB_2[0];
    const bytes = url ? Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())) : [];
    return { q: r.q, ids: r.ids, split: r.split, bank: r.bank, url: url || '', bytes, dialog: !!document.getElementById('bankImport') };
  });
  ok('the app starts on the imported bank', ran.q === 2 && ran.ids.join(',') === 'ZQ_1,OAB_2' && !ran.dialog, JSON.stringify({ q: ran.q, ids: ran.ids }));
  ok('its figures are blob: URLs that fetch back byte for byte', /^blob:/.test(ran.url) && Buffer.from(ran.bytes).equals(JPG), ran.url.slice(0, 20));
  ok('the offline downloader is told this is not the split build (nothing to download)', ran.split === false);
  ok('and the page can say where its bank came from, in counts', ran.bank && ran.bank.source === 'imported' && ran.bank.questions === 2 && ran.bank.figures === 2, JSON.stringify(ran.bank));
  ok('still no request to content/', contentHits.length === 0, contentHits.join(','));

  section = 'replacement';
  head('replacing a bank: whole or not at all');
  const swap = await pg.evaluate(async (one) => {
    if (typeof BankStore === 'undefined') return { interrupted: '', rawFigs: -1 };
    const zip = await ZipRead.read(new Uint8Array(one).buffer);
    const v = BankPack.validate(zip.files);
    let interrupted = '';
    try { await BankStore.save(v, { failAfterWrites: true }); } catch (e) { interrupted = String(e && e.message || e); }
    const afterFail = await BankStore.load({ makeURL: () => 'u' });
    await BankStore.save(v);
    const afterNew = await BankStore.load({ makeURL: () => 'u' });
    /* Every figure in the store, whatever generation — load() only ever reads
       the active one, so orphans would be invisible through it. */
    const rawFigs = await new Promise((res, rej) => { const r = indexedDB.open(BankStore.DB); r.onsuccess = () => {
      const q = r.result.transaction('figs').objectStore('figs').count(); q.onsuccess = () => { res(q.result); r.result.close(); }; q.onerror = rej; }; r.onerror = rej; });
    return { rawFigs, interrupted, failQ: afterFail && afterFail.questions.length, failF: afterFail && afterFail.figures,
             newIds: afterNew && afterNew.questions.map(q => q.id), newF: afterNew && afterNew.figures };
  }, Array.from(ONE));
  ok('an import interrupted mid-transaction throws', swap.interrupted.length > 0, swap.interrupted);
  ok('and leaves the previous bank active, all of it', swap.failQ === 2 && swap.failF === 2, `${swap.failQ} questions, ${swap.failF} figures`);
  ok('a completed import replaces it whole — the old figures go with it, none left in the store', swap.newIds && swap.newIds.join(',') === 'ZQ_9' && swap.newF === 1 && swap.rawFigs === 1,
     `${swap.newIds} · ${swap.newF} active figure(s), ${swap.rawFigs} in the store`);
  await ctx.close();

  section = 'normal build';
  head('a normal build\'s loader is exactly as it was');
  contentHits.length = 0;
  const n1 = await open(false, [{ id: 'ZQ_5', ch: 'C', o: ['a', 'b'], ci: 0, img: 0 }]);
  await settle(n1.pg, () => window.__appRan || document.getElementById('bankImport'));
  const norm = await n1.pg.evaluate(() => ({ q: window.__appRan ? window.__appRan.q : 0, split: window.__appRan ? window.__appRan.split : null, dialog: !!document.getElementById('bankImport'), store: typeof BankStore }));
  ok('it fetches content/questions.json and starts the app on it', norm.q === 1 && contentHits.includes('/content/questions.json'), JSON.stringify(norm));
  ok('as the split build, with no import screen and no bank store in the page', norm.split === true && !norm.dialog && norm.store === 'undefined');
  await n1.ctx.close();
  const n2 = await open(false, null);
  await settle(n2.pg, () => /Could not load/.test(document.querySelector('.sp-word').textContent) || document.getElementById('bankImport'));
  const miss = await n2.pg.evaluate(() => ({ word: document.querySelector('.sp-word').textContent, sub: document.querySelector('.sp-sub').textContent, dialog: !!document.getElementById('bankImport') }));
  ok('and a missing bank is still the "could not load" splash, naming the 404 — not an import screen',
     miss.word === 'Could not load the question bank' && /404/.test(miss.sub) && !miss.dialog, miss.sub.slice(0, 60));
  await n2.ctx.close();

  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
