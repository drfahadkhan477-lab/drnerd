#!/usr/bin/env node
/*
 * What Apex sends the model and what it reads back — src/core/apexwire.js.
 *
 *   node tests/verify-apexwire-pure.js
 *
 * Pure Node, no browser, no build and no network. The module is shape and nothing else: which messages of
 * a thread ride on a request, where the request goes and what it carries, how a thread becomes Gemini's
 * contents, what a streamed reply means part by part, and how a tool's answer goes back. Every thread,
 * request and stream here is invented, and every expected value is written out, not read back.
 *
 * What is measured, rather than assumed:
 *   - the window: failed turns never ride, a long thread is cut to its last SEND messages, the cut opens
 *     on a user turn and says once that earlier messages are missing, and the thread itself is not changed;
 *   - what is kept: a thread over KEEP is cut in place, on a user turn, to whole exchanges;
 *   - where a request goes: Google's address with a key, this site's relay without, the page token inside
 *     the query either way, and no key header at all on a hosted request;
 *   - request building: a thread as Gemini's contents (roles, text, images, a tool exchange left as it is),
 *     the tool list as function declarations, and the body as the exact text that is sent, key for key;
 *   - response parsing: the stream read a chunk at a time whatever the chunk boundaries, each part kept as
 *     it arrived with its signature, a signature that arrives alone given to the part before it, the reason
 *     the model stopped, an error in the stream thrown in the provider's words, and the page told of words
 *     and of a call at the moments it was told before;
 *   - the tool exchange: the model's own parts back, a first call with no signature given Google's
 *     opt-out token, one functionResponse per result;
 *   - the page's functions are the calls into this, and the page keeps no second copy of the shapes.
 *
 * The browser half is tests/verify-gemini.js, verify-chat.js and verify-flushguard.js, which read the
 * requests the built page really makes.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');
const W = require('../src/core/apexwire.js').ApexWire;
const G = W.gemini;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);
const same = (a, b) => J(a) === J(b);
/* A module that throws says FAIL where it was asked, and the run goes on. */
const safely = fn => { try { return fn(); } catch (e) { return 'THREW: ' + e.message; } };
const clone = v => JSON.parse(JSON.stringify(v));

/* A thread of n messages, user and assistant in turn, starting with a user turn. */
const thread = n => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'm' + i }));
const NOTE = '[Earlier messages in this thread are not included — it is longer than one request carries. Ask me to recap if you need something from before this.]\n\n';

