#!/usr/bin/env node
/*
 * Two rules about the UI the patch chain emits.
 *
 *   node tests/verify-ui-pure.js
 *
 * No browser, no build, no licensed export. This reads the patch scripts and
 * src/ as text, through tests/_source.js's comment blanker.
 *
 * THE BLANKER IS THIS REPOSITORY'S RULE for any scan of its own source —
 * tests/verify-engine.js enforces it — and it is used here for that reason
 * rather than because these two rules need it. They do not, today: bypassing
 * the blanker entirely was injected and every check stayed green, because no
 * comment under scripts/ or src/ currently contains a native-dialog call or
 * an icon-only <button>. That is a fact about today's comments, not a
 * property of the scan, and the next paragraph anyone writes about either
 * rule would end it. So the blanking is proven where it can be — on THIS
 * file, whose own comments discuss every call the rules hunt.
 *
 * Both rules are about something that is CORRECT TODAY and has nothing
 * holding it that way. An audit found no nameless icon button and four known
 * native dialogs; a month later that is a sentence in a transcript nobody
 * reads. These are the two facts written down where they fail.
 *
 * ── WHY NOT A BROWSER ─────────────────────────────────────────────────────
 *
 * The real question for both — does a screen reader announce this button,
 * does this decision interrupt the app — is a runtime one. But the runtime
 * suites need the licensed export, so they run on one laptop and not in CI,
 * and a rule that only runs there is a rule that catches a regression weeks
 * after it lands. What can be decided from the source is decided here, and
 * what cannot is said so rather than faked.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');

/* Every file that contributes markup or behaviour to the built app: the patch
   scripts and src/. Read blanked, and kept as {file, code} so a hit can name
   the line it is really on. */
const SOURCES = (() => {
  const out = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'scripts')).sort()) {
    if (/-patch\.js$/.test(f)) out.push('scripts/' + f);
  }
  (function walk(dir) {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory()) walk(dir + '/' + e.name);
      else if (/\.js$/.test(e.name)) out.push(dir + '/' + e.name);
    }
  })('src');
  return out.map(rel => ({
    file: rel,
    code: blankComments(fs.readFileSync(path.join(ROOT, rel), 'utf8')),
  }));
})();
const lineOf = (code, index) => code.slice(0, index).split('\n').length;

