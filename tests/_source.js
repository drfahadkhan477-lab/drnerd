'use strict';
/*
 * Reading this repository's own source as text, without reading its comments.
 *
 * Several suites scan the tree for patterns — a suite calling chromium.launch()
 * directly, a waitForFunction passing options where the argument goes, an ok()
 * whose condition cannot come out false, a tool still guessing at a field name.
 * Every one of them has the same problem: the files here explain themselves at
 * length, and those explanations QUOTE the very patterns being hunted. A scan
 * that reads comments finds the paragraph warning about the bug and reports it
 * as the bug.
 *
 * That has now happened three times in one day, in three different files, twice
 * to the person who had just written the paragraph. So it lives here once.
 *
 * ── BLANKED, NOT STRIPPED ────────────────────────────────────────────────
 *
 * Comments are replaced with spaces of the same length, newlines kept. Two
 * things depend on that, and both were got wrong by an earlier local version:
 *
 *   · POSITIONS SURVIVE. A scanner that finds a hit at index N can report the
 *     line it is really on, and an edit computed against the blanked copy can
 *     be applied to the real file. tools that rewrite source need this;
 *     stripping silently shifts everything after the first comment.
 *   · LINES DO NOT MERGE. Replacing a multi-line comment with a single space
 *     joins the code before it to the code after it. Every ^-anchored /m
 *     pattern in these suites then sees a line that does not exist, which can
 *     hide a real call or invent one.
 *
 * ── WHAT IT IS NOT ───────────────────────────────────────────────────────
 *
 * Not a lexer. A // inside a string literal is blanked as though it opened a
 * comment, and the `[^:\\]` guard is there only to spare the most common false
 * positive — the // in a URL. Every caller here is scanning for coarse
 * patterns in a repository it owns, where that trade is right. Do not reach
 * for it to parse someone else's JavaScript.
 */

const blankComments = src => String(src)
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));

module.exports = { blankComments };
