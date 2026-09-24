#!/usr/bin/env node
/*
 * Memorizer's built-in coach: the whole protocol with no AI and no key —
 * and still nothing taught that the PDF does not say.
 *
 *   node tests/verify-memorizer-coach-pure.js
 *
 * Pure Node. memorizer/src/coach.js answers the same five steps the model
 * does, from the same arguments. What is proven here:
 *
 *   · SAME SHAPE. Every output passes the schema the model's replies are
 *     held to (MemPrompts.check), over many generated sections — so the
 *     session and the screens cannot tell the coaches apart.
 *   · NOTHING INVENTED. Every key point is a sentence of the section,
 *     verbatim, on the page it came from. Every blank's answer is a word
 *     that was in its sentence.
 *   · HONEST GRADING. Right answers pass, including a typo in a long word or
 *     a plural away; wrong ones fail, and 5 is never 50. A teach-back that
 *     says nothing scores 0 and one that says everything scores 100.
 *   · A GAUNTLET THAT IS NOT A REPEAT, weighted to the weakest sections.
 *
 * The section text below is written for this test — plain physiology, no
 * one's licensed material.
 */
'use strict';
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const K = require(path.join(ROOT, 'memorizer', 'src', 'coach.js'));
const P = require(path.join(ROOT, 'memorizer', 'src', 'prompts.js'));
const Chunk = require(path.join(ROOT, 'memorizer', 'src', 'chunk.js'));

const PRELOAD = {
  index: 0, title: 'Preload', pageStart: 4, pageEnd: 5,
  segments: [
    { page: 4, heading: true, text: 'Preload' },
    { page: 4, heading: false, text:
      'Preload is the stretch on ventricular myocytes at the end of diastole. ' +
      'Greater preload stretches the sarcomere toward its optimal length and increases the force of contraction. ' +
      'This relationship between stretch and stroke volume is the Frank-Starling mechanism. ' +
      'Venous return is the main determinant of preload in a healthy heart. ' +
      'A normal left ventricular end-diastolic pressure is below 12 mmHg.' },
    { page: 5, heading: false, text:
      'Diuretics reduce preload by lowering circulating volume. ' +
      'Venodilators such as nitrates reduce preload by pooling blood in the veins. ' +
      'When preload falls too far, stroke volume and cardiac output fall with it. ' +
      'Excessive preload raises pulmonary venous pressure and causes pulmonary congestion. ' +
      'The stretch curve flattens at high filling pressures, so further volume adds little force.' },
  ],
};
const AFTERLOAD = {
  index: 1, title: 'Afterload', pageStart: 6, pageEnd: 6,
  segments: [
    { page: 6, heading: false, text:
      'Afterload is the wall stress the ventricle must overcome to eject blood. ' +
      'Aortic stenosis increases afterload because the ventricle pushes against a narrowed valve. ' +
      'Systemic hypertension raises afterload and leads to concentric hypertrophy over time. ' +
      'Vasodilators lower afterload and can increase stroke volume in a failing ventricle. ' +
      'By the Laplace relation, wall stress rises with cavity radius and falls with wall thickness.' },
  ],
};
const CONTRACT = {
  index: 2, title: 'Contractility', pageStart: 7, pageEnd: 7,
  segments: [
    { page: 7, heading: false, text:
      'Contractility is the intrinsic strength of contraction at a fixed preload and afterload. ' +
      'Sympathetic stimulation raises contractility through beta-1 receptors. ' +
      'Digoxin increases intracellular calcium and modestly improves contractility. ' +
      'Ischaemia depresses contractility within seconds of reduced coronary flow. ' +
      'The end-systolic pressure-volume relation steepens when contractility increases.' },
  ],
};
const text = c => c.segments.filter(s => !s.heading).map(s => s.text).join(' ');

