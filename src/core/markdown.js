/* ═════════════════════════════════════════════
   markdown.js — the one place a model's words, and a note's, become the page's HTML.

   Apex's replies, the reference notes and the search's opened note are written in a small Markdown and
   drawn by assigning this function's result to innerHTML. So what it returns is the page's defence: it
   escapes the whole text first, and every rule after that works on the escaped string and never reads
   the raw text again.

     render(t, e, refImgSrc)   the HTML for the text t
       e           the page's escaper: & < > " ' each to its entity. Called once, first, on all of t.
                   The figure rule writes a caption into alt="…", so it has to escape the double quote.
       refImgSrc   key → the src of the figure a note cites as ![caption](refimg://key), or '' for none

   Both are handed in rather than reached for, because they are the page's: the escaper is declared in
   app/systole.html, and a figure is found in the build's baked table or in the device's imported ones.
   The one name it writes that it does not own is the figure's inline handler, openFigureFrom(this),
   which stays a function of the page.

   It was app/systole.html's md() until it moved here unchanged (docs/ROADMAP.md, E1); the page's md(t)
   is now the one line that calls it with the page's e and refImgSrc. tests/verify-md-pure.js holds it.

   No DOM, no clock, no storage: bare Node can test it. ES2015; Safari 13.4 is the floor (README).
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

function render(t, e, refImgSrc) {
  let s=e(t);
  s=s.replace(/```([\s\S]*?)```/g,(m,c)=>`<pre><code>${c}</code></pre>`);
  s=s.replace(/`([^`]+)`/g,'<code>$1</code>');
  /* refimg:// figures resolve before any other inline rule touches them, so
     a caption's own `**bold**` or `*em*` is not double-processed once the
     caption is re-inserted whole into the <figcaption>. */
  s=s.replace(/!\[([^\]]*)\]\(refimg:\/\/([^)\s]+)\)/g,(m,cap,key)=>{
    const src=refImgSrc(key);
    if(!src) return '';
      /* The caption is the image's alt and is shown under it: the shown copy is hidden from a screen reader, which read it twice. */
  return `<figure class="ref-fig" onclick="openFigureFrom(this)" role="button" tabindex="0"
      title="Open this figure full size"><img src="${src}" alt="${cap}" loading="lazy"><figcaption aria-hidden="true">${cap}</figcaption></figure>`;
  });
  /* Headings before inline marks, so a ## line never becomes a paragraph. */
  s=s.replace(/^####\s+(.+)$/gm,'<h4>$1</h4>');
  s=s.replace(/^###\s+(.+)$/gm,'<h3>$1</h3>');
  s=s.replace(/^##\s+(.+)$/gm,'<h3>$1</h3>');
  s=s.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  /* A mark opens on a word and closes on one. A * with a space after it is a bullet or a times sign, which this used to take for
     the start of an emphasis: "* a *very* point" lost its bullet and italicised the wrong words, and "5 * 3 * 2" was set in italics. */
  s=s.replace(/(^|[\s(])\*(?=[^\s*])([^*\n]*[^\s*])\*/g,'$1<em>$2</em>');
  /* GFM pipe tables. Runs after the inline marks so cells keep their bold,
     and before the list rules so a |---|---| divider is never read as a
     bullet. The wrapper scrolls sideways: a drug-dose table is wider than a
     phone, and the alternative is a squeezed column nobody can read. */
  s=s.replace(/(?:^\|.*\|[ \t]*\n)(?:^\|[ \t:|-]+\|[ \t]*\n)(?:^\|.*\|[ \t]*\n?)+/gm,block=>{
    const rows=block.trim().split('\n');
    const cut=r=>r.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
    const head=cut(rows[0]), body=rows.slice(2).map(cut);
    // Empty Markdown header cells still need a name for screen-reader table
    // navigation. Keep the visual corner empty and label its column number.
    return `<div class="tw"><table><thead><tr>${head.map((c,i)=>`<th scope="col">${c||`<span class="sr-only">Column ${i+1}</span>`}</th>`).join('')}</tr></thead>`+
      `<tbody>${body.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  });
  /* One <blockquote> per run of quoted lines, rather than one per line. */
  s=s.replace(/^&gt;\s?(.*)$/gm,'\u0001$1\u0002');
  s=s.replace(/(?:\u0001[^\u0002]*\u0002\n?)+/g,run=>
    '<blockquote><p>'+(run.match(/\u0001([^\u0002]*)\u0002/g)||[])
      .map(x=>x.slice(1,-1)).join(' ').trim()+'</p></blockquote>');
  /* [ \t]* and not \s*: with the m flag \s matches newlines too, so a \s*-
     anchored rule eats the blank lines on either side of the divider — and
     those blank lines are exactly what the paragraph pass below splits on.
     The rule still fired; the <hr> just ended up inside the paragraph it was
     supposed to separate. */
  s=s.replace(/^[ \t]*(?:---+|___+)[ \t]*$/gm,'<hr>');
  /* The * is the bullet Gemini, the default model here, writes. */
  s=s.replace(/^\s*[-•*]\s+(.+)$/gm,'<li>$1</li>');
  s=s.replace(/^\s*\d+\.\s+(.+)$/gm,'<li data-o>$1</li>');
  /* THE ORDER IS THE CONTENT. Both kinds used to become a bare <li> and every
     run was wrapped in <ul>, so "1. 2. 3." came out as three bullets with the
     numbers gone. Tag the kind, wrap a run, and split it where the kind
     changes — a list that mixes them is two lists, not one guess. */
  s=s.replace(/(?:<li(?: data-o)?>[\s\S]*?<\/li>\s*)+/g,run=>{
    const items=run.match(/<li(?: data-o)?>[\s\S]*?<\/li>/g)||[];
    let out='',cur=null,buf=[];
    const flush=()=>{ if(buf.length){ out+='<'+cur+'>'+buf.join('')+'</'+cur+'>'; buf=[]; } };
    for(const it of items){
      const kind=it.startsWith('<li data-o>')?'ol':'ul';
      if(kind!==cur){ flush(); cur=kind; }
      buf.push(it.replace('<li data-o>','<li>'));
    }
    flush();
    return out;
  });
  /* A single newline joins, as markdown says it should. Source files are
     hard-wrapped at ~78 characters; turning each of those into a <br> gave
     paragraphs a ragged false margin that tracked the .md file rather than
     the column it was being read in. A blank line still starts a paragraph. */
  const para=p=>/^<(ul|ol|h3|h4|pre|div|table|figure|blockquote|hr)/.test(p.trim())?p:`<p>${p.replace(/\n/g,' ')}</p>`;
  const BLOCK=/(<ul>[\s\S]*?<\/ul>|<ol>[\s\S]*?<\/ol>|<h[34]>[\s\S]*?<\/h[34]>|<pre>[\s\S]*?<\/pre>|<div class="tw">[\s\S]*?<\/div>|<figure[\s\S]*?<\/figure>|<blockquote>[\s\S]*?<\/blockquote>|<hr>)/;
  /* A block is never inside a paragraph. One written straight under a line of prose, or with a line of prose straight under it,
     is cut out of the paragraph it was in: a <ul> inside a <p> is not markup, and the browser closes the <p> in front of it and
     leaves what followed with no paragraph at all. */
  s=s.split(/\n{2,}/).map(p=>{
    const parts=p.split(BLOCK);
    return parts.length===1?para(p):parts.map((x,k)=>k%2?x:(x.trim()?para(x.trim()):'')).join('');
  }).join('');
  return s;
}

root.Markdown = { render };

})(typeof window !== 'undefined' ? window : this);
