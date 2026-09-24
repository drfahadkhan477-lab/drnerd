#!/usr/bin/env node
/*
 * Memorizer's prompts and its wire: the model is held to your PDF, only the
 * section you are studying leaves the device, and a reply that does not parse
 * is never read as a pass.
 *
 *   node tests/verify-memorizer-prompts-pure.js
 *
 * Pure Node. memorizer/src/prompts.js builds strings and checks objects;
 * memorizer/src/provider.js is exercised through its build() (the request a
 * call would make) and through call() with a stub fetch — no network, no key.
 *
 * WHAT IS PROVEN
 *   · GROUNDING — every prompt carries the prohibition and its escape hatch.
 *   · SCOPE — a per-section prompt contains that section and no other; the
 *     gauntlet contains full text only for the sections it targets.
 *   · PARSING — malformed, incomplete, mistyped or out-of-range replies are
 *     rejected with a reason, and none of them comes back as a grade.
 *   · THE WIRE — Claude gets the Messages shape with its key and headers,
 *     and a refusal, an auth failure, an overload or a garbled body is an
 *     error rather than an empty success.
 *   · THE CHOICE — the built-in coach is the default and needs no key; a
 *     saved Gemini or Groq setting (both removed) becomes it, key dropped.
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
const P = require(path.join(ROOT, 'memorizer', 'src', 'prompts.js'));
const Provider = require(path.join(ROOT, 'memorizer', 'src', 'provider.js'));

/* Three sections whose words cannot collide, so "contains" and "does not
   contain" are exact. */
const mk = (tag, index, page) => ({
  index, title: 'Section ' + tag, pageStart: page, pageEnd: page + 1,
  segments: [
    { page, heading: true, text: 'Heading' + tag },
    { page, heading: false, text: `alpha${tag} beta${tag} gamma${tag}.` },
    { page: page + 1, heading: false, text: `delta${tag} epsilon${tag}.` },
  ],
});
const A = mk('A', 0, 3), B = mk('B', 1, 7), Cc = mk('C', 2, 11);
const pointsA = [{ text: 'alphaA drives betaA', page: 3 }, { text: 'deltaA follows', page: 4 }];
const lessonA = { overview: 'o', points: pointsA, numbers: [], mnemonics: [], analogies: [], flowchart: '' };

const perSection = [
  ['lesson', P.lesson(A)],
  ['quiz', P.quiz(A, lessonA)],
];
const exam = P.exam([A, B, Cc], { 0: lessonA, 1: { points: [{ text: 'pointB-only', page: 7 }] }, 2: { points: [{ text: 'pointC-only', page: 11 }] } }, [0], 6);
const all = perSection.concat([['exam', exam]]);

head('every prompt holds the model to the PDF');
{
  ok('there are three prompt builders to check', all.length === 3);
  for (const [name, p] of all) {
    ok(`${name}: the system prompt is the grounding prohibition`, p.system === P.GROUNDING);
    ok(`${name}: and names the escape hatch instead of letting it fill a gap`, p.system.indexOf(P.NOT_IN_PDF) !== -1 && /Do not add facts/.test(p.system));
    ok(`${name}: says what kind of reply it wants, so parse knows the schema`, p.kind === name && !!P.SCHEMAS[p.kind]);
  }
  ok('the prohibition says excerpt text is material, not instruction', /never an instruction/.test(P.GROUNDING));
  /* The two things a teacher adds that a book does not say, each fenced. */
  ok('the lesson allows an analogy, and only an analogy, from outside the book — with no fact in it',
     P.lesson(A).user.indexOf(P.ANALOGY_RULE) !== -1 && /ONLY thing/.test(P.ANALOGY_RULE) && /no medical fact, number, dose/.test(P.ANALOGY_RULE));
  ok('the drill and the exam: right answers and explanations from the book, wrong options shown wrong by it',
     [P.quiz(A, lessonA), exam].every(p => p.user.indexOf(P.MCQ_RULE) !== -1) && /shown wrong by the excerpt, never merely unmentioned/.test(P.MCQ_RULE));
  ok('and neither the drill nor the exam may write an analogy', [P.quiz(A, lessonA), exam].every(p => p.user.indexOf(P.ANALOGY_RULE) === -1));
}