head('encode: the section’s own sentences, nothing else');
{
  const e = K.encode(PRELOAD);
  ok('matches the schema the model is held to', P.check(P.SCHEMAS.encode, e) === '', P.check(P.SCHEMAS.encode, e));
  /* 3..7 since the owner asked for smaller, more digestible sections (was
     5..9). A product change, made in coach.js and here together. */
  ok('picks between 3 and 7 key points', e.points.length >= 3 && e.points.length <= 7, String(e.points.length));
  const pageOf = {};
  PRELOAD.segments.forEach(s => K.sentences({ segments: [s] }).forEach(x => { pageOf[x.text] = s.page; }));
  ok('every point is a sentence of the section, verbatim', e.points.every(p => text(PRELOAD).indexOf(p.text) !== -1),
     e.points.filter(p => text(PRELOAD).indexOf(p.text) === -1).map(p => p.text).join(' | ') || 'all verbatim');
  ok('and carries the page it is on', e.points.every(p => pageOf[p.text] === p.page));
  ok('in the order the section gives them', e.points.every((p, i) => i === 0 || text(PRELOAD).indexOf(p.text) > text(PRELOAD).indexOf(e.points[i - 1].text)));
  /* A heading long enough to pass for a sentence: a one-word heading is
     never picked anyway, and the first version of this check could not
     fail. */
  /* A long heading over a single sentence: were headings eligible, this one
     would be picked — so the check can fail. Beside ten scored sentences it
     never was, and the first two versions of this check could not. */
  const titled = { index: 0, title: 'x', pageStart: 1, pageEnd: 1, segments: [
    { page: 1, heading: true, text: 'How the ventricle responds to more filling volume' },
    { page: 1, heading: false, text: 'Filling stretches the muscle and raises the force of the next beat.' }] };
  const tp = K.encode(titled).points;
  ok('a heading, however long, is not taught as a point', tp.length === 1 && /^Filling stretches/.test(tp[0].text), tp.map(p => p.text).join(' | '));
  ok('the sentence with a number in it is a key point', e.points.some(p => /12 mmHg/.test(p.text)));
  /* A long section, so the cap is what limits it — at ten sentences the
     count is five whatever the cap says, and a cap of 90 passed. */
  const long = { index: 0, title: 'x', pageStart: 1, pageEnd: 1, segments: [{ page: 1, heading: false,
    text: Array.from({ length: 60 }, (_, i) => 'Factor ' + i + ' raises cardiac output through pathway ' + 'abcdefghij'[i % 10] + ' today.').join(' ') }] };
  ok('a long section is capped at 7 points', K.encode(long).points.length === 7, String(K.encode(long).points.length));
  /* In order even when the picks are made out of order — a long section of
     numbered sentences is picked by score, not by position. */
  const lp = K.encode(long).points.map(p => text(long).indexOf(p.text));
  ok('a long section\u2019s points are still in page order', lp.every((v, i) => i === 0 || v > lp[i - 1]), lp.join(','));
  /* The long section's picks came out in order anyway. This one cannot:
     the number is taken first (last sentence), the definition is put in
     front of it, and the best-scoring rest (second sentence) comes after. */
  const mixed = { index: 0, title: 'Preload', pageStart: 1, pageEnd: 1, segments: [{ page: 1, heading: false, text:
    'Preload is the stretch on ventricular myocytes at the end of diastole. Venous return raises preload and preload raises stroke volume through venous return. ' +
    'The weather outside the hospital was mild that week. A wedge pressure above 18 mmHg marks raised preload.' }] };
  const mp = K.encode(mixed).points.map(p => text(mixed).indexOf(p.text));
  ok('points picked out of order are shown in page order', mp.length === 3 && mp.every((v, i) => i === 0 || v > mp[i - 1]), mp.join(','));
  ok('and so is the section\u2019s definition', e.points.some(p => /^Preload is the stretch/.test(p.text)), e.points.map(p => p.text.slice(0, 30)).join(' | '));
  ok('the memory hook is built from the points’ own words',
     /^First letters: [A-Z]+ /.test(e.mnemonic) && e.mnemonic.split(' — ')[1].split('.')[0].split(' · ').every(w => text(PRELOAD).toLowerCase().indexOf(w) !== -1),
     e.mnemonic.slice(0, 90));
  ok('it draws no flowchart it cannot understand', e.flowchart === '');
  ok('the same section always gives the same points', JSON.stringify(K.encode(PRELOAD)) === JSON.stringify(e));
  const tiny = { index: 0, title: 'x', pageStart: 1, pageEnd: 1, segments: [{ page: 1, heading: false, text: 'Only one short sentence here.' }] };
  const t = K.encode(tiny);
  ok('a one-sentence section still gives a point, not an empty encode the session would refuse', t.points.length === 1, JSON.stringify(t.points));
}

head('recall: a blank in each key sentence');
{
  const e = K.encode(PRELOAD);
  const r = K.recall(PRELOAD, e.points);
  ok('matches the schema', P.check(P.SCHEMAS.recall, r) === '');
  ok('asks 3 to 5 questions', r.prompts.length >= 3 && r.prompts.length <= 5, String(r.prompts.length));
  /* A blank, or a question actually asked ("What is …?", "Name the …"). */
  ok('each question has a blank or asks something', r.prompts.every(q => /_____/.test(q.question) || /\?$|^Name the /.test(q.question)));
  const blanks = r.prompts.filter(q => /_____/.test(q.question));
  /* Read off the question itself. The first version compared it with
     cloze() run again — the function under test checking itself — and
     passed with the answer left in. */
  const word = w => new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])', 'i');
  ok('and its answer is gone from the question', r.prompts.every(q => !word(q.answer).test(q.question)),
     r.prompts.filter(q => word(q.answer).test(q.question)).map(q => q.answer).join(', ') || 'none left in');
  ok('no two questions blank the same word', new Set(blanks.map(q => q.answer)).size === blanks.length);
  const same = { index: 0, title: 'x', pageStart: 1, pageEnd: 1, segments: [{ page: 1, heading: false,
    text: 'Sarcomere tension is up now. Sarcomere tension is low now. Sarcomere tension is odd now.' }] };
  const sr = K.recall(same, K.sentences(same).map(x => ({ text: x.text, page: 1 })));
  ok('even when every sentence\u2019s best word is the same one', new Set(sr.prompts.map(q => q.answer)).size === sr.prompts.length,
     sr.prompts.map(q => q.answer).join(', '));
  ok('every answer is the section’s own words', r.prompts.every(q => text(PRELOAD).toLowerCase().indexOf(q.answer.toLowerCase()) !== -1));
  ok('a run of filler words offers nothing to blank', K.rankedTerms('there which would these those about', {}, {}).length === 0,
     K.rankedTerms('there which would these those about', {}, {}).map(t => t.word).join(', '));
  ok('no answer is a filler word', blanks.every(q => !/^(the|and|with|that|this|from|which|there)$/.test(q.answer)), blanks.map(q => q.answer).join(', '));
  const numQ = blanks.find(q => /mmHg/.test(q.question));
  ok('a sentence with a number blanks the number', numQ && numQ.answer === '12', numQ && numQ.question);
}

