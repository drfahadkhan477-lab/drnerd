#!/usr/bin/env node
/*
 * The Coach as an agent: it reads a message, picks a tool, and remembers
 * the topic for the next one.
 *
 *   node tests/verify-memorizer-agent-pure.js
 *
 * Pure Node, on a small corpus written here from general cardiology — no
 * page of anyone's book. What is proven:
 *
 *   · EACH TOOL IS REACHED by the ways people ask for it, and a question
 *     that is only a question goes to the book (search).
 *   · THE TOPIC is what is left of the message, without the asking words;
 *     two topics for a comparison, however they are joined.
 *   · FOLLOW-UPS ("quiz me on that", "why?", "compare it with …") take the
 *     remembered topic.
 *   · THE MODEL'S PLAN is used only when it names a real tool; anything else
 *     is thrown away, so the rules decide.
 *   · A TOPIC FINDS ITS SECTION by title first, else by the book's answer.
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
const G = require(path.join(ROOT, 'memorizer', 'src', 'agent.js'));
const A = require(path.join(ROOT, 'memorizer', 'src', 'ask.js'));

head('each tool, reached the ways people ask for it');
{
  const CASES = [
    ['hi', 'help'], ['What can you do?', 'help'],
    ['Where am I weakest?', 'weak'], ['what do I get wrong', 'weak'],
    ['What should I study today?', 'plan'], ['where do I start', 'plan'],
    ['review my cards', 'review'], ['any due cards?', 'review'],
    ['quiz me on aortic stenosis', 'quiz'], ['give me MCQs on preload', 'quiz'], ['test me on heart failure', 'quiz'],
    ['compare aortic stenosis and aortic regurgitation', 'compare'], ['aortic stenosis vs mitral stenosis', 'compare'], ['difference between preload and afterload', 'compare'],
    ['mnemonic for causes of aortic stenosis', 'mnemonic'], ['how do I remember the causes of heart failure', 'mnemonic'],
    ['numbers to know in aortic stenosis', 'numbers'], ['what are the cut-offs for severe stenosis', 'numbers'],
    ['explain preload', 'explain'], ['tell me about heart failure', 'explain'],
    ['teach me heart failure', 'open'], ['open aortic stenosis', 'open'],
    ['How is aortic stenosis treated?', 'search'], ['Why do patients faint?', 'search'], ['What is the most common cause of aortic stenosis?', 'search'],
  ];
  const wrong = CASES.filter(([m, t]) => G.plan(m, {}).tool !== t).map(([m, t]) => m + ' → ' + G.plan(m, {}).tool + ' (not ' + t + ')');
  ok(`each of ${CASES.length} messages reaches its tool`, wrong.length === 0, wrong.join(' | '));
  ok('every tool the rules can pick is a tool', G.RULES.every(r => G.TOOLS.includes(r[0])) && G.TOOLS.includes('search'));
  ok('an empty message is a hello, not a search for nothing', G.plan('   ', {}).tool === 'help');
}

head('the topic: what is left without the asking words');
{
  ok('"quiz me on aortic stenosis" is about aortic stenosis', G.plan('quiz me on aortic stenosis', {}).topic === 'aortic stenosis');
  ok('"explain preload, please" is about preload', G.plan('explain preload, please', {}).topic === 'preload');
  ok('a search keeps the whole question', G.plan('How is aortic stenosis treated?', {}).topic === 'How is aortic stenosis treated?');
  const pairs = [['compare aortic stenosis and aortic regurgitation', 'aortic stenosis', 'aortic regurgitation'], ['aortic stenosis vs mitral stenosis', 'aortic stenosis', 'mitral stenosis'],
    ['difference between preload and afterload', 'preload', 'afterload'], ['compare preload, afterload', 'preload', 'afterload']];
  const bad = pairs.filter(([m, a, b]) => JSON.stringify(G.plan(m, {}).topics) !== JSON.stringify([a, b])).map(([m]) => m + ' → ' + JSON.stringify(G.plan(m, {}).topics));
  ok('a comparison has its two topics, however they are joined', bad.length === 0, bad.join(' | '));
}

head('follow-ups carry the remembered topic');
{
  const mem = { topic: 'aortic stenosis' };
  ok('"quiz me on that" is a quiz on the last topic', JSON.stringify(G.plan('quiz me on that', mem)) === JSON.stringify({ tool: 'quiz', topic: 'aortic stenosis' }), JSON.stringify(G.plan('quiz me on that', mem)));
  ok('"why?" explains the last topic; "more" searches it', G.plan('why?', mem).tool === 'explain' && G.plan('why?', mem).topic === 'aortic stenosis' &&
     G.plan('more', mem).tool === 'search' && G.plan('more', mem).topic === 'aortic stenosis');
  ok('"compare it with mitral stenosis" compares the last topic with the new one', JSON.stringify(G.plan('compare it with mitral stenosis', mem).topics) === '["aortic stenosis","mitral stenosis"]',
     JSON.stringify(G.plan('compare it with mitral stenosis', mem).topics));
  ok('with nothing remembered, "why?" is only a search for "why?"', G.plan('why?', {}).tool === 'search');
  ok('"mnemonics" alone gives the last topic’s', G.plan('mnemonics', mem).tool === 'mnemonic' && G.plan('mnemonics', mem).topic === 'aortic stenosis');
}

head('the model’s plan, used only when it names a real tool');
{
  ok('a real tool and topic is taken, marked as the model’s', JSON.stringify(G.parsePlan('{"tool":"quiz","topic":"preload"}')) === JSON.stringify({ tool: 'quiz', topic: 'preload', by: 'ai' }));
  ok('a tool that does not exist is thrown away', G.parsePlan('{"tool":"prescribe","topic":"x"}') === null);
  ok('text that is not JSON is thrown away', G.parsePlan('I think you should quiz') === null && G.parsePlan('') === null);
  ok('a comparison without its two topics is thrown away', G.parsePlan('{"tool":"compare","topic":"x","topics":["a"]}') === null &&
     JSON.stringify(G.parsePlan('{"tool":"compare","topics":["a","b"]}').topics) === '["a","b"]');
  ok('a topic is cut to 80 characters', G.parsePlan(JSON.stringify({ tool: 'search', topic: 'x'.repeat(300) })).topic.length === 80);
}

head('a topic finds its section');
{
  const cluster = (title, page, paras) => ({ title, pageStart: page, pageEnd: page, text: paras.join(' '), segments: paras.map(t => ({ text: t, page, heading: false })) });
  const DOCS = [{ id: 'd1', name: 'Valves', clusters: [
    cluster('Aortic Stenosis', 1, ['Aortic stenosis is a narrowing of the aortic valve. Calcific degeneration is the most common cause in older adults.']),
    cluster('Aortic Regurgitation', 2, ['Aortic regurgitation is a leak of the aortic valve back into the left ventricle.']),
    cluster('Syncope', 3, ['Exertional fainting is a classic symptom of severe outflow obstruction and should prompt urgent valve replacement.']),
  ] }];
  const idx = A.build(DOCS);
  const title = i => i >= 0 ? idx.sections[i].title : '(none)';
  ok('by its title', title(G.findSection(idx, 'aortic regurgitation')) === 'Aortic Regurgitation' && title(G.findSection(idx, 'aortic stenosis')) === 'Aortic Stenosis');
  const idx2 = A.build([{ id: 'd2', name: 'Two', clusters: [cluster('Causes of Aortic Stenosis in Adults', 1, ['Calcific degeneration is common.']), cluster('Aortic Stenosis', 2, ['A narrowing.'])] }]);
  ok('of two titles with all its words, the one with least else in it', idx2.sections[G.findSection(idx2, 'aortic stenosis')].title === 'Aortic Stenosis');
  ok('by the book’s answer when no title has its words', title(G.findSection(idx, 'exertional fainting')) === 'Syncope', title(G.findSection(idx, 'exertional fainting')));
  ok('a title sharing one word of three loses to the book’s answer', title(G.findSection(idx, 'exertional fainting aortic')) === 'Syncope', title(G.findSection(idx, 'exertional fainting aortic')));
  ok('nothing for an empty topic, or one the book lacks', G.findSection(idx, '') === -1 && G.findSection(idx, 'zebra migration patterns') === -1, String(G.findSection(idx, 'zebra migration patterns')));
  ok('the coach says what it is doing, naming the section', /“Aortic Stenosis”/.test(G.say({ tool: 'quiz' }, 'Aortic Stenosis')) && /Tell me the topic/.test(G.say({ tool: 'quiz' }, '')));
}

head('where am I weak: the items still weak, with their types (Supreme Memorizer)');
{
  const W = (id, misses, types, hits, extra) => Object.assign({ id, cluster: 0, source: 'drill', q: { question: 'q', options: ['x'], answer: 0, page: 1 }, label: 'item ' + id,
    misses, streak: 0, hits, types, confusedWith: '', order: +id.slice(1) }, extra || {});
  const docs = [{ id: 'u1', name: 'Valves' }, { id: 'u2', name: 'Heart failure' }, { id: 'u3', name: 'Rhythm' }];
  const sessions = {
    u1: { weak: { w1: W('w1', 2, ['C', 'E'], []), w2: W('w2', 1, ['R'], [2, 5]) } },       /* w2 has graduated */
    u2: { weak: { w3: W('w3', 1, ['N'], [4]), w4: W('w4', 1, ['C'], [], { source: 'exam', confusedWith: 'digoxin' }), w5: W('w5', 1, ['C'], []) } },
    u3: { weak: { w6: W('w6', 1, ['R'], [1, 3]) } },                                   /* all graduated */
  };
  const got = G.weakItems(docs, sessions);
  ok('each unit with anything still weak, the most weak first', got.map(w => w.name).join() === 'Heart failure,Valves', got.map(w => w.name + ':' + w.n).join());
  ok('an item that has graduated is not weak, and a unit with nothing weak is left out',
     got.find(w => w.name === 'Valves').n === 1 && !/item w2/.test(got.find(w => w.name === 'Valves').line) && !got.some(w => w.name === 'Rhythm'));
  ok('each line names the item with its latest type and its misses', got.find(w => w.name === 'Valves').line === 'Weak: item w1 (Type E · 2 misses)',
     got.find(w => w.name === 'Valves').line);
  ok('and what it was confused with', /item w4 \(Type C — with digoxin · 1 miss\)/.test(got.find(w => w.name === 'Heart failure').line), got.find(w => w.name === 'Heart failure').line);
  ok('a review round is offered only for what a round can ask (not an exam miss)', got.find(w => w.name === 'Heart failure').review === 2);
  ok('no sessions, nothing weak', G.weakItems(docs, {}).length === 0 && G.weakItems([], null).length === 0);
}

