#!/usr/bin/env node
/*
 * Fold the questions and the crib sheet into the page. One file out.
 *
 *   node study/hypertension/build.js [out.html]
 *
 * A study sheet is only useful if it opens on whatever is to hand the night
 * before — a phone with no signal, a borrowed laptop, a browser with nothing
 * installed. So there is nothing to fetch and nothing to serve: the data is
 * inlined and the whole thing is one file you can mail to yourself.
 *
 * These questions are original. They are not extracted from ACCSAP or from any
 * other bank, which is why this directory is committed while `content/` is not.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const out = path.resolve(process.argv[2] || path.join(HERE, 'hypertension.html'));

let html = fs.readFileSync(path.join(HERE, 'page.html'), 'utf8');

/* Exact-match injection, one site each — the same discipline the app's patch
   scripts use, and for the same reason: a marker that matched zero times would
   be a silently empty quiz. */
const put = (mark, file) => {
  const body = fs.readFileSync(path.join(HERE, file), 'utf8');
  if (/<\/script/i.test(body)) throw new Error(`${file} contains a script close tag — it would end the block early`);
  const n = html.split(mark).length - 1;
  if (n !== 1) throw new Error(`${mark} matched ${n} times, expected exactly 1`);
  html = html.replace(mark, '\n' + body.trim() + '\n');
};
put('/*QDATA*/', 'questions.js');
put('/*FACTS*/', 'facts.js');

fs.writeFileSync(out, html);
console.log(`${path.relative(process.cwd(), out)}  ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB`);
