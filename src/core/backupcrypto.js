/* Version 1 fixes the crypto parameters. A file cannot set its own KDF cost.
   The authenticated plaintext is the same JSON payload as the plain export.
   tests/verify-backupcrypto-pure.js holds the envelope in Node; tests/verify-backupcrypto drives it through Progress. */
(function(root){
'use strict';

const FORMAT = 'systole-encrypted-backup';
const VERSION = 1;
const ITERATIONS = 600000;

function available() {
  return !!root.crypto?.subtle;
}

function isEncrypted(value) {
  return value?.format === FORMAT || value?.ciphertext !== undefined;
}

function encode(bytes) {
  const blocks = [];
  // A multiple of three lets each block be encoded without intermediate padding.
  const size = 24576;
  for (let at = 0; at < bytes.length; at += size) {
    blocks.push(btoa(String.fromCharCode(...bytes.subarray(at, at + size))));
  }
  return blocks.join('');
}

function decode(text) {
  if (typeof text !== 'string' || !text.length || text.length % 4 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('Invalid encrypted backup.');
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function deriveKey(passphrase, salt, usage) {
  const { subtle } = root.crypto;
  const material = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

function parameters(iv) {
  return { name: 'AES-GCM', iv, tagLength: 128,
    additionalData: new TextEncoder().encode(FORMAT + ':v' + VERSION) };
}

/* A passphrase is keyed in its NFC form (RFC 8265, OpaqueString). An accented letter can be typed as one code point or
   as a letter and a combining mark, which look the same and would otherwise make different keys, so a backup made on
   one keyboard would not open from another. */
function normalized(passphrase) {
  return String(passphrase).normalize('NFC');
}

/* Files made before passphrases were normalized were keyed with the passphrase as typed, in whichever form that was.
   So a restore tries the NFC form first, then the decomposed form and the passphrase exactly as given, each once:
   any file from either keyboard opens with the same letters. Only a wrong passphrase pays for the extra derivations. */
function candidates(passphrase) {
  const raw = String(passphrase);
  return [...new Set([raw.normalize('NFC'), raw.normalize('NFD'), raw])];
}

/* A new file needs a passphrase of at least this many characters, counted as code points of its NFC form, so an accented
   letter or an emoji is one character however it was typed or stored (the owner's rule, docs/ROADMAP.md, E7). The cost
   above slows each guess; the length is what makes the guesses many. A restore asks no length: a file made before the
   rule opens with its own passphrase. */
const MIN_PASSPHRASE = 12;
function longEnough(passphrase) {
  return [...normalized(passphrase)].length >= MIN_PASSPHRASE;
}

async function encrypt(text, passphrase) {
  if (!longEnough(passphrase)) throw new Error('Passphrase too short.');
  const salt = root.crypto.getRandomValues(new Uint8Array(16));
  const iv = root.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(normalized(passphrase), salt, 'encrypt');
  const ciphertext = await root.crypto.subtle.encrypt(parameters(iv), key, new TextEncoder().encode(text));
  return { format: FORMAT, v: VERSION, salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
}

async function decrypt(file, passphrase) {
  if (file.format !== FORMAT || file.v !== VERSION) throw new Error('Unsupported encrypted backup format.');
  if (typeof file.salt !== 'string' || file.salt.length !== 24 || typeof file.iv !== 'string' || file.iv.length !== 16) {
    throw new Error('Invalid encrypted backup.');
  }
  const salt = decode(file.salt), iv = decode(file.iv), ciphertext = decode(file.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length <= 16) throw new Error('Invalid encrypted backup.');
  let failure = null;
  for (const form of candidates(passphrase)) {
    const key = await deriveKey(form, salt, 'decrypt');
    let plaintext;
    try { plaintext = await root.crypto.subtle.decrypt(parameters(iv), key, ciphertext); }
    catch (error) { failure = error; continue; }
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
  }
  throw failure;
}

root.BackupCrypto = { available, isEncrypted, encrypt, decrypt, longEnough, MIN_PASSPHRASE };
})(typeof window !== 'undefined' ? window : globalThis);
