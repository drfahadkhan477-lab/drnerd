#!/usr/bin/env node
'use strict';
/*
 * The code-only deploy's package: tools/pack-content.js writes it,
 * src/core/zipread.js reads it and src/core/bankpack.js decides whether the
 * app will take it. Is every refusal a refusal, and does a good package make
 * the round trip whole?
 *
 *   node tests/verify-bankpack-pure.js
 *
 * Everything here is invented — two questions, two tiny images — in a
 * temporary folder. The page runs the same bankpack.js and zipread.js this
 * loads (build-pwa.js inlines them into the --no-content shell).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const load = f => { const sb = {}; new Function(fs.readFileSync(path.join(ROOT, 'src', 'core', f), 'utf8')).call(sb); return sb; };
const { BankPack } = load('bankpack.js');
const { ZipRead } = load('zipread.js');
const { pack } = require('../tools/pack-content.js');

const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([20, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(8, 1)]);
const JPG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(8, 3)]);
const QS = [
  { id: 'ZQ_1', ch: 'Zqchapter', s: 'Zqstem one', o: ['Zqa', 'Zqb', 'Zqc'], ci: 1, img: 1, figs: ['ZQ_1_1.webp'] },
  { id: 'OAB_2', ch: 'Older ACC bank', s: 'Zqstem two', o: [{ l: 'A', t: 'Zqx' }, { l: 'B', t: 'Zqy' }], ci: 0, img: 1, figs: ['OAB_2_1.jpg'] },
];

async function run() {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bankpack-'));
  const content = path.join(TMP, 'content');
  fs.mkdirSync(path.join(content, 'figures'), { recursive: true });
  fs.writeFileSync(path.join(content, 'questions.json'), JSON.stringify(QS));
  fs.writeFileSync(path.join(content, 'manifest.json'), JSON.stringify({ source: 'ZQ_local_export_name.html', sourceDigest: 'abc', questions: 2, figures: 2 }));
  fs.writeFileSync(path.join(content, 'figures', 'ZQ_1_1.webp'), WEBP);
  fs.writeFileSync(path.join(content, 'figures', 'OAB_2_1.jpg'), JPG);
  /* Something content/ may hold that is not part of the bank. */
  fs.mkdirSync(path.join(content, 'refs-images'), { recursive: true });
  fs.writeFileSync(path.join(content, 'refs-images', 'zq.json'), '{}');

  head('tools/pack-content.js, round trip through the page\'s reader and checker');
  const zipPath = path.join(TMP, 'out', 'systole-content-v1.zip');
  const r = pack(content, zipPath);
  ok('it packs every question and figure', r.questions === 2 && r.figures === 2, JSON.stringify(r));
  const buf = fs.readFileSync(zipPath);
  const zip = await ZipRead.read(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  const names = zip.files.map(f => f.name).sort();
  ok('the zip holds the manifest, the bank and the figures — and nothing else from content/',
     names.join(',') === 'figures/OAB_2_1.jpg,figures/ZQ_1_1.webp,manifest.json,questions.json' && zip.skipped.length === 0, names.join(','));
  const v = BankPack.validate(zip.files);
  ok('what the page reads back validates', v.ok && v.questions.length === 2 && v.figures.length === 2, v.problems.join('; '));
  const figBytes = v.figures && v.figures.find(f => f.name === 'OAB_2_1.jpg');
  ok('figures come back byte for byte, typed by their extension',
     !!figBytes && Buffer.from(figBytes.bytes).equals(JPG) && figBytes.type === 'image/jpeg');
  ok('the manifest carries schemaVersion 1 and not the export\'s local file name',
     v.manifest && v.manifest.schemaVersion === 1 && !('source' in v.manifest), JSON.stringify(v.manifest));
  ok('no staging folder is left beside the zip', fs.readdirSync(path.dirname(zipPath)).join(',') === 'systole-content-v1.zip', fs.readdirSync(path.dirname(zipPath)).join(','));

  head('the reference notes travel in the same package');
  const SEED = Buffer.from(JSON.stringify([{ id: 'zq-note', md: 'Zqnote text' }]));
  const HF = Buffer.from(JSON.stringify({ 'hf/zq.jpg': 'data:image/jpeg;base64,AAAA' }));
  const zx = path.join(TMP, 'out', 'with-notes.zip');
  const rx = pack(content, zx, { 'refs-seed.json': SEED, 'refs-images/hf.json': HF, 'refs-images/hf.2.json': HF });
  const bx = fs.readFileSync(zx);
  const zipX = await ZipRead.read(bx.buffer.slice(bx.byteOffset, bx.byteOffset + bx.length));
  const vx = BankPack.validate(zipX.files);
  ok('they are packed under extra/, listed in the manifest, and validate', rx.extras === 3 && vx.ok && vx.extras.length === 3 &&
     JSON.stringify(vx.manifest.extras) === JSON.stringify(['refs-images/hf.2.json', 'refs-images/hf.json', 'refs-seed.json']), JSON.stringify(vx.manifest && vx.manifest.extras));
  ok('and come back byte for byte', vx.extras && Buffer.from(vx.extras.find(x => x.name === 'refs-seed.json').bytes).equals(SEED));
  const xf = () => zipX.files.map(f => ({ name: f.name, bytes: f.bytes }));
  const drop = (files, name) => files.filter(f => f.name !== name);
  const swapMan = (files, extrasList) => files.filter(f => f.name !== 'manifest.json').concat([{ name: 'manifest.json',
    bytes: new TextEncoder().encode(JSON.stringify(Object.assign({}, vx.manifest, { extras: extrasList }))) }]);
  const xcases = [
    ['a listed note file the zip lacks', drop(xf(), 'extra/refs-images/hf.json'), /listed in the manifest but not in the package/],
    ['a note file with a name the app never asks for', swapMan(xf(), ['../zq.json']), /not a file this app reads/],
    ['a note file that is not JSON', xf().map(f => f.name === 'extra/refs-seed.json' ? { name: f.name, bytes: new TextEncoder().encode('<html>zq') } : f), /extra\/refs-seed\.json is not JSON/],
  ];
  for (const [label, files, re] of xcases) {
    const got = BankPack.validate(files);
    ok(`${label}: refused, and says why`, !got.ok && got.extras === null && got.problems.some(p => re.test(p)), got.problems[0] || 'accepted');
  }
  ok('a package with no notes at all is still a bank', v.ok && v.extras && v.extras.length === 0);

  head('what the checker refuses');
  const good = () => zip.files.map(f => ({ name: f.name, bytes: f.bytes }));
  const withFile = (files, name, bytes) => files.filter(f => f.name !== name).concat(bytes === null ? [] : [{ name, bytes }]);
  const json = o => new TextEncoder().encode(JSON.stringify(o));
  const man = o => json(Object.assign({ schemaVersion: 1, questions: 2, figures: 2 }, o));
  const bank = mut => json(mut(JSON.parse(JSON.stringify(QS))));
  const cases = [
    ['no manifest', f => withFile(f, 'manifest.json', null), /no manifest\.json/],
    ['a schema this app does not read', f => withFile(f, 'manifest.json', man({ schemaVersion: 2 })), /schemaVersion is 2/],
    ['no bank', f => withFile(f, 'questions.json', null), /no questions\.json/],
    ['a bank that is not JSON', f => withFile(f, 'questions.json', new TextEncoder().encode('<html>zq sign in</html>')), /not JSON/],
    ['an id that climbs out', f => withFile(f, 'questions.json', bank(q => { q[0].id = '../zq'; return q; })), /no usable id/],
    ['a duplicate id', f => withFile(f, 'questions.json', bank(q => { q[1].id = 'ZQ_1'; return q; })), /appears twice/],
    ['a key outside its options', f => withFile(f, 'questions.json', bank(q => { q[0].ci = 3; return q; })), /key is outside/],
    ['options that are not a list', f => withFile(f, 'questions.json', bank(q => { q[0].o = 'zq'; return q; })), /options are not a list/],
    ['a figure name that climbs out', f => withFile(f, 'questions.json', bank(q => { q[0].figs = ['../zq.webp']; return q; })), /figure name that is not safe/],
    ['a figure the bank names but the zip lacks', f => withFile(f, 'figures/ZQ_1_1.webp', null), /not in the package/],
    ['bytes that are not the image their name claims', f => withFile(f, 'figures/OAB_2_1.jpg', new Uint8Array(WEBP)), /not a jpg file/],
    ['a manifest count that disagrees', f => withFile(f, 'manifest.json', man({ questions: 3 })), /says 3 questions/],
  ];
  for (const [label, mutate, re] of cases) {
    const got = BankPack.validate(mutate(good()));
    ok(`${label}: refused, and says why`, !got.ok && got.questions === null && got.figures === null && got.problems.some(p => re.test(p)),
       got.problems[0] || 'accepted');
  }
  const leak = cases.map(([, mutate]) => BankPack.validate(mutate(good())).problems.join(' ')).join(' ');
  ok('no refusal quotes a word of the bank', !/Zq(stem|a|b|c|x|y)\b/.test(leak), (leak.match(/Zq\w+/) || [''])[0]);

  head('the packer refuses what the iPad would refuse');
  fs.writeFileSync(path.join(content, 'figures', 'OAB_2_1.jpg'), WEBP);
  let threw = '';
  try { pack(content, zipPath + '.2'); } catch (e) { threw = String(e.message); }
  ok('a package the checker would refuse is not written', /would be refused on the iPad/.test(threw) && !fs.existsSync(zipPath + '.2'), threw.split('\n')[0]);

  fs.rmSync(TMP, { recursive: true, force: true });
}

run().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}).catch(e => { console.error(e); process.exit(1); });
