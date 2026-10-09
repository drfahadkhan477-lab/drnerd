#!/usr/bin/env node
/*
 * A study file — markdown written with Claude, or a saved HTML page turned
 * into the same markdown — becomes a unit's text and a pack held to it.
 *
 *   node tests/verify-memorizer-studyimport-pure.js
 *
 * Pure Node: the unit is cut from the file's study text by the real chunker
 * and the pack goes through the real Pack.check, as ui.js importStudyUnit
 * does. HTML needs a DOM: tests/verify-memorizer-studyimport.js reads real
 * HTML files in a browser.
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
const Coach = require(path.join(SRC, 'coach.js'));

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
const got = SI.packFor(p, doc, Pack, Coach);
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

head('two sections: each item goes where it was written');
const MD2 = [
  '---', 'unit: Aortic Stenosis', 'source_book: Braunwald 12e, chapter 72', 'source_page_range: 1450-1470', 'difficulty_level: advanced',
  'learning_objectives:', '  - Grade severity', '  - Time valve replacement', '---', '',
  '## Diagnosis and grading', '',
  'Aortic stenosis is graded by echocardiography using the peak jet velocity and the mean gradient across the valve. A peak velocity of 4 m/s or more marks severe stenosis [p. 1452]. A mean gradient of 40 mmHg or more also marks severe stenosis. The valve area falls below 1.0 cm2 in severe disease. Low flow low gradient stenosis needs dobutamine echocardiography to separate true stenosis from pseudostenosis. Calcium scoring on CT helps when the echo is discordant.',
  '',
  '- **Peak velocity**: the fastest jet through the valve, 4 m/s or more in severe stenosis [p. 1452].',
  '',
  '## Treatment and timing', '',
  'Valve replacement is indicated once symptoms appear, whether angina, syncope or heart failure. Transcatheter replacement suits older patients and those at high surgical risk. Surgical replacement suits younger patients with a long life expectancy. Balloon valvotomy is only a bridge. Medical therapy does not change the natural history of severe stenosis. Asymptomatic patients with a falling ejection fraction below 50 percent are also referred.',
  '',
  '| Approach | Best suited to |', '|---|---|', '| Transcatheter | older or high surgical risk |', '| Surgical | younger, long life expectancy |',
  '',
  '### Question 1',
  '**Stem**: Which echocardiographic finding grades aortic stenosis as severe?',
  '- A) A peak jet velocity of 4 m/s or more', '- B) A valve area above 2 cm2', '- C) A mean gradient of 10 mmHg', '- D) A normal calcium score',
  '**Correct Answer**: A',
  '**Explanation**: A peak jet velocity of 4 m/s or more on echocardiography marks severe stenosis, graded with the mean gradient across the valve.',
  '',
  '### Question 2',
  '**Stem**: A question with three options only?',
  '- A) One', '- B) Two', '- C) Three',
  '**Correct Answer**: A',
].join('\n');
const p2 = SI.parseMarkdown(MD2), text2 = SI.studyText(p2);
const doc2 = { id: 'u2', name: p2.title, clusters: Chunk.clusterBlocks(Chunk.blocksFromPages(Chunk.pagesFromText(text2)).blocks) };
ok('the fixture is cut into its two sections', doc2.clusters.length === 2, doc2.clusters.map(c => c.title).join(' | '));
const got2 = SI.packFor(p2, doc2, Pack, Coach), secs2 = got2.pack ? got2.pack.sections : [];
const s2 = secs2.find(s => s.section === 2) || { lesson: { points: [], tables: [] }, quiz: { questions: [] } };
ok('a section with a table and a question but no "**Term**:" points is still sent', !!secs2.find(s => s.section === 2), JSON.stringify(secs2.map(s => s.section)));
ok('its lesson points are the built-in coach’s, from its own text', s2.pointsBy === 'coach' && s2.lesson.points.length > 0 && s2.lesson.points.every(x => text2.includes(x.text)), JSON.stringify(s2.lesson.points.map(x => x.text)));
ok('its table stays with it', s2.lesson.tables.length === 1);
ok('a question written under "Treatment" stays there, though its words are "Diagnosis"’s', s2.quiz.questions.some(q => /echocardiographic finding/.test(q.question)) && !secs2.some(s => s.section === 1 && s.quiz.questions.length), JSON.stringify(secs2.map(s => [s.section, s.quiz.questions.length])));
const checked2 = Pack.check([got2.pack], doc2);
ok('Pack.check accepts both sections', checked2.sections.length === 2 && checked2.refused.length === 0, JSON.stringify(checked2.refused));
const pt1 = ((checked2.sections.find(s => s.index === 0) || {}).lesson || { points: [] }).points.map(x => x.text).join(' ');
ok('a citation in the file, [p. 1452], is kept in the lesson point as written', /\[p\. 1452\]/.test(pt1), pt1);
ok('and in the unit’s text, where Ask quotes from', /severe stenosis \[p\. 1452\]/.test(text2));
ok('the three-option question is dropped by the check, with its reason', checked2.dropped.some(d => /3 options/.test(d.why)), JSON.stringify(checked2.dropped));
const sum2 = SI.parseStudyFile(MD2, 'as.md').summary;
ok('the preview counts it as not usable before import', sum2.questions === 2 && sum2.answered === 2 && sum2.malformed === 1, JSON.stringify(sum2));
const meta2 = SI.studyMeta(p2);
ok('the front matter the prompt asks for is kept: source, pages, level, objectives',
   meta2.sourceBook === 'Braunwald 12e, chapter 72' && meta2.pageRange === '1450-1470' && meta2.difficulty === 'advanced' &&
   JSON.stringify(meta2.objectives) === '["Grade severity","Time valve replacement"]', JSON.stringify(meta2));

head('placing a point by where its words are, not by how many it shares');
const MD3 = MD2.replace('| Approach |', '- **Valve area**: graded by the mean gradient and peak velocity on echocardiography.\n\n| Approach |');
const p3 = SI.parseMarkdown(MD3), text3 = SI.studyText(p3);
const doc3 = { id: 'u3', name: p3.title, clusters: Chunk.clusterBlocks(Chunk.blocksFromPages(Chunk.pagesFromText(text3)).blocks) };
const secs3 = (SI.packFor(p3, doc3, Pack, Coach).pack || { sections: [] }).sections;
const where3 = secs3.filter(s => s.lesson.points.some(x => /^Valve area: graded/.test(x.text))).map(s => s.section);
ok('a point written under "Treatment" goes to Treatment, though every word of it is in "Diagnosis" too (a tie that overlap gives to the earlier section)', JSON.stringify(where3) === '[2]', JSON.stringify(where3));

head('strict import: the question’s scenario is held to the text too');
const MD5 = MD2.replace('**Stem**: Which echocardiographic finding grades aortic stenosis as severe?',
  '**Stem**: A 72-year-old has a peak velocity of 4 m/s and a pressure of 210 mmHg. Which echocardiographic finding grades aortic stenosis as severe?');
const p5 = SI.parseMarkdown(MD5), t5 = SI.studyText(p5);
const d5 = { id: 'u5', name: p5.title, clusters: Chunk.clusterBlocks(Chunk.blocksFromPages(Chunk.pagesFromText(t5)).blocks) };
const plain5 = Pack.check([SI.packFor(p5, d5, Pack, Coach).pack], d5);
const q5 = c => [].concat(...c.sections.map(s => s.quiz.questions)).find(q => /72-year-old/.test(q.question)) || {};
ok('without strict, a vignette’s numbers are not checked (Pack.check holds only the answer and explanation)', !q5(plain5).flag, q5(plain5).flag);
const strict5 = Pack.check([SI.packFor(p5, d5, Pack, Coach).pack], d5);
const nFlag = SI.strictQuestions(strict5, d5, Pack);
ok('with strict, a number in the scenario that the text does not have flags the question', /in its scenario/.test(q5(strict5).flag || '') && /(72|210)/.test(q5(strict5).flag || '') && nFlag === 1, q5(strict5).flag);
ok('and the flag is counted in the import note', /1 item not found/.test(Pack.report(strict5).line), Pack.report(strict5).line);
const strict2 = Pack.check([SI.packFor(p2, doc2, Pack, Coach).pack], doc2);
ok('a scenario whose numbers are all in the text is not flagged', SI.strictQuestions(strict2, doc2, Pack) === 0);

head('flowcharts and diagrams');
const MD6 = MD2
  .replace('- **Peak velocity**:', '```mermaid\nflowchart TD\n  A["Aortic stenosis"] --> B["Peak velocity and mean gradient"]\n  B --> C["Severe stenosis"]\n```\n\n<svg viewBox="0 0 10 10"><rect/><rect/><text>svgonlylabel</text></svg>\n\n- **Peak velocity**:')
  .replace('| Approach |', '```\nSymptoms appear\n    ↓\nValve replacement\n    ├─→ Transcatheter replacement\n    └─→ Surgical replacement\n```\n\n```js\nconst notAFlowchart = x => x + 1;\nlist.map(notAFlowchart);\ndone();\n```\n\n| Approach |');
const p6 = SI.parseMarkdown(MD6), t6 = SI.studyText(p6);
const d6 = { id: 'u6', name: p6.title, clusters: Chunk.clusterBlocks(Chunk.blocksFromPages(Chunk.pagesFromText(t6)).blocks) };
ok('a mermaid block and an arrow-drawn block are flowcharts; a js block is not', p6.flowcharts.length === 2, JSON.stringify(p6.flowcharts.map(f => f.code.split('\n')[0])));
ok('the arrow-drawn block keeps its shape: both branches leave "Valve replacement"', /N1 --> N2/.test((p6.flowcharts[1] || { code: '' }).code) && /N1 --> N3/.test(p6.flowcharts[1].code) && /N0 --> N1/.test(p6.flowcharts[1].code), (p6.flowcharts[1] || {}).code);
const got6 = SI.packFor(p6, d6, Pack, Coach), c6 = Pack.check([got6.pack], d6);
const fc = i => ((c6.sections.find(s => s.index === i) || {}).lesson || {}).flowchart || '';
ok('each flowchart is the lesson flowchart of the section it was drawn in', /Peak velocity and mean gradient/.test(fc(0)) && /Transcatheter replacement/.test(fc(1)), JSON.stringify([fc(0).slice(0, 40), fc(1).slice(0, 40)]));
ok('neither is dropped by the check', !c6.dropped.some(d => d.where === 'flowchart'), JSON.stringify(c6.dropped));
ok('the drawing goes with its section, raw here, to be cleaned where there is a DOM', got6.diagrams.length === 1 && got6.diagrams[0].index === 0 && /<svg/.test(got6.diagrams[0].svg));
ok('and none of it is study text', !/svgonlylabel|notAFlowchart|-->/.test(t6));

head('where each item came from');
const pe = SI.parseMarkdown(SI.STUDY_EXAMPLE), te = SI.studyText(pe);
const de = { id: 'ue', name: pe.title, clusters: Chunk.clusterBlocks(Chunk.blocksFromPages(Chunk.pagesFromText(te)).blocks) };
const qe = [].concat(...Pack.check([SI.packFor(pe, de, Pack, Coach).pack], de).sections.map(s => s.quiz.questions))[0] || {};
ok('a question keeps its source: the file, the heading it was written under, the page it cites', qe.source === 'Your study file, “Practice Questions”, p. 1460', qe.source);
ok('and the page the unit shows for it is still the unit’s own', typeof qe.page === 'number');
const MDG = ['## Grading', '', 'Aortic stenosis raises the gradient across the valve.', '', 'Description: Pressure in the ventricle and the aorta in systole [p. 1452]',
  '<svg viewBox="0 0 10 10"><title>LV and aortic pressure</title><rect/><rect/><path d="M0 0"/></svg>'].join('\n');
const pg = SI.parseMarkdown(MDG), tg = SI.studyText(pg);
const dg = { id: 'ug', name: 'G', clusters: Chunk.clusterBlocks(Chunk.blocksFromPages(Chunk.pagesFromText(tg)).blocks) };
const gd = (SI.packFor(pg, dg, Pack, Coach).diagrams || [])[0] || {};
ok('a diagram keeps its section, caption, alt text and the page its caption cites',
   gd.section === 'Grading' && /^Pressure in the ventricle/.test(gd.caption) && gd.alt === 'LV and aortic pressure' && gd.cite === 'p. 1452' && gd.kind === 'svg', JSON.stringify(Object.assign({}, gd, { svg: '…' })));

head('prose after a question');
const MD4 = ['# Loading', '', 'Preload is the stretch on the wall at the end of filling.', '', '## Quiz', '', '### Question 1', '**Stem**: Which term names the stretch?',
  '- A) Preload', '- B) Afterload', '- C) Inotropy', '- D) Compliance', '**Correct Answer**: A', '', '---', '',
  'Summary: afterload rises with aortic pressure and falls with vasodilators.'].join('\n');
const p4 = SI.parseMarkdown(MD4), text4 = SI.studyText(p4);
ok('a "---" rule ends a question, and the prose after it is study text', p4.questions.length === 1 && p4.questions[0].options.length === 4 && /afterload rises with aortic pressure/.test(text4), text4);

head('size');
ok('a file over the limit is refused with a way forward, not parsed', (r => !r.success && /too large/.test(r.error) && /Split/.test(r.error))(SI.parseStudyFile('x'.repeat(SI.MAX_BYTES + 1), 'big.md')));

head('which reader');
ok('.html is read as HTML, .md as markdown', SI.detectFormat('a.html', '') === 'html' && SI.detectFormat('a.md', '<html>') === 'markdown');
ok('with no telling name, a page that starts as HTML is HTML', SI.detectFormat('a', '<!DOCTYPE html><html>') === 'html' && SI.detectFormat('a', '# Title') === 'markdown');
ok('a file with no study text is refused, not made an empty unit', SI.parseStudyFile('---\nunit: x\n---\n', 'x.md').success === false);

head('only a flowchart reaches Mermaid');
/* Mermaid's other diagram types carry its published injection advisories,
   and a %%{...}%% directive reconfigures it from inside the diagram */
