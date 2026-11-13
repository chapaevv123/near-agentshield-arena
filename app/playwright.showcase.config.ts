import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'showcase.spec.ts',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:4182', browserName: 'chromium', channel: 'msedge' },
});
