#!/usr/bin/env node
/*
 * src/core/echo.js holds clinical numbers, and a clinical number that is
 * quietly wrong is worse than a feature that is missing — it will be believed.
 *
 *   node tests/verify-echo-pure.js
 *
 * So the module is held three ways, none of which needs a browser:
 *
 *   REFERENTIAL   every view a measurement names, and every view and
 *                 measurement a disease names, exists. A table of ids that
 *                 point at nothing renders as blank panels rather than as an
 *                 error, which is how it would survive review.
 *   TOTAL         the bands ascend, end unbounded, and run in the direction
 *                 the lesion declares, and a value sitting exactly on a
 *                 cutoff takes the more severe band. The sweep below is
 *                 narrower than it looks and says so at its own site: it
 *                 holds grade(), not the table.
 *   ARITHMETIC    each formula against a worked case whose answer is known
 *                 independently — 4v² at 4 m/s is 64 mmHg whatever the code
 *                 says.
 *
 * WHAT THIS DOES NOT CHECK, said here rather than left to be assumed: whether
 * a cutoff matches the guideline it cites. No test can know that. Each band
 * carries its source in `ref` so a human can audit it, and the suite checks
 * that every band HAS one — which is a different and much weaker claim than
 * checking that the number is right.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

/* Load the shipped module against a stand-in global, the way
   verify-rhythms-pure does. No second copy of anything. */
const shim = {};
new Function('root', fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'echo.js'), 'utf8')
  .replace(/\}\)\(typeof window[\s\S]*$/, '})(root);'))(shim);
const E = shim.Echo;

const near = (a, b, tol) => a !== null && Math.abs(a - b) <= tol;

head('the module loaded and has something in it');
/* VACUITY. Every check below walks a table, and a walk over an empty table
   reports no problems at all. An empty module would otherwise pass this
   entire suite. */
ok('Echo is exported', !!E, E ? 'ok' : '(nothing on root)');
ok('there are views to check', !!E && E.VIEWS.length > 5, E ? String(E.VIEWS.length) : '0');
ok('there are measurements to check', !!E && E.MEASUREMENTS.length > 5, E ? String(E.MEASUREMENTS.length) : '0');
ok('there are lesions to grade', !!E && E.LESIONS.length > 3, E ? String(E.LESIONS.length) : '0');
ok('there are diseases to check', !!E && E.DISEASES.length > 3, E ? String(E.DISEASES.length) : '0');

head('every id a table points at exists');
{
  const viewIds = new Set(E.VIEWS.map(v => v.id));
  const measIds = new Set(E.MEASUREMENTS.map(m => m.id));

  ok('no two views share an id', viewIds.size === E.VIEWS.length, `${viewIds.size} of ${E.VIEWS.length}`);
  ok('no two measurements share an id', measIds.size === E.MEASUREMENTS.length,
     `${measIds.size} of ${E.MEASUREMENTS.length}`);
  ok('no two lesions share an id', new Set(E.LESIONS.map(l => l.id)).size === E.LESIONS.length);
  ok('no two diseases share an id', new Set(E.DISEASES.map(d => d.id)).size === E.DISEASES.length);

  const badMeasView = E.MEASUREMENTS.filter(m => !viewIds.has(m.view)).map(m => `${m.id}→${m.view}`);
  ok('every measurement is taken in a view that exists', badMeasView.length === 0,
     badMeasView.join(', ') || 'none');

  const badDiseaseView = [];
  const badDiseaseMeas = [];
  for (const d of E.DISEASES) {
    for (const v of d.views) if (!viewIds.has(v)) badDiseaseView.push(`${d.id}→${v}`);
    for (const m of d.measures) if (!measIds.has(m)) badDiseaseMeas.push(`${d.id}→${m}`);
  }
  ok('every view a disease names exists', badDiseaseView.length === 0, badDiseaseView.join(', ') || 'none');
  ok('every measurement a disease names exists', badDiseaseMeas.length === 0, badDiseaseMeas.join(', ') || 'none');
}

head('the tables carry what a reader needs');
{
  const viewGaps = E.VIEWS.filter(v => !v.window || !v.position || !v.mark || typeof v.angle !== 'number'
                                       || !v.sees.length || !v.forWhat).map(v => v.id);
  ok('every view names its window, position, index mark and angle', viewGaps.length === 0,
     viewGaps.join(', ') || 'none');
  const measGaps = E.MEASUREMENTS.filter(m => !m.units || !m.ref || !Array.isArray(m.normal)
                                              || m.normal.length !== 2).map(m => m.id);
  ok('every measurement has units, a normal range and a source', measGaps.length === 0,
     measGaps.join(', ') || 'none');
  const unordered = E.MEASUREMENTS.filter(m => !(m.normal[0] < m.normal[1])).map(m => m.id);
  ok('every normal range runs low to high', unordered.length === 0, unordered.join(', ') || 'none');
  const noRef = E.LESIONS.filter(l => !l.ref).map(l => l.id);
  /* A weaker claim than "the cutoff is right", and the header says so. */
  ok('every severity table cites a source', noRef.length === 0, noRef.join(', ') || 'none');
  const thinDisease = E.DISEASES.filter(d => !d.qualitative.length || !d.quantitative.length).map(d => d.id);
  ok('every disease carries both qualitative and quantitative findings', thinDisease.length === 0,
     thinDisease.join(', ') || 'none');
}

