import { expect, test } from '@playwright/test';

test('home fits a small phone and leads to the maps', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Rebuild the world/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole('link', { name: /Map Puzzle/ }).click();
  await expect(page).toHaveURL(/\/puzzle$/);
  for (const name of ['Europe', 'Africa', 'South America', 'North America', 'Asia', 'Oceania', 'The World']) {
    await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();
  }
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow2).toBeLessThanOrEqual(0);
});

test('a new player is asked for a name, and taken names are refused', async ({ browser }) => {
  // Someone else claims "Magellan" first.
  const other = await browser.newContext();
  const op = await other.newPage();
  await op.goto('/');
  const claimed = await op.evaluate(() =>
    fetch('/api/players/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Magellan', token: 'magellan-token-0123456789' }) }).then((r) => r.status),
  );
  expect(claimed).toBe(200);
  await other.close();

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/puzzle');
  await page.getByRole('button', { name: /Oceania/ }).click();
  const input = page.getByLabel('Username');
  await expect(input).toBeVisible();
  await input.fill('Magellan');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('That name is already taken')).toBeVisible();
  await input.fill('Ibn Battuta');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForFunction(() => window.__geolearn?.engine?.isInteractive === true, null, { timeout: 30_000 });
  await ctx.close();
});
