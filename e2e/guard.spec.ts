import { expect, test } from '@playwright/test';
import { asPlayer, waitForPlay } from './helpers';

test('an accidental back swipe asks first instead of ending the game', async ({ page, context }) => {
  await asPlayer(context, 'Careful Cleo');
  await page.goto('/puzzle');
  await page.getByRole('button', { name: /Oceania/ }).click();
  await waitForPlay(page);
  await page.waitForTimeout(100);
  const room = page.url();

  // One "back" (an iOS edge swipe, Android's back gesture) only warns.
  await page.evaluate(() => history.back());
  await expect(page.getByText('Go back once more to leave the game')).toBeVisible();
  expect(page.url()).toBe(room);
  expect(await page.evaluate(() => window.__geolearn!.engine.isInteractive)).toBe(true);

  // A second one, straight after, really leaves.
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(/\/puzzle$/);
});
