#!/usr/bin/env node
/*
 * Look-alikes asked side by side, and chapters taken in turn — src/core/confusable.js (docs/ROADMAP.md, S6).
 *
 *   node tests/verify-confusable-pure.js
 *
 * Bare Node, no build: synthetic questions and synthetic gap memories. The claims, each a way this could quietly
 * deal the wrong deck:
 *   - a gap is split into the two things it names, and one that names no two is left out rather than guessed at;
 *   - a question is on a side only when it holds every word of that side; "AS" is aortic stenosis, never "as";
 *   - a partner is added only where the deck lacks the other side, never one marked bad or already dealt, at most
 *     as many as asked, and chosen the same way every time;
 *   - arranged, every question is there exactly once, a partner straight after its question, and no two in a row
 *     share a chapter while another chapter has questions left;
 *   - the page's own reviewDeck() keeps every due card (reviewqueue.js, rule 1), and its mock block is arranged.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { blankComments } = require('./_source.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = JSON.stringify;
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const mod = {};
new Function('module', 'exports', read('src/core/confusable.js')).call(mod, { exports: mod }, mod);
const C = mod.Confusable;

const CONSTRICT = 'Keeps reading constrictive pericarditis as restrictive cardiomyopathy.';

head('a gap is split into the two things it names');
{
  const s = C.sides(CONSTRICT);
  ok('"X as Y": the confusion\'s verbs are left out, each word kept by its first seven letters',
     J(s) === J({ a: ['constri', 'pericar'], b: ['restric', 'cardiom'] }), J(s));
  ok('"X with Y", with an abbreviation in capitals kept as written, and a plural\'s s dropped',
     J(C.sides('Confuses AS with HCM murmurs')) === J({ a: ['AS'], b: ['HCM', 'murmur'] }), J(C.sides('Confuses AS with HCM murmurs')));
  ok('"X vs Y", "X versus Y", "X against Y", "X for Y", "X and Y" and "between X and Y" each split',
     [['AS vs AR', 'AS', 'AR'], ['Tamponade versus constriction', 'tampona', 'constri'], ['Pericarditis against STEMI', 'pericar', 'STEMI'],
      ['Mistakes LBBB for LVH', 'LBBB', 'LVH'], ['Mixes up pulsus paradoxus and Kussmaul sign', 'pulsus', 'kussmau'],
      ['Cannot tell between Brugada and early repolarisation', 'brugada', 'early']]
       .every(([t, a, b]) => { const x = C.sides(t); return x && x.a[0] === a && x.b[0] === b; }),
     ['AS vs AR', 'Mistakes LBBB for LVH', 'Cannot tell between Brugada and early repolarisation'].map(t => J(C.sides(t))).join(' '));
  ok('"as" splits only in lower case: "AS as AR" splits at the second', J(C.sides('Reads AS as AR')) === J({ a: ['AS'], b: ['AR'] }), J(C.sides('Reads AS as AR')));
  ok('a gap that names no two things is no pair', C.sides('Weak on heart failure drugs') === null && C.sides('Forgets doses') === null);
  ok('nor one whose sides share every word of one of them ("type" against "type MI")',
     C.sides('Struggles between type 1 and type 2 MI') === null && C.sides('pericarditis vs pericarditis') === null);
  ok('nor anything but text', C.sides(null) === null && C.sides(undefined) === null && C.sides({}) === null && C.sides('') === null);
}

/* A synthetic bank. Stems are invented; they are never real questions. */
const Q = (id, ch, s, key, extra) => Object.assign({ id, ch, s, o: [{ t: 'other' }, { t: key }], ci: 1 }, extra || {});
const POOL = [
  Q('p1', 'Pericardium', 'Rising venous pressure on inspiration after cardiac surgery.', 'Constrictive pericarditis'),
  Q('p2', 'Pericardium', 'A thickened pericardium with septal bounce.', 'Constriction'),
  Q('p3', 'Pericardium', 'Calcified pericardium and a septal bounce: constrictive physiology.', 'Pericardiectomy'),
  Q('p4', 'Pericardium', 'Effusion with pulsus paradoxus.', 'Pericardiocentesis'),
  Q('c1', 'Cardiomyopathy', 'Amyloid with a restrictive filling pattern.', 'Restrictive cardiomyopathy'),
  Q('c2', 'Cardiomyopathy', 'Restrictive cardiomyopathy or constrictive pericarditis: which has respiratory variation?', 'Constriction'),
  Q('c3', 'Cardiomyopathy', 'A restrictive cardiomyopathy that is marked bad.', 'Restrictive', { bad: true }),
  Q('c4', 'Cardiomyopathy', 'Dilated cardiomyopathy after a viral illness.', 'Dilated'),
  Q('v1', 'Valves', 'A crescendo-decrescendo murmur in AS.', 'AS'),
  Q('v2', 'Valves', 'A murmur that rises with Valsalva, in HCM.', 'HCM'),
  Q('v3', 'Valves', 'The same, as written by someone who reads it as stated.', 'Echo'),   // lower-case "as" only
];
const MEM = [
  { id: 'g1', kind: 'gap', text: CONSTRICT },
  { id: 'g2', kind: 'gap', text: 'Confuses AS with HCM murmurs' },
  { id: 'f1', kind: 'fact', text: 'Reads pericardium as cardiomyopathy' },             // would pair, were it a gap
  { id: 'g3', kind: 'gap', text: 'Weak on heart failure drugs' },
  { id: 'g4', kind: 'gap', text: 'Mixes up tamponade and dextrocardia' },           // no question on either side
];

