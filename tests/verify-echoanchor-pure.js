#!/usr/bin/env node
/*
 * Does every anchor in scripts/echo-patch.js still exist at the position
 * echo-patch runs from?
 *
 *   node tests/verify-echoanchor-pure.js
 *
 * No browser, no build, no licensed export.
 *
 * WHY THIS EXISTS, and it is not hypothetical. focusmode is step 86 and
 * anchored on three lines copied out of what fullbleed(34) emits.
 * disclaimer(64) had rewritten the last of those lines thirty steps before
 * focusmode ever read them, so the anchor described markup that had not
 * existed since step 64 — and the first build that ever reached step 86 died
 * on it, half an hour into a run. Reading a patch script's source is how you
 * get that wrong, and reading it is the only thing available to anyone who
 * cannot run a build.
 *
 * tests/verify-shellanchor-pure.js answers that question for the <header>/
 * <div id="shell"> region. This answers it for echo-patch's four anchors,
 * by the same method: find the step that EMITS each anchor's region, seed
 * with what that step emits, replay every later step that touches the seed,
 * and look for the anchor in the result.
 *
 * ── THE SELF-TEST, WHICH IS THE POINT ────────────────────────────────────
 *
 * A replay that quietly stopped working would report every anchor healthy,
 * which is the shape this project keeps producing. So the historical bug is
 * checked in below as three fixtures — an anchor that survives, one a later
 * step REWROTE (fullbleed(34) emits `<div id="app">`, disclaimer(64) swaps it
 * for `<main id="app">`: the focusmode bug exactly), and one no step emits.
 * All three must give different answers every time this runs.
 *
 * ── WHY THIS ONE IS NOT READ THROUGH blankComments ───────────────────────
 *
 * CLAUDE.md says any scan of this repo's own source must read the blanked
 * copy, and this is the documented exception rather than an oversight:
 * SEVERAL OF THESE ANCHORS ARE COMMENTS. The embed anchor is the banner
 * `/* ... Durable memory ... *\/`, which lives inside a patch script's
 * template literal as CONTENT — it is markup destined for the built file,
 * not a remark about the patch script. blankComments cannot tell those two
 * apart and replaces it with spaces, and a first draft of this suite that
 * blanked reported the anchor missing from assets(27) and present twice
 * somewhere else, which is a confident wrong answer about a healthy patch.
 * tests/verify-refimg-pure.js skips blanking for the same reason.
 *
 * The cost is that a comment in a patch script which QUOTES a complete
 * patch(label, `find`, `replace`) call would be read as a real one.
 * verify-shellanchor-pure carries the same exposure. The declaration check
 * below limits it: what the file declares and what was extracted have to
 * agree, so a phantom would have to be a complete, syntactically perfect
 * call inside a comment to slip through.
 *
 * ── WHAT IT CANNOT DO ────────────────────────────────────────────────────
 *
 * The chain's real seed is the licensed export, which is not on this machine.
 * So only regions some patch step CREATES can be replayed, and an anchor into
 * export-supplied markup reports "no chain step emits this" — which is a
 * refusal to answer, not a pass. It also proves SURVIVAL, not UNIQUENESS:
 * patch() checks that the find matches exactly once against the whole
 * document, and the rest of that document is not here. That check runs at
 * build time and throws loudly, so the gap is a delayed failure rather than
 * a silent one.
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
const SCRIPTS = path.join(ROOT, 'scripts');

/* The chain, read from build.js rather than restated here. */
const bs = fs.readFileSync(path.join(SCRIPTS, 'build.js'), 'utf8');
const openAt = bs.indexOf('const CHAIN = [');
/* eslint-disable-next-line no-eval */
const CHAIN = eval(bs.slice(openAt + 'const CHAIN = '.length, bs.indexOf('];', openAt) + 1));

/* Identifiers a replacement interpolates resolve to an inert stub: this
   replays STRUCTURE, and what the app renders into ${} is not it. Both sides
   of every comparison go through the same stubbing, so they stay comparable. */
