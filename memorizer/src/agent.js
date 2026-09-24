/* ═══════════════════════════════════════════════════════════════════════════
   agent.js — the Coach as an agent: it reads what you ask, picks a tool,
   uses it on your book, and answers in the conversation.

   PURE. The owner asked for a Coach "like an LLM AI agent". An agent is a
   loop: understand the message, choose an action, act, answer, remember.
   Here the actions are the app's own tools, each working on the owner's
   book and nothing else:
     search    — the book's own sentences on a question (ask.js)
     explain   — a section in one line, its cause and effect, what is asked
                 most, its mnemonics (coach.js explainSection)
     quiz      — three questions on a section, answered in the chat
     compare   — two sections side by side: big idea, numbers, mnemonic
     mnemonic  — a section's mnemonics
     numbers   — a section's numbers to know
     open      — open a section to learn it
     weak      — where the sessions say you are shakiest
     plan      — what to study now
     review    — the cards due today
     help      — what it can do
   And it REMEMBERS the topic, so "quiz me on that", "why?" or "more" carry
   on from the last answer.

   Choosing the tool: a set of rules over the message (plan()), always; and,
   when the on-device model is on, the model is asked first (planPrompt /
   parsePlan) and its choice is used only if it names a real tool — a model
   that answers anything else falls back to the rules. Nothing the model
   writes is shown here: the tools answer from the book.
   tests/verify-memorizer-agent-pure.js holds it.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

function askMod() { return root.MemAsk || (typeof require === 'function' ? require('./ask.js') : null); }

var TOOLS = ['help', 'weak', 'plan', 'review', 'quiz', 'compare', 'mnemonic', 'numbers', 'explain', 'open', 'search'];
/* In order: the first that matches wins. Each one's words are removed from
   the message to leave its topic. */