head('the window: which messages ride on a request');
{
  ok('the window is 16 messages and a thread keeps 60', W.SEND === 16 && W.KEEP === 60, `${W.SEND} and ${W.KEEP}`);
  const short = [{ role: 'user', content: 'a', extra: 1 }, { role: 'assistant', content: 'b', reused: true, incomplete: true }];
  ok('a short thread rides whole, as role and content and nothing else', same(safely(() => W.wire(short)), [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]), J(safely(() => W.wire(short))));
  const withErr = [{ role: 'user', content: 'a' }, { role: 'assistant', err: true, content: 'Request failed.' }, { role: 'user', content: 'b' }];
  ok('a failed turn is never sent back', same(safely(() => W.wire(withErr)), [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }]), J(safely(() => W.wire(withErr))));
  ok('a thread of exactly 16 is not cut, and carries no note', same(safely(() => W.wire(thread(16))), thread(16)));
  const long = thread(40), before = J(long);
  const w = safely(() => W.wire(long));
  ok('a longer thread is cut to its last 16', Array.isArray(w) && w.length === 16 && w[15].content === 'm39', Array.isArray(w) ? `${w.length} messages, last ${w[w.length - 1].content}` : w);
  /* Every length, not one: a thread of 40 is cut at a user turn whether or not anything looks for one. */
  const opens = Array.from({ length: 44 }, (_, i) => 17 + i).filter(n => { const x = safely(() => W.wire(thread(n))); return !(Array.isArray(x) && x[0].role === 'user'); });
  ok('the cut opens on a user turn, for every length of thread from 17 to 60', opens.length === 0, opens.length ? 'opens on a reply at ' + opens.slice(0, 6).join(', ') : '');
  ok('and says once, inside that turn, that earlier messages are missing', Array.isArray(w) && w[0].content === NOTE + 'm24' && w.slice(1).every(m => !m.content.includes('Earlier messages')), Array.isArray(w) ? w[0].content.slice(0, 50) : '');
  ok('the thread itself is not changed by being windowed', J(long) === before);
  /* 41 messages: the last 16 start at m25, an assistant turn. Two assistant turns in a row is an HTTP 400. */
  const odd = safely(() => W.wire(thread(41)));
  ok('a window that would open on a reply opens one later, on the user turn', Array.isArray(odd) && odd.length === 15 && odd[0].role === 'user' && odd[0].content === NOTE + 'm26', Array.isArray(odd) ? `${odd.length}, opens ${odd[0].role} ${odd[0].content.slice(-3)}` : odd);
  /* Forty messages, four failed replies among the last sixteen (m25, m29, m33, m37). Dropped first, the last
     sixteen that remain run from m20; counted first, the window would hold twelve. */
  const failed = thread(40).map((m, i) => ([25, 29, 33, 37].includes(i) ? Object.assign({ err: true }, m) : m));
  const fw = safely(() => W.wire(failed));
  ok('failed turns are dropped before the window is counted, so they take no place in it',
     Array.isArray(fw) && same(fw.map(m => m.content.replace(NOTE, '')), ['m20', 'm21', 'm22', 'm23', 'm24', 'm26', 'm27', 'm28', 'm30', 'm31', 'm32', 'm34', 'm35', 'm36', 'm38', 'm39']),
     Array.isArray(fw) ? `${fw.length} messages from ${fw[0].content.replace(NOTE, '')}` : fw);
  const noUser = Array.from({ length: 30 }, (_, i) => ({ role: i < 5 ? 'user' : 'assistant', content: 'm' + i }));
  ok('with no user turn in reach it sends the last message alone, rather than nothing', same(safely(() => W.wire(noUser)), [{ role: 'assistant', content: 'm29' }]), J(safely(() => W.wire(noUser))));
  ok('no thread is an empty window', same(safely(() => W.wire(null)), []) && same(safely(() => W.wire(undefined)), []) && same(safely(() => W.wire([])), []));
}

head('what is kept: a thread cut in place');
{
  const t60 = thread(60);
  ok('a thread of 60 is kept whole, and is the same list', safely(() => W.trim(t60)) === t60 && t60.length === 60);
  const t100 = thread(100);
  const out = safely(() => W.trim(t100));
  ok('a longer one is cut in place to its last 60', out === t100 && t100.length === 60 && t100[59].content === 'm99', `${t100.length} left`);
  ok('and what is kept opens on a user turn, so it is whole exchanges', t100[0].role === 'user' && t100[0].content === 'm40');
  const t101 = thread(101); safely(() => W.trim(t101));
  ok('a cut that would open on a reply opens one later', t101[0].role === 'user' && t101[0].content === 'm42' && t101.length === 59, `${t101.length} left, opens ${t101[0].content}`);
  const replies = Array.from({ length: 90 }, (_, i) => ({ role: i < 3 ? 'user' : 'assistant', content: 'm' + i }));
  ok('with no user turn to open on, nothing is cut', safely(() => W.trim(replies)) === replies && replies.length === 90);
  ok('no thread is handed back as it came', safely(() => W.trim(null)) === null && safely(() => W.trim(undefined)) === undefined);
  ok('the note about earlier messages is never written into what is kept', t100.every(m => !String(m.content).includes('Earlier messages')));
}

