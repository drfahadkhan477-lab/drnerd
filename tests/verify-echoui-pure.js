#!/usr/bin/env node
/*
 * src/ui/echo.js builds the Echo Studio screen as strings — no document, no
 * timers — which is what lets the whole screen be held here, without a
 * browser and without the licensed export.
 *
 *   node tests/verify-echoui-pure.js
 *
 * THE RULE UNDER TEST. A derived row appears only when every input it names
 * is a finite number. Not defaulted, not guessed, not printed as NaN. A
 * plausible wrong number on a study screen is worse than an obviously absent
 * one, because the absent one gets investigated.
 *
 * THE CLAIM UNDER TEST. The module says it restates no clinical number and
 * reads every cutoff from src/core/echo.js. That claim is checked rather
 * than believed — narrowly, and the narrowness is stated at the check itself.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { blankComments } = require('./_source.js');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const ROOT = path.join(__dirname, '..');
const load = (rel, shim) => {
  new Function('root', fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\}\)\(typeof window[\s\S]*$/, '})(root);'))(shim);
  return shim;
};
const shim = {};
load('src/core/echo.js', shim);
load('src/ui/echo.js', shim);
const E = shim.Echo, U = shim.EchoUI;

const near = (a, b, tol) => typeof a === 'number' && Math.abs(a - b) <= tol;

head('the module loaded and has something to render');
ok('EchoUI is exported', !!U);
ok('there are fields to fill', !!U && U.FIELDS.length > 8, U ? String(U.FIELDS.length) : '0');
ok('there are derived rows to compute', !!U && U.DERIVED.length > 6, U ? String(U.DERIVED.length) : '0');
ok('every field names a view that exists',
   U.FIELDS.every(f => E.VIEWS.some(v => v.id === f.view)),
   U.FIELDS.filter(f => !E.VIEWS.some(v => v.id === f.view)).map(f => f.id).join(', ') || 'none');
ok('every derived row that grades names a lesion that exists',
   U.DERIVED.filter(d => d.gradeBy).every(d => E.LESIONS.some(l => l.id === d.gradeBy)),
   U.DERIVED.filter(d => d.gradeBy && !E.LESIONS.some(l => l.id === d.gradeBy)).map(d => d.id).join(', ') || 'none');

head('the tabs');
{
  ok('an unknown tab falls back to the first rather than rendering nothing', U.tabId('nope') === 'reference');
  ok('and so does no tab at all', U.tabId(undefined) === 'reference');
  ok('a known tab is kept', U.tabId('calculator') === 'calculator');
  const html = U.tabsHtml('calculator');
  ok('exactly one tab is marked selected', (html.match(/aria-selected="true"/g) || []).length === 1,
     String((html.match(/aria-selected="true"/g) || []).length));
  ok('and it is the one asked for', /data-echo-tab="calculator"[^>]*aria-selected="true"/.test(html)
     || /aria-selected="true"[^>]*data-echo-tab="calculator"/.test(html.replace(/(class="[^"]*")/g, '')),
     'calculator');
  ok('the screen renders the calculator when that tab is active',
     U.screenHtml({ tab: 'calculator' }).indexOf('echo-calc') !== -1);
  ok('and the reference when that one is', U.screenHtml({ tab: 'reference' }).indexOf('echo-ref-tab') !== -1);
}

head('the reference tab');
{
  ok('with nothing picked it invites a pick rather than rendering blank',
     U.referenceHtml({}).indexOf('echo-empty') !== -1);
  ok('an unknown disease id does the same rather than throwing',
     U.diseaseHtml('not-a-disease').indexOf('echo-empty') !== -1);
  const as = U.diseaseHtml('as');
  ok('a known disease renders its name', as.indexOf('Aortic stenosis') !== -1);
  ok('and a view card for each view it names',
     E.DISEASES.filter(d => d.id === 'as')[0].views
       .every(v => as.indexOf(E.VIEWS.filter(x => x.id === v)[0].name) !== -1));
  ok('and the window and index mark, which is what obtains the view',
     as.indexOf('Left parasternal') !== -1 && as.indexOf('right shoulder') !== -1);
  ok('and a row for every measurement it names',
     E.DISEASES.filter(d => d.id === 'as')[0].measures
       .every(m => as.indexOf(E.MEASUREMENTS.filter(x => x.id === m)[0].name) !== -1));
  ok('exactly one disease is marked current in the list',
     (U.diseaseListHtml('as').match(/aria-current="true"/g) || []).length === 1);
  ok('and none is when nothing is picked',
     (U.diseaseListHtml(undefined).match(/aria-current="true"/g) || []).length === 0);
}

head('the calculator computes only what the inputs allow');
{
  const empty = U.compute({});
  ok('nothing at all produces no rows', empty.rows.length === 0, `${empty.rows.length} rows`);
  ok('and reports every derived value as missing', empty.missing.length === U.DERIVED.length,
     `${empty.missing.length} of ${U.DERIVED.length}`);
  ok('naming the inputs each one lacks', empty.missing.every(m => m.needs.length > 0));

  /* Partial input is the case that matters: two of three fields is exactly
     when a screen is tempted to fill the third in. */
  const partial = U.compute({ lvotD: 2.0, lvotVti: 20 });
  ok('two of three inputs computes the row that needs two',
     partial.rows.some(r => r.id === 'sv'), partial.rows.map(r => r.id).join(', '));
  ok('and withholds the row that needs three',
     !partial.rows.some(r => r.id === 'ava') && partial.missing.some(m => m.id === 'ava'));
  ok('naming the one that is absent',
     partial.missing.filter(m => m.id === 'ava')[0].needs.join(',') === 'avVti',
     partial.missing.filter(m => m.id === 'ava')[0].needs.join(','));

  ok('a non-numeric input is treated as absent, not as zero',
     U.compute({ lvotD: '2.0', lvotVti: 20 }).rows.length === 0);
  ok('and so is a value that is not finite',
     U.compute({ lvotD: Infinity, lvotVti: 20 }).rows.length === 0);
  ok('an input that computes to null is reported missing rather than shown',
     U.compute({ lvotD: 2, lvotVti: 20, avVti: 0 }).missing.some(m => m.id === 'ava'));

  /* NO ROW EVER CARRIES A NUMBER THAT IS NOT ONE. The whole point of the
     rule: whatever reaches the table is finite. */
  const full = U.compute({
    lvotD: 2.0, lvotVti: 20, avVti: 100, avVmax: 4.2, edv: 120, esv: 48,
    trVmax: 3.0, ivcD: 1.8, ivcCollapse: 60, pisaR: 0.9, alias: 40,
    regVmax: 500, regVti: 150, pht: 220, hr: 70,
  });
  ok('a full set computes every derived row', full.rows.length === U.DERIVED.length,
     `${full.rows.length} of ${U.DERIVED.length}`);
  ok('and nothing is left missing', full.missing.length === 0, full.missing.map(m => m.id).join(', ') || 'none');
  ok('every value is a finite number', full.rows.every(r => typeof r.value === 'number' && isFinite(r.value)));

  const get = id => full.rows.filter(r => r.id === id)[0];
  ok('continuity area from 2.0 cm, VTI 20 and 100 is 0.63 cm2', near(get('ava').value, 0.6283, 0.001),
     get('ava').value.toFixed(4));
  ok('and it is graded severe, from the core table', get('ava').grade === 'severe', get('ava').grade);
  ok('the grade carries the source it came from', /ACC\/AHA/.test(get('ava').ref), get('ava').ref);
  ok('PISA orifice is 0.41 cm2 and grades severe',
     near(get('ero').value, 0.4072, 0.001) && get('ero').grade === 'severe', get('ero').grade);
  ok('regurgitant volume is 61 mL and grades severe',
     near(get('rvol').value, 61.08, 0.1) && get('rvol').grade === 'severe', get('rvol').value.toFixed(1));
  ok('ejection fraction is 60%', near(get('ef').value, 60, 1e-9));
  ok('PASP uses the IVC-derived RA pressure: 36 + 3 = 39 mmHg', near(get('pasp').value, 39, 1e-9),
     String(get('pasp').value));
  ok('mitral area from a half-time of 220 ms is 1.0 cm2', near(get('mva').value, 1, 1e-9));
  /* The peak gradient grades on the VELOCITY, not on the gradient — the
     table is a velocity table, and grading a gradient against it would be a
     unit error that still produced a plausible word. */
  ok('the aortic gradient is graded from the velocity, not from itself',
     get('avGrad').grade === 'severe', get('avGrad').grade);
}

