'use strict';
/*
 * The content security policy the split build ships, in one place.
 *
 * Required by scripts/build-pwa.js, which stamps it into the shell and into
 * dist/_headers, and by tests/verify-csp.js, which proves the browser enforces
 * what it claims. One definition, so the policy and its proof cannot drift.
 *
 * ── WHAT THIS POLICY IS FOR, AND WHAT IT IS NOT ──────────────────────────
 *
 * Two layers, since November 2026 (docs/ROADMAP.md, E2).
 *
 * The split build's page REFUSES INJECTED SCRIPT. Its <meta> (scriptMeta,
 * below) carries a script-src of 'self' and the hash of each inline script the
 * shell keeps, so an injected <script>, an onclick written into markup and a
 * javascript: link do not run, and the browser reports each. This became
 * possible only when the app's inline handlers were gone: every control names
 * an action (data-action) heard by one delegated listener (src/core/actions.js),
 * and tests/verify-actions-pure.js fails on an on* attribute put back.
 * tests/verify-pwa.js holds it on the served build: the hashes match, the app
 * boots and works with no violation, and each injection is refused.
 *
 * What the directives below do is CONTAIN, for whatever runs anyway. This origin holds the fellow's API key, every
 * answer they have ever given, their notes and their chats. The question a
 * policy can still answer is: if something does execute here, where can it
 * send that? The app's entire network surface is two things —
 *
 *   · 'self', for content/questions.json, content/figures/*.webp, app.js and
 *     the service worker;
 *   · Gemini, and only when the fellow has supplied their own key.
 *
 * — because stage0 strips the Google Fonts links and embeds the faces ("This
 * file requests nothing from the network"), and onetutor reduces the provider
 * map to a single entry. Two hosts is a tight enough surface that connect-src
 * is worth having, and img-src closes the next-easiest route: an injected
 * script can still run, but it cannot fetch, beacon or load an image from
 * anywhere else.
 *
 * THAT IS ALL IT CONTAINS. An injected script can still carry data out by the
 * routes this policy leaves open on purpose (see "WHY THERE IS NO default-src"):
 * a <script src>, a stylesheet or font from another host, a media element, or
 * simply navigating the page to one. Each of those directives would need the
 * app's own use of it proven first, and none has been. So read this policy as
 * closing fetch, XHR, beacons, WebSockets and images, not as "nothing leaves".
 *
 * ── WHY THERE IS NO default-src ──────────────────────────────────────────
 *
 * Deliberate. A default-src denies every fetch type this file did not think
 * of, including ones belonging to ACCSAP code that is not readable from here,
 * and the failure mode is a blank screen for the owner rather than a failed
 * test for me. So this restricts only what the codebase can be shown not to
 * need, and stays silent on everything else. A partial policy that cannot
 * break the app is worth more than a strict one that might.
 *
 * ── WHY THE SINGLE-FILE BUILD DOES NOT GET ONE ───────────────────────────
 *
 * It is opened from file://, where the origin is opaque and 'self' matches
 * differently in every engine. Its threat model is different too: one file,
 * no server, every figure already a data: URI. An untestable policy on an
 * untested origin is a liability.
 */

/* Everything the app is known to contact. Nothing may be added here without a
   call site in the shipped chain to justify it; tests/verify-csp.js re-derives
   the list from the source and fails when the two disagree. */
/* blob: — the code-only deploy (build-pwa.js --no-content) keeps the bank's
   figures in IndexedDB and hands them out as blob: URLs (src/core/bankstore.js);
   the tutor's figure path fetches one to send it. A blob: URL is made by this
   tab from bytes it already holds, so it opens no route to any other host. */
const CONNECT = ["'self'", 'blob:', 'https://generativelanguage.googleapis.com'];

/* Every image the app shows is one of three kinds, and none needs another
   host: 'self' for content/figures/* and the icons; data: for the baked
   reference figures, imported ones (RefAssets) and the single-file figures;
   blob: for the code-only deploy's figures (src/core/bankstore.js). A note
   imported with an https:// image link keeps the link as text: md() renders
   only refimg:// images, so nothing loads it. Without this, `new Image().src`
   carried anything to any host while connect-src refused the same request. */
const IMG = ["'self'", 'data:', 'blob:'];

/* Each of these is a thing the app provably does not do, so denying it cannot
   cost anything and closes a real exfiltration or hijack route:
     base-uri    an injected <base> silently repoints every relative URL in the
                 document — app.js, the bank, all 408 figures — at another host
     object-src  no <object>, <embed> or <applet> anywhere
     form-action no form is ever submitted; a planted one is pure exfiltration
     frame-src   no iframe anywhere, checked: zero occurrences */
const DIRECTIVES = [
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  `connect-src ${CONNECT.join(' ')}`,
  `img-src ${IMG.join(' ')}`,
];

const POLICY = DIRECTIVES.join('; ');

/* frame-ancestors is IGNORED in a <meta> policy — it exists only as a real
   header, which is why dist/_headers carries a longer string than the shell
   does. Same reason report-uri and sandbox are absent from both. */
const HEADER_POLICY = `${POLICY}; frame-ancestors 'none'`;

const META = `<meta http-equiv="Content-Security-Policy" content="${POLICY}">`;

/* Cloudflare Pages and Netlify both read this file shape. Anything that serves
   dist/ as plain static files simply ignores it, and the <meta> still applies —
   so the deployment gets the stronger policy and nothing gets a weaker app. */
const HEADERS_FILE = `/*
  Content-Security-Policy: ${HEADER_POLICY}
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
`;

/* ── THE SCRIPT-SRC (docs/ROADMAP.md, E2) ──────────────────────────────────
 *
 * 'self' for app.js and the vendor files the loader and the app add by src,
 * and the hash of each inline script the shell keeps. tests/verify-csp.js shows
 * on a page of its own what it refuses and what it keeps working; scriptMeta
 * is what the split build ships. */
const scriptSrc = hashes => `script-src 'self'${hashes.map(h => ` 'sha256-${h}'`).join('')}`;
const scriptPolicy = hashes => `${POLICY}; ${scriptSrc(hashes)}`;
/* SHIPPED. scripts/build-pwa.js puts this <meta> in the split build's index.html in place of META, as the last thing it
   does to the shell, with the hash of each of its inline scripts as they are written out. The Worker's header stays
   HEADER_POLICY: it is shipped verbatim and cannot know a build's hashes, and a browser enforces every policy it is
   given, so the page's script-src applies on the deployed site under the header's other directives. */
const scriptMeta = hashes => `<meta http-equiv="Content-Security-Policy" content="${scriptPolicy(hashes)}">`;

module.exports = { CONNECT, IMG, DIRECTIVES, POLICY, HEADER_POLICY, META, HEADERS_FILE, scriptSrc, scriptPolicy, scriptMeta };
