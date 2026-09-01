#!/usr/bin/env node
/*
 * The accent/success/danger/warning names become canonical; the legacy
 * hue-named variables become pure var() aliases pointing at them.
 *
 *   node scripts/semantictokens-patch.js <in.html> <out.html>
 *
 * --teal is read 104 times, --green/--red/--amber a few dozen each. Renaming
 * every call site to match would be the highest-risk, lowest-value way to
 * get the benefit a design review actually wants: "change the accent colour
 * in one place." Flipping which name owns the literal value gets the same
 * result with zero risk to any existing call site, because var() resolution
 * is transparent to both CSS painting and any JS that reads a custom
 * property (this app's theme-aware canvas renderers, wired through
 * notifyThemeRenderers(), read --teal directly and cannot observe the extra
 * indirection). --teal becomes var(--accent) instead of a literal hex, and
 * every one of its 104 existing readers keeps working, unchanged, forever.
 *
 * SCOPE, CHECKED DIRECTLY RATHER THAN ASSUMED. --dim is the only token
 * redeclared in all 9 theme blocks. --teal is redeclared in only 6 (:root
 * plus the 5 named palettes) — the dark-media-query, [data-theme="dark"]
 * and [data-theme="light"] blocks deliberately inherit it from :root
 * (verify-theme.js already asserts this: midnight and daylight are
 * required to share the same teal on purpose). --green/--red/--amber are
 * declared ONLY in :root — no theme ever overrides the base semantic hues,
 * just their -bg/-b backgrounds. So this is 9 patch() calls total: 4 in
 * :root, plus 5 one-per-palette for --teal only. --teal3/--teal4 stay
 * literal in every block; at 1 and 5 live call sites they aren't worth
 * folding into the alias scheme.
 *
 * A NOTE FOR WHOEVER FINDS --warn NEXT. :root already carries
 * --warn/--warn-bg/--warn-b (one line, one call site: .notice), and --warn
 * already equals --amber's value. That overlap is real and this patch does
 * not resolve it — reconciling three names for one amber (--amber legacy,
 * --warn pre-existing, --warning new canonical) is its own small change,
 * and folding it in here would blur an otherwise clean, reviewable diff.
 */
'use strict';
const fs = require('fs');

const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/semantictokens-patch.js <in.html> <out.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const edits = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  html = html.replace(find, () => replace);
  edits.push(label);
}

patch('semantictokens: accent is canonical, root',
`  --teal:#0284C7;--teal2:#0EA5E9;--teal3:#BAE6FD;--teal4:#E0F2FE;`,
`  --accent:#0284C7;--accent-2:#0EA5E9;--teal:var(--accent);--teal2:var(--accent-2);--teal3:#BAE6FD;--teal4:#E0F2FE;`);

patch('semantictokens: success is canonical, root',
`  --green:#059669;--green2:#10B981;--green-bg:#ECFDF5;--green-b:#A7F3D0;`,
`  --success:#059669;--success-2:#10B981;--green:var(--success);--green2:var(--success-2);--green-bg:#ECFDF5;--green-b:#A7F3D0;`);

patch('semantictokens: danger is canonical, root',
`  --red:#DC2626;--red2:#EF4444;--red-bg:#FFF1F1;--red-b:#FECACA;`,
`  --danger:#DC2626;--danger-2:#EF4444;--red:var(--danger);--red2:var(--danger-2);--red-bg:#FFF1F1;--red-b:#FECACA;`);

patch('semantictokens: warning is canonical, root',
`  --amber:#B45309;--amber2:#D97706;--amber-bg:#FFFBEB;--amber-b:#FDE68A;`,
`  --warning:#B45309;--warning-2:#D97706;--amber:var(--warning);--amber2:var(--warning-2);--amber-bg:#FFFBEB;--amber-b:#FDE68A;`);

patch('semantictokens: accent alias, slate palette',
`  --text:#1E2536;--muted:#4B5568;--dim:#8A93A6;--faint:#CBD2E0;
  --teal:#4F5BD5;--teal2:#6366F1;--teal3:#C7D0FA;--teal4:#EDEFFD;`,
`  --text:#1E2536;--muted:#4B5568;--dim:#8A93A6;--faint:#CBD2E0;
  --accent:#4F5BD5;--accent-2:#6366F1;--teal:var(--accent);--teal2:var(--accent-2);--teal3:#C7D0FA;--teal4:#EDEFFD;`);

patch('semantictokens: accent alias, parchment palette',
`  --text:#372E20;--muted:#6A5B45;--dim:#9A8B72;--faint:#D8CBB2;
  --teal:#0E7C86;--teal2:#12919B;--teal3:#A9DAD6;--teal4:#E6F2EF;`,
`  --text:#372E20;--muted:#6A5B45;--dim:#9A8B72;--faint:#D8CBB2;
  --accent:#0E7C86;--accent-2:#12919B;--teal:var(--accent);--teal2:var(--accent-2);--teal3:#A9DAD6;--teal4:#E6F2EF;`);

patch('semantictokens: accent alias, nocturne palette',
`  --text:#EDE9F7;--muted:#A79FC4;--dim:#6E6690;--faint:#362E52;
  --teal:#A78BFA;--teal2:#C4B5FD;--teal3:#4A3D7C;--teal4:#221B40;`,
`  --text:#EDE9F7;--muted:#A79FC4;--dim:#6E6690;--faint:#362E52;
  --accent:#A78BFA;--accent-2:#C4B5FD;--teal:var(--accent);--teal2:var(--accent-2);--teal3:#4A3D7C;--teal4:#221B40;`);

patch('semantictokens: accent alias, cathlab palette',
`  --text:#F5EDE1;--muted:#C6AF93;--dim:#8C775D;--faint:#3A2C1C;
  --teal:#F59E0B;--teal2:#FBBF24;--teal3:#5A3E12;--teal4:#2A1E08;`,
`  --text:#F5EDE1;--muted:#C6AF93;--dim:#8C775D;--faint:#3A2C1C;
  --accent:#F59E0B;--accent-2:#FBBF24;--teal:var(--accent);--teal2:var(--accent-2);--teal3:#5A3E12;--teal4:#2A1E08;`);

patch('semantictokens: accent alias, monitor palette',
`  --text:#E6F4EC;--muted:#93B7A4;--dim:#5F8571;--faint:#26382F;
  --teal:#2DD4BF;--teal2:#5EEAD4;--teal3:#14503F;--teal4:#082820;`,
`  --text:#E6F4EC;--muted:#93B7A4;--dim:#5F8571;--faint:#26382F;
  --accent:#2DD4BF;--accent-2:#5EEAD4;--teal:var(--accent);--teal2:var(--accent-2);--teal3:#14503F;--teal4:#082820;`);

fs.writeFileSync(OUT, html, 'utf8');
console.log('semantictokens-patch applied:');
edits.forEach(e => console.log('  ✓ ' + e));
