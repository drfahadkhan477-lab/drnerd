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
 * It does NOT stop script injection, and pretending otherwise would be worse
 * than having no policy at all. The app carries over a hundred inline event
 * handlers — onclick="openFigureFrom(this)" and its relatives, 119 of them in
 * the patch scripts alone and more in the ACCSAP code underneath. Inline
 * handlers cannot be covered by a hash or a nonce; only 'unsafe-inline' allows
 * them, and 'unsafe-inline' is precisely the thing script-src exists to
 * withhold. A script-src here would be decoration. Removing every handler
 * first is a whole-app refactor, and until somebody does it, this file should
 * not imply protection it does not provide.
 *
 * What it does is CONTAIN. This origin holds the fellow's API key, every
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
 * is worth having: an injected script can still run, but it cannot post the
 * key anywhere.
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
const CONNECT = ["'self'", 'https://generativelanguage.googleapis.com'];

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

module.exports = { CONNECT, DIRECTIVES, POLICY, HEADER_POLICY, META, HEADERS_FILE };
