import { expect, test } from '@playwright/test';
import { asPlayer, touchPlace, waitForPlay } from './helpers';

test('solo: finish Oceania with a finger and see the results', async ({ page, context }) => {
  await asPlayer(context, 'Solo Sam');
  await page.goto('/puzzle');
  await page.getByRole('button', { name: /Oceania/ }).click();
  await waitForPlay(page);
  await expect(page.locator('.progress-pill')).toContainText('0 / 15');
  // A first-time player gets a gentle hint, which steps aside once they've placed a country.
  const hint = page.getByText('Drag each country to where it belongs');
  await expect(hint).toBeVisible();

  const ids = await page.evaluate(() => window.__geolearn!.engine.pieceIds);
  let placed = 0;
  for (const id of ids) {
    if (await touchPlace(page, context, id)) placed++;
    if (placed === 1) await expect(hint).toBeHidden();
  }
  expect(placed).toBe(15);
  await expect(page.locator('.progress-pill')).toContainText('15 / 15');
  await expect(page.getByRole('dialog', { name: 'Results' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Map complete' })).toBeVisible();
  await expect(page.getByText(/fastest · solo/)).toBeVisible();

  // Play again starts a fresh countdown.
  await page.getByRole('button', { name: /Play again/ }).click();
  await waitForPlay(page);
  await expect(page.locator('.progress-pill')).toContainText('0 / 15');
});
