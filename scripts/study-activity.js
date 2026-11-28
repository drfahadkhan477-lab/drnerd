#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const readline = require('node:readline/promises');
const { Writable } = require('node:stream');
const { Calib } = require('../src/core/calib.js');
const { FSRS } = require('../src/core/fsrs.js');
require('../src/core/backupcrypto.js');
const { BackupCrypto } = globalThis;

async function readPassphrase() {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error('Open an interactive terminal to enter the backup passphrase.');
  }
  // Readline handles editing and restores terminal settings on close. Discard its echo.
  const muted = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const line = readline.createInterface({ input: process.stdin, output: muted, terminal: true, historySize: 0 });
  const abort = new AbortController();
  line.once('SIGINT', () => abort.abort());
  line.once('close', () => abort.abort());
  process.stderr.write('Backup passphrase (input hidden): ');
  try {
    return await line.question('', { signal: abort.signal });
  } catch {
    throw new Error('Backup passphrase entry was canceled.');
  } finally {
    line.close();
    process.stderr.write('\n');
  }
}

async function report(file, asOf) {
  const day = FSRS.isoToLocalDate(asOf);
  if (!day || FSRS.localDateToISO(day) !== asOf) throw new Error('Enter a real date as YYYY-MM-DD.');

  let backup;
  try {
    backup = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('Could not read the backup as JSON.');
  }
  if (BackupCrypto.isEncrypted(backup)) {
    const passphrase = await readPassphrase();
    try {
      backup = JSON.parse(await BackupCrypto.decrypt(backup, passphrase));
    } catch {
      throw new Error('Could not open the encrypted backup. Check its passphrase and format.');
    }
  }
  const daily = backup?.stats?.daily;
  const hasDaily = daily && typeof daily === 'object' && !Array.isArray(daily);
  const hasLog = Array.isArray(backup?.log);
  if (!Number.isInteger(backup?.v) || (!hasLog && !hasDaily)) {
    throw new Error('Use a Systole backup containing the review log or daily progress.');
  }

  const log = hasLog ? backup.log : [];
  const currentWeek = Calib.weekOf(day);
  const weeks = [FSRS.addDays(currentWeek, -14), FSRS.addDays(currentWeek, -7)].map(start => {
    const end = FSRS.addDays(start, 7);
    const ratings = Array.from({ length: 7 }, (_, offset) => hasDaily ? daily[FSRS.addDays(start, offset)]?.r : null)
      .filter(count => Number.isInteger(count) && count >= 0);
    const answers = log.filter(row => {
      if (!row || !Number.isFinite(row.t) || ![0, 1, false, true].includes(row.ok)) return false;
      const date = new Date(row.t);
      if (!Number.isFinite(date.getTime())) return false;
      const answerDay = FSRS.localDateToISO(date);
      return answerDay >= start && answerDay < end;
    });
    const calibration = Calib.calibration(answers);

    return {
      start,
      end: FSRS.addDays(end, -1),
      sessions: null,
      reviewsDone: ratings.length ? ratings.reduce((sum, count) => sum + count, 0) : null,
      daysWithRatingCounts: ratings.length,
      reviewsDue: null,
      certainAnswers: hasLog ? calibration.bands[3].n : null,
      certainAndWrongRate: calibration.certainButWrong,
    };
  });
  return {
    asOf,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    weeks,
    unmeasured: {
      sessions: 'The backup does not record session boundaries.',
      reviewsDue: 'The backup does not record past due queue sizes.',
    },
  };
}

async function main() {
  const [, , file, asOf = FSRS.todayISO(), ...extra] = process.argv;
  if (!file || extra.length) throw new Error('Usage: node scripts/study-activity.js <backup.json> [YYYY-MM-DD]');
  console.log(JSON.stringify(await report(file, asOf), null, 2));
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
