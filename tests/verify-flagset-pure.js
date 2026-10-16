#!/usr/bin/env node
/*
 * The flag and annotation rules — src/core/flagset.js: the questions flagged to come back to, and the
 * questions with a sticky note or a mark on them.
 *
 *   node tests/verify-flagset-pure.js
 *
 * Pure Node, over an invented bank. The module has no DOM, no clock and no storage, so every expected
 * value is worked out in the test from the fixture, not read back from the module.
 *
 * What is measured, rather than assumed:
 *   - a list read back from storage keeps ids, once each and in order, and nothing else; a backup's list is
 *     sound only if it is nothing but ids;
 *   - a flag goes on and off only by toggle, and addAll adds without ever removing and says how many were new;
 *   - the flagged deck is the questions the bank has and has not quarantined, in the order flagged, and a
 *     list naming "constructor" or "__proto__" finds no question and does not throw;
 *   - a question is annotated if it has a sticky note (even an empty one) or a stroke of ink, the same test
 *     the badge on the quiz screen makes; the list is newest note first, then chapter and number;
 *   - find() wants every word typed, in the note, the chapter or the stem, in any case and any alphabet;
 *   - the sentences the card and the screen reader say.
 */
'use strict';
const F = require('../src/core/flagset.js').FlagSet;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ids = list => list.map(x => x.id);
const safely = (fn, otherwise) => { try { return fn(); } catch (_) { return otherwise; } };

/* An invented bank: two chapters, a question with a colon in its id, and one quarantined. */
const q = (id, ch, n, s, extra) => Object.assign({ id, ch, n, s }, extra || {});
const bank = {};
[
  q('A1', 'Alpha', 1, 'A runner with a slow pulse and a long pause.'),
  q('A2', 'Alpha', 2, 'The QT interval lengthens after a new antiarrhythmic is started.'),
  q('B1', 'Beta', 1, 'A smoker with exertional chest pain.'),
  q('B2', 'Beta', 2, 'Troponin rises two hours after the onset.'),
  q('B3', 'Beta', 3, 'A pregnant woman with new dyspnoea.', { bad: false }),
  q('X1', 'Beta', 9, 'A quarantined item.', { bad: true }),
  q('ch1:5', 'Alpha', 5, 'An id with a colon in it.'),
].forEach(x => { bank[x.id] = x; });

const nid = ms => 'n' + ms.toString(36);
const T1 = Date.parse('2026-09-01T10:00:00Z'), T2 = Date.parse('2026-10-01T10:00:00Z'), T3 = Date.parse('2026-10-05T10:00:00Z');
const stroke = [{ x: 1, y: 2 }];
const sticky = (text, ms) => ({ id: ms ? nid(ms) : 'abc', x: .1, y: .1, text, color: '' });

head('clean: ids kept once, in order, and nothing else');
{
  ok('ids come back in the order saved, each once', same(F.clean(['b', 'a', 'b', 'c', 'a']), ['b', 'a', 'c']));
  ok('a number, null, an object, an empty string and a nested list are dropped, and the ids beside them kept',
    safely(() => same(F.clean(['a', 5, null, '', {}, ['x'], undefined, true, 'b']), ['a', 'b']), false));
  ok('whatever is not a list is no list', safely(() => [null, undefined, 'abc', 7, { 0: 'a', length: 1 }, true].every(v => same(F.clean(v), [])), false));
  ok('an id of 100 characters is kept and one of 101 is not', same(F.clean(['x'.repeat(100), 'y'.repeat(101)]), ['x'.repeat(100)]));
  const many = Array.from({ length: 6000 }, (_, k) => 'id' + k);
  const cut = F.clean(many);
  ok('a list longer than the cap is cut at the cap, from the front', cut.length === F.MAX_FLAGS && cut[0] === 'id0' && cut[F.MAX_FLAGS - 1] === 'id' + (F.MAX_FLAGS - 1), String(cut.length));
  ok('"__proto__" and "constructor" are ids like any other, and each once', same(F.clean(['__proto__', 'constructor', '__proto__']), ['__proto__', 'constructor']));
  const input = ['a', 'a', 3];
  F.clean(input);
  ok('the list it was given is left as it was', same(input, ['a', 'a', 3]));
}