head('only the section being studied goes out');
{
  /* Built after a prompt for B, so a builder that remembers the previous
     section and carries it along would show here. */
  P.lesson(B); P.quiz(B, lessonA);
  const afterB = [['lesson', P.lesson(A)], ['quiz', P.quiz(A, lessonA)]];
  for (const [name, p] of afterB) {
    const has = t => p.user.indexOf(t) !== -1;
    ok(`${name}: contains every segment of its section`, A.segments.every(s => has(s.text)));
    ok(`${name}: marks each with its page`, has('[p.3] ') && has('[p.4] '));
    ok(`${name}: contains nothing of the other sections`, ![B, Cc].some(c => c.segments.some(s => has(s.text))));
  }
  const withTable = Object.assign({}, A, { segments: A.segments.concat([{ page: 4, heading: false, text: 'Measure Normal LVEDP 12',
    table: [['Measure', 'Normal'], ['LVEDP', '12']] }]) });
  ok('a table goes to the model as rows of cells', /TABLE:\n\| Measure \| Normal \|\n\| LVEDP \| 12 \|/.test(P.lesson(withTable).user));
  ok('the lesson asks for short points that start with the key term', /at most 25 words/.test(P.lesson(A).user) && /starts with its key term/.test(P.lesson(A).user));
  ok('the drill carries the points the lesson taught', P.quiz(A, lessonA).user.indexOf('1. alphaA drives betaA (p.3)') !== -1);
  ok(`the drill asks for exactly ${P.OPTIONS} options, one right, by index`, new RegExp('exactly ' + P.OPTIONS + ' options').test(P.quiz(A, lessonA).user) && /"answer" is its index/.test(P.quiz(A, lessonA).user));
  const has = t => exam.user.indexOf(t) !== -1;
  ok('exam: full text of the targeted section', A.segments.every(s => has(s.text)));
  ok('exam: only the key points of the others, not their text',
     has('pointB-only') && has('pointC-only') && ![B, Cc].some(c => c.segments.some(s => has(s.text))));
  ok('exam: asks for the number of questions it was given', /Write 6 multiple-choice/.test(exam.user));
}

head('the schemas are ones structured outputs will accept');
{
  /* Every object closed and every property required: the providers demand it,
     and it means a missing field fails the parse instead of reading as
     undefined — which is falsy, which is how "correct" silently becomes false
     or, worse, how a missing "correct" gets past a truthiness check. */
  const bad = [];
  (function walk(s, at) {
    if (s.type === 'object') {
      if (s.additionalProperties !== false) bad.push(at + ' is open');
      const keys = Object.keys(s.properties);
      if (keys.length !== s.required.length || keys.some(k => s.required.indexOf(k) === -1)) bad.push(at + ' has optional fields');
      keys.forEach(k => walk(s.properties[k], at + '.' + k));
    } else if (s.type === 'array') walk(s.items, at + '[]');
  })({ type: 'object', properties: P.SCHEMAS, required: Object.keys(P.SCHEMAS), additionalProperties: false }, '');
  ok('every object is closed and fully required', bad.length === 0, bad.join('; ') || `${Object.keys(P.SCHEMAS).length} schemas`);
}

