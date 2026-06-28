const { defineConfig } = require('@playwright/test');

// Smoke tests run against a throwaway COPY of the vault (.test-vault) on port 4188,
// so like/reply/post write-backs never touch your real ./vault.
module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  expect: { timeout: 7000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4188', headless: true, actionTimeout: 7000 },
  webServer: {
    command: 'rm -rf .test-vault && cp -R vault .test-vault && node server.js .test-vault 4188',
    port: 4188,
    reuseExistingServer: false,
    timeout: 20000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