head('valid: a backup\'s list is sound only if it is nothing but ids');
{
  ok('absent, null and empty are sound', F.valid(undefined) && F.valid(null) && F.valid([]));
  ok('ids are sound, and the same id twice is sound', F.valid(['a', 'b']) && F.valid(['a', 'a']));
  ok('a list with a number, null, an empty string, an object or a nested list in it is not sound', safely(() => [['a', 5], [null], [''], [{}], [['a']], ['a', undefined]].every(v => F.valid(v) === false), false));
  ok('what is not a list is not sound', safely(() => ['abc', 7, {}, true, { length: 0 }].every(v => F.valid(v) === false), false));
  ok('an id of 101 characters is not sound and one of 100 is', F.valid(['x'.repeat(101)]) === false && F.valid(['x'.repeat(100)]) === true);
  ok('a list of the cap is sound and one more is not', F.valid(Array.from({ length: F.MAX_FLAGS }, (_, k) => 'i' + k)) === true && F.valid(Array.from({ length: F.MAX_FLAGS + 1 }, (_, k) => 'i' + k)) === false);
  ok('what valid() accepts, clean() keeps whole', (() => { const l = ['p', 'q', 'r']; return F.valid(l) && same(F.clean(l), l); })());
}

head('toggle: on, off, and which it is now');
{
  const s = new Set();
  ok('flagging says it is flagged now, and the id is in the set', F.toggle(s, 'A1') === true && s.has('A1') && s.size === 1);
  ok('the same call again takes it off, says so, and leaves the set empty', F.toggle(s, 'A1') === false && !s.has('A1') && s.size === 0);
  F.toggle(s, 'A1'); F.toggle(s, 'A2'); F.toggle(s, 'B1');
  ok('the set holds them in the order they were flagged', same([...s], ['A1', 'A2', 'B1']));
  F.toggle(s, 'A1'); F.toggle(s, 'A1');
  ok('taking a flag off and putting it back puts it last', same([...s], ['A2', 'B1', 'A1']));
  const t = new Set(['A1']);
  ok('what is not an id changes nothing and says not flagged', safely(() => [5, null, undefined, '', {}, 'x'.repeat(101)].every(v => F.toggle(t, v) === false) && same([...t], ['A1']), false));
}

head('addAll: adds, never removes, and counts the new');
{
  const s = new Set(['A1']);
  ok('three ids of which one is there add two', F.addAll(s, ['A1', 'A2', 'B1']) === 2 && same([...s], ['A1', 'A2', 'B1']));
  ok('ids all there add none and take none away', F.addAll(s, ['A2']) === 0 && same([...s], ['A1', 'A2', 'B1']));
  ok('the same new id twice in one call counts once', F.addAll(s, ['C1', 'C1']) === 1 && s.has('C1'));
  const before = [...s];
  ok('not a list, or a list of not-ids, adds nothing', safely(() => [null, undefined, 'abc', 7, {}, [5, null, '', {}]].every(v => F.addAll(s, v) === 0) && same([...s], before), false));
}

head('deck: the flagged questions the bank has, in the order flagged');
{
  const s = new Set(['B2', 'A1', 'ZZ', 'X1', 'A2']);
  const d = F.deck(s, bank);
  ok('the questions in the order flagged', same(ids(d), ['B2', 'A1', 'A2']), ids(d).join());
  ok('each is the bank\'s own question, not a copy', d[0] === bank.B2 && d[1] === bank.A1);
  ok('an id the bank does not have is left out', !ids(d).includes('ZZ'));
  ok('a quarantined question is left out', !ids(d).includes('X1'));
  ok('a question marked bad: false is dealt', ids(F.deck(new Set(['B3']), bank)).join() === 'B3');
  ok('the set is left as it was', same([...s], ['B2', 'A1', 'ZZ', 'X1', 'A2']));
  const inherited = safely(() => F.deck(new Set(['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']), bank), null);
  ok('names every object answers to are ids that find no question, and do not throw', inherited !== null && inherited.length === 0);
  ok('no bank is no deck and not an error', safely(() => F.deck(s, null).length === 0 && F.deck(s, undefined).length === 0, false));
  ok('nothing flagged is no deck', F.deck(new Set(), bank).length === 0);
  const holey = Object.assign({}, bank, { N1: null });
  ok('an entry in the bank that is null is no question and does not throw', same(ids(safely(() => F.deck(new Set(['N1', 'A1']), holey), [])), ['A1']));
}