const kinds = { 'flowchart TD\n  A --> B': true, '%% a note\ngraph LR\n  A --> B': true, '  flowchart LR\n  A --> B': true,
  'sequenceDiagram\n  A-->>B: hi': false, 'stateDiagram-v2\n  A --> B': false, 'classDiagram\n  A --> B': false,
  '%%{init: {"theme": "dark"}}%%\nflowchart TD\n  A --> B': false, 'flowchart TD\n  A --> B\n%%{init: {}}%%': false, 'gantt\n  title x': false };
const wrong = Object.keys(kinds).filter(k => SI.isFlowchart(k) !== kinds[k]);
ok('flowcharts (TD/LR, after a %% comment) are drawn; sequence, state, class, gantt and %%{directives}%% are not', wrong.length === 0, JSON.stringify(wrong));
const asBlock = t => SI.parseMarkdown('---\nunit: X\n---\n\n## A\n- **Term**: text for the unit.\n\n```mermaid\n' + t + '\n```\n').flowcharts.length;
ok('and a study file\u2019s mermaid block is kept only when it is one', asBlock('flowchart TD\n  A --> B') === 1 && asBlock('sequenceDiagram\n  A-->>B: hi') === 0 &&
   asBlock('stateDiagram-v2\n  A --> B') === 0);

head('a section deleted: its diagrams with it, later ones moved up');
const Study = require(path.join(SRC, 'study.js'));
const withDiagrams = { clusters: [{ text: 'a' }, { text: 'b' }, { text: 'c' }], diagrams: [{ index: 0, svg: 'A' }, { index: 1, svg: 'B' }, { index: 2, svg: 'C' }] };
const cut = Study.dropDocSection(withDiagrams, 1);
ok('the dropped section\u2019s diagram goes, and the one after it now belongs to the section that moved up',
   JSON.stringify(cut.diagrams) === JSON.stringify([{ index: 0, svg: 'A' }, { index: 1, svg: 'C' }]) && cut.clusters.length === 2, JSON.stringify(cut.diagrams));
ok('and the unit it was given is left as it was', withDiagrams.diagrams.length === 3 && withDiagrams.diagrams[2].index === 2);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
