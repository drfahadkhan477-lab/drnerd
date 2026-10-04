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
  /* A backslash is a separator on Windows and a letter of the name elsewhere:
     refused on both, so the same name means the same file. */
  ok('a path that leaves app/ by a backslash, or names no file',
    ['app/..\\..\\x.css', 'app\\x.css', 'app/css\\x.css', 'app//x.css', 'app/./x.css', 'app/css/'].every(n => refuses(c(3, 4, n), /not a path under app/)));
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
  const short = root('short');
  const failsOnPiece = (f, text) => { fs.writeFileSync(f, text.slice(0, 5)); throw new Error('no space left'); };
  ok('a piece that cannot be written whole: the part of it is removed and the shell is as it was',
    refuses(() => Carve.carveFile({ root: short, from: 3, to: 4, name: 'app/css/a.css', write: failsOnPiece }), /piece could not be written.*no space left/)
    && !fs.existsSync(path.join(short, 'app', 'css', 'a.css'))
    && fs.readFileSync(path.join(short, 'app', 'systole.html'), 'utf8') === SHELL);
  ok('a destination the pieces of app/ skip: a dotfile, a dot-directory, Thumbs.db, desktop.ini',
    ['app/.piece.css', 'app/.cache/piece.css', 'app/css/.piece.css', 'app/Thumbs.db', 'app/css/Desktop.ini'].every(n => refuses(c(3, 4, n), /pieces of app\/ skip/))
    && !refuses(c(3, 4, 'app/css/thumbs.css'), /./) );
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
  /* Two breaks that also stop assembly name both, and nothing else. */
  const saidWithAssembly = (r, re) => { const p = Carve.auditApp(r).problems; return p.length === 2 && p.some(x => re.test(x)) && p.some(x => /the shell does not assemble/.test(x)); };
  const missing = root('missing', carved);
  ok('a token whose piece is gone', said(missing, /app:app\/css\/a\.css has no file/));
  const orphan = root('orphan'); put(orphan, 'app/css/left.css', '.z{}\n');
  ok('a file under app/ that no token cites', said(orphan, /left\.css is cited by 0 tokens/));
  const twice = root('twice', carved.replace('boot();', Slots.token('app', 'app/css/a.css') + 'boot();')); put(twice, 'app/css/a.css', '.a{}\n');
  ok('a piece cited twice', saidWithAssembly(twice, /a\.css is cited by 2 tokens/));
  const nested = root('nested', carved); put(nested, 'app/css/a.css', '.a{}\n' + Slots.token('src', SRC) + '\n');
  ok('a piece that holds a token', saidWithAssembly(nested, /a\.css holds a slot token/));
  const crlf = root('crlf', carved); put(crlf, 'app/css/a.css', '.a{}\r\n');
  ok('a piece with a carriage return', said(crlf, /carriage return/));
  const repeat = root('repeat', SHELL.replace('boot();', Slots.token('src', SRC) + 'boot();'));
  ok('a src slot the shell repeats: the shell does not assemble', said(repeat, /the shell does not assemble: slot src:src\/core\/thing\.js appears more than once/));
  const torn = root('torn', SHELL.replace('boot();', '@@SLOT[src:src/core/thing.js' + ' boot();'));
  ok('a slot token that is malformed: the shell does not assemble', said(torn, /the shell does not assemble/));
  const nosrc = root('nosrc'); fs.rmSync(path.join(nosrc, SRC));
  ok('a src token whose module is gone', said(nosrc, /src:src\/core\/thing\.js has no file/));
  const badpay = root('badpay', SHELL.replace('payload:ALL_Q', 'payload:NOPE'));
  ok('a payload app-slots does not know', said(badpay, /payload:NOPE is not a payload/));
  const badkind = root('badkind', SHELL.replace('src:' + SRC, 'lib:' + SRC));
  ok('a kind of slot that does not exist', said(badkind, /lib:src\/core\/thing\.js is not a kind/));
}

