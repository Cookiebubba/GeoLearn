import { devices, expect, test, type Page } from '@playwright/test';
import { asPlayer } from './helpers';

const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test('quad teams lobby fits the smallest iPhone and teams can be switched', async ({ browser }) => {
  // iPhone SE (1st gen): 320 CSS px wide, the narrowest phone we support.
  const names = ['Ada', 'Bo', 'Chiara'];
  const pages: Page[] = [];
  for (const name of names) {
    const ctx = await browser.newContext({ ...devices['iPhone SE'] });
    await asPlayer(ctx, name);
    pages.push(await ctx.newPage());
  }
  const [host, ...guests] = pages;

  await host.goto('/puzzle');
  await host.getByRole('button', { name: 'Quad' }).click();
  await host.getByRole('button', { name: 'Teams' }).click();
  await host.getByRole('button', { name: /Asia/ }).click();
  await host.waitForURL(/\/room\/[A-Z0-9]{5}$/);
  const code = host.url().split('/').pop()!;
  for (const g of guests) {
    await g.goto(`/room/${code}`);
    await expect(g.getByText(/Waiting for Ada to start/)).toBeVisible();
  }
  await expect(host.getByText('3 / 4 here')).toBeVisible();

  for (const page of pages) expect(await sideways(page)).toBeLessThanOrEqual(0);
  await expect(host.getByText('Team Tide')).toBeVisible();
  await expect(host.getByText('Team Ember')).toBeVisible();

  // Chiara moves herself to the other team; everyone sees it.
  const chiara = guests[1];
  const before = await chiara.getByRole('button', { name: /^Switch to Team/ }).getAttribute('aria-label');
  await chiara.getByRole('button', { name: /^Switch to Team/ }).click();
  await expect(chiara.getByRole('button', { name: /^Switch to Team/ })).not.toHaveAttribute('aria-label', before!);
  for (const page of pages) expect(await sideways(page)).toBeLessThanOrEqual(0);

  for (const page of pages) await page.context().close();
});