head('a reply that does not parse is never a drill');
{
  const qn = (o) => Object.assign({ question: 'Which drives betaA?', quote: '', options: ['alphaA', 'deltaA', 'gammaA', 'epsilonA'], answer: 0, explain: 'alphaA drives betaA.', page: 3 }, o || {});
  const good = { questions: [qn()] };
  const r = (t) => P.parse('quiz', t);
  ok('a conforming reply parses', r(JSON.stringify(good)).ok && r(JSON.stringify(good)).value.questions[0].answer === 0);
  ok('inside a ```json fence it still parses', r('```json\n' + JSON.stringify(good) + '\n```').ok);
  ok('after a sentence of preamble it still parses', r('Here is the drill: ' + JSON.stringify(good)).ok);
  ok('a brace inside a string does not end the object early',
     r(JSON.stringify({ questions: [qn({ explain: 'use {curly} and "quotes" } freely' })] })).ok);
  const rejects = [
    ['no JSON at all', 'Looks right to me!'],
    ['truncated JSON', JSON.stringify(good).slice(0, -8)],
    /* Balanced braces, so it reaches JSON.parse — truncation alone never
       does, because extractObject finds no closing brace first. */
    ['balanced but not JSON (unquoted keys)', '{questions: []}'],
    ['"questions" missing', JSON.stringify({})],
    ['no questions at all', JSON.stringify({ questions: [] })],
    ['an answer that is option 7 of 4', JSON.stringify({ questions: [qn({ answer: 7 })] })],
    ['a negative answer', JSON.stringify({ questions: [qn({ answer: -1 })] })],
    ['an answer given as the string "0"', JSON.stringify({ questions: [qn({ answer: '0' })] })],
    ['an answer of 1.5', JSON.stringify({ questions: [qn({ answer: 1.5 })] })],
    ['three options, not four', JSON.stringify({ questions: [qn({ options: ['a', 'b', 'c'] })] })],
    ['five options, not four', JSON.stringify({ questions: [qn({ options: ['a', 'b', 'c', 'd', 'e'] })] })],
    ['the same option twice', JSON.stringify({ questions: [qn({ options: ['alphaA', 'deltaA', 'ALPHAA', 'gammaA'] })] })],
    ['an empty option', JSON.stringify({ questions: [qn({ options: ['alphaA', ' ', 'gammaA', 'deltaA'] })] })],
    ['an empty question', JSON.stringify({ questions: [qn({ question: '  ' })] })],
    ['"explain" missing', JSON.stringify({ questions: [(() => { const x = qn(); delete x.explain; return x; })()] })],
    ['a field the schema does not have', JSON.stringify({ questions: [qn({ bonus: 1 })] })],
    ['an empty reply', ''],
    ['null', 'null'],
  ];
  for (const [name, text] of rejects) {
    const out = r(text);
    ok(`rejected, with a reason: ${name}`, out.ok === false && typeof out.error === 'string' && out.error.length > 10 && !('value' in out),
       out.ok ? 'ACCEPTED as ' + JSON.stringify(out.value) : out.error);
  }
  const ex = o => P.parse('exam', JSON.stringify({ questions: [Object.assign(qn(), { cluster: 0 }, o || {})] }));
  ok('an exam question carries the section it tests', ex().ok && !P.parse('exam', JSON.stringify(good)).ok);
  const les = P.parse('lesson', JSON.stringify({ overview: 'o', points: [{ text: 'x', page: '3' }], numbers: [], mnemonics: [], analogies: [], flowchart: '' }));
  ok('a page number given as a string is rejected', !les.ok, les.error);
  ok('a lesson with no points is rejected', !P.parse('lesson', JSON.stringify({ overview: 'o', points: [], numbers: [], mnemonics: [], analogies: [], flowchart: '' })).ok);
  ok('an unknown reply kind is refused, not parsed against nothing', !P.parse('nope', '{}').ok);
}