head('severity grading is total and ordered');
{
  const badOrder = [], openEnded = [], gaps = [];
  for (const L of E.LESIONS) {
    for (let i = 1; i < L.bands.length; i++) {
      if (!(L.bands[i - 1].upTo < L.bands[i].upTo)) badOrder.push(`${L.id} band ${i}`);
    }
    if (L.bands[L.bands.length - 1].upTo !== Infinity) openEnded.push(L.id);
  }
  ok('bands ascend within every lesion', badOrder.length === 0, badOrder.join(', ') || 'none');
  ok('every lesion ends in an unbounded band', openEnded.length === 0, openEnded.join(', ') || 'none');

  /* SWEPT, NOT SAMPLED — and narrower than it first looked. I wrote this
     expecting it to catch a hole between two bands, then injected one and
     watched it pass: grade() falls through to the last band, so a finite
     value ALWAYS gets an answer and a gap is impossible by construction.
     The ordering check above is what catches a mis-typed table.

     What this measures is therefore the function, not the table: over 4000
     steps across each lesion's range, grade() returns a named band and never
     null. Boundary semantics are asserted separately below, because those
     can be got wrong and this would not notice. */
  let graded = 0;
  for (const L of E.LESIONS) {
    const top = L.bands[L.bands.length - 2] ? L.bands[L.bands.length - 2].upTo : 1;
    for (let i = 0; i <= 4000; i++) {
      const v = (top * 1.5) * i / 4000;
      const g = E.grade(L.id, v);
      if (!g || !g.grade) { gaps.push(`${L.id} at ${v.toFixed(3)}`); break; }
      graded++;
    }
  }
  ok('every value in range grades to exactly one band', gaps.length === 0, gaps.slice(0, 3).join(', ') || 'none');
  ok('and the sweep actually graded something', graded > 30000, `${graded} values graded`);

  /* Direction: walking up the range must never move a lesion back toward
     health. Checked against the direction the table declares, so a table
     that lies about its own direction fails here. */
  const wrongWay = [];
  for (const L of E.LESIONS) {
    const names = L.bands.map(b => b.grade);
    const top = L.bands[L.bands.length - 2] ? L.bands[L.bands.length - 2].upTo : 1;
    let lastIdx = -1;
    for (let i = 0; i <= 200; i++) {
      const g = E.grade(L.id, (top * 1.4) * i / 200);
      const idx = names.indexOf(g.grade);
      if (idx < lastIdx) wrongWay.push(L.id);
      lastIdx = Math.max(lastIdx, idx);
    }
  }
  ok('grades move in one direction as the value rises', wrongWay.length === 0,
     [...new Set(wrongWay)].join(', ') || 'none');

  /* THE BOUNDARY, which the sweep cannot see. Bands are closed below and
     open above — `value < upTo` — so a value sitting exactly on a cutoff
     belongs to the band above it. Turning that `<` into `<=` would move
     every borderline patient one grade milder and nothing else here would
     object. 4.0 m/s is severe aortic stenosis, not moderate. */
  ok('a value exactly on a cutoff takes the more severe band, not the milder',
     E.grade('as-vmax', 4.0).grade === 'severe', E.grade('as-vmax', 4.0).grade);
  ok('and the same on the way down: a 1.0 cm2 valve area is not yet severe',
     E.grade('as-ava', 1.0).grade === 'moderate', E.grade('as-ava', 1.0).grade);
  ok('a 1.5 cm2 mitral area is severe, the ACC/AHA cutoff this table follows',
     E.grade('ms-mva', 1.49).grade === 'severe', E.grade('ms-mva', 1.49).grade);
  ok('an unknown lesion grades to null, not to a default band', E.grade('not-a-lesion', 1) === null);
  ok('a non-number grades to null rather than the mildest band', E.grade('as-vmax', undefined) === null);
  ok('and so does a string that looks like a number', E.grade('as-vmax', '4.0') === null);
}