head('where a request goes, and what it carries');
{
  const BASE = 'https://provider.example/v1beta/models', RELAY = '/api/apex/gemini';
  const url = (...a) => safely(() => G.url(BASE, RELAY, ...a));
  ok('with a key, a streamed turn goes to Google\'s model address', url('stream', 'gemini-9-flash', 'KEY') === BASE + '/gemini-9-flash:streamGenerateContent?alt=sse', url('stream', 'gemini-9-flash', 'KEY'));
  ok('and one that is not streamed to generateContent', url('generate', 'gemini-9-flash', 'KEY') === BASE + '/gemini-9-flash:generateContent', url('generate', 'gemini-9-flash', 'KEY'));
  ok('and the model list to the models address, 200 a page', url('models', '', 'KEY') === BASE + '?pageSize=200', url('models', '', 'KEY'));
  ok('the key is never in the address', !url('stream', 'm', 'SECRETKEY').includes('SECRETKEY') && !url('models', '', 'SECRETKEY').includes('SECRETKEY'));
  ok('without a key, a streamed turn goes to this site\'s relay, the model in the query', url('stream', 'gemini-9-flash', '') === RELAY + '/stream?model=gemini-9-flash', url('stream', 'gemini-9-flash', ''));
  ok('and the others likewise', url('generate', 'm', '') === RELAY + '/generate?model=m' && url('models', '', '') === RELAY + '/models?pageSize=200');
  ok('a model\'s name is encoded into the relay\'s query', url('stream', 'a b&c=d', '') === RELAY + '/stream?model=a%20b%26c%3Dd', url('stream', 'a b&c=d', ''));
  ok('and no model is an empty one, not the word undefined', url('generate', undefined, '') === RELAY + '/generate?model=');
  /* The bug this function's own comment records: '&pageToken=' appended to a URL with no query. */
  ok('a page token rides inside the query, at Google', url('models', '', 'KEY', 'tok/1&x') === BASE + '?pageSize=200&pageToken=tok%2F1%26x', url('models', '', 'KEY', 'tok/1&x'));
  ok('and at the relay, where it once started no query at all', url('models', '', '', 'tok/1&x') === RELAY + '/models?pageSize=200&pageToken=tok%2F1%26x', url('models', '', '', 'tok/1&x'));
  ok('the addresses are the ones it is given, not ones it knows', safely(() => G.url('https://other.example/m', '/elsewhere', 'stream', 'x', 'K')) === 'https://other.example/m/x:streamGenerateContent?alt=sse' && safely(() => G.url('https://other.example/m', '/elsewhere', 'stream', 'x', '')) === '/elsewhere/stream?model=x');
  ok('a post with a key carries the key and its content type', same(safely(() => G.headers('KEY', true)), { 'content-type': 'application/json', 'x-goog-api-key': 'KEY' }), J(safely(() => G.headers('KEY', true))));
  ok('a hosted request carries no key header at all, not an empty one', same(safely(() => G.headers('', true)), { 'content-type': 'application/json' }) && !('x-goog-api-key' in Object(safely(() => G.headers('', true)))));
  ok('a request that is not a post names no content type', same(safely(() => G.headers('KEY', false)), { 'x-goog-api-key': 'KEY' }) && same(safely(() => G.headers('', false)), {}));
}

head('request building: a thread as Gemini\'s contents, the tools as declarations');
{
  ok('words are one text part', same(safely(() => G.parts('hello')), [{ text: 'hello' }]));
  ok('nothing is an empty text part, never the word null', same(safely(() => G.parts(null)), [{ text: '' }]) && same(safely(() => G.parts(undefined)), [{ text: '' }]) && same(safely(() => G.parts('')), [{ text: '' }]));
  const blocks = [{ type: 'text', text: 'see this' }, { type: 'image', source: { media_type: 'image/webp', data: 'QUJD' } }, { type: 'text' }];
  ok('a figure block is inlineData, with its type and its bytes; a text block its text', same(safely(() => G.parts(blocks)), [{ text: 'see this' }, { inlineData: { mimeType: 'image/webp', data: 'QUJD' } }, { text: '' }]), J(safely(() => G.parts(blocks))));
  ok('anything else is written out as words', same(safely(() => G.parts(42)), [{ text: '42' }]));
  const exchange = { role: 'model', parts: [{ functionCall: { name: 'f' }, thoughtSignature: 'S' }] };
  const c = safely(() => G.contents([{ role: 'user', content: 'ask' }, { role: 'assistant', content: 'answer' }, exchange, { role: 'user', content: blocks }]));
  ok('a user turn is user, a reply is model', Array.isArray(c) && c[0].role === 'user' && c[1].role === 'model' && same(c[1].parts, [{ text: 'answer' }]), Array.isArray(c) ? c.map(x => x.role).join(',') : c);
  ok('a turn already in Gemini\'s shape rides through untouched, its parts the same list', Array.isArray(c) && c[2].role === 'model' && c[2].parts === exchange.parts);
  ok('and carries nothing but a role and parts', Array.isArray(c) && c.every(x => same(Object.keys(x), ['role', 'parts'])));
  let reads = 0;
  const tools = [{ name: 'search', get description() { reads++; return 'described now'; }, input_schema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } }, { name: 'plain', description: 'd', input_schema: { type: 'object', properties: {}, required: [] } }];
  const decl = safely(() => G.tools(tools));
  ok('a tool is declared by name, description and parameters, the schema as it is', same(decl, [{ name: 'search', description: 'described now', parameters: tools[0].input_schema }, { name: 'plain', description: 'd', parameters: tools[1].input_schema }]), J(decl).slice(0, 120));
  ok('and its description is read when the request is built, not before', reads === 1, `${reads} reads`);
  ok('the tool list is not written on', same(Object.keys(tools[1]), ['name', 'description', 'input_schema']));
}

