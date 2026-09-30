#!/usr/bin/env node
'use strict';
/*
 * scripts/extract-content.js pulls the bank and its figures out of a
 * single-file build. Does it refuse what it should, and does a refusal leave
 * the last good content/ exactly as it was?
 *
 *   node tests/verify-extract-pure.js
 *
 * Driven end to end — the real script, as a child process — on a single-file
 * "build" written here from invented questions and tiny invented images, in a
 * temporary folder. No licensed byte is involved.
 *
 * WHY. An outside audit of the repo pointed at four things, each checked here
 * against the script before this suite existed:
 *   · a question id went straight into a file name (`${qid}_1.webp`), so an id
 *     like "../x" could write outside content/figures/;
 *   · content/figures/ was emptied BEFORE anything was validated, so a failed
 *     extraction left the last good bank gone;
 *   · only WebP had its bytes checked against its mime type — a "png" that was
 *     really a JPEG, or anything at all under image/jpeg, went through;
 *   · Buffer.from(x, 'base64') silently skips characters outside the alphabet,
 *     so a damaged payload became a shorter, different file.
 * And one reproducibility point: manifest.generated honours SOURCE_DATE_EPOCH.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'extract-content.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-'));

/* Three smallest-possible real headers, enough for a magic-byte check. */
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([20, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(8, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\n'), Buffer.alloc(8, 2)]);
const JPG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(8, 3)]);
const url = (mime, buf) => `data:${mime};base64,${buf.toString('base64')}`;

function build(questions, imgs) {
  return `<!doctype html><script>\nconst ALL_Q=${JSON.stringify(questions)};\nconst IMGS=${JSON.stringify(imgs)};\nfunction app(){}\n</script>`;
}
const GOOD_Q = [
  { id: 'ZQ_1', ch: 'Zqchapter', img: 1 },
  { id: 'ZQ_2', ch: 'Zqchapter', img: 1 },
  { id: 'ZQ_3', ch: 'Zqother', img: 1 },
];
const GOOD_I = { ZQ_1: [url('image/webp', WEBP)], ZQ_2: [url('image/png', PNG)], ZQ_3: [url('image/jpeg', JPG)] };

function run(name, html, out, env = {}) {
  const src = path.join(TMP, name + '.html');
  fs.writeFileSync(src, html);
  try {
    const o = execFileSync(process.execPath, [SCRIPT, src, out], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    return { code: 0, out: o };
  } catch (e) { return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; }
}
const leftovers = dir => fs.readdirSync(path.dirname(dir)).filter(f => f.startsWith(path.basename(dir) + '.tmp-'));

head('a good build extracts, all three image types');
const OUT = path.join(TMP, 'content');
fs.mkdirSync(path.join(OUT, 'refs-images', 'hf'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'refs-images', 'hf', 'keep.jpg'), 'zq-notes-figure');
const g = run('good', build(GOOD_Q, GOOD_I), OUT, { SOURCE_DATE_EPOCH: '1700000000' });
const figs = fs.existsSync(path.join(OUT, 'figures')) ? fs.readdirSync(path.join(OUT, 'figures')).sort() : [];
ok('it succeeds and writes one file per figure, webp, png and jpg', g.code === 0 && figs.join(',') === 'ZQ_1_1.webp,ZQ_2_1.png,ZQ_3_1.jpg', `${g.code} ${figs.join(',')}`);
ok('each written file is byte-identical to its payload',
   figs.length === 3 && fs.readFileSync(path.join(OUT, 'figures', 'ZQ_3_1.jpg')).equals(JPG) && fs.readFileSync(path.join(OUT, 'figures', 'ZQ_2_1.png')).equals(PNG));
const man = g.code === 0 ? JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8')) : {};
ok('manifest.generated is SOURCE_DATE_EPOCH when that is set', man.generated === '2023-11-14T22:13:20.000Z', man.generated);
ok('content/ keeps what it holds besides the bank (the notes\' figures)', fs.existsSync(path.join(OUT, 'refs-images', 'hf', 'keep.jpg')));
ok('and no work folder is left behind', leftovers(OUT).length === 0, leftovers(OUT).join(','));

/* A marker of "the last good bank", to see whether a failure touches it. */
/* Read only if it exists: a first run that failed is reported above, not
   turned into a crash here. */
const qPath = path.join(OUT, 'questions.json');
const before = fs.existsSync(qPath) ? fs.readFileSync(qPath, 'utf8') : null;
const intact = () => before !== null && fs.readFileSync(qPath, 'utf8') === before &&
  fs.readdirSync(path.join(OUT, 'figures')).sort().join(',') === 'ZQ_1_1.webp,ZQ_2_1.png,ZQ_3_1.jpg';

head('what it refuses, and that a refusal changes nothing');
const cases = [
  ['an id that climbs out of figures/', [{ id: '../zqescape', ch: 'C', img: 1 }], { '../zqescape': [url('image/webp', WEBP)] }, /not safe as a file name/],
  ['an id with a slash in it', [{ id: 'a/zq', ch: 'C', img: 1 }], { 'a/zq': [url('image/webp', WEBP)] }, /not safe as a file name/],
  ['an id with a backslash in it', [{ id: 'a\\zq', ch: 'C', img: 1 }], { 'a\\zq': [url('image/webp', WEBP)] }, /not safe as a file name/],
  ['a "png" whose bytes are a JPEG', [{ id: 'ZQ_9', ch: 'C', img: 1 }], { ZQ_9: [url('image/png', JPG)] }, /mime says image\/png but the bytes are not a png/],
  ['a "jpeg" whose bytes are nothing of the kind', [{ id: 'ZQ_9', ch: 'C', img: 1 }], { ZQ_9: [url('image/jpeg', Buffer.from('zqnotanimage!'))] }, /not a jpg/],
  ['base64 with characters outside the alphabet', [{ id: 'ZQ_9', ch: 'C', img: 1 }], { ZQ_9: ['data:image/webp;base64,' + WEBP.toString('base64').slice(0, 8) + '$$$$' + WEBP.toString('base64').slice(8)] }, /base64 is malformed/],
  ['one bad figure among good ones — the whole run refuses', GOOD_Q.concat([{ id: 'ZQ_4', ch: 'C', img: 1 }]), { ...GOOD_I, ZQ_4: [url('image/png', WEBP)] }, /not a png/],
];
for (const [label, q, i, re] of cases) {
  const r = run('bad', build(q, i), OUT);
  ok(`${label}: refused`, r.code === 1 && re.test(r.out), r.out.split('\n').find(l => /✗/.test(l)) || `exit ${r.code}`);
  ok(`${label}: content/ exactly as it was, no work folder left`, intact() && leftovers(OUT).length === 0);
}
ok('nothing was written outside the output folder', !fs.existsSync(path.join(TMP, 'zqescape_1.webp')) && !fs.existsSync(path.join(path.dirname(OUT), 'zqescape_1.webp')));

head('build.js says which export it took when there are several');
{
  /* findSource lifted from build.js's text and run against a stand-in fs, so
     no file is ever put in the repository's source/ folder. */
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'build.js'), 'utf8');
  const at = src.indexOf('function findSource(');
  let depth = 0, end = -1;
  for (let k = src.indexOf('{', at); k < src.length; k++) {
    if (src[k] === '{') depth++; else if (src[k] === '}' && !--depth) { end = k + 1; break; }
  }
  const files = { '/r/source': ['ACCSAP_old.html', 'ACCSAP_new.html', 'notes.txt'], '/r': [] };
  const mt = { '/r/source/ACCSAP_old.html': 1, '/r/source/ACCSAP_new.html': 2 };
  const fakeFs = { existsSync: d => d in files, readdirSync: d => files[d], statSync: p => ({ mtimeMs: mt[p] || 0 }) };
  const logs = [];
  const findSource = at > 0 && end > 0 ? new Function('fs', 'path', 'ROOT', 'positional', 'process', 'console',
    `${src.slice(at, end)}\nreturn findSource;`)(fakeFs, path.posix, '/r', [], { env: {} }, { log: m => logs.push(m) }) : null;
  const got = findSource ? findSource() : null;
  ok('with two exports it still takes the newest (a working setup keeps working)', got === '/r/source/ACCSAP_new.html', String(got));
  ok('but names the one it took and the one it passed over', /building from the newest: ACCSAP_new\.html/.test(logs.join('\n')) && /passed over: ACCSAP_old\.html/.test(logs.join('\n')),
     logs.join(' | ').slice(0, 120));
  files['/r/source'] = ['ACCSAP_only.html']; logs.length = 0;
  ok('and with one export it says nothing extra', findSource && findSource() === '/r/source/ACCSAP_only.html' && logs.length === 0);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
