#!/usr/bin/env node
/*
 * Starts the Chrome DevTools MCP server (chrome-devtools-mcp) for an agent session; .mcp.json runs it.
 *
 * In a cloud container there is no Chrome and no display, only the Chromium Playwright installed under
 * /opt/pw-browsers: the newest one found there is used, headless, sandbox off, with a profile thrown away on close.
 * Anywhere else nothing is chosen for the server, which finds the machine's own Chrome.
 *
 * It is a debugging tool (pages, console, network, performance traces), not a test runner: the suites drive their
 * own browsers through Playwright and do not use it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = '/opt/pw-browsers';
const args = ['-y', 'chrome-devtools-mcp@latest'];
try {
  const found = fs.readdirSync(ROOT)
    .filter(d => /^chromium-\d+$/.test(d))
    .sort((a, b) => +b.split('-')[1] - +a.split('-')[1])
    .map(d => ['chrome-linux64', 'chrome-linux'].map(sub => path.join(ROOT, d, sub, 'chrome')).find(f => fs.existsSync(f)))
    .find(Boolean);
  if (found) args.push('--headless', '--isolated', '--executablePath', found, '--chromeArg=--no-sandbox');
} catch (_) { /* not a cloud container: the server finds Chrome itself */ }

const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { stdio: 'inherit' });
child.on('exit', code => process.exit(code === null ? 1 : code));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
