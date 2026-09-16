'use strict';
/*
 * Why a suite that did not report stopped reporting.
 *
 * A suite that throws prints no summary, so the runner has nothing to count
 * and says "did not report". That line is useless on its own — every death
 * looks the same — so this digs the message out of what the suite did manage
 * to print before it died.
 *
 * THE FIRST VERSION SCANNED FROM THE TOP and returned the first line that was
 * not furniture. That is the wrong end of the file. Node prints an uncaught
 * rejection LAST, after everything the suite logged, so scanning downward
 * finds the earliest chatty line instead of the death. It shipped, and the
 * first suite it was pointed at answered:
 *
 *     home           did not report  (21s)  — 51 had passed first
 *         Mastered 16%
 *
 * which is not an error. verify-home.js:125 passes `.hp-legend` textContent as
 * a check's detail, that element holds two spans, and its text carries the
 * newline between them — so the PASS line printed across two lines and the
 * second had no PASS prefix to be filtered by. A continuation of a check's own
 * detail was being reported as the cause of the crash.
 *
 * THE RULE NOW IS POSITIONAL, because that is what is actually true: a suite
 * prints its checks and then dies, so the death is whatever comes after the
 * LAST PASS/FAIL line. Everything before that boundary is the suite working,
 * however it happens to be worded, and no amount of pattern-matching on the
 * wording would have told "Mastered 16%" from a message.
 *
 * Within that tail an error-shaped line wins over a plain one, so a detail
 * that wrapped under the final check cannot outrank the exception below it.
 */

/* node's uncaught-exception furniture, in the two shapes it comes in: the
   promises boilerplate for a rejection, and a bare `path/to/file.js:12`
   header with the offending source line and a caret under it for a throw. */
const NOISE = /^(node:internal|\s*triggerUncaughtException|\s*\^|Node\.js v|\s*at\s)/;
const FILE_POS = /^([A-Za-z]:\\|\/|\.{0,2}[\\/])\S*:\d+$/;

/* What a thrown message looks like, as opposed to a line of app text that
   happened to land in the tail. Playwright's are `page.evaluate: Target
   crashed` and `locator.click: Timeout 30000ms exceeded` — an API path, a
   colon, then prose — and node's are `TypeError: ...`. */
const { HEADING } = require('../tests/_deathnote.js');

const ERRORISH = /^([A-Za-z_$][\w$]*)?Error\b|^[a-z][\w$]*(\.[A-Za-z_$][\w$]*)+\s*:\s|^Target (crashed|page|closed)/;

function causeOf(out) {
  const lines = String(out || '').split('\n');
  /* After the last check the suite managed to print. A suite that died before
     its first check has no boundary, and the whole output is the tail. */
  let start = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*(PASS|FAIL)\s/.test(lines[i])) { start = i + 1; break; }
  }
  /* AND PAST THE NOTE, whose body is mostly the page's own exceptions. Adding
     the note put error-shaped lines into the tail this reads, ahead of the real
     one, so the runner started reporting the page's first console error as the
     cause of the death. The two are different claims and the note is already
     printed in full underneath.

     There was a check here meant to catch exactly this — "the exception still
     wins over the note above it" — and it passed, because its fixture used
     "Unhandled Promise Rejection: …", which is not error-shaped. It was
     measuring something narrower than it claimed. The fixture is a bare
     TypeError now and it fails without the skip below. */
  const noteAt = lines.findIndex((l, i) => i >= start && l.includes(HEADING));
  if (noteAt >= 0) {
    start = noteAt + 1;
    while (start < lines.length && /^ {2}\S/.test(lines[start])) start++;
  }
  const usable = [];
  for (const raw of lines.slice(start)) {
    if (NOISE.test(raw)) continue;
    const t = raw.trim();
    if (!t || /^[─=#]/.test(t) || /^(PASS|FAIL)\s/.test(t)) continue;
    if (FILE_POS.test(t)) continue;
    /* The source line node echoes under that header is code, not a message. */
    if (/^(const|let|var|await|return|throw|function|\}|\{)/.test(t)) continue;
    usable.push(t);
  }
  const hit = usable.find(t => ERRORISH.test(t)) || usable[0] || '';
  return hit.slice(0, 96);
}

/* ── the note a suite leaves when it dies ────────────────────────────────────
   tests/_deathnote.js prints what the page said before the suite went, and the
   runner's failure filter dropped every line of it: that filter shows lines
   opening with FAIL, Error, TypeError or ReferenceError, and a note's lines
   open with none of those. So the note reached tests/last-run.log and nothing
   else — written, and then not shown, which for the reader is the same as the
   evidence having been discarded one step earlier.

   Returns the note's body without its heading, and without the exception below
   it: report() prints that separately and a table that says it twice is a table
   nobody trusts.

   THE BOUNDARY IS THE INDENT, NOT THE WORDING. The first version stopped at
   the first line that looked like an exception, which is the one thing a
   note's body is FULL of — the page's own errors. Pointed at a real death it
   dropped the page's first message and kept only the bookkeeping above it:

       BREAKS  "TypeError: null is not an object (evaluating…"   2 lines
       kept    "Unhandled Promise Rejection: TypeError: null…"   3 lines
       BREAKS  "ReferenceError: Can't find variable: setTheme"   2 lines

   A filter that discards the evidence and keeps the labels reads as a note
   that had nothing to say. deathNote() indents every body line by exactly two
   spaces; node's exception has none and its stack frames have four, so the
   shape of the line says where the note ends and nothing about its content
   has to be guessed at. */
function noteOf(out, cap = 12) {
  const lines = String(out || '').split('\n');
  const at = lines.findIndex(l => l.includes(HEADING));
  if (at < 0) return [];
  const body = [];
  for (const raw of lines.slice(at + 1)) {
    if (!/^ {2}\S/.test(raw)) break;
    body.push(raw.trim().slice(0, 160));
    if (body.length >= cap) { body.push('…'); break; }
  }
  return body;
}

module.exports = { causeOf, noteOf, NOISE, FILE_POS, ERRORISH, HEADING };
