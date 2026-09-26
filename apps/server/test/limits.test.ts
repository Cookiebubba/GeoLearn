import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { AddressInfo } from 'node:net';
import { buildApp, type App } from '../src/app';
import { loadConfig } from '../src/config';

let app: App;
let url: string;

beforeAll(async () => {
  app = await buildApp(loadConfig({ dataDir: ':memory:', databaseUrl: undefined, logLevel: 'silent', webDist: undefined, maxSocketsPerIp: 2 }));
  await app.fastify.listen({ port: 0, host: '127.0.0.1' });
  url = `ws://127.0.0.1:${(app.fastify.server.address() as AddressInfo).port}/ws`;
});

afterAll(async () => {
  await app.close();
});

/** Opens a socket as if it came through Cloudflare from `visitor`; resolves to its close code, or 0 if it stays open. */
function connect(visitor: string): Promise<{ ws: WebSocket; closed: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers: { 'cf-connecting-ip': visitor } });
    let settled = false;
    ws.on('close', (code) => {
      if (!settled) resolve({ ws, closed: code });
      settled = true;
    });
    ws.on('open', () =>
      setTimeout(() => {
        if (!settled) resolve({ ws, closed: 0 });
        settled = true;
      }, 150),
    );
  });
}

describe('connection limits behind Cloudflare', () => {
  it('counts each visitor separately, not the proxy they arrive through', async () => {
    const a1 = await connect('203.0.113.7');
    const a2 = await connect('203.0.113.7');
    const a3 = await connect('203.0.113.7');
    const b1 = await connect('198.51.100.20');
    expect([a1.closed, a2.closed, a3.closed, b1.closed]).toEqual([0, 0, 1013, 0]);
    for (const c of [a1, a2, a3, b1]) c.ws.close();
  });
});
