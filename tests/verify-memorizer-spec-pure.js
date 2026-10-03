#!/usr/bin/env node
/*
 * One study format for both Claude prompts (memorizer/src/spec.js).
 *
 *   node tests/verify-memorizer-spec-pure.js
 *
 * Pure Node. The study-pack prompt (pack.js) and the study-file prompt
 * (studyImport.js) must each carry spec.js's rules word for word; the counts
 * the importer and the checker enforce must be spec.js's; the example the
 * study-file prompt shows Claude must be read by the real importer into
 * exactly what it shows, and pass the real pack check; and the doc must be
 * the app's prompt.
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

const ROOT = path.join(__dirname, '..'), SRC = path.join(ROOT, 'memorizer', 'src');
const Spec = require(path.join(SRC, 'spec.js'));
const Prompts = require(path.join(SRC, 'prompts.js'));
const Pack = require(path.join(SRC, 'pack.js'));
const SI = require(path.join(SRC, 'studyImport.js'));
const Chunk = require(path.join(SRC, 'chunk.js'));
const Coach = require(path.join(SRC, 'coach.js'));

const DOC = { id: 'd', name: 'Aortic stenosis', clusters: [
  { title: 'Grading', pageStart: 10, pageEnd: 10, segments: [{ text: 'A mean gradient above 40 mmHg marks severe stenosis.', page: 10 }] },
] };
const packPrompt = Pack.prompt(DOC), filePrompt = SI.studyFilePrompt();

head('the rules, word for word in both prompts');
const shared = ['points', 'numbers', 'mcq', 'options', 'style', 'explain', 'why', 'table', 'flowchart', 'distinction'];
shared.forEach(k => {
  ok('"' + k + '" is in the study-pack prompt', packPrompt.indexOf(Spec.RULES[k]) !== -1);
  ok('"' + k + '" is in the study-file prompt', filePrompt.indexOf(Spec.RULES[k]) !== -1);
});
ok('the study-file prompt also carries the source-only rule', filePrompt.indexOf(Spec.RULES.onlySource) !== -1);
ok('each asks for its question count from spec.js',
   packPrompt.indexOf(Spec.QUESTIONS.section[0] + ' to ' + Spec.QUESTIONS.section[1] + ' board-style questions') !== -1 &&
   filePrompt.indexOf(Spec.QUESTIONS.file[0] + ' to ' + Spec.QUESTIONS.file[1] + ' board-style questions') !== -1);
ok('neither still carries an old hand-written count for points', !/8-12|8 to 12/.test(packPrompt + filePrompt));

head('what is enforced is what is asked');
ok('the checker’s option count is spec.js’s', Prompts.OPTIONS === Spec.OPTIONS);
const q = n => ({ question: 'q?', options: Array.from({ length: n }, (_, i) => 'option ' + i), answer: 0 });
ok('a question with one option fewer or more is refused', Prompts.mcqError(q(Spec.OPTIONS - 1), 'q') !== '' && Prompts.mcqError(q(Spec.OPTIONS + 1), 'q') !== '' && Prompts.mcqError(q(Spec.OPTIONS), 'q') === '');
const three = '## T\n\nSome text about grading here.\n\n## Practice Questions\n\n### Question 1\n**Stem**: Which?\n- A) a\n- B) b\n- C) c\n**Correct Answer**: A\n';
ok('the import preview counts such a question as not usable', SI.parseStudyFile(three, 't.md').summary.malformed === 1);

head('targets and limits are different numbers');
ok('the importer\u2019s limits are spec.js\u2019s LIMITS', SI.MAX_BYTES === Spec.LIMITS.fileBytes && SI.DIAGRAMS_MAX === Spec.LIMITS.diagrams);
ok('each limit is above its target, so a file written to the prompt never meets it', Spec.LIMITS.flowNodes > Spec.FLOW_NODES);
const big = Array.from({ length: Spec.FLOW_NODES + 4 }, (_, i) => 'Step ' + i).join('\n    \u2193\n');
ok('a flowchart past the target but inside the limit is still read, whole', (SI.asciiFlow(big).match(/\["Step/g) || []).length === Spec.FLOW_NODES + 4);
const huge = Array.from({ length: Spec.LIMITS.flowNodes + 5 }, (_, i) => 'Step ' + i).join('\n    \u2193\n');
ok('one past the limit is cut at the limit', (SI.asciiFlow(huge).match(/\["Step/g) || []).length === Spec.LIMITS.flowNodes);

head('the example the study-file prompt shows');
const shown = filePrompt.slice(filePrompt.indexOf('````markdown\n') + '````markdown\n'.length, filePrompt.lastIndexOf('\n````'));
ok('the prompt shows STUDY_EXAMPLE exactly', shown === SI.STUDY_EXAMPLE);
const ex = SI.parseMarkdown(SI.STUDY_EXAMPLE);
ok('it is read with its front matter', ex.title === 'Aortic Stenosis' && SI.studyMeta(ex).sourceBook === 'Braunwald 12e, chapter 72');
ok('its points are read, each within the word limit and led by its key term', ex.points.length === 3 &&
   ex.points.every(p => (p.term + ' ' + p.text).split(/\s+/).length <= Spec.POINTS.words && p.term), JSON.stringify(ex.points.map(p => p.term)));
ok('its table and its flowchart are read', ex.tables.length === 1 && ex.flowcharts.length === 1);
const eq = ex.questions[0] || { options: [], why: [] };
ok('its question has exactly the options spec.js asks for, its answer and its explanation', ex.questions.length === 1 && eq.options.length === Spec.OPTIONS && eq.answer === 1 && /indicated once symptoms/.test(eq.explain));
ok('and a reason for every wrong option', eq.options.every((_, k) => k === eq.answer || !!eq.why[k]), JSON.stringify(eq.why));
const text = SI.studyText(ex);
const unit = { id: 'ex', name: ex.title, clusters: Chunk.clusterBlocks(Chunk.blocksFromPages(Chunk.pagesFromText(text)).blocks) };
const checked = Pack.check([SI.packFor(ex, unit, Pack, Coach).pack], unit);
ok('it passes the pack check: nothing refused, dropped or flagged', checked.refused.length === 0 && checked.dropped.length === 0 &&
   checked.sections.every(s => !s.flags.length), JSON.stringify({ r: checked.refused, d: checked.dropped, f: checked.sections.map(s => s.flags) }));
ok('its flowchart reaches the lesson', checked.sections.some(s => /Valve replacement/.test(s.lesson.flowchart || '')));
/* a decision flowchart as Spec.RULES asks for it, held to a passage with
   no negation in it: the arrows' yes and no are the answers to the
   question, not claims (pack.js labels); a "not" in a step, or a number on
   an arrow, still is a claim */
