'use strict';
/* Retired patch-chain step, kept until the chain is deleted (tasks/todo.md,
   stage 3). Its logic lives in scripts/content-flags.js, which the assembler imports. */
const fs = require('fs');
const path = require('path');
const lib = require('./content-flags.js');
module.exports = lib;
const { FLAGS, applyContentFlags, stripBoilerplate, CME_BOILERPLATE, ALL_Q_RE } = lib;
if (require.main === module) {
  const SRC = process.argv[2], OUT = process.argv[3];
  if (!SRC || !OUT) { console.error('usage: node scripts/flags-patch.js <in.html> <out.html>'); process.exit(1); }

  let html = fs.readFileSync(SRC, 'utf8');
  const m = ALL_Q_RE.exec(html);
  if (!m) throw new Error('could not find "const ALL_Q=" — has stage0 run?');
  const bank = JSON.parse(m[1]);

  const applied = applyContentFlags(bank);

  html = html.slice(0, m.index) + '\nconst ALL_Q=' + JSON.stringify(bank) + ';\n' + html.slice(m.index + m[0].length);
  fs.writeFileSync(OUT, html);

  console.log(`Content flags applied — ${applied.length} edit(s)`);
  if (applied.stripped && applied.stripped.length) {
    console.log(`  ✓ CME credit boilerplate stripped from ${applied.stripped.length} explanation(s)`);
  }
  applied.forEach(a => console.log('  ✓ ' + a));
  console.log(`written: ${OUT}`);
}
