'use strict';

const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {booted} = require('../tests/_render');

// The page uses a placeholder connection. The caller owns request routing.
async function askFixture(page, build, fixture, timeout) {
  await page.goto(pathToFileURL(path.resolve(build)).href);
  await booted(page);
  await page.evaluate(f => {
    REF.length = 0;
    REF.push(...f.notes);
    invalidateIndex();
    AI_GROUNDED = true;
    AI.provider = 'gemini';
    AI.gemini = {key: 'offline-evaluation-placeholder', model: 'evaluation-model'};
    CHATS = {};
    S.screen = 'home';
    fire(f.question);
  }, fixture);
  await page.waitForFunction(() => !aiBusy, null, {timeout});
}

module.exports = {askFixture};
