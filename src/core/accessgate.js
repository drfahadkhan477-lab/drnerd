/* ═════════════════════════════════════════════
   accessgate.js — telling a reply from the sign-in page an expired session gets instead (docs/ROADMAP.md, E1).

     lapsed(r)        an HTML reply where data was asked for: Access's sign-in page, so the session has lapsed
     probeLapsed(r)   the reply to the page's ?signin probe says the session has lapsed: a redirect, kept opaque or
                      not, or the sign-in page itself
     isImage(res)     a reply that is a figure: ok, and an image by its content type

   r and res are fetch Responses, or what caches.match() resolves to (undefined when nothing is cached); all that is
   read of them is ok, status, type and the content-type header.

   They were app/systole.html's apexSessionLapsed(), offlineIsImage() and the test inside signinLapsed(), moved
   unchanged; the page keeps its names. tests/verify-accessgate-pure.js holds them over replies of its own, and
   verify-pwa a gated reply in a browser.

   Pure: no DOM, no network, no storage. ES2015; Safari 13.4 is the floor (README).
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

/* Cloudflare Access answers a lapsed session with 200 OK and a sign-in page.
   Checked before anything reads the body, because apiError() parses it as JSON
   and would report the login page as an empty error. */
function lapsed(r){
  if(!r) return false;
  const ct=(r.headers&&r.headers.get('content-type')||'').toLowerCase();
  return ct.indexOf('text/html')===0;
}
/* The probe is sent with redirect:'manual', so a lapsed session is an opaque
   redirect rather than the sign-in page followed to its end; a plain 3xx, or
   the page itself, says the same. */
function probeLapsed(r){
  return r.type==='opaqueredirect'||(r.status>=300&&r.status<400)||lapsed(r);
}
/* IS THIS ACTUALLY A FIGURE? Behind an authenticating proxy — Cloudflare
   Access, an SSO gateway, a captive portal on hospital wifi — an expired
   session does not answer with an error. It answers 200 OK with a login page.
   r.ok is true, the fetch resolves, and without this check the downloader
   would count four hundred sign-in forms as four hundred figures and cache
   every one of them, leaving the fellow with a bank of broken images and a
   progress bar that said everything was fine.

   The content type is the whole test: a figure is an image and a login page is
   not, whatever the status code says. */
function isImage(res){
  if(!res||!res.ok) return false;
  const ct=(res.headers.get('content-type')||'').toLowerCase();
  return ct.indexOf('image/')===0;
}

root.AccessGate = { lapsed, probeLapsed, isImage };

})(typeof window !== 'undefined' ? window : this);
