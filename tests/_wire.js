'use strict';
/*
 * Reading a request the app actually sent, without spelling the wire out in
 * every suite that looks at one.
 *
 * WHY THIS EXISTS. Until the second provider was removed, most suites mocked
 * Mistral: its OpenAI shape puts the system prompt in messages[0] and every
 * turn's text in a plain `content` string, which is the easiest thing in the
 * world to assert against. Nine suites therefore reached for it — not because
 * they were testing Mistral, but because it was the convenient wire.
 *
 * Gemini's shape is different in three ways that each broke those assertions:
 *
 *   · the system prompt travels in `systemInstruction`, not as turn zero;
 *   · turns live in `contents`, not `messages`;
 *   · a turn's text is `parts: [{text}]`, not a `content` string, and the
 *     assistant's role is spelled `model`.
 *
 * So these two functions say what a suite actually wants to know — what was
 * the system prompt, and what were the turns — and keep the wire's spelling in
 * one file instead of nine. A suite asserting on WINDOWING or on FENCING
 * should not have to care which vendor's JSON carried it.
 *
 * They are deliberately tolerant of a missing or malformed request: a suite
 * whose mock never fired should fail on the thing it was asserting, with the
 * number it actually got, rather than on a TypeError three lines earlier.
 */

/* Every text part of the system prompt, joined. */
function systemText(req) {
  const si = req && req.systemInstruction;
  if (!si) return '';
  const parts = Array.isArray(si.parts) ? si.parts : [];
  return parts.map(p => (p && p.text) || '').join('');
}

/* The conversation as [{role, content, parts}], with `model` renamed to
   `assistant` so role assertions read the same as they always did. `parts` is
   passed through untouched for the suites that need to look at an image or a
   functionCall block rather than at text. */
function turns(req) {
  const contents = (req && req.contents) || [];
  return contents.map(c => ({
    role: c.role === 'model' ? 'assistant' : c.role,
    content: ((c.parts || []).map(p => (p && p.text) || '').join('')),
    parts: c.parts || [],
  }));
}

/* The text of every functionResponse in the request — the tool results the app
   sent back. Named for what it is rather than for Gemini's spelling, because
   the suites that read it are testing the fence around tool output. */
function toolResults(req) {
  const out = [];
  for (const c of (req && req.contents) || []) {
    for (const p of c.parts || []) {
      const fr = p && p.functionResponse;
      if (fr) out.push(String((fr.response && fr.response.content) || ''));
    }
  }
  return out;
}

module.exports = { systemText, turns, toolResults };
