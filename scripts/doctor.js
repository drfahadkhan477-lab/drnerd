#!/usr/bin/env node
/*
 * Is this machine ready to work on Systole?   npm run doctor
 *
 * One command that answers the questions a fresh clone, a Codespace or a
 * returning laptop otherwise answers one failure at a time: is Node new
 * enough, are the test tools and browsers installed, are the git hooks on,
 * and is the licensed export here — which only the private commands need.
 * Each line says what is wrong and the command that fixes it.
 *
 * REQUIRED vs NOT. Node, npm and git are required: nothing works without
 * them, and the exit code is 1 when one fails. Everything else is a warning
 * for the commands that need it — `npm run test:pure` needs no browser, and
 * `npm test` needs no export — so a machine without the export is not
 * "broken", it is a machine for the no-export half.
 *
 * NOTHING LICENSED IS PRINTED. The export is counted, never named: a file
 * name can carry the bank's title. Same rule as every report here.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const net = require('net');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

const run = (cmd, args, cwd) => {
  try { return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: process.platform === 'win32' }).trim(); }
  catch (_) { return null; }
};

/* Each probe is replaceable, so tests/verify-devtools-pure.js can drive
   every verdict without changing the machine it runs on. */
const PROBES = {
  nodeVersion: () => process.versions.node,
  npmVersion: root => run('npm', ['--version'], root),
  git: root => run('git', ['--version'], root),
  gitDirty: root => { const s = run('git', ['status', '--porcelain'], root); return s === null ? null : s.length > 0; },
  hooksPath: root => run('git', ['config', 'core.hooksPath'], root),
  playwright: root => { try { return require(require.resolve('playwright', { paths: [root] })); } catch (_) { return null; } },
  exists: p => fs.existsSync(p),
  portFree: port => new Promise(res => {
    const s = net.createServer();
    s.once('error', () => res(false));
    s.once('listening', () => s.close(() => res(true)));
    s.listen(port, '127.0.0.1');
  }),
  env: k => process.env[k],
  readdir: d => { try { return fs.readdirSync(d); } catch (_) { return []; } },
};

/* → [{ name, level: 'required'|'warn'|'info', ok, detail, fix }] */
async function diagnose(opts) {
  const o = opts || {};
  const root = o.root || ROOT;
  const p = Object.assign({}, PROBES, o.probes || {});
  const out = [];
  const add = (name, level, ok, detail, fix) => out.push({ name, level, ok: !!ok, detail: detail || '', fix: fix || '' });

  let engines = '>=20';
  try { engines = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).engines.node || engines; } catch (_) {}
  const need = +((engines.match(/(\d+)/) || [])[1] || 20);
  const have = String(p.nodeVersion() || '0');
  add('Node', 'required', +have.split('.')[0] >= need, `${have} (package.json wants ${engines})`,
      `install Node ${need} or newer (.node-version says which)`);

  const npm = p.npmVersion(root);
  add('npm', 'required', !!npm, npm || 'not found', 'npm comes with Node: reinstall Node');

  const git = p.git(root);
  add('git', 'required', !!git, git || 'not found', 'install git');
  if (git) {
    const dirty = p.gitDirty(root);
    add('working tree', 'info', dirty === false, dirty === null ? 'not a git checkout' : (dirty ? 'has uncommitted changes' : 'clean'), '');
    const hooks = p.hooksPath(root);
    add('leak-guard hook', 'warn', hooks === '.githooks', hooks ? `core.hooksPath is ${hooks}` : 'not on', 'npm run hooks');
  }

  const pw = p.playwright(root);
  add('test tools (playwright)', 'warn', !!pw, pw ? 'installed' : 'not installed', 'npm ci');
  for (const engine of ['chromium', 'webkit']) {
    let exe = null;
    try { exe = pw && pw[engine] && pw[engine].executablePath(); } catch (_) { exe = null; }
    const there = !!exe && p.exists(exe);
    add(`${engine} for the browser suites`, 'warn', there, there ? 'installed' : (pw ? 'not installed' : 'needs the test tools first'),
        `npx playwright install ${engine}`);
  }

  const src = p.env('SYSTOLE_SRC');
  const found = src ? (p.exists(src) ? 1 : 0)
    : [path.join(root, 'source'), root].reduce((n, d) => n + p.readdir(d).filter(f => /\.html?$/i.test(f) && /accsap/i.test(f)).length, 0);
  add('licensed export (only for build and test:private)', 'info', found > 0,
      src ? (found ? 'SYSTOLE_SRC points at a file' : 'SYSTOLE_SRC points at nothing') : `${found} found in source/`,
      'put your export in source/, or set SYSTOLE_SRC');
  const built = p.exists(path.join(root, 'build', 'systole.html'));
  add('a build to test (build/systole.html)', 'info', built, built ? 'present' : 'none yet', 'npm run build -- path/to/your-export.html');

  const free = await p.portFree(8080);
  add('port 8080 for npm run serve', 'info', free, free ? 'free' : 'in use', 'stop what is on 8080, or serve on another port');
  return out;
}

function format(rows) {
  const mark = r => r.ok ? '✓' : (r.level === 'required' ? '✗' : (r.level === 'warn' ? '!' : '·'));
  const lines = rows.map(r => `  ${mark(r)} ${r.name.padEnd(48)} ${r.detail}` + (!r.ok && r.fix ? `\n      fix: ${r.fix}` : ''));
  const broken = rows.filter(r => !r.ok && r.level === 'required');
  const warned = rows.filter(r => !r.ok && r.level === 'warn');
  lines.push('');
  lines.push(broken.length ? `  ${broken.length} required thing(s) missing — fix those first.`
    : warned.length ? `  Ready for npm run test:pure. ${warned.length} warning(s) for the browser suites or hooks.`
    : '  Ready: npm test runs everything that needs no export.');
  return { text: lines.join('\n'), code: broken.length ? 1 : 0 };
}

module.exports = { diagnose, format, PROBES };

if (require.main === module) {
  diagnose().then(rows => {
    const f = format(rows);
    console.log('\nSystole doctor\n\n' + f.text + '\n');
    process.exit(f.code);
  }).catch(e => { console.error(e); process.exit(1); });
}
