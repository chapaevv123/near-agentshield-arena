import { test, expect } from '@playwright/test';

test('landing launches an isolated owner workspace without historical wallet data', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /Launch App/ }).first().click();
  await expect(page).toHaveURL(/\/app\/$/);
  await expect(page.getByRole('heading', { name: 'My Vault' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect Meteor Wallet' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Vault onboarding' })).toContainText('Connect wallet');
  await expect(page.getByRole('button', { name: 'Submit REQUEST once' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Manual Testnet payment demo' })).toContainText('Agent account seen in Meteor: not yet');
  await expect(page.getByRole('button', { name: '1. Owner: Renew Agent Grant' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '4. Agent: Execute Payment' })).toBeDisabled();
  await expect(page.getByText('FINAL SETTLED')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('FINAL SETTLED')).toHaveCount(0);
  await expect(page.getByText('Historical proof showcase')).toBeVisible();
});