head('grading by matching words');
{
  const q = { question: 'Fill in the blank: _____ is the main determinant', answer: 'venous', page: 4 };
  const g = a => K.gradeRecall(PRELOAD, q, a);
  ok('matches the schema', P.check(P.SCHEMAS.gradeRecall, g('venous')) === '');
  ok('the word itself is correct', g('venous').correct === true);
  ok('in a sentence, in capitals, with punctuation — still correct', g('It is VENOUS return.').correct === true);
  ok('one typo in a long word is correct', K.gradeRecall(PRELOAD, { answer: 'contraction' }, 'contracton').correct === true);
  ok('a plural away is correct', K.gradeRecall(PRELOAD, { answer: 'myocytes' }, 'myocyte').correct === true);
  /* Three edits apart, so only the stem rule can accept it — the plural
     above is one edit, and passes on the typo rule alone. */
  ok('another form of the same word is correct (filled for filling)', K.gradeRecall(PRELOAD, { answer: 'filling' }, 'filled').correct === true);
  ok('a different word is wrong', g('arterial').correct === false);
  ok('an empty answer is wrong, and says so', g('').correct === false && /No answer/.test(g('').feedback));
  const n = a => K.gradeRecall(PRELOAD, { answer: '12' }, a).correct;
  ok('the right number is correct', n('12 mmHg') === true);
  ok('a different number is wrong — 120 is not 12, nor is 1', n('120') === false && n('1') === false && n('2') === false);
  ok('a short word must be exact: no typo allowance under five letters', K.gradeRecall(PRELOAD, { answer: 'vein' }, 'vain').correct === false);
  ok('a wrong answer names the answer, and offers counting other words for it', /“venous”/.test(g('arterial').feedback) && /count it as correct/.test(g('arterial').feedback));
}

head('teach-back: how many key points you touched');
{
  const e = K.encode(PRELOAD);
  const all = e.points.map(p => p.text).join(' ');
  const full = K.gradeExplain(PRELOAD, e.points, all);
  ok('matches the schema', P.check(P.SCHEMAS.gradeExplain, full) === '');
  ok('saying every point scores 100, with no gaps', full.score === 100 && full.gaps.length === 0, `${full.score}, ${full.gaps.length} gaps`);
  const none = K.gradeExplain(PRELOAD, e.points, '');
  ok('saying nothing scores 0, and every point is a gap', none.score === 0 && none.gaps.length === e.points.length);
  const half = K.gradeExplain(PRELOAD, e.points, e.points.slice(0, Math.ceil(e.points.length / 2)).map(p => p.text).join(' '));
  ok('saying the first half scores about half', half.score >= 40 && half.score <= 70, String(half.score));
  ok('and the gaps are exactly the points left out',
     JSON.stringify(half.gaps.map(g => g.point)) === JSON.stringify(e.points.slice(Math.ceil(e.points.length / 2)).map(p => p.text)));
  ok('each gap keeps its page', half.gaps.every(g => e.points.some(p => p.text === g.point && p.page === g.page)));
  /* One key word per point is a word list, not an explanation. */
  const freq = K.frequencies(PRELOAD);
  const oneEach = e.points.map(p => K.rankedTerms(p.text, freq, {})[0].word).join(' ');
  const listed = K.gradeExplain(PRELOAD, e.points, oneEach);
  ok('naming one key word per point is not covering it', listed.score < 50, `${listed.score} for "${oneEach}"`);
  const offTopic = K.gradeExplain(PRELOAD, e.points, 'The kidney filters blood and makes urine every day.');
  ok('an explanation of something else scores 0', offTopic.score === 0, String(offTopic.score));
}

