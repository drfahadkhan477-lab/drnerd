/* ═════════════════════════════════════════════
   refimport.js — reading the fellow's own notes as they are imported (docs/ROADMAP.md, E1).

   A file the fellow imports into their reference library is turned into notes here, and the figures its
   Markdown names are found among the files that came with it. These were five functions in app/systole.html;
   they read nothing of the page's, so they are here as functions of what they are given, held by
   tests/verify-refimport-pure.js:

     parse(raw, filename)            a file's text and name → [{ title, body, tags, source }]: a JSON array of
                                     notes as it stands, else Markdown, one note per heading's section
     frontmatter(raw)                { body, meta }: YAML front matter (--- … ---) taken off, its name,
                                     description, title, tags and source read; meta is null where there is none
     sections(body)                  the body split at # to ###### headings, never inside a ``` fenced block
     resolveAsset(ref, byPath, byName)
                                     the file a Markdown image link names: by its exact path, else the one path
                                     ending in it, else the one file of that base name; null where none is unique
     images(body)                    a note's refimg:// figures, as { caption, key } in the order cited

   THE RULES, because each is a way an import quietly loses or misfiles something:

     1. Front matter never becomes a note. A Claude Skill file and most note tools open with it.
     2. A heading inside a fenced code block is code, not a heading, and does not split the note.
     3. A file with several sections becomes one note per section, its front-matter title kept as a prefix
        so a citation still says which chapter it came from; a file with one becomes one note.
     4. A figure is found only where the match is unique. Widening past unique would pick the wrong
        figure silently, which is worse than reporting it missing.
     5. Nothing given is changed.

   The page keeps the old names as one line each (parseImportText, stripFrontmatter, splitSections,
   refResolveAsset, extractRefImages), so no caller, handler or suite had to change.

   Pure: no DOM, no clock, no storage. The text read is the fellow's own and never leaves the device.
   ES2015; Safari 13.4 is the floor (README).
   ═════════════════════════════════════════════ */
(function (root) {
'use strict';

function frontmatter(raw){
  // Claude Skill files (SKILL.md) and many note tools prepend YAML frontmatter:
  // ---\nname: ...\ndescription: ...\n---\n  — strip it so it never becomes a note.
  // A reference corpus wants more than that: a title to cite it by, tags to
  // retrieve it on, and a source you could actually go and open.
  const m=raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if(!m) return {body:raw, meta:null};
  const yaml=m[0];
  const f=k=>{ const x=yaml.match(new RegExp('^'+k+':\\s*(.+)$','m')); return x?x[1].trim().replace(/^["']|["']$/g,''):''; };
  return {body:raw.slice(m[0].length), meta:{
    name:f('name')||null, desc:f('description')||null,
    title:f('title'), tags:f('tags'), source:f('source')||f('citation')||f('ref'),
  }};
}
/* Split on # / ## / ### headings, but never inside a fenced ```code block```,
   where a line starting with '#' (a shell/Python comment, a markdown example,
   etc.) is not a heading and must not fracture the section. */
function sections(body){
  const lines=body.split('\n');
  const secs=[]; let cur=[]; let inFence=false;
  for(const line of lines){
    if(/^```/.test(line.trim())) inFence=!inFence;
    if(!inFence && /^#{1,6}\s/.test(line) && cur.length){ secs.push(cur.join('\n')); cur=[line]; }
    else cur.push(line);
  }
  if(cur.length) secs.push(cur.join('\n'));
  return secs.map(s=>s.trim()).filter(Boolean);
}
/* Raw file text + filename -> [{title,body,tags,source}]. */
function parse(raw,filename){
  try{
    const j=JSON.parse(raw);
    if(Array.isArray(j)) return j.map(x=>({title:x.title||'Untitled',body:x.body||'',tags:x.tags||''}));
  }catch(_){}
  const {body,meta}=frontmatter(raw);
  const fmTitle=(meta&&meta.title)||'';
  const source=(meta&&meta.source)||'';
  /* Front-matter tags win; the file name is a poor last resort but better than
     nothing, since it is usually the topic. */
  const tags=(meta&&meta.tags) || (meta&&meta.name?meta.name.replace(/[_-]+/g,' '):'')
             || filename.replace(/\.\w+$/,'').replace(/[_-]+/g,' ');
  const secs=sections(body);
  if(secs.length>1){
    /* One section per note. Retrieval works on whole notes, so a 4000-word
       chapter as a single note would either blow the context budget or be
       clipped mid-sentence; a section is the size a claim actually lives at.
       The file's own title is kept as a prefix so a citation still says which
       chapter it came from. */
    return secs.map(s=>{
      const m=s.match(/^#{1,6}\s*(.+)/);
      const secTitle=m?m[1].trim():'Note';
      return {title: fmTitle? fmTitle+' — '+secTitle : secTitle,
              body:s.replace(/^#{1,6}\s*.+\n?/,'').trim(), tags, source};
    }).filter(s=>s.body||s.title!=='Note');
  }
  const single=(secs[0]||body).trim();
  const m=single.match(/^#{1,6}\s*(.+)/);
  return [{title: fmTitle || (m?m[1].trim():'') || (meta&&meta.desc) || filename.replace(/\.\w+$/,''),
           body: m?single.replace(/^#{1,6}\s*.+\n?/,'').trim():single, tags, source}];
}
/* A Markdown link and a zip's internal path rarely agree exactly: the note
   says visuals/012.jpg, the zip says Braunwald_HF_atlas/visuals/012.jpg, and a
   file picker gives you no path at all. So resolution widens in three steps —
   exact, then suffix, then basename — and stops at the first that is unique. */
function resolveAsset(ref, byPath, byName){
  const clean=String(ref||'').split(/[?#]/)[0].replace(/^\.\//,'').replace(/^\//,'');
  if(byPath[clean]) return byPath[clean];
  const suffix=Object.keys(byPath).filter(p=>p.endsWith('/'+clean));
  if(suffix.length===1) return byPath[suffix[0]];
  const base=clean.split('/').pop();
  const hits=byName[base];
  return (hits&&hits.length===1)?hits[0]:null;
}
/* A note's images, as {caption,key} pairs, in citation order. Shared by the
   renderer (which resolves key -> pixels) and by the chat layer (which
   resolves key -> a vision block) so the two never drift out of sync on what
   counts as "this note has a figure". */
function images(body){
  const out=[]; const re=/!\[([^\]]*)\]\(refimg:\/\/([^)\s]+)\)/g;
  let m; while((m=re.exec(body||''))) out.push({caption:m[1], key:m[2]});
  return out;
}

root.RefImport = { parse, frontmatter, sections, resolveAsset, images };

})(typeof window !== 'undefined' ? window : this);
