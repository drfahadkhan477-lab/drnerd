#!/usr/bin/env node
/*
 * The loop that runs a turn with the tutor — run() in src/core/apexturn.js.
 *
 *   node tests/verify-apexloop-pure.js
 *
 * Pure Node, no browser and no build. A turn asks the model, runs the tools its reply calls, hands the
 * results back and asks again, up to six steps, then ends. The loop reaches the page only through what it
 * is handed: the turn's state, and an object of the page's parts. Here the page is invented: each part
 * records that it was called, with what, and what the turn's state was at that moment, and the model is a
 * script of replies. Every expected value is written out.
 *
 * What is measured, rather than assumed — the rules in the module's header, each a way a turn once went wrong:
 *   1. a reply that arrives as Stop is pressed is neither kept nor acted on;
 *   2. explain-only mode runs no tool, and a reply that calls one is an error in the thread;
 *   3. a reply cut off by the output limit is kept and marked; one that stopped otherwise is a notice;
 *   4. a mock block opened while the reply was at the model: its words kept, its calls not run;
 *   5. a tool's answer is cut at 9,000 characters, except a grounded search's;
 *   6. six steps at most, and calls left on the sixth are said to have been stopped;
 *   7. however it ends, the turn is over, in this order: not busy, nothing to stop, the panel drawn, the
 *      avatar idle, what a tool queued opened; an error in opening it does not escape;
 *   and the turn's state: the stop button made at the start, the trace and the grounded budget set for this
 *   reply, the notes a tool cites added to those the reply drew on, the last six kept.
 *
 * And the page: its streamReply() hands run() APEX_TURN and its own parts, each looked up when the loop calls
 * it, so a part the page replaces before a turn (verify-gemini replaces runTool) is the part the turn uses.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { blankComments } = require('./_source.js');
const { cut } = require('./_appcut.js');
const T = require('../src/core/apexturn.js').ApexTurn;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);

/* One invented page. replies: what the model says at each step, in order; a reply may abort the turn as it
   arrives, or throw. tools: name → (input, page) → { result, cite }. */
function world(o) {
  o = o || {};
  const st = T.state();
  st.busy = true; st.hits = o.hits === undefined ? [{ id: 'n0' }] : o.hits; st.trace = [{ kind: 'from the last turn' }];
  const log = [], hist = (o.hist || [{ role: 'user', content: 'ask' }]).map(m => Object.assign({}, m));
  const at = () => ({ busy: st.busy, abort: st.abort ? (st.abort.signal.aborted ? 'aborted' : 'live') : null });
  let step = 0, grounded = !!o.grounded;
  const page = {
    AbortController, groundedBudget: 31200,
    wire: h => { log.push(['wire', h.length]); return h.map(m => ({ role: m.role, content: m.content })); },
    oneTurn: async (q, wire, extra, explainOnly) => {
      const r = (o.replies || [{ text: 'An answer.', finishReason: 'STOP' }])[step++];
      log.push(['oneTurn', step, explainOnly, wire.length, at().abort]);
      if (!r) return { text: '', calls: [], finishReason: 'STOP' };
      if (r.abort) st.abort.abort();
      if (r.throws) throw r.throws;
      return { text: r.text || '', raw: [], calls: (r.calls || []).map((c, i) => Object.assign({ id: 'call_' + step + '_' + i, input: {} }, c)), finishReason: r.finishReason, ...(r.reused ? { reused: true } : {}) };
    },
    runTool: (name, input) => { log.push(['runTool', name]); const f = (o.tools || {})[name]; return f ? f(input, page) : { result: 'ran ' + name }; },
    exchange: (wire, turn, results) => { log.push(['exchange', results.map(r => [r.id, r.name, r.content.length])]); wire.push({ role: 'model', parts: [] }, { role: 'user', parts: [] }); },
    grounded: () => grounded, setGrounded: v => { grounded = v; },
    away: () => { const a = !!(o.awayAt && o.awayAt === step); log.push(['away', a]); return a; },
    save: () => log.push(['save', J(hist)]),
    render: () => log.push(['render', at().busy]),
    setState: s => log.push(['state', s]),
    flush: () => { log.push(['flush', at()]); if (o.flushThrows) throw new Error('nav broke'); },
  };
  const go = async () => { let out; try { out = ['resolved', await T.run(st, page, o.q || null, hist, o.extra || '', o.explainOnly)]; } catch (e) { out = ['rejected', e.message]; } return out; };
  return { st, page, log, hist, go, kinds: () => log.map(e => e[0]) };
}
const calls = (n, name) => Array.from({ length: n }, () => ({ name: name || 'get_performance' }));