head('annotated: every question with a sticky note or a mark');
{
  const notes = {
    A1: [sticky('  Class I   for\n sotalol?  ', T1)],
    B1: [sticky('', T2)],
    B3: [sticky(' second ', T3), sticky('', T2), sticky('first', T2)],
    ZZ: [sticky('a note on a question the bank lost', T3)],
    X1: [sticky('a note on a quarantined one', T3)],
    B2: [],
  };
  const ink = { 'A2:q': [stroke], 'A2:f0': [stroke, stroke], 'A1:q': [stroke], 'B2:e': [], 'ZZ:q': [stroke], 'X1:q': [stroke], 'ch1:5:q': [stroke] };
  const snapshot = JSON.stringify([notes, ink, bank]);
  const rows = F.annotated(notes, ink, bank);
  const by = id => rows.find(r => r.id === id);
  ok('the questions with a note or ink, and no others', same(rows.map(r => r.id).sort(), ['A1', 'A2', 'B1', 'B3', 'ch1:5']), ids(rows).join());
  ok('newest note first, then the ones with no note, by chapter and number', same(ids(rows), ['B3', 'B1', 'A1', 'A2', 'ch1:5']), ids(rows).join());
  ok('a question with a note and ink is one row with both', by('A1') && by('A1').notes === 1 && by('A1').ink === true);
  ok('a sticky note\'s text is one line: spaces and breaks collapsed, ends trimmed', by('A1').text === 'Class I for sotalol?', JSON.stringify(by('A1').text));
  ok('an empty sticky note still makes the question annotated, with nothing to say', by('B1') && by('B1').notes === 1 && by('B1').text === '' && by('B1').ink === false);
  ok('three stickies on one question, one of them empty: all counted, the empty one says nothing, the rest joined in order, dated by the newest', by('B3').notes === 3 && by('B3').text === 'second · first' && by('B3').at === T3, JSON.stringify([by('B3').notes, by('B3').text, by('B3').at]));
  ok('a mark with no note gives a row with no text and no date', by('A2') && by('A2').notes === 0 && by('A2').text === '' && by('A2').ink === true && by('A2').at === 0);
  ok('two ink slots on one question are one row', rows.filter(r => r.id === 'A2').length === 1);
  ok('a slot with no strokes is no mark', !by('B2'));
  ok('an empty list of notes is no note', !rows.some(r => r.id === 'B2'));
  ok('a question the bank does not have is not listed whatever is written on it', !by('ZZ'));
  ok('a quarantined question is not listed whatever is written on it', !by('X1'));
  ok('the question is the part of the key before the last colon, so an id with a colon in it is found', by('ch1:5') && by('ch1:5').ink === true && by('ch1:5').q === bank['ch1:5']);
  ok('each row carries the bank\'s own question', rows.every(r => r.q === bank[r.id]));
  ok('what it searches in is lower case and holds the note, the chapter and the stem', by('A1').hay.includes('sotalol') && by('A1').hay.includes('alpha') && by('A1').hay.includes('runner') && by('A1').hay === by('A1').hay.toLowerCase());
  ok('the notes, the ink and the bank are left as they were', JSON.stringify([notes, ink, bank]) === snapshot);
}

