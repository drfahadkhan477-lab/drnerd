/* Version 1 fixes the crypto parameters. A file cannot set its own KDF cost.
   The authenticated plaintext is the same JSON payload as the plain export. */
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

async function encrypt(text, passphrase) {
  const salt = root.crypto.getRandomValues(new Uint8Array(16));
  const iv = root.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, 'encrypt');
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
  const key = await deriveKey(passphrase, salt, 'decrypt');
  const plaintext = await root.crypto.subtle.decrypt(parameters(iv), key, ciphertext);
  return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
}

root.BackupCrypto = { available, isEncrypted, encrypt, decrypt };
})(typeof window !== 'undefined' ? window : globalThis);
