#!/usr/bin/env node
/*
 * The encrypted backup's envelope — src/core/backupcrypto.js (docs/ROADMAP.md, E7).
 *
 *   node tests/verify-backupcrypto-pure.js
 *
 * Pure Node, over the module as the page loads it, with Node's own Web Crypto. What a file must hold, and what opens
 * it, is worked out here with node:crypto (PBKDF2 and AES-GCM written again from the parameters), never read back
 * from the module. tests/verify-backupcrypto drives the same envelope through the Progress screen in a browser.
 * All data and passphrases are invented.
 *
 * What is measured, rather than assumed:
 *   - a file is the five fields and nothing else, a fresh salt and IV each time, and opens with an independent
 *     PBKDF2-SHA-256 at 600,000 iterations and AES-GCM-256 with the format and version as its additional data;
 *   - a file made independently with those parameters opens; one keyed at any other cost, or with other additional
 *     data, does not, whatever the file says of itself;
 *   - a wrong passphrase, a changed ciphertext, a salt or IV of the wrong size, a ciphertext no longer than its tag, and
 *     an unknown format or version are each refused;
 *   - a passphrase is keyed in its NFC form, so one typed as a letter and a combining mark opens a file made from the
 *     same letters typed as one code point, and the other way; and a file keyed with the passphrase as typed, as files
 *     were before, opens from either form.
 */
'use strict';
const nodeCrypto = require('node:crypto');
require('../src/core/backupcrypto.js');
const B = globalThis.BackupCrypto;

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  cond ? passed++ : failed++;
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  → ' + String(detail).replace(/\s+/g, ' ') : ''));
};
const head = t => console.log('\n── ' + t + ' ──');
const J = v => JSON.stringify(v);

const FORMAT = 'systole-encrypted-backup', ITER = 600000;
const AAD = Buffer.from(FORMAT + ':v1');
const b64 = buf => Buffer.from(buf).toString('base64');
/* PBKDF2 and AES-GCM written again here, from the parameters, with node:crypto. */
const key = (pass, salt, iter = ITER) => nodeCrypto.pbkdf2Sync(Buffer.from(pass, 'utf8'), salt, iter, 32, 'sha256');
function sealHere(text, pass, { iter = ITER, aad = AAD, extra = {} } = {}) {
  const salt = nodeCrypto.randomBytes(16), iv = nodeCrypto.randomBytes(12);
  const c = nodeCrypto.createCipheriv('aes-256-gcm', key(pass, salt, iter), iv); c.setAAD(aad);
  const body = Buffer.concat([c.update(text, 'utf8'), c.final(), c.getAuthTag()]);
  return Object.assign({ format: FORMAT, v: 1, salt: b64(salt), iv: b64(iv), ciphertext: b64(body) }, extra);
}
function openHere(file, pass) {
  const salt = Buffer.from(file.salt, 'base64'), iv = Buffer.from(file.iv, 'base64'), all = Buffer.from(file.ciphertext, 'base64');
  const d = nodeCrypto.createDecipheriv('aes-256-gcm', key(pass, salt), iv); d.setAAD(AAD); d.setAuthTag(all.subarray(all.length - 16));
  return Buffer.concat([d.update(all.subarray(0, all.length - 16)), d.final()]).toString('utf8');
}
const attempt = async (f, pass) => { try { return { text: await B.decrypt(f, pass) }; } catch (e) { return { error: e && (e.name + ': ' + e.message) }; } };

