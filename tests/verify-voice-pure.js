#!/usr/bin/env node
/*
 * Voice mode: what is said, how it is understood, and what happens next.
 *
 *   node tests/verify-voice-pure.js
 *
 * Pure Node (src/core/voicemode.js). The speaker and microphone are the device's;
 * these checks hold the parts that are not:
 *
 *   - what is read out is clean and in order, with each option under its letter;
 *   - a spoken answer is understood the way speech recognition actually delivers it
 *     ("see" for C, "dee" for D, "a" the article) and a doubtful one is asked
 *     again, never guessed, because a guess is scored as a wrong answer;
 *   - the conversation moves question to question, records what was answered,
 *     gives up politely on silence, and ends with a summary.
 */
'use strict';
const V = require('../src/core/voicemode.js').VoiceMode;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const Q = (id, ci, ex) => ({ id, ci, s: `Synthetic stem ${id}. An invented patient has an invented finding. What is the next step?`,
  o: ['one', 'two', 'three', 'four', 'five'].map(w => ({ t: `Synthetic option ${w}` })), ex: ex === undefined ? 'Because of the invented reason. A second invented sentence. A third one.' : ex });

head('what is read out');
{
  const sp = V.speakable(Q('X_1', 2));
  ok('the stem is read first, sentence by sentence', sp.parts[0].startsWith('Synthetic stem X_1') && sp.parts.length === 3 + 5, sp.parts.slice(0, 3).join(' | '));
  ok('then every option under its letter', sp.parts.slice(-5).map((p, i) => p.startsWith(`Option ${'ABCDE'[i]}. `)).every(Boolean) && sp.optionCount === 5, sp.parts.slice(-5).join(' | '));
  const dirty = V.speakable({ s: '<p>A <b>bold</b> stem &amp; more.</p>', o: [{ t: '<i>Aspirin</i>' }, { t: '' }] });
  ok('markup is removed and entities spoken as words', dirty.parts[0] === 'A bold stem and more.' && dirty.parts[1] === 'Option A. Aspirin.', JSON.stringify(dirty.parts));
  ok('a question with nothing in it does not throw', V.speakable(null).parts.length === 0 && V.speakable({}).optionCount === 0);
}

head('a spoken answer is understood as speech recognition delivers it');
{
  const ans = (t, i, n) => { const r = V.parseAnswer(t, n || 5); return r.type === 'answer' && r.index === i; };
  const table = [['b', 1], ['B.', 1], ['bee', 1], ['see', 2], ['sea', 2], ['dee', 3], ['option c', 2], ['letter d', 3], ['the answer is a', 0], ['I will go with dee', 3],
                 ['c is my answer', 2], ['option e', 4], ['number three', 2], ['four', 3], ['Option B please', 1]];
  const wrong = table.filter(([t, i]) => !ans(t, i));
  ok('letters, their homophones and phrases around them', wrong.length === 0, wrong.map(w => w[0]).join(' | ') || `${table.length} phrases`);
  const notLetters = ['it is a heart failure', 'let me see', 'um', 'I think it could be the second one maybe', 'to be honest'];
  const taken = notLetters.filter(t => V.parseAnswer(t, 5).type === 'answer');
  ok('ordinary words that are also letters are not taken as answers', taken.length === 0, taken.join(' | ') || `${notLetters.length} phrases`);
  const amb = ['both a and b', 'either c or d', 'a or b', 'between b and c'].filter(t => V.parseAnswer(t, 5).reason !== 'ambiguous');
  ok('two choices named is ambiguous, not the second', amb.length === 0, amb.join(' | ') || 'all ambiguous');
  ok('a letter beyond the options is refused', V.parseAnswer('option e', 4).reason === 'out-of-range' && V.parseAnswer('six', 5).type === 'unclear');
  ok('silence is silence', V.parseAnswer('', 5).reason === 'silence' && V.parseAnswer(null, 5).reason === 'silence' && V.parseAnswer('   ', 5).reason === 'silence');
  const cmd = (t, c) => { const r = V.parseAnswer(t, 5); return r.type === 'command' && r.command === c; };
  ok('commands are understood', cmd('repeat that', 'repeat') && cmd('say again', 'repeat') && cmd('skip', 'skip') && cmd('I do not know', 'skip') && cmd('stop', 'stop') && cmd('explain', 'explain') && cmd('next', 'next') && cmd('end session', 'stop'));
  ok('and a letter inside a command phrase is not mistaken for an answer', cmd('stop the session', 'stop') && cmd('please repeat the question', 'repeat'));
  const junk = [undefined, 5, {}, [], 'x'.repeat(5000)].filter(t => { try { V.parseAnswer(t, 5); return false; } catch (_) { return true; } });
  ok('anything at all can be parsed without throwing', junk.length === 0);
}

