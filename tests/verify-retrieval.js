#!/usr/bin/env node
/*
 * How well the library actually retrieves, as a number.
 *
 *   node tests/verify-retrieval.js [build/systole.html]
 *
 * WHY THIS EXISTS. The adoption plan proposed replacing the hand-rolled index
 * with MiniSearch, gated on "measurably better recall — not 'feels better'".
 * There was no way to measure either side, so the gate could not be applied
 * and the swap would have gone in on vibes. This is the measurement.
 *
 * It is known-item retrieval: a query built out of a note's own material
 * should return that note. No relevance judgements are invented — the ground
 * truth is the note's identity. Four query shapes, because the engines that
 * were compared here disagree depending on shape, and the disagreement is the
 * whole finding:
 *
 *   exact    the note's title, as written
 *   typo     the title with one adjacent-character transposition
 *   prefix   the title with every word truncated to five characters
 *   body     twelve words from the middle of the note's own prose, title
 *            nowhere in the query
 *
 * WHAT THE MEASUREMENT SAID. Against MiniSearch 7.2.0 over the same 785-doc
 * corpus with the app's own clinical tokeniser:
 *
 *              R@1 today   R@1 MiniSearch
 *   exact         95.9%        100.0%
 *   typo          91.1%        100.0%
 *   prefix        54.1%         99.3%
 *   body          99.3%         90.4%
 *
 * MiniSearch wins three of four and loses the fourth. That fourth is the one
 * production issues: groundedContext searches on the fellow's chat text
 * repeated three times plus 160 characters of question stem, which is a long
 * prose query, not a title. So the swap was not made.
 *
 * THE `prefix` GAP WAS THEN CLOSED WITHOUT IT. Chain step 72 completes query
 * tokens the index has never seen — at most two completions, nearest in
 * length first — which took that column from 54.1% to 80.1% and its ten empty
 * result sets to zero, for fifteen lines and 0.44 ms per query. Not 99%: that
 * needs prefix matching inside the ranker rather than terms OR-ed into the
 * query. It is the cheap 26 points, and it cost no dependency and no bytes
 * worth measuring.
 *
 * The floors below are a REGRESSION GUARD, set roughly one point under
 * today's measured values. One point, not five, because the measurement is
 * deterministic — there is no run-to-run noise for a wide margin to absorb,
 * and a slack floor is not a guard: the first draft of this file sat 3-4
 * points low, and removing the reference-note boost from the shipped ranking
 * moved `body` from 99.3% to 97.3% without turning a single check red.
 *
 * They are not a target to tune towards, and per standing discipline they are
 * never to be lowered to accommodate a regression: a number that drops is a
 * finding about retrieval, not about this file.
 */
'use strict';
const path = require('path');
const { launch } = require('./_engine');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const pct = x => (x * 100).toFixed(1) + '%';

