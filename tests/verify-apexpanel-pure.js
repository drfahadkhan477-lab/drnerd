#!/usr/bin/env node
/*
 * The Apex panel's markup — src/app/apexpanel.js.
 *
 *   node tests/verify-apexpanel-pure.js
 *
 * Pure Node, over invented threads. The module is given the question open, its thread and a kit and returns
 * markup; nothing in the first seven parts has a page. The kit there is stand-ins: e('x') is "E(x)", md('x')
 * "MD(x)", clip('x', n) "CLIP n(x)", icon() "[icon name cls]", the page's own pieces are "[LOCAL]" and "[SETUP]",
 * so what the panel is expected to say is worked out here and never read back from the module.
 *
 * What is measured, rather than assumed:
 *   - the head: Apex, what it answers from or about, grounding, full screen, settings and close;
 *   - with no key: the head, the actions on this device, the settings and the caution, in that order;
 *   - the thread: what was asked, each reply as it went, what Apex can do when there is none, the dots;
 *   - what a reply drew on, for this thread only, and the questions as ways to open them;
 *   - the figures: asked of the page with what they depend on, open or shut, each as a way to open it;
 *   - the prompts, the box, Send or Stop, the caution and what Apex is powered by;
 *   - that it reads what it is handed and changes nothing;
 *   - the page's lines: buildAI(), its kit, the figures' memo, the handlers and ids the markup names, and
 *     those lines over the page's own helpers, prompts, providers and markdown.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { blankComments } = require('./_source.js');
const M = require('../src/app/apexpanel.js').ApexPanel;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + String(detail).replace(/\s+/g, ' ') : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);
const run = f => { try { return String(f()); } catch (err) { return 'THREW ' + err.message; } };
const g1 = (s, re) => (s.match(re) || [])[1];
const times = (html, text) => html.split(text).length - 1;

const Q = { id: 'Q1', ch: 'Valves & more', n: 12, img: 2 };
const HITS = [{ kind: 'r', id: 'r1', title: 'Note <one>' }, { kind: 'q', id: 'Q7', ch: 'Heart failure', n: 31 }];
const FIGS = [{ key: 'k1', dataUrl: 'data:image/png;base64,AA', caption: 'Cap <1>', noteTitle: 'Note <one>' }, { key: 'k2', dataUrl: 'data:image/png;base64,BB', caption: 'Cap 2', noteTitle: 'N2' }];
let figCalls = [];
const kitOf = over => Object.assign({
  AI: { provider: 'gemini' }, AI_GROUNDED: false, REF: [1, 2, 3],
  MODELS: { gemini: [['g-pro', 'Gemini Pro — the best'], ['g-flash', 'Flash']], openai: [['o1', 'O one']] },
  PROVIDERS: [['gemini', 'Google <Gemini>', 'free'], ['openai', 'OpenAI', 'paid']],
  CHIPS: [['Why <is> this?', 'p0'], ['Kill', 'p1'], ['Picked', 'p2', q => !!q], ['Never', 'p3', () => false]],
  aiBusy: false, lastHits: HITS, lastHitsKey: 'Q1', apexChipsOpen: false, apexFigsOpen: false,
  apexFigsFor: (hits, lastBot, hist) => (figCalls.push(J([hits.map(h => h.id), lastBot, hist.length])), FIGS),
  apexIsFull: () => false, apexHosted: () => true, apexLocalHtml: () => '[LOCAL]', setupHtml: () => '[SETUP]', visionBadge: q => ' · VB(' + q.id + ')',
  cur: () => ({ key: '', model: 'g-pro' }), clip: (s, n) => 'CLIP' + n + '(' + s + ')', md: s => 'MD(' + s + ')',
  e: s => 'E(' + s + ')', icon: (name, cls) => '[icon ' + name + (cls ? ' ' + cls : '') + ']',
}, over);
const HIST = [{ role: 'user', content: 'Why <b>?' }, { role: 'assistant', content: 'Because **x**' }];
const headOf = (q, over) => run(() => M.headHtml(q, kitOf(over)));
const panel = (q, hist, over) => run(() => M.panelHtml('[HEAD]', q, hist, kitOf(over)));
const setup = over => run(() => M.setupPanelHtml('[HEAD]', kitOf(over)));
const handlersOf = html => [...html.matchAll(/\son[a-z]+="([^"]*)"/g)].map(m => m[1]);

head('the head');
{
  const h = headOf(Q);
  ok('Apex, its avatar, and the question\'s chapter through e(), its number and what the model sees of its figures', h.startsWith('<div class="ai-head">\n      <div class="ai-avatar"><canvas id="apexAvatar" aria-hidden="true"></canvas></div>') && h.includes('<div class="ai-title">Apex</div>') && h.includes('<div class="ai-sub">E(Valves & more) · item 12 · VB(Q1)</div>'), g1(h, /<div class="ai-sub">([\s\S]*?)<\/div>/));
  ok('away from a question, "Cardiology tutor", and no figures asked about', headOf(null).includes('<div class="ai-sub">Cardiology tutor</div>'));
  const g = headOf(Q, { AI_GROUNDED: true }), g1n = headOf(null, { AI_GROUNDED: true, REF: [1] });
  ok('grounded, the notes it answers from instead, and "note" for one', g.includes('<div class="ai-sub"><span class="grounded-tag">grounded · 3 notes</span></div>') && g1n.includes('grounded · 1 note</span>') && headOf(null, { AI_GROUNDED: true, REF: [] }).includes('grounded · 0 notes</span>'));
  const gb = x => g1(x, /(<button class="icon-btn grounded-btn[\s\S]*?<\/button>)/) || '';
  ok('grounding, by toggleGrounded(): pressed and titled for answering from the notes when on', gb(g) === '<button class="icon-btn grounded-btn on"\n        onclick="toggleGrounded()" aria-pressed="true"\n        title="Grounded: answering only from your reference library">[icon folder]</button>', gb(g));
  ok('and when off, not pressed, titled for Apex\'s own knowledge', gb(h) === '<button class="icon-btn grounded-btn"\n        onclick="toggleGrounded()" aria-pressed="false"\n        title="Open: Apex uses its own knowledge">[icon folder]</button>', gb(h));
  const fb = x => g1(x, /(<button[^>]*\n\s*onclick="toggleApexFull\(\)"[\s\S]*?<\/button>)/) || '';
  ok('full screen, by toggleApexFull(), from the side panel', fb(h).endsWith('onclick="toggleApexFull()" aria-pressed="false"\n        title="Open Apex full screen"\n        aria-label="Open Apex full screen">[icon expand]</button>'), fb(h));
  ok('and back, pressed, from full screen', fb(headOf(Q, { apexIsFull: () => true })).endsWith('aria-pressed="true"\n        title="Back to the side panel"\n        aria-label="Back to the side panel">[icon collapse]</button>'));
  ok('then settings, by aiSettings(), and close, by toggleAI(), and the head ends', h.endsWith('onclick="aiSettings()" title="Settings">[icon settings]</button>\n      <button class="icon-btn" style="background:var(--card);border-color:var(--border);color:var(--muted)"\n        onclick="toggleAI()" title="Close">[icon x]</button>\n    </div>'), h.slice(-120));
  ok('four buttons, in that order', J(handlersOf(h)) === J(['toggleGrounded()', 'toggleApexFull()', 'aiSettings()', 'toggleAI()']), J(handlersOf(h)));
}

head('with no key to call with');
{
  ok('the head, the actions on this device, the settings, and that Apex is a study aid that can be wrong, in that order', setup() === '[HEAD][LOCAL][SETUP]<div class="ai-disclaim">Study aid, not clinical advice — Apex can be wrong; check anything that changes care.</div>', setup());
}

head('the thread');
{
  const p = panel(Q, HIST);
  const body = g1(p, /<div class="ai-body" id="aiBody" role="region" aria-label="Apex conversation" tabindex="0">([\s\S]*?)<\/div>\n/) || '';
  ok('after the head, the conversation as a region the keyboard can reach: the actions on this device, then the thread', p.startsWith('[HEAD]<div class="ai-body" id="aiBody" role="region" aria-label="Apex conversation" tabindex="0">[LOCAL]<div class="msg user">'), p.slice(0, 140));
  ok('what was asked, through e(); the reply as markdown', body === '[LOCAL]<div class="msg user">E(Why <b>?)</div><div class="msg bot">MD(Because **x**)</div>', body);
  const odd = panel(Q, [{ role: 'assistant', content: 'Old', reused: true }, { role: 'assistant', content: 'Bad <x>', err: true }, { role: 'assistant', content: 'Cut', incomplete: true }]);
  ok('a reply that reused an explanation says so; a failed one is an error through e(), not markdown; one cut short says so', odd.includes('<div class="msg bot"><p class="src-lbl">Reused explanation · matching context</p>MD(Old)</div><div class="msg bot">[icon alert icon-sm] E(Bad <x>)</div><div class="msg bot">MD(Cut)<p class="src-lbl">Response reached its output limit and may be incomplete. Ask Apex to continue.</p></div>'), g1(odd, /tabindex="0">([\s\S]{0,300})/));
  const none = panel(Q, []);
  ok('with no thread, what Apex can do', none.includes('[LOCAL]<div class="msg bot"><p>Ask me anything about the item you\'re on — mechanism, the distractors, the trial evidence, or the concept underneath.</p><p>I can also <b>search your whole question bank</b>') && none.includes('<i>"why do I keep missing these?"</i>.</p></div></div>'));
  ok('while a reply is being written, the dots after the thread, and only then', panel(Q, HIST, { aiBusy: true }).includes('MD(Because **x**)</div><div class="msg bot" id="aiLive"><span class="typing"><i></i><i></i><i></i></span></div></div>') && !p.includes('aiLive'));
}

head('what a reply drew on');
{
  const p = panel(Q, HIST);
  const strip = g1(p, /(<div class="src-strip" data-apex-sources>[\s\S]*?<\/div>)/) || '';
  ok('for this thread: a note by its title, clipped to 26 and through e(); a question by its chapter\'s first word and number, as a way to open it', strip === '<div class="src-strip" data-apex-sources><span class="src-lbl">drawing on</span><span class="src-pill ref">[icon folder icon-sm] E(CLIP26(Note <one>))</span><button class="src-pill" data-jump="Q7">E(Heart) · 31</button></div>', strip);
  ok('nothing for another thread\'s, and nothing with nothing drawn on', !panel(Q, HIST, { lastHitsKey: 'Q2' }).includes('data-apex-sources') && !panel(Q, HIST, { lastHits: [] }).includes('data-apex-sources'));
  ok('away from a question, the general thread\'s', panel(null, HIST, { lastHitsKey: '_general' }).includes('data-apex-sources') && !panel(null, HIST, { lastHitsKey: 'Q1' }).includes('data-apex-sources'));
  ok('after the conversation and before the figures', p.indexOf('data-apex-sources') > p.indexOf('id="aiBody"') && p.indexOf('data-apex-sources') < p.indexOf('id="aiFigWrap"'));
}

head('the figures');
{
  figCalls = [];
  const p = panel(Q, HIST);
  ok('asked of the page with this thread\'s notes, the last reply and the thread', J(figCalls) === J([J([['r1', 'Q7'], 'Because **x**', 2])]), J(figCalls));
  figCalls = [];
  panel(Q, [HIST[1], HIST[0]]); panel(Q, HIST, { lastHitsKey: 'Q2' }); panel(Q, [{ role: 'assistant' }]);
  ok('the last reply is none when the reader spoke last, the notes none for another thread, and a reply with no text is ""', J(figCalls) === J([J([['r1', 'Q7'], '', 2]), J([[], 'Because **x**', 2]), J([['r1', 'Q7'], '', 1])]), J(figCalls));
  const fs_ = g1(p, /(<div class="fig-strip[\s\S]*?<\/div><\/div>)/) || '';
  ok('shut, its toggle says how many and from where', fs_.startsWith('<div class="fig-strip" id="aiFigWrap">\n    <button class="src-lbl fig-toggle" type="button" id="aiFigs" aria-controls="aiFigList"\n      aria-expanded="false">[icon chevron-down icon-sm]2 figures from those notes</button>\n    <div class="fig-list" id="aiFigList">'), fs_.slice(0, 260));
  ok('open, said so; one figure is "figure"', panel(Q, HIST, { apexFigsOpen: true }).includes('<div class="fig-strip open" id="aiFigWrap">') && panel(Q, HIST, { apexFigsOpen: true }).includes('aria-expanded="true">[icon chevron-down icon-sm]2 figures') && panel(Q, HIST, { apexFigsFor: () => [FIGS[0]] }).includes('1 figure from those notes</button>'));
  ok('each a way to open it full size, by openFigureFrom(), its caption through e() and clipped to 150 as alt and caption, and its note clipped to 44', fs_.includes('<figure class="ai-fig" onclick="openFigureFrom(this)" role="button" tabindex="0"\n      title="Open this figure full size"><img src="data:image/png;base64,AA" alt="E(Cap <1>)" loading="lazy">\n      <figcaption>E(CLIP150(Cap <1>))<span class="ai-fig-src">E(CLIP44(Note <one>))</span></figcaption></figure>') && times(fs_, '<figure class="ai-fig"') === 2);
  ok('none, no strip', !panel(Q, HIST, { apexFigsFor: () => [] }).includes('fig-strip'));
}

head('the prompts, the box and what it is powered by');
{
  const p = panel(Q, HIST);
  const chips = g1(p, /(<div class="chips[\s\S]*?<\/div>)/) || '';
  ok('the prompts that apply to the question, the first two hot, each through e()', chips.startsWith('<div class="chips" id="aiChips"><button class="chip hot" data-chip="0">E(Why <is> this?)</button><button class="chip hot" data-chip="1">E(Kill)</button><button class="chip" data-chip="2">E(Picked)</button>\n') && !chips.includes('data-chip="3"') && !panel(null, HIST).includes('data-chip="2"'), chips.slice(0, 260));
  ok('then Explain draft, and Clear thread once there is one', chips.includes('<button class="chip" data-chip="explain" title="Explain your draft using supplied context, without study tools">Explain draft · no tools</button>') && chips.endsWith('<button class="chip" data-chip="clear">Clear thread</button></div>') && !panel(Q, []).includes('data-chip="clear"'));
  ok('the prompts open, and the button to them on and expanded, only when open', panel(Q, HIST, { apexChipsOpen: true }).includes('<div class="chips open" id="aiChips">') && panel(Q, HIST, { apexChipsOpen: true }).includes('<button class="ai-more on" id="aiMore" type="button"\n         aria-controls="aiChips" aria-expanded="true"') && p.includes('<button class="ai-more" id="aiMore" type="button"\n         aria-controls="aiChips" aria-expanded="false"'));
  ok('the box to write in, and Send', p.includes('<textarea id="aiIn" rows="1" placeholder="Ask about this question…"></textarea>') && p.includes('<button class="ai-send" id="aiSend" type="button"\n         title="Send" aria-label="Send"\n         >[icon send icon-sm]</button>'));
  ok('while a reply is being written, Stop', panel(Q, HIST, { aiBusy: true }).includes('<button class="ai-send stopping" id="aiSend" type="button"\n         title="Stop" aria-label="Stop generating"\n         >■</button>'));
  const pw = x => g1(x, /<div class="ai-powered">([\s\S]*?)<\/div><\/div>$/) || '';
  ok('the caution, and the model by the first part of its name, on the provider by its name, through this site', p.includes('</div><div class="ai-disclaim">Study aid, not clinical advice — Apex can be wrong; check anything that changes care.</div><div class="ai-powered">') && pw(p) === 'Powered by <b>E(Gemini Pro)</b> on E(Google <Gemini>) · hosted key, called through this site', pw(p));
  ok('or the reader\'s own key; Gemini through this site only when the page says so', pw(panel(Q, HIST, { apexHosted: () => false })).endsWith(' · your own key, called directly from this device') && pw(panel(Q, HIST, { AI: { provider: 'openai' }, cur: () => ({ key: 'k', model: 'o1' }) })) === 'Powered by <b>E(O one)</b> on E(OpenAI) · your own key, called directly from this device');
  ok('a model or provider it does not know, by what it is called, or a dash', pw(panel(Q, HIST, { cur: () => ({ model: 'x-9' }) })).startsWith('Powered by <b>E(x-9)</b>') && pw(panel(Q, HIST, { cur: () => ({}) })).startsWith('Powered by <b>E(—)</b>') && pw(panel(Q, HIST, { AI: { provider: 'zed' }, cur: () => ({ model: 'm' }) })).startsWith('Powered by <b>E(m)</b> on E(zed) · your own key'));
  ok('in that order: the conversation, what it drew on, the figures, the prompts, the box', ['id="aiBody"', 'data-apex-sources', 'id="aiFigWrap"', 'id="aiChips"', 'id="aiIn"', 'id="aiSend"', 'class="ai-powered"'].every((t, i, a) => i === 0 || p.indexOf(a[i - 1]) < p.indexOf(t)) && p.endsWith('</div></div>'));
}

head('it reads what it is given and changes nothing');
const KIT_READS = new Set();
{
  const wrote = [];
  const watched = (o, into, name) => new Proxy(o, {
    get(t, k) { if (typeof k === 'string' && into) into.add(k); return t[k]; },
    set(t, k) { wrote.push(name + ' set ' + String(k)); return true; },
    deleteProperty(t, k) { wrote.push(name + ' delete ' + String(k)); return true; },
    defineProperty(t, k) { wrote.push(name + ' define ' + String(k)); return true; },
  });
  const deepWatch = (o, name) => (o && typeof o === 'object') ? watched(Array.isArray(o) ? o.map((x, i) => deepWatch(x, name + '.' + i)) : Object.fromEntries(Object.entries(o).map(([k, v]) => [k, deepWatch(v, name + '.' + k)])), null, name) : o;
  const kit = watched(kitOf({ AI: deepWatch({ provider: 'gemini' }, 'AI'), REF: deepWatch([1, 2], 'REF'), lastHits: deepWatch(HITS, 'hits') }), KIT_READS, 'kit');
  const outs = [run(() => M.headHtml(deepWatch(Q, 'q'), kit)), run(() => M.setupPanelHtml('[HEAD]', kit)), run(() => M.panelHtml('[HEAD]', deepWatch(Q, 'q'), deepWatch(HIST, 'hist'), kit)),
    run(() => M.headHtml(null, watched(kitOf({ AI_GROUNDED: true }), KIT_READS, 'kit')))];
  const names = [...KIT_READS].sort().join(' ');
  ok('of its kit, twenty-two names', !outs.some(o => o.startsWith('THREW')) && names === 'AI AI_GROUNDED CHIPS MODELS PROVIDERS REF aiBusy apexChipsOpen apexFigsFor apexFigsOpen apexHosted apexIsFull apexLocalHtml clip cur e icon lastHits lastHitsKey md setupHtml visionBadge', names);
  ok('it sets, deletes and defines nothing on the question, the thread, the notes drawn on, the settings or the kit', wrote.length === 0, wrote.join(', ') || 'nothing');
  const deep = o => { if (o && typeof o === 'object') { Object.values(o).forEach(deep); Object.freeze(o); } return o; };
  const frozen = run(() => M.panelHtml('[HEAD]', deep(Object.assign({}, Q)), deep(HIST.map(m => Object.assign({}, m))), deep(kitOf({ lastHits: HITS.map(h => Object.assign({}, h)), apexFigsFor: () => FIGS }))));
  ok('given everything frozen, it draws the same panel', !frozen.startsWith('THREW') && frozen === panel(Q, HIST) && frozen.includes('2 figures from those notes'), frozen.slice(0, 60));
  const readsOf = f => { const r = new Set(); run(() => f(watched(kitOf({ AI_GROUNDED: true }), r, 'kit'))); run(() => f(watched(kitOf(), r, 'kit'))); return [...r].sort().join(' '); };
  ok('of those, the head reads six, the setup two and the panel seventeen, each only what it draws with', readsOf(k => M.headHtml(Q, k)) === 'AI_GROUNDED REF apexIsFull e icon visionBadge' && readsOf(k => M.setupPanelHtml('[HEAD]', k)) === 'apexLocalHtml setupHtml'
     && readsOf(k => M.panelHtml('[HEAD]', Q, HIST, k)) === 'AI CHIPS MODELS PROVIDERS aiBusy apexChipsOpen apexFigsFor apexFigsOpen apexHosted apexLocalHtml clip cur e icon lastHits lastHitsKey md', readsOf(k => M.headHtml(Q, k)) + ' · ' + readsOf(k => M.setupPanelHtml('[HEAD]', k)));
}

head('the page hands the module what it has, and keeps what touches the page');
{
  const raw = fs.readFileSync(path.join(__dirname, '..', 'app', 'systole.html'), 'utf8');
  const page = blankComments(raw);
  const count = text => page.split(text).length - 1;
  const SLOT = '@@SLOT[src:src/app/apexpanel.js]@@';
  const KIT = 'const apexKit=()=>({AI,AI_GROUNDED,REF,MODELS,PROVIDERS,CHIPS,aiBusy,lastHits,lastHitsKey,apexChipsOpen,apexFigsOpen,apexFigsFor,\n  apexIsFull,apexHosted,apexLocalHtml,setupHtml,visionBadge,cur,clip,md,e,icon});';
  const BUILD = `function buildAI(){
  const wrap=document.getElementById('ai'); if(!wrap)return;
  const panelWas=apexPanelState();
  const q=(S.screen==='quiz'&&S.questions.length)?S.questions[S.qIdx]:null;
  const hist=chatFor(q);
  const kit=apexKit(), head=ApexPanel.headHtml(q,kit);`;
  const BRANCH = `  if(!cur().key && !(AI.provider==='gemini' && apexHosted())) {
    wrap.innerHTML=ApexPanel.setupPanelHtml(head,kit); bindSetup(); mountApexAvatar(); return; }
  wrap.innerHTML=ApexPanel.panelHtml(head,q,hist,kit);
  wrap.querySelectorAll('[data-jump]').forEach(b=>b.onclick=()=>peekQuestion(b.dataset.jump));
  bindChat(q);
  apexPanelRestore(panelWas);
  mountApexAvatar();
}`;
  const MEMO = `function apexFigsFor(hits,lastBot,hist){
${' '.repeat(2)}`;
  ok('buildAI() reads the panel\'s state and the thread, makes the kit once, and draws the head first', count(BUILD) === 1 && count('function buildAI(') === 1);
  ok('then, with no key, the setup, bound; otherwise the panel, its questions wired to peekQuestion(), the chat bound, the state restored, the avatar started', count(BRANCH) === 1 && page.indexOf(BRANCH) > page.indexOf(BUILD) && page.indexOf(BRANCH) - page.indexOf(BUILD) < BUILD.length + 200);
  ok('the module is written into the page once, above apexKit() and buildAI()', count(SLOT) === 1 && page.indexOf(SLOT) < page.indexOf('const apexKit=') && page.indexOf(SLOT) < page.indexOf(BUILD));
  ok('the kit is made at each drawing, never kept: a function, called by buildAI() alone', count(KIT) === 1 && count('apexKit') === 2 && count('apexKit()') === 1, count('apexKit') + ' ' + count('apexKit()'));
  const handed = String(g1(page, /const apexKit=\(\)=>\(\{([^}]*)\}\);/)).replace(/\s+/g, '');
  ok('the kit is the twenty-two names the module was seen to ask for, each under its own name', KIT_READS.size === 22 && handed.split(',').sort().join(' ') === [...KIT_READS].sort().join(' '), handed);
  const memo = g1(page, /(function apexFigsFor\(hits,lastBot,hist\)\{[\s\S]*?\n\})/) || '';
  ok('the figures\' memo is the page\'s: keyed on the notes, the reply\'s length and whether one is being written, kept in apexFigMemo, which it alone writes', memo.startsWith(MEMO) && memo.includes("const figKey=hits.map(h=>h.id).join(',')+'|'+lastBot.length+'|'+(aiBusy?1:0);") && memo.includes('if(apexFigMemo.key!==figKey){') && memo.endsWith('  return apexFigMemo.figs;\n}') && count('let apexFigMemo={key:null,figs:[]};') === 1 && count('apexFigMemo=') === 2, memo.slice(0, 80));
  ok('and finds none while a reply is being written or with no thread, three at most, none the reply already placed', memo.includes("apexFigMemo={ key:figKey, figs:(hist.length&&!aiBusy)\n      ? refFiguresForHits(hits,3).filter(f=>lastBot.indexOf('refimg://'+f.key)<0)\n      : [] };"));
  const all = headOf(Q) + panel(Q, HIST) + setup();
  const handlers = [...new Set(handlersOf(all).map(h => (h.match(/^[A-Za-z_$][\w$]*/) || ['NO NAME'])[0]))].sort();
  ok('its markup names five handlers', J(handlers) === J(['aiSettings', 'openFigureFrom', 'toggleAI', 'toggleApexFull', 'toggleGrounded']), handlers.join(' '));
  ok('and each is a function the page declares, once', handlers.length > 0 && handlers.every(n => count('function ' + n + '(') === 1), handlers.map(n => n + ':' + count('function ' + n + '(')).join(' '));
  const IDS = ['apexAvatar', 'aiBody', 'aiLive', 'aiFigWrap', 'aiFigs', 'aiFigList', 'aiChips', 'aiMore', 'aiIn', 'aiSend'];
  ok('the ids the page finds again are each drawn once: the avatar, the conversation, the figures, the prompts, the box', IDS.every(id => times(headOf(Q) + panel(Q, HIST, { aiBusy: true }), 'id="' + id + '"') === 1) && IDS.every(id => count("getElementById('" + id + "')") >= 1 || id === 'aiFigList' || id === 'aiLive' || id === 'aiChips'), IDS.map(id => id + ':' + count("getElementById('" + id + "')")).join(' '));
  const WORDS = ['Cardiology tutor', 'Ask me anything about the item', 'Reused explanation · matching context', 'from those notes', 'Explain draft · no tools', 'Clear thread', 'called directly from this device'];
  ok('and the panel\'s own words are no longer in the page', WORDS.every(t => count(t) === 0), WORDS.map(t => count(t)).join(' '));

  /* The page's own lines over its own helpers, prompts, providers and markdown (src/core/markdown.js) and its own
     visionBadge() over the real Vision: two drawings with a thread whose notes have figures, then a third with a
     reply being written, then one where the key is gone. */
  const whole = (from, to) => { const a = page.indexOf(from); if (a < 0 || page.indexOf(from, a + 1) >= 0) return '\nthrow new Error("not in the page once: ' + from.replace(/["\\]/g, '') + '");\n'; const b = page.indexOf(to, a); return raw.slice(a, b + to.length); };
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const parts = [read('src/core/markdown.js'), read('src/core/vision.js'), whole('function icon(name, cls){', '\n}'), whole('const ESC={', '\n'), whole('const e=s=>', '\n'), whole('function clip(s,n){', '\n'),
    whole('const PROVIDERS=[', '\n];'), whole('const MODELS={', '\n};'), whole('function cur(){', '\n'), whole('function apexHosted(){', '\n}'), whole('const APEX_ASK={', '\n};'), whole('const CHIPS=[', '\n];'),
    whole('function chatFor(q){', '\n'), whole('function apexLocalHtml(){', '\n}'), whole('function apexIsFull(){', '\n}'), whole('function visionBadge(q){', '\n}'), whole('const KEY_PREFIX=', '\n'), whole('function setupHtml(p=AI.provider){', '\n}'), whole('function md(t){', '\n'),
    whole('let apexFigMemo=', '\n'), read('src/app/apexpanel.js'), whole('const apexKit=()=>', 'icon});'), whole('function buildAI(){', '\n}'), whole('function apexFigsFor(', '\n}')].join('\n');
  const log = [];
  const wrap = { innerHTML: '', querySelectorAll: () => [...wrap.innerHTML.matchAll(/data-jump="([^"]*)"/g)].map(m => ({ dataset: { jump: m[1] } })) };
  const ctx = {
    location: { protocol: 'https:' }, document: { getElementById: id => (id === 'ai' ? wrap : id === 'shell' ? { classList: { contains: c => c === 'ai-full' && ctx.FULL } } : null) },
    S: { screen: 'quiz', questions: [{ id: 'Q1', ch: 'Valves & more', n: 12, img: 1 }], qIdx: 0, answered: true }, REF: [1, 2], AI_GROUNDED: false, FULL: false,
    AI: { provider: 'gemini', gemini: { key: '', model: 'gemini-2.5-flash' }, openai: { key: '', model: '' } }, CHATS: {},
    aiBusy: false, lastHits: [{ kind: 'r', id: 'n1', title: 'Valve note' }, { kind: 'q', id: 'Q9', ch: 'Heart failure', n: 4 }], lastHitsKey: 'Q1', apexChipsOpen: false, apexFigsOpen: true,
    dueQuestions: () => [1, 2], refImgSrc: k => 'data:x/' + k,
    refFiguresForHits: (hits, n) => (log.push('figures ' + hits.map(h => h.id).join(',') + ' ' + n), [{ key: 'f1', dataUrl: 'data:image/png;base64,F1', caption: 'Valve <cap>', noteTitle: 'Valve note' }, { key: 'f2', dataUrl: 'data:image/png;base64,F2', caption: 'Placed', noteTitle: 'Valve note' }]),
    apexPanelState: () => (log.push('state'), { s: 1 }), apexPanelRestore: st => log.push('restore ' + J(st)), bindChat: q => log.push('bindChat ' + (q && q.id)), bindSetup: () => log.push('bindSetup'),
    mountApexAvatar: () => log.push('avatar'), peekQuestion: id => log.push('peek ' + id),
  };
  ctx.window = ctx; vm.createContext(ctx);
  const ask = code => { try { return vm.runInContext(code, ctx); } catch (err) { return 'THREW ' + err.message; } };
  const loaded = ask(parts + '\nCHATS.Q1=[{role:"user",content:"Why?"},{role:"assistant",content:"See refimg://f2 and **this**"}];\n"loaded"');
  log.length = 0; ask('buildAI()');
  const first = wrap.innerHTML, firstLog = log.slice();
  ok('the page\'s own buildAI() draws the panel: the question\'s chapter with what Gemini sees of its figure, the thread as markdown, the actions on this device', loaded === 'loaded' && first.includes('<div class="ai-sub">Valves &amp; more · item 12 · sees 1 figure</div>') && first.includes('<div class="msg user">Why?</div>') && first.includes('<strong>this</strong>') && first.includes('Review due cards (2)'), String(loaded).slice(0, 60) + ' · ' + g1(first, /<div class="ai-sub">([^<]*)/));
  ok('through this site\'s key, with the model\'s name and the provider\'s; the prompt for a question answered is there', /Powered by <b>[^<]+<\/b> on Gemini · hosted key, called through this site<\/div><\/div>$/.test(first) && first.includes('data-chip="2">Why did I pick that?</button>'), g1(first, /<div class="ai-powered">([\s\S]*?)<\/div><\/div>$/));
  ok('the figures from the notes drawn on, less the one the reply placed, open as the page left them', times(first, '<figure class="ai-fig"') === 1 && first.includes('alt="Valve &lt;cap&gt;"') && first.includes('<div class="fig-strip open" id="aiFigWrap">') && first.includes('1 figure from those notes'));
  ok('and the page then wires the question drawn on, binds the chat to the question, restores what it read, and starts the avatar, in that order', J(firstLog) === J(['state', 'figures n1,Q9 3', 'bindChat Q1', 'restore {"s":1}', 'avatar']), J(firstLog));
  log.length = 0; ask('buildAI()');
  ok('drawn again with nothing changed, the same panel, and the figures are not looked for again', wrap.innerHTML === first && !log.some(l => l.startsWith('figures')), J(log));
  log.length = 0; ask('aiBusy=true; buildAI()');
  ok('with a reply being written: the dots, Stop, no figures, none looked for, and the memo kept for this reply in progress', wrap.innerHTML.includes('id="aiLive"') && wrap.innerHTML.includes('aria-label="Stop generating"') && !wrap.innerHTML.includes('fig-strip') && !log.some(l => l.startsWith('figures')) && String(ask('JSON.stringify(apexFigMemo)')) === '{"key":"n1,Q9|28|1","figs":[]}', String(ask('JSON.stringify(apexFigMemo)')));
  log.length = 0; ask('aiBusy=false; location.protocol="file:"; buildAI()');
  ok('with no key and no site to call through: the setup, bound, with no conversation', wrap.innerHTML.includes('id="aiKey"') && !wrap.innerHTML.includes('id="aiBody"') && wrap.innerHTML.endsWith('check anything that changes care.</div>') && J(log) === J(['state', 'bindSetup', 'avatar']), J(log));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