head('the Claude request has the Messages wire shape');
{
  const prompt = P.lesson(A);
  const a = Provider.build({ provider: 'anthropic', model: 'claude-opus-5', key: 'sk-ant-TEST' }, prompt, P.SCHEMAS.lesson);
  const ab = JSON.parse(a.init.body);
  ok('anthropic: Messages endpoint', a.url === 'https://api.anthropic.com/v1/messages');
  ok('anthropic: key in x-api-key, with the browser-access header', a.init.headers['x-api-key'] === 'sk-ant-TEST' &&
     a.init.headers['anthropic-dangerous-direct-browser-access'] === 'true' && a.init.headers['anthropic-version'] === '2023-06-01');
  ok('anthropic: system and user go where the Messages API reads them',
     ab.system === P.GROUNDING && ab.messages.length === 1 && ab.messages[0].role === 'user' && ab.messages[0].content === prompt.user);
  ok('anthropic: the phase schema is sent as the output format',
     ab.output_config && ab.output_config.format.type === 'json_schema' &&
     JSON.stringify(ab.output_config.format.schema) === JSON.stringify(P.SCHEMAS.lesson));
  ok('anthropic: Opus 5 asks for default fallbacks, with its beta header',
     ab.fallbacks === 'default' && a.init.headers['anthropic-beta'] === 'server-side-fallback-2026-07-01');
  const s5 = Provider.build({ provider: 'anthropic', model: 'claude-sonnet-5', key: 'k' }, prompt, P.SCHEMAS.lesson);
  ok('anthropic: other models do not send fallbacks', !('fallbacks' in JSON.parse(s5.init.body)) && !s5.init.headers['anthropic-beta']);

  let threw = '';
  try { Provider.build({ provider: 'nope', model: 'x', key: 'k' }, prompt); } catch (e) { threw = e.message; }
  ok('an unknown provider throws rather than sending somewhere', /unknown provider/.test(threw));
}

