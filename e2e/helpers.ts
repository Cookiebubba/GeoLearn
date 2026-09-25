import type { BrowserContext, Page } from '@playwright/test';

export interface PieceInfo {
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  placed: boolean;
  heldBy: string | null;
  onBoard: boolean;
  zoom: number;
}

declare global {
  interface Window {
    __geolearn?: {
      engine: {
        inspect(id: string): PieceInfo | null;
        pieceIds: string[];
        isInteractive: boolean;
        fitTable(animate?: boolean): void;
        progress: { placed: number; total: number };
      };
    };
  }
}

/** Signs in as `name` by seeding the identity the app keeps in localStorage. */
export async function asPlayer(ctx: BrowserContext, name: string, opts: { muted?: boolean } = {}) {
  const token = `${name.toLowerCase().replace(/\W/g, '')}-e2e-token-0123456789`;
  await ctx.addInitScript(
    ([name, token, muted]) => {
      localStorage.setItem('geolearn.identity', JSON.stringify({ state: { name, token }, version: 0 }));
      localStorage.setItem(
        'geolearn.prefs',
        JSON.stringify({
          state: { palette: 'atlas', visibility: { names: false, capitals: false, flags: false, revealOnPlace: true }, volume: 0.8, muted, haptics: true },
          version: 0,
        }),
      );
    },
    [name, token, opts.muted ?? true] as const,
  );
}

export async function waitForPlay(page: Page) {
  await page.waitForFunction(() => window.__geolearn?.engine?.isInteractive === true, null, { timeout: 30_000 });
}

export const info = (page: Page, id: string) => page.evaluate((id) => window.__geolearn!.engine.inspect(id)!, id);

/** Drags a piece home with a real touch sequence (lift, float above finger, drop). */
export async function touchPlace(page: Page, ctx: BrowserContext, id: string): Promise<boolean> {
  const cdp = await ctx.newCDPSession(page);
  const touch = (type: string, pts: [number, number][]) =>
    cdp.send('Input.dispatchTouchEvent', {
      type: type as 'touchStart',
      touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 3, radiusY: 3, force: 1 })),
    });
  await page.evaluate(() => window.__geolearn!.engine.fitTable(false));
  await page.waitForTimeout(40);
  const a = await info(page, id);
  if (a.placed) return true;
  await touch('touchStart', [[a.x, a.y]]);
  await page.waitForTimeout(a.onBoard ? 340 : 60);
  await touch('touchMove', [[a.x + 2, a.y + 2]]);
  await page.waitForTimeout(260);
  const b = await info(page, id);
  const fx = a.x + 2 - b.x;
  const fy = a.y + 2 - b.y;
  for (let i = 1; i <= 6; i++) {
    const t = i / 6;
    await touch('touchMove', [[a.x + (b.homeX + fx - a.x) * t, a.y + (b.homeY + fy - a.y) * t]]);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(140);
  const c = await info(page, id);
  await touch('touchMove', [[b.homeX + fx + (c.homeX - c.x), b.homeY + fy + (c.homeY - c.y)]]);
  await page.waitForTimeout(30);
  await touch('touchEnd', []);
  await page.waitForTimeout(80);
  await cdp.detach();
  const final = await info(page, id);
  if (!final.placed) console.log(`[touchPlace] ${id} missed`, JSON.stringify({ a, b, c, final }));
  return final.placed;
}

/** Drags a piece home with the mouse. */
export async function mousePlace(page: Page, id: string): Promise<boolean> {
  await page.evaluate(() => window.__geolearn!.engine.fitTable(false));
  await page.waitForTimeout(40);
  const a = await info(page, id);
  if (a.placed) return true;
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  if (a.onBoard) await page.waitForTimeout(340);
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(a.x + ((a.homeX - a.x) * i) / steps, a.y + ((a.homeY - a.y) * i) / steps);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(80);
  const final = await info(page, id);
  if (!final.placed) console.log(`[mousePlace] ${id} missed`, JSON.stringify({ a, final }));
  return final.placed;
}