head('the conversation');
{
  const qs = [Q('S_1', 1), Q('S_2', 3), Q('S_3', 0, '')];
  let st = V.init(3), fx;
  const go = (ev, i) => { const r = V.step(st, ev, { q: qs[i === undefined ? st.i : i] }); st = r.state; fx = r.effects; return r; };
  go({ type: 'start' });
  ok('it begins by asking the first question', fx.length === 1 && fx[0].type === 'ask' && fx[0].i === 0);
  go({ type: 'questionRead' });
  ok('when the question has been read it listens', st.phase === 'listening' && fx[0].type === 'listen');
  go({ type: 'heard', transcript: 'bee' });
  ok('a right answer is recorded as right, with the explanation spoken', st.phase === 'feedback' && st.correct === 1 && fx[0].type === 'record' && fx[0].correct === true && /^Correct\. Because of the invented reason\./.test(fx[1].text), fx[1].text);
  ok('the explanation is trimmed to two sentences', !/third/.test(fx[1].text));
  go({ type: 'feedbackRead' });
  ok('then it asks the next', st.phase === 'asking' && st.i === 1 && fx[0].type === 'ask' && fx[0].i === 1);
  go({ type: 'questionRead' });
  go({ type: 'heard', transcript: 'it is a heart failure' });
  ok('an unclear reply is asked again, not scored', st.phase === 'listening' && st.answered === 1 && /I did not catch that\. Say a letter from A to E/.test((fx[0] || {}).text || ''), (fx[0] || {}).text);
  go({ type: 'heard', transcript: 'both a and b' });
  ok('an ambiguous reply says so', /more than one letter/.test((fx[0] || {}).text || '') && st.tries === 2);
  go({ type: 'heard', transcript: 'a' });
  ok('a wrong answer says what was right', st.phase === 'feedback' && st.correct === 1 && /^Not quite\. The answer is D\. Synthetic option four\./.test(fx[1].text), fx[1].text);
  go({ type: 'feedbackRead' });
  go({ type: 'questionRead' });
  go({ type: 'silence' }); go({ type: 'silence' });
  ok('after two silences it asks again and is still on the same question', st.phase === 'listening' && st.i === 2 && st.tries === 2 && fx[0].type === 'speak' && fx[1].type === 'listen', `tries ${st.tries}`);
  go({ type: 'silence' });
  ok('three silences end that question', st.phase === 'done' && st.skipped === 1 && st.answered === 2);
  const done = fx.find(f => f.type === 'done');
  ok('the session ends with a summary of what was answered and skipped', done && done.summary === 'Finished. 1 of 2 correct, 1 skipped.', done && done.summary);
  ok('and does nothing after it is over', V.step(st, { type: 'heard', transcript: 'a' }, { q: qs[0] }).effects.length === 0);

  /* commands */
  st = V.init(2); go({ type: 'start' }); go({ type: 'questionRead' }, 0);
  go({ type: 'heard', transcript: 'repeat that' }, 0);
  ok('"repeat" asks the same question again', st.phase === 'asking' && st.i === 0 && fx[0].type === 'ask' && fx[0].i === 0);
  go({ type: 'questionRead' }, 0);
  go({ type: 'heard', transcript: 'explain' }, 0);
  ok('"explain" reads the explanation and keeps listening', st.phase === 'listening' && fx[0].type === 'speak' && fx[1].type === 'listen');
  go({ type: 'heard', transcript: 'skip' }, 0);
  ok('"skip" moves on without scoring', st.i === 1 && st.answered === 0 && st.skipped === 1 && fx.some(f => f.type === 'ask' && f.i === 1));
  go({ type: 'questionRead' }, 1); go({ type: 'heard', transcript: 'stop' }, 1);
  ok('"stop" ends the session', st.phase === 'done' && fx.some(f => f.type === 'done'));
  ok('an empty session is already finished', V.init(0).phase === 'done');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
