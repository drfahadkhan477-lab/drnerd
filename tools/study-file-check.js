#!/usr/bin/env node
'use strict';
/*
 * What Memorizer would say about a study file, before it is imported.
 *
 *   node tools/study-file-check.js <file.md|file.html> [--strict]
 *
 * WHY. A study file Claude writes (docs/MEMORIZER-STUDY-FILE-PROMPT.md) is
 * checked by the app only when it is imported on the device. Writing one in
 * a Claude Code session, the mistakes were found a round trip later. This
 * runs the same path in Node, so the session that writes the file can fix
 * it before handing it over.
 *
 * THE SAME PATH, NOT A COPY OF ITS RULES. It calls the app's own code, in
 * the order ui.js importStudyUnit does: studyImport.parseStudyFile, the
 * study text cut into sections by chunk.js, studyImport.packFor,
 * pack.check, and with --strict (the import dialog's "Strict consistency
 * check") studyImport.strictQuestions. The sections are built the way
 * tests/verify-memorizer-studyimport-pure.js builds them; ui.js saveUnit
 * does the same cut and adds bookkeeping that changes no check.
 *
 * WHAT IT CLAIMS, narrowly: what the app would drop, refuse or flag. It
 * checks the file against its own text, as the app does. It does not check
 * it against the book or against medicine, and it says so in its last line.
 *
 * WHAT IT PRINTS: counts, and for each problem where it is and why, in the
 * app's own words. Never an item's text: the file is derived from a book.
 *
 * Exit 0 when the app would import everything and flag nothing; 1 when it
 * would drop, refuse, flag or skip anything; 2 on a usage error.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'memorizer', 'src');
const Chunk = require(path.join(SRC, 'chunk.js'));
const Pack = require(path.join(SRC, 'pack.js'));
const SI = require(path.join(SRC, 'studyImport.js'));
const Coach = require(path.join(SRC, 'coach.js'));

/* Returns { ok, lines } so the suite can drive it without a subprocess. */
function checkStudyFile(content, name, strict) {
  const lines = [];
  const problem = (where, why) => lines.push(`  PROBLEM  ${where}: ${why}`);
  const got = SI.parseStudyFile(content, name);
  if (!got.success) { problem('file', got.error); return { ok: false, lines }; }
  const s = got.summary;
  lines.push(`  read as ${got.format}: ${s.words} words, ${s.teaching_points} points, ${s.tables} tables, ` +
             `${s.flowcharts} flowcharts, ${s.diagrams} diagrams, ${s.questions} questions`);
  let bad = 0;
  if (s.unanswered) { bad++; problem('questions', `${s.unanswered} with no Correct Answer line: left out, never guessed`); }
  if (s.malformed) { bad++; problem('questions', `${s.malformed} without exactly 4 options: left out`); }
  if (!s.teaching_points) { bad++; problem('points', 'none read: no "- **Term**: fact" line'); }

  const clusters = Chunk.clusterBlocks(Chunk.blocksFromPages(Chunk.pagesFromText(got.study.text)).blocks);
  const doc = { id: 'check', name: got.study.name, clusters };
  const pk = SI.packFor(got.study.parsed, doc, Pack, Coach);
  if (!pk.pack) {
    lines.push('  no study pack: the app would teach it as plain study text');
    return { ok: false, lines: lines.concat(['  PROBLEM  pack: nothing in the file became a lesson']) };
  }
  const checked = Pack.check([pk.pack], doc);
  if (strict) SI.strictQuestions(checked, doc, Pack);
  checked.refused.forEach(r => { bad++; problem(`section ${r.section}`, `refused: ${r.why}`); });
  checked.dropped.forEach(d => { bad++; problem(d.where, `dropped: ${d.why}`); });
  checked.sections.forEach(sec => sec.flags.forEach(f => { bad++; problem(`section ${sec.index + 1}, ${f.where}`, `flagged: ${f.why}`); }));
  lines.push('  app: ' + Pack.report(checked, 'the file’s own text').line);
  lines.push(bad
    ? `  ${bad} problem${bad === 1 ? '' : 's'}. Fix each from the source, not by deleting the check's evidence.`
    : '  clean: the app would import all of it and flag nothing' + (strict ? ', strict included' : '') + '.');
  lines.push('  checked against the file’s own text only, not against the book or the medicine.');
  return { ok: bad === 0, lines };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const file = args.find(a => !a.startsWith('--'));
  if (!file) { console.error('usage: node tools/study-file-check.js <file.md|file.html> [--strict]'); process.exit(2); }
  if (!fs.existsSync(file)) { console.error(`no such file: ${file}`); process.exit(2); }
  const r = checkStudyFile(fs.readFileSync(file, 'utf8'), path.basename(file), strict);
  console.log(r.lines.join('\n'));
  process.exit(r.ok ? 0 : 1);
}

module.exports = { checkStudyFile };
