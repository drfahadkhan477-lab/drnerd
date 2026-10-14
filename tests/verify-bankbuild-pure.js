#!/usr/bin/env node
/*
 * The app builds from a bank in the content schema as it builds from the export.
 *
 *   node tests/verify-bankbuild-pure.js
 *
 * Pure Node. scripts/assemble-app.js takes the export (an HTML file with a
 * `const ALL_Q=` and a `const IMGS=` line) or a bank as docs/CONTENT-SCHEMA.md
 * describes it: a folder of manifest.json, questions.json and figures/, or the
 * package tools/pack-content.js zips. This holds, on the synthetic bank
 * (scripts/synthetic-export.js) and the real shell:
 *
 *   - the bank as a folder builds the same bytes as the bank as an export;
 *   - a bank extracted from a built app (scripts/extract-content.js), whose
 *     keys are already corrected, builds the same bytes again, from the folder
 *     and from its package;
 *   - the single file carries the bank in the export's shape: no figs, options
 *     as {l, t}, and an img and an item number where the bank gives none;
 *   - a bank src/core/bankpack.js refuses is refused, naming ids and files and
 *     never a word of a question, and a figure name that climbs out of
 *     figures/ is never opened;
 *   - a bank with some keys corrected and some not is refused;
 *   - the command line takes a folder, and exits 2 on a refused one.
 *
 * Every question here is invented placeholder text.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const S = p => path.join(ROOT, 'scripts', p);
const A = require(S('assemble-app.js'));
const Syn = require(S('synthetic-export.js'));
const { CORRECTIONS, ensureKeyCorrections } = require(S('answer-keys.js'));
const { pack } = require(path.join(ROOT, 'tools', 'pack-content.js'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bankbuild-'));
const SHELL = fs.readFileSync(path.join(ROOT, 'app', 'systole.html'), 'utf8');
const refs = path.join(dir, 'refs'), refImgs = path.join(dir, 'refs-images');
fs.mkdirSync(refs); fs.mkdirSync(refImgs);
{
  const r = Syn.syntheticRefs(2);
  for (const [name, text] of r.files) fs.writeFileSync(path.join(refs, name), text);
  for (const [key, buf] of r.images) fs.writeFileSync(path.join(refImgs, key), buf);
}
const syn = Syn.syntheticBank(4);
const EXPORT = Syn.syntheticExport(4);
const folder = path.join(dir, 'bank');
Syn.writeBankFolder(folder, syn);

const build = async source => {
  const bank = typeof source === 'string' ? await A.readBank(source) : null;
  return A.assembleApp({ shell: SHELL, commit: 'abc123def456', resolve: A.producers({
    exportHtml: bank ? null : source.exportHtml, bank, refsDir: refs, imagesDir: refImgs }) }).unstamped;
};
const refusal = async p => { try { await A.readBank(p); return ''; } catch (e) { return e.message; } };
const copyFolder = (to, edit) => {
  fs.cpSync(folder, to, { recursive: true });
  if (edit) {
    const qs = JSON.parse(fs.readFileSync(path.join(to, 'questions.json'), 'utf8'));
    edit(qs, to);
    fs.writeFileSync(path.join(to, 'questions.json'), JSON.stringify(qs));
  }
  return to;
};

(async () => {
  head('a bank folder builds the app its export builds');
  const fromExport = await build({ exportHtml: EXPORT });
  let bank = null;
  try { bank = await A.readBank(folder); } catch (e) { ok('the synthetic bank folder is accepted', false, e.message.split('\n')[0]); }
  if (bank) ok('the synthetic bank folder is accepted, every question and figure',
    bank.questions.length === syn.bank.length && bank.figures.size === Object.values(syn.imgs).flat().length,
    `${bank.questions.length} questions, ${bank.figures.size} figures`);
  const fromFolder = await build(folder);
  ok('built from the folder, it is the same bytes as built from the export', fromFolder.equals(fromExport),
     `${fromFolder.length} and ${fromExport.length} bytes`);

  head('a bank extracted from a built app builds it again');
  {
    const built = path.join(dir, 'built.html'), extracted = path.join(dir, 'extracted');
    fs.writeFileSync(built, fromExport);
    const x = spawnSync(process.execPath, [S('extract-content.js'), built, extracted], { encoding: 'utf8' });
    ok('extract-content.js writes it from the built app', x.status === 0, (x.stderr || '').trim().split('\n').pop());
    let corrected = [];
    try { corrected = JSON.parse(fs.readFileSync(path.join(extracted, 'questions.json'), 'utf8')); } catch (_) {}
    const at = c => { const q = corrected.find(y => y.id === c.id); return q ? 'ABCDEFGH'[q.ci] : 'absent'; };
    ok(`and its ${CORRECTIONS.length} keys arrive corrected, as the build left them`,
       CORRECTIONS.every(c => at(c) === c.now), CORRECTIONS.map(c => `${c.id} ${at(c)}`).join(', '));
    let again = null;
    try { again = await build(extracted); } catch (e) { ok('built from it', false, e.message.split('\n')[0]); }
    if (again) ok('built from it, the same bytes again: nothing corrected twice, nothing lost', again.equals(fromExport));
    const zip = path.join(dir, 'bank.zip');
    let fromZip = null;
    try { pack(extracted, zip); fromZip = await build(zip); } catch (e) { ok('built from its package', false, e.message.split('\n')[0]); }
    if (fromZip) ok('and from the package tools/pack-content.js makes of it, the same bytes', fromZip.equals(fromExport));
  }

  head('the single file carries the bank in its own shape');
  {
    const qs = A.singleFileBank([
      { id: 'X_1', ch: 'One', o: ['first', 'second'], figs: ['X_1_1.png', 'X_1_2.png'] },
      { id: 'X_2', ch: 'One', n: 7, img: 1, o: [{ l: 'D', t: 'kept', p: 40 }, { t: 'no letter' }], figs: ['X_2_1.png'] },
      { id: 'X_3', ch: 'Two', o: [{ l: 'A', t: 'a' }, { l: 'B', t: 'b' }], figs: [] },
      { id: 'X_4', ch: 'One', o: ['x', 'y'] }]);
    ok('no question keeps figs: the single file\'s figures are in IMGS', qs.every(q => !('figs' in q)));
    ok('a question that names figures without img gets the number it names', qs[0].img === 2, String(qs[0].img));
    ok('and one that says how many, or names none, is left as it is', qs[1].img === 1 && !('img' in qs[2]), `${qs[1].img}, ${qs[2].img}`);
    ok('an option given as a string becomes the {l, t} the app reads',
       JSON.stringify(qs[0].o) === JSON.stringify([{ l: 'A', t: 'first' }, { l: 'B', t: 'second' }]), JSON.stringify(qs[0].o));
    ok('an option with no letter gets its place\'s, and one with a letter keeps it whole',
       JSON.stringify(qs[1].o) === JSON.stringify([{ l: 'D', t: 'kept', p: 40 }, { l: 'B', t: 'no letter' }]), JSON.stringify(qs[1].o));
    ok('a question with no item number gets its place in its chapter, and a given one stays',
       qs[0].n === 1 && qs[1].n === 7 && qs[2].n === 1 && qs[3].n === 3, qs.map(q => q.n).join(', '));
  }

  head('a bank the iPad would refuse is refused here, naming ids and files');
  {
    const noManifest = copyFolder(path.join(dir, 'no-manifest'), (qs, to) => fs.rmSync(path.join(to, 'manifest.json')));
    const why1 = await refusal(noManifest);
    ok('one with no manifest.json', /no manifest\.json/.test(why1), why1.split('\n')[1] || why1 || 'accepted');
    const target = syn.bank.find(q => !(syn.imgs[q.id] || []).length);
    const outside = copyFolder(path.join(dir, 'key-outside'), qs => { qs.find(q => q.id === target.id).ci = 9; });
    const why2 = await refusal(outside);
    ok('one whose key is outside its options, by id', why2.includes(`${target.id}: its key is outside its options`), why2.split('\n')[1] || why2 || 'accepted');
    const pictured = syn.bank.find(q => (syn.imgs[q.id] || []).length);
    const missing = copyFolder(path.join(dir, 'missing-figure'), (qs, to) => fs.rmSync(path.join(to, 'figures', `${pictured.id}_1.png`)));
    const why3 = await refusal(missing);
    ok('one that names a figure it does not carry, by file', why3.includes(`figures/${pictured.id}_1.png`), why3.split('\n')[1] || why3 || 'accepted');
    const miscount = copyFolder(path.join(dir, 'img-miscount'), qs => { qs.find(q => q.id === pictured.id).img = 3; });
    const why4 = await refusal(miscount);
    ok('one whose img disagrees with the figures it names, by id', why4.includes(`${pictured.id}: img says 3`), why4.split('\n')[1] || why4 || 'accepted');
    ok('and no refusal carries a word of a question', [why1, why2, why3, why4].every(w => w && !/Synthetic (stem|option|commentary)/.test(w)));

    /* bankpack.js refuses the name; the folder reader must not have opened it
       on the way there, so the file outside figures/ is watched. */
    const climb = copyFolder(path.join(dir, 'climb'), qs => { qs.find(q => q.id === target.id).figs = ['../outside.png']; });
    fs.writeFileSync(path.join(climb, 'outside.png'), Buffer.from('89504e470d0a1a0a' + '00'.repeat(20), 'hex'));
    const opened = [], real = fs.readFileSync;
    fs.readFileSync = function (p, ...rest) { opened.push(String(p)); return real.call(this, p, ...rest); };
    let why5;
    try { why5 = await refusal(climb); } finally { fs.readFileSync = real; }
    ok('a figure name that climbs out of figures/ is refused and never opened',
       /not safe/.test(why5) && !opened.some(p => p.endsWith('outside.png')), opened.filter(p => p.endsWith('outside.png')).join(', ') || why5.split('\n')[1] || 'accepted');
  }

  head('the corrections: applied to a raw bank, left on a corrected one, a mix refused');
  {
    const raw = JSON.parse(JSON.stringify(syn.bank));
    const applied = ensureKeyCorrections(raw);
    ok(`a raw bank gets all ${CORRECTIONS.length}`, applied.length === CORRECTIONS.length, `${applied.length}`);
    const before = JSON.stringify(raw);
    const again = ensureKeyCorrections(raw);
    ok('a corrected bank gets none, and is not changed', again.length === 0 && JSON.stringify(raw) === before, `${again.length} applied`);
    const mixed = JSON.parse(JSON.stringify(syn.bank));
    const c0 = CORRECTIONS[0];
    mixed.find(q => q.id === c0.id).ci = 'ABCDEFGH'.indexOf(c0.now);
    let why = '';
    try { ensureKeyCorrections(mixed); } catch (e) { why = e.message; }
    ok('a bank with one corrected and the rest not is refused', /now keys/.test(why), why.split('\n')[0] || 'accepted');
  }

  head('the command line');
  {
    const out = path.join(dir, 'cli.html');
    const env = { ...process.env, SYSTOLE_REFS_DIR: refs, SYSTOLE_REF_IMAGES_DIR: refImgs };
    const r = spawnSync(process.execPath, [S('assemble-app.js'), folder, '--out', out], { encoding: 'utf8', env });
    ok('a folder builds, and says it came from a bank', r.status === 0 && /from the bank in/.test(r.stdout) && fs.existsSync(out),
       (r.stdout + r.stderr).trim().split('\n').pop());
    const bad = spawnSync(process.execPath, [S('assemble-app.js'), path.join(dir, 'key-outside'), '--out', out], { encoding: 'utf8', env });
    ok('a refused bank exits 2 and says why', bad.status === 2 && /key is outside its options/.test(bad.stderr), `exit ${bad.status}`);
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  ok('the suite ran to its end', false, String(e && e.message || e).split('\n')[0]);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
});
