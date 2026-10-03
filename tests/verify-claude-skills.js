#!/usr/bin/env node
/*
 * The Claude Code skills are well formed, and what they cite exists.
 *
 *   node tests/verify-claude-skills.js
 *
 * Pure Node. Each .claude/skills/<name>/SKILL.md is a skill: YAML front matter
 * (name, description) and instructions Claude loads on demand. `steward` is
 * also read by the cloud session before it acts on a PR's CI or review
 * events, by that exact path. Nothing else in this repository reads them, so
 * a misnamed file or a broken one fails quietly by not being found. This
 * suite is that check.
 *
 * WHAT "CITES" MEANS HERE, narrowly: a skill tells Claude to run commands and
 * open files. Every repo path, `npm run` script, CLAUDE.md section, skill and
 * agent named in one must exist, so a rename elsewhere turns this red instead
 * of leaving a skill pointing at nothing. Paths under the licensed
 * directories are not checked: they are absent in CI by design. Whether the
 * instructions are right is not something this suite can see.
 *
 * No skill may carry `allowed-tools`. It pre-approves tools for the session
 * while the skill is active, which would let a skill widen permissions
 * without a prompt. None needs it.
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
const DIR = path.join(ROOT, '.claude', 'skills');
const EXPECTED = ['memorizer-study-file', 'prove-red', 'steward'];
const LICENSED = /^(source|build|content|dist)\/|^tests\/last-run\.log$/;

/* Front matter: the block between the first two `---` lines, one
   `key: value` per line, as in tests/verify-claude-agents.js. */
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

/* The words inside backticks, inline and fenced. A path is a word with a
   slash or a known extension and no placeholder in it. An inline span may
   wrap a line, as Markdown allows; excluding newlines once shifted every
   later backtick pair and silently dropped a cited path. */
function cited(body) {
  const spans = [...body.matchAll(/```[\s\S]*?```|`[^`]+`/g)].map(m => m[0].replace(/`/g, ''));
  const words = spans.flatMap(s => s.split(/\s+/)).filter(Boolean);
  const paths = words.filter(w => !/[<>*|]/.test(w) && !w.startsWith('-') && !w.startsWith('/')
    && (/^[\w.-]+\/[\w./-]+$/.test(w) || /^[\w.-]+\.(js|md|json|yml|sh|py)$/.test(w)));
  const scripts = spans.flatMap(s => [...s.matchAll(/\bnpm run ([\w:-]+)/g)].map(m => m[1]));
  const slash = words.filter(w => /^\/[a-z][a-z-]*$/.test(w)).map(w => w.slice(1));
  return { paths: [...new Set(paths)], scripts: [...new Set(scripts)], slash: [...new Set(slash)] };
}

const dirs = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter(d => fs.statSync(path.join(DIR, d)).isDirectory()).sort() : [];

head('the skills that should exist, do, where Claude Code looks');
{
  ok('there are skills to check', dirs.length > 0, `${dirs.length} in .claude/skills`);
  /* Exact case: SKILL.md. A lower-case skill.md is found on a case-insensitive
     disk and missed on Linux, where the cloud session runs. */
  const missing = EXPECTED.filter(n => !(fs.existsSync(path.join(DIR, n)) && fs.readdirSync(path.join(DIR, n)).includes('SKILL.md')));
  ok('each expected skill has a SKILL.md', missing.length === 0, missing.join(', ') || EXPECTED.join(', '));
}

const claude = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts || {};
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

head('each one: well formed, no wider than the session, and pointing at real things');
for (const d of dirs) {
  const file = path.join(DIR, d, 'SKILL.md');
  if (!fs.readdirSync(path.join(DIR, d)).includes('SKILL.md')) { ok(`${d}: has a SKILL.md`, false, fs.readdirSync(path.join(DIR, d)).join(', ')); continue; }
  const { meta, body, bad, error } = parse(file);
  if (error) { ok(`${d}: has front matter`, false, error); continue; }
  ok(`${d}: front matter reads cleanly`, bad.length === 0, bad.join(' | ') || 'every line key: value');
  ok(`${d}: its name is its directory`, meta.name === d, String(meta.name));
  ok(`${d}: it says when to use it`, /\bUse (when|whenever)\b/.test(meta.description || ''), (meta.description || '').slice(0, 60));
  ok(`${d}: it pre-approves no tools`, !('allowed-tools' in meta), meta['allowed-tools'] || 'no allowed-tools line');
  ok(`${d}: and it has instructions`, body.trim().length > 500, `${body.trim().length} chars`);

  const c = cited(body);
  const checkable = c.paths.filter(p => !LICENSED.test(p));
  const gone = checkable.filter(p => !fs.existsSync(path.join(ROOT, p)));
  ok(`${d}: it cites files`, checkable.length > 0, `${checkable.length}`);
  ok(`${d}: every file it cites exists`, gone.length === 0, gone.join(', ') || checkable.join(', '));
  const noScript = c.scripts.filter(s => !(s in scripts));
  ok(`${d}: every npm script it runs is in package.json`, noScript.length === 0, noScript.join(', ') || c.scripts.join(', ') || 'none cited');
  const noSkill = c.slash.filter(s => !fs.existsSync(path.join(DIR, s, 'SKILL.md')));
  ok(`${d}: every skill it sends you to exists`, noSkill.length === 0, noSkill.join(', ') || c.slash.join(', ') || 'none cited');
  const agents = [...body.matchAll(/`([a-z][a-z-]+)` agent\b/g)].map(m => m[1]);
  const noAgent = agents.filter(a => !fs.existsSync(path.join(ROOT, '.claude', 'agents', a + '.md')));
  ok(`${d}: every agent it names exists`, noAgent.length === 0, noAgent.join(', ') || agents.join(', ') || 'none cited');
  /* A cited name may wrap a line, as the span extractor above allows. */
  const sections = [...body.matchAll(/section "([^"]+)"/g)].map(m => m[1].replace(/\s+/g, ' '));
  const noSection = sections.filter(s => !new RegExp('^## ' + esc(s) + '$', 'm').test(claude));
  ok(`${d}: every CLAUDE.md section it cites exists`, noSection.length === 0, noSection.join(', ') || sections.join(', ') || 'none cited');
}

head('the skill the PR rules look for is the one written');
{
  /* The cloud session reads steward by path, before acting on CI or review
     events, and the harness lets a repo skill set conventions, never relax a
     "never". The skill must not claim it can. */
  const steward = path.join(DIR, 'steward', 'SKILL.md');
  const body = fs.existsSync(steward) ? fs.readFileSync(steward, 'utf8') : '';
  ok('steward says it narrows nothing in the harness rules', /narrows nothing/.test(body));
  ok('steward cites prove-red, which cites the CLAUDE.md rule',
    /\/prove-red\b/.test(body) && /section "The failure mode this project keeps producing"/.test(
      fs.existsSync(path.join(DIR, 'prove-red', 'SKILL.md')) ? fs.readFileSync(path.join(DIR, 'prove-red', 'SKILL.md'), 'utf8') : ''));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
