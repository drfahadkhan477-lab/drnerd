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
  ok('the prompt lists every tool and the remembered topic', G.TOOLS.every(t => G.planPrompt('hi', { topic: 'preload' }).indexOf(t) !== -1) && /last topic was: preload/.test(G.planPrompt('hi', { topic: 'preload' })));
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