head('sets: the questions on each side of each gap');
const SETS = C.sets(MEM, POOL);
{
  const g1 = SETS.find(s => s.id === 'g1'), g2 = SETS.find(s => s.id === 'g2');
  ok('one set for each gap that splits and has questions on both sides, in the memories\' order: not a fact, not a gap with no pair, not one with none on a side',
     J(SETS.map(s => s.id)) === J(['g1', 'g2']), J(SETS.map(s => s.id)));
  ok('constrictive pericarditis: every question that holds both words, "constriction" and "pericardium" matched to "constrictive pericarditis"; one holding only one of them (pericardiocentesis) is not',
     g1 && J(g1.a) === J(['p1', 'p2', 'p3']), g1 && J(g1.a));
  ok('restrictive cardiomyopathy: the question that holds both, and not the one marked bad', g1 && J(g1.b) === J(['c1']), g1 && J(g1.b));
  ok('a question on both sides is neither side\'s, and is said to be on both', g1 && J(g1.both) === J(['c2']), g1 && J(g1.both));
  ok('"AS" finds the question that writes AS, never the word "as"; "HCM murmur" finds the HCM murmur', g2 && J(g2.a) === J(['v1']) && J(g2.b) === J(['v2']), g2 && J([g2.a, g2.b]));
  ok('each set carries its memory\'s text and the words read from it', g1 && g1.text === CONSTRICT && J(g1.terms) === J(C.sides(CONSTRICT)));
  ok('no memories, no pool, or rubbish: no sets', [C.sets([], POOL), C.sets(MEM, []), C.sets(null, null), C.sets([null, 5, { kind: 'gap' }], POOL)].every(x => Array.isArray(x) && !x.length));
}

