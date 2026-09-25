import { expect, test } from '@playwright/test';
import { asPlayer, touchPlace, waitForPlay } from './helpers';

test('solo still works when the realtime server is unreachable', async ({ page, context }) => {
  await asPlayer(context, 'Offline Olu');
  // Every WebSocket is refused: the game falls back to playing in the browser.
  await page.routeWebSocket(/\/ws$/, (ws) => ws.close());
  await page.goto('/puzzle');
  await page.getByRole('button', { name: /Oceania/ }).click();
  await waitForPlay(page);

  const ids = await page.evaluate(() => window.__geolearn!.engine.pieceIds);
  let placed = 0;
  for (const id of ids) if (await touchPlace(page, context, id)) placed++;
  expect(placed).toBe(ids.length);
  await expect(page.getByRole('dialog', { name: 'Results' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Offline · not ranked')).toBeVisible();
});