head('request building: the body, as the text that is sent');
{
  const contents = [{ role: 'user', parts: [{ text: 'ask' }] }];
  const tools = [{ name: 't', description: 'd', input_schema: { type: 'object' } }];
  const body = safely(() => G.request('SYSTEM WORDS', tools, contents, 2000));
  ok('the body is text, and is this text, key for key and in this order',
     body === '{"systemInstruction":{"parts":[{"text":"SYSTEM WORDS"}]},"tools":[{"functionDeclarations":[{"name":"t","description":"d","parameters":{"type":"object"}}]}],"generationConfig":{"maxOutputTokens":2000},"contents":[{"role":"user","parts":[{"text":"ask"}]}]}', String(body).slice(0, 140));
  const bare = safely(() => G.request('S', null, contents, 2000));
  ok('a turn that may use no tools carries no tools key at all', bare === '{"systemInstruction":{"parts":[{"text":"S"}]},"generationConfig":{"maxOutputTokens":2000},"contents":[{"role":"user","parts":[{"text":"ask"}]}]}', String(bare).slice(0, 140));
  ok('the ceiling on the reply is the one it is given', /"generationConfig":\{"maxOutputTokens":512\}/.test(String(safely(() => G.request('S', null, contents, 512)))));
  ok('the system words are carried whole, quotes and new lines included', safely(() => JSON.parse(G.request('a "b"\n<c>', null, contents, 1)).systemInstruction.parts[0].text) === 'a "b"\n<c>');
  const plain = safely(() => G.plain('hi', 1));
  ok('a one-message request is this text', plain === '{"generationConfig":{"maxOutputTokens":1},"contents":[{"role":"user","parts":[{"text":"hi"}]}]}', String(plain));
  ok('and carries neither tools nor a system instruction', !/tools|systemInstruction/.test(String(safely(() => G.plain('summarise', 220)))) && /"maxOutputTokens":220/.test(String(safely(() => G.plain('summarise', 220)))));
}

head('response parsing: a reply that was not streamed');
{
  ok('its words are the text parts, joined', safely(() => G.text({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }, {}] } }] })) === 'ab');
  ok('only the first candidate is read', safely(() => G.text({ candidates: [{ content: { parts: [{ text: 'first' }] } }, { content: { parts: [{ text: 'second' }] } }] })) === 'first');
  ok('a reply with no words is the empty string', [{}, { candidates: [] }, { candidates: [{}] }, { candidates: [{ content: {} }] }].every(j => safely(() => G.text(j)) === ''));
}

/* One event of Gemini's stream. */
const ev = (parts, extra) => 'data: ' + J({ candidates: [Object.assign({ content: { role: 'model', parts } }, extra || {})] }) + '\n\n';
const read = (text, on, cut) => {
  const r = G.reader(on);
  if (cut) for (let i = 0; i < text.length; i += cut) r.push(text.slice(i, i + cut)); else r.push(text);
  return r;
};

