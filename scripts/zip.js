'use strict';
/* A zip of named files under one folder, deflated, at the root.
   tools/pack-content.js writes the code-only deploy's content package with it,
   and tests/verify-bankstore.js its fixture. It was Memorizer's Cloudflare
   upload writer (scripts/build-memorizer.js) until Memorizer moved to its own
   repository.

   The smallest writer that Cloudflare, Safari's Files app and unzip all read:
   one local header + data per file, a central directory, its end record. No
   dates worth keeping (a fixed 1980-01-01, so the same build zips to the same
   bytes), no extra fields, UTF-8 names. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function zipOf(dir, names) {
  const parts = [], central = [];
  let at = 0;
  names.forEach(function (name) {
    if (/\\|^\/|\.\./.test(name)) throw new Error('refusing a zip entry that is not a bare relative name: ' + name);
    const data = fs.readFileSync(path.join(dir, name));
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data) >>> 0, nm = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12);                  /* 00:00, 1980-01-01 */
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nm.length, 26); local.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(0, 12); cen.writeUInt16LE(0x21, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(packed.length, 20); cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nm.length, 28); cen.writeUInt32LE(at, 42);
    parts.push(local, nm, packed); central.push(cen, nm);
    at += local.length + nm.length + packed.length;
  });
  const cd = Buffer.concat(central), end = Buffer.alloc(22), n = names.length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(at, 16);
  return Buffer.concat(parts.concat([cd, end]));
}

module.exports = { zipOf };
