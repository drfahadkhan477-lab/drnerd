#!/usr/bin/env node
/* Inlines demo/heart.html and its two modules into one self-contained file,
   so it can be dropped in Files and opened in Safari like the main app.
     node scripts/build-demo.js [out.html]                                    */
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const out = process.argv[2] || path.join(root, 'demo', 'apex-anatomy.html');
let html = fs.readFileSync(path.join(root, 'demo', 'heart.html'), 'utf8');
for (const src of ['../src/core/heart3d.js', '../src/ui/apex.js']) {
  const code = fs.readFileSync(path.join(root, 'demo', src), 'utf8');
  const tag = `<script src="${src}"></script>`;
  if (!html.includes(tag)) throw new Error('script tag not found: ' + src);
  html = html.replace(tag, '<script>\n' + code + '\n</script>');
}
fs.writeFileSync(out, html);
console.log('wrote ' + out + '  (' + (fs.statSync(out).size / 1024).toFixed(0) + ' KB)');
