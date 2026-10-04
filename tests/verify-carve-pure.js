#!/usr/bin/env node
/*
 * A piece carved out of app/systole.html loses nothing, and the committed
 * app/ is whole.
 *
 *   node tests/verify-carve-pure.js
 *
 * Pure Node. scripts/carve.js is step 3 of retiring the patch chain: it moves
 * lines of the shell into a file under app/ and leaves a token. This holds
 *
 *   - on a synthetic shell: the carved shell assembles to the bytes the
 *     uncarved one did, a chain output cut again finds the piece where it
 *     stands, and each refusal carve.js promises is a refusal;
 *   - on synthetic app/ trees broken one way each: auditApp names the break;
 *   - on the committed app/: auditApp finds nothing, and there is at least
 *     one piece, so "every piece" is not said of none.
 *
 * It does not hold that the committed app/ is still the chain's build. Only
 * `node scripts/assemble-app.js --compare` beside a chain build shows that.
 *
 * Every text here is invented.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const Slots = require(path.join(ROOT, 'scripts', 'app-slots.js'));
const Carve = require(path.join(ROOT, 'scripts', 'carve.js'));

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const refuses = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'systole-carve-'));
const SRC = 'src/core/thing.js', SRC_TEXT = 'window.Thing=(function(){return 7})();\n';
const SHELL = [
  '<!doctype html>',
  '<style>',
  '.a{color:red}',
  '.b{color:blue}',
  '</style>',
  '<p class="twice">same</p>',
  '<p class="twice">same</p>',
  '<script>',
  'const ALL_Q=' + Slots.token('payload', 'ALL_Q') + ';',
  Slots.token('src', SRC),
  'boot();',
  '</script>',
  '',
].join('\n');

/* a repository root holding the shell and what its tokens name */
function root(name, shell = SHELL) {
  const r = path.join(dir, name);
  fs.mkdirSync(path.join(r, 'app'), { recursive: true });
  fs.mkdirSync(path.join(r, 'src', 'core'), { recursive: true });
  fs.writeFileSync(path.join(r, 'app', 'systole.html'), shell);
  fs.writeFileSync(path.join(r, SRC), SRC_TEXT);
  return r;
}
const put = (r, name, text) => { fs.mkdirSync(path.dirname(path.join(r, name)), { recursive: true }); fs.writeFileSync(path.join(r, name), text); };
const fill = r => { const repo = Slots.repoResolver(null, r); return (k, n) => (k === 'payload' ? '[1,2]' : repo(k, n)); };

head('a carve moves the lines and leaves one token');
{
  const r = root('carve');
  const before = Slots.assemble(SHELL, fill(r));
  const out = Carve.carveFile({ root: r, from: 3, to: 4, name: 'app/css/a.css' });
  const shell = fs.readFileSync(path.join(r, 'app', 'systole.html'), 'utf8');
  const piece = fs.readFileSync(path.join(r, 'app', 'css', 'a.css'), 'utf8');
  ok('the piece is those lines, whole', piece === '.a{color:red}\n.b{color:blue}\n' && out.bytes === piece.length, JSON.stringify(piece));
  ok('the shell holds one token where they were', shell.includes('<style>\n' + Slots.token('app', 'app/css/a.css') + '</style>') && !shell.includes('.a{color:red}'));
  ok('the carved shell assembles to the bytes the uncarved one did', Slots.assemble(shell, fill(r)) === before);
  /* What freeze-shell does on the next chain build: the piece is found where it stands. */
  const again = Slots.cut(before.replace('[1,2]', '[3]').replace('const ALL_Q=[3];', '\nconst ALL_Q=[3];\nconst IMGS={};\n/*REF_SEED_START*/x/*REF_SEED_END*/\nwindow.HEART3D_MESH_B64=\'QQ==\';'), Slots.repoSources(r));
  ok('a build cut again claims the piece as an app slot', again.shell.includes(Slots.token('app', 'app/css/a.css')) && again.report.slots.some(s => s.kind === 'app' && s.name === 'app/css/a.css') && again.report.inline.app.length === 0, JSON.stringify(again.report.inline));
  fs.writeFileSync(path.join(r, 'app', 'css', 'a.css'), piece.replace('red', 'green'));
  const parted = Slots.cut(before.replace('const ALL_Q=[1,2];', '\nconst ALL_Q=[3];\nconst IMGS={};\n/*REF_SEED_START*/x/*REF_SEED_END*/\nwindow.HEART3D_MESH_B64=\'QQ==\';'), Slots.repoSources(r));
  ok('a piece edited away from the build is left inline, and reported', parted.report.inline.app.includes('app/css/a.css') && !parted.shell.includes(Slots.token('app', 'app/css/a.css')));
}