head('annotated: what is a mark, the order, and data that is not what the app writes');
{
  ok('a key with no colon marks nothing, not even the question its first characters name', same(F.annotated({}, { A12: [stroke], B1: [stroke] }, bank), []));
  ok('a key with nothing before its colon marks nothing', same(F.annotated({}, { ':q': [stroke] }, bank), []));
  ok('a slot that is null marks nothing', same(F.annotated({}, { 'B1:q': null, 'B2:q': undefined }, bank), []));
  ok('a slot with strokes marks its question', same(ids(F.annotated({}, { 'B1:q': [stroke] }, bank)), ['B1']));

  const newer = F.annotated({ A1: [sticky('x', T1)], B1: [sticky('y', T2)] }, {}, bank);
  ok('a newer note comes first even in a later chapter', same(ids(newer), ['B1', 'A1']), ids(newer).join());
  const tied = F.annotated({ B1: [sticky('z', T1)], A2: [sticky('y', T1)], A1: [sticky('x', T1)] }, {}, bank);
  ok('notes of the same time: by chapter, then by number', same(ids(tied), ['A1', 'A2', 'B1']), ids(tied).join());
  const undated = F.annotated({ A1: [sticky('x', 0)], B1: [sticky('y', T1)] }, {}, bank);
  ok('a note with no time comes after one with a time, though its chapter is first', same(ids(undated), ['B1', 'A1']), ids(undated).join());
  const marks = F.annotated({}, { 'B2:q': [stroke], 'A2:q': [stroke], 'A1:q': [stroke], 'B1:q': [stroke] }, bank);
  ok('marks only: by chapter in name order, then by number', same(ids(marks), ['A1', 'A2', 'B1', 'B2']), ids(marks).join());
  const mixed = F.annotated({ B1: [sticky('y', T1)] }, { 'A1:q': [stroke] }, bank);
  ok('a mark with no note comes after a note with a time', same(ids(mixed), ['B1', 'A1']), ids(mixed).join());
  ok('a sticky\'s id that is not the shape the app writes, or too long to read as a time, has no date',
    F.annotated({ A1: [{ id: 'abc', text: 'a' }], A2: [{ id: 'n' + 'z'.repeat(11), text: 'b' }], B1: [{ text: 'c' }], B2: [{ id: 'xn1', text: 'd' }], B3: [{ id: 'n', text: 'e' }] }, {}, bank).every(r => r.at === 0));
  ok('a sticky\'s id that is the shape the app writes is read as its time', F.annotated({ A1: [{ id: 'n1', text: 'a' }] }, {}, bank)[0].at === 1);

  const odd = JSON.parse('{"__proto__": [{"text":"p"}], "constructor": [{"text":"c"}], "toString": [{"text":"t"}], "A1": [{"text":"ok","id":"n1"}]}');
  const oddInk = JSON.parse('{"__proto__:q":[1],"constructor:q":[1],"toString:q":[1]}');
  const r1 = safely(() => F.annotated(odd, oddInk, bank), null);
  ok('keys every object answers to are questions that do not exist: no row, no throw', r1 !== null && same(ids(r1), ['A1']), r1 && ids(r1).join());
  ok('no notes, no ink or no bank is no rows and not an error', [[null, null, bank], [undefined, undefined, undefined], ['x', 5, bank], [[], [], bank], [{}, {}, null]].every(a => same(safely(() => F.annotated(a[0], a[1], a[2]), 'threw'), [])));
  const junk = safely(() => F.annotated({ A1: [null, 5, 'x', { text: 7 }, { id: 3, text: null }] }, {}, bank), []);
  ok('a list of notes made of things that are not notes still marks the question, as the badge does, and says nothing', junk.length === 1 && junk[0].notes === 5 && junk[0].text === '' && junk[0].at === 0, JSON.stringify(junk.map(r => [r.notes, r.text, r.at])));
}

