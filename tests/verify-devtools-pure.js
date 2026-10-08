#!/usr/bin/env node
'use strict';
/*
 * The developer tools: each build in its own workspace, suite tags read from
 * the code, a JSON report that carries no output text, `npm run doctor`, and
 * a `clean` that cannot reach the export.
 *
 *   node tests/verify-devtools-pure.js
 *
 * No export, no browser. The build is run on an invented page that its first
 * step refuses, which is enough to see where it worked and what it left.
 * clean runs in a temporary folder laid out like the repository, with a
 * stand-in export in source/ that it must never touch.
 */
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'devtools-'));
const node = (args, env) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, env || {}) });

(async () => {
  head('scripts/build.js: each run in its own workspace, and nothing half-written left behind');
  {
    const fake = path.join(TMP, 'zq-not-an-export.html');
    fs.writeFileSync(fake, '<html><head></head><body>zq</body></html>');
    const out = path.join(TMP, 'out.html');
    fs.writeFileSync(out, 'the previous build');
    const work = path.join(ROOT, 'build', '.work');
    const before = fs.existsSync(work) ? fs.readdirSync(work).sort() : [];
    const r = node([path.join(ROOT, 'scripts', 'build.js'), fake, '--out', out]);
    const after = fs.existsSync(work) ? fs.readdirSync(work).sort() : [];
    ok('a build its first step refuses fails', r.status !== 0, `exit ${r.status}`);
    ok('and leaves the previous output exactly as it was', fs.readFileSync(out, 'utf8') === 'the previous build');
    ok('and no workspace of its own behind', JSON.stringify(after) === JSON.stringify(before), after.filter(x => !before.includes(x)).join(', ') || 'none');
    ok('and no step files in build/ itself', !fs.existsSync(path.join(ROOT, 'build', 'stage0.html')));
    /* Where the steps are written, from the source: a run that is not --keep
       or --from must not share build/<step>.html. Read blanked, as the rule is. */
    const { blankComments } = require('./_source.js');
    const src = blankComments(fs.readFileSync(path.join(ROOT, 'scripts', 'build.js'), 'utf8'));
    const { replaceWhole } = require('../scripts/atomic.js');
    const dest = path.join(TMP, 'dest.html'); replaceWhole(dest, 'whole');
    ok('the finished file is put in place whole', fs.readFileSync(dest, 'utf8') === 'whole' && !fs.readdirSync(TMP).some(f => /\.tmp-/.test(f)));
    const asDir = path.join(TMP, 'out-is-a-folder'); fs.mkdirSync(asDir); fs.writeFileSync(path.join(asDir, 'x'), 'x');
    let threw = false; try { replaceWhole(asDir, 'zqlicensed'); } catch (_) { threw = true; }
    /* A write that fails after the file exists (a full disk): the partial file goes. */
    const realWrite = fs.writeFileSync;
    fs.writeFileSync = (f, b) => { realWrite(f, String(b).slice(0, 3)); throw new Error('ENOSPC: no space left'); };
    let threwW = false; try { replaceWhole(path.join(TMP, 'full-disk.html'), 'zqlicensed bytes'); } catch (_) { threwW = true; }
    fs.writeFileSync = realWrite;
    ok('a write that fails part-way leaves no partial copy either', threwW && !fs.readdirSync(TMP).some(f => /\.tmp-/.test(f)), fs.readdirSync(TMP).filter(f => /\.tmp-/.test(f)).join(', ') || 'none');
    ok('and when it cannot be, no copy of it is left beside the destination', threw && !fs.readdirSync(TMP).some(f => /\.tmp-/.test(f)), fs.readdirSync(TMP).filter(f => /\.tmp-/.test(f)).join(', ') || 'none');
    ok('a normal run\'s workspace is build/.work/run-<pid>-<time>, and only --keep or --from share build/',
       /const SHARED = KEEP \|\| !!FROM;/.test(src) && /'\.work', `run-\$\{process\.pid\}-\$\{Date\.now\(\)\}`/.test(src));
  }

  head('suite tags: read from each suite\'s code');
  {
    const { tagsOf } = require('./_targets.js');
    ok('a suite that launches a browser and reads a build is browser and build', JSON.stringify(tagsOf('home')) === '["browser","build"]', JSON.stringify(tagsOf('home')));
    ok('one that only launches a browser is browser', JSON.stringify(tagsOf('bankstore')) === '["browser"]', JSON.stringify(tagsOf('bankstore')));
    ok('one that does neither is pure — verify-engine requires _engine and launches nothing', JSON.stringify(tagsOf('engine')) === '["pure"]', JSON.stringify(tagsOf('engine')));
    ok('and so is this one, which runs verify.js and build.js but launches nothing', JSON.stringify(tagsOf('devtools-pure')) === '["pure"]', JSON.stringify(tagsOf('devtools-pure')));
    ok('a suite that spawns a tool which launches a browser is a browser suite', tagsOf('figprobe').includes('browser'), JSON.stringify(tagsOf('figprobe')));
    /* The CI logic job is the set of pure suites CI can run: every one of
       them must be tagged pure, or the tag and the job disagree. */
    const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'verify.yml'), 'utf8');
    const logic = yml.slice(yml.indexOf('\n  logic:'), yml.indexOf('\n  memorizer-browser:'));
    const inLogic = [...logic.matchAll(/node\s+tests\/verify-([a-z0-9-]+)\.js/g)].map(m => m[1]);
    const notPure = inLogic.filter(n => tagsOf(n).join() !== 'pure');
    ok('every suite in CI\'s logic job is tagged pure', inLogic.length > 20 && notPure.length === 0, notPure.join(', ') || `${inLogic.length} suites`);
  }

  head('verify.js --tag and --report-json');
  {
    const target = path.join(TMP, 'target.html'); fs.writeFileSync(target, 'x');
    const rep = path.join(TMP, 'report.json');
    const r = node([path.join(ROOT, 'scripts', 'verify.js'), target, '--only', 'engine,keys', '--tag', 'pure', '--report-json', rep]);
    let doc = null; try { doc = JSON.parse(fs.readFileSync(rep, 'utf8')); } catch (_) {}
    ok('--tag pure runs only the pure ones of those asked for', !!doc && doc.suites.map(s => s.suite).join() === 'engine', doc ? doc.suites.map(s => s.suite).join() : `no report (exit ${r.status})`);
    ok('the report says suite, tags, status, counts and time', !!doc && doc.format === 'systole-verify-report' && doc.suites[0].status === 'pass' &&
       doc.suites[0].checks > 50 && doc.suites[0].checks === doc.suites[0].passed && JSON.stringify(doc.suites[0].tags) === '["pure"]' && doc.suites[0].durationMs > 0,
       doc ? JSON.stringify(doc.suites[0]) : '');
    ok('and no line of output and no path', !!doc && !/PASS|FAIL|→/.test(JSON.stringify(doc)) && !JSON.stringify(doc).includes(TMP) && doc.target === 'file');
    const bad = node([path.join(ROOT, 'scripts', 'verify.js'), target, '--tag', 'zqtag']);
    ok('a tag that is not one is refused before anything runs', bad.status === 1 && /is not a tag/.test(bad.stderr), bad.stderr.trim().split('\n')[0]);
    /* SYSTOLE_JOBS is a machine's default for --jobs. Each case passes it
       explicitly, so a machine that sets it for itself does not change what
       is measured here. */
    const jobsRun = (extra, v) => node([path.join(ROOT, 'scripts', 'verify.js'), target, '--only', 'engine', '--tag', 'pure'].concat(extra), { SYSTOLE_JOBS: v });
    const line = r => ((r.stdout || '').split('\n').find(l => /at a time/.test(l)) || (r.stderr || '').trim().split('\n')[0] || `exit ${r.status}`).trim();
    const j2 = jobsRun([], '2');
    ok('SYSTOLE_JOBS sets how many run at once', j2.status === 0 && /, 2 at a time/.test(j2.stdout), line(j2));
    const j1 = jobsRun(['--jobs', '1'], '3');
    ok('and --jobs on the command line wins over it', j1.status === 0 && /one at a time/.test(j1.stdout), line(j1));
    const jbad = jobsRun([], 'fast');
    ok('a SYSTOLE_JOBS that is not a count is refused before anything runs', jbad.status === 1 && /SYSTOLE_JOBS "fast" is not a number of jobs/.test(jbad.stderr) && !/passed/.test(jbad.stdout), line(jbad));
    const jstale = jobsRun(['--jobs', '2'], 'fast');
    ok('but not when --jobs says how many: a stale default does not stop the run', jstale.status === 0 && /, 2 at a time/.test(jstale.stdout), line(jstale));
    /* No browser installed: a pure selection still runs. PLAYWRIGHT_BROWSERS_PATH
       pointed at an empty folder makes every engine's executable missing. */
    const empty = path.join(TMP, 'no-browsers'); fs.mkdirSync(empty);
    const nb = node([path.join(ROOT, 'scripts', 'verify.js'), target, '--only', 'engine', '--tag', 'pure'], { PLAYWRIGHT_BROWSERS_PATH: empty });
    ok('with no browser installed, a pure selection still runs', nb.status === 0 && !/no browser installed/.test(nb.stderr), (nb.stderr || '').trim().split('\n')[0] || `exit ${nb.status}`);
    const nbb = node([path.join(ROOT, 'scripts', 'verify.js'), target, '--only', 'bankstore'], { PLAYWRIGHT_BROWSERS_PATH: empty });
    ok('and a browser selection is still refused, naming the install', nbb.status === 1 && /npx playwright install/.test(nbb.stderr), (nbb.stderr || '').trim().split('\n')[0]);
    /* No build at all — a clean checkout, no export — and a pure selection. */
    const nobuild = node([path.join(ROOT, 'scripts', 'verify.js'), path.join(TMP, 'no-such-build.html'), '--only', 'engine', '--tag', 'pure']);
    ok('with no build, a pure selection still runs', nobuild.status === 0 && !/No build at/.test(nobuild.stderr), (nobuild.stderr || '').trim().split('\n')[0] || `exit ${nobuild.status}`);
    const nobuild2 = node([path.join(ROOT, 'scripts', 'verify.js'), path.join(TMP, 'no-such-build.html'), '--only', 'keys']);
    ok('and a suite that reads a build is refused without one, saying how to make it', nobuild2.status === 1 && /No build at/.test(nobuild2.stderr) && /--tag pure/.test(nobuild2.stderr), (nobuild2.stderr || '').trim().split('\n')[0]);
    const nbp = node([path.join(ROOT, 'scripts', 'verify.js'), target, '--only', 'engine', '--tag', 'pure', '--pwa'], { PLAYWRIGHT_BROWSERS_PATH: empty });
    ok('--pwa needs a browser whatever the selection, and says so before running anything', nbp.status === 1 && /npx playwright install|playwright is not installed/.test(nbp.stderr) && !/passed/.test(nbp.stdout),
       (nbp.stderr || '').trim().split('\n')[0]);
    const dirAsFile = path.join(TMP, 'a-folder'); fs.mkdirSync(dirAsFile);
    const nr = node([path.join(ROOT, 'scripts', 'verify.js'), target, '--only', 'engine', '--report-json', dirAsFile]);
    ok('a report that cannot be written fails the run', nr.status !== 0 && /could not write --report-json/.test(nr.stderr), `exit ${nr.status}`);
    /* --pwa's phases run outside the suite loop and must be in the report
       too. The stand-in target is not a build, so build-pwa refuses it: the
       report must show that phase failed, not only the suites that passed. */
    const rp = path.join(TMP, 'pwa-report.json');
    /* --pwa asks for a browser before anything runs, and CI's logic job has
       no playwright. A stand-in module on NODE_PATH answers that check (its
       "browser" is node itself, a file that exists).

       WHERE A REAL PLAYWRIGHT IS INSTALLED, IT IS FOUND FIRST, and it used to
       be trusted to "answer just the same". It does only if its browsers were
       downloaded: installed without them, the run stopped at "no browser
       installed" and this check failed on the machine, not on the code. So the
       real one is pointed at a browsers folder in TMP holding a stand-in file
       at the path it will ask for. Either way the run reaches the split build,
       whatever this machine has installed. */
    const fakeMods = path.join(TMP, 'fake_modules', 'playwright');
    fs.mkdirSync(fakeMods, { recursive: true });
    fs.writeFileSync(path.join(fakeMods, 'index.js'), `const e = { executablePath: () => ${JSON.stringify(process.execPath)} }; module.exports = { chromium: e, webkit: e, firefox: e };`);
    const fakeBrowsers = path.join(TMP, 'fake-browsers');
    const pwEnv = { NODE_PATH: path.join(TMP, 'fake_modules'), PLAYWRIGHT_BROWSERS_PATH: fakeBrowsers };
    const wants = spawnSync(process.execPath, ['-e',
      `try { process.stdout.write(require(require.resolve('playwright', { paths: [${JSON.stringify(ROOT)}] })).chromium.executablePath()); } catch (_) {}`],
      { encoding: 'utf8', env: Object.assign({}, process.env, pwEnv) }).stdout;
    /* Only ever inside fakeBrowsers. With no real playwright the probe finds
       the stand-in module above, whose answer is node's own binary: the first
       draft of this line tried to overwrite it, and was stopped only by the
       file being in use. */
    if (wants && path.resolve(wants).startsWith(fakeBrowsers + path.sep) && !fs.existsSync(wants)) {
      fs.mkdirSync(path.dirname(wants), { recursive: true }); fs.writeFileSync(wants, '');
    }
    const pw = node([path.join(ROOT, 'scripts', 'verify.js'), target, '--only', 'engine', '--pwa', '--report-json', rp], pwEnv);
    let pd = null; try { pd = JSON.parse(fs.readFileSync(rp, 'utf8')); } catch (_) {}
    const bp = pd && pd.suites.find(x => x.suite === 'build-pwa');
    ok('with --pwa, a split build that fails is in the report as failed', pw.status !== 0 && !!bp && bp.status === 'fail' && JSON.stringify(bp.tags) === '["pwa"]',
       pd ? pd.suites.map(x => x.suite + ':' + x.status).join(', ') : `no report (exit ${pw.status})`);
    /* A failing suite is reported as failing: a stand-in suite in a copy of
       the registry would need a copy of the repository, so this reads the
       mapping from the source instead. */
    const { blankComments } = require('./_source.js');
    const vsrc = blankComments(fs.readFileSync(path.join(ROOT, 'scripts', 'verify.js'), 'utf8'));
    ok('a suite that died is "died", one that failed is "fail" — never "pass"', /status: r\.failed === null \? 'died' : \(r\.ok \? 'pass' : 'fail'\)/.test(vsrc));
    const { countsOf } = require('../scripts/cause.js');
    const died = countsOf('  PASS  a\n  PASS  b\n  FAIL  c\nTypeError: x\n');
    ok('a suite that died after some checks is counted for what it ran, and marked as never reporting',
       died.passed === 2 && died.checks === 3 && died.failed === null && died.reported === false, JSON.stringify(died));
    ok('and one that reported is counted from its summary', JSON.stringify(countsOf('  PASS  a\n5 passed, 1 failed\n')) === '{"passed":5,"failed":1,"checks":6,"reported":true}');
    ok('the report takes its counts from that, for suites and for the --pwa phases', /const c = countsOf\(r\.out\)/.test(vsrc) && /\.countsOf\(out\)/.test(vsrc));
  }

  head('npm run doctor');
  {
    const { diagnose, format } = require('../scripts/doctor.js');
    const fakeRoot = path.join(TMP, 'doc'); fs.mkdirSync(path.join(fakeRoot, 'source'), { recursive: true });
    fs.writeFileSync(path.join(fakeRoot, 'package.json'), JSON.stringify({ engines: { node: '>=20' } }));
    fs.writeFileSync(path.join(fakeRoot, 'source', 'ACCSAP_zqsecret_title.html'), 'x');
    const base = { npmVersion: () => '10.0.0', git: () => 'git version 2', gitDirty: () => false, hooksPath: () => '.githooks',
                   playwright: () => ({ chromium: { executablePath: () => '/c' }, webkit: { executablePath: () => '/w' } }),
                   exists: p => p === '/c' || p === '/w' || fs.existsSync(p), portFree: async () => true, env: () => undefined };
    const good = format(await diagnose({ root: fakeRoot, probes: Object.assign({}, base, { nodeVersion: () => '20.11.0' }) }));
    ok('a ready machine exits 0 and says so', good.code === 0 && /Ready: npm test/.test(good.text), good.text.split('\n').pop());
    const old = format(await diagnose({ root: fakeRoot, probes: Object.assign({}, base, { nodeVersion: () => '18.19.0' }) }));
    ok('Node older than package.json wants is required: exit 1, with the fix', old.code === 1 && /✗ Node .*18\.19\.0/.test(old.text) && /fix: install Node 20/.test(old.text), old.text.split('\n')[0]);
    const noPw = format(await diagnose({ root: fakeRoot, probes: Object.assign({}, base, { nodeVersion: () => '22.0.0', playwright: () => null }) }));
    ok('no test tools is a warning, not a failure, and names npm ci', noPw.code === 0 && /! test tools \(playwright\)\s+not installed\n\s+fix: npm ci/.test(noPw.text));
    const noWk = format(await diagnose({ root: fakeRoot, probes: Object.assign({}, base, { nodeVersion: () => '22.0.0', exists: p => p === '/c' || fs.existsSync(p) }) }));
    ok('a missing browser names the install command for that browser', /! webkit for the browser suites\s+not installed\n\s+fix: npx playwright install webkit/.test(noWk.text));
    ok('the export is counted, never named', /licensed export.*1 found in source\//.test(good.text) && !/zqsecret/.test(good.text + old.text + noPw.text));
  }

  head('npm run clean, and clean:private');
  {
    const { clean } = require('../scripts/clean.js');
    const R = path.join(TMP, 'repo');
    const put = (rel, body) => { const f = path.join(R, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body || 'x'); };
    ['source/ACCSAP_export.html', 'content/refs-repo/note.md', 'content/refs/unit.md', 'content/questions.json', 'content/manifest.json',
     'content/figures/a.webp', 'build/systole.html', 'build/.work/run-1/stage0.html', 'dist/index.html', 'dist-memorizer/index.html'].forEach(f => put(f));
    const has = rel => fs.existsSync(path.join(R, rel));
    const pub = clean({ root: R });
    ok('the public clean removes only what a clone makes again without the export',
       !has('dist-memorizer') && !has('build/.work') && has('build/systole.html') && has('dist/index.html') && has('content/questions.json'), pub.removed.join(', '));
    const dry = clean({ root: R, private: true });
    ok('the private clean without --yes removes nothing, lists what it would, and exits non-zero',
       dry.code === 1 && has('build/systole.html') && has('dist/index.html') && dry.listed.length === 5, dry.listed.join(', '));
    const wet = clean({ root: R, private: true, yes: true });
    ok('with --yes it removes build/, dist/ and the three files extract-content writes',
       wet.code === 0 && !has('build') && !has('dist') && !has('content/questions.json') && !has('content/manifest.json') && !has('content/figures'), wet.removed.join(', '));
    ok('and never the export, the notes, or the notes\' submodule',
       has('source/ACCSAP_export.html') && has('content/refs/unit.md') && has('content/refs-repo/note.md'));
  }

  head('scripts/serve.js: a bad request fails, the server does not');
  {
    /* docs/IPAD.md offers serve.js as a host over Tailscale, so one request
       must not be able to stop it. "/%ZZ" made decodeURIComponent throw and
       the process exit 1; a file that failed to read emitted an 'error' no
       one listened for, which is the same exit. */
    const http = require('http'), net = require('net');
    const dir = path.join(TMP, 'serve'); fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), 'home');
    /* A file that opens but cannot be read, or cannot be opened at all. Mode
       000 does that for anyone but root, who ignores it; as root (this
       session's container), a link to /proc/self/mem opens and then fails its
       first read with EIO. Neither available means unmeasured, said aloud. */
    const bad = path.join(dir, 'unreadable.bin');
    const asRoot = process.getuid && process.getuid() === 0;
    let badHow = null;
    if (asRoot && fs.existsSync('/proc/self/mem')) { fs.symlinkSync('/proc/self/mem', bad); badHow = 'a link to /proc/self/mem'; }
    else if (!asRoot) { fs.writeFileSync(bad, 'secret'); fs.chmodSync(bad, 0o000); badHow = 'mode 000'; }
    const port = await new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
    const { spawn } = require('child_process');
    const srv = spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve.js'), String(port), dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let exited = null; srv.on('exit', c => { exited = c; });
    await new Promise(r => { srv.stdout.on('data', d => { if (/serving/.test(String(d))) r(); }); setTimeout(r, 5000); });
    const get = p => new Promise(resolve => {
      const q = http.request({ host: '127.0.0.1', port, path: p, method: 'GET' },
        r => { let b = ''; r.on('data', d => b += d); r.on('end', () => resolve({ status: r.statusCode, body: b })); r.on('error', () => resolve({ status: r.statusCode, body: 'cut' })); });
      q.on('error', () => resolve({ status: 0, body: '' })); q.setTimeout(5000, () => { q.destroy(); }); q.end();
    });
    ok('the server starts and serves a file', (await get('/index.html')).status === 200);
    /* The root guard, here as well as in verify-pwa, which needs the real
       build: a sibling whose name starts with the root's, and a plain walk up.
       Sent raw, since a normalising client would resolve the ".." itself. */
    fs.mkdirSync(dir + '-old'); fs.writeFileSync(path.join(dir + '-old', 'secret.txt'), 'next door');
    const sib = await get('/../' + path.basename(dir) + '-old/secret.txt');
    ok('a sibling folder sharing the root\'s name prefix is not served', sib.status === 403 || sib.status === 404, `${sib.status} ${sib.body.slice(0, 20)}`);
    const up = await get('/../../../../../../etc/hostname');
    ok('and neither is a walk upwards', up.status === 403 || up.status === 404, String(up.status));
    const malformed = await get('/%ZZ');
    ok('a malformed escape is a 400', malformed.status === 400, String(malformed.status));
    const after1 = await get('/index.html');
    ok('and the server is still there afterwards', after1.status === 200 && exited === null, `status ${after1.status}, exit ${exited}`);
    if (badHow) {
      const unread = await get('/unreadable.bin');
      /* Narrow: a crashed server also answers "not a 200". Whether the
         server survived is the next check's; this one only says the file
         was not passed off as served. */
      ok(`a file that cannot be read (${badHow}) is not answered as a complete 200`, unread.status !== 200 || unread.body === 'cut' || unread.body === '',
         `status ${unread.status}`);
      const after2 = await get('/index.html');
      ok('and the server is still there after that too', after2.status === 200 && exited === null, `status ${after2.status}, exit ${exited}`);
    } else {
      console.log('  ----  unmeasured: no way to make an unreadable file here (root without /proc)');
    }
    srv.kill();
    try { fs.chmodSync(bad, 0o600); } catch (_) {}
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