var RULES = [
  ['help', /^\s*(?:help|hi|hello|hey|what can you do|who are you)\b[\s?!.]*$/i],
  ['weak', /\b(?:weak(?:est)?|shakiest|struggl\w*|where am i (?:bad|weak)|what do i (?:get wrong|miss))\b/i],
  ['plan', /\b(?:what should i (?:study|learn|do|revise)|study plan|plan (?:for )?(?:today|my day)|what(?:'s| is) next|where do i start)\b/i],
  ['review', /\b(?:review|due cards?|flash ?cards?|revise my cards)\b/i],
  ['quiz', /\b(?:quiz|test|drill|ask) me\b|\bmcqs?\b|\bquestions? (?:on|about)\b/i],
  ['compare', /\b(?:compare|comparison|difference(?:s)? between|differ(?:s|ence)?|versus|vs\.?)\b/i],
  ['mnemonic', /\b(?:mnemonics?|how (?:do|can) i remember|help me remember)\b/i],
  ['numbers', /\b(?:numbers?|values?|thresholds?|cut-?offs?|criteria)\b(?: (?:to know|for|of|in))?/i],
  ['explain', /^\s*(?:explain|tell me about|describe|summari[sz]e|give me an overview of|overview of|teach me about)\b/i],
  ['open', /^\s*(?:open|teach me|learn|study|go to|take me to)\b/i],
];
var FILLER = /\b(?:please|me|the|a|an|on|about|of|for|in|to|and|my|this|that|it|them|those|these|one|section|chapter|topic|can you|could you|would you|i want|let'?s|now|again)\b/gi;
var FOLLOW = /^\s*(?:it|that|this|them|those|these|more|again|why|how|same|the same)?\s*[?.!]*\s*$/i;

function topicOf(text, rule) {
  var t = String(text || '');
  if (rule) t = t.replace(rule, ' ');
  t = t.replace(/[?!.,;:"“”]/g, ' ').replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  return t;
}

/* What the message asks for, by the rules: { tool, topic, topics? }. A
   message that is only a follow-up ("why?", "more", "quiz me on that")
   takes its topic from memory. */
function plan(text, memory) {
  var mem = memory || {};
  var t = String(text || '').trim();
  if (!t) return { tool: 'help', topic: '' };
  for (var i = 0; i < RULES.length; i++) {
    var r = RULES[i];
    if (!r[1].test(t)) continue;
    var out = { tool: r[0], topic: topicOf(t, r[1]) };
    if (r[0] === 'compare') {
      /* split the message itself — the filler words include "and" */
      var parts = t.split(/\s+(?:and|with|vs\.?|versus|or)\s+|\s*,\s*/i).map(function (x) { return topicOf(x, r[1]); }).filter(Boolean);
      out.topics = parts.slice(0, 2);
      if (out.topics.length === 1 && mem.topic) out.topics.unshift(mem.topic);
    }
    if (!out.topic && /quiz|explain|mnemonic|numbers|open|compare/.test(r[0])) out.topic = mem.topic || '';
    return out;
  }
  /* "why?", "more", "that one" — carry on from the last topic */
  if (FOLLOW.test(t) && mem.topic) return { tool: /why|how/i.test(t) ? 'explain' : 'search', topic: mem.topic };
  return { tool: 'search', topic: t };
}

/* The on-device model's plan: asked for JSON, and used only when it names
   one of the tools. */
function planPrompt(text, memory) {
  return 'You route a student’s message to one tool of a study app. Tools: ' + TOOLS.join(', ') + '.\n' +
    'search: a question about the book. explain: explain a topic. quiz: questions on a topic. compare: two topics. mnemonic, numbers: of a topic. ' +
    'open: start learning a topic. weak: weakest areas. plan: what to study now. review: due flashcards. help: greetings or what the app can do.\n' +
    (memory && memory.topic ? 'The last topic was: ' + memory.topic + '.\n' : '') +
    'Message: ' + String(text) + '\nReply as JSON: {"tool": one of the tools, "topic": the topic in a few words, or "", "topics": two topics for compare, else []}';
}
var PLAN_SCHEMA = { type: 'object', properties: { tool: { type: 'string' }, topic: { type: 'string' }, topics: { type: 'array', items: { type: 'string' } } }, required: ['tool'] };
function parsePlan(reply) {
  var v;
  try { v = JSON.parse(String(reply)); } catch (_) { return null; }
  if (!v || TOOLS.indexOf(v.tool) === -1) return null;
  var topic = typeof v.topic === 'string' ? v.topic.trim().slice(0, 80) : '';
  var out = { tool: v.tool, topic: topic, by: 'ai' };
  if (v.tool === 'compare') {
    out.topics = (Array.isArray(v.topics) ? v.topics : []).filter(function (x) { return typeof x === 'string' && x.trim(); }).map(function (x) { return x.trim().slice(0, 80); }).slice(0, 2);
    if (out.topics.length < 2) return null;
  }
  return out;
}

/* The section a topic means: one whose title shares the most of its words,
   else the best section for it as a question (ask.js). -1 if none. */
function findSection(idx, topic) {
  var words = String(topic || '').toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2; });
  if (!idx || !words.length) return -1;
  /* the most of the topic's words; of equals, the title with least else in it */
  var best = -1, bestScore = 0, bestLen = Infinity;
  idx.sections.forEach(function (s, i) {
    var title = String(s.title || '').toLowerCase();
    var n = words.filter(function (w) { return title.indexOf(w) !== -1; }).length;
    var score = n / words.length;
    if (n && (score > bestScore || score === bestScore && title.length < bestLen)) { best = i; bestScore = score; bestLen = title.length; }
  });
  if (best !== -1 && bestScore >= 0.5) return best;
  var r = askMod().ask(idx, topic);
  return r.found && r.sections.length ? r.sections[0] : best;
}

/* What the coach says before its tool's result: short, and about the book. */
function say(p, title) {
  var t = title ? '“' + title + '”' : '';
  switch (p.tool) {
    case 'help': return 'I’m your coach. Ask me anything about your book, or: explain a topic, quiz me, compare two topics, give me the mnemonics or numbers, what should I study, where am I weak.';
    case 'weak': return 'Here is where your answers say you are shakiest.';
    case 'plan': return 'Here is what I’d do next.';
    case 'review': return 'Your cards due today.';
    case 'quiz': return t ? 'Three questions on ' + t + '. Answer them here.' : 'Tell me the topic to be quizzed on.';
    case 'compare': return t ? 'Side by side: ' + t + '.' : 'Tell me the two topics to compare.';
    case 'mnemonic': return t ? 'The mnemonics for ' + t + '.' : 'Tell me the topic.';
    case 'numbers': return t ? 'The numbers to know in ' + t + '.' : 'Tell me the topic.';
    case 'explain': return t ? t + ', as your book tells it.' : 'Tell me what to explain.';
    case 'open': return t ? 'Opening ' + t + '.' : 'Tell me what to open.';
    default: return 'From your book:';
  }
}

/* The item-level weak list (the Supreme Memorizer rule, skill.js), unit by
   unit: what "where am I weak" names besides the weakest sections — each
   item still weak, with its error type and how often it was missed. An
   item that has graduated is not weak; a unit with nothing weak is left
   out. */
function weakItems(docs, sessions, max) {
  var Skill = root.MemSkill || (typeof require === 'function' ? require('./skill.js') : null);
  var out = [];
  (docs || []).forEach(function (d) {
    var st = sessions && sessions[d.id];
    var items = st && st.weak ? Object.keys(st.weak).map(function (k) { return st.weak[k]; }) : [];
    var open = items.filter(function (w) { return !Skill.graduated(w); });
    if (!open.length) return;
    out.push({ docId: d.id, name: d.name, line: Skill.weakLine(open, max || 3), n: open.length,
               review: open.filter(function (w) { return w.source !== 'exam'; }).length });
  });
  return out.sort(function (a, b) { return b.n - a.n; });
}

var MemAgent = { weakItems: weakItems, TOOLS: TOOLS, RULES: RULES, topicOf: topicOf, plan: plan, planPrompt: planPrompt, PLAN_SCHEMA: PLAN_SCHEMA, parsePlan: parsePlan, findSection: findSection, say: say };
root.MemAgent = MemAgent;
if (typeof module !== 'undefined' && module.exports) module.exports = MemAgent;
})(typeof window !== 'undefined' ? window : this);