const stub = new Proxy(function () { return '<!--x-->'; }, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => '<!--x-->' : k === 'then' ? undefined : stub),
  apply: () => '<!--x-->',
});
function tpl(raw) {
  try {
    /* Symbol.unscopables MUST come back undefined — with() consults it to
       decide which names the object does NOT supply, and a proxy answering
       the stub there marks every identifier as excluded, so the template
       throws "not defined". verify-shellanchor-pure documents the same trap. */
    /* eslint-disable-next-line no-new-func */
    return new Function('S', 'with(S){return `' + raw + '`}')(new Proxy({}, {
      has: () => true,
      get: (t, k) => (k === Symbol.unscopables ? undefined : stub),
    }));
  } catch (_) { return null; }
}

const PATCH_RE = /patch\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*`((?:\\.|[^\\`])*)`\s*,\s*`((?:\\.|[^\\`])*)`/g;
function pairs(step) {
  const file = path.join(SCRIPTS, step + '-patch.js');
  if (!fs.existsSync(file)) return [];
  /* NOT blanked — see the header. These anchors are comments. */
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  let m;
  PATCH_RE.lastIndex = 0;
  while ((m = PATCH_RE.exec(src))) {
    const find = tpl(m[3]), repl = tpl(m[4]);
    if (find !== null && repl !== null) out.push({ label: m[2], find, repl });
  }
  return out;
}

/* Replay one anchor to the position `atStep` (1-based chain index). */
function check(anchor, atStep) {
  const upto = atStep - 1;
  let producer = -1, seed = null;
  for (let i = upto - 1; i >= 0; i--) {
    for (const p of pairs(CHAIN[i])) {
      if (p.repl.indexOf(anchor) !== -1) { producer = i; seed = p.repl; break; }
    }
    if (producer !== -1) break;
  }
  if (producer === -1) return { ok: false, hits: 0, producer: null, applied: [], why: 'not emitted by any chain step' };

  let html = seed;
  const applied = [];
  for (let i = producer + 1; i < upto; i++) {
    for (const p of pairs(CHAIN[i])) {
      if (html.split(p.find).length - 1 === 1) {
        html = html.replace(p.find, () => p.repl);
        applied.push(CHAIN[i] + '(' + (i + 1) + ')');
      }
    }
  }
  const hits = html.split(anchor).length - 1;
  return {
    ok: hits === 1, hits, applied,
    producer: CHAIN[producer] + '(' + (producer + 1) + ')',
    why: hits === 1 ? 'survives' : hits === 0 ? 'rewritten before this step' : 'appears ' + hits + ' times',
  };
}

head('the replay can tell the three cases apart');
{
  /* THE FIXTURES ARE THE HISTORY, and there are three of them because there
     are three answers this can give. An earlier draft used only the first
     and last, and I injected a replay that reported everything sound and
     watched the suite pass anyway: the "broken" fixture was taking check()'s
     `producer === -1` early return, whose `ok: false` is a literal. It was
     proving the refusal path worked and nothing else, while its comment
     claimed it proved the replay could spot a rewritten anchor.

     REWRITTEN is therefore the important one, and it is the focusmode bug
     itself rather than a stand-in: fullbleed(34) emits `<div id="app">`, and
     disclaimer(64) swaps it for `<main id="app">` to give screen readers a
     landmark. An anchor on the div is emitted, then destroyed, then gone —
     which no amount of reading fullbleed's source would tell you. */
  const at = CHAIN.length + 1;
  const SOUND = '<header id="navbar"></header>';
  const REWRITTEN = '<div id="app"></div>';
  const ABSENT = '<!-- no step in this chain ever emits this -->';

  const sound = check(SOUND, at), rewritten = check(REWRITTEN, at), absent = check(ABSENT, at);

  ok('an anchor that survives is reported sound', sound.ok, sound.why);
  ok('an anchor a later step rewrote is reported broken', !rewritten.ok, rewritten.why);
  ok('and it is reported as REWRITTEN, not merely as absent',
     rewritten.producer !== null && rewritten.hits === 0,
     rewritten.producer ? 'emitted by ' + rewritten.producer + ', then destroyed' : 'no producer found');
  ok('an anchor no step emits is refused rather than passed', !absent.ok, absent.why);
  ok('and that refusal names no producer, so it reads as a refusal',
     absent.producer === null, String(absent.producer));
  /* All three answers must be distinguishable, or the replay has gone blind
     in a way the individual checks above could each still pass. */
  ok('the three cases give three different answers',
     new Set([sound.why, rewritten.why, absent.why]).size === 3,
     [sound.why, rewritten.why, absent.why].join(' / '));
}

head('echo-patch is where it says it is');
{
  ok('echo is a step in the chain', CHAIN.indexOf('echo') !== -1, CHAIN.indexOf('echo') + 1 || 'absent');
  /* Its header argued it must be LAST, because focusmode(86) is the final
     step to rewrite the nav's button row. When notesearch(88) was added after
     it, this check went red and asked for the argument to be re-made, and it
     was: what echo needs is to come after focusmode — no step can change what
     echo reads once echo has run — and anything after echo must be a step
     built on echo's own output, whose anchors are echo's emitted text
     (verify-notesearch-pure holds that for notesearch). So both halves are
     asserted, and a new step appended after echo fails here until it is
     either moved before focusmode's successors or added to AFTER_ECHO with
     the same argument made for it. */
  const AFTER_ECHO = ['notesearch'];
  ok('and it runs after focusmode, the last step to rewrite the nav',
     CHAIN.indexOf('focusmode') > -1 && CHAIN.indexOf('echo') > CHAIN.indexOf('focusmode'),
     `focusmode at ${CHAIN.indexOf('focusmode') + 1}, echo at ${CHAIN.indexOf('echo') + 1}`);
  const after = CHAIN.slice(CHAIN.indexOf('echo') + 1);
  ok('and every step after it is one built on its output',
     after.every(s => AFTER_ECHO.includes(s)), after.join(', ') || 'none — echo is last');
  ok('its patch script is on disk', fs.existsSync(path.join(SCRIPTS, 'echo-patch.js')));
}

head('every anchor echo-patch uses still exists at step ' + (CHAIN.indexOf('echo') + 1));
{
  const at = CHAIN.indexOf('echo') + 1;
  const mine = pairs('echo');

  /* VACUITY, twice over. Extraction returning nothing would make the survival
     check below trivially true, and that is the failure this project is named
     after. So the count is asserted, and separately every patch() the file
     DECLARES must have been readable — a call the regex cannot parse is an
     anchor this suite would skip in silence. */
  ok('its anchors were read', mine.length >= 4, `${mine.length} anchors`);
  const declared = [...fs.readFileSync(path.join(SCRIPTS, 'echo-patch.js'), 'utf8')
    .matchAll(/patch\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g)].map(m => m[2]);
  const got = new Set(mine.map(p => p.label));
  const dropped = declared.filter(d => !got.has(d));
  ok('and every patch it declares was readable, none skipped in silence',
     dropped.length === 0, dropped.join('; ') || 'none');

  const results = mine.map(p => ({ label: p.label, r: check(p.find, at) }));
  const broken = results.filter(x => !x.r.ok).map(x => `${x.label}: ${x.r.why}`);
  ok('every anchor survives to that position', broken.length === 0, broken.join(' | ') || 'none');

  /* The replay has to have DONE something for at least one of them, or the
     "survives" above is just the seed being handed straight back. */
  const replayed = results.filter(x => x.r.applied.length > 0);
  ok('and at least one was replayed through intervening steps rather than read raw',
     replayed.length > 0,
     replayed.length ? `${replayed[0].label} through ${replayed[0].r.applied.length} steps` : 'none replayed');

  for (const x of results) {
    console.log('        ' + (x.r.ok ? '·' : '!') + ' ' + x.label.slice(0, 44).padEnd(46) +
                (x.r.producer || '-') + '  ' + x.r.why);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
