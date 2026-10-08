'use strict';
/* Retired patch-chain step, kept until the chain is deleted (tasks/todo.md,
   stage 3). Its logic lives in scripts/answer-keys.js, which the assembler imports. */
const fs = require('fs');
const path = require('path');
const lib = require('./answer-keys.js');
module.exports = lib;
const { CORRECTIONS, applyKeyCorrections, ALL_Q_RE } = lib;
if (require.main === module) {
  const SRC = process.argv[2], OUT = process.argv[3];
  if (!SRC || !OUT) { console.error('usage: node scripts/keys-patch.js <in.html> <out.html>'); process.exit(1); }

  let html = fs.readFileSync(SRC, 'utf8');
  const m = ALL_Q_RE.exec(html);
  if (!m) throw new Error('could not find "const ALL_Q=" — has stage0 run?');
  const bank = JSON.parse(m[1]);

  const applied = applyKeyCorrections(bank);

  html = html.slice(0, m.index) + '\nconst ALL_Q=' + JSON.stringify(bank) + ';\n' + html.slice(m.index + m[0].length);
  fs.writeFileSync(OUT, html);

  console.log(`Answer keys corrected — ${applied.length} edits`);
  applied.forEach(a => console.log('  ✓ ' + a));
  console.log(`written: ${OUT}`);
}
