/* ═══════════════════════════════════════════════════════════════════════════
   spec.js — the study format, once. Memorizer takes study material from
   Claude two ways: a study pack (JSON, pack.js, one reply per few sections
   of a unit already in the app) and a study file (markdown, studyImport.js,
   a whole unit written from the owner's own PDF). Both prompts are built
   from the rules here, the importer and the checker read the counts from
   here, and tests/verify-memorizer-spec-pure.js holds all of them to it —
   so a rule changed here changes both prompts and what is accepted, and a
   rule written into only one of them is caught.

   PURE. Strings and numbers; no dependencies.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var VERSION = 1;
/* GENERATION TARGETS: what the prompts ask Claude for. Pedagogy, not
   enforcement: a file with eleven points or a fourteen-node flowchart is
   still read. The one exception is OPTIONS, which is both asked for and
   enforced (Prompts.mcqError), on purpose: a question is scored by option. */
var OPTIONS = 4;
var POINTS = { min: 5, max: 10, words: 25 };
var TABLE = { rows: 6, cols: 5 };
var FLOW_NODES = 12;
/* A pack is written per section; a study file per unit. */
var QUESTIONS = { section: [6, 8], file: [5, 10] };
/* IMPORT LIMITS: what the importer refuses or cuts, for safety and to keep
   an iPad responsive. Never a teaching choice, and each is well above its
   target where one exists, so a good file never meets them. */
var LIMITS = {
  fileBytes: 2 * 1024 * 1024,   /* a study file, read whole on the main thread */
  svgBytes: 200 * 1024,         /* one diagram */
  diagrams: 12,                 /* diagrams kept from one file */
  flowNodes: 30,                /* nodes read from one text-drawn flowchart */
};

var RULES = {
  points: POINTS.min + ' to ' + POINTS.max + ' high-yield points, most important first, each at most ' + POINTS.words +
    ' words and starting with its key term, then the fact.',
  numbers: 'Copy every number exactly as printed in the source: value, unit and direction (>, <, ≥, ≤). Never round, ' +
    'convert or combine numbers, and name conditions, tests and drugs in the source’s own words.',
  mcq: 'The right option and the explanation must come from the source; the wrong options must be plausible but shown ' +
    'wrong by it, never merely unmentioned.',
  options: 'Exactly ' + OPTIONS + ' options, all different, exactly one of them right. No "all of the above" or "none ' +
    'of the above".',
  style: 'Prefer clinical vignettes, "most likely", "next best step" and "all EXCEPT"; test reasoning, not recall of wording.',
  explain: 'The explanation says why the right answer is right, from the source.',
  why: 'For each wrong option, the exact reason the source makes it wrong; nothing for the right one.',
  table: 'A comparison of two or more things across two or more features is a table: the first column names what ' +
    'each row is, every row has one cell per column, at most ' + TABLE.rows + ' rows and ' + TABLE.cols + ' columns, ' +
    'cells a few words, and a cell the source does not fill is "—".',
  flowchart: 'A pathway, sequence or decision is a Mermaid "flowchart TD" of at most ' + FLOW_NODES + ' nodes: every ' +
    'label in double quotes and a few words from the source, decisions as {"question?"} with the answers on the ' +
    'arrows (-->|"yes"|), no styling and no subgraphs.',
  distinction: 'Two things a student mixes up are a distinction: both named, and the one feature that tells them apart.',
  onlySource: 'Work only from the source. Every fact, number, dose, threshold, drug, test and condition must be in ' +
    'it; add nothing from your own knowledge, however correct.',
};

var MemSpec = { VERSION: VERSION, LIMITS: LIMITS, OPTIONS: OPTIONS, POINTS: POINTS, TABLE: TABLE, FLOW_NODES: FLOW_NODES, QUESTIONS: QUESTIONS, RULES: RULES };
root.MemSpec = MemSpec;
if (typeof module !== 'undefined' && module.exports) module.exports = MemSpec;
})(typeof window !== 'undefined' ? window : this);
