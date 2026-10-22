#!/usr/bin/env node
'use strict';
/* Untrusted backup ids must stay data in reference and memory controls. Drive the real file picker and restore;
   the invented id holds both JavaScript and HTML-attribute delimiters. Its only payload sets a local test marker. */
const path = require('path');
const { launch } = require('./_engine');
const { booted, onScreen, quiet, resolved } = require('./_render');
const { onDeath, watch } = require('./_deathnote');
const target = process.argv[2];
if (!target) throw new Error('usage: node tests/verify-backup-ids.js <build.html>');
const url = /^https?:/.test(target) ? target : 'file://' + path.resolve(target);
let passed = 0, failed = 0;
const ok = (label, value) => { value ? passed++ : failed++; console.log((value ? '  PASS  ' : '  FAIL  ') + label); };
const head = label => console.log('\n── ' + label + ' ──');
(async () => {
 const browser = await launch();
 try {
  const errors = [], events = [];
  onDeath(() => ({section:'restored identifiers', checks:passed + failed, errors, events}));
  const page = watch(await browser.newPage({viewport:{width:1194,height:834}}), events, 'main', errors);
  page.on('dialog', d => d.accept());
  await page.goto(url,{waitUntil:'load',timeout:200000});
  await booted(page);
  const toLibrary = async () => { await page.evaluate(() => goRefs()); await onScreen(page,'refs',{marker:'.ref-card'}); await quiet(page); };
  head('a restored reference id is data, never button code');
  {
    const id = 'r\');window.__referenceScriptRan=true;//" onfocus="window.__referenceScriptRan=true" data-unused="';
    const note = {id, title:'An invented restored note', body:'An invented restored body.', tags:'', ts:Date.now()};
    const choosing = page.waitForEvent('filechooser');
    await page.evaluate(() => { window.__referenceScriptRan = false; importMarkup(); });
    const chooser = await choosing;
    await chooser.setFiles({name:'reference-backup.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify({v:5, refs:[note], mem:[{id, text:'An invented memory', kind:'fact', created:Date.now(), seq:1}]}))});
    await page.waitForFunction(() => /Annotations restored/.test((document.getElementById('toast') || {}).textContent || ''), null, {timeout:30000});
    await toLibrary();
    await page.locator('.ref-acts button').first().click({timeout:5000}).catch(() => {});
    const edited = await resolved(page, () => window.__referenceScriptRan || (document.getElementById('refB') && document.getElementById('refB').value === 'An invented restored body.')).then(() => true, () => false);
    const edit = await page.evaluate(() => ({ran:window.__referenceScriptRan, id:refEditing}));
    ok('Edit opens the exact restored note without executing its id', edited && edit.id === id && !edit.ran && errors.length === 0);
    await page.evaluate(() => { window.__referenceScriptRan = false; refCancel(); });
    await quiet(page);
    await page.locator('.ref-acts button').nth(1).click({timeout:5000}).catch(() => {});
    const deleted = await resolved(page, () => window.__referenceScriptRan || REF.length === 0).then(() => true, () => false);
    const remove = await page.evaluate(() => ({ran:window.__referenceScriptRan, stored:JSON.parse(localStorage.getItem(REF_KEY)).length}));
    ok('Delete removes the exact restored note without executing its id', deleted && remove.stored === 0 && !remove.ran && errors.length === 0);
  }

  head('a restored memory id is data too');
  await page.evaluate(() => { window.__referenceScriptRan = false; goMemory(); });
  await onScreen(page,'memory',{marker:'.ref-card'});
  await quiet(page);
  await page.locator('.ref-acts button').first().click({timeout:5000}).catch(() => {});
  const gone = await resolved(page, () => window.__referenceScriptRan || Memory.count() === 0).then(() => true, () => false);
  const ran = await page.evaluate(() => window.__referenceScriptRan);
  ok('Delete removes the exact restored memory without executing its id', gone && !ran && errors.length === 0);
 } finally { await browser.close(); }
 console.log(`\n${passed} passed, ${failed} failed`);
 process.exitCode = failed ? 1 : 0;
})();