head('a piece is found once in the assembled app, not only in the shell');
{
  /* ".a{color:red}" stands twice: inside the first block, and alone below it. */
  const TWICE = ['<style>', '.a{color:red}', '.b{color:blue}', '</style>', '<style>', '.a{color:red}', '</style>', '<script>', 'const ALL_Q=' + Slots.token('payload', 'ALL_Q') + ';', '</script>', ''].join('\n');
  const BIG = '.a{color:red}\n.b{color:blue}\n', SMALL = '.a{color:red}\n';
  const r = root('nested', TWICE);
  Carve.carveFile({ root: r, from: 2, to: 3, name: 'app/css/z-big.css' });
  const afterBig = fs.readFileSync(path.join(r, 'app', 'systole.html'), 'utf8');
  /* The shell now holds SMALL once, so the old count was satisfied. */
  ok('the smaller text is found once in the remaining shell', afterBig.split(SMALL).length - 1 === 1);
  ok('and carving it is refused: it stands twice in the assembled app, and nothing changes',
    refuses(() => Carve.carveFile({ root: r, from: 4, to: 4, name: 'app/css/a-small.css' }), /assembled app 2 times/)
    && !fs.existsSync(path.join(r, 'app', 'css', 'a-small.css'))
    && fs.readFileSync(path.join(r, 'app', 'systole.html'), 'utf8') === afterBig);

  /* What was being prevented. The pieces below are what the old check allowed;
     cut() takes them in filename order, so the smaller one sorting first finds
     its text twice in the chain build and is left inline. */
  const chain = Slots.assemble(TWICE, (k, n) => (k === 'payload' ? '[1]' : undefined));
  const inlineOf = apps => Slots.cut(chain.replace('const ALL_Q=[1];', '\nconst ALL_Q=[1];\nconst IMGS={};\n/*REF_SEED_START*/x/*REF_SEED_END*/\nwindow.HEART3D_MESH_B64=\'QQ==\';'), { srcs: {}, assets: {}, apps }).report.inline.app;
  ok('order decides: the smaller piece sorting first is left inline', inlineOf({ 'app/css/a-small.css': SMALL, 'app/css/z-big.css': BIG }).join() === 'app/css/a-small.css (found 2 times)');
  ok('and sorting last is not: the same pieces freeze', inlineOf({ 'app/css/z-small.css': SMALL, 'app/css/a-big.css': BIG }).length === 0);

  const hand = root('hand', TWICE.replace('.a{color:red}\n.b{color:blue}\n', Slots.token('app', 'app/css/z-big.css')).replace('.a{color:red}\n', Slots.token('app', 'app/css/a-small.css')));
  put(hand, 'app/css/z-big.css', BIG); put(hand, 'app/css/a-small.css', SMALL);
  const a = Carve.auditApp(hand);
  ok('auditApp names the pair a tree can hold by hand', a.problems.length === 1 && /a-small\.css's text stands in the assembled app 2 times/.test(a.problems[0]), JSON.stringify(a.problems));
}

head('files a workstation leaves under app/ are not pieces');
{
  const carved = SHELL.replace('.a{color:red}\n.b{color:blue}\n', Slots.token('app', 'app/css/a.css'));
  const r = root('junk', carved); put(r, 'app/css/a.css', '.a{color:red}\n.b{color:blue}\n');
  const junk = ['app/.DS_Store', 'app/css/.DS_Store', 'app/css/Thumbs.db', 'app/Desktop.ini', 'app/.cache/x.css', 'app/css/.a.css.swp'];
  junk.forEach(j => put(r, j, 'x'));
  const a = Carve.auditApp(r), offered = Object.keys(Slots.repoSources(r).apps);
  ok('the audit finds only the piece, and no problem', a.problems.length === 0 && a.pieces.join() === 'app/css/a.css', JSON.stringify(a));
  ok('the cut is offered only the piece', offered.join() === 'app/css/a.css', offered.join());
  const cites = root('cites', SHELL.replace('.a{color:red}\n.b{color:blue}\n', Slots.token('app', 'app/.hidden.css')));
  put(cites, 'app/.hidden.css', '.a{color:red}\n.b{color:blue}\n');
  const ca = Carve.auditApp(cites);
  ok('a token that cites such a name is named by the audit', ca.problems.length === 1 && /\.hidden\.css is cited, but it is a name the pieces of app\/ skip/.test(ca.problems[0]), JSON.stringify(ca.problems));
  ok('a name that only looks like metadata is still a piece', !Slots.isMetadata('css/a.css') && !Slots.isMetadata('css/dotted.name.css') && !Slots.isMetadata('thumbs.css') && Slots.isMetadata('css/.hidden/a.css'));
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