head('partners: the other side, where the deck has none of it');
const byId = Object.fromEntries(POOL.map(q => [q.id, q]));
const deckOf = ids => ids.map(id => byId[id]);
{
  const P = (ids, o) => C.partners(deckOf(ids), SETS, POOL, o);
  const one = P(['p1', 'p4', 'v1'], { max: 4 });
  ok('constrictive pericarditis brings restrictive cardiomyopathy, and AS brings HCM', J(one) === J([{ after: 'p1', id: 'c1', set: 'g1' }, { after: 'v1', id: 'v2', set: 'g2' }]), J(one));
  ok('a deck that already holds the other side gets no partner for it', J(P(['p1', 'c1', 'v1'], { max: 4 }).map(p => p.id)) === J(['v2']), J(P(['p1', 'c1', 'v1'], { max: 4 })));
  ok('at most max, and none without a max', P(['p1', 'v1'], { max: 1 }).length === 1 && P(['p1', 'v1'], {}).length === 0 && P(['p1', 'v1']).length === 0);
  ok('two questions on one side find two different partners, never the same one twice', J(P(['c1', 'p4'], { max: 4 }).map(p => p.id)) === J(['p1']) && J(C.partners(deckOf(['p1', 'p3']), SETS, POOL, { max: 4 }).map(p => p.id)) === J(['c1']),
     J(C.partners(deckOf(['p1', 'p3']), SETS, POOL, { max: 4 })));
  ok('prefer chooses among the other side, lower first; ties go to the bank\'s order', J(P(['c1'], { max: 4, prefer: id => (id === 'p3' ? 0 : 1) }).map(p => p.id)) === J(['p3']) && J(P(['c1'], { max: 4 }).map(p => p.id)) === J(['p1']),
     J(P(['c1'], { max: 4, prefer: id => (id === 'p3' ? 0 : 1) })));
  ok('never a question marked bad, even when it is the only one', J(C.partners(deckOf(['p1']), [{ id: 'x', a: ['p1'], b: ['c3'] }], POOL, { max: 4 })) === '[]');
  const deck = deckOf(['p1', 'v1']), copy = J(deck), pool = J(POOL), sets = J(SETS);
  P(['p1', 'v1'], { max: 4 });
  ok('nothing given is changed', J(deck) === copy && J(POOL) === pool && J(SETS) === sets);
}

head('arrange: chapters in turn, a partner after its question');
const chs = list => list.map(q => q.ch[0]).join('');
const runsOf = list => list.reduce((n, q, i) => n + (i && list[i - 1].ch === q.ch ? 1 : 0), 0);
{
  const mk = (n, ch) => Array.from({ length: n }, (_, i) => ({ id: ch + i, ch }));
  const blocked = [...mk(3, 'A'), ...mk(3, 'B'), ...mk(3, 'C')];
  const a = C.arrange(blocked);
  ok('three chapters dealt in blocks come back with no two in a row from one chapter', runsOf(a) === 0 && a.length === 9, chs(a));
  ok('every question exactly once', J(a.map(q => q.id).sort()) === J(blocked.map(q => q.id).sort()));
  const lop = C.arrange([...mk(4, 'A'), ...mk(1, 'B')]);
  ok('where one chapter has more than the rest can part, it is parted as far as it can be: A B A A A has three such, the fewest', chs(lop) === 'ABAAA', chs(lop));
  ok('within a chapter, the order given', J(a.filter(q => q.ch === 'A').map(q => q.id)) === J(['A0', 'A1', 'A2']));
  const withP = C.arrange(deckOf(['p1', 'p4', 'v1']), { partners: [{ after: 'p1', id: 'c1' }, { after: 'v1', id: 'v2' }], byId });
  const ids = withP.map(q => q.id);
  ok('each partner straight after the question it was found for', ids.indexOf('c1') === ids.indexOf('p1') + 1 && ids.indexOf('v2') === ids.indexOf('v1') + 1, J(ids));
  ok('and the deck and its partners, each once', J(ids.slice().sort()) === J(['c1', 'p1', 'p4', 'v1', 'v2']), J(ids));
  ok('a partner not in byId is left out rather than dealt as nothing', J(C.arrange(deckOf(['p1']), { partners: [{ after: 'p1', id: 'zz' }], byId }).map(q => q.id)) === J(['p1']));
  ok('an empty deck is an empty deck', J(C.arrange([])) === '[]' && J(C.arrange(null)) === '[]');
}

