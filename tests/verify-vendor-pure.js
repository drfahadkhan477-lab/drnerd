#!/usr/bin/env node
/*
 * The vendored libraries, the figure viewer's and the pen's, are the ones recorded, whole, and their licences travel with them.
 *
 *   node tests/verify-vendor-pure.js
 *
 * The figure viewer's first; the pen's (perfect-freehand 1.2.3, docs/vendor/perfect-freehand/README.md) is held to the same rules
 * in its own section at the end, and its file carries no notice at all, so for it the licence file is the notice.
 *
 * No browser, no build. app/vendor/photoswipe/photoswipe.umd.min.js is someone else's code, committed: PhotoSwipe 5.4.4
 * (docs/vendor/photoswipe/README.md says where it came from). A file nobody reads line by line is a file that can change
 * without anyone noticing: a reformat, a "fix" in place, a different version dropped over it. So its hash is held to the
 * one the README records, and the README to the hash.
 *
 * And the licence. PhotoSwipe is MIT, whose one condition is that the notice goes with every copy. The single file carries
 * the library inline with its banner; the split build lifts it into vendor/ BEFORE scripts/strip-comments.js runs over
 * app.js, because that strip would take the banner with every other comment, and copies the licence beside it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + detail : ''));
};
const head = t => console.log('\n── ' + t + ' ──');

const LIB = 'app/vendor/photoswipe/photoswipe.umd.min.js';
const lib = read(LIB);
const readme = read('docs/vendor/photoswipe/README.md');
const licence = read('docs/vendor/photoswipe/LICENSE');

head('the library is the one recorded');
const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, LIB))).digest('hex');
const recorded = (new RegExp('`' + LIB.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '`[^\\n]*`([0-9a-f]{64})`').exec(readme) || [])[1];
ok('the README records a sha256 for it', !!recorded, recorded || 'no hash beside its path in the README');
ok('and the file is that file, byte for byte', sha === recorded, `${sha.slice(0, 16)}… vs ${(recorded || '').slice(0, 16)}…`);
ok('it is PhotoSwipe 5.4.4, as the README says', /PhotoSwipe 5\.4\.4/.test(lib.slice(0, 200)) && /photoswipe@5\.4\.4/.test(readme));

head('its licence goes with it');
const banner = lib.startsWith('/*!') ? lib.slice(0, lib.indexOf('*/') + 2) : '';
ok('the library opens with its copyright banner, a /*! comment',
   /PhotoSwipe 5\.4\.4/.test(banner) && /\(c\) 2024 Dmytro Semenov/.test(banner), JSON.stringify(lib.slice(0, 90)));
ok('the licence beside the README is the MIT licence, naming its author',
   /The MIT License/.test(licence) && /Permission is hereby granted/.test(licence) && /Semenov/.test(licence));
const pwa = read('scripts/build-pwa.js');
ok('the split build copies the licence beside the library',
   /copyFileSync\(path\.join\(ROOT, 'docs', 'vendor', 'photoswipe', 'LICENSE'\), path\.join\(DIST, 'vendor', 'photoswipe-LICENSE\.txt'\)\)/.test(pwa));

head('the page carries it once, and the split build lifts it whole');
const shell = read('app/systole.html');
const slot = '@@SLOT[app:' + LIB + ']@@';
ok('app/systole.html slots it exactly once', shell.split(slot).length === 2, `${shell.split(slot).length - 1} slot(s)`);
/* The order of the steps in build-pwa.js is the order they run in. */
const at = name => pwa.indexOf("step('" + name);
const lift = at("lift the figure viewer\\'s library out of the app code"),
      srcStrip = at("ship src/\\'s modules without their comments"),
      appStrip = at('ship application handlers without comments');
ok('build-pwa lifts it out of app.js', lift > 0, String(lift));
ok('before either comment strip runs, so its banner reaches the device', lift > 0 && srcStrip > lift && appStrip > lift,
   `lift @${lift}, src strip @${srcStrip}, app strip @${appStrip}`);
ok('and precaches it with the shell, so the viewer works offline from the first launch',
   /const PRECACHE\s*=\s*\[[^\]]*\$\{JSON\.stringify\(psw\.name\)\}/.test(pwa));

head('the pen\'s library is the one recorded, and its licence goes with it');
{
  /* perfect-freehand (docs/vendor/perfect-freehand/README.md). Its file carries no notice, so the licence file is the notice, and
     the split build has to ship it. The app slots the file inside a function that gives it an `exports`; the split build lifts that
     block whole, so the block is what is looked for. */
  const PF = 'app/vendor/perfect-freehand/index.js';
  const pf = read(PF);
  const pfReadme = read('docs/vendor/perfect-freehand/README.md');
  const pfLicence = read('docs/vendor/perfect-freehand/LICENSE');
  const pfSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, PF))).digest('hex');
  const pfRecorded = (new RegExp('`' + PF.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '`[^\\n]*`([0-9a-f]{64})`').exec(pfReadme) || [])[1];
  ok('the README records a sha256 for perfect-freehand, and the file is that file', !!pfRecorded && pfSha === pfRecorded,
     `${pfSha.slice(0, 16)}… vs ${(pfRecorded || 'none').slice(0, 16)}`);
  ok('it is version 1.2.3, as the README says, and exports getStroke', /perfect-freehand@1\.2\.3/.test(pfReadme) && /exports\.getStroke=/.test(pf));
  ok('its licence is the MIT licence, naming its author', /MIT License/.test(pfLicence) && /Permission is hereby granted/.test(pfLicence) && /Stephen Ruiz/.test(pfLicence));
  ok('the split build copies that licence beside it',
     /copyFileSync\(path\.join\(ROOT, 'docs', 'vendor', 'perfect-freehand', 'LICENSE'\), path\.join\(DIST, 'vendor', 'perfect-freehand-LICENSE\.txt'\)\)/.test(pwa));
  const pfSlot = '(function(){var exports={};\n@@SLOT[app:' + PF + ']@@\n;window.PerfectFreehand=exports;})();';
  ok('app/systole.html slots it exactly once, in the wrapper the split build lifts', shell.split(pfSlot).length === 2, `${shell.split(pfSlot).length - 1} wrapped slot(s)`);
  const pfLift = at("lift the pen\\'s library out of the app code");
  ok('build-pwa lifts it before either comment strip, and precaches it', pfLift > 0 && srcStrip > pfLift && appStrip > pfLift &&
     /const PRECACHE\s*=\s*\[[^\]]*\$\{JSON\.stringify\(psw\.pf\)\}/.test(pwa), `lift @${pfLift}, src strip @${srcStrip}, app strip @${appStrip}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