(async () => {
  const PAYLOAD = J({ v: 6, notes: { q1: 'an invented note — ünïcödé ✓' }, refs: [], log: [] });
  const PASS = 'invented backup passphrase';

  head('what a file holds');
  {
    const a = await B.encrypt(PAYLOAD, PASS), b = await B.encrypt(PAYLOAD, PASS);
    ok('the five fields, and nothing else: the format, version 1, a salt, an IV and the ciphertext',
       J(Object.keys(a)) === J(['format', 'v', 'salt', 'iv', 'ciphertext']) && a.format === FORMAT && a.v === 1, J(Object.keys(a)));
    ok('a 16-byte salt and a 12-byte IV, new for each file', Buffer.from(a.salt, 'base64').length === 16 && Buffer.from(a.iv, 'base64').length === 12 && a.salt !== b.salt && a.iv !== b.iv);
    let opened = null; try { opened = openHere(a, PASS); } catch (e) { opened = 'THREW ' + e.message; }
    ok('it opens with PBKDF2-SHA-256 at 600,000 iterations and AES-GCM-256, the format and version as additional data, worked out here', opened === PAYLOAD, String(opened).slice(0, 60));
    ok('and the module opens it again', (await attempt(a, PASS)).text === PAYLOAD);
  }

  head('what opens a file is fixed by the module, not by the file');
  {
    ok('a file made here with those parameters opens', (await attempt(sealHere(PAYLOAD, PASS), PASS)).text === PAYLOAD);
    const cheap = sealHere(PAYLOAD, PASS, { iter: 1, extra: { iterations: 1 } });
    ok('one keyed at one iteration is refused, though it says so of itself', !!(await attempt(cheap, PASS)).error, (await attempt(cheap, PASS)).error);
    const said = sealHere(PAYLOAD, PASS, { extra: { iterations: 1, hash: 'SHA-1' } });
    ok('and one keyed at the fixed cost opens whatever it says of its own', (await attempt(said, PASS)).text === PAYLOAD);
    const otherAad = sealHere(PAYLOAD, PASS, { aad: Buffer.from(FORMAT + ':v2') });
    ok('one sealed with other additional data is refused', !!(await attempt(otherAad, PASS)).error);
  }

  head('what is refused');
  {
    const f = await B.encrypt(PAYLOAD, PASS);
    ok('a wrong passphrase', !!(await attempt(f, PASS + '!')).error);
    const bytes = Buffer.from(f.ciphertext, 'base64'); bytes[3] ^= 1;
    ok('a changed ciphertext', !!(await attempt(Object.assign({}, f, { ciphertext: b64(bytes) }), PASS)).error);
    const shaped = [['a 15-byte salt', { salt: b64(nodeCrypto.randomBytes(15)) }], ['an 11-byte IV', { iv: b64(nodeCrypto.randomBytes(11)) }],
      ['a ciphertext no longer than its tag', { ciphertext: b64(nodeCrypto.randomBytes(16)) }], ['a salt that is not text', { salt: 7 }]];
    const said = [];
    for (const [, over] of shaped) said.push((await attempt(Object.assign({}, f, over), PASS)).error || 'OPENED');
    ok('a salt or IV of the wrong size, a ciphertext no longer than its tag, a salt that is not text: "Invalid encrypted backup."',
       said.every(s => /Invalid encrypted backup\./.test(s)), said.join(' | '));
    const v2 = (await attempt(Object.assign({}, f, { v: 2 }), PASS)).error, other = (await attempt(Object.assign({}, f, { format: 'other' }), PASS)).error;
    ok('an unknown version or format: "Unsupported encrypted backup format."', /Unsupported encrypted backup format\./.test(v2) && /Unsupported encrypted backup format\./.test(other), v2 + ' | ' + other);
  }

  head('the same letters open a file, however they were typed');
  {
    /* "é" as one code point, and as "e" and a combining acute: the same letters, two strings. */
    const ONE = 'caf\u00e9 cr\u00e8me 2026', TWO = 'cafe\u0301 cre\u0300me 2026';
    ok('the two are different strings with the same NFC form', ONE !== TWO && ONE.normalize('NFC') === TWO.normalize('NFC'));
    const fromOne = await B.encrypt(PAYLOAD, ONE), fromTwo = await B.encrypt(PAYLOAD, TWO);
    ok('a file made from one form opens from the other, both ways', (await attempt(fromOne, TWO)).text === PAYLOAD && (await attempt(fromTwo, ONE)).text === PAYLOAD);
    let nfc = null; try { nfc = openHere(fromTwo, ONE.normalize('NFC')); } catch (e) { nfc = 'THREW'; }
    ok('a file is keyed with the NFC form of what was typed', nfc === PAYLOAD);
    /* Files made before were keyed with the passphrase exactly as typed. */
    const oldTwo = sealHere(PAYLOAD, TWO), oldOne = sealHere(PAYLOAD, ONE);
    ok('a file keyed with the decomposed form as typed opens from either form', (await attempt(oldTwo, TWO)).text === PAYLOAD && (await attempt(oldTwo, ONE)).text === PAYLOAD);
    ok('and one keyed with the composed form as typed, from either form', (await attempt(oldOne, ONE)).text === PAYLOAD && (await attempt(oldOne, TWO)).text === PAYLOAD);
    ok('a different word is still refused', !!(await attempt(fromOne, 'cafe creme 2026')).error);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log('  FAIL  the suite threw  → ' + e.message); process.exit(1); });
