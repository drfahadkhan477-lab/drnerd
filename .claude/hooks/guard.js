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
 *   2. A shell command whose reader (cat, grep, sed, sort, …, or inline
 *      python/node/perl/ruby code: an eval flag, a heredoc, a program on
 *      stdin, rule 2c) names one of those paths, or that redirects input
 *      from one (`cat <content/x`). Running a suite ON a build
 *      (`node tests/verify-x.js build/systole.html`) is not reading it into
 *      the transcript and is allowed. A recursive grep/rg is judged by the
 *      protected paths its walk reaches, not the words it names, unless the
 *      command excludes each one (rule 2b, above inspectSearch).
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

const READERS = new Set(['cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'zgrep',
  'sort', 'uniq', 'paste', 'fmt', 'rev', 'pr', 'bat', 'batcat', 'comm', 'join', 'expand', 'unexpand', 'look', 'xzcat', 'bzcat', 'zless', 'zmore',
  'sed', 'awk', 'strings', 'xxd', 'od', 'hexdump', 'base64', 'jq', 'cut', 'tac', 'nl',
  'diff', 'cmp', 'unzip', 'zcat', 'pdftotext', 'tr', 'fold', 'column', 'iconv', 'view', 'vi', 'vim', 'nano']);
const PATTERNED = new Set(['grep', 'egrep', 'fgrep', 'rg', 'zgrep', 'sed', 'awk', 'jq', 'look']);
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

/* ── Recursive search (rule 2b) ─────────────────────────────────────────
   `grep -rn X .`, or `grep -rn X` with no operand at all, names no
   protected path yet reads every one of them. So a recursive grep is judged
   by what it can REACH: each directory operand (none means ".", a glob
   means its literal parent) that is the root, an ancestor of it, or an
   ancestor of a protected path (tests/ holds the run log) reaches those
   paths, and each one reached must be excluded by the command itself:
     grep  --exclude-dir=G matching a directory on the way to it, or, for a
           file, --exclude=G matching its name. Nothing else counts (an
           --include does not: dist/ holds .js files).
     rg    the same with -g/--glob/--iglob '!G'; or rg's own ignore rules,
           which skip a .gitignored path when the root is a git checkout. That
           exemption holds only with no --no-ignore (or -u, --unrestricted), and
           only for paths `git check-ignore --no-index` confirms are ignored
           at the root, asked at decision time, so a .gitignore that stops
           listing one makes rg refusable again.
   git grep searches tracked files, where nothing licensed is (leak-guard);
   --no-index without --exclude-standard, or --no-exclude-standard, searches
   ignored files too, and is refused outright. */
const PROTECTED = [...DIRS, ...FILES].filter(p => protectedRel(p));
const GREP_ARG_SHORT = { grep: 'efmABCdD', egrep: 'efmABCdD', fgrep: 'efmABCdD', rg: 'efgtTmABCMjrEd' };
const GREP_ARG_LONG = new Set(['regexp', 'file', 'max-count', 'after-context', 'before-context', 'context',
  'directories', 'devices', 'exclude', 'exclude-dir', 'include', 'exclude-from', 'label', 'binary-files',
  'group-separator', 'glob', 'iglob', 'type', 'type-not', 'type-add', 'type-clear', 'max-columns', 'threads',
  'replace', 'encoding', 'max-depth', 'maxdepth', 'sort', 'sortr', 'colors', 'context-separator',
  'field-context-separator', 'field-match-separator', 'pre', 'pre-glob', 'path-separator', 'max-filesize',
  'ignore-file', 'dfa-size-limit', 'regex-size-limit', 'engine', 'hyperlink-format']);
