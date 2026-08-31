#!/usr/bin/env node
/*
 * Questions the export ships without the figures they are asking about.
 *
 *   node scripts/flags-patch.js <in.html> <out.html>
 *
 * WHAT THE DEFECT LOOKS LIKE. A handful of ACCSAP items ask the fellow to pick
 * between lettered panels — "ECG A" through "ECG E", "Pattern A" through
 * "Pattern E" — where the panels are a figure. The export marks these with
 * `imgopt`. For two of them the panels are simply not in the source PDF, so the
 * question arrives with `imgopt` set and no figure at all: five options that
 * name pictures, and no pictures.
 *
 * COR_108 already carries a `flag` saying exactly that, so the app shows the
 * question with a notice explaining why it cannot be answered here. COR_89 has
 * the identical defect and carries nothing — no `flag`, no `bad` — so it sits
 * live in the pool asking the fellow to choose between five patterns that were
 * never rendered, with no indication anything is wrong. It is the worse of the
 * two precisely because it looks fine.
 *
 * WHY IT IS A PATCH AND NOT AN EDIT, and why it is not a new mechanism:
 * scripts/keys-patch.js already settled both questions. content/ is the
 * licensed export and is gitignored, so an edit there is untracked and a fresh
 * extraction silently undoes it; a chain step is where a content correction
 * lives so that it survives re-extraction and fails loudly if the export
 * changes underneath it. This is that same shape, for a different field, and
 * deliberately not a second parallel system for the same job.
 *
 * WHAT IS DELIBERATELY LEFT ALONE. COR_102, HEA_3 and HEA_56 also use lettered
 * options, and all three DO ship their figures (HEA_56 has one per option), so
 * the fellow can see what is being asked. Only a question with `imgopt` and no
 * figure whatsoever is unanswerable, and only COR_89 is in that state
 * untriaged. Flagging the others would be noise on questions that work.
 */
'use strict';
const fs = require('fs');

/* id, the state asserted before the change, and the notice to attach. `figs`
   is asserted empty: if a future export ships the panels after all, this build
   stops rather than flagging a question that has since been fixed. */
const FLAGS = [
  {
    id: 'COR_89',
    wantFigs: 0,
    flag: 'The lettered answer figures for this item are not present in the source PDF, ' +
          'so the panels cannot be displayed — review this question inside ACCSAP.',
    why: 'imgopt is set and figs is empty; options are "Pattern A" through "Pattern E". ' +
         'Same defect as COR_108, which the export already flags in these words.',
  },
];

/* Apply every flag to a parsed bank, in place. Returns what it changed.
   Shared with build-pwa.js so the split build gets the same treatment — the
   answer keys were corrected in one build and not the other for exactly as
   long as that list had a single consumer. */
function applyContentFlags(bank) {
  const byId = new Map(bank.map(q => [q.id, q]));
  const applied = [];
  for (const f of FLAGS) {
    const q = byId.get(f.id);
    if (!q) throw new Error(`[${f.id}] not in the bank`);
    const figs = (q.figs || []).length;
    if (figs !== f.wantFigs) {
      throw new Error(`[${f.id}] now ships ${figs} figure(s), not ${f.wantFigs} as recorded here.\n` +
                      `  The export may have fixed this question. Recheck it before flagging it.`);
    }
    if (q.flag) { applied.push(`${f.id}  already flagged by the export — left as is`); continue; }
    q.flag = f.flag;
    applied.push(`${f.id}  flagged: ${f.flag.slice(0, 56)}…`);
  }
  return applied;
}

const ALL_Q_RE = /\nconst ALL_Q=(\[[\s\S]*?\]);\n/;

module.exports = { FLAGS, applyContentFlags, ALL_Q_RE };

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
  applied.forEach(a => console.log('  ✓ ' + a));
  console.log(`written: ${OUT}`);
}