head('the loop: a message of several steps, each decided by what the last found');
{
  const C = [
    ['explain aortic stenosis and quiz me on it', ['explain aortic stenosis', 'quiz me on it']],
    ['explain preload, then give me the mnemonics; quiz me', ['explain preload', 'give me the mnemonics', 'quiz me']],
    ['explain preload and the numbers', ['explain preload', 'the numbers']],
    ['compare aortic stenosis and aortic regurgitation', ['compare aortic stenosis and aortic regurgitation']],
    ['What reduces preload and afterload?', ['What reduces preload and afterload?']],
    ['a, then b, then c, then d', ['a', 'b', 'c']],
  ];
  const bad = C.filter(([m, w]) => JSON.stringify(G.clauses(m)) !== JSON.stringify(w)).map(([m]) => m + ' → ' + JSON.stringify(G.clauses(m)));
  ok(`a message splits at "then", ";" and an "and" that starts a request of its own — never inside "compare X and Y" — at most ${G.MAX_STEPS} steps`, bad.length === 0, bad.join(' | '));
  const mem = { topic: 'Aortic Stenosis' };
  ok('each step is planned with the memory the last left: "quiz me on it", "the numbers", "give me the mnemonics"',
     G.plan('quiz me on it', mem).topic === 'Aortic Stenosis' && G.plan('the numbers', mem).tool === 'numbers' && G.plan('the numbers', mem).topic === 'Aortic Stenosis' &&
     JSON.stringify(G.plan('give me the mnemonics', mem)) === JSON.stringify({ tool: 'mnemonic', topic: 'Aortic Stenosis' }));
  const miss = G.afterStep({ tool: 'explain', topic: 'fainting on effort' }, { missing: true, meaning: true });
  ok('a topic not found by its words, with meaning on: search by meaning, then the same tool', miss && miss.tool === 'search' && miss.meaningOnly && miss.then === 'explain' && miss.topic === 'fainting on effort');
  ok('and when meaning finds a section, the tool runs on it — once', JSON.stringify(G.afterStep(miss, { section: 'Syncope' })) === JSON.stringify({ tool: 'explain', topic: 'Syncope', recovered: true, because: 'found by meaning' }) &&
     G.afterStep(miss, { section: '' }) === null && G.afterStep(G.afterStep(miss, { section: 'Syncope' }), { missing: true, meaning: true }) === null);
  ok('with meaning off, a missing topic is simply said to be missing', G.afterStep({ tool: 'explain', topic: 'x' }, { missing: true, meaning: false }) === null);
  const empty = ['quiz', 'numbers', 'mnemonic'].map(tool => G.afterStep({ tool, topic: 'Syncope' }, { empty: true, section: 'Syncope' }));
  ok('a quiz, numbers or mnemonic with nothing in it explains the section instead, saying why', empty.every(e => e && e.tool === 'explain' && e.topic === 'Syncope' && e.recovered) &&
     JSON.stringify(empty.map(e => e.because)) === '["no questions in it","no numbers in it","no mnemonic in it"]');
  ok('a step that found what it looked for ends the loop', G.afterStep({ tool: 'explain', topic: 'Syncope' }, { section: 'Syncope' }) === null &&
     G.afterStep({ tool: 'search', topic: 'q' }, { section: 'Syncope' }) === null && G.afterStep({ tool: 'weak', topic: '' }, {}) === null);
}