head('response parsing: the stream, part by part');
{
  const s = ev([{ text: 'Hel' }]) + ev([{ text: 'lo' }, { functionCall: { name: 'search', args: { q: 'x' } }, thoughtSignature: 'SIG1' }]) + ev([{ text: '!' }], { finishReason: 'STOP' });
  const r = safely(() => read(s));
  ok('the words are the text parts in order', r.text === 'Hello!', J(r.text));
  ok('every part is kept as it arrived, in order, a call whole', same(r.raw, [{ text: 'Hel' }, { text: 'lo' }, { functionCall: { name: 'search', args: { q: 'x' } }, thoughtSignature: 'SIG1' }, { text: '!' }]), J(r.raw));
  ok('and the reason the model stopped', r.finishReason === 'STOP');
  const signed = safely(() => read(ev([{ text: 'a', thoughtSignature: 'ST' }]) + ev([{ thoughtSignature: 'LONE' }]) + ev([{ functionCall: { name: 'f' } }]) + ev([{ thoughtSignature: 'LATE' }])));
  ok('a text part keeps the signature that came beside it', signed.raw && signed.raw[0].text === 'a' && signed.raw.length === 2);
  ok('a signature that arrives alone belongs to the part before it', signed.raw && signed.raw[0].thoughtSignature === 'LONE' && signed.raw[1].thoughtSignature === 'LATE', J(signed.raw));
  ok('a part with no signature is given none', same(safely(() => read(ev([{ text: 'a' }, { functionCall: { name: 'f' } }])).raw), [{ text: 'a' }, { functionCall: { name: 'f' } }]));
  ok('a signature with no part before it is dropped, not kept as a part', same(safely(() => read(ev([{ thoughtSignature: 'ORPHAN' }]) + ev([{ text: 'a' }])).raw), [{ text: 'a' }]));
  ok('an empty text part is no part', same(safely(() => read(ev([{ text: '' }, { text: 'a' }, {}])).raw), [{ text: 'a' }]));
  ok('the last reason given is the reason', safely(() => read(ev([{ text: 'a' }], { finishReason: 'MAX_TOKENS' }) + ev([], { finishReason: 'STOP' })).finishReason) === 'STOP'
     && safely(() => read(ev([{ text: 'a' }], { finishReason: 'MAX_TOKENS' }) + ev([{ text: 'b' }])).finishReason) === 'MAX_TOKENS');
  ok('a stream that never says why it stopped has no reason', safely(() => read(ev([{ text: 'a' }])).finishReason) === '');
  ok('a reason with no content is still read', safely(() => read('data: {"candidates":[{"finishReason":"SAFETY"}]}\n\n').finishReason) === 'SAFETY');
}

head('response parsing: what is not an event');
{
  const noise = ': keep-alive\n\nevent: ping\n\ndata:\n\ndata:    \n\ndata: {not json\n\nretry: 3000\n\ndata: {"usageMetadata":{"total":3}}\n\ndata: {"candidates":[]}\n\n'
    + J({ candidates: [{ content: { parts: [{ text: 'JSON, but not a data line' }] } }] }) + '\n\n';
  const r = safely(() => read(noise + ev([{ text: 'ok' }]) + noise));
  ok('comments, other fields, empty data, a line that is not JSON and JSON that is not a data line are skipped', r.text === 'ok' && same(r.raw, [{ text: 'ok' }]), J(r.raw));
  ok('carriage returns at the line ends are no part of the data', safely(() => read(ev([{ text: 'a' }]).replace(/\n/g, '\r\n')).text) === 'a');
  ok('a data line with no space after the colon is read', safely(() => read('data:' + J({ candidates: [{ content: { parts: [{ text: 'tight' }] } }] }) + '\n').text) === 'tight');
  const tail = safely(() => read(ev([{ text: 'a' }]) + 'data: ' + J({ candidates: [{ content: { parts: [{ text: 'unfinished' }] } }] })));
  ok('a line is read when its end has arrived: one with no newline yet is held, not read', tail.text === 'a' && tail.buf.includes('unfinished'));
  ok('and is read when the rest arrives', (() => { const x = G.reader(); return safely(() => { x.push('data: {"candidates":[{"content":{"parts":[{"te'); const mid = x.text; x.push('xt":"joined"}]}}]}\n'); return mid === '' && x.text === 'joined'; }); })());
}

