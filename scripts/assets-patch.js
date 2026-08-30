#!/usr/bin/env node
/*
 * Imported notes bring their figures with them.
 *
 *   node scripts/assets-patch.js <input.html> <output.html>
 *
 * The build's own figures already work: content/refs-images/ is baked into
 * REF_IMGS and a note cites one as ![caption](refimg://hf/054_FIG…jpg).
 * Importing a chapter of your own did not. refImportText read f.text() and
 * threw the rest of the selection away, so a Markdown file arrived with every
 * ![Figure](visuals/012.jpg) in it pointing at a file the app had never seen —
 * and md(), which only understands refimg://, rendered each one as nothing.
 * Notes came in looking complete and were quietly missing their figures.
 *
 * Three things close that:
 *
 * 1. A PLACE TO PUT THEM. src/core/refassets.js — same refimg:// namespace,
 *    written at import time instead of build time, under the "u/" prefix, in
 *    IndexedDB because a chapter of figures does not fit in localStorage's
 *    5 MB. Read into memory once at boot so md() can stay synchronous.
 *
 * 2. A WAY TO GET THEM IN. src/core/zipread.js reads a .zip directly, because
 *    that is the shape these packages already have — a chapter's Markdown
 *    beside a folder of its figures — and unzipping on an iPad to multi-select
 *    two hundred files is not a workflow. Picking the .md and its images
 *    together still works too.
 *
 * 3. REWRITING THE CITATIONS. On import, every ![alt](some/path.jpg) is
 *    resolved against the files that came in with it, stored, and rewritten to
 *    ![alt](refimg://u/<hash>.jpg). The note that lands on the shelf cites the
 *    store, so it renders, is handed to a vision model, and survives export —
 *    none of which a relative path could ever do.
 *
 * Resolution is by exact path first, then by path suffix, then by basename,
 * because a zip's internal paths and a Markdown file's relative links agree
 * far less often than you would hope. What cannot be resolved is counted and
 * reported rather than dropped in silence — the whole reason this was hard to
 * notice is that the old importer said "Added 14 notes" and nothing else.
 *
 * Every edit asserts it matched exactly once, same discipline as Stage 0.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = process.argv[2], OUT = process.argv[3];
if (!SRC || !OUT) { console.error('usage: node scripts/assets-patch.js <input.html> <output.html>'); process.exit(1); }

let html = fs.readFileSync(SRC, 'utf8');
const refassets = fs.readFileSync(path.join(ROOT, 'src', 'core', 'refassets.js'), 'utf8');
const zipread   = fs.readFileSync(path.join(ROOT, 'src', 'core', 'zipread.js'), 'utf8');

const applied = [];
function patch(label, find, replace) {
  const n = html.split(find).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}\n--- looked for ---\n${find.slice(0, 300)}`);
  html = html.replace(find, () => replace);
  applied.push(label);
}

/* ── 1. the two modules ──────────────────────────────────────────────────── */
patch('embed: refassets.js and zipread.js',
`/* ══════════════ Durable memory — see src/core/memory.js ══════════════ */`,
`/* ═════════ Imported figures — see src/core/{refassets,zipread}.js ═════════ */
${refassets}
${zipread}

/* ══════════════ Durable memory — see src/core/memory.js ══════════════ */`);

/* ── 2. md() looks in both stores ────────────────────────────────────────── */
patch('render: a cited figure may come from the build or from an import',
`  s=s.replace(/!\\[([^\\]]*)\\]\\(refimg:\\/\\/([^)\\s]+)\\)/g,(m,cap,key)=>{
    const src=(typeof REF_IMGS!=='undefined'&&REF_IMGS[key])||'';
    if(!src) return '';`,
`  s=s.replace(/!\\[([^\\]]*)\\]\\(refimg:\\/\\/([^)\\s]+)\\)/g,(m,cap,key)=>{
    const src=refImgSrc(key);
    if(!src) return '';`);

