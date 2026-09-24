#!/usr/bin/env node
/*
 * Memorizer, end to end in a real browser: a real PDF goes in, real pdf.js
 * reads it, and one section goes through encode → recall → teach-back with
 * the model stubbed at the network.
 *
 *   NODE_PATH=$(npm root -g) node tests/verify-memorizer.js
 *
 * Takes no build argument: it builds memorizer/ itself, into a temporary
 * directory, with scripts/build-memorizer.js — so what is tested is the one
 * file a user would open. The PDF is generated here, from nothing, so no
 * document of anyone's is involved.
 *
 * NEEDS THE NETWORK for one thing: pdf.js, which the app fetches from
 * jsDelivr with a pinned version and an integrity hash. The suite fetches
 * those bytes from jsDelivr itself (see the route below for why) and the page
 * still verifies them against its hashes. Offline, the import step fails.
 *
 * WHAT IS PROVEN, beyond the pure suites, is the glue those cannot see:
 *   · pdf.js's output reaches the chunker in the shape it expects — the real
 *     PDF becomes the sections it was written as, running header dropped;
 *   · the request for section 1 carries section 1 and nothing of section 2;
 *   · model text reaches the page as text, never as markup;
 *   · a failed step shows an error with a way out, and does not advance;
 *   · the session and its cards survive a reload.
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
const die = onDeath(() => ({ section, checks: passed + failed, errors, events }));

const ROOT = path.join(__dirname, '..');
const { build } = require(path.join(ROOT, 'scripts', 'build-memorizer.js'));

/* ── a real PDF, written by hand ──────────────────────────────────────────
   Three sections, each a 20pt heading over ~650 words of 11pt body, a 9pt
   running header on every page and a page number at the foot. Every body
   word is unique to its section (s1w0001, s2w0001 …), so "section 1's
   request contains nothing of section 2" is an exact check. */