head('find: every word typed, anywhere in the word, in any case');
{
  const notes = {
    A1: [sticky('Class I for sotalol?', T1)],
    A2: [sticky('Avoid β-blockers in cocaine chest pain', T2)],
    B1: [sticky('Door to balloon, ninety minutes', T3)],
  };
  const rows = F.annotated(notes, { 'B2:q': [stroke] }, bank);
  const got = query => ids(F.find(rows, query));
  ok('the rows to search are in the order the list gives', same(ids(rows), ['B1', 'A2', 'A1', 'B2']), ids(rows).join());
  ok('nothing typed is every row, in the same order, as a copy', same(got(''), ids(rows)) && F.find(rows, '') !== rows);
  ok('spaces, null and undefined are nothing typed', same(got('   '), ids(rows)) && same(got(null), ids(rows)) && same(got(undefined), ids(rows)));
  ok('a word in a note finds that question and no other', same(got('sotalol'), ['A1']), got('sotalol').join());
  ok('a word in no note, no chapter and no stem finds none', got('warfarin').length === 0);
  ok('case does not matter', same(got('SOTALOL'), ['A1']) && same(got('sOtAlOl'), ['A1']));
  ok('part of a word is enough', same(got('sotal'), ['A1']) && same(got('ballo'), ['B1']));
  ok('every word has to be there, not any', same(got('class sotalol'), ['A1']) && got('class balloon').length === 0, got('class sotalol').join() + ' / ' + got('class balloon').join());
  ok('the chapter\'s name is searched', same(got('beta'), ['B1', 'B2']) && same(got('alpha'), ['A2', 'A1']), got('beta').join() + ' / ' + got('alpha').join());
  ok('the stem is searched', same(got('troponin'), ['B2']) && same(got('lengthens'), ['A2']), got('troponin').join() + ' / ' + got('lengthens').join());
  ok('a letter outside a-z is a letter: β finds the note that has it, in either case', same(got('β'), ['A2']) && same(got('Β-BLOCKERS'), ['A2']) && same(got('blockers'), ['A2']), got('β').join());
  ok('punctuation between words does not matter', same(got('door, to - balloon'), ['B1']) && same(got('class...i'), ['A1']));
  ok('only punctuation is nothing typed', same(got('?!'), ids(rows)));
  ok('rows come back in the order given', same(got('a'), ids(rows)), got('a').join());
  ok('rows that are not rows, and a list that is not a list, give nothing and do not throw', safely(() => F.find(null, 'a').length === 0 && F.find('abc', 'a').length === 0 && F.find([null, 5, {}, { hay: 3 }], 'a').length === 0, false));
}

head('words: what was typed, as the words to look for');
{
  ok('letters and digits, lower-cased, split on anything else', same(F.words(' Hello, World-42! '), ['hello', 'world', '42']));
  ok('punctuation alone, nothing and what is not text are no words', same(F.words('?!'), []) && same(F.words(''), []) && same(F.words(null), []) && same(F.words(undefined), []));
  ok('a letter outside a-z is a letter, in either case', same(F.words('Β-blockers'), ['β', 'blockers']));
}

head('phrase and said: what is read out');
{
  ok('phrase: none, one, many', F.phrase(0) === 'Nothing flagged' && F.phrase(1) === '1 question flagged' && F.phrase(2) === '2 questions flagged' && F.phrase(41) === '41 questions flagged');
  ok('phrase: a count that is not a count is none', [-1, NaN, '3', 1.5, null, undefined, Infinity].every(v => F.phrase(v) === 'Nothing flagged'));
  ok('said: flagged, with where that leaves the list', F.said(true, 1) === 'Flagged. 1 question is in your Flagged list.' && F.said(true, 3) === 'Flagged. 3 questions are in your Flagged list.');
  ok('said: removed, with where that leaves the list', F.said(false, 0) === 'Flag removed. Your Flagged list is empty.' && F.said(false, 1) === 'Flag removed. 1 question is in your Flagged list.' && F.said(false, 2) === 'Flag removed. 2 questions are in your Flagged list.');
  ok('said: a count that is not a count is an empty list', F.said(true, NaN) === 'Flagged. Your Flagged list is empty.');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