const flowWith = f => {
  const st = SI.parseMarkdown(['---', 'unit: Flow', '---', '', '## Management',
    '- **Severe aortic stenosis**: with symptoms it is treated by valve replacement; when symptoms are absent it is followed with echocardiography.', '',
    '```mermaid', f, '```'].join('\n'));
  const u = { id: 'fl', name: st.title, clusters: Chunk.clusterBlocks(Chunk.blocksFromPages(Chunk.pagesFromText(SI.studyText(st))).blocks) };
  return Pack.check([SI.packFor(st, u, Pack, Coach).pack], u);
};
const kept = flowWith('flowchart TD\n  A["Severe aortic stenosis"] --> B{"Symptoms?"}\n  B -->|"yes"| C["Valve replacement"]\n  B -->|"no"| D["Echocardiography"]');
ok('a decision flowchart\u2019s yes and no arrows are not read as claims: kept, and in the lesson', !kept.dropped.some(d => d.where === 'flowchart') &&
   kept.sections.some(x => /Echocardiography/.test(x.lesson.flowchart || '')), JSON.stringify(kept.dropped));
const notStep = flowWith('flowchart TD\n  A["Severe aortic stenosis"] --> B["Do not replace the valve"]');
ok('a step that says "not" where the passage does not is still dropped', notStep.dropped.some(d => d.where === 'flowchart' && /negation/.test(d.why)), JSON.stringify(notStep.dropped));
const numArrow = flowWith('flowchart TD\n  A["Severe aortic stenosis"] -->|"gradient 64"| C["Valve replacement"]');
ok('and a number on an arrow is still held to the passage', numArrow.dropped.some(d => d.where === 'flowchart' && /number/.test(d.why)), JSON.stringify(numArrow.dropped));
const fenced = SI.parseMarkdown('```markdown\n' + SI.STUDY_EXAMPLE + '\n```');
ok('a reply copied with its code fence still reads the same', fenced.points.length === 3 && fenced.questions.length === 1 && fenced.flowcharts.length === 1);

head('the doc is the app’s prompt');
const gen = require(path.join(ROOT, 'scripts', 'study-file-prompt.js'));
ok('docs/MEMORIZER-STUDY-FILE-PROMPT.md is exactly what the script writes', fs.readFileSync(gen.OUT, 'utf8') === gen.doc());
ok('and it carries the prompt whole', fs.readFileSync(gen.OUT, 'utf8').indexOf(filePrompt) !== -1);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