function makePdf() {
  const pages = [];
  let cur = [], y = 760;
  const newPage = () => { if (cur.length) pages.push(cur); cur = []; y = 760; };
  const line = (text, size) => {
    if (y < 70) newPage();
    cur.push({ text, size, y });
    y -= size + 5;
  };
  /* A table row: each cell its own text run, at its column's x — which is
     how a PDF lays a table out, and what pdf.js hands back. */
  const row = (cells) => {
    if (y < 70) newPage();
    cur.push({ cells, size: 11, y });
    y -= 16;
  };
  const titles = ['Section One Preload', 'Section Two Afterload', 'Section Three Contractility'];
  /* Cause-and-effect sentences for the flowchart, in section 1. */
  const causal = ['Diuretics reduce preload by lowering circulating volume.',
    'Excessive preload raises venous pressure and causes pulmonary congestion.',
    'Rising venous pressure leads to oedema of the lungs.'];
  const table = [['Measure', 'Normal', 'Unit'], ['LVEDP', '12', 'mmHg'], ['Stroke volume', '70', 'mL'], ['Heart rate', '72', 'bpm']];
  /* Letter-coded (s1wab …), not numbered: a body line of numbered words
     normalises to the same text on every page, which is what a running
     header looks like. */
  const code = i => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(i / 26) % 26] + 'abcdefghijklmnopqrstuvwxyz'[i % 26];
  const PER = 320;
  let bodyWords = 0;
  titles.forEach((t, si) => {
    if (si) y -= 20;
    line(t, 20); bodyWords += t.split(' ').length;
    if (si === 0) causal.forEach(c => { line(c, 11); bodyWords += c.split(' ').length; });
    if (si === 0) y -= 12;
    const words = [];
    for (let i = 1; i <= PER; i++) words.push(`s${si + 1}w${code(i)}` + (i % 10 === 0 ? '.' : ''));
    for (let i = 0; i < words.length; i += 12) line(words.slice(i, i + 12).join(' '), 11);
    bodyWords += PER;
    if (si === 1) {
      y -= 12;
      table.forEach(r => { row(r.map((c, ci) => [72 + ci * 150, c])); bodyWords += r.join(' ').split(' ').length; });
      y -= 12;
    }
  });
  newPage();

  /* One picture, on page 1: a 2×2 RGB image drawn 200×100 at (300, 450). */
  const IMG_BOX = [300, 450, 500, 550];
  const objs = [];
  const add = s => { objs.push(s); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pixels = Buffer.from([200, 40, 40, 40, 200, 40, 40, 40, 200, 220, 220, 40]).toString('latin1');
  const image = add(`<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 12 >>\nstream\n${pixels}\nendstream`);
  const pagesId = objs.length + pages.length * 2 + 1; /* the object after every page and its content */
  const kids = [];
  const esc = t => String(t).replace(/([()\\])/g, '\\$1');
  pages.forEach((lines, pi) => {
    const ops = ['BT /F1 9 Tf 72 790 Td (Memorizer Test Unit) Tj ET'];
    lines.forEach(l => {
      if (l.cells) l.cells.forEach(([x, t]) => ops.push(`BT /F1 ${l.size} Tf ${x} ${l.y} Td (${esc(t)}) Tj ET`));
      else ops.push(`BT /F1 ${l.size} Tf 72 ${l.y} Td (${esc(l.text)}) Tj ET`);
    });
    ops.push(`BT /F1 9 Tf 300 30 Td (${pi + 1}) Tj ET`);
    if (pi === 0) ops.push(`q ${IMG_BOX[2] - IMG_BOX[0]} 0 0 ${IMG_BOX[3] - IMG_BOX[1]} ${IMG_BOX[0]} ${IMG_BOX[1]} cm /Im1 Do Q`);
    const stream = ops.join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    const xo = pi === 0 ? ` /XObject << /Im1 ${image} 0 R >>` : '';
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${font} 0 R >>${xo} >> /Contents ${content} 0 R >>`));
  });
  const realPages = add(`<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`);
  if (realPages !== pagesId) throw new Error(`PDF object numbering: pages object is ${realPages}, expected ${pagesId}`);
  const catalog = add(`<< /Type /Catalog /Pages ${realPages} 0 R >>`);
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { buffer: Buffer.from(out, 'latin1'), pages: pages.length, titles, bodyWords, table, causal, IMG_BOX,
           firstCode: code(1), lastCode: code(PER) };
}

/* ── the model, stubbed at the network ────────────────────────────────── */
const EVIL = '<img src=x onerror="window.__pwned=1">';
const stub = {
  requests: [],
  breakNextEncode: false,
  reply(kind) {
    switch (kind) {
      case 'encode': return { points: [{ text: 'Preload is end-diastolic stretch ' + EVIL, page: 1 }, { text: 'Second point', page: 2 }],
                              mnemonic: 'PRELOAD = Pull Really Early', flowchart: '' };
      case 'recall': return { prompts: [{ question: 'What is preload?', answer: 'End-diastolic stretch.', page: 1 },
                                        { question: 'Why does it matter?', answer: 'It sets stroke volume.', page: 2 }] };
      case 'gradeRecall': return this.requests.filter(r => r.kind === 'gradeRecall').length === 1
        ? { correct: true, missing: [], misconception: '', feedback: 'Right.' }
        : { correct: false, missing: ['stroke volume'], misconception: '', feedback: 'Missed the consequence.' };
      case 'gradeExplain': return { score: 55, gaps: [{ point: 'Preload sets stroke volume through Starling', page: 2 }], misconceptions: [], feedback: 'Say why.' };
      default: return null;
    }
  },
};
function kindOf(user) {
  if (/TASK:\nENCODE\./.test(user)) return 'encode';
  if (/TASK:\nRECALL\./.test(user)) return 'recall';
  if (/TASK:\nGRADE a free-recall/.test(user)) return 'gradeRecall';
  if (/TASK:\nGRADE a teach-back/.test(user)) return 'gradeExplain';
  if (/GAUNTLET\./.test(user)) return 'gauntlet';
  return 'unknown';
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memorizer-'));
  const built = build(dir);
  const pdf = makePdf();
  const browser = await launch();
  /* routablePage()'s context — no service worker, so page.route() sees
     every request — written out so the page is created inside watch(), which
     verify-engine requires of every browser suite. */
  const page = watch(await (await browser.newContext({ viewport: { width: 820, height: 1100 }, serviceWorkers: 'block' })).newPage(), events, '', errors);
  await page.addInitScript(() => {
    try { localStorage.setItem('memorizer.ai.v1', JSON.stringify({ provider: 'anthropic', model: 'claude-opus-5', key: 'sk-ant-stub' })); } catch (_) {}
  });
  /* jsDelivr is fetched from the Node side and handed to the page. Not to
     change what is served — the bytes are jsDelivr's own, and the page still
     checks them against its pinned integrity hashes — but because a
     sandboxed browser may not trust a TLS-intercepting proxy that Node does
     (NODE_EXTRA_CA_CERTS). Measured: in this repository's cloud sandbox the
     browser failed pdf.min.js with ERR_CERT_AUTHORITY_INVALID. */
  let cdnHits = 0;
  const wire = async page => {
  await page.route('https://cdn.jsdelivr.net/**', async route => {
    cdnHits++;
    const res = await fetch(route.request().url());
    const body = Buffer.from(await res.arrayBuffer());
    return route.fulfill({ status: res.status, body, headers: {
      'content-type': res.headers.get('content-type') || 'application/javascript',
      'access-control-allow-origin': '*' } });
  });
  /* The hook's handwriting face comes from Google Fonts, which this sandbox's
     browser cannot reach; the app falls back to the device's own script
     face either way, so the request is answered empty rather than left to
     fail into the death note. */
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://api.anthropic.com/**', async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    const user = (body.messages && body.messages[0] && body.messages[0].content) || '';
    const kind = kindOf(user);
    stub.requests.push({ kind, user, body, headers: route.request().headers() });
    if (kind === 'encode' && stub.breakNextEncode) {
      stub.breakNextEncode = false;
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"points": [ oops' }] }) });
    }
    const v = stub.reply(kind);
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(v) }] }) });
  });
  };
  await wire(page);
  const URL = 'file://' + path.join(dir, 'index.html');
  const T = { timeout: 60000 };

  head('the built file');
  ok('builds from memorizer/ with every module inlined', built.inlined.length >= 9, built.inlined.join(', '));
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  ok('and it is one file: no script or stylesheet it loads from the repository',
     !/<script src="(?!https:)/.test(html) && !/<link rel="stylesheet" href="(?!https:)/.test(html));
  await page.goto(URL);
  await page.locator('.drop').waitFor(T);
  ok('opens as a local file and shows the library', await page.locator('h1', { hasText: 'Master a whole unit' }).count() === 1);
  ok('with no errors on load', errors.length === 0, errors.join(' | '));

  head('a real PDF becomes the sections it was written as');
  await page.setInputFiles('#pdf-input', { name: 'unit.pdf', mimeType: 'application/pdf', buffer: pdf.buffer });
  await page.locator('li.doc').waitFor(T);
  const docText = await page.locator('li.doc').innerText();
  ok('the document is listed with its page count', docText.indexOf(pdf.pages + ' pages') !== -1, docText.replace(/\s+/g, ' ').slice(0, 80));
  ok('and three sections, one per heading', /\b3 sections\b/.test(docText), docText.replace(/\s+/g, ' ').slice(0, 80));
  const rec = await page.evaluate(() => MemStore.all('docs').then(d => d[0]));
  ok('each section is titled by its heading', JSON.stringify(rec.clusters.map(c => c.title)) === JSON.stringify(pdf.titles),
     rec.clusters.map(c => c.title).join(' | '));
  ok('each holds its own section\u2019s words and none of another\u2019s', rec.clusters.every((c, i) =>
     new RegExp('s' + (i + 1) + 'w' + pdf.firstCode).test(c.text) && ![1, 2, 3].filter(n => n !== i + 1).some(n => new RegExp('s' + n + 'w[a-z]').test(c.text))));
  ok('and every word of the PDF’s body is in one', rec.clusters.reduce((n, c) => n + c.words, 0) === pdf.bodyWords,
     String(rec.clusters.reduce((n, c) => n + c.words, 0)));
  ok('the running header on every page is gone', !rec.clusters.some(c => /Memorizer Test Unit/.test(c.text)));
  ok('no page is reported as scanned', rec.scanned.length === 0, JSON.stringify(rec.scanned));
  const tbl = rec.clusters[1].segments.find(g => g.table);
  ok('the table in section 2 is found, cell for cell', !!tbl && JSON.stringify(tbl.table) === JSON.stringify(pdf.table), tbl && JSON.stringify(tbl.table));
  ok('the picture on page 1 is found where it was drawn', rec.figures.length === 1 && rec.figures[0].page === 1 &&
     rec.figures[0].box.every((v, i) => Math.abs(v - pdf.IMG_BOX[i]) <= 1), JSON.stringify(rec.figures));
  ok('and the PDF itself is kept on the device, to draw them from', await page.evaluate(id => MemStore.get('files', id).then(f => !!f && f.bytes.byteLength > 1000), rec.id));
  ok('pdf.js and its worker came from the pinned CDN', cdnHits >= 2, `${cdnHits} requests`);

  head('encode: only this section leaves the device');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.locator('ul.bullets > li').first().waitFor(T);
  const enc = stub.requests.filter(r => r.kind === 'encode');
  ok('one encode request was made', enc.length === 1, String(enc.length));
  ok('it carries section 1’s words, with their pages', new RegExp('s1w' + pdf.firstCode + '\\b').test(enc[0].user) && new RegExp('s1w' + pdf.lastCode + '\\b').test(enc[0].user) && /\[p\.1\]/.test(enc[0].user));
  ok('and nothing of sections 2 or 3', !/s[23]w[a-z]/.test(enc[0].user));
  ok('with the grounding prohibition as its system prompt', /NOT_IN_PDF/.test(enc[0].body.system));
  ok('and the browser-access header Anthropic requires', enc[0].headers['anthropic-dangerous-direct-browser-access'] === 'true');
  const pointText = await page.locator('ul.bullets > li').first().innerText();
  ok('the points are shown', /end-diastolic stretch/.test(pointText));
  ok('model text is shown as text — the tag is visible, not run', pointText.indexOf('<img') !== -1 &&
     await page.locator('ul.bullets img').count() === 0 && await page.evaluate(() => window.__pwned) === undefined);
  ok('the mnemonic is shown', await page.locator('#hook', { hasText: 'Pull Really Early' }).count() === 1);
  ok('the points are bullets, a definition leading with its term',
     await page.locator('ul.bullets > li').count() === 2 && (await page.locator('ul.bullets > li .lead').first().innerText()) === 'Preload');
  /* The picture found at import is drawn from the stored PDF, cropped. */
  await page.waitForFunction(() => { const i = document.querySelector('#visuals .figs img'); return i && /^data:image\/png/.test(i.src) && i.naturalWidth > 0; }, null, T);
  const fig = await page.evaluate(() => { const i = document.querySelector('#visuals .figs img'); return { w: i.naturalWidth, h: i.naturalHeight }; });
  ok('the figure on page 1 is shown, cut from the page at its own shape', Math.abs(fig.w / fig.h - 2) < 0.1, `${fig.w}×${fig.h}`);
  await page.waitForFunction(() => [...document.querySelectorAll('#visuals .pages img')].every(i => /^data:image\/png/.test(i.src)) &&
    document.querySelectorAll('#visuals .pages img').length >= 1, null, T);
  ok('and every page of the section is there to open', (await page.locator('#visuals .pages img').count()) >= 1);
  await page.locator('#visuals .pages button').first().click();
  await page.locator('.lightbox img').waitFor(T);
  await page.waitForFunction(() => /^data:image/.test((document.querySelector('.lightbox img') || {}).src || ''), null, T);
  ok('a page opens large', await page.locator('.lightbox').count() === 1);
  await page.keyboard.press('Escape');
  ok('and Escape closes it', await page.locator('.lightbox').count() === 0);
  ok('and the step says it is Encode', (await page.locator('.stepper li.now').innerText()) === 'Encode');

  head('recall: graded, and a miss becomes a card');
  await page.locator('#to-recall').click();
  await page.locator('h2.q', { hasText: 'What is preload?' }).waitFor(T);
  ok('recall asks its first question', (await page.locator('.stepper li.now').innerText()) === 'Recall');
  await page.fill('textarea.answer', 'The stretch at end diastole');
  await page.locator('#submit-answer').click();
  await page.locator('.feedback.good').waitFor(T);
  ok('a correct answer is shown as correct', await page.locator('.feedback h2', { hasText: 'Correct' }).count() === 1);
  const g1 = stub.requests.filter(r => r.kind === 'gradeRecall')[0];
  ok('the student’s answer went out fenced as data', /<<<ANSWER\nThe stretch at end diastole\nANSWER>>>/.test(g1.user));
  await page.locator('#continue').click();
  await page.locator('h2.q', { hasText: 'Why does it matter?' }).waitFor(T);
  await page.fill('textarea.answer', 'no idea');
  await page.locator('#submit-answer').click();
  await page.locator('.feedback.bad').waitFor(T);
  ok('a wrong answer says it is now a review card', await page.locator('.feedback h2', { hasText: 'review card' }).count() === 1);
  /* Recorded on Continue, not before — so a grader's mistake can still be
     overruled from this screen. */
  ok('but the grade is not recorded until Continue', (await page.evaluate(() => MemStore.all('cards'))).length === 0);
  ok('and it can be overruled from here', await page.locator('#overrule').count() === 1);
  ok('and shows the model answer with its page', await page.locator('.feedback', { hasText: 'It sets stroke volume.' }).count() === 1);

  head('teach-back: scored, gaps become cards');
  await page.locator('#continue').click();
  await page.locator('h2', { hasText: 'Teach it back' }).waitFor(T);
  ok('the step is Teach back', (await page.locator('.stepper li.now').innerText()) === 'Teach back');
  await page.fill('textarea.answer', 'Preload is how full the ventricle is before it squeezes.');
  await page.locator('#submit-answer').click();
  await page.locator('.feedback .score').waitFor(T);
  ok('the score is shown', (await page.locator('.feedback .score strong').innerText()) === '55');
  ok('with the gap it found', await page.locator('.feedback li', { hasText: 'Starling' }).count() === 1);

  head('a failed step says so, and does not advance');
  stub.breakNextEncode = true;
  await page.locator('#continue').click();
  await page.locator('.card.error').waitFor(T);
  const cards = await page.evaluate(() => MemStore.all('cards'));
  ok('Continue recorded both misses as cards: the missed prompt and the gap', cards.length === 2 &&
     cards.some(c => c.source === 'recall' && c.front === 'Why does it matter?') && cards.some(c => c.source === 'explain'),
     cards.map(c => c.source + ':' + c.front).join(' | '));
  ok('the Review tab counts them as due', /Review · 2/.test(await page.locator('nav.top').innerText()));
  const errText = await page.locator('.card.error').innerText();
  ok('a garbled reply shows an error saying what was wrong', /not valid JSON|no JSON|did not match/.test(errText), errText.replace(/\s+/g, ' ').slice(0, 120));
  ok('it is on section 2, still at encode, with no points', await page.evaluate(() => {
    const s = Memorizer.ui.state; return s.cluster === 1 && s.phase === 'encode' && !s.per[1].points; }));
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.locator('ul.bullets > li').first().waitFor(T);
  ok('Try again re-asks and the section proceeds', await page.locator('.where .count', { hasText: 'Section 2 of 3' }).count() === 1);
  const enc2 = stub.requests.filter(r => r.kind === 'encode').slice(-1)[0];
  ok('section 2\u2019s table is drawn as a table', await page.locator('#tables table.data tbody tr').count() === 3 &&
     (await page.locator('#tables thead').innerText()).replace(/\s+/g, ' ').trim() === 'Measure Normal Unit');
  ok('the section-2 request sends the table to the model as rows', /TABLE:\n\| Measure \| Normal \| Unit \|/.test(stub.requests.filter(r => r.kind === 'encode').slice(-1)[0].user));
  ok('and the section-2 request carries section 2 only', new RegExp('s2w' + pdf.firstCode + '\\b').test(enc2.user) && !/s[13]w[a-z]/.test(enc2.user));

  head('a reload resumes where it stopped');
  await page.reload();
  await page.locator('li.doc').waitFor(T);
  ok('the library shows where the unit is', /Section 2 of 3/.test(await page.locator('li.doc').innerText()));
  const before = stub.requests.length;
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.locator('ul.bullets > li').first().waitFor(T);
  ok('continuing opens section 2 with its points, without asking the model again', stub.requests.length === before,
     `${stub.requests.length - before} new requests`);
  ok('the two cards survived the reload', (await page.evaluate(() => MemStore.all('cards'))).length === 2);

  head('review');
  await page.locator('nav.top').getByRole('button', { name: /Review/ }).click();
  await page.locator('#show-answer').waitFor(T);
  await page.locator('#show-answer').click();
  await page.getByRole('button', { name: 'Good' }).click();
  await page.waitForFunction(() => /Review · 1/.test(document.querySelector('nav.top').innerText), null, T);
  const after = await page.evaluate(() => MemStore.all('cards'));
  const todayInPage = await page.evaluate(() => FSRS.todayISO());
  ok('a Good rating schedules the card into the future with FSRS', after.filter(c => c.srs && c.srs.due > todayInPage).length === 1,
     after.map(c => c.srs ? c.srs.due : 'new').join(', '));

  head('fits a phone');
  await page.setViewportSize({ width: 375, height: 800 });
  await page.locator('nav.top').getByRole('button', { name: 'Library' }).click();
  await page.locator('li.doc').waitFor(T);
  const over = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
  ok('no horizontal scroll at 375 px', over <= 0, `${over}px over`);

  head('the built-in coach: no key, no AI, nothing sent');
  {
    /* A fresh browser profile with nothing saved — what a new user gets. */
    const p2 = watch(await (await browser.newContext({ viewport: { width: 820, height: 1100 }, serviceWorkers: 'block' })).newPage(), events, 'builtin', errors);
    await wire(p2);
    const aiBefore = stub.requests.length;
    await p2.goto(URL);
    await p2.locator('.drop').waitFor(T);
    ok('a new user is on the built-in coach, with no key asked for',
       /built-in coach/.test(await p2.locator('main').innerText()) && !/needs your API key/.test(await p2.locator('main').innerText()));
    await p2.setInputFiles('#pdf-input', { name: 'unit.pdf', mimeType: 'application/pdf', buffer: pdf.buffer });
    await p2.locator('li.doc').waitFor(T);
    await p2.getByRole('button', { name: 'Start', exact: true }).click();
    await p2.locator('ul.bullets > li').first().waitFor(T);
    const pts = await p2.evaluate(() => Memorizer.ui.state.per[0].points);
    const sec1 = (await p2.evaluate(() => MemStore.all('docs').then(d => d[0].clusters[0].text)));
    ok('encode shows key points taken verbatim from section 1', pts.length >= 1 && pts.every(x => sec1.indexOf(x.text) !== -1), `${pts.length} points`);
    await p2.locator('#flow').waitFor(T);
    const flowText = (await p2.locator('#flow').innerText()).replace(/\s+/g, ' ');
    ok('section 1 shows a flowchart built from its cause-and-effect sentences', /Diuretics/.test(flowText) && /reduce/.test(flowText) && /preload/.test(flowText) &&
       /oedema/i.test(flowText), flowText.slice(0, 140));
    ok('the hook is an acrostic of big letters', (await p2.locator('#hook .acrostic li').count()) >= 2);
    /* At a desktop width the hook sits beside the points. */
    await p2.setViewportSize({ width: 1280, height: 1100 });
    await p2.waitForFunction(() => !!document.querySelector('aside.study-aside #hook'), null, T);
    const cols = await p2.evaluate(() => { const m = document.querySelector('.study-main').getBoundingClientRect(), a = document.querySelector('.study-aside').getBoundingClientRect(); return { m: m.right, a: a.left, top: Math.abs(a.top - m.top) }; });
    ok('at desktop width the hook sits in a side panel, beside the points', cols.a > cols.m && cols.top < 40, JSON.stringify(cols));
    await p2.setViewportSize({ width: 820, height: 1100 });
    await p2.waitForFunction(() => !document.querySelector('aside.study-aside') && !!document.querySelector('#hook'), null, T);
    ok('and at tablet width it moves back under the points', await p2.evaluate(() => {
      const pts = document.querySelector('#points').getBoundingClientRect(), hk = document.querySelector('#hook').getBoundingClientRect(); return hk.top > pts.bottom - 1; }));
    await p2.locator('#to-recall').click();
    await p2.locator('h2.q').waitFor(T);
    const prompts = await p2.evaluate(() => Memorizer.ui.state.per[0].prompts);
    ok('recall asks fill-in-the-blank questions', prompts.length >= 1 && prompts.every(q => /_____/.test(q.question)), `${prompts.length} questions`);
    await p2.fill('textarea.answer', prompts[0].answer);
    await p2.locator('#submit-answer').click();
    await p2.locator('.feedback.good').waitFor(T);
    ok('the right word is marked correct', await p2.locator('.feedback h2', { hasText: 'Correct' }).count() === 1);
    await p2.locator('#continue').click();
    if (prompts.length > 1) {
      await p2.locator('h2.q', { hasText: prompts[1].question.slice(0, 40) }).waitFor(T);
      await p2.fill('textarea.answer', 'zzzz');
      await p2.locator('#submit-answer').click();
      await p2.locator('.feedback.bad').waitFor(T);
      ok('the feedback shows the whole sentence, the answer filled in', /\u00AB/.test(await p2.locator('#filled').innerText()) &&
         (await p2.locator('#filled').innerText()).indexOf(prompts[1].answer) !== -1);
      await p2.locator('#overrule').click();
      await p2.locator('.feedback.good').waitFor(T);
      ok('a wrong-looking answer can be counted as correct by the student', await p2.locator('.feedback h2', { hasText: 'Correct' }).count() === 1);
      await p2.locator('#continue').click();
      await p2.waitForFunction(() => Memorizer.ui.state.per[0].recall.length === 2, null, T);
      ok('and it is recorded as correct, with no card made', await p2.evaluate(() =>
        Memorizer.ui.state.per[0].recall[1].correct === true && Memorizer.ui.state.cards.length === 0));
    }
    for (let i = Math.min(2, prompts.length); i < prompts.length; i++) {
      await p2.locator('h2.q', { hasText: prompts[i].question.slice(0, 40) }).waitFor(T);
      await p2.fill('textarea.answer', prompts[i].answer);
      await p2.locator('#submit-answer').click();
      await p2.locator('#continue').waitFor(T);
      await p2.locator('#continue').click();
    }
    await p2.locator('h2', { hasText: 'Teach it back' }).waitFor(T);
    await p2.fill('textarea.answer', pts.map(x => x.text).join(' '));
    await p2.locator('#submit-answer').click();
    await p2.locator('.feedback .score').waitFor(T);
    ok('a teach-back that covers every point scores 100', (await p2.locator('.feedback .score strong').innerText()) === '100');
    ok('and not one request went to an AI provider', stub.requests.length === aiBefore, `${stub.requests.length - aiBefore} requests`);
    await p2.locator('nav.top').getByRole('button', { name: 'Settings' }).click();
    await p2.locator('#builtin-about').waitFor(T);
    ok('Settings explains the built-in coach, and asks for no key while it is chosen',
       await p2.locator('#builtin-about').isVisible() && !(await p2.locator('#key').isVisible()));
    ok('and offers only the built-in coach and Claude', JSON.stringify(await p2.$$eval('#provider option', os => os.map(o => o.value))) === '["builtin","anthropic"]');
    await p2.selectOption('#provider', 'anthropic');
    /* Appearance: a theme and a size, applied at once and kept. */
    await p2.locator('#appearance .swatch[data-theme-id="nocturne"]').click();
    const bg = await p2.evaluate(() => getComputedStyle(document.body).backgroundColor);
    ok('picking Nocturne recolours the page with Systole\u2019s Nocturne ground', bg === 'rgb(14, 11, 26)', bg);
    await p2.locator('#appearance .seg button[data-size="xl"]').click();
    ok('Extra large text makes the body 20px', await p2.evaluate(() => getComputedStyle(document.body).fontSize) === '20px');
    await p2.locator('#appearance .seg button[data-font="serif"]').click();
    await p2.reload();
    await p2.locator('.drop').waitFor(T);
    ok('and all of it survives a reload, applied before the page draws', await p2.evaluate(() =>
      document.documentElement.getAttribute('data-look') === 'nocturne' && getComputedStyle(document.body).fontSize === '20px' &&
      /Iowan|Charter|Georgia/.test(getComputedStyle(document.body).fontFamily)));
    await p2.locator('nav.top').getByRole('button', { name: 'Settings' }).click();
    await p2.locator('#provider').waitFor(T);
    await p2.selectOption('#provider', 'anthropic');
    ok('choosing Claude shows the key field', await p2.locator('#key').isVisible() && !(await p2.locator('#builtin-about').isVisible()));
    /* The coach's output is held to the model's schema before the session
       sees it. The real coach never trips that, so a broken one is handed
       in here: a malformed step must be an error on screen, not a session
       stepping forward on garbage. */
    await p2.evaluate(() => { window.MemCoach.encode = () => ({ points: 'not a list', mnemonic: '', flowchart: '' }); });
    const docId = await p2.evaluate(() => MemStore.all('docs').then(d => d[0].id));
    await p2.evaluate(id => Memorizer.openDoc(id), docId);
    await p2.locator('.card.error').waitFor(T);
    ok('a malformed built-in step is an error on screen, and the session does not advance',
       /malformed encode/.test(await p2.locator('.card.error').innerText()) &&
       await p2.evaluate(() => !Memorizer.ui.state.per[Memorizer.ui.state.cluster].points));
  }

  ok('and nothing threw on the page throughout', errors.length === 0, errors.join(' | '));
  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(die);
