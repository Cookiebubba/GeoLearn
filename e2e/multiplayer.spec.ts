import { devices, expect, test } from '@playwright/test';
import { asPlayer, info, mousePlace, touchPlace, waitForPlay } from './helpers';

test('duo: join by code, pieces lock to their holder, finish together', async ({ browser }) => {
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const guestCtx = await browser.newContext({ ...devices['iPhone SE (3rd gen)'] });
  await asPlayer(hostCtx, 'Ada');
  await asPlayer(guestCtx, 'Grace');
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  await host.goto('/puzzle');
  await host.getByRole('button', { name: 'Duo' }).click();
  await host.getByRole('button', { name: /Oceania/ }).click();
  await host.waitForURL(/\/room\/[A-Z0-9]{5}$/);
  const code = host.url().split('/').pop()!;

  await guest.goto('/');
  await guest.getByLabel('Room code').fill(code);
  await guest.getByRole('button', { name: 'Join' }).click();
  await expect(guest.getByText(/Waiting for Ada to start/)).toBeVisible();
  await expect(host.getByText('Grace')).toBeVisible();

  await host.getByRole('button', { name: 'Start game' }).click();
  await Promise.all([waitForPlay(host), waitForPlay(guest)]);

  // Host picks up Australia; the guest sees it in Ada's hand and can't take it.
  await host.evaluate(() => window.__geolearn!.engine.fitTable(false));
  const aus = await info(host, 'AUS');
  await host.mouse.move(aus.x, aus.y);
  await host.mouse.down();
  await host.mouse.move(aus.x + 20, aus.y + 10, { steps: 4 });
  await expect.poll(async () => (await info(guest, 'AUS')).heldBy).not.toBeNull();
  await host.mouse.move(aus.homeX, aus.homeY, { steps: 8 });
  await host.mouse.up();
  await expect.poll(async () => (await info(guest, 'AUS')).placed).toBe(true);

  // Split the rest between the two players.
  const ids = (await host.evaluate(() => window.__geolearn!.engine.pieceIds)).filter((id) => id !== 'AUS');
  for (const [i, id] of ids.entries()) {
    const ok = i % 2 === 0 ? await mousePlace(host, id) : await touchPlace(guest, guestCtx, id);
    expect(ok, id).toBe(true);
  }
  await expect(host.getByRole('heading', { name: 'Map complete' })).toBeVisible({ timeout: 10_000 });
  await expect(guest.getByRole('heading', { name: 'Map complete' })).toBeVisible({ timeout: 10_000 });

  // The team appears on the duo leaderboard.
  const board = await host.evaluate(() => fetch('/api/leaderboard?kind=fastest&puzzle=oceania&party=duo').then((r) => r.json()));
  expect(board.entries[0].names).toBe('Ada & Grace');
  await hostCtx.close();
  await guestCtx.close();
});
