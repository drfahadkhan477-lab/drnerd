#!/usr/bin/env node
/*
 * Questions the export ships broken in a way the fellow cannot see.
 *
 *   node scripts/flags-patch.js <in.html> <out.html>
 *
 * TWO DEFECTS, ONE SHAPE. A handful of ACCSAP items ask the fellow to pick
 * between lettered panels — "ECG A" through "ECG E", "Pattern A" through
 * "Pattern E" — where the panels are a figure. The export marks these with
 * `imgopt`. For COR_89 the panels are simply not in the source PDF: five
 * options that name pictures, and no pictures. COR_108 already carries a
 * `flag` saying exactly that; COR_89 carried nothing until this step existed.
 *
 * COR_85 is the same failure in a different field: the export ships it with
 * no commentary at all (`ex:""`) and every option's peer-response percentage
 * at zero — the ACC never recorded which answer their own reviewers picked,
 * so the "correct" answer key on this one item cannot be independently
 * confirmed from anything in the export. `bad` is this app's own field for
 * exactly that: a question POOL excludes rather than presenting as if its
 * answer were as trustworthy as the other 637.
 *
 * BOTH LOOK FINE UNTIL YOU CHECK. That is what makes them worse than a
 * question that is visibly broken.
 *
 * WHY IT IS A PATCH AND NOT AN EDIT, and why it is not a new mechanism:
 * content/ is the licensed export and is gitignored, so an edit there is
 * untracked and a fresh extraction silently undoes it — which is exactly
 * what had already happened to COR_85's `bad` field before this step existed
 * to make it durable. A chain step is where a content correction lives so it
 * survives re-extraction and fails loudly if the export changes underneath
 * it, and one generic mechanism that can set either `flag` or `bad` is that
 * same shape for two fields, not a second parallel system for the second one.
 *
 * WHAT IS DELIBERATELY LEFT ALONE. COR_102, HEA_3 and HEA_56 also use
 * lettered options, and all three DO ship their figures (HEA_56 has one per
 * option), so the fellow can see what is being asked — flagging them would be
 * noise on questions that work. Nothing else in the bank has ex:"" — COR_85
 * is the only item of this kind, exactly as COR_89 was the only untriaged
 * imgopt/no-figure item when that half of this file was written.
 */
'use strict';
const fs = require('fs');

/* Each entry names the state asserted BEFORE the change, and which field to
   set. The assertion is not decoration: if a future export ships the missing
   commentary or the missing figure, applyContentFlags() throws rather than
   silently re-flagging a question that has since been fixed. */
const FLAGS = [
  {
    id: 'COR_89',
    wantFigs: 0,
    flag: 'The lettered answer figures for this item are not present in the source PDF, ' +
          'so the panels cannot be displayed — review this question inside ACCSAP.',
    why: 'imgopt is set and figs is empty; options are "Pattern A" through "Pattern E". ' +
         'Same defect as COR_108, which the export already flags in these words.',
  },
  {
    id: 'COR_85',
    wantEx: '',
    bad: 'the ACCSAP export carries no peer-response data, so the answer key cannot be confirmed; ' +
         'the commentary is absent from the source PDF',
    why: 'ex is empty and every option\'s peer-response percentage is 0 — the export never recorded ' +
         'which answer the ACC\'s own reviewers picked, so nothing in it can confirm this item\'s key.',
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

    if (f.wantFigs != null) {
      const figs = (q.figs || []).length;
      if (figs !== f.wantFigs) {
        throw new Error(`[${f.id}] now ships ${figs} figure(s), not ${f.wantFigs} as recorded here.\n` +
                        `  The export may have fixed this question. Recheck it before flagging it.`);
      }
    }
    if (f.wantEx != null) {
      if ((q.ex || '') !== f.wantEx) {
        throw new Error(`[${f.id}] now has real commentary ("${String(q.ex).slice(0, 60)}…"), ` +
                         `not empty as recorded here.\n` +
                         `  The export may have fixed this question. Recheck it before flagging it.`);
      }
    }

    if (f.flag) {
      if (q.flag) { applied.push(`${f.id}  already flagged by the export — left as is`); }
      else { q.flag = f.flag; applied.push(`${f.id}  flagged: ${f.flag.slice(0, 56)}…`); }
    }
    if (f.bad) {
      if (q.bad) { applied.push(`${f.id}  already marked bad — left as is`); }
      else { q.bad = f.bad; applied.push(`${f.id}  marked bad: ${f.bad.slice(0, 56)}…`); }
    }
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
