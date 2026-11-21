#!/usr/bin/env node
/* Exercise encrypted backups through Progress. All data and passphrases are invented. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { pbkdf2Sync, createDecipheriv } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { launch } = require('./_engine');
const { booted, onScreen } = require('./_render');

const target = process.argv[2];
if (!target) { console.error('usage: node tests/verify-backupcrypto.js <build.html|url>'); process.exit(1); }
const url = /^https?:\/\//.test(target) ? target : pathToFileURL(path.resolve(target)).href;
const passphrase = 'invented backup passphrase 🌊';
let passed = 0, failed = 0;
function ok(label, condition) {
  condition ? passed++ : failed++;
  console.log((condition ? '  PASS  ' : '  FAIL  ') + label);
}

async function ready(page) {
  await booted(page);
  await page.evaluate(() => Promise.all([Store.ready(), RefAssets.ready()]));
}

async function progress(page) {
  await page.evaluate(() => goStats());
  await onScreen(page, 'stats', { marker: '.data-row' });
}

async function open(browser) {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 834, height: 1194 } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load', timeout: 200000 });
  await ready(page);
  await progress(page);
  return page;
}

const dialog = page => page.getByRole('dialog');
const exportButton = page => page.getByRole('button', { name: 'Export encrypted backup', exact: true });
const snapshot = page => page.evaluate(() => JSON.stringify({
  ink: INK, notes: NOTES, refs: REF, log: LOG, chat: CHATS, mem: Memory.all(),
  progress: [S.sessionTotal, S.sessionCorrect, S.sinceBackup, S.lastBackup], images: RefAssets.keys().sort(),
  stored: [INK_KEY, NOTE_KEY, LOG_KEY, 'accsap12.ref', 'accsap12.chat', 'accsap12.v2'].map(key => Store.get(key, null)),
}));

async function exportFile(page) {
  await exportButton(page).click();
  await dialog(page).locator('[name="passphrase"]').fill(passphrase);
  await dialog(page).getByLabel('Confirm passphrase').fill(passphrase);
  const download = page.waitForEvent('download', { timeout: 15000 });
  await dialog(page).getByRole('button', { name: 'Download encrypted file' }).click();
  const file = await download;
  await page.waitForFunction(() => !backupBusy);
  return { name: file.suggestedFilename(), text: await fs.readFile(await file.path(), 'utf8') };
}

async function selectFile(page, text) {
  const chooser = page.waitForEvent('filechooser', { timeout: 10000 });
  await page.getByRole('button', { name: 'Import backup' }).click();
  await (await chooser).setFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await dialog(page).waitFor({ state: 'visible' });
}

async function unlock(page, phrase) {
  await dialog(page).getByLabel('Passphrase').fill(phrase);
  await dialog(page).getByRole('button', { name: 'Unlock and restore' }).click();
  await page.waitForFunction(() => !backupBusy, null, { timeout: 15000 });
  return page.locator('#toast').textContent();
}

function readWithNode(file) {
  const cipher = Buffer.from(file.ciphertext, 'base64');
  const key = pbkdf2Sync(passphrase, Buffer.from(file.salt, 'base64'), 600000, 32, 'sha256');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(file.iv, 'base64'));
  decipher.setAAD(Buffer.from('systole-encrypted-backup:v1'));
  decipher.setAuthTag(cipher.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(cipher.subarray(0, -16)), decipher.final()]).toString('utf8'));
}

async function hasData(page, key) {
  return page.evaluate(key => INK['synthetic:q']?.length === 1 && NOTES.synthetic?.[0]?.text === 'Invented note'
    && LOG.some(row => row.q === 'synthetic-e7') && CHATS._general?.[0]?.content === 'Invented conversation'
    && Memory.all().some(row => row.text === 'Invented memory') && S.sessionTotal === 6
    && S.sessionCorrect === 4 && REF.some(note => note.id === 'synthetic-e7' && note.body.includes('refimg://' + key))
    && RefAssets.has(key), key);
}

(async () => {
  const browser = await launch();
  try {
    const source = await open(browser);
    let downloads = 0;
    source.on('download', () => downloads++);
    const key = await source.evaluate(async () => {
      const raw = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXGQAAAAASUVORK5CYII=');
      const key = RefAssets.add(Uint8Array.from(raw, c => c.charCodeAt(0)), 'synthetic.png');
      await RefAssets.flush();
      INK['synthetic:q'] = [{ c: '#005555', w: 2, p: [[0, 0], [1, 1]] }];
      saveInkNow();
      NOTES.synthetic = [{ id: 'synthetic', x: 0, y: 0, text: 'Invented note' }];
      saveJSON(NOTE_KEY, NOTES);
      REF.push({ id: 'synthetic-e7', title: 'Invented reference', body: 'Synthetic text. '.repeat(2500) + '![Figure](refimg://' + key + ')' });
      saveJSON('accsap12.ref', REF);
      LOG.push({ q: 'synthetic-e7', t: Date.now(), m: 'practice', ok: 1 });
      saveJSON(LOG_KEY, LOG);
      CHATS._general = [{ role: 'user', content: 'Invented conversation' }];
      saveJSON('accsap12.chat', CHATS);
      Memory.add('Invented memory', 'fact', { said: true });
      S.sessionTotal = 6; S.sessionCorrect = 4; S.sinceBackup = 7; S.lastBackup = 0;
      save();
      return key;
    });

    await exportButton(source).click();
    const exportDialog = dialog(source);
    await exportDialog.locator('[name="passphrase"]').fill(passphrase);
    await exportDialog.getByLabel('Confirm passphrase').fill('different passphrase');
    await exportDialog.getByRole('button', { name: 'Download encrypted file' }).click();
    const message = await exportDialog.getByRole('status').textContent();
    ok('the export uses masked entry and rejects mismatched passphrases',
      message.includes('do not match') && await exportDialog.locator('[type="password"]').count() === 2 && downloads === 0);
    await exportDialog.getByRole('button', { name: 'Cancel' }).click();
    await source.waitForFunction(() => !backupBusy);
    ok('cancelling export creates no file or pending confirmation', downloads === 0 && await source.evaluate(() => pendingBackupSave === null));

    const first = await exportFile(source);
    const envelope = JSON.parse(first.text);
    ok('the download contains only a versioned encrypted envelope',
      /^systole-encrypted-backup-\d{4}-\d{2}-\d{2}\.json$/.test(first.name)
      && envelope.format === 'systole-encrypted-backup' && envelope.v === 1
      && Object.keys(envelope).sort().join(',') === 'ciphertext,format,iv,salt,v'
      && !first.text.includes('Invented conversation') && !first.text.includes(passphrase));
    const payload = readWithNode(envelope);
    ok('independent PBKDF2 and AES-GCM decryption opens the full version 6 payload',
      payload.v === 6 && payload.refs.some(note => note.id === 'synthetic-e7' && note.body.length > 24576)
      && payload.chat._general[0].content === 'Invented conversation' && !!payload.assets[key]);
    const second = JSON.parse((await exportFile(source)).text);
    ok('each export gets a fresh salt and IV and waits for save confirmation', second.salt !== envelope.salt && second.iv !== envelope.iv
      && await source.evaluate(() => pendingBackupSave?.reviews === 7 && S.sinceBackup === 7 && S.lastBackup === 0));
    await source.context().close();

    const targetPage = await open(browser);
    const before = await snapshot(targetPage);
    await selectFile(targetPage, first.text);
    await dialog(targetPage).getByRole('button', { name: 'Cancel' }).click();
    await targetPage.waitForFunction(() => !backupBusy);
    ok('cancelling encrypted import leaves live and stored state untouched', await snapshot(targetPage) === before);

    await selectFile(targetPage, first.text);
    const wrong = await unlock(targetPage, 'another invented passphrase');
    ok('the wrong passphrase reports failure without changing live or stored state',
      wrong.includes('Wrong passphrase or damaged encrypted backup') && await snapshot(targetPage) === before);

    const corrupted = { ...envelope, ciphertext: (envelope.ciphertext[0] === 'A' ? 'B' : 'A') + envelope.ciphertext.slice(1) };
    await selectFile(targetPage, JSON.stringify(corrupted));
    const damaged = await unlock(targetPage, passphrase);
    ok('changed ciphertext fails authentication without changing live or stored state',
      damaged.includes('Wrong passphrase or damaged encrypted backup') && await snapshot(targetPage) === before);

    const unusable = await targetPage.evaluate(({ passphrase, payload }) =>
      BackupCrypto.encrypt(JSON.stringify({ ...payload, assets: null }), passphrase), { passphrase, payload });
    await selectFile(targetPage, JSON.stringify(unusable));
    ok('an authenticated but invalid payload is refused before restoring',
      await unlock(targetPage, passphrase) === 'That file could not be read.' && await snapshot(targetPage) === before);

    await selectFile(targetPage, first.text);
    ok('the correct passphrase restores ink, notes, images, reviews, progress, chat and memory now',
      await unlock(targetPage, passphrase) === 'Annotations restored.' && await hasData(targetPage, key));
    await targetPage.reload();
    await ready(targetPage);
    ok('restored data survives a reload', await hasData(targetPage, key));

    await progress(targetPage);
    await targetPage.evaluate(() => { BackupCrypto.available = () => false; });
    await exportButton(targetPage).click();
    ok('a browser without Web Crypto leaves the plain export available',
      (await targetPage.locator('#toast').textContent()).includes('Encrypted backups need Web Crypto')
      && await targetPage.getByRole('button', { name: 'Export everything' }).isEnabled() && await dialog(targetPage).count() === 0);
    await targetPage.context().close();
  } finally { await browser.close(); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