head('what a carve refuses');
{
  const c = (from, to, name = 'app/x.txt') => () => Carve.carve({ shell: SHELL, from, to, name });
  ok('lines that hold a token', refuses(c(9, 11), /hold a slot token/));
  ok('lines whose text stands twice', refuses(c(6, 6), /stands in the shell 2 times/));
  ok('a path outside app/', refuses(c(3, 4, 'src/x.css'), /not a path under app/) && refuses(c(3, 4, 'app/../src/x.css'), /not a path under app/));
  ok('the shell itself', refuses(c(3, 4, 'app/systole.html'), /cannot be carved into itself/));
  ok('a range past the end', refuses(c(3, 99), /not a range/) && refuses(c(4, 3), /not a range/) && refuses(c(0, 2), /not a range/));
  const r = root('exists');
  put(r, 'app/css/a.css', 'already here\n');
  ok('a piece that already exists, leaving both files as they were',
    refuses(() => Carve.carveFile({ root: r, from: 3, to: 4, name: 'app/css/a.css' }), /already exists/)
    && fs.readFileSync(path.join(r, 'app', 'css', 'a.css'), 'utf8') === 'already here\n'
    && fs.readFileSync(path.join(r, 'app', 'systole.html'), 'utf8') === SHELL);
  const lossy = root('lossy');
  const drops = o => { const c = Carve.carve(o); return { shell: c.shell, piece: c.piece.slice(c.piece.indexOf('}') + 2) }; };
  ok('a carve that loses a line: the piece is removed and the shell is as it was',
    refuses(() => Carve.carveFile({ root: lossy, from: 3, to: 4, name: 'app/css/a.css', cut: drops }), /does not give the same bytes/)
    && !fs.existsSync(path.join(lossy, 'app', 'css', 'a.css'))
    && fs.readFileSync(path.join(lossy, 'app', 'systole.html'), 'utf8') === SHELL);
  const full = root('full');
  const failsOnShell = (f, text) => { if (!String(f).includes('systole.html')) return fs.writeFileSync(f, text); fs.writeFileSync(f, text.slice(0, 9)); throw new Error('no space left'); };
  ok('a shell that cannot be written: the piece is taken back and nothing else is left in app/',
    refuses(() => Carve.carveFile({ root: full, from: 3, to: 4, name: 'app/css/a.css', write: failsOnShell }), /could not be written.*no space left/)
    && !fs.existsSync(path.join(full, 'app', 'css', 'a.css'))
    && fs.readdirSync(path.join(full, 'app')).filter(f => f !== 'css').join() === 'systole.html'
    && fs.readFileSync(path.join(full, 'app', 'systole.html'), 'utf8') === SHELL);
  const cli = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'carve.js'), '3'], { encoding: 'utf8' });
  ok('the command line without a path exits 2', cli.status === 2, String(cli.status));
}

head('auditApp names each way app/ can be broken');
{
  const carved = SHELL.replace('.a{color:red}\n.b{color:blue}\n', Slots.token('app', 'app/css/a.css'));
  const whole = root('whole', carved); put(whole, 'app/css/a.css', '.a{color:red}\n.b{color:blue}\n');
  const a = Carve.auditApp(whole);
  ok('a whole app/ has no problem', a.problems.length === 0 && a.pieces.join() === 'app/css/a.css' && a.tokens === 3, JSON.stringify(a));

  const said = (r, re) => { const p = Carve.auditApp(r).problems; return p.length === 1 && re.test(p[0]); };
  const missing = root('missing', carved);
  ok('a token whose piece is gone', said(missing, /app:app\/css\/a\.css has no file/));
  const orphan = root('orphan'); put(orphan, 'app/css/left.css', '.z{}\n');
  ok('a file under app/ that no token cites', said(orphan, /left\.css is cited by 0 tokens/));
  const twice = root('twice', carved.replace('boot();', Slots.token('app', 'app/css/a.css') + 'boot();')); put(twice, 'app/css/a.css', '.a{}\n');
  ok('a piece cited twice', said(twice, /a\.css is cited by 2 tokens/));
  const nested = root('nested', carved); put(nested, 'app/css/a.css', '.a{}\n' + Slots.token('src', SRC) + '\n');
  ok('a piece that holds a token', said(nested, /a\.css holds a slot token/));
  const crlf = root('crlf', carved); put(crlf, 'app/css/a.css', '.a{}\r\n');
  ok('a piece with a carriage return', said(crlf, /carriage return/));
  const nosrc = root('nosrc'); fs.rmSync(path.join(nosrc, SRC));
  ok('a src token whose module is gone', said(nosrc, /src:src\/core\/thing\.js has no file/));
  const badpay = root('badpay', SHELL.replace('payload:ALL_Q', 'payload:NOPE'));
  ok('a payload app-slots does not know', said(badpay, /payload:NOPE is not a payload/));
  const badkind = root('badkind', SHELL.replace('src:' + SRC, 'lib:' + SRC));
  ok('a kind of slot that does not exist', said(badkind, /lib:src\/core\/thing\.js is not a kind/));
}

head('the committed app/');
{
  const a = Carve.auditApp(ROOT);
  ok('has nothing wrong with it', a.problems.length === 0, a.problems.slice(0, 3).join(' | '));
  ok('and has pieces, so that was said of something', a.pieces.length > 0 && a.tokens > a.pieces.length, `${a.pieces.length} pieces, ${a.tokens} tokens`);
  const shell = fs.readFileSync(path.join(ROOT, 'app', 'systole.html'), 'utf8');
  const repo = Slots.repoResolver(null, ROOT);
  let out = null, err = '';
  try { out = Slots.assemble(shell, (k, n) => (k === 'payload' ? '' : repo(k, n))); } catch (e) { err = e.message; }
  ok('assembles from the repository, payloads aside', typeof out === 'string' && a.pieces.every(p => out.includes(fs.readFileSync(path.join(ROOT, p), 'utf8'))), err);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