head('response parsing: the chunk boundaries do not matter');
{
  const s = ev([{ text: 'Größe 中文 ' }, { text: 'two' }]) + ': note\n\n' + ev([{ functionCall: { name: 'plan_session', args: { minutes: 20 } }, thoughtSignature: 'S' }]) + ev([{ thoughtSignature: 'T' }]) + ev([{ text: ' end' }], { finishReason: 'STOP' });
  const whole = safely(() => read(s));
  const sizes = [1, 2, 3, 5, 7, 13, 64, 1000];
  const each = sizes.map(n => safely(() => read(s, null, n)));
  ok('cut every 1, 2, 3, 5, 7, 13, 64 or 1000 characters, the reply is the same reply', whole.text === 'Größe 中文 two end' && each.every(r => r.text === whole.text && same(r.raw, whole.raw) && r.finishReason === whole.finishReason),
     sizes.filter((n, i) => each[i].text !== whole.text || !same(each[i].raw, whole.raw)).join(',') || 'all eight');
  ok('and nothing is left unread at its end', each.every(r => r.buf === '') && whole.buf === '');
}

head('response parsing: an error inside the stream');
{
  const r = G.reader();
  const threw = (() => { try { r.push(ev([{ text: 'so far' }]) + 'data: {"error":{"message":"The model is overloaded."}}\n\n' + ev([{ text: ' never' }])); return null; } catch (e) { return e; } })();
  ok('is thrown, in the provider\'s words', !!threw && threw.message === 'The model is overloaded.', threw ? threw.message : 'nothing thrown');
  ok('what arrived before it is kept, and nothing after it is read', r.text === 'so far' && same(r.raw, [{ text: 'so far' }]), J(r.text));
  const bare = (() => { try { G.reader().push('data: {"error":{}}\n'); return null; } catch (e) { return e; } })();
  ok('an error with no words is still an error', !!bare && bare.message === 'stream error', bare ? bare.message : 'nothing thrown');
}

head('response parsing: when the page is told');
{
  const log = [];
  let r;
  const on = { speaking: () => log.push('speaking:' + r.text + ':' + r.raw.length), words: () => log.push('text:' + r.text + ':' + r.raw.length), tool: () => log.push('tool:' + r.raw.length) };
  r = G.reader(on);
  safely(() => r.push(ev([{ text: 'a' }]) + ev([{ text: 'b' }, { functionCall: { name: 'f' } }]) + ev([{ thoughtSignature: 'x' }]) + ev([{ text: 'c' }])));
  ok('before the first words it is told Apex is speaking, once, with nothing yet kept', log[0] === 'speaking::0' && log.filter(x => x.startsWith('speaking')).length === 1, log.join(' '));
  ok('after each text part it is told, with that part already kept', same(log.filter(x => x.startsWith('text')), ['text:a:1', 'text:ab:2', 'text:abc:4']), log.join(' '));
  ok('before a call is kept it is told a tool is being used', log.includes('tool:2') && log.indexOf('tool:2') === log.indexOf('text:ab:2') + 1, log.join(' '));
  ok('a signature alone tells it nothing', log.length === 5, `${log.length} tellings`);
  const callFirst = []; let r2;
  r2 = G.reader({ speaking: () => callFirst.push('speaking'), tool: () => callFirst.push('tool'), words: () => callFirst.push('text') });
  safely(() => r2.push(ev([{ functionCall: { name: 'f' } }]) + ev([{ text: 'after' }])));
  ok('a reply that opens with a call is not speaking until its words come', same(callFirst, ['tool', 'speaking', 'text']), callFirst.join(' '));
  ok('a reader told nothing reads all the same', safely(() => read(ev([{ text: 'a' }, { functionCall: { name: 'f' } }])).raw.length) === 2 && safely(() => { const x = G.reader({}); x.push(ev([{ text: 'a' }, { functionCall: { name: 'f' } }])); return x.text; }) === 'a');
  ok('two readers do not share what they have read', (() => { const a = G.reader(), b = G.reader(); safely(() => a.push(ev([{ text: 'a' }]))); return a.text === 'a' && b.text === '' && b.raw.length === 0 && a.raw !== b.raw; })());
}