head('the new tools: why I missed it, a review round, the week ahead');
{
  const CASES = [
    ['why did I get that wrong?', 'mistake'], ['explain my mistakes', 'mistake'], ['why do I keep missing preload', 'mistake'],
    ['start a review round', 'round'], ['drill my weak items', 'round'], ['retest my weak points', 'round'],
    ['what is due this week', 'schedule'], ['what cards do I have tomorrow', 'schedule'], ['show my review schedule', 'schedule'],
    ['what do I get wrong', 'weak'], ['review my cards', 'review'], ['where am I weakest?', 'weak'],
  ];
  const wrong = CASES.filter(([m, t]) => G.plan(m, {}).tool !== t).map(([m, t]) => m + ' → ' + G.plan(m, {}).tool + ' (not ' + t + ')');
  ok(`each of ${CASES.length} messages reaches its tool, and the old ones still reach theirs`, wrong.length === 0, wrong.join(' | '));
  ok('every tool has a line the model is told', G.TOOLS.every(t => typeof G.DESCRIBE[t] === 'string' && G.DESCRIBE[t].length > 10) && G.TOOLS.length === 14);
  ok('and something to say', ['mistake', 'round', 'schedule'].every(t => G.say({ tool: t }, '') !== G.say({ tool: 'search' }, '')));

  const W = (id, types, hits, extra) => Object.assign({ id, cluster: 0, source: 'drill', label: 'item ' + id, misses: types.length, hits, types, confusedWith: '', order: +id.slice(1) }, extra || {});
  const docs = [{ id: 'u1', name: 'Valves' }, { id: 'u2', name: 'Failure' }];
  const sessions = { u1: { weak: { w1: W('w1', ['N'], []), w2: W('w2', ['R'], [2, 5]), w4: W('w4', ['E', 'C'], [], { confusedWith: 'mitral' }) } },
                     u2: { weak: { w3: W('w3', ['C', 'E'], [], { confusedWith: 'digoxin' }) } } };
  const m = G.mistakes(docs, sessions, 5);
  ok('why I missed it: the misses still open, latest first, graduated ones not', m.map(x => x.label).join() === 'item w4,item w3,item w1', m.map(x => x.label).join());
  ok('each by its LATEST type, with what the type means and its fix (skill.js)', m[0].type === 'C' && m[0].name === 'Confusion' && /different item/.test(m[0].means) && /side by side/.test(m[0].fix) &&
     m[1].type === 'E' && m[1].name === 'Encoding' && m[2].type === 'N', m.map(x => x.type).join());
  ok('and what it was confused with, only when the type is C', m[0].confusedWith === 'mitral' && m[1].confusedWith === '');
  ok('at most the number asked for', G.mistakes(docs, sessions, 2).length === 2 && G.mistakes(docs, {}, 3).length === 0);

  /* Measured east of UTC: in UTC itself (as CI runs) a local-time date
     would pass by coincidence — local midnight is UTC midnight. */
  const tzWas = process.env.TZ; process.env.TZ = 'Asia/Karachi';
  ok('days step in UTC across a month, a year and a clock change', new Date(2026, 0, 1).getTimezoneOffset() === -300 && G.addDays('2026-01-31', 1) === '2026-02-01' && G.addDays('2026-12-31', 1) === '2027-01-01' &&
     G.addDays('2026-03-28', 2) === '2026-03-30' && G.addDays('2026-10-24', 7) === '2026-10-31');
  const cards = [{ srs: null }, { srs: { due: '2026-09-20' } }, { srs: { due: '2026-09-24' } }, { srs: { due: '2026-09-25' } }, { srs: { due: '2026-09-30' } }, { srs: { due: '2026-10-01' } }];
  const wk = G.schedule(cards, '2026-09-24');
  ok('the week ahead: new, overdue and due-today cards all count as today', wk[0].n === 3 && wk[0].label === 'Today' && wk[1].n === 1 && wk[1].label === 'Tomorrow', JSON.stringify(wk.map(d => d.n)));
  ok('a card due a week out is not in the week; one on its last day is', wk.length === 7 && wk[6].day === '2026-09-30' && wk[6].n === 1 && wk.reduce((a, d) => a + d.n, 0) === 5);
  if (tzWas === undefined) delete process.env.TZ; else process.env.TZ = tzWas;
}

