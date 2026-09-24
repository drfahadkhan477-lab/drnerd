/* ═══════════════════════════════════════════════════════════════════════════
   format.js — a key point as a bullet: short, professional, the key term
   first.

   PURE, and SUBTRACTIVE ONLY. It may drop words — "However,", "It is
   important to note that", "(see Figure 3)", "[12]" — and split a long point
   at its semicolons, but it never adds or changes a word. A definition
   "Preload is the stretch on …" becomes lead "Preload", body "the stretch on
   …": the "is" is dropped, the rest is the PDF's own words in the PDF's own
   order. tests/verify-memorizer-coach-pure.js holds that: every word out is
   a word that was in.

   What it returns is a description, not markup — { lead, body, subs } — so
   the page draws it with textContent, like every other piece of text.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

var FILLER = /^(?:however|moreover|furthermore|in addition|additionally|also|thus|therefore|hence|importantly|notably|of note|in general|generally|overall|finally|first|second|third|firstly|secondly|similarly|conversely|in contrast|for example|for instance|that is|in summary|in short|in fact|indeed|of course|as such|in practice|clinically)\s*,\s*/i;
var PREAMBLE = /^(?:it is (?:important|worth|useful) (?:to note|noting|remembering|to remember) that|it should be (?:noted|remembered) that|note that|remember that|recall that)\s+/i;
var CITE = /\s*\[\s*\d+(?:\s*[,–\-]\s*\d+)*\s*\]/g;
var XREF = /\s*\((?:see\s+)?(?:fig(?:ure)?|table|chapter|section|page|p)\.?\s*[^)]{0,20}\)/gi;
var DEFINE = /^((?:\S+\s+){0,5}?\S+)\s+(?:is|are|refers to|is defined as|are defined as|means)\s+(.+)$/i;
/* "Preload — the stretch on …" or "Causes: …": the form the lesson prompt
   asks Claude for. Only the dash or colon is dropped. A colon needs a space
   after it, so "12:00" is not a lead. */
var LEAD = /^([^\u2014\u2013:;]+?)\s*(?:[\u2014\u2013]|:)\s+(.+)$/;

function tidy(t) {
  var s = String(t || '').replace(CITE, '').replace(XREF, '').replace(/\s+/g, ' ').trim();
  var guard = 0;
  while (guard++ < 4 && (FILLER.test(s) || PREAMBLE.test(s))) s = s.replace(FILLER, '').replace(PREAMBLE, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function bullet(text) {
  var s = tidy(text);
  var parts = s.split(/\s*;\s*/).filter(Boolean);
  var main = parts[0], subs = parts.slice(1);
  var lead = '', body = main;
  /* Whichever splits earlier: "Causes of AS: calcific disease is …" leads
     with "Causes of AS", "Aortic stenosis is a narrowing — …" with
     "Aortic stenosis". */
  var dl = LEAD.exec(main), df = DEFINE.exec(main);
  var m = dl && (!df || dl[1].length <= df[1].length) ? dl : df;
  /* Only a short subject is a term worth leading with; "The finding that
     most patients…" is not a definition. */
  if (m && m[1].split(/\s+/).length <= 5 && !/^(?:this|that|it|there|these|those|which)\b/i.test(m[1])) {
    lead = m[1].replace(/^(?:the|a|an)\s+/i, '');
    lead = lead.charAt(0).toUpperCase() + lead.slice(1);
    body = m[2];
  }
  body = body.replace(/\.$/, '');
  subs = subs.map(function (x) { return x.replace(/\.$/, '').replace(/^./, function (c) { return c.toUpperCase(); }); });
  return { lead: lead, body: body, subs: subs };
}

var MemFormat = { bullet: bullet, tidy: tidy };
root.MemFormat = MemFormat;
if (typeof module !== 'undefined' && module.exports) module.exports = MemFormat;
})(typeof window !== 'undefined' ? window : this);