head('gauntlet: new blanks, weighted to the weakest');
{
  /* Three sections: with two, taking turns already gives the weak one half,
     and the weighting was deleted with nothing noticing. */
  const clusters = [PRELOAD, AFTERLOAD, CONTRACT];
  const pts = { 0: K.encode(PRELOAD).points, 1: K.encode(AFTERLOAD).points, 2: K.encode(CONTRACT).points };
  const recallQs = [0, 1, 2].map(i => K.recall(clusters[i], pts[i]).prompts.map(q => q.question.replace(/^Fill in the blank: /, ''))).flat();
  const g = K.gauntlet(clusters, pts, [1], 6);
  ok('matches the schema', P.check(P.SCHEMAS.gauntlet, g) === '');
  ok('asks the number it was given', g.questions.length === 6, String(g.questions.length));
  ok('at least half on the weakest section', g.questions.filter(q => q.cluster === 1).length >= 3,
     g.questions.map(q => q.cluster).join(','));
  ok('every cluster number is a real section', g.questions.every(q => q.cluster >= 0 && q.cluster <= 2));
  ok('no gauntlet blank repeats a recall blank', !g.questions.some(q => recallQs.indexOf(q.question.replace(/^Gauntlet — fill in the blank: /, '')) !== -1));
  ok('no question is asked twice', new Set(g.questions.map(q => q.question)).size === g.questions.length);
  /* Every sentence is a point here, so the gauntlet has nothing fresh and
     must re-blank the points — the case where repeating recall is possible.
     (Above, fresh sentences filled all six and the second-word path never
     ran.) */
  const all3 = { index: 0, title: 'Afterload', pageStart: 1, pageEnd: 1, segments: [{ page: 1, heading: false, text:
    'Afterload is the wall stress the ventricle overcomes during ejection. Aortic stenosis raises afterload and thickens the ventricular wall. ' +
    'Vasodilators lower afterload and improve forward flow.' }] };
  const p3 = K.encode(all3).points;
  const r3 = K.recall(all3, p3).prompts.map(q => q.question.replace(/^Fill in the (?:blank|number): /, ''));
  const g3 = K.gauntlet([all3], { 0: p3 }, [0], 5).questions.map(q => q.question.replace(/^Gauntlet — fill in the blank: /, ''));
  ok('a section with no unused sentences still gets a gauntlet that repeats no recall blank',
     p3.length === 3 && g3.length >= 2 && !g3.some(q => r3.indexOf(q) !== -1), g3.join(' | '));
  /* A blank's answer is a bare lower-case word; a reversed definition's is
     the term as printed ("Afterload"), and a list's is its items joined by
     "; " — each still words of the section, compared without case. */
  ok('every answer is words of its own section', g.questions.every(q => q.answer.split('; ').every(a => text(clusters[q.cluster]).toLowerCase().indexOf(a.toLowerCase()) !== -1)),
     g.questions.filter(q => !q.answer.split('; ').every(a => text(clusters[q.cluster]).toLowerCase().indexOf(a.toLowerCase()) !== -1)).map(q => q.answer).join(' | '));
  ok('the harder questions are in it: a definition asked backwards', g.questions.some(q => q.question === 'Which term is defined as \u201Cthe wall stress the ventricle must overcome to eject blood\u201D?' && q.answer === 'Afterload'),
     g.questions.map(q => q.question.slice(0, 50)).join(' | '));
  /* One sentence, one word worth blanking: nothing fresh to ask and no
     second word — the case the fallback exists for. */
  const bare1 = { index: 0, title: 't', pageStart: 1, pageEnd: 1, segments: [{ page: 1, heading: false, text: 'It is in the cell now.' }] };
  const lone = K.gauntlet([bare1], { 0: K.encode(bare1).points }, [0], 5);
  ok('a unit with almost nothing to ask still gets a gauntlet, so the session can finish', lone.questions.length >= 1, String(lone.questions.length));
}

head('flowcharts from the section\u2019s own cause-and-effect');
{
  const CAUSAL = { index: 0, title: 'Congestion', pageStart: 9, pageEnd: 9, segments: [{ page: 9, heading: false, text:
    'Diuretics reduce preload by lowering circulating volume. ' +
    'Excessive preload raises pulmonary venous pressure and causes pulmonary congestion. ' +
    'Rising venous pressure leads to oedema of the lungs. ' +
    'Oedema impairs gas exchange, resulting in hypoxaemia. ' +
    'The patient is usually breathless at night.' }] };
  const f = K.flow(CAUSAL);
  const lab = id => (f.nodes.find(n => n.id === id) || {}).label;
  const has = (a, verb, b) => f.edges.some(e => new RegExp(a, 'i').test(lab(e.from)) && e.verb === verb && new RegExp(b, 'i').test(lab(e.to)));
  ok('"A reduce B" becomes an arrow', has('^Diuretics$', 'reduce', '^preload$'), JSON.stringify(f.edges.map(e => lab(e.from) + ' -' + e.verb + '-> ' + lab(e.to))));
  ok('"A raises B and causes C" gives A two arrows, not B→C', has('^Excessive preload$|^preload$', 'raises', 'venous pressure') &&
     has('preload', 'causes', 'congestion') && !has('venous pressure', 'causes', 'congestion'));
  ok('"…, resulting in D" hangs D off what came just before', has('gas exchange', 'resulting in', 'hypoxaemia'));
  ok('the same thing named twice is one box, which is what makes a chain',
     f.nodes.filter(n => /venous pressure/i.test(n.label)).length === 1 && has('venous pressure', 'leads to', 'oedema'));
  const src = text(CAUSAL).toLowerCase();
  ok('every word in every box is a word of the section', f.nodes.every(n => n.label.toLowerCase().split(/\s+/).every(w => src.indexOf(w) !== -1)),
     f.nodes.map(n => n.label).join(' | '));
  ok('a sentence with no cause-and-effect verb adds nothing', !f.nodes.some(n => /breathless|night|patient/i.test(n.label)));
  const ps = K.paths(f);
  ok('the paths start where nothing points in, and follow the arrows', ps.length >= 1 &&
     ps.some(p => /Diuretics/.test(lab(p[0].start)) && p.length >= 3), JSON.stringify(ps));
  const two = K.flow({ segments: [{ page: 1, heading: false, text: 'Diuretics reduce preload. Preload raises wall stress. Hypertension raises afterload. Afterload increases wall stress.' }] });
  const tp = K.paths(two);
  const tl = id => two.nodes.find(n => n.id === id).label;
  ok('every box nothing points into starts a path', ['Diuretics', 'Hypertension'].every(r => tp.some(p => tl(p[0].start) === r)),
     tp.map(p => tl(p[0].start)).join(', '));
  ok('and every arrow is on some path', two.edges.every(e => tp.some(p => p.some((st, i) => i > 0 && st.to === e.to && (p[i - 1].start === e.from || p[i - 1].to === e.from)))));
  /* Drawn as a tree, the shared start of two branches is one box. */
  const tr = K.tree(f);
  const count = {};
  (function walk(t) { count[t.id] = (count[t.id] || 0) + (t.again ? 0 : 1); t.next.forEach(b => walk(b.node)); })(tr[0]);
  ok('as a tree, every box is drawn once — the shared start is not repeated per branch', Object.values(count).every(n => n === 1) &&
     tr[0].next.length === 1 && tr[0].next[0].node.next.length === 2, JSON.stringify(count));
  const loop = K.tree({ nodes: [{ id: 0, label: 'a' }, { id: 1, label: 'b' }], edges: [{ from: 0, to: 1, verb: 'raises' }, { from: 1, to: 0, verb: 'lowers' }] });
  ok('a cycle ends at a reference back, not in an endless tree', loop.length === 1 && loop[0].next[0].node.next[0].node.again === true);
  /* Sentences that share words but state no cause: were any verb taken as a
     cause, they would chain, and the connection rule would keep them. */
  ok('sentences with no cause-and-effect verb make no flow, even when they share words',
     K.flow({ segments: [{ page: 1, heading: false, text: 'Preload is the stretch. The stretch is greatest in diastole. Diastole is ventricular filling.' }] }).edges.length === 0);
  ok('a section with no such sentences has no flow', K.flow({ segments: [{ page: 1, text: 'The heart has four chambers. It sits in the chest.' }] }).edges.length === 0);
}