head('a call that goes wrong says so');
(async () => {
  const cfg = { provider: 'anthropic', model: 'claude-opus-5', key: 'k' };
  const reply = (status, body) => () => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)) });
  const msg = text => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
  const grade = JSON.stringify({ questions: [{ question: 'Which drives betaA?', quote: '', options: ['alphaA', 'deltaA', 'gammaA', 'epsilonA'], answer: 0, explain: 'alphaA drives betaA.', page: 3 }] });
  const outcome = p => p.then(v => ({ v }), e => ({ e: e.message }));

  const good = await outcome(Provider.call(cfg, P.quiz(A, lessonA), 'quiz', reply(200, msg(grade))));
  ok('a good reply resolves to the parsed drill', good.v && good.v.questions[0].answer === 0, JSON.stringify(good));
  const garbled = await outcome(Provider.call(cfg, P.quiz(A, lessonA), 'quiz', reply(200, msg('{"questions": [{"answer": tru'))));
  ok('a garbled drill rejects — it does not resolve to anything', 'e' in garbled && !('v' in garbled), garbled.e);
  const refused = await outcome(Provider.call(cfg, P.lesson(A), 'lesson',
    reply(200, { stop_reason: 'refusal', stop_details: { explanation: 'policy' }, content: [] })));
  ok('a refusal is an error that says it was a refusal', /declined/.test(refused.e || ''), refused.e);
  const cut = await outcome(Provider.call(cfg, P.lesson(A), 'lesson', reply(200, { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"points": [' }] })));
  ok('a reply cut off at max_tokens says so', /cut off/.test(cut.e || ''), cut.e);
  const auth = await outcome(Provider.call(cfg, P.lesson(A), 'lesson', reply(401, { error: { message: 'invalid x-api-key' } })));
  ok('a rejected key points at Settings', /key was rejected/.test(auth.e || ''), auth.e);
  const html = await outcome(Provider.call(cfg, P.lesson(A), 'lesson', reply(200, '<html>proxy error</html>')));
  ok('a body that is not JSON at all is an error', /not JSON/.test(html.e || ''), html.e);

  /* The fallback beta may not be open to every account. A 400 that names it
     is retried once without it; the retry must really drop it. */
  const seen = [];
  const f400 = (url, init) => {
    seen.push(JSON.parse(init.body));
    return seen.length === 1
      ? reply(400, { error: { message: 'fallbacks: not enabled for this organization' } })()
      : reply(200, msg(grade))();
  };
  const retried = await outcome(Provider.call(cfg, P.quiz(A, lessonA), 'quiz', f400));
  ok('a 400 naming fallbacks is retried once without them, and succeeds',
     retried.v && seen.length === 2 && seen[0].fallbacks === 'default' && !('fallbacks' in seen[1]), `${seen.length} requests`);
  const loops = [];
  const always400 = (u, init) => { loops.push(1); return reply(400, { error: { message: 'fallbacks bad' } })(); };
  const gaveUp = await outcome(Provider.call(cfg, P.lesson(A), 'lesson', always400));
  ok('and retried only once, not forever', 'e' in gaveUp && loops.length === 2, `${loops.length} requests`);

  /* Overloaded is the "high demand" failure the owner hit on Gemini. It is
     retried once after a pause; a second overload is reported, in words
     that point at the built-in coach. */
  Provider.RETRY_MS = 5;
  const busy = [];
  const once529 = () => { busy.push(1); return busy.length === 1 ? reply(529, { error: { message: 'Overloaded' } })() : reply(200, msg(grade))(); };
  const recovered = await outcome(Provider.call(cfg, P.quiz(A, lessonA), 'quiz', once529));
  ok('an overloaded provider is retried once, and the retry\'s answer is used', recovered.v && recovered.v.questions.length === 1 && busy.length === 2,
     `${busy.length} requests`);
  const stuck = [];
  const always529 = () => { stuck.push(1); return reply(529, { error: { message: 'Overloaded' } })(); };
  const over = await outcome(Provider.call(cfg, P.lesson(A), 'lesson', always529));
  ok('a second overload is reported, not retried again', 'e' in over && stuck.length === 2, `${stuck.length} requests`);
  ok('and the report says it is overload, and names the built-in coach', /overloaded/.test(over.e || '') && /built-in coach/.test(over.e || ''), over.e);

  const retired = await outcome(Provider.call(cfg, P.lesson(A), 'lesson',
    reply(404, { error: { message: 'model: claude-2.1 is no longer available' } })));
  ok('a 404 says to choose another model in Settings, and keeps the provider\'s words',
     /choose another model in Settings/.test(retired.e || '') && /no longer available/.test(retired.e || ''), retired.e);

  head('which coach, and what a saved setting becomes');
  const mem = v => { const m = { v }; return { getItem: () => m.v, setItem: (_, x) => { m.v = x; } }; };
  ok('there are exactly two coaches: built-in and Claude',
     JSON.stringify(Object.keys(Provider.PROVIDERS).sort()) === '["anthropic","builtin"]', Object.keys(Provider.PROVIDERS).join(', '));
  const fresh = Provider.loadConfig(mem(null));
  ok('with nothing saved, the coach is the built-in one', fresh.provider === 'builtin' && fresh.key === '', JSON.stringify(fresh));
  ok('which is ready without any key', Provider.ready(fresh) && !Provider.needsKey(fresh));
  ok('while Claude without a key is not ready', !Provider.ready({ provider: 'anthropic', model: 'claude-opus-5', key: '' }) &&
     Provider.ready({ provider: 'anthropic', model: 'claude-opus-5', key: 'k' }));
  /* The owner's own browser has a Gemini setting saved. It must come back as
     the built-in coach — and the Gemini key must not survive to be sent to
     Anthropic. */
  for (const old of [{ provider: 'gemini', model: 'gemini-3.8-flash', key: 'AIzaOLD' }, { provider: 'groq', model: 'openai/gpt-oss-120b', key: 'gsk_OLD' }]) {
    const c = Provider.loadConfig(mem(JSON.stringify(old)));
    ok(`a saved ${old.provider} setting becomes the built-in coach, and its key is dropped`,
       c.provider === 'builtin' && c.key === '', JSON.stringify(c));
  }
  const stale = Provider.loadConfig(mem(JSON.stringify({ provider: 'anthropic', model: 'claude-2.1', key: 'sk-KEEP' })));
  ok('a saved Claude model the app no longer lists is replaced by the first listed', stale.model === 'claude-opus-5', stale.model);
  ok('and the saved key survives that replacement', stale.key === 'sk-KEEP');
  const kept = Provider.loadConfig(mem(JSON.stringify({ provider: 'anthropic', model: 'claude-haiku-4-5', key: 'k' })));
  ok('a saved model that is still listed is kept, not reset', kept.model === 'claude-haiku-4-5', kept.model);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
