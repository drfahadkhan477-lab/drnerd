'use strict';
/*
 * The pdf.js that tools/older-acc-import.js and tools/pdf-shape.js load in
 * the test browser: one version, held to these integrity hashes.
 *
 * Copied from Memorizer's memorizer/src/pdf.js at 396a465, when Memorizer
 * moved to its own repository; until then these tools read the pin out of
 * that file. Change the version and both hashes together.
 */
const BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/';
const LIB = { url: BASE + 'pdf.min.js', sri: 'sha384-OemFRmhjDZwhIKuUld0HJozkF2YErsgDaCL41trxGQZt4/WgnopJQqQl2DvDZ07Z' };
const WORKER = { url: BASE + 'pdf.worker.min.js', sri: 'sha384-sS8B4COeBqzQV9DaPpp5cbpF+xz2jPcFbN3L8FL3/dx0RMC6WLUwTUOFm0iFb1lw' };

module.exports = { BASE, LIB, WORKER };