head('flowcharts: clean boxes, connected pieces only');
{
  /* The owner's first real flowchart, sentence for sentence. */
  const USER = { segments: [{ page: 1, heading: false, text:
    'Both tricuspid stenosis (TS) and tricuspid regurgitation (TR) can produce typical symptoms of right-sided congestive heart failure in their advanced stages. ' +
    'Malignancy (eg, myxoma and metastases)\u2014Usually cause functional TS.' }] };
  ok('the owner\u2019s fragment boxes are gone', K.flow(USER).edges.length === 0, JSON.stringify(K.flow(USER).edges));
  /* Clean boxes, but two pairs with nothing between them — the connection
     rule on its own (above, the label cleaning already empties the owner's). */
  const pairs = K.flow({ segments: [{ page: 1, heading: false, text: 'Diuretics reduce preload. Hypertension raises afterload.' }] });
  ok('two unconnected pairs are not a flowchart', pairs.edges.length === 0, JSON.stringify(pairs.edges));
  const f = K.flow({ segments: [{ page: 1, heading: false, text: 'Rheumatic fever (RF) usually causes valve scarring. Valve scarring can lead to commissural fusion \u2014 the hallmark.' }] });
  const labels = f.nodes.map(n => n.label);
  ok('a chain of three is kept', f.edges.length === 2, labels.join(' | '));
  ok('boxes lose their brackets, dashes, modal verbs and adverbs',
     labels.every(l => !/[()\u2014]|\b(?:can|usually)$/i.test(l)) && labels.indexOf('Rheumatic fever') !== -1 && labels.indexOf('commissural fusion') !== -1, labels.join(' | '));
}

