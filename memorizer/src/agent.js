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
     mistake   — why the recent misses happened, by error type, and the fix
     round     — a review round of the weak items, begun
     schedule  — the cards due each day this week
   It REMEMBERS the topic, so "quiz me on that", "why?" or "more" carry on
   from the last answer; and, across sessions, which tools are used and the
   book's section titles they landed on (remember / profileLine) — never
   what was typed.

   Without the on-device model, a set of rules over the message (plan())
   picks each step's tool; a message may be several steps (clauses /
   afterStep, below). The tools answer from the book.

   With the on-device model running, the model drives instead (run()): it
   sees the message, what is remembered and each tool's result so far, and
   names the next tool or answers, up to MODEL_STEPS tools. A step is used
   only if it names a real tool; the answer is shown only sentence by
   sentence as it holds to the results it cites (ground.js). A first reply
   that is not a usable step hands the message to the rules' loop.
   tests/verify-memorizer-agent-pure.js holds it.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

function askMod() { return root.MemAsk || (typeof require === 'function' ? require('./ask.js') : null); }

var TOOLS = ['help', 'mistake', 'round', 'weak', 'schedule', 'plan', 'review', 'quiz', 'compare', 'mnemonic', 'numbers', 'explain', 'open', 'search'];
/* In order: the first that matches wins. Each one's words are removed from
   the message to leave its topic. */