const unquote = w => w.replace(/^['"]|['"]$/g, '');

/* A shell-ish glob as a regex over one path component. Braces expand only
   when the word was unquoted, since grep's own matcher has no braces. */
function globRe(g, braces) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[') { const j = g.indexOf(']', i + 1); if (j > i) { re += g.slice(i, j + 1); i = j; } else re += '\\['; }
    else if (braces && c === '{') { const j = g.indexOf('}', i); if (j > i) { re += '(?:' + g.slice(i + 1, j).split(',').map(s => s.replace(/[.+^$()|\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|') + ')'; i = j; } else re += '\\{'; }
    else re += c.replace(/[.+^$()|\\{}]/g, '\\$&');
  }
  /* A glob it cannot compile excludes nothing: the strict side, and no throw
     (a hook that throws exits 1, which Claude Code treats as "allow"). */
  try { return new RegExp('^' + re + '$'); } catch (_) { return /(?!)/; }
}

function gitIgnored(root, rels) {
  try {
    const out = execFileSync('git', ['-C', root, 'check-ignore', '--no-index', ...rels.map(r => DIRS.includes(r) ? r + '/' : r)],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return new Set(out.split('\n').map(s => s.replace(/\/$/, '')).filter(Boolean));
  } catch (e) {
    return new Set(String(e.stdout || '').split('\n').map(s => s.replace(/\/$/, '')).filter(Boolean));
  }
}

/* Protected paths (relative to root) a recursive walk from abs reaches. */
function reachable(abs, root) {
  const rel = path.relative(root, abs).split(path.sep).join('/');
  if (rel === '') return PROTECTED;
  if (rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) {
    const back = path.relative(abs, root);
    return (back.startsWith('..') || path.isAbsolute(back)) ? [] : PROTECTED;
  }
  return PROTECTED.filter(p => p.startsWith(rel + '/'));
}

function inspectSearch(name, rest, root, cwd) {
  const tool = name === 'rg' ? 'rg' : 'grep';
  const argShort = GREP_ARG_SHORT[name];
  let recursive = tool === 'rg', patternGiven = false, noIgnore = false, files = false, ended = false;
  const exDirs = [], exFiles = [], positionals = [];
  const take = (opt, val, quoted) => {
    if (opt === 'e' || opt === 'f' || opt === 'regexp' || opt === 'file') patternGiven = true;
    if ((opt === 'd' && tool === 'grep') || opt === 'directories') { if (unquote(val) === 'recurse') recursive = true; }
    if (opt === 'exclude-dir') exDirs.push(globRe(unquote(val), !quoted));
    if (opt === 'exclude') exFiles.push(globRe(unquote(val), !quoted));
    if (opt === 'g' || opt === 'glob' || opt === 'iglob') {
      const g = unquote(val);
      if (g.startsWith('!')) {
        const core = g.slice(1).replace(/^\/|^\*\*\//, '').replace(/\/\*\*$|\/$/, '');
        if (!core.includes('/')) { exDirs.push(globRe(core, !quoted)); exFiles.push(globRe(core, !quoted)); }
      }
    }
  };
  for (let i = 0; i < rest.length; i++) {
    const raw = rest[i], w = unquote(raw), quoted = /['"]/.test(raw);
    if (/^\d*[<>]/.test(w)) { if (/^\d*[<>]+&?$/.test(w)) i++; continue; }   /* a redirection, not an operand */
    if (ended || w === '-' || !w.startsWith('-')) { positionals.push(raw); continue; }
    if (w === '--') { ended = true; continue; }
    if (w.startsWith('--')) {
      const eq = w.indexOf('='), opt = eq < 0 ? w.slice(2) : w.slice(2, eq);
      if (opt === 'recursive' || opt === 'dereference-recursive') recursive = true;
      if (/^no-ignore(?!-messages)/.test(opt) || opt === 'unrestricted') noIgnore = true;
      if (opt === 'files') files = true;
      if (eq >= 0) take(opt, w.slice(eq + 1), quoted);
      else if (GREP_ARG_LONG.has(opt) && !(tool === 'grep' && /^(?:glob|iglob|type|replace|sort)$/.test(opt))) { take(opt, rest[i + 1] || '', /['"]/.test(rest[i + 1] || '')); i++; }
      continue;
    }
    for (let k = 1; k < w.length; k++) {
      const c = w[k];
      if (argShort.includes(c)) {
        const val = k + 1 < w.length ? w.slice(k + 1) : (rest[++i] || '');
        take(c, val, k + 1 < w.length ? quoted : /['"]/.test(val));
        break;
      }
      if (tool === 'grep' && (c === 'r' || c === 'R')) recursive = true;
      if (tool === 'rg' && c === 'u') noIgnore = true;
    }
  }
  if (!recursive) return null;
  const operands = (patternGiven || files) ? positionals : positionals.slice(1);
  const dirs = operands.length ? operands.map(unquote) : ['.'];
  let ignored = null;
  for (const d of dirs) {
    /* A glob operand: walk from its literal parent, and keep only the
       protected paths its glob components could expand to or above. */
    const lit = d.split('/'); const g = lit.findIndex(s => /[*?[]/.test(s));
    const dir = g < 0 ? d : (lit.slice(0, g).join('/') || (d.startsWith('/') ? '/' : '.'));
    const globs = g < 0 ? [] : lit.slice(g).filter(Boolean).map(s => globRe(s, true));   /* braces too: matching more is the strict side */
    const abs = path.resolve(cwd, dir);
    for (const p of reachable(abs, root)) {
      const parts = path.relative(abs, path.join(root, p)).split(path.sep);
      if (globs.length > parts.length || !globs.every((re, j) => re.test(parts[j]))) continue;
      const isFile = FILES.includes(p);
      const dirParts = isFile ? parts.slice(0, -1) : parts;
      if (dirParts.some(c => exDirs.some(re => re.test(c)))) continue;
      if (isFile && exFiles.some(re => re.test(parts[parts.length - 1]))) continue;
      if (tool === 'rg' && !noIgnore) {
        const back = path.relative(root, abs);
        if (!(back.startsWith('..') || path.isAbsolute(back))) {
          if (!ignored) ignored = gitIgnored(root, PROTECTED);
          if (ignored.has(p)) continue;
        }
      }
      return { rule: 'recursive', hit: p, from: d };
    }
  }
  return null;
}

/* ── Inline code (rule 2c) ───────────────────────────────────────────────
   An interpreter is running code that is not in a script file when:
     - a flag says so: python -c (alone or ending a cluster, -Ic); node -e,
       -p, -pe, --eval, --print; perl and ruby -e/-E alone or in a cluster
       (-ne, -pe, -lne, -0777ne);
     - its segment has a heredoc or here-string (`python3 <<'EOF'`), even
       one fed to a script file, whose body is then data it may open;
     - it has no script operand, or `-`, so it reads its program from stdin
       (`cat x.py | python3`, `node - <<EOF`); `python -m mod` is a module.
   In each case what it runs or opens is in the command text, so the whole
   command is scanned. A script file run with no heredoc is not inline code. */
const INLINE_PATH = new RegExp(`(?:^|[\\s'"(\\[,=<])((?:\\./)?(?:${DIRS.join('|')})/[^\\s'"),\\]]*|tests/last-run\\.log)`, 'g');
const EVAL_FLAG = {
  python: /^-[a-zA-Z]*c/, python3: /^-[a-zA-Z]*c/,
  node: /^(?:-[ep]{1,2}|--(?:eval|print)(?:=.*)?)$/,
  perl: /^-[a-zA-Z0-9:.]*[eE]/, ruby: /^-[a-zA-Z0-9:.]*[eE]/,
};
const INLINE_ARG = new Set(['-W', '-X', '-r', '--require', '--import', '-C', '--loader', '--experimental-loader', '-I']);
function inlineCode(name, rest, seg) {
  if (/<</.test(seg)) return true;
  if (rest.some(w => { const u = unquote(w); return (name === 'node' || !u.startsWith('--')) && EVAL_FLAG[name].test(u); })) return true;
  for (let i = 0; i < rest.length; i++) {
    const w = unquote(rest[i]);
    if (/^\d*[<>]/.test(w)) { if (/^\d*[<>]+&?$/.test(w)) i++; continue; }
    if (w === '-') return true;
    if (w === '-m') return false;
    if (INLINE_ARG.has(w)) { i++; continue; }
    if (!w.startsWith('-')) return false;
  }
  return true;
}

/* ── Reading a command line (all of rule 2) ───────────────────────────────
   Two readings, each a list of simple commands as their words (raw, quotes
   kept, which is what the rules unquote) and their text.

   split() is the old one: every |, ;, & and newline splits, quoted or not.
   It cuts `grep -c 'a|b' content/q.json` ahead of its file, so the file
   lands in a fragment no rule reads, and it cuts `grep -rn "a\|b" scripts`
   ahead of its directory. But it also splits quoted text the shell runs as
   code (`bash -c "make; cat content/q.json"`, eval '…'), which is why
   inspectBash still reads it.

   commands() reads the line as bash (5.2) does, so an operator inside
   quotes is text. A word starting with # comments out the rest of its line,
   a backslash-newline joins two lines, and the & in 2>&1 or &>file belongs
   to its redirection. A heredoc's body is read a line at a time, so an
   apostrophe in its prose opens nothing past that line. A $( … ), ` … `,
   <( … ) or >( … ), wherever it stands, is a command line of its own: its
   commands are read too, in a scope of their own, as a heredoc's body is,
   so a cd inside one moves nothing after it.

   A substitution ends where bash's grammar ends it. Counting parentheses
   took for its close a ) that bash reads inside ${x:-)}, a case pattern, a
   heredoc's body, $'\'' or a quote in a substitution in a quote, and the
   rest of the substitution was read as quoted text, unjudged (found by
   review, #241). So one reader reads a substitution and the line around
   it, and a substitution ends at the ) that closes nothing it opened. */
function words(seg) {
  return (seg.match(/'[^']*'|"[^"]*"|\S+/g) || []);
}
function split(text) {
  return text.split(/\|\||&&|[|;\n&]/).map(t => t.trim()).filter(Boolean).map(t => ({ words: words(t), text: t }));
}
function commands(cmd) {
  const ctx = { unclosed: false, heredocs: [] };
  const list = read(cmd, 0, false, ctx).out;
  list.unclosed = ctx.unclosed;
  return list;
}
/* The commands from `from` on: to the end of cmd or, in a substitution
   (sub), to the ) that closes it, whose index + 1 is returned as `end` (-1
   if none does). ctx carries the heredocs waiting for the end of the line,
   and whether a quote or an expansion never closed.

   case … in opens a list of patterns, each ended by a ) that closes
   nothing (a leading ( and an extglob's parentheses aside). esac ends the
   list where a command or a pattern could start, not as a word of either:
   `a|esac)` and `(esac)` are patterns. A pattern's words are no command. */
function read(cmd, from, sub, ctx) {
  const out = [], cases = [];
  let ws = [], word = null, start = from, i = from, depth = 0, last = ['', ''];
  const add = s => { word = (word || '') + s; };
  const push = end => { if (ws.length) out.push({ words: ws, text: cmd.slice(start, end).trim() }); ws = []; };
  const endWord = () => {
    if (word === null) return;
    const w = word, top = cases[cases.length - 1];
    word = null;
    if (w === 'esac' && top && !ws.length && !top.opener) { cases.pop(); return; }
    ws.push(w);
    if (w === 'in' && last[0] === 'case') { cases.push({ pattern: true, opener: false, nest: 0 }); push(i); start = i; }
    last = [last[1], w];
  };
  while (i < cmd.length) {
    const c = cmd[i];
    if (c === "'" || c === '"' || (c === '$' && cmd[i + 1] === "'") || opens(cmd, i) || ('<>'.includes(c) && cmd[i + 1] === '(')) {
      const e = c === "'" ? single(cmd, i, ctx) : c === '"' ? double(cmd, i, out, ctx)
        : cmd[i + 1] === "'" ? ansi(cmd, i, ctx) : expansion(cmd, i, out, ctx, false);
      add(cmd.slice(i, e));
      i = e;
    } else if (c === '\\') {
      if (cmd[i + 1] !== '\n') add(cmd.slice(i, i + 2));
      i += 2;
    } else if (c === '#' && word === null) {
      while (i < cmd.length && cmd[i] !== '\n') i++;
    } else if (c === '<' && cmd[i + 1] === '<' && cmd[i + 2] !== '<') {
      /* A heredoc. Its delimiter is the next word, quotes removed; the body
         starts on the line after this one. */
      endWord();
      let j = i + 2;
      const dash = cmd[j] === '-';
      if (dash) j++;
      while (cmd[j] === ' ' || cmd[j] === '\t') j++;
      let k = j;
      while (k < cmd.length && !/[\s;|&<>()]/.test(cmd[k])) {
        if (cmd[k] === "'" || cmd[k] === '"') { const q = cmd.indexOf(cmd[k], k + 1); k = q < 0 ? cmd.length : q + 1; }
        else k += cmd[k] === '\\' ? 2 : 1;
      }
      const delim = cmd.slice(j, k);
      ctx.heredocs.push({ end: delim.replace(/['"\\]/g, ''), dash, quoted: /['"\\]/.test(delim) });
      ws.push('<<' + (dash ? '-' : '') + delim);
      i = k;
    } else if (c === '\n') {
      endWord();
      push(i);
      i = bodies(cmd, i + 1, ctx, out);
      start = i;
    } else if (c === '(' || c === ')') {
      endWord();
      const top = cases[cases.length - 1];
      if (top && top.pattern) {
        if (c === ')' && !top.nest) { Object.assign(top, { pattern: false, opener: false }); ws = []; start = i + 1; }
        else if (c === '(' && !ws.length && !top.opener) top.opener = true;
        else top.nest += c === '(' ? 1 : -1;
      } else if (!top) {
        if (c === '(') depth++;
        else if (depth) depth--;
        else if (sub) { push(i); return { out, end: i + 1 }; }
      }
      i++;
    } else if (c === '&' && ((word !== null && /[<>]$/.test(word)) || cmd[i + 1] === '>')) {
      add(c);
      i++;
    } else if (c === '|' || c === '&' || c === ';') {
      endWord();
      const top = cases[cases.length - 1];
      if (c === '|' && top && top.pattern) { i++; continue; }
      push(i);
      const n = c === ';' && cmd[i + 1] === ';' && cmd[i + 2] === '&' ? 3
        : cmd[i + 1] === c || (c === '|' && cmd[i + 1] === '&') || (c === ';' && cmd[i + 1] === '&') ? 2 : 1;
      if (top && c === ';' && n > 1) Object.assign(top, { pattern: true, opener: false, nest: 0 });
      i += n;
      start = i;
    } else if (c === ' ' || c === '\t') {
      endWord();
      i++;
    } else {
      add(c);
      i++;
    }
  }
  endWord();
  push(cmd.length);
  return { out, end: -1 };
}
/* The bodies of the heredocs waiting for this line to end, read from `i`.
   Each line is read as a command, since a body can be a script (bash
   <<EOF). Unless its delimiter is quoted, a body is also text the way a
   double-quoted string is: what it substitutes runs, and an apostrophe in
   it is a letter (`it's $(cat x)` runs cat). */
function bodies(cmd, i, ctx, out) {
  while (ctx.heredocs.length) {
    const { end, dash, quoted } = ctx.heredocs.shift();
    const scope = [], lines = [];
    while (i < cmd.length) {
      let e = cmd.indexOf('\n', i);
      if (e < 0) e = cmd.length;
      const line = cmd.slice(i, e);
      i = e + 1;
      if ((dash ? line.replace(/^\t+/, '') : line) === end) break;
      scope.push(...read(line, 0, false, { unclosed: false, heredocs: [] }).out);
      lines.push(line);
    }
    if (!quoted) {
      const text = lines.join('\n'), inner = { unclosed: false, heredocs: [] };
      for (let j = 0; j < text.length; ) j = text[j] === '\\' ? j + 2 : opens(text, j) ? expansion(text, j, scope, inner, true) : j + 1;
      if (inner.unclosed) ctx.unclosed = true;
    }
    out.push({ scope });
  }
  return i;
}
/* Each of these takes the index where a quote or an expansion opens and
   returns the index past its close, or cmd's length, marking ctx, if it
   never closes. A substitution met on the way is read, and added to `out`
   as a scope. */
const opens = (cmd, j) => cmd[j] === '`' || (cmd[j] === '$' && (cmd[j + 1] === '(' || cmd[j + 1] === '{'));
function unclosed(cmd, ctx) {
  ctx.unclosed = true;
  return cmd.length;
}
function single(cmd, at, ctx) {
  const q = cmd.indexOf("'", at + 1);
  return q < 0 ? unclosed(cmd, ctx) : q + 1;
}
/* $'…', in which \' is a quote, not the close. */
function ansi(cmd, at, ctx) {
  for (let j = at + 2; j < cmd.length; j++) {
    if (cmd[j] === '\\') j++;
    else if (cmd[j] === "'") return j + 1;
  }
  return unclosed(cmd, ctx);
}
function double(cmd, at, out, ctx) {
  for (let j = at + 1; j < cmd.length; ) {
    if (cmd[j] === '"') return j + 1;
    j = cmd[j] === '\\' ? j + 2 : opens(cmd, j) ? expansion(cmd, j, out, ctx, true) : j + 1;
  }
  return unclosed(cmd, ctx);
}
/* $( … ), <( … ), >( … ), ` … ` or ${ … }. In ${ … } only a ${ nests, and a
   } inside quotes or another expansion closes nothing; `quoted` is whether
   it stands in double quotes, where $'…' is not a quote. Inside backquotes,
   \` \$ and \\ are the characters themselves: `echo \`cat x\`` runs cat. */
function expansion(cmd, at, out, ctx, quoted) {
  if (cmd[at] === '$' && cmd[at + 1] === '{') {
    for (let j = at + 2; j < cmd.length; ) {
      const c = cmd[j];
      if (c === '}') return j + 1;
      if (c === '\\') j += 2;
      else if (c === '$' && cmd[j + 1] === "'" && !quoted) j = ansi(cmd, j, ctx);
      else if (c === "'") j = single(cmd, j, ctx);
      else if (c === '"') j = double(cmd, j, out, ctx);
      else j = opens(cmd, j) ? expansion(cmd, j, out, ctx, quoted) : j + 1;
    }
    return unclosed(cmd, ctx);
  }
  if (cmd[at] === '`') {
    let j = at + 1;
    while (j < cmd.length && cmd[j] !== '`') j += cmd[j] === '\\' ? 2 : 1;
    const inner = { unclosed: false, heredocs: [] };
    out.push({ scope: read(cmd.slice(at + 1, j).replace(/\\([\\`$])/g, '$1'), 0, false, inner).out });
    if (inner.unclosed) ctx.unclosed = true;
    return j < cmd.length ? j + 1 : unclosed(cmd, ctx);
  }
  const r = read(cmd, at + 2, true, ctx);
  out.push({ scope: r.out });
  return r.end < 0 ? unclosed(cmd, ctx) : r.end;
}
/* The program a command runs, past whatever only opens or wraps it:
   - env assignments;
   - the shell's words that open a command (! then do else elif if while
     until), and a ( or { on its own or written against the word it opens;
   - the commands that run the next word as the program, with their options
     and, for timeout, its duration;
   - redirections, and a redirection's target written apart from it.
   A loop body (`do cat x`), a branch (`then head x`), a subshell (`(cat x)`),
   `timeout 5 cat x` or `2>/dev/null cat x` named its opener, wrapper or
   redirection as the program, and no rule read the command. Each letter
   listed after a wrapper is an option that takes the next word as its
   argument. Each word is read with its quotes and backslashes removed, as
   the shell runs it: `\grep` (past an alias) and "cat" are grep and cat. */
const OPENERS = new Set(['!', 'then', 'do', 'else', 'elif', 'if', 'while', 'until']);
const WRAPPERS = { sudo: 'ugCDhpUrt', command: '', builtin: '', exec: 'a', env: 'uCS', nohup: '', time: '',
  nice: 'n', ionice: 'cnp', stdbuf: 'ioe', timeout: 'sk', xargs: 'InPLsdEa' };
function program(ws) {
  let i = 0;
  while (i < ws.length) {
    const w = ws[i].replace(/\$(?=['"])/g, '').replace(/['"\\]/g, '').replace(/^[({]+/, '');
    if (!w || OPENERS.has(w) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) { i++; continue; }
    if (/^(?:\d*[<>]|&>)/.test(w)) { i += /^(?:\d*[<>]+|&>>?)&?$/.test(w) ? 2 : 1; continue; }
    if (!Object.prototype.hasOwnProperty.call(WRAPPERS, w)) return { name: path.basename(w), rest: ws.slice(i + 1) };
    i++;
    while (i < ws.length && ws[i].startsWith('-') && ws[i] !== '-') {
      const o = ws[i++];
      if ((/^-[A-Za-z]$/.test(o) && WRAPPERS[w].includes(o[1])) ||
          /^--(?:signal|kill-after|user|group|adjustment|unset|chdir|input|output|error)$/.test(o)) i++;
    }
    if (w === 'timeout' && i < ws.length) i++;
  }
  return { name: '', rest: [] };
}

/* Every rule reads the commands as the shell runs them. All but the search
   rule also read the old split, so nothing it refused is let through. The
   search rule does not: on the old split a quoted | leaves a pattern with no
   directory, and the search is judged as one from ".". Unless a quote or an
   expansion never closed: bash refuses such a line, or the reading missed
   how bash closes it, so the old split judges the searches too. */
function inspectBash(cmd, root, cwd) {
  const list = commands(cmd);
  return judge(list, true, cwd) || judge(split(cmd), list.unclosed, cwd);
  function judge(list, searches, cwd) {
    for (const item of list) {
      /* A substitution or a heredoc's body is judged where it stands, and a
         cd inside it moves nothing outside it. */
      if (item.scope) { const r = judge(item.scope, searches, cwd); if (r) return r; continue; }
      const { words: ws, text: seg } = item;
      const { name, rest } = program(ws);
      /* `cd tests && cat ../dist/x` — later segments resolve from where cd went. */
      if (name === 'cd') { cwd = path.resolve(cwd, (rest[0] || root).replace(/^['"]|['"]$/g, '').replace(/\)+$/, '')); continue; }
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
      /* `cat <content/x`, `while read l; do …; done < build/x`: an input
         redirection reads its file whatever the program is. */
      for (let i = 0; i < ws.length; i++) {
        const m = unquote(ws[i]).match(/^\d*<(?![<(])&?(.*)$/);
        if (!m) continue;
        const hit = wordHits(m[1] || ws[i + 1] || '', root, cwd); if (hit) return { rule: 'read', hit };
      }
      const iname = /^python[0-9.]*$/.test(name) ? 'python' : name === 'nodejs' ? 'node' : name;
      if (INLINE.has(iname) && inlineCode(iname, rest, seg)) {
        /* Inline code: any protected path anywhere in the WHOLE command, quoted
           or not. Whole, because a heredoc body sits on lines after this
           command and a piped-in program in a command before it. */
        for (const m of cmd.matchAll(INLINE_PATH)) { const hit = protectedRel(m[1]); if (hit) return { rule: 'read', hit }; }
      }
      if (searches && GREP_ARG_SHORT[name]) { const r = inspectSearch(name, rest, root, cwd); if (r) return r; }
      if (name === 'git' && rest.includes('grep') &&
          ((rest.includes('--no-index') && !rest.includes('--exclude-standard')) || rest.includes('--no-exclude-standard')))
        return { rule: 'recursive', hit: PROTECTED.join(', '), from: 'git grep over ignored files' };
      if (name === 'git' && rest.includes('commit')) return { rule: 'commit' };
    }
    return null;
  }
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
    if (r && r.rule === 'recursive') return `Blocked: this recursive search (${r.from}) reaches ${r.hit}, which is licensed content. ` +
      `Scope it: name the directories to search (grep -rn X src/ scripts/ tests/*.js), use rg without -u/--no-ignore (it skips the gitignored export), ` +
      `or exclude every protected path: --exclude-dir=content --exclude-dir=build --exclude-dir=dist --exclude-dir=source --exclude=last-run.log.`;
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