head('what is rendered is what was computed');
{
  const fields = { lvotD: 2.0, lvotVti: 20, avVti: 100 };
  const html = U.resultsHtml(fields);
  const r = U.compute(fields);
  ok('every computed row appears in the table', r.rows.every(row => html.indexOf(row.label) !== -1));
  ok('and every grade it computed appears with it',
     r.rows.filter(x => x.grade).every(x => html.indexOf('>' + x.grade + '<') !== -1));
  ok('what could not be computed is listed as missing, by name',
     html.indexOf('not yet computable') !== -1 && html.indexOf('needs') !== -1);
  ok('nothing renders the string NaN', html.indexOf('NaN') === -1);
  ok('and nothing renders undefined', html.indexOf('undefined') === -1);
  ok('an empty calculator says so rather than showing an empty table',
     U.resultsHtml({}).indexOf('echo-empty') !== -1);
  ok('a typed value is echoed back into its field',
     U.fieldsHtml({ lvotD: 2.1 }).indexOf('value="2.1"') !== -1);
}

head('escaping');
{
  ok('angle brackets are escaped', U.esc('<script>') === '&lt;script&gt;');
  ok('quotes are escaped, since values land in attributes',
     U.esc('a"b\'c').indexOf('"') === -1 && U.esc('a"b\'c').indexOf("'") === -1);
  ok('ampersand is escaped first, not twice', U.esc('&lt;') === '&amp;lt;');
  ok('null renders as empty rather than as the word null', U.esc(null) === '');
  /* The field values are the ones that round-trip through innerHTML. */
  ok('a hostile value cannot break out of the input attribute',
     U.fieldsHtml({ lvotD: 1 }).indexOf('"><script>') === -1);
}