/* ────────────────────────────────────────────────────────────────────────── */
head('the files this suite reads');
{
  ok('there are patch scripts to read', SOURCES.filter(s => /-patch\.js$/.test(s.file)).length >= 60,
     `${SOURCES.filter(s => /-patch\.js$/.test(s.file)).length} patch scripts`);
  ok('and src/ as well', SOURCES.some(s => s.file.startsWith('src/')),
     `${SOURCES.filter(s => s.file.startsWith('src/')).length} files under src/`);
  /* THE BLANKER, NOT A LOCAL COPY. verify-engine.js enforces this across the
     suite; asserted here too because both rules below would report their own
     documentation as a violation without it. */
  ok('read through the shared comment blanker',
     /require\('\.\/_source\.js'\)/.test(fs.readFileSync(__filename, 'utf8')));
  /* THAT THE BLANKING ACTUALLY HAPPENED, driven rather than asserted. The
     first version of this line read

         !/confirm\(/.test(SOURCES.map(s => s.code).join('\n').slice(0, 0) + '')

     which tests the empty string and cannot come out false — a check that
     passes hardest when everything is broken, in the suite written to catch
     that shape. It now blanks THIS file, whose comments discuss every call
     the rule below hunts, and asserts the discussion disappears while the
     code around it survives. */
  const selfRaw = fs.readFileSync(__filename, 'utf8');
  const selfBlank = blankComments(selfRaw);
  ok('this file discusses the calls it hunts, in prose', /alert\(\), confirm\(\) and prompt\(\)/.test(selfRaw));
  ok('and the blanker removes that discussion', !/alert\(\), confirm\(\) and prompt\(\)/.test(selfBlank));
  ok('while leaving the code beside it intact', /const KNOWN_DIALOGS = \[/.test(selfBlank));
  ok('and without moving anything — line counts survive',
     selfRaw.split('\n').length === selfBlank.split('\n').length);
}

/* ── RULE 1: no new native dialogs ────────────────────────────────────────
 *
 * alert(), confirm() and prompt() stop the world. On an iPad in a ward round
 * that is a modal sheet over the question you were reading, styled by Safari
 * and not by this app. Four confirm() calls exist and are deliberate — each
 * guards a destructive action that cannot be undone — and replacing them
 * needs a modal primitive with buttons, which this codebase does not have:
 * the only role="dialog" is the figure viewer, which has nothing to decide.
 *
 * So the four stay, and this stops a fifth arriving by habit.
 *
 * CHECKED IN BOTH DIRECTIONS, like PENDING_RECORD in scripts/verify.js: a
 * call not in the list is a new dialog, and a list entry not in the source is
 * a stale exemption. The second half is what stops this becoming a blanket
 * allowance that outlives the thing it allowed. Each entry carries the exact
 * message, so changing what a dialog ASKS is also a change this notices.
 */
const KNOWN_DIALOGS = [
  ['scripts/memory-patch.js', 'confirm', 'Delete this memory? Apex will stop knowing it.'],
  ['scripts/memory-patch.js', 'confirm', 'Forget everything Apex knows about you? This cannot be undone.'],
  ['scripts/polish-patch.js', 'confirm', 'Clear all ink and notes on this question?'],
  ['scripts/polish-patch.js', 'confirm', 'Clear all ink and notes on this question?'],
];

head('no native dialog arrives without being meant');
{
  /* Statement position, with no quote to its left on the line — the same
     discriminator verify-engine.js uses for launch(), and for the same
     reason: this repository names these calls in its own prose, and a bare
     substring search fails on its own documentation. */
  const CALL = /(^|[^.\w'"`])(alert|confirm|prompt)\s*\(\s*(['"])((?:\\.|(?!\3)[^\\])*)\3/g;
  const found = [];
  for (const { file, code } of SOURCES) {
    for (const m of code.matchAll(CALL)) {
      found.push({ file, kind: m[2], msg: m[4].replace(/\\'/g, "'"), line: lineOf(code, m.index) });
    }
  }
  /* Vacuity guard: "no unexpected dialogs" is also what a scan that matched
     nothing returns, and this scan has four things it must find. */
  ok('the scan finds the dialogs that are known to be there',
     found.length >= KNOWN_DIALOGS.length, `${found.length} found, ${KNOWN_DIALOGS.length} expected`);

  const key = d => `${d[0]}|${d[1]}|${d[2]}`;
  const want = KNOWN_DIALOGS.map(key).sort();

  /* A MULTISET DIFFERENCE, not a set one. polish-patch.js asks the same
     question in two places, so the list holds that entry twice and a third
     copy must be reported — a Set would swallow it. */
  const pool = want.slice();
  const unexpected = found.filter(f => {
    const at = pool.indexOf(key([f.file, f.kind, f.msg]));
    if (at > -1) { pool.splice(at, 1); return false; }
    return true;
  });
  ok('every native dialog in the source is one that was meant',
     unexpected.length === 0,
     unexpected.map(u => `${u.file}:${u.line} ${u.kind}(${u.msg.slice(0, 40)}…)`).join(' | ') || 'none');

  /* Whatever the pool still holds after the pass above is an entry the
     source no longer contains: a stale exemption. */
  const missing = pool.slice();
  ok('and every dialog on the list is still in the source — no stale exemption',
     missing.length === 0, missing.join(' | ') || 'none');
  ok('the list has not quietly grown', KNOWN_DIALOGS.length === 4, `${KNOWN_DIALOGS.length} entries`);
  /* alert() and prompt() have no entries at all, so any of either is new. */
  ok('there is no alert() anywhere', !found.some(f => f.kind === 'alert'),
     found.filter(f => f.kind === 'alert').map(f => f.file + ':' + f.line).join(', ') || 'none');
  ok('and no prompt() either', !found.some(f => f.kind === 'prompt'),
     found.filter(f => f.kind === 'prompt').map(f => f.file + ':' + f.line).join(', ') || 'none');
}

/* ── RULE 2: an icon is not a name ────────────────────────────────────────
 *
 * A button whose only content is ${icon('x')} renders as a glyph. Sighted
 * users read the shape; a screen reader reads the accessible name, and with
 * no text node there is one only if the markup supplies it. All 28 currently
 * do — 11 by aria-label, 17 by title — and nothing held them that way.
 *
 * title IS ACCEPTED HERE, deliberately. It is the weakest tier of the
 * accessible-name computation and it is genuinely a name: a rule that
 * demanded aria-label would fail 17 honest call sites today, and the first
 * response to that would be to turn the rule off. What this stops is the
 * button with NEITHER, which is the one a screen reader announces as
 * "button" and nothing else.
 *
 * WHAT THIS CANNOT CHECK is what is actually announced — that needs a
 * browser and the built app, and the real accessible name depends on the
 * computed cascade. tests/verify-polish.js and verify-home.js check
 * announced values on a live page; this checks that a name was supplied at
 * all, which is the part that can be decided from the source.
 */
head('an icon-only button still says what it does');
{
  /* Only buttons whose ENTIRE content is one or more icon() calls. A button
     with a text node has a name from the text and is not this rule's
     business. Non-greedy attribute run stops at the first '>', so a button
     is never merged with the one after it. */
  const ICON_ONLY = /<button\b([^>]*)>((?:\s*\\?\$\{icon\([^)]*\)\}\s*)+)<\/button>/g;
  const NAMED = /\baria-label\s*=|\baria-labelledby\s*=|\btitle\s*=/;
  const nameless = [];
  let total = 0, byAria = 0, byTitle = 0;
  for (const { file, code } of SOURCES) {
    for (const m of code.matchAll(ICON_ONLY)) {
      total++;
      const attrs = m[1];
      if (!NAMED.test(attrs)) nameless.push(`${file}:${lineOf(code, m.index)}`);
      else if (/\baria-label(?:ledby)?\s*=/.test(attrs)) byAria++;
      else byTitle++;
    }
  }
  /* Vacuity guard, and the one that matters most here: a regex that stopped
     matching would report zero nameless buttons out of zero buttons, which
     reads exactly like a clean bill of health. */
  ok('there are icon-only buttons to check', total >= 20, `${total} found`);
  ok('every one of them supplies an accessible name',
     nameless.length === 0, nameless.join(', ') || 'none');
  /* Both tiers are still represented, so the rule is known to accept both
     rather than passing because one kind happens to be absent. */
  ok('some are named by aria-label', byAria > 0, `${byAria} by aria-label`);
  ok('and some by title, which this rule accepts', byTitle > 0, `${byTitle} by title`);
  ok('the two tiers account for all of them', byAria + byTitle === total,
     `${byAria} + ${byTitle} = ${byAria + byTitle} of ${total}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