head('the coach asks, lists and checks numbers');
{
  /* A section shaped like the owner's Table 17.1 page, as chunk.js marks it. */
  const TS = { index: 0, title: 'Tricuspid stenosis', pageStart: 2, pageEnd: 2, segments: [
    { page: 2, heading: false, text: 'A. Etiology. Table 17.1 lists the causes of TS.' },
    { page: 2, heading: false, text: 'Congenital', item: true, sub: true, list: 'L1' },
    { page: 2, heading: false, text: 'Tricuspid atresia', item: true, list: 'L1' },
    { page: 2, heading: false, text: 'Atypical Ebstein anomaly (more likely to cause TR)', item: true, list: 'L1' },
    { page: 2, heading: false, text: 'Acquired', item: true, sub: true, list: 'L1' },
    { page: 2, heading: false, text: 'Rheumatic', item: true, list: 'L1' },
    { page: 2, heading: false, text: 'Infective endocarditis', item: true, list: 'L1' },
    { page: 2, heading: false, text: 'Carcinoid syndrome', item: true, list: 'L1' },
    { page: 2, heading: false, text: 'Malignancy (eg, myxoma and metastases)\u2014Usually cause functional TS', item: true, list: 'L1' },
    { page: 2, heading: false, text: 'Whipple disease', item: true, list: 'L1' },
    { page: 2, heading: false, text: 'Rheumatic heart disease (RHD) is the most common cause of TS, accounting for >90% of cases. ' +
      'Recent transesophageal echocardiogram (TEE) studies have revealed that only 54% of patients have three valve leaflets. ' +
      'Tricuspid stenosis (TS) is a narrowing of the tricuspid valve orifice that obstructs right atrial emptying.' },
  ] };
  const ls = K.lists(TS);
  ok('a list is split at its sub-headings and titled from its introduction',
     JSON.stringify(ls.map(l => l.title)) === JSON.stringify(['Congenital causes of TS', 'Acquired causes of TS']), JSON.stringify(ls.map(l => l.title)));
  ok('items are labelled without their asides', ls[1].items.map(i => i.label).join('|') === 'Rheumatic|Infective endocarditis|Carcinoid syndrome|Malignancy|Whipple disease',
     ls[1].items.map(i => i.label).join('|'));
  const e = K.encode(TS);
  ok('the hook is the list\u2019s first letters, titled', /^First letters of Acquired causes of TS: RICMW \u2014 Rheumatic \u00B7 Infective endocarditis/.test(e.mnemonic), e.mnemonic);
  const pq = K.patternQuestions(TS);
  const most = pq.find(q => q.kind === 'most');
  ok('"X is the most common cause of Y" asks for X', most && most.question === 'What is the most common cause of TS?' && most.answer === 'Rheumatic heart disease (RHD)',
     JSON.stringify(most));
  const def = pq.find(q => q.kind === 'define');
  ok('a definition asks for its meaning', def && def.question === 'What is tricuspid stenosis (TS)?' && /^a narrowing of the tricuspid valve orifice/.test(def.answer), JSON.stringify(def));
  const r = K.recall(TS, e.points);
  ok('recall asks those, and names the list', r.prompts.some(q => /most common cause of TS/.test(q.question)) &&
     r.prompts.some(q => /^Name the Acquired causes of TS \(5\)\.$/.test(q.question)), r.prompts.map(q => q.question).join(' | '));
  ok('and still matches the schema', P.check(P.SCHEMAS.recall, r) === '');
  const listQ = r.prompts.find(q => /^Name the /.test(q.question));
  const gl = a => K.gradeRecall(TS, listQ, a);
  ok('naming three of five is enough, and says which are missing', gl('rheumatic, carcinoid, whipple').correct === true &&
     /3 of 5/.test(gl('rheumatic, carcinoid, whipple').feedback) && gl('rheumatic, carcinoid, whipple').missing.length === 2, gl('rheumatic, carcinoid, whipple').feedback);
  ok('two of five is not', gl('rheumatic and whipple').correct === false && /2 of 5/.test(gl('rheumatic and whipple').feedback));
  const mq = { question: most.question, answer: most.answer, page: 2 };
  ok('a phrase answer: the abbreviation alone is right', K.gradeRecall(TS, mq, 'RHD').correct === true);
  ok('so are most of its words', K.gradeRecall(TS, mq, 'rheumatic heart disease').correct === true);
  ok('one word of three is not', K.gradeRecall(TS, mq, 'heart').correct === false);
  ok('a definition in the student\u2019s own order still counts', K.gradeRecall(TS, { answer: def.answer }, 'narrowing of the tricuspid orifice, obstructing atrial emptying').correct === true);
  const slips = K.numberSlips(TS, 'Rheumatic heart disease causes about 50% of cases of TS. Only 54% of patients have three leaflets.');
  ok('a wrong number in a teach-back is said back, with the source and its page', slips.length === 1 && /50/.test(slips[0]) && />90%/.test(slips[0]) && /p\.2/.test(slips[0]), JSON.stringify(slips));
  ok('the right number is not', !slips.some(x => /54%/.test(x.split('says')[0])));
  const x = K.gradeExplain(TS, e.points, 'Rheumatic heart disease causes about 50% of cases of TS.');
  ok('and teach-back grading reports it as a misconception', x.misconceptions.length === 1 && P.check(P.SCHEMAS.gradeExplain, x) === '');
  const hk = K.rankedTerms('Recent studies have revealed that only lists accounting for the tricuspid anomaly', {}, {}, K.defined(TS)).map(t => t.word);
  ok('generic words rank below the terms', hk.indexOf('tricuspid') < hk.indexOf('lists') && hk.indexOf('anomaly') < hk.indexOf('revealed') && hk.indexOf('anomaly') < hk.indexOf('accounting'), hk.join(', '));
  /* Each rule alone: with nothing else between them, a generic word loses to
     a shorter ordinary one, and a technical ending beats a longer ordinary word. */
  ok('a word the section repeats ranks below one it uses once (distinctive, not frequent)',
     K.rankedTerms('chordae papillary', { chordae: 5, papillary: 1 }, {})[0].word === 'papillary');
  ok('a generic word loses even to a shorter ordinary one', K.rankedTerms('accounting for chordae', {}, {})[0].word === 'chordae',
     K.rankedTerms('accounting for chordae', {}, {}).map(t => t.word).join(', '));
  ok('a technical term beats a longer ordinary word', K.rankedTerms('measurement of stenosis', {}, {})[0].word === 'stenosis',
     K.rankedTerms('measurement of stenosis', {}, {}).map(t => t.word).join(', '));
  ok('a word joined by a dash is two words', K.toks('leaflets\u2014septal, anterior').length === 3);
  const dt = K.defined(TS);
  ok('a section\u2019s defined abbreviations, and their expansions, are terms', dt.rhd === true && dt.tee === true && Object.keys(dt).some(k => /^rheumat/.test(k)),
     Object.keys(dt).join(', '));
  ok('the generic head of an item does not name it', K.itemMatch('some disease', 'Whipple disease') === false && K.itemMatch('whipple', 'Whipple disease') === true);

  /* The gauntlet's harder questions, on the same section. */
  const hq = K.hardQuestions(TS, e.points);
  const back = hq.find(q => /^Which term is defined as/.test(q.question));
  ok('the gauntlet asks the definition backwards: the meaning given, the term wanted',
     back && back.question === 'Which term is defined as \u201Ca narrowing of the tricuspid valve orifice that obstructs right atrial emptying\u201D?' &&
     back.answer === 'Tricuspid stenosis (TS)', JSON.stringify(back));
  const gb = a => K.gradeRecall(TS, back, a).correct;
  ok('and grades the term: its abbreviation or its words are right, a neighbouring lesion is not', gb('TS') && gb('tricuspid stenosis') && !gb('tricuspid regurgitation'));
  ok('it names the list recall did not ask', hq.some(q => q.question === 'Name the Congenital causes of TS (2).' && q.answer === 'Tricuspid atresia; Atypical Ebstein anomaly'),
     hq.map(q => q.question).join(' | '));
  const askedR = r.prompts.map(q => q.question);
  ok('and repeats nothing recall asked', !hq.some(q => askedR.indexOf(q.question) !== -1), hq.filter(q => askedR.indexOf(q.question) !== -1).map(q => q.question).join(' | '));
  const giveaway = { index: 0, title: 'Valves', pageStart: 1, pageEnd: 1, segments: [{ page: 1, heading: false, text:
    'Aortic stenosis is a stenosis of the aortic valve that obstructs left ventricular outflow. It is common in the elderly and rare in the young.' }] };
  ok('a definition that already says its whole term is not asked backwards',
     !K.hardQuestions(giveaway, K.encode(giveaway).points).some(q => /^Which term/.test(q.question)), JSON.stringify(K.hardQuestions(giveaway, K.encode(giveaway).points)));
  const gts = K.gauntlet([TS], { 0: e.points }, [0], 5).questions;
  ok('in the gauntlet the harder questions lead, with blanks between them', !/_____/.test(gts[0].question) && /_____/.test(gts[1].question),
     gts.map(q => q.question.slice(0, 40)).join(' | '));
  ok('and it still matches the schema', P.check(P.SCHEMAS.gauntlet, { questions: gts }) === '');

  /* A list item is not a sentence: it is taught by the hook and "Name the …",
     never blanked, never a key point. The first gauntlet on this section
     blanked "_____ (eg, myxoma and metastases)" and "Atypical _____ anomaly". */
  const itemTexts = TS.segments.filter(g => g.item).map(g => g.text);
  const filled = q => q.question.replace(/^[^:]*blank:\s*/, '').replace('_____', q.answer);
  const gAll = K.gauntlet([TS], { 0: e.points }, [0], 10).questions;
  const blanked = gAll.filter(q => /_____/.test(q.question));
  ok('the gauntlet never blanks a list item', blanked.length >= 1 && !blanked.some(q => itemTexts.some(t => t.toLowerCase() === filled(q).toLowerCase())),
     blanked.map(q => q.question.slice(0, 50)).join(' | '));
  ok('and no key point is one', !e.points.some(p => itemTexts.indexOf(p.text) !== -1), e.points.map(p => p.text.slice(0, 30)).join(' | '));
  ok('but its words still count toward what the section is about', (K.frequencies(TS).whipple || 0) >= 1, JSON.stringify(K.frequencies(TS).whipple));
  const DOSE = { index: 0, title: 'Digoxin', pageStart: 3, pageEnd: 3, segments: [
    { page: 3, heading: false, text: 'Digoxin is given as follows.' },
    { page: 3, heading: false, text: 'Loading dose 0.5 mg digoxin orally', item: true, list: 'L9' },
    { page: 3, heading: false, text: 'Maintenance dose 0.125 mg digoxin daily', item: true, list: 'L9' },
    { page: 3, heading: false, text: 'Lower maintenance doses in renal failure', item: true, list: 'L9' },
  ] };
  const ds = K.numberSlips(DOSE, 'The maintenance dose of digoxin is 0.25 mg daily.');
  ok('and a wrong number set against a list item is still caught', ds.length === 1 && /0\.125 mg/.test(ds[0]), JSON.stringify(ds));
}

