import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const screenshots = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const hashes = ['6YjcdhYxs65JQMtfqDLgMM2PfadMtJQkSfHjmR4KCT1N','2Yo8N6TvbtobhWYH8UxvgAAxCrm1FGXduBa82qZCUmr8','ApXoyN7EpG6S8DFX6gfm919tqQFQC4u911MDxU7p4KdS'];

test('desktop proof, navigation, controls and screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page).toHaveTitle(/AgentShield Arena/);
  await expect(page.getByRole('heading', { name: /Secure payments/ })).toBeVisible();
  await page.getByRole('link', { name: /Explore the real payment/ }).click();
  await expect(page).toHaveURL(/#demo$/);
  await page.getByRole('tab', { name: /Request/ }).click();
  await expect(page.getByRole('tabpanel')).toContainText(hashes[1]);
  await page.getByRole('tab', { name: /Execute/ }).click();
  await expect(page.getByRole('tabpanel')).toContainText(hashes[2]);
  await expect(page.getByRole('tabpanel')).toContainText('bhH1rHpPWmLPrWKo8dUYfQuWQxhpUNezUEEoESR1frv');
  for (const [name, selected] of [['Inspect authorization', 'Authorize'], ['Inspect request', 'Request'], ['Inspect settlement', 'Execute']]) {
    await page.getByRole('link', { name: new RegExp(name, 'i') }).click();
    await expect(page.getByRole('tab', { name: new RegExp(selected, 'i') })).toHaveAttribute('aria-selected', 'true');
  }
  for (const hash of hashes) await expect(page.locator(`a[href="https://testnet.nearblocks.io/txns/${hash}"]`).first()).toBeVisible();
  const badLinks = await page.locator('a[href="#"], a:not([href])').count();
  expect(badLinks).toBe(0);
  const anchors = await page.locator('a[href^="#"]').evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).getAttribute('href')!.slice(1)));
  for (const target of anchors) expect(await page.locator(`#${target}`).count(), `missing #${target}`).toBe(1);
  const desktopOverflow = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 2).map((e) => `${e.tagName}.${e.className}`).slice(0, 10) }));
  expect(desktopOverflow, JSON.stringify(desktopOverflow)).toMatchObject({ scrollWidth: desktopOverflow.width });
  await page.goto('/');
  await page.screenshot({ path: `${screenshots}desktop.png`, fullPage: true });
});

test('mobile menu, readable proof and screenshot', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const menu = page.getByRole('button', { name: /Menu/ });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.click();
  await expect(page.getByRole('button', { name: /Close menu/ })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Demo' }).click();
  await expect(page).toHaveURL(/#demo$/);
  await expect(page.getByRole('button', { name: /Menu/ })).toHaveAttribute('aria-expanded', 'false');
  const mobileOverflow = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 2).map((e) => `${e.tagName}.${e.className}`).slice(0, 10) }));
  expect(mobileOverflow, JSON.stringify(mobileOverflow)).toMatchObject({ scrollWidth: mobileOverflow.width });
  await page.goto('/');
  await page.screenshot({ path: `${screenshots}mobile.png`, fullPage: true });
});

test('keyboard focus, image, and reduced motion smoke', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await expect(page.locator('img[alt="NEAR Protocol symbol"]')).toBeVisible();
  expect(await page.locator('img[alt="NEAR Protocol symbol"]').evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(await page.locator('button:not([aria-label]):not(:has-text("Menu")):not([role="tab"])').count()).toBe(0);
});

test('tablet layout has no horizontal overflow and tabs remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/');
  await page.getByRole('tab', { name: /Execute/ }).click();
  await expect(page.getByRole('tabpanel')).toContainText(hashes[2]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
});