head('the agent loop: several tools, then an answer held to the book');
{
  const Ground = require(path.join(ROOT, 'memorizer', 'src', 'ground.js'));
  const check = (text, obs) => Ground.summary(text, obs.map(o => ({ text: o })));
  const OBS = { 'search|aortic stenosis': 'Calcific degeneration is the most common cause of aortic stenosis in older adults (p.1).',
                'explain|aortic stenosis': 'Aortic Stenosis: a narrowing of the aortic valve.', 'open|syncope': 'Opened Syncope.' };
  const mk = (replies, extra) => {
    const prompts = [], acted = [];
    const o = Object.assign({ memory: {}, profile: '',
      think: p => { prompts.push(p); const r = replies[prompts.length - 1]; return r instanceof Error ? Promise.reject(r) : Promise.resolve(r === undefined ? '' : r); },
      act: p => { acted.push(p); return Promise.resolve({ observation: OBS[p.tool + '|' + (p.topic || '').toLowerCase()] || 'Not found in the book.', turn: { tool: p.tool } }); },
      check }, extra || {});
    return { o, prompts, acted };
  };
  const T = (tool, topic) => JSON.stringify({ action: 'tool', tool, topic, topics: [] });
  const A2 = t => JSON.stringify({ action: 'answer', answer: t });
  const runs = [];

  {
    const x = mk([T('search', 'aortic stenosis'), T('explain', 'aortic stenosis'),
      A2('Calcific degeneration is the most common cause of aortic stenosis in older adults [1]. It narrows the aortic valve [2]. Surgery cures 95 percent [1].')]);
    runs.push(G.run('what causes aortic stenosis?', x.o).then(r => {
      ok('it uses two tools in turn, then answers', r.by === 'ai' && r.steps.length === 2 && x.acted.map(p => p.tool).join() === 'search,explain' && r.why === 'answered', r.why + ' ' + r.steps.length);
      ok('each step sees the results so far, numbered as it must cite them', /Result \[1\]: Calcific degeneration/.test(x.prompts[1]) && /Result \[2\]: Aortic Stenosis: a narrowing/.test(x.prompts[2]) &&
         !/Result \[/.test(x.prompts[0]));
      ok('its answer is kept sentence by sentence as it holds to the results it cites; a made-up number is dropped',
         r.answer.kept.length === 2 && r.answer.dropped.length === 1 && /95/.test(r.answer.dropped[0].text), JSON.stringify(r.answer.dropped.map(d => d.why)));
      ok('the model’s steps are marked as its own', r.steps.every(s => s.plan.by === 'ai'));
    }));
  }
  {
    const x = mk(['I would search the book.']);
    runs.push(G.run('how is aortic stenosis treated?', x.o).then(r => ok('a first reply that is not a step: the rules decide, one tool, no answer',
      r.by === 'rules' && r.steps.length === 1 && x.acted[0].tool === 'search' && r.answer === null && x.prompts.length === 1, r.by + ' ' + r.why)));
  }
  {
    const x = mk([T('prescribe', 'x')]);
    runs.push(G.run('quiz me on preload', x.o).then(r => ok('a made-up tool: the rules decide', r.by === 'rules' && x.acted[0].tool === 'quiz', x.acted.map(p => p.tool).join())));
  }
  {
    const x = mk([A2('Aortic stenosis is common [1].')]);
    runs.push(G.run('tell me about aortic stenosis', x.o).then(r => ok('an answer before any tool rests on nothing: the rules decide', r.by === 'rules' && r.answer === null && r.why === 'answered without the book', r.why)));
  }
  {
    const x = mk([new Error('GPU lost')]);
    runs.push(G.run('explain preload', x.o).then(r => ok('a model that throws: the rules decide', r.by === 'rules' && x.acted[0].tool === 'explain')));
  }
  {
    const x = mk([T('search', 'aortic stenosis'), 'not json']);
    runs.push(G.run('x', x.o).then(r => ok('a bad reply later ends the loop, the tools’ results standing', r.by === 'ai' && r.steps.length === 1 && r.answer === null && r.why === 'unusable reply', r.why)));
  }
  {
    const x = mk([T('search', 'aortic stenosis'), T('search', 'Aortic Stenosis')]);
    runs.push(G.run('x', x.o).then(r => ok('the same tool on the same topic twice ends it, used once', x.acted.length === 1 && r.why === 'repeated a tool', r.why)));
  }
  {
    const x = mk([T('open', 'syncope'), T('search', 'more')]);
    runs.push(G.run('teach me syncope', x.o).then(r => ok('a tool that hands the student to a screen ends the turn', r.steps.length === 1 && x.prompts.length === 1 && r.why === 'ended by open', r.why)));
  }
  {
    const x = mk([T('search', 'a1'), T('search', 'a2'), T('search', 'a3'), T('search', 'a4'), T('search', 'a5')]);
    runs.push(G.run('x', x.o).then(r => ok('at most ' + G.MODEL_STEPS + ' tools; then only an answer is taken', x.acted.length === G.MODEL_STEPS && x.prompts.length === G.MODEL_STEPS + 1 &&
      /You may use no more tools/.test(x.prompts[G.MODEL_STEPS]) && !/"action":"tool"/.test(x.prompts[G.MODEL_STEPS]) && /"action":"tool"/.test(x.prompts[0]) && r.answer === null, x.acted.length + ' tools')));
  }
  {
    const x = mk([], { think: null });
    runs.push(G.run('where am I weakest?', x.o).then(r => ok('with no model, the rules, as before', r.by === 'rules' && r.why === 'no model' && x.acted[0].tool === 'weak')));
  }
  {
    const long = 'Word '.repeat(400);
    const x = mk([T('search', 'long'), A2('x')], { act: () => Promise.resolve({ observation: long, turn: {} }) });
    runs.push(G.run('x', x.o).then(r => ok('a result is cut short before the model sees it', r.steps[0].observation.length === 600 && x.prompts[1].length < 4000, String(r.steps[0].observation.length))));
  }
  {
    let handed = null;
    const x = mk(['not a step'], { rules: why => { handed = why; } });
    runs.push(G.run('explain preload and quiz me on it', x.o).then(r => ok('given its own rules loop, an unusable first reply hands the whole message to it, and acts on nothing itself',
      handed === 'unusable reply' && x.acted.length === 0 && r.by === 'rules' && r.steps.length === 0, String(handed))));
  }
  ok('a step is a real tool or an answer, nothing else', G.parseStep('{"action":"answer","answer":"  "}') === null && G.parseStep('{"action":"shout"}') === null && G.parseStep('[]') === null &&
     G.parseStep('{"action":"tool","tool":"compare","topics":["a"]}') === null && G.parseStep(T('quiz', 'preload')).plan.tool === 'quiz' && G.parseStep(A2('Yes [1].')).text === 'Yes [1].');
  ok('the prompt carries every tool, what it knows of the student and the last topic', G.TOOLS.every(t => G.loopPrompt('hi', {}, '', []).indexOf('- ' + t + ':') !== -1) &&
     /About the student: likes quizzes\./.test(G.loopPrompt('hi', { topic: 'Preload' }, 'likes quizzes.', [])) && /last topic was: Preload/.test(G.loopPrompt('hi', { topic: 'Preload' }, '', [])));
  global.__agentRuns = runs;
}

head('what a tool shows the model: short, and from the book');
{
  const r = { found: true, groups: [{ items: [{ text: 'A.', page: 1 }, { text: 'B.', page: 2 }] }, { items: [{ text: 'C.', page: 3 }, { text: 'D.', page: 4 }] }] };
  ok('a search: its first three sentences, with their pages', G.observe('search', { r }) === 'A. (p.1) B. (p.2) C. (p.3)', G.observe('search', { r }));
  ok('nothing found says so, for every section tool', ['search', 'explain', 'quiz', 'mnemonic', 'numbers', 'compare', 'open'].every(t => G.observe(t, {}) === 'Not found in the book.'));
  ok('why I missed it: the type, what it means and the fix', /item: Type C \(Confusion\) — You picked .* Fix: Learn the difference/.test(
     G.observe('mistake', { mistakes: [{ label: 'item', type: 'C', name: 'Confusion', means: 'You picked a different item from this material.', fix: 'Learn the difference: the two side by side.' }] })));
  ok('the week ahead, day by day', G.observe('schedule', { week: [{ label: 'Today', n: 2 }, { label: 'Tomorrow', n: 0 }] }) === 'Today 2, Tomorrow 0.');
  ok('the weak list and the weakest sections', G.observe('weak', { items: [{ name: 'Valves', line: 'Weak: x (Type E · 2 misses)' }], spots: [{ title: 'Syncope', pct: 40 }] }) ===
     'Valves: Weak: x (Type E · 2 misses) Weakest sections: Syncope 40%.');
}

head('what the coach remembers: section titles and tools, never what was typed');
{
  let pr = null;
  pr = G.remember(pr, 'quiz', ['Preload']);
  pr = G.remember(pr, 'quiz', ['Afterload']);
  pr = G.remember(pr, 'explain', ['Preload']);
  ok('the titles it landed on, newest first, each once', pr.topics.join() === 'Preload,Afterload' && pr.turns === 3 && pr.tools.quiz === 2 && pr.tools.explain === 1);
  for (let i = 0; i < 7; i++) pr = G.remember(pr, 'search', ['S' + i]);
  ok('at most ' + G.PROFILE_TOPICS + ' titles', pr.topics.length === G.PROFILE_TOPICS && pr.topics[0] === 'S6');
  ok('a tool that is not one is not counted', !('shout' in G.remember(pr, 'shout', []).tools));
  ok('the model is told the titles, what the student likes (twice or more), and what is still weak',
     G.profileLine(pr, 'Weak: preload (Type E · 2 misses)') === 'recently asked about S6, S5, S4, S3, S2; likes being quizzed; still weak on preload (Type E · 2 misses).',
     G.profileLine(pr, 'Weak: preload (Type E · 2 misses)'));
  ok('a tool used once is not a liking; nothing known, nothing said', !/likes/.test(G.profileLine(G.remember(null, 'quiz', []), '')) && G.profileLine(null, '') === '');
  ok('the record is not changed in place', (() => { const a = G.remember(null, 'quiz', ['X']); const b = G.remember(a, 'quiz', ['Y']); return a.topics.join() === 'X' && b.topics.join() === 'Y,X'; })());
}

Promise.all(global.__agentRuns || []).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
