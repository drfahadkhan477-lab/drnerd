#!/usr/bin/env node
/*
 * A study file — markdown written with Claude, or a saved HTML page turned
 * into the same markdown — becomes a unit's text and a pack held to it.
 *
 *   node tests/verify-memorizer-studyimport-pure.js
 *
 * Pure Node: the unit is cut from the file's study text by the real chunker
 * and the pack goes through the real Pack.check, as ui.js importStudyUnit
 * does. HTML parsing needs a DOM, so htmlToMarkdown is not reached here; what
 * it writes is the markdown read below.
 */
'use strict';
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const SRC = path.join(__dirname, '..', 'memorizer', 'src');
const Chunk = require(path.join(SRC, 'chunk.js'));
const Pack = require(path.join(SRC, 'pack.js'));
const SI = require(path.join(SRC, 'studyImport.js'));

const MD = [
  '---', 'unit: Ventricular Loading', '---', '',
  '## Teaching Points',
  '- **Preload**: the stretch on the ventricular wall at the end of filling, set by venous return.',
  '- **Afterload**: the load the ventricle pumps against during ejection, raised by high aortic pressure.',
  '- **Contractility**: the force of contraction at a given preload, raised by sympathetic drive.',
  '',
  '```', 'A --> B', '```',
  '<svg viewBox="0 0 10 10"><text>diagram label</text></svg>',
  '',
  '## Comparison', '',
  '| Feature | Preload | Afterload |', '|---|---|---|',
  '| Timing | end of filling | during ejection |',
  '',
  '## Quiz', '',
  '### Question 1',
  '**Stem**: Which term names the wall stretch at the end of filling?',
  '- A) Afterload', '- B) Preload', '- C) Contractility', '- D) Compliance',
  '**Correct Answer**: B',
  '**Explanation**: Preload is the stretch at the end of filling, set by venous return.',
  '**Clinical Pearl**: a sentence that is not the explanation.',
  '',
  '### Question 2',
  '**Stem**: Which term has no answer marked here?',
  '- A) Afterload', '- B) Preload', '- C) Contractility', '- D) Compliance',
  '',
  '### Question 3',
  '**Stem**: What raises afterload?',
  '- A) Venous return', '- B) Sympathetic drive', '- C) High aortic pressure', '- D) Bradycardia',
  '**Answer:** C',
  '**Explanation**: Afterload is raised by high aortic pressure.',
  '',
  '#### Question 4: laid out as the study-file prompt asks',
  '**Stem**: Which raises contractility?',
  '',
  '**Options**:',
  '- A) Venous return', '- B) Sympathetic drive', '- C) Bradycardia', '- D) Compliance',
  '',
  '**Correct Answer**: B',
  '',
  '**Explanation**: Contractility is raised by sympathetic drive.',
  '',
  '**Why the distractors are wrong**:',
  '- A) Venous return sets preload.', '- B) Right: sympathetic drive.', '- C) Bradycardia is a rate.', '- D) Compliance is stiffness.',
  '',
  '**Clinical Pearl**: a sentence that belongs to no option.',
].join('\n');

head('reading the markdown');
const p = SI.parseMarkdown(MD);
ok('the unit is named from the front matter', p.title === 'Ventricular Loading', p.title);
ok('every "- **term**: text" line is a teaching point', p.points.length === 3, String(p.points.length));
ok('the table is read with its columns and rows', p.tables.length === 1 && p.tables[0].columns.length === 3 && p.tables[0].rows.length === 1, JSON.stringify(p.tables.map(t => [t.columns, t.rows])));
ok('every question is read, the last in the file included', p.questions.length === 4, String(p.questions.length));
ok('a lettered answer becomes the index of its option ("B" → 1, "**Answer:** C" → 2)',
   p.questions[0] && p.questions[0].answer === 1 && p.questions[2] && p.questions[2].answer === 2,
   JSON.stringify(p.questions.map(q => q.answer)));
ok('a question with no answer marked has none (-1), not option A', p.questions[1] && p.questions[1].answer === -1, String(p.questions[1] && p.questions[1].answer));
ok('the explanation is kept, and a pearl after it is not part of it', (p.questions[0] && p.questions[0].explain) === 'Preload is the stretch at the end of filling, set by venous return.', p.questions[0] && p.questions[0].explain);
const q4 = p.questions[3] || { options: [], why: [] };
ok('in the prompt\u2019s layout, the "**Options**:" line is not part of the stem', q4.question === 'Which raises contractility?', q4.question);
ok('its four options are read, and not the reasons listed under them as more options', q4.options.length === 4 && q4.answer === 1, JSON.stringify(q4.options));
ok('each distractor keeps its reason, by letter', q4.why[0] === 'Venous return sets preload.' && q4.why[2] === 'Bradycardia is a rate.', JSON.stringify(q4.why));
ok('the explanation stops where the reasons begin', q4.explain === 'Contractility is raised by sympathetic drive.', q4.explain);

head('the study text the unit is cut from');
const text = SI.studyText(p);
ok('it carries the teaching points and the table rows', /Preload: the stretch/.test(text) && /Timing; Preload: end of filling/.test(text), text.slice(0, 200));
ok('it carries no question stem — a quiz is not something to be taught', !/wall stretch at the end of filling\?/.test(text) && !/What raises afterload/.test(text));
ok('code blocks and SVG are left out of it', !/-->/.test(text) && !/diagram label/.test(text));

head('the pack, held to that text');
const clusters = Chunk.clusterBlocks(Chunk.blocksFromPages(Chunk.pagesFromText(text)).blocks);
const doc = { id: 'u1', name: p.title, clusters };
const got = SI.packFor(p, doc, Pack);
ok('the unit has sections', clusters.length >= 1, String(clusters.length));
ok('the question with no marked answer is counted and left out of the pack', got.unanswered === 1, String(got.unanswered));
const checked = got.pack ? Pack.check([got.pack], doc) : { sections: [], refused: [], dropped: [] };
const nq = checked.sections.reduce((n, s) => n + s.quiz.questions.length, 0);
ok('Pack.check accepts it: nothing refused, nothing dropped', got.pack && checked.refused.length === 0 && checked.dropped.length === 0,
   JSON.stringify({ refused: checked.refused, dropped: checked.dropped }));
ok('the three answered questions reach the unit, with their right answers', nq === 3 &&
   checked.sections.every(s => s.quiz.questions.every(q => ['Preload', 'High aortic pressure', 'Sympathetic drive'].includes(q.options[q.answer]))), String(nq));
const packedQ4 = [].concat(...checked.sections.map(s => s.quiz.questions)).find(q => /contractility/.test(q.question)) || {};
ok('a question with reasons carries one per option, "" for the right one', JSON.stringify(packedQ4.why) === JSON.stringify(['Venous return sets preload.', '', 'Bradycardia is a rate.', 'Compliance is stiffness.']), JSON.stringify(packedQ4.why));
ok('all three teaching points reach the lesson', checked.sections.reduce((n, s) => n + s.lesson.points.length, 0) === 3);

head('which reader');
ok('.html is read as HTML, .md as markdown', SI.detectFormat('a.html', '') === 'html' && SI.detectFormat('a.md', '<html>') === 'markdown');
ok('with no telling name, a page that starts as HTML is HTML', SI.detectFormat('a', '<!DOCTYPE html><html>') === 'html' && SI.detectFormat('a', '# Title') === 'markdown');
ok('a file with no study text is refused, not made an empty unit', SI.parseStudyFile('---\nunit: x\n---\n', 'x.md').success === false);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