patch('render: one lookup for both figure stores',
`function md(t){`,
`/* The build's figures and your imported ones share the refimg:// namespace
   and differ only in where they are kept — so everything downstream of this
   line (rendering, vision, export) can stop caring which is which. */
function refImgSrc(key){
  const baked=(typeof REF_IMGS!=='undefined'&&REF_IMGS[key])||'';
  if(baked) return baked;
  return (typeof RefAssets!=='undefined'&&RefAssets.get(key))||'';
}
function md(t){`);

/* ── 3. vision sees imported figures too ─────────────────────────────────── */
patch('vision: an imported figure is a figure',
`      const dataUrl=(typeof REF_IMGS!=='undefined'&&REF_IMGS[img.key])||'';`,
`      const dataUrl=refImgSrc(img.key);`);

/* ── 4. the importer ─────────────────────────────────────────────────────── */
patch('import: take the images too, from a folder selection or straight from a zip',
`function refImportText(){
  const inp=document.createElement('input');
  inp.type='file'; inp.multiple=true;
  inp.accept='.md,.txt,.json,text/plain,text/markdown,application/json';
  inp.onchange=async()=>{
    const files=[...(inp.files||[])]; if(!files.length)return;
    let notes=0, failed=0;
    for(const f of files){
      try{
        const text=await f.text();
        const parsed=parseImportText(text, f.name);
        parsed.forEach(n=>refAdd(n.title,n.body,n.tags,n.source));
        notes+=parsed.length;
      }catch(_){ failed++; }
    }
    render();
    toast(\`Added \${notes} note\${notes===1?'':'s'} from \${files.length-failed} file\${files.length-failed===1?'':'s'}\`
          + (failed?\` · \${failed} could not be read\`:''));
  };
  inp.click();
}`,
`/* A Markdown link and a zip's internal path rarely agree exactly: the note
   says visuals/012.jpg, the zip says Braunwald_HF_atlas/visuals/012.jpg, and a
   file picker gives you no path at all. So resolution widens in three steps —
   exact, then suffix, then basename — and stops at the first that is unique.
   Widening past unique would silently pick the wrong figure, which is worse
   than reporting one as missing. */
function refResolveAsset(ref, byPath, byName){
  const clean=String(ref||'').split(/[?#]/)[0].replace(/^\\.\\//,'').replace(/^\\//,'');
  if(byPath[clean]) return byPath[clean];
  const suffix=Object.keys(byPath).filter(p=>p.endsWith('/'+clean));
  if(suffix.length===1) return byPath[suffix[0]];
  const base=clean.split('/').pop();
  const hits=byName[base];
  return (hits&&hits.length===1)?hits[0]:null;
}

/* Rewrite every image link in one note body to a refimg:// key, storing the
   bytes as it goes. Anything already refimg://, or an http(s) URL, is left
   exactly as it is. */
function refAbsorbImages(body, byPath, byName, report){
  return String(body||'').replace(/!\\[([^\\]]*)\\]\\(([^)\\s]+)\\)/g,(m,cap,ref)=>{
    if(/^refimg:\\/\\//.test(ref)) return m;
    if(/^(https?:|data:)/i.test(ref)) return m;
    const file=refResolveAsset(ref,byPath,byName);
    if(!file||typeof RefAssets==='undefined'||!RefAssets.isImageName(file.name)){
      report.missing.push(ref);
      return m;                                  // leave it visible rather than vanish
    }
    const key=RefAssets.add(file.bytes,file.name);
    if(!key){ report.missing.push(ref); return m; }
    report.linked++;
    return \`![\${cap}](refimg://\${key})\`;
  });
}

function refImportText(){
  const inp=document.createElement('input');
  inp.type='file'; inp.multiple=true;
  inp.accept='.md,.txt,.json,.zip,.jpg,.jpeg,.png,.webp,.gif,'
            +'text/plain,text/markdown,application/json,application/zip,image/*';
  inp.onchange=async()=>{
    const picked=[...(inp.files||[])]; if(!picked.length)return;
    toast('Reading…');
    const texts=[];                              // {name, raw}
    const byPath=Object.create(null);            // path -> {name, bytes}
    const byName=Object.create(null);            // basename -> [{name, bytes}]
    const report={linked:0, missing:[], skipped:0};

    const offer=(pathName, bytes)=>{
      const rec={name:pathName.split('/').pop(), bytes};
      byPath[pathName.replace(/^\\.\\//,'').replace(/^\\//,'')]=rec;
      (byName[rec.name]||(byName[rec.name]=[])).push(rec);
    };

    let failed=0;
    for(const f of picked){
      try{
        if(/\\.zip$/i.test(f.name)){
          const {files,skipped}=await ZipRead.read(await f.arrayBuffer());
          report.skipped+=skipped.length;
          for(const z of files){
            /* Zips from macOS carry a __MACOSX shadow of every file. */
            if(/(^|\\/)__MACOSX\\//.test(z.name)||/(^|\\/)\\._/.test(z.name)) continue;
            if(/\\.(md|txt|json)$/i.test(z.name)) texts.push({name:z.name, raw:new TextDecoder().decode(z.bytes)});
            else offer(z.name, z.bytes);
          }
        } else if(/\\.(md|txt|json)$/i.test(f.name)){
          texts.push({name:f.name, raw:await f.text()});
        } else {
          /* A file picker gives no directory, so its own name is its path. */
          offer(f.webkitRelativePath||f.name, new Uint8Array(await f.arrayBuffer()));
        }
      }catch(_){ failed++; }
    }

    let notes=0;
    for(const t of texts){
      try{
        for(const n of parseImportText(t.raw, t.name)){
          refAdd(n.title, refAbsorbImages(n.body, byPath, byName, report), n.tags, n.source);
          notes++;
        }
      }catch(_){ failed++; }
    }

    render();
    /* The old importer said "Added 14 notes" and nothing about the figures it
       had just discarded, which is exactly why nobody noticed for weeks. */
    const bits=[\`Added \${notes} note\${notes===1?'':'s'}\`];
    if(report.linked) bits.push(\`\${report.linked} figure\${report.linked===1?'':'s'} linked\`);
    if(report.missing.length) bits.push(\`\${report.missing.length} image\${report.missing.length===1?'':'s'} not found (\${report.missing.slice(0,2).join(', ')}\${report.missing.length>2?'…':''})\`);
    if(report.skipped) bits.push(\`\${report.skipped} zip entr\${report.skipped===1?'y':'ies'} unreadable\`);
    if(failed) bits.push(\`\${failed} file\${failed===1?'':'s'} could not be read\`);
    toast(bits.join(' · '));
  };
  inp.click();
}`);