var RULES = [
  ['help', /^\s*(?:help|hi|hello|hey|what can you do|who are you)\b[\s?!.]*$/i],
  ['mistake', /\b(?:why (?:did|do) i (?:get|keep getting|keep missing|miss)|explain my (?:mistakes?|misses|errors?)|my (?:mistakes?|misses|errors?))\b/i],
  ['round', /\b(?:review round|round of (?:my )?weak|re-?test (?:my )?weak|drill my weak)\b/i],
  ['weak', /\b(?:weak(?:est)?|shakiest|struggl\w*|where am i (?:bad|weak)|what do i (?:get wrong|miss))\b/i],
  ['schedule', /\b(?:schedule|this week|tomorrow|next few days|when (?:is|are) (?:my )?(?:next )?(?:cards?|reviews?) due)\b/i],
  ['plan', /\b(?:what should i (?:study|learn|do|revise)|study plan|plan (?:for )?(?:today|my day)|what(?:'s| is) next|where do i start)\b/i],
  ['review', /\b(?:review|due cards?|flash ?cards?|revise my cards)\b/i],
  ['quiz', /\b(?:quiz|test|drill|ask) me\b|\bmcqs?\b|\bquestions? (?:on|about)\b/i],
  ['compare', /\b(?:compare|comparison|difference(?:s)? between|differ(?:s|ence)?|versus|vs\.?)\b/i],
  ['mnemonic', /\b(?:mnemonics?|how (?:do|can) i remember|help me remember)\b/i],
  ['numbers', /\b(?:numbers?|values?|thresholds?|cut-?offs?|criteria)\b(?: (?:to know|for|of|in))?/i],
  ['explain', /^\s*(?:explain|tell me about|describe|summari[sz]e|give me an overview of|overview of|teach me about)\b/i],
  ['open', /^\s*(?:open|teach me|learn|study|go to|take me to)\b/i],
];
var FILLER = /\b(?:please|give|show|list|me|the|a|an|on|about|of|for|in|to|and|my|this|that|it|them|those|these|one|section|chapter|topic|can you|could you|would you|i want|let'?s|now|again)\b/gi;
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

/* A step the model names: used only when it names one of the tools. */
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
    case 'mistake': return 'Why your recent misses happened, and what fixes each kind.';
    case 'round': return 'A review round of what you still get wrong, mixed.';
    case 'schedule': return 'Your cards due each day this week.';
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

/* ── the loop: several steps, each decided by what the last one found ────
   A message may ask for more than one thing ("explain aortic stenosis and
   quiz me on it"): clauses() splits it into steps, and each step is planned
   when its turn comes, with the memory the step before left — so "it" in
   the second is the section the first found. After each step, afterStep()
   looks at what it found and decides whether to act again:
     · a topic found neither by title nor by words, with search by meaning
       on → search by meaning, then the same tool on the section that finds;
     · a quiz, numbers or mnemonic with nothing in it → explain that section;
     · else stop.
   Each recovery happens once. MAX_STEPS bounds the whole message. */
var MAX_STEPS = 3;
function clauses(text) {
  var parts = String(text || '').split(/\s*(?:,?\s*\band then\b|,?\s*\bthen\b|;)\s*/i);
  var out = [];
  parts.forEach(function (p) {
    /* "… and quiz me": an "and" followed by a request of its own */
    var bits = p.split(/\s+and\s+(?=(?:quiz|test|drill|ask)\s+me\b|(?:explain|compare|open|teach|show|give|tell|list)\b|(?:the\s+)?(?:mnemonics?|numbers?)\b)/i);
    bits.forEach(function (b) { b = b.trim().replace(/^[,.]\s*/, ''); if (b) out.push(b); });
  });
  return out.slice(0, MAX_STEPS);
}
/* obs: { missing, empty, section (title found, or ''), meaning (search by
   meaning is on) }. Returns the next plan, or null. */
function afterStep(p, obs) {
  var o = obs || {};
  if (p.recovered) return p.then && o.section ? { tool: p.then, topic: o.section, recovered: true, because: 'found by meaning' } : null;
  if (o.missing && p.topic && o.meaning && /^(?:explain|quiz|mnemonic|numbers|open)$/.test(p.tool)) {
    return { tool: 'search', topic: p.topic, meaningOnly: true, then: p.tool, recovered: true, because: 'not found by its words' };
  }
  if (o.empty && o.section && /^(?:quiz|mnemonic|numbers)$/.test(p.tool)) {
    return { tool: 'explain', topic: o.section, recovered: true, because: 'no ' + (p.tool === 'quiz' ? 'questions' : p.tool === 'numbers' ? 'numbers' : 'mnemonic') + ' in it' };
  }
  return null;
}

/* ── the agent loop: several tools, then an answer held to the book ──────
   With the on-device model on, the Coach is a loop rather than a router:
   the model is shown the message, what it remembers of the student, and
   the result of each tool so far, and replies with ONE next step — a tool
   to use, or its answer. Up to MODEL_STEPS tools; then it must answer.
   Everything the tools show comes from the book (or the student's own
   record); the model's closing answer is shown only sentence by sentence
   as it passes ground.js against the tool results it cites, like the
   summary does. When the model's first reply is not a usable step the
   rules decide, as before; a later bad reply ends the loop with the tools'
   results standing. A tool that hands the student to a screen (open,
   round) or needs nothing more (help) ends it too, and so does the same
   tool asked for the same topic twice. */
var MODEL_STEPS = 4;
var TERMINAL = ['open', 'round', 'help'];
var DESCRIBE = {
  search: 'what the book says on a question',
  explain: 'a section in one line, how it works, its key facts',
  quiz: 'three questions on a topic, for the student to answer',
  compare: 'two topics side by side (give "topics")',
  mnemonic: 'the mnemonics of a topic',
  numbers: 'the numbers to know in a topic',
  open: 'open a section to learn it (ends the turn)',
  weak: 'the items the student still gets wrong, with their error type',
  mistake: 'why the student’s recent misses happened, by error type, and the fix',
  plan: 'what to study now',
  review: 'the flashcards due today',
  round: 'start a review round of the weak items (ends the turn)',
  schedule: 'the cards due each day this week',
  help: 'what the coach can do (ends the turn)',
};
var OBS_CHARS = 600;
function clip(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function loopPrompt(message, memory, profile, steps) {
  var st = steps || [], last = st.length >= MODEL_STEPS;
  return 'You are the coach in a study app. You help a student by using tools on their own textbook, one tool at a time, and then answering.\n' +
    'Tools:\n' + TOOLS.map(function (t) { return '- ' + t + ': ' + DESCRIBE[t]; }).join('\n') + '\n' +
    (profile ? 'About the student: ' + profile + '\n' : '') +
    (memory && memory.topic ? 'The last topic was: ' + memory.topic + '.\n' : '') +
    'Message: ' + clip(message, 300) + '\n' +
    st.map(function (s, i) {
      return 'Step ' + (i + 1) + ': used ' + s.plan.tool + (s.plan.topics && s.plan.topics.length ? ' on "' + s.plan.topics.join('" and "') + '"' : s.plan.topic ? ' on "' + s.plan.topic + '"' : '') +
        '.\nResult [' + (i + 1) + ']: ' + (s.observation || 'nothing found');
    }).join('\n') + (st.length ? '\n' : '') +
    (last ? 'You may use no more tools. Answer now.\n' : 'Use a tool when you need one; answer when the results are enough. At most ' + MODEL_STEPS + ' tools.\n') +
    'Reply as JSON: ' + (last ? '' : '{"action":"tool","tool":one of the tools,"topic":a few words or "","topics":two topics for compare, else []} or ') +
    '{"action":"answer","answer":"2 to 4 short sentences using only the results, each ending with the number of the result it comes from, like [1]"}';
}
var LOOP_SCHEMA = { type: 'object', properties: { action: { type: 'string' }, tool: { type: 'string' }, topic: { type: 'string' },
  topics: { type: 'array', items: { type: 'string' } }, answer: { type: 'string' } }, required: ['action'] };

/* One step of the model's: { action: 'tool', plan } or { action: 'answer',
   text }, or null for anything else. A tool must be a real one. */
function parseStep(reply) {
  var v;
  try { v = JSON.parse(String(reply)); } catch (_) { return null; }
  if (!v || typeof v !== 'object') return null;
  if (v.action === 'answer') return typeof v.answer === 'string' && v.answer.trim() ? { action: 'answer', text: v.answer.trim().slice(0, 1200) } : null;
  if (v.action !== 'tool') return null;
  var p = parsePlan(JSON.stringify(v));
  return p ? { action: 'tool', plan: p } : null;
}

/* The loop. o.think(prompt) → the model's reply; o.act(plan) → { observation,
   turn } (the tool used on the book); o.check(text, observations) →
   { kept, dropped } (ground.js); o.memory, o.profile. Resolves to
   { steps: [{ plan, observation, turn }], answer: { kept, dropped } | null,
   by: 'ai' | 'rules', why }. */
function run(message, o) {
  var steps = [], seen = {};
  var rules = function (why) {
    if (o.rules) return Promise.resolve(o.rules(why)).then(function () { return { steps: steps, answer: null, by: 'rules', why: why }; });
    var p = plan(message, o.memory || {});
    return Promise.resolve(o.act(p)).then(function (r) {
      steps.push({ plan: p, observation: r && r.observation || '', turn: r && r.turn });
      return { steps: steps, answer: null, by: 'rules', why: why };
    });
  };
  if (!o.think) return rules('no model');
  var step = function () {
    return Promise.resolve().then(function () { return o.think(loopPrompt(message, o.memory, o.profile, steps)); })
      .then(null, function () { return null; })
      .then(function (reply) {
        var s = parseStep(reply);
        var last = steps.length >= MODEL_STEPS;
        if (!s || (last && s.action !== 'answer')) return steps.length ? { steps: steps, answer: null, by: 'ai', why: 'unusable reply' } : rules('unusable reply');
        if (s.action === 'answer') {
          /* an answer with no tool used rests on nothing: the rules decide */
          if (!steps.length) return rules('answered without the book');
          return { steps: steps, answer: o.check(s.text, steps.map(function (x) { return x.observation; })), by: 'ai', why: 'answered' };
        }
        var key = s.plan.tool + '|' + (s.plan.topics || []).join('+') + '|' + s.plan.topic.toLowerCase();
        if (seen[key]) return { steps: steps, answer: null, by: 'ai', why: 'repeated a tool' };
        seen[key] = true;
        return Promise.resolve(o.act(s.plan)).then(function (r) {
          steps.push({ plan: s.plan, observation: clip(r && r.observation, OBS_CHARS), turn: r && r.turn });
          if (TERMINAL.indexOf(s.plan.tool) !== -1) return { steps: steps, answer: null, by: 'ai', why: 'ended by ' + s.plan.tool };
          return step();
        });
      });
  };
  return step();
}

/* ── what a tool's result tells the model: short, and from the book ──── */
function observe(tool, t) {
  t = t || {};
  var pg = function (n) { return n ? ' (p.' + n + ')' : ''; };
  switch (tool) {
    case 'search':
      if (!t.r || !t.r.found) return 'Not found in the book.';
      return t.r.groups.reduce(function (a, g) { return a.concat(g.items); }, []).slice(0, 3).map(function (it) { return it.text + pg(it.page); }).join(' ');
    case 'explain':
      if (!t.explain) return 'Not found in the book.';
      return [t.title ? t.title + ':' : '', t.explain.gist, t.explain.chain].concat(t.explain.facts.slice(0, 3)).filter(Boolean).join(' ');
    case 'quiz': return t.quiz ? 'Showed ' + t.quiz.length + ' questions on ' + t.title + ' for the student to answer.' : 'Not found in the book.';
    case 'mnemonic':
      if (!t.mnemonics) return 'Not found in the book.';
      return t.mnemonics.length ? t.mnemonics.map(function (m) { return m.title + ': ' + m.letters + ' = ' + m.words.join(', '); }).join('. ') : 'No mnemonics in ' + t.title + '.';
    case 'numbers':
      if (!t.sheet) return 'Not found in the book.';
      return t.sheet.numbers.length ? [].concat.apply([], t.sheet.numbers.map(function (n) { return n.tiles.map(function (x) { return x.value + ' ' + x.label; }); })).join('; ') : 'No numbers in ' + t.title + '.';
    case 'compare':
      return t.rows && t.rows.length ? t.rows.map(function (r) { return r.title + ': ' + r.bigIdea; }).join(' ') : 'Not found in the book.';
    case 'weak':
      return (t.items && t.items.length ? t.items.map(function (w) { return w.name + ': ' + w.line; }).join(' ') : 'No weak items.') +
        (t.spots && t.spots.length ? ' Weakest sections: ' + t.spots.map(function (s) { return s.title + ' ' + s.pct + '%'; }).join(', ') + '.' : '');
    case 'mistake':
      return t.mistakes && t.mistakes.length ? t.mistakes.map(function (m) { return m.label + ': Type ' + m.type + ' (' + m.name + ') — ' + m.means + ' Fix: ' + m.fix; }).join(' ') : 'No misses yet.';
    case 'plan': return t.planText || 'Nothing to suggest yet.';
    case 'review': return (t.due || 0) + ' cards due today.';
    case 'schedule': return t.week ? t.week.map(function (d) { return d.label + ' ' + d.n; }).join(', ') + '.' : 'No cards yet.';
    case 'round': return t.started ? 'Started a review round of ' + t.n + ' weak items in ' + t.name + '.' : 'Nothing is on the weak list.';
    case 'open': return t.title ? 'Opened ' + t.title + '.' : 'Not found in the book.';
    default: return 'Showed what the coach can do.';
  }
}

/* The misses to explain: every item still weak, latest first, its last
   error type with what that type means and its fix (skill.js). */
function mistakes(docs, sessions, max) {
  var Skill = root.MemSkill || (typeof require === 'function' ? require('./skill.js') : null);
  var out = [];
  (docs || []).forEach(function (d) {
    var st = sessions && sessions[d.id];
    Object.keys((st && st.weak) || {}).forEach(function (k) {
      var w = st.weak[k];
      if (Skill.graduated(w) || !w.types || !w.types.length) return;
      var type = w.types[w.types.length - 1], E = Skill.ERRORS[type];
      out.push({ docId: d.id, label: w.label, type: type, name: E.name, means: E.means, fix: E.fix, misses: w.misses,
                 confusedWith: type === 'C' ? w.confusedWith || '' : '', order: w.order, cluster: w.cluster });
    });
  });
  out.sort(function (a, b) { return b.order - a.order; });
  return out.slice(0, max || 3);
}

/* The cards due each day for a week from today (an ISO date): overdue and
   new cards count as today. Dates are stepped in UTC, so no clock change
   moves one. */
function addDays(iso, n) {
  var p = String(iso).split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}
function schedule(cards, today) {
  var week = [];
  for (var i = 0; i < 7; i++) week.push({ day: addDays(today, i), n: 0, label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : addDays(today, i) });
  (cards || []).forEach(function (c) {
    var due = c.srs && c.srs.due ? c.srs.due : today;
    if (due <= today) { week[0].n++; return; }
    for (var j = 1; j < 7; j++) if (week[j].day === due) { week[j].n++; return; }
  });
  return week;
}

/* ── what the coach remembers of the student, on this device ──────────
   Which tools are used most, and the book's own section titles the tools
   landed on — never what the student typed. profileLine() is what the
   model is told; the Coach screen shows it, with a button to forget. */
var PROFILE_TOPICS = 5;
function remember(profile, tool, titles) {
  var pr = profile && profile.v === 1 ? { v: 1, topics: profile.topics.slice(), tools: Object.assign({}, profile.tools), turns: profile.turns } : { v: 1, topics: [], tools: {}, turns: 0 };
  pr.turns++;
  if (tool && TOOLS.indexOf(tool) !== -1) pr.tools[tool] = (pr.tools[tool] || 0) + 1;
  (titles || []).forEach(function (t) {
    var x = String(t || '').trim().slice(0, 80);
    if (!x) return;
    pr.topics = [x].concat(pr.topics.filter(function (y) { return y !== x; })).slice(0, PROFILE_TOPICS);
  });
  return pr;
}
var LIKES = { quiz: 'being quizzed', explain: 'explanations', compare: 'comparisons', mnemonic: 'mnemonics', numbers: 'numbers to know', review: 'flashcards', round: 'review rounds' };
function profileLine(profile, weakLine) {
  var bits = [];
  if (profile && profile.v === 1) {
    if (profile.topics.length) bits.push('recently asked about ' + profile.topics.join(', '));
    var top = Object.keys(profile.tools).filter(function (k) { return LIKES[k]; }).sort(function (a, b) { return profile.tools[b] - profile.tools[a] || (a < b ? -1 : 1); })[0];
    if (top && profile.tools[top] >= 2) bits.push('likes ' + LIKES[top]);
  }
  if (weakLine) bits.push(weakLine.replace(/^Weak: /, 'still weak on '));
  return bits.length ? bits.join('; ') + '.' : '';
}

var MemAgent = { MODEL_STEPS: MODEL_STEPS, TERMINAL: TERMINAL, DESCRIBE: DESCRIBE, loopPrompt: loopPrompt, LOOP_SCHEMA: LOOP_SCHEMA, parseStep: parseStep, run: run,
  observe: observe, mistakes: mistakes, schedule: schedule, addDays: addDays, remember: remember, profileLine: profileLine, PROFILE_TOPICS: PROFILE_TOPICS,
  MAX_STEPS: MAX_STEPS, clauses: clauses, afterStep: afterStep, weakItems: weakItems, TOOLS: TOOLS, RULES: RULES, topicOf: topicOf, plan: plan, parsePlan: parsePlan, findSection: findSection, say: say };
root.MemAgent = MemAgent;
if (typeof module !== 'undefined' && module.exports) module.exports = MemAgent;
})(typeof window !== 'undefined' ? window : this);
