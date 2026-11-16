#!/usr/bin/env node
/*
 * Generate the fuzz-range fixture for roadmap S4 from ts-fsrs's own get_fuzz_range.
 *
 *   npm i ts-fsrs            # dev-only; nothing ships
 *   node tools/gen-fsrs-fuzz-oracle.js
 *
 * WHY. src/core/fsrs.js spreads an interval over the range upstream FSRS-5 uses (fsrsFuzz). A check written from the
 * same reading of upstream would share any mistake in it, so the ranges come from upstream itself, as the oracle's
 * arithmetic does (tools/gen-fsrs-oracle.js). The fixture is data, checked in; tests/verify-fsrs.js reads it in bare
 * Node with no dependency, which is what lets CI run it.
 *
 * Rows are [interval, elapsedDays, minInterval, maxInterval]: the days ts-fsrs would draw from for that interval
 * reviewed after that many days, at the same cap (36500).
 */
'use strict';
const fs = require('fs');
const path = require('path');
let ts;
try { ts = require('ts-fsrs'); } catch (e) { console.error('ts-fsrs is not installed: npm i ts-fsrs'); process.exit(1); }
const version = JSON.parse(fs.readFileSync(path.join(path.dirname(require.resolve('ts-fsrs')), '..', 'package.json'), 'utf8')).version;
const MAX = 36500, rows = [];
const intervals = [...Array.from({ length: 40 }, (_, i) => i + 1), 45, 50, 60, 75, 100, 150, 200, 300, 365, 500, 1000, 5000, 20000, 36000, 36400, 36500];
for (const ivl of intervals) {
  for (const elapsed of [...new Set([0, 1, Math.max(0, ivl - 3), Math.max(0, ivl - 1), ivl, ivl + 5])]) {
    if (ivl < 2.5) continue;    // below 2.5 days ts-fsrs does not fuzz at all
    const r = ts.get_fuzz_range(ivl, elapsed, MAX);
    rows.push([ivl, elapsed, r.min_ivl, r.max_ivl]);
  }
}
const out = { generator: { name: 'ts-fsrs', version, fn: 'get_fuzz_range' }, maximum_interval: MAX, rows };
fs.writeFileSync(path.join(__dirname, '..', 'tests', 'fixtures', 'fsrs-fuzz-oracle.json'), JSON.stringify(out) + '\n');
console.log(`wrote ${rows.length} rows from ts-fsrs ${version}`);
