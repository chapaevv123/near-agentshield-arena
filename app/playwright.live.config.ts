import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'live.spec.ts',
  timeout: 35_000,
  use: {
    baseURL: process.env.AGENTSHIELD_PUBLIC_URL || 'https://near-agentshield-arena.vercel.app',
    browserName: 'chromium',
    channel: 'msedge',
  },
});
