'use strict';
/*
 * A cancelled Apex response cannot execute tools or persist a partial conversation.
 *
 *   node tests/verify-apex-cancel.js
 *
 * The model's reply arrives just as Stop is pressed: it carries a tool call, and the turn's AbortController
 * has fired. Nothing of it may act: no tool runs and nothing is saved.
 *
 * The loop that runs a turn is run() in src/core/apexturn.js. Until it moved there (roadmap E1) it was
 * streamReply() in app/systole.html, and this suite cut it out of the page by name; it now loads the module
 * and gives the loop a page of its own. That the page's streamReply() hands run() the page's own state and
 * parts is held by tests/verify-apexloop-pure.js.
 *
 * Each check prints its own line. The first version asserted, so the first failure ended the run and the
 * second was never asked.
 */
const { ApexTurn } = require('../src/core/apexturn.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};

let actions = 0, saves = 0;
const st = ApexTurn.state();
const page = {
  AbortController, groundedBudget: 31200, wire: () => [], setState: () => {}, save: () => saves++, away: () => false,
  runTool: () => { actions++; return { result: 'done' }; }, exchange: () => {}, grounded: () => false, render: () => {}, flush: () => {},
  /* No words and one call: had the turn not been stopped, the call alone would be saved and run. */
  oneTurn: async () => { st.abort.abort(); return { text: '', calls: [{ name: 'save_note', input: {} }] }; },
};

(async () => {
  try { await ApexTurn.run(st, page, null, [], ''); } catch (e) { console.log('  the loop threw: ' + e.message); }
  ok('a cancelled response does not execute its tools', actions === 0, `${actions} tool run(s)`);
  ok('and does not save a partial exchange', saves === 0, `${saves} save(s)`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