const TARGET = process.argv[2] || path.join(__dirname, '..', 'build', 'systole.html');

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto('file://' + path.resolve(TARGET));
  await page.waitForFunction(
    () => typeof S !== 'undefined' && typeof search === 'function' && typeof REF !== 'undefined',
    { timeout: 120000 });

  const r = await page.evaluate(() => {
    const notes = REF.filter(x => x && x.title && x.title.trim().length > 6);
    const transpose = s => {
      const w = s.split(/\s+/);
      let li = 0; for (let i = 1; i < w.length; i++) if (w[i].length > w[li].length) li = i;
      const t = w[li]; if (t.length < 4) return s;
      const i = Math.floor(t.length / 2);
      w[li] = t.slice(0, i) + t[i + 1] + t[i] + t.slice(i + 2);
      return w.join(' ');
    };
    const truncate = s => s.split(/\s+/).map(x => x.length > 5 ? x.slice(0, 5) : x).join(' ');
    const midWindow = x => {
      const w = String(x.body || '').split(/\s+/).filter(Boolean);
      if (w.length < 24) return '';
      return w.slice(Math.floor(w.length / 2) - 6, Math.floor(w.length / 2) + 6).join(' ');
    };

    const sets = {
      exact:  notes.map(x => ({ q: x.title, id: x.id })),
      typo:   notes.map(x => ({ q: transpose(x.title), id: x.id })),
      prefix: notes.map(x => ({ q: truncate(x.title), id: x.id })),
      body:   notes.map(x => ({ q: midWindow(x), id: x.id })).filter(x => x.q),
    };

    /* Retrieved the way groundedContext really does it: a generous limit, then
       filter to notes. A limit of ten would measure something the app never
       does — the index also holds 639 questions competing for those places. */
    const run = q => search(q, { limit: 40 })
      .filter(h => h.meta.kind === 'r').slice(0, 10).map(h => h.meta.id);

    const measure = set => {
      let r1 = 0, r5 = 0, mrr = 0, empty = 0;
      for (const { q, id } of set) {
        let ids; try { ids = run(q); } catch (e) { ids = []; }
        if (!ids.length) empty++;
        const k = ids.indexOf(id);
        if (k === 0) r1++;
        if (k > -1 && k < 5) r5++;
        if (k > -1) mrr += 1 / (k + 1);
      }
      const n = set.length;
      return { n, r1: r1 / n, r5: r5 / n, mrr: mrr / n, empty };
    };

    const out = { notes: notes.length, docs: notes.length + ALL_Q.length };
    for (const k of Object.keys(sets)) out[k] = measure(sets[k]);
    return out;
  });

  head('the corpus is the one production searches');
  ok('the reference library is loaded', r.notes > 100, `${r.notes} notes`);
  ok('and the questions are in the same index', r.docs > 700, `${r.docs} documents`);
  ok('every query shape produced a usable set',
     r.exact.n === r.notes && r.typo.n === r.notes && r.prefix.n === r.notes && r.body.n > 100,
     `exact ${r.exact.n}, typo ${r.typo.n}, prefix ${r.prefix.n}, body ${r.body.n}`);

  head('a note is found from its own title');
  ok('R@1 at or above 0.95', r.exact.r1 >= 0.95, pct(r.exact.r1));
  ok('R@5 at or above 0.99', r.exact.r5 >= 0.99, pct(r.exact.r5));
  ok('and nothing comes back empty', r.exact.empty === 0, String(r.exact.empty));

  head('a typed-in-a-hurry title still finds it');
  ok('R@1 at or above 0.90 with one transposition', r.typo.r1 >= 0.90, pct(r.typo.r1));
  ok('R@5 at or above 0.97', r.typo.r5 >= 0.97, pct(r.typo.r5));

  head('a half-typed title completes to the note');
  ok('R@1 at or above 0.79 on truncated terms', r.prefix.r1 >= 0.79, pct(r.prefix.r1));
  /* Zero, not "few". Returning nothing at all is a different failure from
     ranking badly: it tells the fellow their library does not cover something
     it does cover. Ten of 146 did that before step 72. */
  ok('and NONE of them returns nothing at all', r.prefix.empty === 0,
     `${r.prefix.empty} empty of ${r.prefix.n}`);

  head('prose from the note itself — the shape production actually sends');
  ok('R@1 at or above 0.98', r.body.r1 >= 0.98, pct(r.body.r1));
  ok('R@5 at or above 0.99', r.body.r5 >= 0.99, pct(r.body.r5));
  ok('and nothing comes back empty', r.body.empty === 0, String(r.body.empty));

  head('completion fires only where there was nothing to complete');
  {
    /* The safety property, stated directly rather than inferred from the
       scores above: a token the index knows is returned untouched. If that
       ever stops being true, every query that works today is being rewritten,
       and the three unchanged columns above would be the last place it
       showed. */
    const probe = await page.evaluate(() => {
      search('warm the index', { limit: 1 });
      const known = Object.keys(IDX.df).filter(t => t.length >= 6 && IDX.df[t] > 2).slice(0, 40);
      const untouched = known.every(t => {
        const before = tok(t);
        return JSON.stringify(expandStubs(tok(t))) === JSON.stringify(before);
      });
      /* And a stub does grow — otherwise "untouched" is true because the
         function does nothing at all. */
      const stub = known.find(t => t.length >= 8);
      const cut = stub ? stub.slice(0, 5) : null;
      const grew = cut && !IDX.df[cut]
        ? expandStubs(tok(cut)).length > tok(cut).length : null;
      return { n: known.length, untouched, cut, grew, vocab: Object.keys(IDX.df).length };
    });
    ok('a known word is passed through unchanged', probe.untouched,
       `${probe.n} sampled from a ${probe.vocab}-term vocabulary`);
    ok('and a stub really does grow — the guard is not vacuous',
       probe.grew === true, `"${probe.cut}" → ${probe.grew}`);
  }

  head('the word list cannot outlive the index it came from');
  {
    /* Two caches, one invalidation. A vocabulary that survives an index rebuild
       completes words that are no longer in the library. */
    /* Rebuilding on an UNCHANGED corpus proves nothing — the same vocabulary
       comes back either way. So the corpus changes: a note carrying a word
       that exists nowhere else, and a stub of it that could only complete
       against a word list built after the note arrived. */
    const after = await page.evaluate(() => {
      const NONCE = 'zylotrophin';                 // in no cardiology text ever
      const before = search('zylot', { limit: 5 }).length;
      REF.push({ id: 'nonce-probe', title: 'Probe ' + NONCE,
                 body: NONCE + ' is a word invented by a test.', tags: '', ts: Date.now() });
      const stale = search('zylot', { limit: 5 }).length;   // index not yet dropped
      invalidateIndex();
      const fresh = search('zylot', { limit: 5 })
        .filter(h => h.meta.kind === 'r').map(h => h.meta.id);
      REF.pop();
      invalidateIndex();
      const gone = search('zylot', { limit: 5 }).length;
      return { before, stale, fresh, gone };
    });
    ok('a stub of a word not in the library completes to nothing',
       after.before === 0, String(after.before));
    ok('and once the note exists and the index is dropped, it completes to it',
       after.fresh.includes('nonce-probe'), JSON.stringify(after.fresh));
    ok('and when the note goes, so does the word', after.gone === 0, String(after.gone));
  }

  head('the shape the tutor sends is the shape it is best at');
  /* The one comparison that decided against MiniSearch, kept as an assertion
     so it stays true: whatever changes, long prose queries must not become the
     engine's weak case, because that is what groundedContext sends on every
     grounded reply. */
  ok('long prose outranks half-typed titles, not the other way round',
     r.body.r1 > r.prefix.r1, `body ${pct(r.body.r1)} vs prefix ${pct(r.prefix.r1)}`);

  console.log(`\n  measured: exact ${pct(r.exact.r1)} · typo ${pct(r.typo.r1)} · ` +
              `prefix ${pct(r.prefix.r1)} · body ${pct(r.body.r1)}  (R@1)`);

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