(async () => {

head('a turn with no tools');
{
  const w = world();
  const out = await w.go();
  ok('the model is asked once, and its words are kept and saved', w.log.filter(e => e[0] === 'oneTurn').length === 1 && w.hist.length === 2 && w.hist[1]?.content === 'An answer.' && w.kinds().includes('save'), J(w.hist));
  ok('the turn settles with nothing, and never rejects', J(out) === '["resolved",null]', J(out));
  ok('the avatar thinks before the model is asked', w.kinds().indexOf('state') < w.kinds().indexOf('oneTurn') && w.log.find(e => e[0] === 'state')?.[1] === 'thinking');
  const st = w.st;
  ok('and the turn\'s state is reset for this reply: a stop button, an empty trace, the grounded budget', w.log.find(e => e[0] === 'oneTurn')?.[4] === 'live' && J(st.trace) === '[]' && st.groundedLeft === 31200, J([st.trace, st.groundedLeft]));
  ok('the words are kept as the model said them, and nothing more', J(w.hist[1]) === '{"role":"assistant","content":"An answer."}', J(w.hist[1]));
  const r = world({ replies: [{ text: 'Again.', finishReason: 'STOP', reused: true }] }); await r.go();
  ok('a reused explanation is marked reused', r.hist[1]?.reused === true);
}

head('7. however it ends, the turn is over, in order');
{
  const w = world(); await w.go();
  const end = w.log.slice(-3);
  ok('the panel is drawn with the turn no longer busy, then the avatar idles, then what was queued opens',
     J(end.map(e => e[0])) === '["render","state","flush"]' && end[0][1] === false && end[1][1] === 'idle', J(end));
  ok('and by then there is nothing to stop', J(end[2][1]) === '{"busy":false,"abort":null}' && w.st.busy === false && w.st.abort === null, J(end[2][1]));
  const t = world({ flushThrows: true }); const out = await t.go();
  ok('an error in opening what was queued does not escape the turn', out[0] === 'resolved' && t.st.busy === false, J(out));
  const e = world({ replies: [{ throws: new Error('network down') }] }); const eo = await e.go();
  ok('a turn that fails ends the same way, its error said in the thread as a notice', eo[0] === 'resolved' && e.st.busy === false && J(e.log.slice(-3).map(x => x[0])) === '["render","state","flush"]'
     && J(e.hist[1]) === '{"role":"assistant","err":true,"content":"network down"}', J(e.hist[1]));
  const blank = world({ replies: [{ throws: new Error('') }] }); await blank.go();
  ok('an error with no words is said as a failed request', blank.hist[1] && blank.hist[1]?.content === 'Request failed. Check the connection.', J(blank.hist[1]));
}

head('1. a reply that arrives as Stop is pressed');
{
  const w = world({ replies: [{ text: 'Half an answer', calls: calls(1), abort: true }] });
  const out = await w.go();
  ok('its words are not kept, and nothing is saved', w.hist.length === 1 && !w.kinds().includes('save'), J(w.hist));
  ok('its calls are not run, and nothing is handed back', !w.kinds().includes('runTool') && !w.kinds().includes('exchange'));
  ok('the model is not asked again', w.log.filter(e => e[0] === 'oneTurn').length === 1);
  ok('and the turn still ends as any turn does', out[0] === 'resolved' && J(w.log.slice(-3).map(e => e[0])) === '["render","state","flush"]' && w.st.abort === null);
  const s = world({ replies: [{ throws: Object.assign(new Error('Stopped'), { name: 'AbortError' }) }] });
  await s.go();
  ok('a stop that ends the request itself says nothing in the thread', s.hist.length === 1 && !s.kinds().includes('save'), J(s.hist));
}

head('2. explain-only mode runs no tool');
{
  const w = world({ explainOnly: true, replies: [{ text: 'I will look that up', calls: calls(1) }] });
  await w.go();
  ok('the model is asked in explain-only mode', w.log.find(e => e[0] === 'oneTurn')?.[2] === true);
  ok('a reply that calls a tool runs none, and keeps none of its words', !w.kinds().includes('runTool') && w.hist.length === 2 && !w.hist.some(m => m.content === 'I will look that up'), J(w.hist));
  ok('and is an error in the thread, saying what to do instead', w.hist[1]?.err === true && /Explain-only mode cannot run study tools\. Use Send/.test(w.hist[1]?.content), J(w.hist[1]));
  const plain = world({ explainOnly: true }); await plain.go();
  ok('without a call, an explain-only reply is kept as any other', plain.hist.length === 2 && plain.hist[1]?.content === 'An answer.' && !plain.hist[1]?.err, J(plain.hist));
  const omitted = world(); await omitted.go();
  ok('left out, explain-only is off', omitted.log.find(e => e[0] === 'oneTurn')?.[2] === false, String(omitted.log.find(e => e[0] === 'oneTurn')?.[2]));
}

head('3. a reply that stops short');
{
  const cut0 = world({ replies: [{ text: 'A long answer that', finishReason: 'MAX_TOKENS' }] }); await cut0.go();
  ok('cut off by the output limit, its words are kept and marked incomplete, and no notice is added', cut0.hist.length === 2 && J(cut0.hist[1]) === '{"role":"assistant","content":"A long answer that","incomplete":true}', J(cut0.hist));
  const empty = world({ replies: [{ text: '', finishReason: 'MAX_TOKENS' }] }); await empty.go();
  ok('cut off with no words, it is a notice that the explanation may be incomplete', empty.hist.length === 2 && empty.hist[1]?.err === true && /reached the model’s output limit/.test(empty.hist[1]?.content), J(empty.hist[1]));
  const safety = world({ replies: [{ text: 'Some words', finishReason: 'SAFETY' }] }); await safety.go();
  ok('stopped for another reason, its words are kept and a notice follows them', safety.hist.length === 3 && safety.hist[1]?.content === 'Some words' && safety.hist[2]?.err === true && /stopped without confirming a complete explanation/.test(safety.hist[2]?.content), J(safety.hist));
  const spaces = world({ replies: [{ text: '   \n ', calls: calls(1) }, { text: 'Done.', finishReason: 'STOP' }] }); await spaces.go();
  ok('a reply of nothing but white space keeps no words', spaces.hist.length === 2 && spaces.hist[1]?.content === 'Done.', J(spaces.hist));
  const none = world({ replies: [{ text: 'Done.', finishReason: '' }] }); await none.go();
  ok('a reply that gives no reason is taken as finished', none.hist.length === 2 && !none.hist[1]?.err);
  const withCall = world({ replies: [{ text: '', calls: calls(1), finishReason: 'SAFETY' }, { text: 'After.', finishReason: 'STOP' }] }); await withCall.go();
  ok('a reply with a tool call is not said to have stopped, whatever its reason', !withCall.hist.some(m => m.err), J(withCall.hist));
}

head('4. a mock block opened while the reply was at the model');
{
  const w = world({ awayAt: 1, replies: [{ text: 'Here is the plan', calls: calls(2, 'plan_session') }, { text: 'never asked' }] });
  await w.go();
  ok('its words are kept', w.hist.some(m => m.content === 'Here is the plan'));
  ok('its calls are not run, and the model is not asked again', !w.kinds().includes('runTool') && w.log.filter(e => e[0] === 'oneTurn').length === 1);
  const later = world({ awayAt: 2, replies: [{ text: '', calls: calls(1) }, { text: 'Second', calls: calls(1) }, { text: 'never' }] });
  await later.go();
  ok('asked after each step: a block opened at the second stops the turn there', later.log.filter(e => e[0] === 'runTool').length === 1 && later.log.filter(e => e[0] === 'oneTurn').length === 2);
}

head('5. what a tool says, and what it cites');
{
  const long = 'x'.repeat(12000);
  const w = world({ replies: [{ text: '', calls: [{ name: 'get_performance' }, { name: 'search_question_bank' }] }, { text: 'Done.' }],
    tools: { get_performance: () => ({ result: long }), search_question_bank: () => ({ result: long }) } });
  await w.go();
  const ex = w.log.find(e => e[0] === 'exchange');
  ok('an answer is cut at 9,000 characters, in open mode a search\'s too', ex && J(ex[1]?.map(r => r[2])) === '[9000,9000]', ex && J(ex[1]));
  const g = world({ grounded: true, replies: [{ text: '', calls: [{ name: 'get_performance' }, { name: 'search_question_bank' }] }, { text: 'Done.' }],
    tools: { get_performance: () => ({ result: long }), search_question_bank: () => ({ result: long }) } });
  await g.go();
  const gx = g.log.find(e => e[0] === 'exchange');
  ok('in grounded mode a search\'s answer goes back whole; any other tool\'s is still cut', gx && J(gx[1]?.map(r => r[2])) === '[9000,12000]', gx && J(gx[1]));
  /* Grounded mode is asked as each answer is cut, not once per turn: a tool can turn it off. */
  const flip = world({ grounded: true, replies: [{ text: '', calls: [{ name: 'remember' }, { name: 'search_question_bank' }] }, { text: 'Done.' }],
    tools: { remember: (i, page) => { page.setGrounded(false); return { result: 'kept' }; }, search_question_bank: () => ({ result: long }) } });
  await flip.go();
  ok('grounded mode is asked as each answer is cut', J(flip.log.find(e => e[0] === 'exchange')?.[1]?.map(r => r[2])) === '[4,9000]');
  ok('each answer goes back by the call\'s id and name, in the order called', ex && J(ex[1]?.map(r => [r[0], r[1]])) === '[["call_1_0","get_performance"],["call_1_1","search_question_bank"]]', ex && J(ex[1]));
  const num = world({ replies: [{ text: '', calls: calls(1) }, { text: 'ok' }], tools: { get_performance: () => ({ result: 12345 }) } });
  await num.go();
  ok('a result that is not a string is written as one', J(num.log.find(e => e[0] === 'exchange')?.[1]) === '[["call_1_0","get_performance",5]]', J(num.log.find(e => e[0] === 'exchange')));
  const c = world({ hits: [{ id: 'a' }, { id: 'b' }], replies: [{ text: '', calls: [{ name: 'search_question_bank' }, { name: 'search_question_bank' }] }, { text: 'Done.' }],
    tools: { search_question_bank: () => ({ result: 'notes', cite: [{ id: 'c' }, { id: 'd' }, { id: 'e' }] }) } });
  await c.go();
  /* a, b, then c d e twice: eight, of which the last six. */
  ok('the notes a tool cites join those the reply drew on, and the last six are kept', J(c.st.hits.map(h => h.id)) === '["c","d","e","c","d","e"]', J(c.st.hits.map(h => h.id)));
  const few = world({ hits: [{ id: 'a' }], replies: [{ text: '', calls: [{ name: 'search_question_bank' }] }, { text: 'Done.' }], tools: { search_question_bank: () => ({ result: 'notes', cite: [{ id: 'b' }] }) } });
  await few.go();
  ok('and fewer than six are all kept, in order', J(few.st.hits.map(h => h.id)) === '["a","b"]', J(few.st.hits.map(h => h.id)));
  const n0 = world({ hits: null, replies: [{ text: '', calls: [{ name: 'search_question_bank' }] }, { text: 'Done.' }], tools: { search_question_bank: () => ({ result: 'notes', cite: [{ id: 'z' }] }) } });
  await n0.go();
  ok('with no notes drawn on yet, a citation starts the list', J(n0.st.hits) === '[{"id":"z"}]', J(n0.st.hits));
  const quiet = world({ replies: [{ text: '', calls: calls(2) }, { text: 'Done.' }] }); await quiet.go();
  ok('a tool that cites nothing leaves the notes as they were', J(quiet.st.hits) === '[{"id":"n0"}]');
  ok('every call is in the trace, by name and input, after what the tools themselves wrote', J(quiet.st.trace) === '[{"kind":"call","name":"get_performance","input":{}},{"kind":"call","name":"get_performance","input":{}}]', J(quiet.st.trace));
  ok('the answers are handed back, then the panel is drawn to show the chips, then the model is asked again',
     J(quiet.kinds().slice(quiet.kinds().indexOf('exchange'), quiet.kinds().indexOf('exchange') + 4)) === '["exchange","render","state","oneTurn"]', J(quiet.kinds()));
  const broke = world({ replies: [{ text: '', calls: calls(1) }], tools: { get_performance: () => { throw new Error('tool broke'); } } });
  await broke.go();
  ok('a tool that throws ends the turn with its error in the thread', broke.hist[1] && broke.hist[1]?.err === true && broke.hist[1]?.content === 'tool broke' && broke.st.busy === false, J(broke.hist));
}

head('6. six steps at most');
{
  const many = world({ replies: Array.from({ length: 9 }, (_, i) => ({ text: 'step ' + (i + 1), calls: calls(1) })) });
  await many.go();
  ok('the model is asked six times, and no more', many.log.filter(e => e[0] === 'oneTurn').length === 6, String(many.log.filter(e => e[0] === 'oneTurn').length));
  ok('the sixth step\'s calls are still run and handed back', many.log.filter(e => e[0] === 'runTool').length === 6 && many.log.filter(e => e[0] === 'exchange').length === 6);
  ok('and a notice says the turn was stopped there, to be carried on', J(many.hist[many.hist.length - 1]) === J({ role: 'assistant', err: true, content: 'That needed more tool steps than one turn allows, so I stopped there. Ask again and I will carry on from where this left off.' }), J(many.hist[many.hist.length - 1]));
  ok('each step\'s words are kept', many.hist.filter(m => /^step /.test(m.content)).length === 6);
  const six = world({ replies: [...Array.from({ length: 5 }, () => ({ text: '', calls: calls(1) })), { text: 'Finished on the sixth.', finishReason: 'STOP' }] });
  await six.go();
  ok('a turn that finishes on its sixth step is not said to have been stopped', !six.hist.some(m => m.err), J(six.hist.slice(-1)));
}

head('the page\'s streamReply() hands run() its own state and parts');
{
  const shell = blankComments(fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8'));
  const n = t => shell.split(t).length - 1;
  ok('streamReply() is the call into run(), with APEX_TURN', n('function streamReply(') === 1 && n('return ApexTurn.run(APEX_TURN,{') === 1 && n('q,hist,extra,explainOnly);') === 1);
  ok('and is not async: the caller gets run()\'s own promise', n('async function streamReply(') === 0);
  /* The loop's own lines, not names it shares with the page: pushToolExchange(wire,turn,results) is also the head of the
     page's one-line function of that name, and the first version of this check counted it as a loop left behind. */
  const kept = ['while(guard++ < 6)', 'const turn=await oneTurn(', 'if(guard>=6) truncated=true;', 'That needed more tool steps than one turn allows'].filter(t => n(t) > 0);
  ok('the page keeps no loop of its own', kept.length === 0, kept.join(' | ') || 'none of its lines left');
  /* Run the page's own streamReply over the page's own owner, in a world whose parts can be replaced. */
  const code = cut('app/systole.html', '@@SLOT[src:src/core/apexturn.js]@@', "pendingNav:apexTurnView('nav')});", { inclusive: true }) + '\n' + cut('app/systole.html', 'function streamReply(', '\n/* The model\'s own parts go back verbatim');
  /* The page's functions exist from the moment the script loads (they are declarations), so the world holds its
     parts before the page's own lines run, as the page does; a part captured at load would be one of these. */
  function pageWorld() {
    const used = [], saved = [];
    const ctx = { AbortController, CTX_BUDGET: 5200, AI_CHAT: 'k', AI_GROUNDED: false, used, saved, used2: [] };
    ctx.window = ctx;
    let asked = 0;
    Object.assign(ctx, {
      apexWire: h => { used.push('apexWire'); return h.slice(); },
      oneTurn: async (q, wire, extra, explainOnly) => { asked++; used.push('oneTurn:' + explainOnly); if (ctx.duringTurn && asked === 1) ctx.duringTurn();
        return asked === 1 ? { text: '', calls: [{ id: 'c1', name: 'search_question_bank', input: {} }] } : { text: 'ok', calls: [], finishReason: 'STOP' }; },
      runTool: () => { used.push('runTool:first'); return { result: 'r'.repeat(9500), cite: [{ id: 'cited' }] }; },
      pushToolExchange: (w, t, r) => used.push('pushToolExchange:' + r[0].content.length),
      apexAway: () => { used.push('apexAway'); return false; }, saveJSON: (k, v) => saved.push([k, v]),
      buildAI: () => used.push('buildAI:' + ctx.aiBusy), apexSetState: s => used.push('apexSetState:' + s), flushNav: () => used.push('flushNav'),
    });
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    vm.runInContext('var CHATS={k:[]}', ctx);
    ctx.aiBusy = true; ctx.lastHits = [{ id: 'drawn' }];
    return ctx;
  }
  const REPLACE = "runTool=function(){ used2.push('runTool:replaced'); AI_GROUNDED=true; return { result:'g'.repeat(9500), cite:[{id:'cited'}] }; };";
  const ctx = pageWorld(), used = ctx.used, saved = ctx.saved;
  /* Replaced on the page before the turn, as verify-gemini replaces runTool, and grounded mode turned on by it. */
  vm.runInContext(REPLACE, ctx);
  const p = ctx.streamReply(null, ctx.CHATS.k, '');
  ok('it returns a promise', !!p && typeof p.then === 'function', typeof p);
  await p;
  const T2 = vm.runInContext('APEX_TURN', ctx);
  ok('the turn ran on the page\'s own state: the old names read what the loop wrote', ctx.aiBusy === false && ctx.aiAbort === null && T2.busy === false && J(ctx.lastHits) === '[{"id":"drawn"},{"id":"cited"}]' && ctx.toolTrace.length === 1 && ctx.groundedTurnLeft === 31200,
     J({ busy: ctx.aiBusy, hits: ctx.lastHits, trace: ctx.toolTrace, left: ctx.groundedTurnLeft }));
  ok('a part replaced on the page before the turn is the part the turn uses', J(ctx.used2) === '["runTool:replaced"]' && !used.includes('runTool:first'), J(ctx.used2));
  /* And one replaced while the turn is running, from inside the first request: the loop looked each part up when it
     called it, so the step that follows uses the new one. A page that held the parts from the turn's start would not. */
  const mid = pageWorld();
  mid.duringTurn = () => vm.runInContext(REPLACE, mid);
  await mid.streamReply(null, mid.CHATS.k, '');
  ok('a part replaced while the turn runs is the part its next step uses', J(mid.used2) === '["runTool:replaced"]' && !mid.used.includes('runTool:first'), J({ replaced: mid.used2, first: mid.used.includes('runTool:first') }));
  ok('grounded mode is read from the page when the answer is cut, after the tool turned it on', used.includes('pushToolExchange:9500'), J(used.filter(u => /^pushToolExchange/.test(u))));
  ok('saves go to the page\'s CHATS under AI_CHAT', saved.length >= 2 && saved.every(([k, v]) => k === 'k' && v === ctx.CHATS), `${saved.length} saves`);
  ok('every part was the page\'s, in the loop\'s order', J(used.filter(u => !/^pushToolExchange/.test(u))) === J(['apexWire', 'apexSetState:thinking', 'oneTurn:false', 'apexAway', 'buildAI:true', 'apexSetState:thinking', 'oneTurn:false', 'buildAI:false', 'apexSetState:idle', 'flushNav']), J(used));
  const ex = pageWorld();
  await ex.streamReply(null, ex.CHATS.k, '', true);
  ok('explain-only, asked of the page\'s streamReply, is what the model is asked in', ex.used.filter(u => /^oneTurn:/.test(u))[0] === 'oneTurn:true', J(ex.used.filter(u => /^oneTurn:/.test(u))));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
})().catch(e => {
  /* A check that throws is a check that failed, and says so on a line of its own: the first version of this printed
     the error and no FAIL line, so a defect that broke a check's own reading looked like no failure at all. */
  ok('the suite ran to its end', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | '));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
});