head('the view layer restates no clinical cutoff');
{
  /* NARROW ON PURPOSE, and the narrowness is the point rather than a
     weakness hidden in prose. It compares only the DECIMAL cutoffs in the
     core tables — 2.6, 0.4, 1.5 and the like. The integer ones (3, 7, 20,
     60) are indistinguishable from array indices and loop bounds, so
     including them would make this fire on `i < 3` and be deleted within a
     week. A duplicated integer cutoff would slip past; a duplicated decimal
     one, which is what a copied severity table actually looks like, does
     not. Read blanked, because the header above discusses these numbers. */
  const src = blankComments(fs.readFileSync(path.join(ROOT, 'src/ui/echo.js'), 'utf8'));
  const decimals = [];
  for (const L of E.LESIONS) {
    for (const b of L.bands) {
      if (isFinite(b.upTo) && String(b.upTo).indexOf('.') !== -1) decimals.push(b.upTo);
    }
  }
  ok('there are decimal cutoffs to look for', decimals.length >= 5, `${decimals.length} cutoffs`);
  const copied = decimals.filter(d => new RegExp('(^|[^\\d.])' + String(d).replace('.', '\\.') + '([^\\d]|$)').test(src));
  ok('none of them appears in the view layer', copied.length === 0,
     copied.join(', ') || 'none');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
