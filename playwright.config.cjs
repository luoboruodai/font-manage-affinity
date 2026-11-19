'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { defineConfig } = require('@playwright/test');

const validation = path.join(__dirname, 'private', 'validation', 'v05');
const port = Number(process.env.FONT_MANAGE_TEST_PORT) || 49179;
const origin = `http://127.0.0.1:${port}`;
fs.mkdirSync(validation, { recursive: true });
const data = process.env.FONT_MANAGE_TEST_DATA ?? fs.mkdtempSync(path.join(validation, 'qa-data-'));
process.env.FONT_MANAGE_TEST_DATA = data;

module.exports = defineConfig({
  testDir: './tests',
  testMatch: 'workspace.spec.cjs',
  outputDir: path.join(validation, 'ui-test', 'results'),
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(validation, 'ui-test', 'results.json') }]
  ],
  use: {
    browserName: 'chromium',
    channel: 'chrome',
    headless: true,
    viewport: { width: 520, height: 780 },
    baseURL: origin,
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'node server/server.cjs',
    cwd: __dirname,
    env: { FONT_MANAGE_DATA: data, FONT_MANAGE_PORT: String(port), FONT_MANAGE_DISABLE_HOST: '1' },
    url: origin,
    reuseExistingServer: false,
    timeout: 30000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 1500 }
  }
});
