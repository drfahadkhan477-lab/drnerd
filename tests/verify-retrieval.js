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
 * THE `prefix` GAP WAS THEN CLOSED WITHOUT IT, IN TWO STEPS. Chain step 72
 * completed query tokens the index had never seen — at most two completions,
 * nearest in length first — taking that column from 54.1% to 80.1% and its ten
 * empty result sets to zero, for fifteen lines. Its own note said the rest
 * "needs prefix matching inside the ranker rather than terms OR-ed into the
 * query". Chain step 73 is that: a stub is scored as one term whose postings
 * are the union of every term it prefixes, tf summed and df counted over
 * documents, so there is no cap, no double counting, and the idf is the
 * prefix's own. 66.8% to 87.1% on the 295-note shelf.
 *
 * `prefix` USED TO BE SENSITIVE TO HOW BIG THE LIBRARY IS. Under step 72 it
 * fell as the shelf grew, and steeply: holding the query set fixed at the 146
 * pre-existing notes and admitting valvular notes to the index in quarters,
 *
 *   index      146     183     221     258     295 notes
 *   step 72   80.1%   77.4%   74.7%   72.6%   71.9%    −8.2 points
 *   step 73   88.4%   88.4%   87.0%   87.0%   87.7%    −0.7 points
 *
 * Same queries, same target notes, only the number of documents competing for
 * the same stems changing. The old decline was monotonic because a cap of two
 * completions goes on getting less adequate as the vocabulary grows — the
 * mechanism was sensitive to collection size on top of the ordinary BM25
 * dilution. Scoring the whole prefix union removes that term, and what is left
 * is flat to within its own noise: the step-73 row is not even monotonic.
 *
 * THIS IS WHY THE FLOOR IS TIGHT. Under step 72 a floor near the measured
 * value would have tripped on the next unit imported, and the finding would
 * have been "the shelf grew" every time — a guard that cries wolf gets
 * ignored. At 0.7 points per 150 notes it now takes something like another 230
 * notes of drift to move 87.1% to 86.0%, so a failure here is once again most
 * likely to be what this file is for: a ranker regression. Should it fail
 * anyway, the counterfactual above is how to tell the two apart in one run —
 * index a subset, re-measure the same notes. `exact` is not sensitive in this
 * way and did not move at all across the same change.
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
 * finding about retrieval, not about this file. Raising one when the ranker
 * genuinely improves is the other half of that bargain, and is why the
 * `prefix` floor moved from 0.79 to 0.86 with step 73 — a point under the
 * measured 87.1%, on a number that no longer drifts with the corpus.
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
  ok('R@1 at or above 0.86 on truncated terms', r.prefix.r1 >= 0.86, pct(r.prefix.r1));
  /* Zero, not "few". Returning nothing at all is a different failure from
     ranking badly: it tells the fellow their library does not cover something
     it does cover. Ten of 146 did that before step 72. */
  ok('and NONE of them returns nothing at all', r.prefix.empty === 0,
     `${r.prefix.empty} empty of ${r.prefix.n}`);

  head('prose from the note itself — the shape production actually sends');
  ok('R@1 at or above 0.98', r.body.r1 >= 0.98, pct(r.body.r1));
  ok('R@5 at or above 0.99', r.body.r5 >= 0.99, pct(r.body.r5));
  ok('and nothing comes back empty', r.body.empty === 0, String(r.body.empty));

  head('prefix matching fires only where there was nothing to match');
  {
    /* THE SAFETY PROPERTY, and it is load-bearing rather than theoretical. A
       token the index knows must be scored as itself and never as a prefix:
       "as" is aortic stenosis on this shelf, and prefix-matching it would drag
       aspirin, assess and asystole into every search that mentions it. If this
       ever stops holding, every query that works today is being widened, and
       the three unchanged columns above would be the last place it showed.

       The vacuity guard is the second check: a stub must actually reach the
       terms it prefixes, or "known words are left alone" is true only because
       nothing is happening at all. */
    const probe = await page.evaluate(() => {
      search('warm the index', { limit: 1 });
      const untouched = Object.keys(IDX.df).filter(t => t.length >= 6 && IDX.df[t] > 2)
        .slice(0, 40).every(t => stubTerms(t) === null);
      /* Measured over the whole vocabulary rather than one probe word. A single
         pick is a lottery — the first long term happened to be "50-year-old",
         whose stub reaches exactly one thing — and a check that depends on
         which word sorts first is not measuring the mechanism. */
      const reaches = [];
      for (const w of Object.keys(IDX.df)) {
        if (w.length < 9 || IDX.df[w] <= 2) continue;
        const cut = w.slice(0, 5);
        if (IDX.df[cut]) continue;
        const r = stubTerms(cut);
        reaches.push(r ? r.length : 0);
      }
      reaches.sort((a, b) => a - b);
      return { untouched, n: reaches.length, median: reaches[reaches.length >> 1],
               overCap: reaches.filter(x => x > 2).length,
               vocab: Object.keys(IDX.df).length };
    });
    ok('a known word is never treated as a prefix', probe.untouched,
       `40 sampled from a ${probe.vocab}-term vocabulary`);
    /* The old mechanism took two completions however many there were, so every
       stub in the majority below lost the rest of its postings. */
    ok('and a stub reaches past the two completions the old cap allowed',
       probe.median >= 3 && probe.overCap / probe.n >= 0.5,
       `median reach ${probe.median}; ${probe.overCap}/${probe.n} `
         + `(${(100 * probe.overCap / probe.n).toFixed(0)}%) reach more than two`);
  }

  head('a stub is one term over every completion, not a pick of two');
  {
    /* THE CLAIM OF STEP 73, STATED SO IT CAN FAIL. Three notes, three words
       sharing a prefix, one word each, chosen so the lengths differ. The old
       mechanism OR-ed in the two completions nearest in length, so the note
       holding the third word matched nothing and was not ranked low but
       absent. Scoring the prefix as a single term over the union reaches all
       three.

       Not asserted here, deliberately: that a lone five-character stub ranks
       what the whole word ranks. Measured at 40% top-5 both before and after,
       because a stub really is ambiguous — "cardi" is cardiac, cardiomyopathy
       and cardioversion — and a check demanding otherwise would be asserting
       something that should not be true. The prefix column above is where that
       outcome is measured, over whole half-typed titles, which is the query a
       fellow actually types. */
    const reach = await page.evaluate(() => {
      const WORDS = ['zylotropha', 'zylotrophin', 'zylotrophinase'];
      const added = WORDS.map((w, i) => ({
        id: 'stub-probe-' + i, title: 'Probe ' + i,
        body: w + ' is a word invented by a test.', tags: '', ts: Date.now() }));
      for (const a of added) REF.push(a);
      invalidateIndex();
      const hits = search('zylot', { limit: 10 })
        .filter(h => h.meta.kind === 'r').map(h => h.meta.id);
      const terms = stubTerms('zylot') || [];
      for (let i = 0; i < added.length; i++) REF.pop();
      invalidateIndex();
      return { hits, found: added.map(a => hits.includes(a.id)), terms };
    });
    ok('every note holding a word with that prefix is reached',
       reach.found.every(Boolean),
       `${reach.found.filter(Boolean).length}/3 found; stub covers ${reach.terms.length} terms`);
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