head('questions from tables');
{
  const T = { index: 0, title: 'Values', pageStart: 3, pageEnd: 3, segments: [
    { page: 3, heading: false, text: 'Normal values are listed below.' },
    /* text is the rows' words, as the chunker gives it — the first version
       had a placeholder here, and the check that tables are not read as
       sentences could not fail against it. */
    { page: 3, heading: false, text: 'Measure Normal Unit LVEDP < 12 mmHg. Stroke volume 60-100 mL Ejection fraction 55 percent.',
      table: [['Measure', 'Normal', 'Unit'], ['LVEDP', '< 12', 'mmHg'], ['Stroke volume', '60-100', 'mL'], ['Ejection fraction', '55', 'percent']] }] };
  const qs = K.tableQuestions(T, 2);
  ok('a table gives questions, numbers first', qs.length === 2 && qs.every(q => /^\d/.test(q.answer)), JSON.stringify(qs));
  ok('each names its row and its column, and blanks the cell', qs.every(q => /From the table: .+ \u2014 .+: .*_____/.test(q.question)), qs.map(q => q.question).join(' | '));
  ok('and its answer is gone from the question', qs.every(q => q.question.indexOf(q.answer) === -1));
  const many = K.tableQuestions(T, 20);
  ok('the header row is never asked about, however many are asked for', many.length >= 3 && !many.some(q => /^(measure|normal|unit)$/.test(q.answer)),
     many.map(q => q.answer).join(', '));
  const r = K.recall(T, [{ text: 'Normal values are listed below.', page: 3 }]);
  ok('recall includes the table\u2019s questions', r.prompts.some(q => /From the table/.test(q.question)) && P.check(P.SCHEMAS.recall, r) === '');
  ok('a table is not mistaken for sentences', !K.sentences(T).some(s => /LVEDP/.test(s.text)));
  ok('a table split across clusters asks with its repeated header',
     K.tableQuestions({ segments: [{ page: 4, table: [['Ejection fraction', '55', 'percent']], tableHeader: ['Measure', 'Normal', 'Unit'] }] }, 2)
      .some(q => /Ejection fraction \u2014 Normal/.test(q.question)));
}