/* ── 5. housekeeping ─────────────────────────────────────────────────────── */
patch('import: deleting the last note that cited a figure lets the figure go',
`function refDelete(id){
  REF=REF.filter(x=>x.id!==id); saveJSON(REF_KEY,REF); invalidateIndex();
}`,
`function refDelete(id){
  REF=REF.filter(x=>x.id!==id); saveJSON(REF_KEY,REF); invalidateIndex();
  /* Import is content-addressed, deletion is not, so without this an imported
     chapter that gets deleted would leave its figures in the store for ever. */
  try{ if(typeof RefAssets!=='undefined') RefAssets.sweep(REF.map(r=>r.body)); }catch(_){}
}`);

/* Boot, from immediately after the module rather than from the REF line the
   store logically belongs beside: `let REF = …` is declared some 1,500 lines
   EARLIER in the built file than these modules are embedded, so a call there
   sees `typeof RefAssets === 'undefined'`, takes the guard, and never loads
   anything — silently, for ever. Ordering in a single-file build is a fact
   about line numbers, not about where the code reads best. */
patch('boot: load imported figures once the store exists',
`/* ══════════════ Durable memory — see src/core/memory.js ══════════════ */`,
`/* The library is usually already on screen by the time this resolves, so a
   render is needed — but only if something actually came back. */
if(typeof RefAssets!=='undefined'){
  RefAssets.ready().then(n=>{
    if(n && typeof S!=='undefined' && S.screen==='refs' && typeof render==='function') render();
  });
}

/* ══════════════ Durable memory — see src/core/memory.js ══════════════ */`);

fs.writeFileSync(OUT, html);
console.log(`Imported figures — ${applied.length} edits applied`);
applied.forEach(a => console.log('  ✓ ' + a));
console.log(`written: ${OUT}`);
