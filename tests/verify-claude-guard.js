#!/usr/bin/env node
/*
 * The Claude Code guard refuses what CLAUDE.md forbids, and lets work through.
 *
 *   node tests/verify-claude-guard.js
 *
 * Pure Node, no browser, no build, no export. .claude/hooks/guard.js decides
 * before a tool runs; this suite feeds it the calls a session makes.
 *
 * BOTH HALVES, as in verify-leakguard: a guard that blocks ordinary work gets
 * switched off, which is worse than none. So every refusal sits beside the
 * look-alike that must pass (a suite run on build/, a pattern named "build",
 * docs/CONTENT-SCHEMA.md). And the last block reads .claude/settings.json:
 * a guard that is correct but not wired to the tools it judges is a check
 * that passes without measuring anything.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const GUARD = path.join(ROOT, '.claude', 'hooks', 'guard.js');
const { decide } = require(GUARD);
const call = (tool_name, tool_input, root = ROOT) => decide({ tool_name, tool_input, cwd: root }, root);
const bash = (command, root) => call('Bash', { command }, root);

head('the file tools: licensed paths refused, look-alikes not');
{
  ok('Read of content/questions.json is refused', !!call('Read', { file_path: path.join(ROOT, 'content', 'questions.json') }));
  ok('and of a relative build/ path', !!call('Read', { file_path: 'build/systole.html' }));
  ok('and of source/, dist/, and the run log that quotes question text',
     ['source/x.pdf', 'dist/app.js', 'tests/last-run.log'].every(p => call('Read', { file_path: p })));
  ok('and of the refs submodule, whose markdown is the corpus', !!call('Read', { file_path: 'content/refs-repo/ch1.md' }));
  ok('and a path that only reaches it by ..', !!call('Read', { file_path: path.join(ROOT, 'tests', '..', 'content', 'q.json') }));
  ok('Edit and Write are refused there too',
     !!call('Edit', { file_path: 'dist/app.js', old_string: 'a', new_string: 'b' }) && !!call('Write', { file_path: 'build/x.html', content: '' }));
  ok('while README.md is read', call('Read', { file_path: path.join(ROOT, 'README.md') }) === null);
  ok('and names that merely start alike are not refused',
     ['docs/CONTENT-SCHEMA.md', 'tests/verify-contentrules.js', 'scripts/build.js', 'builder/x.js', 'distance.md']
       .every(p => call('Read', { file_path: p }) === null));
  ok('and a file outside the repository is none of its business', call('Read', { file_path: '/tmp/content/x' }) === null);
  ok('Grep with a path in content/ is refused', !!call('Grep', { pattern: 'stem', path: 'content' }));
  ok('Grep with no path is not', call('Grep', { pattern: 'stem' }) === null);
  ok('Glob into dist/ is refused, Glob over the repo is not',
     !!call('Glob', { pattern: 'dist/**/*.js' }) && call('Glob', { pattern: '**/*.js' }) === null);
}

head('the shell: reading refused, running allowed');
{
  const refused = [
    'cat content/questions.json',
    'head -c 300 build/systole.html | less',
    'grep -rn "stem" ./source',
    'cd tests && sed -n 1,5p "../dist/app.js"',
    'echo hi; tail tests/last-run.log',
    `python3 -c "print(open('content/questions.json').read()[:500])"`,
    `node -e "console.log(require('fs').readFileSync('build/systole.html','utf8'))"`,
  ];
  const r = refused.filter(c => !bash(c));
  ok('each way of printing a licensed file is refused', r.length === 0, r.join(' | ') || `${refused.length} refused`);
  const allowed = [
    'node tests/verify-home.js build/systole.html',
    'npm run build',
    'ls content/',
    'grep -n build scripts/build.js',
    'grep -rn "content/" scripts/leak-guard.js',
    'git status --short',
    'cat README.md | head -5',
  ];
  const a = allowed.filter(c => bash(c));
  ok('and running a suite on a build, listing, or grepping for the word is not', a.length === 0, a.join(' | ') || `${allowed.length} allowed`);
}

head('a commit: refused while leak-guard refuses what is staged');
{
  /* The real leak-guard, in a throwaway repository, so this one's index is
     never touched. */
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-guard-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
  git('init', '-q');
  fs.mkdirSync(path.join(repo, 'scripts'));
  fs.copyFileSync(path.join(ROOT, 'scripts', 'leak-guard.js'), path.join(repo, 'scripts', 'leak-guard.js'));
  fs.writeFileSync(path.join(repo, 'notes.md'), 'ordinary\n');
  git('add', 'notes.md');
  ok('an ordinary staged file commits', bash('git commit -m x', repo) === null, String(bash('git commit -m x', repo)).slice(0, 80));
  fs.mkdirSync(path.join(repo, 'content'));
  fs.writeFileSync(path.join(repo, 'content', 'questions.json'), '{}');
  git('add', '-f', 'content/questions.json');
  const why = bash('git add -A && git commit -m "add bank"', repo);
  ok('a staged content/ file blocks the commit, and the reason names it', !!why && /content\/questions\.json/.test(why), String(why).split('\n')[0]);
  ok('as does the same commit with options before the verb', !!bash('git -c core.pager=cat commit -m x', repo));
  fs.rmSync(repo, { recursive: true, force: true });
}

head('as Claude Code runs it: stdin in, exit 2 to block');
{
  const run = input => spawnSync(process.execPath, [GUARD], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT } });
  let r = run(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'content/questions.json' }, cwd: ROOT }));
  ok('a refused call exits 2 with the reason on stderr', r.status === 2 && /licensed/.test(r.stderr), `${r.status} ${r.stderr.trim().slice(0, 60)}`);
  r = run(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'README.md' }, cwd: ROOT }));
  ok('an allowed one exits 0, silently', r.status === 0 && r.stderr === '', `${r.status}`);
  r = run('not json');
  ok('input it cannot read is not its to judge: exit 0', r.status === 0, `${r.status}`);
}

head('and it is wired to the tools it judges');
{
  let s = {};
  try { s = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'settings.json'), 'utf8')); } catch (_) {}
  const pre = ((s.hooks || {}).PreToolUse || []);
  const entry = pre.find(e => (e.hooks || []).some(h => /\.claude\/hooks\/guard\.js/.test(h.command || '')));
  ok('settings.json runs guard.js on PreToolUse', !!entry, pre.length ? `${pre.length} PreToolUse entr(ies)` : 'none');
  const m = new RegExp('^(?:' + ((entry && entry.matcher) || '$^') + ')$');
  const tools = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'NotebookEdit', 'Bash'];
  const missed = tools.filter(t => !m.test(t));
  ok('and its matcher covers every tool the guard decides on', missed.length === 0, missed.join(', ') || tools.join('|'));
  const start = ((s.hooks || {}).SessionStart || []).flatMap(e => e.hooks || []);
  ok('a SessionStart hook turns the pre-commit hook on in a fresh clone',
     start.some(h => /session-start\.sh/.test(h.command || '')) &&
     /core\.hooksPath \.githooks/.test(fs.readFileSync(path.join(ROOT, '.claude', 'hooks', 'session-start.sh'), 'utf8')));
  const mode = execFileSync('git', ['ls-files', '-s', '.claude/hooks/session-start.sh'], { cwd: ROOT, encoding: 'utf8' }).split(/\s+/)[0];
  ok('and git records it as executable, so it can run', mode === '100755', mode || 'not tracked yet');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
