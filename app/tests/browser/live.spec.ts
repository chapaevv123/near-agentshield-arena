import { test, expect } from '@playwright/test';

const site = 'https://near-agentshield-arena.vercel.app';
const github = 'https://github.com/chapaevv123/near-agentshield-arena';
const hashes = [
  '6YjcdhYxs65JQMtfqDLgMM2PfadMtJQkSfHjmR4KCT1N',
  '2Yo8N6TvbtobhWYH8UxvgAAxCrm1FGXduBa82qZCUmr8',
  'ApXoyN7EpG6S8DFX6gfm919tqQFQC4u911MDxU7p4KdS',
];

test('public desktop journey, assets and console', async ({ page }) => {
  const errors: string[] = [];
  const localhostCalls: string[] = [];
  const failedSiteResponses: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', (request) => { if (/localhost|127\.0\.0\.1|\/api\/v1/.test(request.url())) localhostCalls.push(request.url()); });
  page.on('response', (response) => { if (response.url().startsWith(site) && response.status() >= 400) failedSiteResponses.push(`${response.status()} ${response.url()}`); });
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.goto('/', { waitUntil: 'networkidle' });
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: /Secure payments/ })).toBeVisible();
  await expect(page.getByText('VERIFIED TESTNET PROOF')).toBeVisible();
  await expect(page.getByRole('link', { name: /Open GitHub source/ })).toHaveAttribute('href', github);
  await page.getByRole('link', { name: /Explore the real payment/ }).click();
  await expect(page).toHaveURL(/#demo$/);
  for (const [name, hash] of [['Authorize', hashes[0]], ['Request', hashes[1]], ['Execute', hashes[2]]]) {
    await page.getByRole('tab', { name: new RegExp(name) }).click();
    await expect(page.getByRole('tabpanel')).toContainText(hash);
    await expect(page.locator(`a[href="https://testnet.nearblocks.io/txns/${hash}"]`).first()).toBeVisible();
  }
  const anchors = await page.locator('a[href^="#"]').evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).getAttribute('href')!.slice(1)));
  for (const target of anchors) expect(await page.locator(`#${target}`).count(), `missing #${target}`).toBe(1);
  await expect(page.locator('img[alt="NEAR Protocol symbol"]')).toBeVisible();
  expect(await page.locator('img[alt="NEAR Protocol symbol"]').evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(await page.locator('a[href="#"], a:not([href])').count()).toBe(0);
  expect(localhostCalls).toEqual([]);
  expect(failedSiteResponses).toEqual([]);
  expect(errors).toEqual([]);
});

test('public mobile navigation and layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await page.getByRole('button', { name: /Menu/ }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Docs' }).click();
  await expect(page).toHaveURL(/#docs$/);
  await expect(page.getByRole('heading', { name: 'Source code' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