head('response parsing: the calls among the parts');
{
  const raw = [{ text: 'a' }, { functionCall: { name: 'search', args: { q: 'x' } }, thoughtSignature: 'S' }, { text: 'b' }, { functionCall: { name: 'remember' } }];
  const calls = safely(() => G.calls(raw));
  ok('each call, in order, by name and input', Array.isArray(calls) && calls.length === 2 && calls[0].name === 'search' && same(calls[0].input, { q: 'x' }) && calls[1].name === 'remember', J(calls).replace(/call_\w+/g, 'call_…'));
  ok('a call with no arguments has an empty input, not none', Array.isArray(calls) && same(calls[1].input, {}));
  ok('each has an id of its own', Array.isArray(calls) && calls.every(c => /^call_[a-z0-9]+$/.test(c.id)) && calls[0].id !== calls[1].id, Array.isArray(calls) ? calls.map(c => c.id).join(' ') : '');
  ok('and nothing else: a call carries its id, name and input', Array.isArray(calls) && calls.every(c => same(Object.keys(c), ['id', 'name', 'input'])));
  ok('words alone are no calls', same(safely(() => G.calls([{ text: 'a' }])), []) && same(safely(() => G.calls([])), []));
  ok('the parts are not written on', same(raw[1], { functionCall: { name: 'search', args: { q: 'x' } }, thoughtSignature: 'S' }));
}

head('the tool exchange: the model\'s own parts back, and the answers');
{
  const turn = { raw: [{ text: 'Let me look.' }, { functionCall: { name: 'search', args: { q: 'x' } } }, { functionCall: { name: 'remember', args: {} } }] };
  const rawBefore = J(turn.raw);
  const wire = [{ role: 'user', content: 'ask' }];
  const results = [{ id: 'call_1', name: 'search', content: 'found' }, { id: 'call_2', name: 'remember', content: 'kept' }];
  const ret = safely(() => G.exchange(wire, turn, results));
  ok('two turns are added to the wire: the model\'s, then the answers as a user turn', wire.length === 3 && wire[1].role === 'model' && wire[2].role === 'user' && wire[0].content === 'ask', wire.map(m => m.role).join(','));
  ok('the model\'s parts go back as they came, text and all', safely(() => wire.length === 3 && wire[1].parts.length === 3 && same(wire[1].parts[0], { text: 'Let me look.' }) && same(wire[1].parts[2], { functionCall: { name: 'remember', args: {} } })) === true);
  ok('a first call with no signature is given Google\'s opt-out token', safely(() => wire.length === 3 && same(wire[1].parts[1], { functionCall: { name: 'search', args: { q: 'x' } }, thoughtSignature: 'skip_thought_signature_validator' })) === true, safely(() => J(wire[1].parts[1])));
  ok('only the first call: a second is left as it came', safely(() => wire.length === 3 && wire[1].parts.length === 3 && !('thoughtSignature' in wire[1].parts[2])) === true);
  ok('the turn itself is not written on', J(turn.raw) === rawBefore && safely(() => wire[1].parts !== turn.raw) === true);
  ok('each answer is a functionResponse by name, its content under response', safely(() => wire.length === 3 && same(wire[2].parts, [{ functionResponse: { name: 'search', response: { content: 'found' } } }, { functionResponse: { name: 'remember', response: { content: 'kept' } } }])) === true, safely(() => J(wire[2].parts)));
  ok('nothing is handed back: the wire is what changes', ret === undefined);
  const signedWire = [];
  safely(() => G.exchange(signedWire, { raw: [{ functionCall: { name: 'f' }, thoughtSignature: 'REAL' }] }, [{ name: 'f', content: 'c' }]));
  ok('a first call that has its signature keeps it', safely(() => signedWire.length === 2 && signedWire[0].parts[0].thoughtSignature === 'REAL') === true);
  const lateWire = [];
  safely(() => G.exchange(lateWire, { raw: [{ text: 't', thoughtSignature: 'ON TEXT' }, { functionCall: { name: 'f' } }] }, [{ name: 'f', content: 'c' }]));
  ok('a signature on the words before it is not the call\'s: the call still gets the token', safely(() => lateWire.length === 2 && lateWire[0].parts[0].thoughtSignature === 'ON TEXT' && lateWire[0].parts[1].thoughtSignature === 'skip_thought_signature_validator') === true);
  const none = [];
  safely(() => G.exchange(none, { raw: [{ text: 'no calls' }] }, []));
  ok('a turn with no call is given no token', safely(() => none.length === 2 && same(none[0].parts, [{ text: 'no calls' }]) && same(none[1].parts, [])) === true);
  /* What the reader keeps and what the exchange sends back are the same parts. */
  const rr = safely(() => read(ev([{ text: 'x', thoughtSignature: 'A' }, { functionCall: { name: 'f', args: { n: 1 } }, thoughtSignature: 'B' }])));
  const back = [];
  safely(() => G.exchange(back, { raw: rr.raw }, [{ name: 'f', content: 'c' }]));
  ok('a streamed turn goes back with every signature it came with', safely(() => back.length === 2 && same(back[0].parts, [{ text: 'x', thoughtSignature: 'A' }, { functionCall: { name: 'f', args: { n: 1 } }, thoughtSignature: 'B' }])) === true, safely(() => J(back[0].parts)));
  ok('and what goes back is contents Gemini reads as it is', safely(() => same(G.contents(back), [{ role: 'model', parts: back[0].parts }, { role: 'user', parts: back[1].parts }])) === true);
}

