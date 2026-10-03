#!/usr/bin/env node
/*
 * The Claude Code subagents are what they say: cheap, explicit, read-only.
 *
 *   node tests/verify-claude-agents.js
 *
 * Pure Node. Each .claude/agents/*.md is a subagent definition: YAML front
 * matter (name, description, tools, model) and its instructions. Claude Code
 * reads them; nothing else in this repository does, so a malformed one fails
 * quietly by not existing. This suite is that check.
 *
 * WHAT "READ-ONLY" MEANS HERE, narrowly: no file-editing tool is granted.
 * An agent with no `tools:` line inherits every tool, Write included, so a
 * missing line is refused, not read as "none". Bash is granted to two of them
 * and Bash can write; for those, read-only rests on their instructions and on
 * .claude/hooks/guard.js, which judges every Bash call, a subagent's
 * included. This suite does not claim more than the tool list shows.
 *
 * The model rule is CLAUDE.md's: the cheapest model that fits, opus only
 * for hard design or debugging, which no agent here is.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, '.claude', 'agents');
const EXPECTED = ['ci-log-reader', 'hollow-check-reviewer', 'leak-auditor'];
const MODELS = ['haiku', 'sonnet'];
const WRITERS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

/* Front matter: the block between the first two `---` lines, one
   `key: value` per line. No YAML parser in this repository; these files use
   none of YAML's other shapes, and a line this cannot read is reported. */
function parse(file) {
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { error: 'no front matter' };
  const meta = {}, bad = [];
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z_-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim(); else if (line.trim()) bad.push(line);
  }
  return { meta, body: m[2], bad };
}

const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => f.endsWith('.md')).sort() : [];

head('the agents that should exist, do');
{
  const names = files.map(f => f.replace(/\.md$/, ''));
  ok('there are agent definitions to check', files.length > 0, `${files.length} in .claude/agents`);
  const missing = EXPECTED.filter(n => !names.includes(n));
  ok('each expected agent is defined', missing.length === 0, missing.join(', ') || EXPECTED.join(', '));
}

head('each one: well formed, cheap, and unable to edit files');
for (const f of files) {
  const { meta, body, bad, error } = parse(path.join(DIR, f));
  const n = f.replace(/\.md$/, '');
  if (error) { ok(`${n}: has front matter`, false, error); continue; }
  ok(`${n}: front matter reads cleanly`, bad.length === 0, bad.join(' | ') || 'every line key: value');
  ok(`${n}: its name is its file name`, meta.name === n, String(meta.name));
  ok(`${n}: it says when to use it`, (meta.description || '').length > 40, (meta.description || '').slice(0, 60));
  ok(`${n}: its model is one CLAUDE.md allows for routine work`, MODELS.includes(meta.model), String(meta.model));
  const tools = (meta.tools || '').split(',').map(s => s.trim()).filter(Boolean);
  ok(`${n}: its tools are listed, not inherited`, tools.length > 0, tools.join(', ') || 'no tools line: it would inherit Write and Edit');
  const writes = tools.filter(t => WRITERS.includes(t) || t === '*');
  ok(`${n}: none of them edits a file`, tools.length > 0 && writes.length === 0, writes.join(', ') || 'none');
  ok(`${n}: and it has instructions`, body.trim().length > 200, `${body.trim().length} chars`);
}

head('what the agents point at is there');
{
  /* hollow-check-reviewer reads its list of disguises from CLAUDE.md rather
     than carrying a copy that would drift; a renamed heading would leave it
     reading nothing. */
  const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  const reviewer = fs.existsSync(path.join(DIR, 'hollow-check-reviewer.md'))
    ? fs.readFileSync(path.join(DIR, 'hollow-check-reviewer.md'), 'utf8') : '';
  const cited = (reviewer.match(/section "([^"]+)"/) || [])[1];
  ok('the reviewer names a CLAUDE.md section', !!cited, String(cited));
  ok('and CLAUDE.md has that section', !!cited && new RegExp('^## ' + cited.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'm').test(claude));
  const files2 = ['tests/_source.js', 'tests/_render.js', 'scripts/leak-guard.js'];
  const gone = files2.filter(p => !fs.existsSync(path.join(ROOT, p)));
  ok('the files the agents send you to exist', gone.length === 0, gone.join(', ') || files2.join(', '));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