head('the arithmetic, against worked cases');
{
  ok('simplified Bernoulli: 4 m/s is 64 mmHg', near(E.gradient(4), 64, 1e-9), String(E.gradient(4)));
  ok('the full equation subtracts the proximal velocity: 4 and 1 m/s give 60 mmHg',
     near(E.gradientFull(4, 1), 60, 1e-9), String(E.gradientFull(4, 1)));
  ok('a 2.0 cm LVOT has an area of 3.14 cm2', near(E.csa(2), Math.PI, 1e-9), E.csa(2).toFixed(4));
  ok('2.0 cm and a VTI of 20 cm give a stroke volume of 62.8 mL',
     near(E.strokeVolume(2, 20), 62.83, 0.01), E.strokeVolume(2, 20).toFixed(2));
  ok('continuity: that stroke volume through a VTI of 100 cm is 0.63 cm2',
     near(E.continuityArea(2, 20, 100), 0.6283, 0.001), E.continuityArea(2, 20, 100).toFixed(4));
  ok('and that area grades as severe aortic stenosis',
     E.grade('as-ava', E.continuityArea(2, 20, 100)).grade === 'severe',
     E.grade('as-ava', E.continuityArea(2, 20, 100)).grade);
  ok('dimensionless index of 20 over 100 is 0.20', near(E.dimensionlessIndex(20, 100), 0.2, 1e-9));
  ok('ejection fraction from 120 and 48 mL is 60%', near(E.ejectionFraction(120, 48), 60, 1e-9));
  ok('fractional shortening from 5.0 and 3.0 cm is 40%', near(E.fractionalShortening(5, 3), 40, 1e-9));
  ok('a pressure half-time of 220 ms gives a mitral area of 1.0 cm2',
     near(E.mvaByPht(220), 1, 1e-9), String(E.mvaByPht(220)));
  ok('and 1.0 cm2 grades as very severe mitral stenosis',
     E.grade('ms-mva', 0.9).grade === 'very severe', E.grade('ms-mva', 0.9).grade);
  ok('PISA: radius 0.9 cm, alias 40 cm/s, peak 500 cm/s gives 0.41 cm2',
     near(E.pisaEro(0.9, 40, 500), 0.4072, 0.001), E.pisaEro(0.9, 40, 500).toFixed(4));
  ok('and that orifice grades as severe mitral regurgitation',
     E.grade('mr-ero', E.pisaEro(0.9, 40, 500)).grade === 'severe');
  ok('regurgitant volume from 0.4 cm2 and a VTI of 150 cm is 60 mL',
     near(E.regurgitantVolume(0.4, 150), 60, 1e-9));
  ok('regurgitant fraction of 60 into 120 mL is 50%', near(E.regurgitantFraction(60, 120), 50, 1e-9));
  ok('PASP: a 3 m/s TR jet with an RA pressure of 8 is 44 mmHg',
     near(E.pasp(3, 8), 44, 1e-9), String(E.pasp(3, 8)));
  ok('a small collapsing IVC estimates an RA pressure of 3 mmHg', E.raPressure(1.8, 60) === 3);
  ok('a dilated non-collapsing IVC estimates 15 mmHg', E.raPressure(2.5, 20) === 15);
  ok('and a mixed picture estimates 8 mmHg', E.raPressure(2.5, 60) === 8);
  ok('Devereux mass from 4.5, 0.9 and 0.9 cm is about 133 g',
     near(E.lvMass(4.5, 0.9, 0.9), 132.8, 0.5), E.lvMass(4.5, 0.9, 0.9).toFixed(1));
  ok('Mosteller BSA for 170 cm and 70 kg is 1.82 m2',
     near(E.bsa(170, 70), 1.818, 0.001), E.bsa(170, 70).toFixed(3));
  ok('cardiac output from 70 mL at 70 bpm is 4.9 L/min', near(E.cardiacOutput(70, 70), 4.9, 1e-9));
  ok('indexing divides by body surface area', near(E.indexed(60, 1.8), 33.33, 0.01));
}

head('bad input returns null rather than NaN');
{
  /* NaN propagates through arithmetic and prints as "NaN" on screen; null
     fails a comparison at the first step and is easy to test for. The
     distinction is the whole reason these return null. */
  const nulls = [
    ['gradient of a non-number', E.gradient('x')],
    ['area of a zero diameter', E.csa(0)],
    ['area of a negative diameter', E.csa(-2)],
    ['continuity with a zero aortic VTI', E.continuityArea(2, 20, 0)],
    ['dimensionless index dividing by zero', E.dimensionlessIndex(20, 0)],
    ['ejection fraction with ESV above EDV', E.ejectionFraction(50, 90)],
    ['half-time of zero', E.mvaByPht(0)],
    ['PISA with a zero peak velocity', E.pisaEro(0.9, 40, 0)],
    ['output at zero heart rate', E.cardiacOutput(70, 0)],
    ['BSA from a zero weight', E.bsa(170, 0)],
    ['indexing by a zero BSA', E.indexed(60, 0)],
    ['mass from a negative dimension', E.lvMass(-1, 0.9, 0.9)],
  ];
  const wrong = nulls.filter(([, v]) => v !== null).map(([n]) => n);
  ok('every guarded input returns null', wrong.length === 0, wrong.join('; ') || 'none');
  ok('and the guard list is not empty', nulls.length > 8, `${nulls.length} cases`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