head('the page\'s functions are the calls into this');
{
  /* The module is shape; the page is what hands it the thread, the addresses, the prompt and the tools.
     Read with its comments blanked: the shell explains itself, and quotes what is looked for. */
  const page = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8'));
  const n = text => page.split(text).length - 1;
  ok('gemUrl() hands over the page\'s two addresses', n('function gemUrl(op,model,key,page){ return ApexWire.gemini.url(ENDPOINT.gemini,APEX_API,op,model,key,page); }') === 1 && n('function gemUrl(') === 1);
  ok('gemHeaders() is the module\'s', n('function gemHeaders(key,post){ return ApexWire.gemini.headers(key,post); }') === 1 && n('function gemHeaders(') === 1);
  ok('apexWire() and apexTrim() are the module\'s', n('function apexWire(hist){ return ApexWire.wire(hist); }') === 1 && n('function apexTrim(hist){ return ApexWire.trim(hist); }') === 1 && n('function apexWire(') === 1 && n('function apexTrim(') === 1);
  ok('pushToolExchange() is the module\'s', n('function pushToolExchange(wire,turn,results){ ApexWire.gemini.exchange(wire,turn,results); }') === 1 && n('function pushToolExchange(') === 1);
  ok('a turn\'s contents, its body, its stream and its calls are the module\'s',
     n('const contents=ApexWire.gemini.contents(Vision.withImages(') === 1 && n('const requestBody=ApexWire.gemini.request(') === 1 && n('explainOnly?null:TOOLS, contents, 2000);') === 1
     && n('const stream=ApexWire.gemini.reader({') === 1 && n('stream.push(dec.decode(value,{stream:true}));') === 1 && n('const calls=ApexWire.gemini.calls(raw);') === 1,
     [n('const contents=ApexWire.gemini.contents(Vision.withImages('), n('const requestBody=ApexWire.gemini.request('), n('explainOnly?null:TOOLS, contents, 2000);'), n('const stream=ApexWire.gemini.reader({'), n('stream.push(dec.decode(value,{stream:true}));'), n('const calls=ApexWire.gemini.calls(raw);')].join(' '));
  ok('the panel is told of words and of a call by the page\'s own three functions', n("speaking(){ apexSetState('speaking'); },") === 1 && n('words(){ apexPulse(); painter.schedule(); },') === 1 && n("tool(){ apexSetState('tool'); }});") === 1);
  ok('the one-message requests are built and read by the module', n("body:ApexWire.gemini.plain('hi',1)});") === 1 && n('body:ApexWire.gemini.plain(prompt,maxTokens)});') === 1 && n('return ApexWire.gemini.text(j);') === 1);
  const slot = page.indexOf('@@SLOT[src:src/core/apexwire.js]@@');
  ok('the module is written into the page once, above the first of them', slot >= 0 && page.indexOf('@@SLOT[src:src/core/apexwire.js]@@', slot + 1) < 0 && slot < page.indexOf('function gemUrl('), slot < 0 ? 'no slot' : 'slot at ' + slot);
  const kept = ['streamGenerateContent', 'functionDeclarations', 'functionResponse', 'inlineData', 'skip_thought_signature_validator', 'x-goog-api-key', '&pageToken=', 'Earlier messages in this thread', 'function toGeminiContents(', 'function geminiParts(', 'function toGeminiTools(', 'APEX_SEND', 'thoughtSignature'].filter(t => n(t) > 0);
  ok('and the page keeps no second copy of the shapes', kept.length === 0, kept.join(', ') || 'none left');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
