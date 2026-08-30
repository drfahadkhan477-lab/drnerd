/* ═══════════════════════════════════════════════════════════════════════════
   zipread.js — read a .zip in the browser, without a library.

   The packages this app is fed already come as zips: a chapter's Markdown next
   to a folder of the figures it cites. Asking someone to unzip on an iPad and
   then multi-select two hundred files is not a workflow, so the importer needs
   to open the zip itself.

   Fifty lines rather than a dependency, because the format's useful half is
   small and the alternative is 90 KB of JSZip inlined into a file that is
   already 32 MB. Deflate is done by DecompressionStream, which the browser has
   had since Safari 16.4 — the part that would actually have justified a
   library is the part the platform now provides.

   READS THE CENTRAL DIRECTORY, NOT THE LOCAL HEADERS, for sizes. A local
   header is allowed to carry zeroes and defer the real sizes to a data
   descriptor after the payload, which is exactly what streaming zip writers
   emit; the central directory is always authoritative. Reading the wrong one
   is the classic way a hand-rolled zip reader works on your files and fails on
   someone else's.

   Not supported, deliberately: zip64 (>4 GB), encryption, and compression
   methods other than stored and deflate. Each is reported as a skipped entry
   rather than a silent empty file.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
'use strict';

const EOCD_SIG = 0x06054b50, CEN_SIG = 0x02014b50;

function u16(v, p) { return v.getUint16(p, true); }
function u32(v, p) { return v.getUint32(p, true); }

/* The end-of-central-directory record sits at the very end, unless there is a
   trailing comment — hence the scan back over the largest comment allowed. */
function findEOCD(view) {
  const max = Math.min(view.byteLength, 0xffff + 22);
  for (let i = 22; i <= max; i++) {
    const p = view.byteLength - i;
    if (u32(view, p) === EOCD_SIG) return p;
  }
  return -1;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('no DecompressionStream');
  const stream = new Response(bytes).body.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* Returns [{name, bytes}] for every file it could read, plus the names it
   could not, so the caller can say so rather than pretend the zip was empty. */
async function read(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const all = new Uint8Array(arrayBuffer);
  const eocd = findEOCD(view);
  if (eocd < 0) throw new Error('not a zip file');

  const total = u16(view, eocd + 10);
  let p = u32(view, eocd + 16);
  const dec = new TextDecoder();
  const files = [], skipped = [];

  for (let i = 0; i < total && p + 46 <= view.byteLength; i++) {
    if (u32(view, p) !== CEN_SIG) break;
    const method = u16(view, p + 10);
    const compSize = u32(view, p + 20);
    const nameLen = u16(view, p + 28);
    const extraLen = u16(view, p + 30);
    const cmtLen = u16(view, p + 32);
    const localAt = u32(view, p + 42);
    const name = dec.decode(all.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + cmtLen;

    if (!name || name.endsWith('/')) continue;                  // a directory
    if (compSize === 0xffffffff || localAt === 0xffffffff) { skipped.push(name); continue; }  // zip64
    if (method !== 0 && method !== 8) { skipped.push(name); continue; }

    /* The local header repeats the name and extra fields, and its extra field
       length may differ from the central one — so it has to be read here
       rather than assumed. */
    if (localAt + 30 > view.byteLength) { skipped.push(name); continue; }
    const lNameLen = u16(view, localAt + 26);
    const lExtraLen = u16(view, localAt + 28);
    const start = localAt + 30 + lNameLen + lExtraLen;
    if (start + compSize > view.byteLength) { skipped.push(name); continue; }
    const raw = all.subarray(start, start + compSize);

    try {
      files.push({ name, bytes: method === 0 ? raw : await inflateRaw(raw) });
    } catch (_) { skipped.push(name); }
  }
  return { files, skipped };
}

root.ZipRead = { read, findEOCD };

})(typeof window !== 'undefined' ? window : this);
