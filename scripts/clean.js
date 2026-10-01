#!/usr/bin/env node
/*
 * Remove generated files.
 *
 *   npm run clean                       what any clone can make again, no export needed
 *   npm run clean:private               lists what the private clean would remove
 *   npm run clean:private -- --yes      and removes it
 *
 * PUBLIC (npm run clean): dist-memorizer/ and build/.work/, the per-run build
 * workspaces scripts/build.js leaves only when a run is killed hard.
 *
 * PRIVATE (--private): what is made FROM the export and can be made again
 * from it: build/, dist/, and the three things scripts/extract-content.js
 * writes into content/ — questions.json, manifest.json and figures/.
 * It asks for --yes because without the export none of it comes back, and
 * without --yes it only lists the paths.
 *
 * NEVER, with any flag: source/ (where the export lives — possibly its only
 * copy on this machine), the rest of content/ (content/refs*, including the
 * content/refs-repo submodule, are the owner's notes, not build output), and
 * anything outside the repository. Those are not in either list, and every
 * path is checked against them before it is removed.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const PUBLIC = ['dist-memorizer', path.join('build', '.work')];
const PRIVATE = ['build', 'dist', path.join('content', 'questions.json'), path.join('content', 'manifest.json'), path.join('content', 'figures')];
const NEVER = ['source', path.join('content', 'refs'), path.join('content', 'refs-repo'), '.git'];

function within(root, p) { const r = path.relative(root, p); return !!r && !r.startsWith('..') && !path.isAbsolute(r); }

/* → { removed: [rel], listed: [rel], refused: [rel], code } */
function clean(opts) {
  const o = opts || {};
  const root = path.resolve(o.root || ROOT);
  const targets = o.private ? PRIVATE : PUBLIC;
  const present = targets.filter(rel => fs.existsSync(path.join(root, rel)));
  const refused = present.filter(rel => {
    const abs = path.resolve(root, rel);
    if (!within(root, abs)) return true;
    /* Not a protected path, and not containing one (build/ holding source/
       would be odd, but this is the line that makes "never" true). */
    return NEVER.some(n => { const nAbs = path.resolve(root, n); return abs === nAbs || within(abs, nAbs) || within(nAbs, abs); });
  });
  const go = present.filter(rel => !refused.includes(rel));
  if (o.private && !o.yes) return { removed: [], listed: go, refused, code: go.length ? 1 : 0 };
  for (const rel of go) fs.rmSync(path.join(root, rel), { recursive: true, force: true });
  return { removed: go, listed: [], refused, code: refused.length ? 1 : 0 };
}

module.exports = { clean, PUBLIC, PRIVATE, NEVER };

if (require.main === module) {
  const a = process.argv.slice(2);
  const r = clean({ private: a.includes('--private'), yes: a.includes('--yes') });
  const show = xs => xs.map(x => '    ' + x.split(path.sep).join('/')).join('\n');
  if (r.listed.length) {
    console.log(`\nThe private clean would remove what is built from your export:\n${show(r.listed)}\n`);
    console.log('Without the export none of this comes back. To remove it:  npm run clean:private -- --yes\n');
  } else if (r.removed.length) console.log(`\nRemoved:\n${show(r.removed)}\n`);
  else console.log('\nNothing to remove.\n');
  if (r.refused.length) console.log(`Refused (protected):\n${show(r.refused)}\n`);
  process.exit(r.code);
}
