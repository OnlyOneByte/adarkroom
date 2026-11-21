// SPDX-License-Identifier: MIT
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PW_PORT) || 8181; // PW_PORT: when another checkout already serves 8181

export default defineConfig({
  testDir: 'tests',
  testMatch: '*.spec.js',
  // @slow tests (the fresh-save playthrough, ~10 min) stay out of the default run; PW_SLOW=1 (npm run test:slow) runs them
  grep: process.env.PW_SLOW ? /@slow/ : undefined,
  grepInvert: process.env.PW_SLOW ? undefined : /@slow/,
  timeout: 60000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node dev-server.js',
    env: { HOST: '127.0.0.1', PORT: String(PORT) },
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
  },
});