head('bullets: shorter, the key term first, nothing added');
{
  const F = require(path.join(ROOT, 'memorizer', 'src', 'format.js'));
  const b = F.bullet('Preload is the stretch on ventricular myocytes at the end of diastole.');
  ok('a definition leads with its term', b.lead === 'Preload' && b.body === 'the stretch on ventricular myocytes at the end of diastole', JSON.stringify(b));
  ok('filler and preamble go', F.bullet('However, it is important to note that diuretics reduce preload.').body === 'Diuretics reduce preload');
  ok('citations and figure references go', F.bullet('Diuretics reduce preload [12, 14] (see Figure 3).').body === 'Diuretics reduce preload');
  const semi = F.bullet('Afterload rises with hypertension; it falls with vasodilators; stenosis raises it.');
  ok('a long point splits at its semicolons into sub-bullets', semi.body === 'Afterload rises with hypertension' && semi.subs.length === 2, JSON.stringify(semi));
  ok('"This …" is not taken as a term to lead with', F.bullet('This relationship is the Frank-Starling mechanism.').lead === '');
  /* The rule the formatter lives by, over every sentence this suite has. */
  const all = [PRELOAD, AFTERLOAD, CONTRACT].map(c => K.sentences(c).map(x => x.text)).flat().concat([
    'However, it is important to note that diuretics reduce preload [12] (see Figure 3).', 'Afterload rises with hypertension; it falls with vasodilators.']);
  const norm = w => w.toLowerCase().replace(/[^a-z0-9\-]/g, '');
  const added = all.map(t => {
    const src = t.split(/\s+/).map(norm);
    const out = F.bullet(t);
    const got = [out.lead, out.body].concat(out.subs).join(' ').split(/\s+/).map(norm).filter(Boolean);
    return got.filter(w => src.indexOf(w) === -1);
  }).flat();
  ok('no word comes out that did not go in', added.length === 0, added.join(', ') || `${all.length} sentences`);
}

head('same shape over many generated sections');
{
  /* Random sections from the chunker's own pipeline: every coach output for
     each must pass its schema, and every point must be verbatim. */
  let a = 7;
  const rnd = () => { a = (a * 1103515245 + 12345) % 2147483648; return a / 2147483648; };
  const VOCAB = ('pressure volume flow resistance cardiac output stroke heart rate ventricle atrium valve oxygen demand supply ' +
    'contraction relaxation filling ejection murmur pulse artery vein capillary tissue perfusion 10 25 60 120 1.5').split(' ');
  const bad = [];
  for (let n = 0; n < 60; n++) {
    const blocks = [{ text: 'Topic ' + n, page: 1, heading: true }];
    for (let b = 0; b < 3 + Math.floor(rnd() * 6); b++) {
      const sents = [];
      for (let k = 0; k < 2 + Math.floor(rnd() * 6); k++) {
        const len = 3 + Math.floor(rnd() * 20);
        sents.push(Array.from({ length: len }, () => VOCAB[Math.floor(rnd() * VOCAB.length)]).join(' ') + '.');
      }
      blocks.push({ text: sents.join(' '), page: 1 + b, heading: false });
    }
    const cs = Chunk.clusterBlocks(blocks, { min: 60, max: 200 });
    cs.forEach(c => {
      const e = K.encode(c);
      const r = K.recall(c, e.points);
      const x = K.gradeExplain(c, e.points, 'pressure volume');
      const gr = K.gradeRecall(c, r.prompts[0] || { answer: 'x' }, 'pressure');
      const g = K.gauntlet(cs, { [c.index]: e.points }, [c.index], 5);
      const errs = [['encode', e], ['recall', r], ['gradeExplain', x], ['gradeRecall', gr], ['gauntlet', g]]
        .map(([k, v]) => { const m = P.check(P.SCHEMAS[k], v); return m && k + ': ' + m; }).filter(Boolean);
      if (!e.points.length) errs.push('encode: no points');
      if (!e.points.every(p => c.text.indexOf(p.text) !== -1)) errs.push('encode: a point is not verbatim');
      if (!g.questions.length) errs.push('gauntlet: empty');
      if (errs.length) bad.push(`doc ${n} cluster ${c.index}: ${errs[0]}`);
    });
  }
  ok('every output of every step passes its schema, points verbatim, never empty', bad.length === 0, bad[0] || '60 documents');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
