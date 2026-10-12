#!/usr/bin/env node
/*
 * PreToolUse guard for Claude Code sessions in this repository.
 *
 * CLAUDE.md says the licensed export is never read as a document and its
 * question text never quoted into a transcript, and that nothing licensed is
 * committed. Until this file those were requests. This makes three of them
 * refusals, decided by code before the tool runs:
 *
 *   1. Read / Grep / Glob / Edit / Write / NotebookEdit aimed inside source/,
 *      content/, build/, dist/ or at tests/last-run.log.
 *   2. A shell command whose reader (cat, grep, sed, …, or inline python/node
 *      code) names one of those paths. Running a suite ON a build
 *      (`node tests/verify-x.js build/systole.html`) is not reading it into
 *      the transcript and is allowed.
 *   3. `git commit` while scripts/leak-guard.js refuses what is staged — the
 *      pre-commit hook does this too, but only after `npm run hooks`, which a
 *      fresh cloud clone has never run.
 *
 * WHAT IT DOES NOT CLAIM. Rule 2 is a heuristic over the command's words: a
 * command can reach those files in ways it does not parse (a script file, a
 * variable, a cd in an earlier call). It catches the ordinary way of reading a file, which
 * is the way it happens by accident; it is not a sandbox. Rule 3 checks what
 * is staged when the command starts, so `git commit -a` is checked on the
 * index, not on what -a will add; CI's --all-tracked run covers the rest.
 *
 * Exit 2 with the reason on stderr is Claude Code's "block this call".
 * tests/verify-claude-guard.js proves each rule fires and that ordinary work
 * passes.
 */
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');

const DIRS = ['source', 'content', 'build', 'dist'];
const FILES = ['tests/last-run.log'];
/* Paths inside DIRS a person has decided Claude may read, with the reason.
   content/refs-repo is deliberately NOT here: it holds markdown exports of
   the corpus, and reading them quotes it into the transcript. */
const ALLOW = [];

const READERS = new Set(['cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg',
  'sed', 'awk', 'strings', 'xxd', 'od', 'hexdump', 'base64', 'jq', 'cut', 'tac', 'nl',
  'diff', 'cmp', 'unzip', 'zcat', 'pdftotext', 'tr', 'fold', 'column', 'iconv', 'view', 'vi', 'vim', 'nano']);
const PATTERNED = new Set(['grep', 'egrep', 'fgrep', 'rg', 'sed', 'awk', 'jq']);
const INLINE = new Set(['python', 'python3', 'node', 'perl', 'ruby']);

function protectedRel(rel) {
  rel = rel.split(path.sep).join('/').replace(/^\.\//, '');
  if (!rel || rel.startsWith('../') || rel === '..' || path.isAbsolute(rel)) return null;
  if (ALLOW.some(a => rel === a || rel.startsWith(a + '/'))) return null;
  if (FILES.includes(rel)) return rel;
  const top = rel.split('/')[0];
  return DIRS.includes(top) ? rel : null;
}

function inspectPath(p, root, cwd) {
  if (!p || typeof p !== 'string') return null;
  const abs = path.resolve(cwd, p);
  return protectedRel(path.relative(root, abs));
}

/* A path-looking word, with quotes and a leading glob or project prefix
   stripped. Only words that could name a path are tried. */
function wordHits(word, root, cwd) {
  const w = word.replace(/^['"]|['"]$/g, '');
  if (!w || w.startsWith('-')) return null;
  return inspectPath(w, root, cwd);
}

function segments(cmd) {
  return cmd.split(/\|\||&&|[|;\n&]/).map(s => s.trim()).filter(Boolean);
}
function words(seg) {
  return (seg.match(/'[^']*'|"[^"]*"|\S+/g) || []);
}
/* The program a segment runs, past env assignments and sudo/command/xargs. */
function program(ws) {
  let i = 0;
  while (i < ws.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[i]) || ['sudo', 'command', 'xargs', 'env', 'time', 'nice'].includes(ws[i]))) i++;
  return { name: path.basename(ws[i] || ''), rest: ws.slice(i + 1) };
}

function inspectBash(cmd, root, cwd) {
  for (const seg of segments(cmd)) {
    const ws = words(seg);
    const { name, rest } = program(ws);
    /* `cd tests && cat ../dist/x` — later segments resolve from where cd went. */
    if (name === 'cd') { cwd = path.resolve(cwd, (rest[0] || root).replace(/^['"]|['"]$/g, '')); continue; }
    if (READERS.has(name)) {
      /* grep's first operand is a pattern and sed's a script, not a file:
         `grep -n build scripts/build.js` reads no build/. Unless the pattern
         came by -e/-f, the first non-option word is skipped for these. */
      let skip = PATTERNED.has(name) && !rest.some(w => /^-[a-zA-Z]*[ef]$/.test(w));
      for (const w of rest) {
        if (skip && !w.startsWith('-')) { skip = false; continue; }
        const hit = wordHits(w, root, cwd); if (hit) return { rule: 'read', hit };
      }
    }
    if (INLINE.has(name) && rest.some(w => /^-[ce]$/.test(w))) {
      /* Inline code: any protected path anywhere in it, quoted or not. */
      const m = seg.match(new RegExp(`(?:^|[\\s'"(\\[,=])((?:\\./)?(?:${DIRS.join('|')})/[^\\s'"),\\]]*|tests/last-run\\.log)`));
      if (m) { const hit = protectedRel(m[1]); if (hit) return { rule: 'read', hit }; }
    }
    if (name === 'git' && rest.includes('commit')) return { rule: 'commit' };
  }
  return null;
}

function leakGuard(root) {
  try {
    execFileSync(process.execPath, [path.join(root, 'scripts', 'leak-guard.js')],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return null;
  } catch (e) {
    return ((e.stdout || '') + (e.stderr || '')).trim() || `leak-guard exited ${e.status}`;
  }
}

function decide(input, root) {
  const tool = input.tool_name || '';
  const ti = input.tool_input || {};
  const cwd = input.cwd || root;
  if (['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const hit = inspectPath(ti.file_path || ti.notebook_path, root, cwd);
    if (hit) return `Blocked: ${hit} is licensed content (or quotes it). CLAUDE.md: the export is built from, never read as a document or quoted into a transcript.`;
  }
  if (tool === 'Grep' || tool === 'Glob') {
    const hit = inspectPath(ti.path, root, cwd) || (tool === 'Glob' && inspectPath(String(ti.pattern || '').replace(/[*?[{].*$/, ''), root, cwd));
    if (hit) return `Blocked: searching ${hit} would read licensed content into the transcript. CLAUDE.md forbids it.`;
  }
  if (tool === 'Bash' && typeof ti.command === 'string') {
    const r = inspectBash(ti.command, root, cwd);
    if (r && r.rule === 'read') return `Blocked: this command reads ${r.hit}, which is licensed content (or quotes it). Run a suite on it instead of printing it.`;
    if (r && r.rule === 'commit') {
      const out = leakGuard(root);
      if (out) return `Blocked: leak-guard refuses what is staged, so this commit would publish licensed content.\n${out}`;
    }
  }
  return null;
}

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { raw += d; });
  process.stdin.on('end', () => {
    let input;
    try { input = JSON.parse(raw); } catch (_) { process.exit(0); }   /* not ours to judge */
    const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    const why = decide(input, root);
    if (why) { process.stderr.write(why + '\n'); process.exit(2); }
    process.exit(0);
  });
}

module.exports = { decide, inspectBash, protectedRel };