head('the page: a review keeps every due card, and the mock block is arranged');
{
  const raw = read('app/systole.html');
  const page = blankComments(raw);
  const count = t => page.split(t).length - 1;
  const cut = (from, to) => { const a = page.indexOf(from); return a < 0 || page.indexOf(from, a + 1) >= 0 ? 'throw new Error("not once: ' + from.replace(/"/g, '') + '");' : raw.slice(a, page.indexOf(to, a) + to.length); };
  ok('the module is written into the page once, after topicrun.js', count('@@SLOT[src:src/core/confusable.js]@@') === 1 && page.indexOf('@@SLOT[src:src/core/confusable.js]@@') > page.indexOf('@@SLOT[src:src/core/topicrun.js]@@'));
  /* The page's own lines, its shuffle held still, over a bank in blocks: twelve questions, four due, a gap memory. */
  const ctx = {
    POOL: [...['p1', 'p2', 'p3', 'p4'].map(id => byId[id]), ...['c1', 'c2', 'c4'].map(id => byId[id]), ...['v1', 'v2', 'v3'].map(id => byId[id])],
    S: { srs: { p1: { due: '2026-11-01' }, p2: { due: '2026-11-01' }, p4: { due: '2026-11-01' }, v1: { due: '2026-11-01' }, c4: { due: '2026-12-01' }, p3: { due: '2026-12-30' } } },
    Memory: { all: () => MEM }, todayISO: () => '2026-11-19',
  };
  ctx.QBYID = Object.fromEntries(ctx.POOL.map(q => [q.id, q]));
  vm.createContext(ctx);
  const code = [read('src/core/fsrs.js'), read('src/core/studyplan.js'), read('src/core/reviewqueue.js'), read('src/core/confusable.js'), 'function shuf(a){ return a.slice(); }',
    cut('function reviewQueue(target){', '\n'), cut('const PAIR_MAX=', '\n'), cut('function reviewDeck(qs){', '\n}')].join('\n');
  let err = '';
  try { vm.runInContext(code + '\nvar dealt = reviewDeck(reviewQueue(4)).map(q => q.id); var all = reviewDeck(ReviewQueue.due(POOL,S.srs,todayISO())).map(q => q.id);', ctx); } catch (e) { err = e.message; }
  const dealt = ctx.dealt || [], all = ctx.all || [];
  ok('reviewDeck() over the page\'s reviewQueue(): every due card is dealt, and the two partners, and nothing else', !err && J(dealt.slice().sort()) === J(['c1', 'p1', 'p2', 'p4', 'v1', 'v2']), err || J(dealt));
  ok('restrictive cardiomyopathy straight after constrictive pericarditis, and HCM after AS, a card met (none here) before one never met, in the bank\'s order',
     dealt.indexOf('c1') === dealt.indexOf('p1') + 1 && dealt.indexOf('v2') === dealt.indexOf('v1') + 1, J(dealt));
  ok('and each question once', new Set(dealt).size === dealt.length, J(dealt));
  ok('every due card, asked on its own, is dealt through it too: each once, with its partners, each after its question',
     !err && J(all.slice().sort()) === J(['c1', 'p1', 'p2', 'p4', 'v1', 'v2']) && all.indexOf('c1') === all.indexOf('p1') + 1, err || J(all));
  /* Home's review of every card due went with its session strip (the owner's choice, November 2026); Brain's Review is
     the review the page starts by itself. */
  ok('the review the page starts by itself is reviewDeck() over the queue, and Home\'s review of every card due is gone',
     count("else if(mode==='due') qs=deck||reviewDeck(reviewQueue(20));") === 1 && count('reviewAllDue') === 0);
  ok('and startQuiz() does not shuffle a review afterwards, which would part each pair', count("if(!deck&&mode!=='due') qs=shuf(qs);") === 1 && count('if(!deck) qs=shuf(qs);') === 0);
  ok('the mock block is dealt by MockExam with Confusable.arrange as its order', count('const ids=MockExam.build({pool:POOL,size:mockSize(),chapter:ch,seen:mockSeen,arrange:qs=>Confusable.arrange(qs)});') === 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
